/**
 * Events Editor routes — CRUD for events.xml and cfgeventspawns.xml editing.
 *
 * events.xml (db/):
 * GET    /api/servers/:id/events                                — read & parse all events
 * PUT    /api/servers/:id/events                                — save all events back to file
 * POST   /api/servers/:id/events/add                            — add a new event
 * DELETE /api/servers/:id/events/item                           — delete an event by name
 *
 * cfgeventspawns.xml (mission root):
 * GET    /api/servers/:id/events/spawns                         — read & parse all spawn positions
 * PUT    /api/servers/:id/events/spawns                         — save full cfgeventspawns.xml
 * PUT    /api/servers/:id/events/spawns/:eventName              — update positions for one event
 * POST   /api/servers/:id/events/spawns/:eventName/positions    — add a position to an event
 * DELETE /api/servers/:id/events/spawns/:eventName/positions/:index — delete a position
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');
const { parseEventsXml, buildEventsXml } = require('../lib/events-xml-parser');
const { parseCfgEventSpawns, buildCfgEventSpawns } = require('../lib/cfgeventspawns-parser');

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Resolve events.xml path inside the mission folder's db/ directory.
 */
function getEventsPath(missionDir) {
  const eventsPath = path.join(missionDir, 'db', 'events.xml');
  return fs.existsSync(eventsPath) ? eventsPath : null;
}

/**
 * Resolve cfgeventspawns.xml path at the mission root.
 */
function getSpawnsPath(missionDir) {
  const spawnsPath = path.join(missionDir, 'cfgeventspawns.xml');
  return fs.existsSync(spawnsPath) ? spawnsPath : null;
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

  // ─── cfgeventspawns.xml Routes ──────────────────────────────

  // Load all event spawn positions from cfgeventspawns.xml
  app.get('/api/servers/:id/events/spawns', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    logger.info({ serverId: srv.id, installDir: srv.installDir, missionDir }, 'Resolving spawns path');
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const spawnsPath = getSpawnsPath(missionDir);
    if (!spawnsPath) return res.status(404).json({ error: 'cfgeventspawns.xml not found' });

    try {
      const content = fs.readFileSync(spawnsPath, 'utf8');
      const data = parseCfgEventSpawns(content);
      res.json(data);
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to parse cfgeventspawns.xml');
      res.status(500).json({ error: err.message });
    }
  });

  // Save full cfgeventspawns.xml
  app.put('/api/servers/:id/events/spawns', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const spawnsPath = getSpawnsPath(missionDir);
    if (!spawnsPath) return res.status(404).json({ error: 'cfgeventspawns.xml not found' });

    const { events } = req.body;
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Events array is required' });
    }

    try {
      createBackup(srv.installDir, spawnsPath, 'cfgeventspawns.xml');

      const newXml = buildCfgEventSpawns({ events });
      fs.writeFileSync(spawnsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'eventspawns.save',
        `Saved ${events.length} event spawn definitions on ${srv.name}`);

      res.json({ success: true, eventCount: events.length });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to save cfgeventspawns.xml');
      res.status(500).json({ error: err.message });
    }
  });

  // Update spawn positions for a single event
  app.put('/api/servers/:id/events/spawns/:eventName', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const spawnsPath = getSpawnsPath(missionDir);
    if (!spawnsPath) return res.status(404).json({ error: 'cfgeventspawns.xml not found' });

    const { eventName } = req.params;
    const { positions } = req.body;
    if (!positions || !Array.isArray(positions)) {
      return res.status(400).json({ error: 'Positions array is required' });
    }

    try {
      const content = fs.readFileSync(spawnsPath, 'utf8');
      const data = parseCfgEventSpawns(content);

      const eventEntry = data.events.find(e => e.name === eventName);
      if (!eventEntry) {
        return res.status(404).json({ error: `Event "${eventName}" not found in cfgeventspawns.xml` });
      }

      eventEntry.positions = positions;

      createBackup(srv.installDir, spawnsPath, 'cfgeventspawns.xml');
      const newXml = buildCfgEventSpawns(data);
      fs.writeFileSync(spawnsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'eventspawns.update',
        `Updated ${positions.length} spawn positions for "${eventName}" on ${srv.name}`);

      res.json({ success: true, event: eventEntry });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to update event spawns');
      res.status(500).json({ error: err.message });
    }
  });

  // Add a new position to an event
  app.post('/api/servers/:id/events/spawns/:eventName/positions', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const spawnsPath = getSpawnsPath(missionDir);
    if (!spawnsPath) return res.status(404).json({ error: 'cfgeventspawns.xml not found' });

    const { eventName } = req.params;
    const { position } = req.body;
    if (!position || position.x == null || position.z == null) {
      return res.status(400).json({ error: 'Position with x and z coordinates is required' });
    }

    try {
      const content = fs.readFileSync(spawnsPath, 'utf8');
      const data = parseCfgEventSpawns(content);

      const eventEntry = data.events.find(e => e.name === eventName);
      if (!eventEntry) {
        return res.status(404).json({ error: `Event "${eventName}" not found in cfgeventspawns.xml` });
      }

      // Normalize position with defaults
      const newPos = {
        x: parseFloat(position.x),
        z: parseFloat(position.z),
        a: position.a != null ? parseFloat(position.a) : 0.0,
        y: position.y != null ? parseFloat(position.y) : null,
        group: position.group || null,
        zone: position.zone || null,
      };

      eventEntry.positions.push(newPos);

      createBackup(srv.installDir, spawnsPath, 'cfgeventspawns.xml');
      const newXml = buildCfgEventSpawns(data);
      fs.writeFileSync(spawnsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'eventspawns.addpos',
        `Added spawn position to "${eventName}" on ${srv.name}`);

      res.json({ success: true, event: eventEntry, index: eventEntry.positions.length - 1 });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to add spawn position');
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a position from an event by index
  app.delete('/api/servers/:id/events/spawns/:eventName/positions/:index', authForServer('files.edit'), (req, res) => {
    const srv = ctx.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found' });
    const missionDir = getMissionDir(srv);
    if (!missionDir) return res.status(404).json({ error: 'Mission folder not found' });

    const spawnsPath = getSpawnsPath(missionDir);
    if (!spawnsPath) return res.status(404).json({ error: 'cfgeventspawns.xml not found' });

    const { eventName } = req.params;
    const index = parseInt(req.params.index, 10);

    try {
      const content = fs.readFileSync(spawnsPath, 'utf8');
      const data = parseCfgEventSpawns(content);

      const eventEntry = data.events.find(e => e.name === eventName);
      if (!eventEntry) {
        return res.status(404).json({ error: `Event "${eventName}" not found in cfgeventspawns.xml` });
      }

      if (index < 0 || index >= eventEntry.positions.length) {
        return res.status(400).json({ error: `Position index ${index} out of range (0-${eventEntry.positions.length - 1})` });
      }

      eventEntry.positions.splice(index, 1);

      createBackup(srv.installDir, spawnsPath, 'cfgeventspawns.xml');
      const newXml = buildCfgEventSpawns(data);
      fs.writeFileSync(spawnsPath, newXml, 'utf8');

      addAudit(req.user.id, req.user.username, 'eventspawns.delpos',
        `Deleted spawn position ${index} from "${eventName}" on ${srv.name}`);

      res.json({ success: true, event: eventEntry });
    } catch (err) {
      logger.error({ err, serverId: srv.id }, 'Failed to delete spawn position');
      res.status(500).json({ error: err.message });
    }
  });
};
