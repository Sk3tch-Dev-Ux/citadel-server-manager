const { safeError, clientError } = require('../lib/http-errors');
/**
 * First-run setup wizard routes.
 * These endpoints are ONLY accessible when the panel is in "needs setup" state.
 * Once setup is complete, they return 403.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
// Audit N5: bcryptjs → @node-rs/bcrypt (hash-compatible, prebuilt native).
const bcrypt = require('@node-rs/bcrypt');
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
 * Permanent first-run marker. Once written, setup is locked forever — even
 * if the user manually deletes data/setup_complete.json. This closes the
 * audit C5 takeover where deleting setup_complete.json re-armed the wizard
 * and let an unauthenticated caller rename + re-password the root admin.
 *
 * The marker is intentionally a separate file from setup_complete.json so
 * that file can be regenerated for non-security reasons (version bumps,
 * wizard re-run for guided UX) without re-arming the security-relevant
 * "create root admin without auth" path.
 */
const FIRST_RUN_MARKER = '.first-run-completed';

function firstRunMarkerPath() {
  return path.join(ctx.CONFIG.dataDir, FIRST_RUN_MARKER);
}

function writeFirstRunMarker() {
  try {
    // 0o600 — owner-readable only. mkdir is idempotent.
    fs.mkdirSync(ctx.CONFIG.dataDir, { recursive: true });
    fs.writeFileSync(
      firstRunMarkerPath(),
      JSON.stringify({ completedAt: new Date().toISOString() }) + '\n',
      { mode: 0o600 }
    );
  } catch (err) {
    // If we can't persist this, refuse to claim setup is locked — the user
    // would be stuck unable to log in. Bubble up so the caller decides.
    throw new Error(`Failed to persist first-run marker: ${err.message}`);
  }
}

function firstRunMarkerExists() {
  try {
    return fs.existsSync(firstRunMarkerPath());
  } catch {
    return false;
  }
}

/**
 * Determine setup state:
 * - 'needs_setup': No users exist (cold start)
 * - 'needs_setup': Only the bare default admin exists — the user has no
 *                  usable login yet, so the wizard MUST stay available even
 *                  if leftover servers/state from a prior install are present.
 * - 'complete':    First-run marker is written, OR at least one usable admin
 *                  account exists.
 *
 * The first-run marker is the authoritative security latch — once written,
 * setup is locked forever even if users.json is deleted. The "only default
 * admin" branch lets the wizard recover from an install that landed on a
 * populated data/ directory but has no real admin yet (v2.18.1 regression,
 * fixed in v2.18.2).
 */
function getSetupState() {
  // Authoritative latch — once set, never unset by any code path.
  if (firstRunMarkerExists()) return 'complete';

  // Cold start — no users at all.
  if (ctx.users.length === 0) return 'needs_setup';

  // Only the bare default admin exists. The user can't log in with their own
  // credentials yet, so the wizard MUST remain available — even if servers
  // or other state from a previous install are present in the data dir.
  // The marker check above is still the authoritative security latch; once
  // a real admin is provisioned, POST /api/setup/admin stays locked.
  const onlyDefaultAdmin = ctx.users.length === 1
    && ctx.users[0].username === 'admin'
    && ctx.users[0].isRoot;
  if (onlyDefaultAdmin) return 'needs_setup';

  // Past this point we have at least one usable admin account.
  // Belt-and-suspenders: any non-default state means setup ran in the past.
  // Lazily write the marker so the wizard never re-arms even if the marker
  // file is lost (manual cleanup, partial restore).
  const hasNonDefaultUser = ctx.users.some(u => !u.isRoot)
    || ctx.users.some(u => u.isRoot && u.username !== 'admin');
  const hasServers = Array.isArray(ctx.servers) && ctx.servers.length > 0;

  if (hasNonDefaultUser || hasServers) {
    try { writeFirstRunMarker(); } catch (err) {
      logger.warn({ err: err.message }, 'Setup: failed to lazily write first-run marker');
    }
    return 'complete';
  }

  return 'complete';
}

/**
 * Extract a Bearer token from the Authorization header (or `?token=` query).
 * Kept inline so requireSetupMode can authenticate without taking a hard
 * dependency on the global auth middleware (which has more behavior than we
 * need here — permissions, revocation, mustChangePassword, etc.).
 */
function extractSetupToken(req) {
  // Cookie first — that's the M11 audit-blessed transport. /api/auth/login
  // sets `auth-token` and the wizard now does the same on /api/setup/admin
  // so the browser auto-attaches it to every subsequent same-origin request.
  if (req.cookies && typeof req.cookies['auth-token'] === 'string' && req.cookies['auth-token']) {
    return req.cookies['auth-token'];
  }
  const header = req.headers && req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // Audit N2 (2026-05-19): a `req.query.token` fallback used to live here.
  // Removed — no caller passes it, and an admin-creation surface should never
  // accept tokens in URLs (proxy logs, browser history). Cookie + header only.
  return null;
}

