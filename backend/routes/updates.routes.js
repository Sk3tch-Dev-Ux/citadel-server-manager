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
};
