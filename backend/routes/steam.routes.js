/**
 * Steam settings and credential management routes.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { ensureSteamCMD, validateSteamLogin } = require('../lib/steamcmd');
const auth = require('../middleware/auth');
const logger = require('../lib/logger');
const { encryptForEnv } = require('../lib/credential-encryption');

/**
 * Persist Steam credentials to .env so they survive server restarts.
 */
function persistSteamCredentials(username, password) {
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (!fs.existsSync(envPath)) return;
    let envContent = fs.readFileSync(envPath, 'utf-8');

    // Update or add STEAM_USERNAME
    if (envContent.match(/^#?\s*STEAM_USERNAME=/m)) {
      envContent = envContent.replace(/^#?\s*STEAM_USERNAME=.*$/m, `STEAM_USERNAME=${username}`);
    } else {
      envContent += `\nSTEAM_USERNAME=${username}`;
    }

    // Update or add STEAM_PASSWORD (encrypted at rest)
    const encryptedPassword = encryptForEnv(password);
    if (envContent.match(/^#?\s*STEAM_PASSWORD=/m)) {
      envContent = envContent.replace(/^#?\s*STEAM_PASSWORD=.*$/m, `STEAM_PASSWORD=${encryptedPassword}`);
    } else {
      envContent += `\nSTEAM_PASSWORD=${encryptedPassword}`;
    }

    fs.writeFileSync(envPath, envContent);
    logger.info('Steam credentials saved to .env');
  } catch (err) {
    logger.warn({ err }, 'Failed to persist Steam credentials to .env');
  }
}

module.exports = function(app) {
  // All Steam credential endpoints are admin-only — credentials are global system config
  app.get('/api/steam/status', auth('system.steam'), async (req, res) => {
    let steamCmdFound = false;
    try { await ensureSteamCMD(); steamCmdFound = true; } catch {}
    res.json({
      steamCmdReady: steamCmdFound,
      username: ctx.steamCredentials.username || '',
      hasPassword: !!ctx.steamCredentials.password,
      hasGuardCode: !!ctx.steamCredentials.guardCode,
      loginValidated: ctx.steamLoginValidated,
      steamCmdDir: ctx.steamCmdPath ? path.dirname(ctx.steamCmdPath) : '',
    });
  });

  app.post('/api/steam/credentials', auth('system.steam'), async (req, res) => {
    const { username, password, guardCode } = req.body;
    if (username !== undefined) ctx.steamCredentials.username = username;
    if (password !== undefined) ctx.steamCredentials.password = password;
    if (guardCode !== undefined) ctx.steamCredentials.guardCode = guardCode;

    if (!ctx.steamCredentials.username || !ctx.steamCredentials.password) {
      ctx.steamLoginValidated = false;
      return res.status(400).json({ error: 'Username and password required' });
    }

    try {
      const result = await validateSteamLogin(
        ctx.steamCredentials.username,
        ctx.steamCredentials.password,
        ctx.steamCredentials.guardCode
      );

      if (result.success) {
        ctx.steamLoginValidated = true;
        // Clear the one-time guard code so it's never re-sent to SteamCMD.
        // The auth token is now cached in SteamCMD's config/config.vdf.
        ctx.steamCredentials.guardCode = '';
        // Persist to .env so credentials survive restarts
        persistSteamCredentials(ctx.steamCredentials.username, ctx.steamCredentials.password);
        res.json({ success: true, message: `Logged in as ${ctx.steamCredentials.username}` });
      } else if (result.needsGuard) {
        ctx.steamLoginValidated = false;
        // Still persist credentials so they're available for manual SteamCMD auth
        persistSteamCredentials(ctx.steamCredentials.username, ctx.steamCredentials.password);
        res.status(403).json({ error: 'Steam Guard code required.', needsGuard: true });
      } else {
        ctx.steamLoginValidated = false;
        res.status(422).json({ error: result.error });
      }
    } catch (err) {
      logger.error({ err }, 'Steam credential validation failed');
      ctx.steamLoginValidated = false;
      res.status(500).json({ error: err.message || 'Steam login failed — is SteamCMD installed?' });
    }
  });

  /**
   * POST /api/steam/credentials/save
   * Save Steam credentials WITHOUT running SteamCMD validation.
   * Useful when Steam Guard blocks automated login — the user can:
   *   1. Save credentials here
   *   2. Run SteamCMD manually on the server to complete the initial auth + guard code
   *   3. SteamCMD caches the auth token in config/config.vdf
   *   4. All future automated logins reuse the cached token
   */
  app.post('/api/steam/credentials/save', auth('system.steam'), (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    ctx.steamCredentials.username = username;
    ctx.steamCredentials.password = password;
    ctx.steamCredentials.guardCode = '';
    ctx.steamLoginValidated = false;
    persistSteamCredentials(username, password);
    logger.info({ username }, 'Steam credentials saved without validation');
    res.json({ success: true, saved: true, message: `Credentials saved for ${username}` });
  });
};
