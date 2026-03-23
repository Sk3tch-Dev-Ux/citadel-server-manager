/**
 * Expansion Trader Editor Routes — CRUD API for Expansion Market system.
 *
 * Manages four file types across two directory trees:
 *   - Market categories:  profiles/ExpansionMod/Market/*.json
 *   - Trader configs:     profiles/ExpansionMod/Traders/*.json
 *   - Trader zones:       mpmissions/<mission>/expansion/traderzones/*.json
 *   - Trader spawns:      mpmissions/<mission>/expansion/traders/*.map
 *
 * GET    /api/servers/:id/trader-editor/categories              — List all market category files
 * GET    /api/servers/:id/trader-editor/categories/:fileName    — Get a single category file
 * PUT    /api/servers/:id/trader-editor/categories/:fileName    — Save a category file
 * POST   /api/servers/:id/trader-editor/categories              — Create a new category file
 * DELETE /api/servers/:id/trader-editor/categories/:fileName    — Delete a category file
 *
 * GET    /api/servers/:id/trader-editor/traders                 — List all trader config files
 * GET    /api/servers/:id/trader-editor/traders/:fileName       — Get a single trader config
 * PUT    /api/servers/:id/trader-editor/traders/:fileName       — Save a trader config
 * POST   /api/servers/:id/trader-editor/traders                 — Create new trader config
 * DELETE /api/servers/:id/trader-editor/traders/:fileName       — Delete trader config
 *
 * GET    /api/servers/:id/trader-editor/zones                   — List all trader zone files
 * PUT    /api/servers/:id/trader-editor/zones/:fileName         — Save a zone file
 * POST   /api/servers/:id/trader-editor/zones                   — Create new zone
 * DELETE /api/servers/:id/trader-editor/zones/:fileName         — Delete zone
 *
 * GET    /api/servers/:id/trader-editor/spawns                  — List all .map spawn files with parsed data
 * PUT    /api/servers/:id/trader-editor/spawns/:fileName        — Save a .map file
 */
const fs = require('fs');
const path = require('path');
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const { getMissionDir, createBackup } = require('../lib/mission-folder');

