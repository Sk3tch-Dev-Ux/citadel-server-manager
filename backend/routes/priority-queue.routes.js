const { safeError } = require('../lib/http-errors');
/**
 * Priority Queue CRUD + import/export routes.
 * Manages VIP/priority entries that sync to DayZ priority.txt.
 */
const ctx = require('../lib/context');
const {
  listEntries, getEntryById, addEntry, updateEntry, removeEntry,
  importEntries, exportEntries, cleanExpired,
} = require('../lib/priority-engine');
const auth = require('../middleware/auth');
const { addAudit } = require('../lib/audit');
const logger = require('../lib/logger');

module.exports = function (app) {
  // ─── List all entries ─────────────────────────────────────
  app.get('/api/priority-queue', auth('priority.manage'), (req, res) => {
    res.json(listEntries());
  });

  // ─── Export as JSON download ──────────────────────────────
  app.get('/api/priority-queue/export', auth('priority.manage'), (req, res) => {
    const data = exportEntries();
    res.setHeader('Content-Disposition', `attachment; filename="citadel-priority-queue-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  });

  // ─── Import from JSON array ───────────────────────────────
  app.post('/api/priority-queue/import', auth('priority.manage'), (req, res) => {
    try {
      if (!Array.isArray(req.body)) {
        return res.status(400).json({ error: 'Request body must be a JSON array' });
      }
      const result = importEntries(req.body, req.user.username);
      addAudit(req.user.id, req.user.username, 'priority.import',
        `Imported priority queue: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors`);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Priority queue import failed');
      res.status(500).json({ error: err.message || 'Import failed' });
    }
  });

  // ─── Manual cleanup of expired entries ────────────────────
  app.post('/api/priority-queue/cleanup', auth('priority.manage'), (req, res) => {
    const removed = cleanExpired();
    if (removed > 0) {
      addAudit(req.user.id, req.user.username, 'priority.cleanup',
        `Cleaned ${removed} expired priority queue entries`);
    }
    res.json({ removed, remaining: ctx.priorityQueue.length });
  });

  // ─── Get single entry by UUID ─────────────────────────────
  app.get('/api/priority-queue/:id', auth('priority.manage'), (req, res) => {
    const entry = getEntryById(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json(entry);
  });

  // ─── Add entry ────────────────────────────────────────────
  app.post('/api/priority-queue', auth('priority.manage'), (req, res) => {
    try {
      const { steamId, name, role, expiresAt } = req.body;
      if (!steamId) return res.status(400).json({ error: 'steamId is required' });

      const entry = addEntry({
        steamId,
        name: name || 'Unknown',
        role: role || 'VIP',
        expiresAt: expiresAt || null,
        addedBy: req.user.username,
        source: 'manual',
      });

      addAudit(req.user.id, req.user.username, 'priority.add',
        `Added ${entry.name} (${entry.steamId}) to priority queue as ${entry.role}` +
        (entry.expiresAt ? ` until ${entry.expiresAt}` : ' (permanent)'));

      res.json(entry);
    } catch (err) {
      logger.error({ err }, 'Failed to add priority queue entry');
      res.status(500).json({ error: err.message || 'Failed to add entry' });
    }
  });

  // ─── Update entry ─────────────────────────────────────────
  app.patch('/api/priority-queue/:id', auth('priority.manage'), (req, res) => {
    try {
      const { name, role, expiresAt } = req.body;
      const entry = updateEntry(req.params.id, { name, role, expiresAt });
      if (!entry) return res.status(404).json({ error: 'Entry not found' });

      addAudit(req.user.id, req.user.username, 'priority.update',
        `Updated priority entry for ${entry.name} (${entry.steamId})`);

      res.json(entry);
    } catch (err) {
      logger.error({ err }, 'Failed to update priority queue entry');
      res.status(500).json({ error: err.message || 'Failed to update entry' });
    }
  });

  // ─── Remove entry ─────────────────────────────────────────
  app.delete('/api/priority-queue/:id', auth('priority.manage'), (req, res) => {
    try {
      const entry = removeEntry(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Entry not found' });

      addAudit(req.user.id, req.user.username, 'priority.remove',
        `Removed ${entry.name} (${entry.steamId}) from priority queue`);

      res.json({ message: `Removed ${entry.name} from priority queue` });
    } catch (err) {
      logger.error({ err }, 'Failed to remove priority queue entry');
      res.status(500).json({ error: err.message || 'Failed to remove entry' });
    }
  });
};
