/**
 * Steam settings and credential management routes.
 */
const ctx = require('../lib/context');
const { ensureSteamCMD, validateSteamLogin } = require('../lib/steamcmd');
const auth = require('../middleware/auth');

module.exports = function(app) {
  app.get('/api/steam/status', auth(), async (req, res) => {
    let steamCmdFound = false;
    try { await ensureSteamCMD(); steamCmdFound = true; } catch {}
    res.json({ steamCmdReady: steamCmdFound, username: ctx.steamCredentials.username || '', hasPassword: !!ctx.steamCredentials.password, hasGuardCode: !!ctx.steamCredentials.guardCode, loginValidated: ctx.steamLoginValidated });
  });

  app.post('/api/steam/credentials', auth('mods.install'), async (req, res) => {
    const { username, password, guardCode } = req.body;
    if (username !== undefined) ctx.steamCredentials.username = username;
    if (password !== undefined) ctx.steamCredentials.password = password;
    if (guardCode !== undefined) ctx.steamCredentials.guardCode = guardCode;
    if (ctx.steamCredentials.username && ctx.steamCredentials.password) {
      const result = await validateSteamLogin(ctx.steamCredentials.username, ctx.steamCredentials.password, ctx.steamCredentials.guardCode);
      if (result.success) { ctx.steamLoginValidated = true; res.json({ success: true, message: `Logged in as ${ctx.steamCredentials.username}` }); }
      else if (result.needsGuard) { ctx.steamLoginValidated = false; res.json({ success: false, needsGuard: true, message: 'Steam Guard code required.' }); }
      else { ctx.steamLoginValidated = false; res.json({ success: false, message: result.error }); }
    } else { ctx.steamLoginValidated = false; res.json({ success: false, message: 'Username and password required' }); }
  });
};
