/**
 * CFTools import — REST routes for the /bans dashboard import flow.
 *
 *   POST /api/cftools-import/preview
 *     Body: { apiToken, banlistId? | serverId? }
 *     Returns: { banlistId, firstPageCount, estimatedSteam64, estimatedSkipped, sample[], hasMore }
 *
 *   POST /api/cftools-import/run
 *     Body: { apiToken, banlistId? | serverId? }
 *     Returns: { added, updated, skipped, pagesProcessed, errors[], capped }
 *
 * Auth: same `bans.manage` permission as the rest of the bans surface.
 *
 * Credentials handling: the customer's CFTools `apiToken` (from
 * developer.cftools.cloud) is read from the request body, used
 * immediately, and never logged or persisted. The route logs stripped
 * versions of payloads. (Express + the existing security middleware does
 * NOT log request bodies by default — but if anyone later adds body
 * logging, the field `apiToken` is what they'd want to scrub.)
 */
const auth = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const cftools = require('../lib/cftools-import');
const logger = require('../lib/logger');

// ─── Validation helpers ─────────────────────────────────────────

function validateImportInput(body, label) {
  if (!body || typeof body !== 'object') {
    return `${label}: request body required`;
  }
  if (typeof body.apiToken !== 'string' || body.apiToken.length < 8 || body.apiToken.length > 1000) {
    return `${label}: apiToken must be the Bearer token from developer.cftools.cloud`;
  }
  const hasBanlistId = typeof body.banlistId === 'string' && body.banlistId.length > 0;
  const hasServerId = typeof body.serverId === 'string' && body.serverId.length > 0;
  if (!hasBanlistId && !hasServerId) {
    return `${label}: either banlistId or serverId is required`;
  }
  if (hasBanlistId && body.banlistId.length > 200) return `${label}: banlistId too long`;
  if (hasServerId && body.serverId.length > 200) return `${label}: serverId too long`;
  return null;
}

/**
 * Map an internal error from the importer to a structured JSON response.
 * We surface the server-provided status (e.g. 401 from CFTools auth) so
 * the frontend can show "wrong credentials" specifically.
 */
function errorResponse(err) {
  const status = err.status === 401 || err.status === 403
    ? 401
    : err.status === 404
      ? 404
      : err.status >= 400 && err.status < 600
        ? err.status
        : 502; // upstream service error
  return {
    status,
    body: {
      error: err.code || 'CFTOOLS_IMPORT_FAILED',
      message: err.message || 'CFTools import failed',
      upstreamStatus: err.status || null,
    },
  };
}

// ─── Routes ─────────────────────────────────────────────────────

module.exports = function (app) {
  // Preview: auth, fetch first page, return summary. No DB writes happen.
  app.post('/api/cftools-import/preview', auth('bans.manage'), async (req, res) => {
    const valError = validateImportInput(req.body, 'preview');
    if (valError) return res.status(400).json({ error: 'INVALID_INPUT', message: valError });

    const { apiToken, banlistId, serverId } = req.body;
    try {
      const summary = await cftools.preview({ apiToken, banlistId, serverId });
      // Audit log the preview attempt — useful if anyone investigates a
      // mass-import incident later. Don't include the secret.
      addAudit(
        req.user.id, req.user.username, 'cftools.preview',
        `Previewed CFTools banlist ${summary.banlistId} (${summary.estimatedSteam64} steam64-format bans, ${summary.estimatedSkipped} skipped)`,
      );
      return res.json(summary);
    } catch (err) {
      logger.warn(
        { err: err.message, code: err.code, status: err.status, userId: req.user?.id },
        'cftools-import preview failed',
      );
      const { status, body } = errorResponse(err);
      return res.status(status).json(body);
    }
  });

  // Run: actually import. May take a while for large banlists. Returns
  // when complete with full stats. (Synchronous over HTTP — typical
  // sub-100k banlists complete well within standard request timeouts.)
  app.post('/api/cftools-import/run', auth('bans.manage'), async (req, res) => {
    const valError = validateImportInput(req.body, 'run');
    if (valError) return res.status(400).json({ error: 'INVALID_INPUT', message: valError });

    const { apiToken, banlistId, serverId } = req.body;
    try {
      const result = await cftools.importAll({
        apiToken,
        banlistId,
        serverId,
        bannedBy: req.user.username,
      });
      addAudit(
        req.user.id, req.user.username, 'cftools.import',
        `Imported from CFTools: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors${result.capped ? ' (CAPPED)' : ''}`,
      );
      return res.json(result);
    } catch (err) {
      logger.warn(
        { err: err.message, code: err.code, status: err.status, userId: req.user?.id },
        'cftools-import run failed',
      );
      const { status, body } = errorResponse(err);
      return res.status(status).json(body);
    }
  });
};
