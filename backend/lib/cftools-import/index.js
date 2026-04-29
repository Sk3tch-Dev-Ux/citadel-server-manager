/**
 * CFTools → Citadel ban list import — public API.
 *
 * Used by backend/routes/cftools-import.routes.js. Re-exports the
 * importer's preview/run + a small set of constants the frontend
 * needs to display caps/limits.
 *
 * Credentials are NOT persisted. They live only in the function
 * arguments for the duration of a single request.
 */
const importer = require('./importer');

module.exports = {
  preview: importer.preview,
  importAll: importer.importAll,
  MAX_IMPORT_BANS: importer.MAX_IMPORT_BANS,
  PREVIEW_SAMPLE_SIZE: importer.PREVIEW_SAMPLE_SIZE,
};