module.exports = function(app) {

    // ─── Path helpers ────────────────────────────────────────

    /**
     * Resolve the profiles-based ExpansionMod directory for a server.
     * Returns e.g. C:/DayZServer/profiles/ExpansionMod
     */
    function getExpansionProfileDir(srv) {
        const profileDir = srv.profileDir || 'profiles';
        return path.join(srv.installDir, profileDir, 'ExpansionMod');
    }

    /**
     * Get the Market categories directory: profiles/ExpansionMod/Market/
     */
    function getMarketDir(srv) {
        return path.join(getExpansionProfileDir(srv), 'Market');
    }

    /**
     * Get the Traders config directory: profiles/ExpansionMod/Traders/
     */
    function getTradersDir(srv) {
        return path.join(getExpansionProfileDir(srv), 'Traders');
    }

    /**
     * Get the trader zones directory: mpmissions/<mission>/expansion/traderzones/
     */
    function getZonesDir(srv) {
        const missionDir = getMissionDir(srv);
        if (!missionDir) return null;
        return path.join(missionDir, 'expansion', 'traderzones');
    }

    /**
     * Get the trader spawns directory: mpmissions/<mission>/expansion/traders/
     */
    function getSpawnsDir(srv) {
        const missionDir = getMissionDir(srv);
        if (!missionDir) return null;
        return path.join(missionDir, 'expansion', 'traders');
    }

    // ─── Shared helpers ──────────────────────────────────────

    function findServer(req, res) {
        const srv = ctx.servers.find(s => s.id === req.params.id);
        if (!srv) {
            res.status(404).json({ error: 'Server not found' });
            return null;
        }
        return srv;
    }

    /**
     * Sanitize a file name to prevent path traversal.
     * Strips directory separators and ensures it ends with the expected extension.
     */
    function sanitizeFileName(name, ext) {
        // Remove any path components
        let clean = path.basename(name);
        // Ensure correct extension
        if (ext && !clean.toLowerCase().endsWith(ext.toLowerCase())) {
            clean += ext;
        }
        return clean;
    }

    /**
     * List all JSON files in a directory and return their parsed contents.
     */
    function listJsonFiles(dir) {
        if (!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.json'));
        return entries.map(fileName => {
            const filePath = path.join(dir, fileName);
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                return { fileName, data: JSON.parse(raw) };
            } catch (err) {
                return { fileName, data: null, error: err.message };
            }
        });
    }

    /**
     * Read a single JSON file from a directory.
     */
    function readJsonFile(dir, fileName) {
        const filePath = path.join(dir, fileName);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    }

    /**
     * Write a JSON file to a directory, creating a backup first if the file exists.
     */
    function writeJsonFile(srv, dir, fileName, data) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, fileName);
        if (fs.existsSync(filePath)) {
            createBackup(srv.installDir, filePath, fileName);
        }
        const content = typeof data === 'string' ? data : JSON.stringify(data, null, 4);
        fs.writeFileSync(filePath, content, 'utf8');
    }

    /**
     * Delete a JSON file from a directory after creating a backup.
     */
    function deleteFile(srv, dir, fileName) {
        const filePath = path.join(dir, fileName);
        if (!fs.existsSync(filePath)) return false;
        createBackup(srv.installDir, filePath, fileName);
        fs.unlinkSync(filePath);
        return true;
    }

    // ─── .map file parsing ───────────────────────────────────

    /**
     * Parse an Expansion trader .map file.
     * Format: EntityClass.TraderFile|X Y Z|Yaw Pitch Roll|GearCSV
     * Lines starting with // or empty lines are skipped.
     */
    function parseMapFile(content) {
        const lines = content.split(/\r?\n/);
        const spawns = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//')) continue;

            const parts = line.split('|');
            if (parts.length < 3) {
                spawns.push({ raw: line, lineNumber: i + 1, parseError: 'Invalid format — expected at least 3 pipe-separated fields' });
                continue;
            }

            const entityParts = parts[0].trim().split('.');
            const positionParts = parts[1].trim().split(/\s+/).map(Number);
            const orientationParts = parts[2].trim().split(/\s+/).map(Number);
            const gear = parts[3] ? parts[3].trim().split(',').map(s => s.trim()).filter(Boolean) : [];

            spawns.push({
                lineNumber: i + 1,
                entityClass: entityParts[0] || '',
                traderFile: entityParts.slice(1).join('.') || '',
                position: positionParts.length === 3
                    ? { x: positionParts[0], y: positionParts[1], z: positionParts[2] }
                    : { x: 0, y: 0, z: 0 },
                orientation: orientationParts.length >= 1
                    ? { yaw: orientationParts[0] || 0, pitch: orientationParts[1] || 0, roll: orientationParts[2] || 0 }
                    : { yaw: 0, pitch: 0, roll: 0 },
                gear,
            });
        }

        return spawns;
    }

    /**
     * Serialize parsed spawn data back into .map file format.
     * Accepts either an array of spawn objects or a raw string.
     */
    function serializeMapFile(data) {
        if (typeof data === 'string') return data;
        if (!Array.isArray(data)) return '';

        return data.map(spawn => {
            if (spawn.raw) return spawn.raw;

            const entity = spawn.traderFile
                ? `${spawn.entityClass}.${spawn.traderFile}`
                : spawn.entityClass;
            const pos = spawn.position || { x: 0, y: 0, z: 0 };
            const ori = spawn.orientation || { yaw: 0, pitch: 0, roll: 0 };
            const gear = Array.isArray(spawn.gear) && spawn.gear.length > 0
                ? spawn.gear.join(',')
                : '';

            return `${entity}|${pos.x} ${pos.y} ${pos.z}|${ori.yaw} ${ori.pitch} ${ori.roll}|${gear}`;
        }).join('\n');
    }

    // ═══════════════════════════════════════════════════════════
    //  MARKET CATEGORIES — profiles/ExpansionMod/Market/*.json
    // ═══════════════════════════════════════════════════════════

    /**
     * List all market category files with their data.
     */
    app.get('/api/servers/:id/trader-editor/categories', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getMarketDir(srv);
            const categories = listJsonFiles(dir);
            res.json(categories);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list market categories');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Get a single market category file.
     */
    app.get('/api/servers/:id/trader-editor/categories/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getMarketDir(srv);
            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const data = readJsonFile(dir, fileName);
            if (data === null) return res.status(404).json({ error: `Category file not found: ${fileName}` });
            res.json({ fileName, data });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to read market category');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Save (overwrite) a market category file.
     */
    app.put('/api/servers/:id/trader-editor/categories/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getMarketDir(srv);
            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const filePath = path.join(dir, fileName);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Category file not found: ${fileName}` });

            const { data } = req.body;
            if (data === undefined) return res.status(400).json({ error: 'data is required in request body' });

            writeJsonFile(srv, dir, fileName, data);

            addAudit(req.user.id, req.user.username, 'trader.category.save',
                `Saved market category ${fileName} on ${srv.name}`);

            res.json({ success: true, fileName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to save market category');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Create a new market category file.
     */
    app.post('/api/servers/:id/trader-editor/categories', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const { fileName, data } = req.body;
            if (!fileName) return res.status(400).json({ error: 'fileName is required' });
            if (data === undefined) return res.status(400).json({ error: 'data is required' });

            const dir = getMarketDir(srv);
            const cleanName = sanitizeFileName(fileName, '.json');
            const filePath = path.join(dir, cleanName);

            if (fs.existsSync(filePath)) {
                return res.status(409).json({ error: `Category file already exists: ${cleanName}` });
            }

            writeJsonFile(srv, dir, cleanName, data);

            addAudit(req.user.id, req.user.username, 'trader.category.create',
                `Created market category ${cleanName} on ${srv.name}`);

            res.status(201).json({ success: true, fileName: cleanName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create market category');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Delete a market category file.
     */
    app.delete('/api/servers/:id/trader-editor/categories/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getMarketDir(srv);
            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const deleted = deleteFile(srv, dir, fileName);
            if (!deleted) return res.status(404).json({ error: `Category file not found: ${fileName}` });

            addAudit(req.user.id, req.user.username, 'trader.category.delete',
                `Deleted market category ${fileName} on ${srv.name}`);

            res.json({ success: true });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to delete market category');
            res.status(500).json({ error: err.message });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  TRADER CONFIGS — profiles/ExpansionMod/Traders/*.json
    // ═══════════════════════════════════════════════════════════

    /**
     * List all trader config files.
     */
    app.get('/api/servers/:id/trader-editor/traders', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getTradersDir(srv);
            const traders = listJsonFiles(dir);
            res.json(traders);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list trader configs');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Get a single trader config file.
     */
    app.get('/api/servers/:id/trader-editor/traders/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getTradersDir(srv);
            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const data = readJsonFile(dir, fileName);
            if (data === null) return res.status(404).json({ error: `Trader config not found: ${fileName}` });
            res.json({ fileName, data });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to read trader config');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Save a trader config file.
     */
    app.put('/api/servers/:id/trader-editor/traders/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getTradersDir(srv);
            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const filePath = path.join(dir, fileName);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Trader config not found: ${fileName}` });

            const { data } = req.body;
            if (data === undefined) return res.status(400).json({ error: 'data is required in request body' });

            writeJsonFile(srv, dir, fileName, data);

            addAudit(req.user.id, req.user.username, 'trader.config.save',
                `Saved trader config ${fileName} on ${srv.name}`);

            res.json({ success: true, fileName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to save trader config');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Create a new trader config file.
     */
    app.post('/api/servers/:id/trader-editor/traders', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const { fileName, data } = req.body;
            if (!fileName) return res.status(400).json({ error: 'fileName is required' });
            if (data === undefined) return res.status(400).json({ error: 'data is required' });

            const dir = getTradersDir(srv);
            const cleanName = sanitizeFileName(fileName, '.json');
            const filePath = path.join(dir, cleanName);

            if (fs.existsSync(filePath)) {
                return res.status(409).json({ error: `Trader config already exists: ${cleanName}` });
            }

            writeJsonFile(srv, dir, cleanName, data);

            addAudit(req.user.id, req.user.username, 'trader.config.create',
                `Created trader config ${cleanName} on ${srv.name}`);

            res.status(201).json({ success: true, fileName: cleanName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create trader config');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Delete a trader config file.
     */
    app.delete('/api/servers/:id/trader-editor/traders/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getTradersDir(srv);
            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const deleted = deleteFile(srv, dir, fileName);
            if (!deleted) return res.status(404).json({ error: `Trader config not found: ${fileName}` });

            addAudit(req.user.id, req.user.username, 'trader.config.delete',
                `Deleted trader config ${fileName} on ${srv.name}`);

            res.json({ success: true });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to delete trader config');
            res.status(500).json({ error: err.message });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  TRADER ZONES — mpmissions/<mission>/expansion/traderzones/*.json
    // ═══════════════════════════════════════════════════════════

    /**
     * List all trader zone files.
     */
    app.get('/api/servers/:id/trader-editor/zones', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getZonesDir(srv);
            if (!dir) return res.status(404).json({ error: 'Mission folder not found — cannot locate trader zones' });
            const zones = listJsonFiles(dir);
            res.json(zones);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list trader zones');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Save a trader zone file.
     */
    app.put('/api/servers/:id/trader-editor/zones/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getZonesDir(srv);
            if (!dir) return res.status(404).json({ error: 'Mission folder not found — cannot locate trader zones' });

            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const filePath = path.join(dir, fileName);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Zone file not found: ${fileName}` });

            const { data } = req.body;
            if (data === undefined) return res.status(400).json({ error: 'data is required in request body' });

            writeJsonFile(srv, dir, fileName, data);

            addAudit(req.user.id, req.user.username, 'trader.zone.save',
                `Saved trader zone ${fileName} on ${srv.name}`);

            res.json({ success: true, fileName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to save trader zone');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Create a new trader zone file.
     */
    app.post('/api/servers/:id/trader-editor/zones', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const { fileName, data } = req.body;
            if (!fileName) return res.status(400).json({ error: 'fileName is required' });
            if (data === undefined) return res.status(400).json({ error: 'data is required' });

            const dir = getZonesDir(srv);
            if (!dir) return res.status(404).json({ error: 'Mission folder not found — cannot locate trader zones' });

            const cleanName = sanitizeFileName(fileName, '.json');
            const filePath = path.join(dir, cleanName);

            if (fs.existsSync(filePath)) {
                return res.status(409).json({ error: `Zone file already exists: ${cleanName}` });
            }

            writeJsonFile(srv, dir, cleanName, data);

            addAudit(req.user.id, req.user.username, 'trader.zone.create',
                `Created trader zone ${cleanName} on ${srv.name}`);

            res.status(201).json({ success: true, fileName: cleanName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create trader zone');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Delete a trader zone file.
     */
    app.delete('/api/servers/:id/trader-editor/zones/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getZonesDir(srv);
            if (!dir) return res.status(404).json({ error: 'Mission folder not found — cannot locate trader zones' });

            const fileName = sanitizeFileName(req.params.fileName, '.json');
            const deleted = deleteFile(srv, dir, fileName);
            if (!deleted) return res.status(404).json({ error: `Zone file not found: ${fileName}` });

            addAudit(req.user.id, req.user.username, 'trader.zone.delete',
                `Deleted trader zone ${fileName} on ${srv.name}`);

            res.json({ success: true });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to delete trader zone');
            res.status(500).json({ error: err.message });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  TRADER SPAWNS — mpmissions/<mission>/expansion/traders/*.map
    // ═══════════════════════════════════════════════════════════

    /**
     * List all .map spawn files with parsed data.
     */
    app.get('/api/servers/:id/trader-editor/spawns', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getSpawnsDir(srv);
            if (!dir) return res.status(404).json({ error: 'Mission folder not found — cannot locate trader spawns' });
            if (!fs.existsSync(dir)) return res.json([]);

            const entries = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.map'));
            const result = entries.map(fileName => {
                const filePath = path.join(dir, fileName);
                try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const spawns = parseMapFile(raw);
                    return { fileName, spawns, raw };
                } catch (err) {
                    return { fileName, spawns: [], raw: '', error: err.message };
                }
            });

            res.json(result);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list trader spawns');
            res.status(500).json({ error: err.message });
        }
    });

    /**
     * Save a .map spawn file.
     * Body can contain either { raw: "..." } for raw text or { spawns: [...] } for structured data.
     */
    app.put('/api/servers/:id/trader-editor/spawns/:fileName', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const dir = getSpawnsDir(srv);
            if (!dir) return res.status(404).json({ error: 'Mission folder not found — cannot locate trader spawns' });

            const fileName = sanitizeFileName(req.params.fileName, '.map');
            const filePath = path.join(dir, fileName);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Spawn file not found: ${fileName}` });

            const { raw, spawns } = req.body;
            let content;
            if (raw !== undefined) {
                content = raw;
            } else if (spawns !== undefined) {
                content = serializeMapFile(spawns);
            } else {
                return res.status(400).json({ error: 'Either raw or spawns is required in request body' });
            }

            // Backup before writing
            createBackup(srv.installDir, filePath, fileName);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');

            addAudit(req.user.id, req.user.username, 'trader.spawn.save',
                `Saved trader spawn file ${fileName} on ${srv.name}`);

            res.json({ success: true, fileName });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to save trader spawn file');
            res.status(500).json({ error: err.message });
        }
    });
};
