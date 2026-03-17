/**
 * First-run setup wizard routes.
 * These endpoints are ONLY accessible when the panel is in "needs setup" state.
 * Once setup is complete, they return 403.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const jwt = require('jsonwebtoken');
const logger = require('../lib/logger');
const ctx = require('../lib/context');
const { saveJSON } = require('../lib/data-store');
const { ensureSteamCMD, validateSteamLogin } = require('../lib/steamcmd');
const { ENV_FILE } = require('../lib/paths');
const { ensurePanelFirewallRule } = require('../lib/firewall-manager');
const { encryptForEnv } = require('../lib/credential-encryption');
const { checkPasswordPolicy } = require('../lib/helpers');

/**
 * Determine setup state:
 * - 'needs_setup': No users exist, or only default admin with default password
 * - 'complete': Setup has been completed
 */
function getSetupState() {
  if (ctx.users.length === 0) return 'needs_setup';

  // Check if the only user is the default admin with default password "admin"
  if (ctx.users.length === 1 && ctx.users[0].username === 'admin' && ctx.users[0].isRoot) {
    // Check the setup flag in data dir
    const setupFlagPath = path.join(ctx.CONFIG.dataDir, 'setup_complete.json');
    if (!fs.existsSync(setupFlagPath)) return 'needs_setup';
  }

  return 'complete';
}

function requireSetupMode(req, res, next) {
  if (getSetupState() === 'complete') {
    return res.status(403).json({ error: 'Setup already completed' });
  }
  next();
}

