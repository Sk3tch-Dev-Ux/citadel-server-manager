/**
 * GET /api/health — Simple health check
 */
module.exports = function handler(req, res) {
  res.status(200).json({ status: 'ok', service: 'citadel-license-server' });
};
