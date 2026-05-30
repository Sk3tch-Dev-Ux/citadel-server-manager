/**
 * Citadel Self-Update Routes
 *
 * GET  /api/updates/status  — Current update state (version comparison, release info)
 * POST /api/updates/check   — Force an immediate update check
 * POST /api/updates/dismiss — Dismiss the update notification for this session
 *
 * All routes require authentication.
 */
const auth = require('../middleware/auth');
const updateChecker = require('../lib/update-checker');
const agentUpdater = require('../lib/agent-updater');
const { addAudit } = require('../lib/audit');
const logger = require('../lib/logger');

module.exports = function (app) {
  /**
   * GET /api/updates/status — Get current update status
   *
   * Response: {
   *   status: 'current' | 'update_available' | 'unknown' | 'error',
   *   currentVersion: '2.11.1',
   *   latestVersion: '2.12.0',
   *   releaseNotes: '...',
   *   downloadUrl: '...',
   *   publishedAt: '...',
   *   size: 12345678,
   *   prerelease: false,
   *   lastCheckedAt: '...',
   *   dismissed: false
   * }
   */
  app.get('/api/updates/status', auth(), (req, res) => {
    res.json(updateChecker.getState());
  });

  /**
   * POST /api/updates/check — Force an immediate update check
   *
   * Useful for "Check Now" button in the UI. Returns fresh state.
   */
  app.post('/api/updates/check', auth('admin'), async (req, res) => {
    try {
      const state = await updateChecker.checkForUpdate();
      res.json(state);
    } catch (err) {
      logger.error({ err }, 'Manual update check failed');
      res.status(500).json({ error: 'Update check failed' });
    }
  });

  /**
   * POST /api/updates/dismiss — Dismiss update notification
   *
   * Hides the banner until a newer version is released.
   */
  app.post('/api/updates/dismiss', auth(), (req, res) => {
    updateChecker.dismiss();
    res.json({ ok: true });
  });

  /**
   * POST /api/updates/download — Download the available update's installer.
   *
   * Fetches the signed installer from the trusted release host into the staging
   * dir and verifies it. Does NOT install. Admin only.
   */
  app.post('/api/updates/download', auth('admin'), async (req, res) => {
    try {
      const result = await agentUpdater.downloadInstaller();
      if (!result.ok) return res.status(400).json(result);
      addAudit(req.user.id, req.user.username, 'agent.update.download', `Downloaded installer ${result.path}`);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Installer download failed');
      res.status(500).json({ error: 'Installer download failed' });
    }
  });

  /**
   * POST /api/updates/apply — Download (if needed) and launch the installer.
   *
   * Hands file replacement + service restart to the official installer. Launches
   * interactively by default; pass { silent: true } to run unattended (/S).
   * Admin only.
   */
  app.post('/api/updates/apply', auth('admin'), async (req, res) => {
    try {
      const result = await agentUpdater.applyUpdate({ silent: req.body?.silent === true });
      if (!result.ok) return res.status(400).json(result);
      addAudit(req.user.id, req.user.username, 'agent.update.apply', `Launched installer (${req.body?.silent ? 'silent' : 'interactive'})`);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Update apply failed');
      res.status(500).json({ error: 'Update apply failed' });
    }
  });
};
