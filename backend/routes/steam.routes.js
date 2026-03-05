/**
 * Steam settings and credential management routes.
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { ensureSteamCMD, validateSteamLogin } = require('../lib/steamcmd');
const auth = require('../middleware/auth');
const logger = require('../lib/logger');

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

    // Update or add STEAM_PASSWORD
    if (envContent.match(/^#?\s*STEAM_PASSWORD=/m)) {
      envContent = envContent.replace(/^#?\s*STEAM_PASSWORD=.*$/m, `STEAM_PASSWORD=${password}`);
    } else {
      envContent += `\nSTEAM_PASSWORD=${password}`;
    }

    fs.writeFileSync(envPath, envContent);
    logger.info('Steam credentials saved to .env');
  } catch (err) {
    logger.warn({ err }, 'Failed to persist Steam credentials to .env');
  }
}

module.exports = function(app) {
  app.get('/api/steam/status', auth(), async (req, res) => {
    let steamCmdFound = false;
    try { await ensureSteamCMD(); steamCmdFound = true; } catch {}
    res.json({
      steamCmdReady: steamCmdFound,
      username: ctx.steamCredentials.username || '',
      hasPassword: !!ctx.steamCredentials.password,
      hasGuardCode: !!ctx.steamCredentials.guardCode,
      loginValidated: ctx.steamLoginValidated,
    });
  });

  app.post('/api/steam/credentials', auth('mods.install'), async (req, res) => {
    const { username, password, guardCode } = req.body;
    if (username !== undefined) ctx.steamCredentials.username = username;
    if (password !== undefined) ctx.steamCredentials.password = password;
    if (guardCode !== undefined) ctx.steamCredentials.guardCode = guardCode;

    if (!ctx.steamCredentials.username || !ctx.steamCredentials.password) {
      ctx.steamLoginValidated = false;
      return res.json({ success: false, message: 'Username and password required' });
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
        res.json({ success: false, needsGuard: true, message: 'Steam Guard code required.' });
      } else {
        ctx.steamLoginValidated = false;
        res.json({ success: false, message: result.error });
      }
    } catch (err) {
      logger.error({ err }, 'Steam credential validation failed');
      ctx.steamLoginValidated = false;
      res.json({ success: false, message: err.message || 'Steam login failed — is SteamCMD installed?' });
    }
  });
};
