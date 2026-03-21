/**
 * Events Editor routes — CRUD for events.xml editing.
 *
 * GET    /api/servers/:id/events          — read & parse all events
 * PUT    /api/servers/:id/events          — save all events back to file
 * POST   /api/servers/:id/events/add      — add a new event
 * DELETE /api/servers/:id/events/item     — delete an event by name
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseEventsXml, buildEventsXml } = require('../lib/events-xml-parser');

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Resolve events.xml path inside the mission folder's db/ directory.
 */
function getEventsPath(missionDir) {
  const eventsPath = path.join(missionDir, 'db', 'events.xml');
  return fs.existsSync(eventsPath) ? eventsPath : null;
}

// ─── Routes ─────────────────────────────────────────────────

module.exports = function(app) {

  // Load all events from db/events.xml
  app.get('/api/servers/:id/events', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const eventsPath = getEventsPath(missionDir);
    if (!eventsPath) return res.status(404).json({ error: 'events.xml not found in db/' });

    try {
      const content = fs.readFileSync(eventsPath, 'utf8');
      const events = parseEventsXml(content);
      res.json({ events });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to parse events.xml');
      res.status(500).json({ error: err.message });
    }
  });

  // Save all events back to db/events.xml
  app.put('/api/servers/:id/events', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const eventsPath = getEventsPath(missionDir);
    if (!eventsPath) return res.status(404).json({ error: 'events.xml not found in db/' });

    const { events } = req.body;
    if (!events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'No events provided' });
    }

    try {
      // Create backup before writing
      createBackup(srv.installDir, eventsPath, 'events.xml');

      const newXml = buildEventsXml(events);
      fs.writeFileSync(eventsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'events.save',
        `Saved ${events.length} events on ${srv.name}`);

      res.json({ success: true, eventCount: events.length });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save events.xml');
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new event
  app.post('/api/servers/:id/events/add', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const eventsPath = getEventsPath(missionDir);
    if (!eventsPath) return res.status(404).json({ error: 'events.xml not found in db/' });

    const { event } = req.body;
    if (!event || !event.name) {
      return res.status(400).json({ error: 'Event with name is required' });
    }

    try {
      const content = fs.readFileSync(eventsPath, 'utf8');
      const existing = parseEventsXml(content);

      // Check for duplicate name
      if (existing.some(e => e.name === event.name)) {
        return res.status(409).json({ error: `Event "${event.name}" already exists` });
      }

      existing.push(event);

      // Backup and write
      createBackup(srv.installDir, eventsPath, 'events.xml');
      const newXml = buildEventsXml(existing);
      fs.writeFileSync(eventsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'events.add',
        `Added event "${event.name}" on ${srv.name}`);

      res.json({ success: true, event });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to add event');
      res.status(500).json({ error: err.message });
    }
  });

  // Delete an event by name
  app.delete('/api/servers/:id/events/item', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const eventsPath = getEventsPath(missionDir);
    if (!eventsPath) return res.status(404).json({ error: 'events.xml not found in db/' });

    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Event name is required' });
    }

    try {
      const content = fs.readFileSync(eventsPath, 'utf8');
      const events = parseEventsXml(content);
      const filtered = events.filter(e => e.name !== name);

      if (filtered.length === events.length) {
        return res.status(404).json({ error: `Event "${name}" not found` });
      }

      // Backup and write
      createBackup(srv.installDir, eventsPath, 'events.xml');
      const newXml = buildEventsXml(filtered);
      fs.writeFileSync(eventsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'events.delete',
        `Deleted event "${name}" on ${srv.name}`);

      res.json({ success: true });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to delete event');
      res.status(500).json({ error: err.message });
    }
  });
};