module.exports = function(app) {
  /**
   * GET /api/setup/status
   * Public endpoint — returns whether setup is needed.
   * Frontend uses this to decide whether to show login or setup wizard.
   */
  app.get('/api/setup/status', (req, res) => {
    const state = getSetupState();
    res.json({
      needsSetup: state === 'needs_setup',
      hasUsers: ctx.users.length > 0,
      hasServers: ctx.servers.length > 0,
      hasSteamCmd: !!(ctx.steamCmdPath && fs.existsSync(ctx.steamCmdPath)),
      steamCmdPath: ctx.steamCmdPath || '',
    });
  });

  /**
   * POST /api/setup/admin
   * Step 1: Create the admin account (or update the default one).
   */
  app.post('/api/setup/admin', requireSetupMode, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (!checkPasswordPolicy(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character' });
    }

    try {
      const hash = await bcrypt.hash(password, 10);

      // If default admin exists, update it
      const existing = ctx.users.find(u => u.isRoot);
      if (existing) {
        existing.username = username;
        existing.passwordHash = hash;
      } else {
        ctx.users.push({
          id: uuid(),
          username,
          passwordHash: hash,
          role: 'admin',
          isRoot: true,
          createdAt: new Date().toISOString(),
          description: 'This is the root user. It can not be modified or deleted.',
        });
      }

      saveJSON(ctx.CONFIG.dataDir, 'users.json', ctx.users.map(u => ({ ...u })));

      // Generate auth token so the wizard can continue authenticated
      const user = ctx.users.find(u => u.isRoot);
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        ctx.CONFIG.jwtSecret,
        { expiresIn: '24h' }
      );

      logger.info({ username }, 'Setup: Admin account created');
      res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch (err) {
      logger.error({ err }, 'Setup: Failed to create admin');
      res.status(500).json({ error: 'Failed to create admin account' });
    }
  });

  /**
   * GET /api/setup/network/detect
   * Auto-detect non-loopback IPv4 addresses on the machine.
   */
  app.get('/api/setup/network/detect', requireSetupMode, (req, res) => {
    const interfaces = [];
    const nets = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(nets)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          interfaces.push({ name, ip: addr.address });
        }
      }
    }
    res.json({
      interfaces,
      recommended: interfaces.length > 0 ? interfaces[0].ip : '',
    });
  });

  /**
   * POST /api/setup/network
   * Step 2: Configure server IP, CORS origins, and optionally open firewall for the panel.
   */
  app.post('/api/setup/network', requireSetupMode, async (req, res) => {
    const { ip, enableFirewall } = req.body;
    if (!ip || !ip.trim()) {
      return res.status(400).json({ error: 'IP address is required' });
    }

    const serverIp = ip.trim();

    try {
      // Update DAYZ_SERVER_IP in .env
      const envPath = ENV_FILE;
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        if (envContent.match(/^#?\s*DAYZ_SERVER_IP=/m)) {
          envContent = envContent.replace(/^#?\s*DAYZ_SERVER_IP=.*$/m, `DAYZ_SERVER_IP=${serverIp}`);
        } else {
          envContent += `\nDAYZ_SERVER_IP=${serverIp}`;
        }
        fs.writeFileSync(envPath, envContent);
      }

      // Update in-memory config
      ctx.CONFIG.dayz.ip = serverIp;

      // Update allowedOrigins in citadel.config.json to include the new IP
      const configFilePath = ctx.CONFIG._configFilePath;
      const port = ctx.CONFIG.port;
      const newOrigin = `http://${serverIp}:${port}`;
      const currentOrigins = ctx.CONFIG.allowedOrigins || [];
      if (!currentOrigins.includes(newOrigin)) {
        currentOrigins.push(newOrigin);
        ctx.CONFIG.allowedOrigins = currentOrigins;

        // Persist to citadel.config.json
        if (configFilePath && fs.existsSync(configFilePath)) {
          try {
            const raw = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
            if (!raw.server) raw.server = {};
            raw.server.allowedOrigins = currentOrigins;
            fs.writeFileSync(configFilePath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
          } catch { /* non-critical */ }
        }
      }

      // Apply panel firewall rule if requested
      let firewallResult = null;
      if (enableFirewall) {
        firewallResult = await ensurePanelFirewallRule(port);
      }

      logger.info({ ip: serverIp, firewall: !!enableFirewall }, 'Setup: Network configured');
      res.json({ success: true, ip: serverIp, firewallResult });
    } catch (err) {
      logger.error({ err }, 'Setup: Failed to configure network');
      res.status(500).json({ error: err.message || 'Failed to configure network' });
    }
  });

  /**
   * POST /api/setup/steam
   * Step 3: Configure SteamCMD path and credentials.
   */
  app.post('/api/setup/steam', requireSetupMode, async (req, res) => {
    const { steamCmdPath, username, password } = req.body;

    try {
      // If a path was provided, verify it exists
      if (steamCmdPath) {
        if (fs.existsSync(steamCmdPath)) {
          ctx.steamCmdPath = steamCmdPath;
        } else {
          return res.status(400).json({ error: 'SteamCMD not found at the specified path' });
        }
      } else {
        // Try auto-detection / auto-download
        try {
          const detected = await ensureSteamCMD();
          ctx.steamCmdPath = detected;
        } catch (err) {
          return res.status(400).json({
            error: `Could not find or download SteamCMD: ${err.message}`,
          });
        }
      }

      // Save Steam credentials if provided
      if (username) {
        ctx.steamCredentials.username = username;
        ctx.steamCredentials.password = password || '';
      }

      // Update .env file with SteamCMD settings
      const envPath = ENV_FILE;
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf-8');

        // Update or add STEAMCMD_PATH
        if (envContent.includes('STEAMCMD_PATH=') || envContent.includes('# STEAMCMD_PATH=')) {
          envContent = envContent.replace(/^#?\s*STEAMCMD_PATH=.*$/m, `STEAMCMD_PATH=${ctx.steamCmdPath}`);
        } else {
          envContent += `\nSTEAMCMD_PATH=${ctx.steamCmdPath}`;
        }

        // Update or add Steam credentials
        if (username) {
          if (envContent.includes('STEAM_USERNAME=') || envContent.includes('# STEAM_USERNAME=')) {
            envContent = envContent.replace(/^#?\s*STEAM_USERNAME=.*$/m, `STEAM_USERNAME=${username}`);
          } else {
            envContent += `\nSTEAM_USERNAME=${username}`;
          }
          const encSetupPwd = encryptForEnv(password || '');
          if (envContent.includes('STEAM_PASSWORD=') || envContent.includes('# STEAM_PASSWORD=')) {
            envContent = envContent.replace(/^#?\s*STEAM_PASSWORD=.*$/m, `STEAM_PASSWORD=${encSetupPwd}`);
          } else {
            envContent += `\nSTEAM_PASSWORD=${encSetupPwd}`;
          }
        }

        fs.writeFileSync(envPath, envContent);
      }

      logger.info({ path: ctx.steamCmdPath }, 'Setup: SteamCMD configured');
      res.json({
        success: true,
        steamCmdPath: ctx.steamCmdPath,
      });
    } catch (err) {
      logger.error({ err }, 'Setup: Failed to configure SteamCMD');
      res.status(500).json({ error: err.message || 'Failed to configure SteamCMD' });
    }
  });

  /**
   * POST /api/setup/steam/validate
   * Validate Steam credentials (login test).
   * On success, caches the auth token and persists credentials to .env.
   */
  app.post('/api/setup/steam/validate', requireSetupMode, async (req, res) => {
    const { username, password, guardCode } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    try {
      const result = await validateSteamLogin(username, password, guardCode);
      if (result.success) {
        // Store credentials in context and mark as validated
        ctx.steamCredentials.username = username;
        ctx.steamCredentials.password = password;
        ctx.steamCredentials.guardCode = ''; // Clear one-time guard code
        ctx.steamLoginValidated = true;

        // Persist to .env so credentials survive restarts
        const envPath = ENV_FILE;
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf-8');
          if (envContent.match(/^#?\s*STEAM_USERNAME=/m)) {
            envContent = envContent.replace(/^#?\s*STEAM_USERNAME=.*$/m, `STEAM_USERNAME=${username}`);
          } else {
            envContent += `\nSTEAM_USERNAME=${username}`;
          }
          const encValidatedPwd = encryptForEnv(password);
          if (envContent.match(/^#?\s*STEAM_PASSWORD=/m)) {
            envContent = envContent.replace(/^#?\s*STEAM_PASSWORD=.*$/m, `STEAM_PASSWORD=${encValidatedPwd}`);
          } else {
            envContent += `\nSTEAM_PASSWORD=${encValidatedPwd}`;
          }
          fs.writeFileSync(envPath, envContent);
        }
        logger.info({ username }, 'Setup: Steam login validated and cached');
        res.json({ success: true });
      } else if (result.needsGuard) {
        res.status(403).json({ error: 'Steam Guard code required.', needsGuard: true });
      } else {
        res.status(422).json({ error: result.error || 'Steam login failed' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/setup/steam/save
   * Save Steam credentials WITHOUT running SteamCMD validation.
   * Same as /api/steam/credentials/save but for setup wizard context.
   */
  app.post('/api/setup/steam/save', requireSetupMode, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    ctx.steamCredentials.username = username;
    ctx.steamCredentials.password = password;
    ctx.steamCredentials.guardCode = '';
    ctx.steamLoginValidated = false;

    // Persist to .env
    const envPath = ENV_FILE;
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf-8');
      if (envContent.match(/^#?\s*STEAM_USERNAME=/m)) {
        envContent = envContent.replace(/^#?\s*STEAM_USERNAME=.*$/m, `STEAM_USERNAME=${username}`);
      } else {
        envContent += `\nSTEAM_USERNAME=${username}`;
      }
      const encSavedPwd = encryptForEnv(password);
      if (envContent.match(/^#?\s*STEAM_PASSWORD=/m)) {
        envContent = envContent.replace(/^#?\s*STEAM_PASSWORD=.*$/m, `STEAM_PASSWORD=${encSavedPwd}`);
      } else {
        envContent += `\nSTEAM_PASSWORD=${encSavedPwd}`;
      }
      fs.writeFileSync(envPath, envContent);
    }

    logger.info({ username }, 'Setup: Steam credentials saved without validation');
    res.json({ success: true, saved: true });
  });

  /**
   * POST /api/setup/complete
   * Mark setup as finished. After this, setup routes return 403.
   */
  app.post('/api/setup/complete', requireSetupMode, (req, res) => {
    try {
      saveJSON(ctx.CONFIG.dataDir, 'setup_complete.json', {
        completedAt: new Date().toISOString(),
        version: '2.0.0',
      });

      logger.info('Setup: Wizard completed');
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Setup: Failed to mark complete');
      res.status(500).json({ error: 'Failed to complete setup' });
    }
  });
};