function requireSetupMode(req, res, next) {
  // Allow if setup is not yet complete (initial admin creation flow).
  if (getSetupState() !== 'complete') return next();

  // Setup is marked complete — typically because POST /api/setup/admin just
  // ran and wrote the first-run marker (audit C5, prevents unauthenticated
  // re-arm of admin creation). The wizard's subsequent steps still need to
  // work, so allow the request through if it carries a valid JWT for a
  // root admin (the token issued by /api/setup/admin). Without this branch,
  // network-detect / steam / complete all return 403 mid-wizard and setup
  // can never finish (v2.18.x regression chain).
  try {
    const token = extractSetupToken(req);
    if (token) {
      const decoded = jwt.verify(token, ctx.CONFIG.jwtSecret);
      const user = ctx.users.find(u => u.id === decoded.id);
      if (user && user.isRoot) {
        req.user = decoded;
        return next();
      }
    }
  } catch { /* fall through to 403 below */ }

  return res.status(403).json({ error: 'Setup already completed' });
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
      return clientError(res, 400, 'Username and password are required.', {
        code: 'MISSING_FIELD',
        suggestion: 'Fill in both fields and try again.',
      });
    }
    if (!checkPasswordPolicy(password)) {
      return clientError(res, 400, 'Password does not meet the policy.', {
        code: 'WEAK_PASSWORD',
        suggestion: 'Use 8+ characters with uppercase, lowercase, a number, and a symbol.',
      });
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

      // CRITICAL — write the first-run marker *now*, before issuing the
      // auth token. This locks the setup wizard against re-arm even if the
      // process crashes between admin creation and the wizard's final
      // /api/setup/complete call. Audit C5: the previous implementation only
      // wrote a separate setup_complete.json at the very end; if a user (or
      // a partial restore from backup) ever removed that file, an
      // unauthenticated caller could re-run /api/setup/admin and overwrite
      // the existing root user's username + password.
      try {
        writeFirstRunMarker();
      } catch (err) {
        // We've already mutated users.json. Refusing to issue the token
        // here would leave a half-finished state. Log loudly and continue;
        // getSetupState() will lazily write the marker on the next request
        // because users now contains a non-default account.
        logger.warn({ err: err.message }, 'Setup: failed to write first-run marker on admin creation');
      }

      // Generate auth token so the wizard can continue authenticated
      const user = ctx.users.find(u => u.isRoot);
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        ctx.CONFIG.jwtSecret,
        { expiresIn: '24h' }
      );

      // Audit M11 parity — /api/auth/login sets the JWT as an HttpOnly
      // cookie on the same `auth-token` name; the wizard's subsequent
      // setup endpoints rely on that cookie for auth (browser auto-
      // attaches it with credentials: 'include'). Without this line the
      // post-admin steps (network-detect, steam, complete) silently
      // 403'd because requireSetupMode could find no token to validate.
      res.cookie('auth-token', token, {
        maxAge: 24 * 60 * 60 * 1000,  // matches the 24h JWT expiry above
        path: '/',
      });

      logger.info({ username }, 'Setup: Admin account created');
      res.json({
        success: true,
        token,
        user: { id: user.id, username: user.username, role: user.role },
      });
    } catch (err) {
      return safeError(err, req, res, {
        status: 500,
        clientMessage: 'Failed to create admin account.',
        code: 'ADMIN_CREATE_FAILED',
        suggestion: 'Check the backend logs for details. The data/ directory may be read-only or full.',
      });
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
      return clientError(res, 400, 'Server IP address is required.', {
        code: 'MISSING_FIELD',
        suggestion: 'Use Auto-Detect, or type your VPS\'s public IPv4 manually.',
      });
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
      return safeError(err, req, res, {
        status: 500,
        clientMessage: 'Failed to configure network settings.',
        code: 'NETWORK_CONFIG_FAILED',
        suggestion: 'On Windows, the firewall step needs admin rights — try running the service as Administrator.',
      });
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
          return clientError(res, 400, 'SteamCMD not found at the specified path.', {
            code: 'STEAMCMD_NOT_FOUND',
            suggestion: 'Leave the field blank to auto-download SteamCMD, or set it to the absolute path of an existing steamcmd.exe.',
          });
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
      return safeError(err, req, res, {
        status: 500,
        clientMessage: 'Failed to configure SteamCMD.',
        code: 'STEAMCMD_CONFIG_FAILED',
        suggestion: 'If auto-download failed, check that the Citadel data directory is writable and Steam servers are reachable.',
      });
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
      return clientError(res, 400, 'Steam username and password are required.', {
        code: 'MISSING_FIELD',
        suggestion: 'Enter your Steam account credentials. They are stored encrypted and only used to run SteamCMD.',
      });
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
        res.status(403).json({
          error: 'Steam Guard code required.',
          code: 'STEAM_GUARD_REQUIRED',
          suggestion: 'Check the email associated with your Steam account, then enter the 5-character code here.',
          needsGuard: true,
        });
      } else {
        res.status(422).json({
          error: result.error || 'Steam login failed.',
          code: 'STEAM_LOGIN_FAILED',
          suggestion: 'Double-check your username and password. If 2FA is enabled, the Mobile Authenticator (not the email Guard code) is required and Citadel cannot complete that flow — generate an app password instead.',
        });
      }
    } catch (err) {
      safeError(err, req, res, { status: 500 });
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
      return clientError(res, 400, 'Steam username and password are required.', {
        code: 'MISSING_FIELD',
        suggestion: 'Enter your Steam account credentials. They are stored encrypted and only used to run SteamCMD.',
      });
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

      // Belt-and-suspenders: ensure the security-relevant first-run marker
      // exists on disk, in case admin creation failed to write it (audit C5).
      try { writeFirstRunMarker(); } catch (err) {
        logger.warn({ err: err.message }, 'Setup: failed to write first-run marker on /complete');
      }

      logger.info('Setup: Wizard completed');
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Setup: Failed to mark complete');
      return safeError(err, req, res, {
        status: 500,
        clientMessage: 'Failed to finalize setup.',
        code: 'SETUP_COMPLETE_FAILED',
        suggestion: 'Check the backend logs. Use the "Download diagnostics" link below to send your last 50 API events to support.',
      });
    }
  });
};
