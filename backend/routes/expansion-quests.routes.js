const { safeError } = require('../lib/http-errors');
/**
 * Expansion Quest Routes — CRUD API for Expansion Mod quests, NPCs, and objectives.
 *
 * GET    /api/servers/:id/expansion/quests                    — List all quests (summary)
 * GET    /api/servers/:id/expansion/quests/:questId           — Get full quest JSON
 * POST   /api/servers/:id/expansion/quests                    — Create quest
 * PUT    /api/servers/:id/expansion/quests/:questId           — Update quest
 * DELETE /api/servers/:id/expansion/quests/:questId           — Delete quest
 *
 * GET    /api/servers/:id/expansion/npcs                      — List all NPCs (summary)
 * GET    /api/servers/:id/expansion/npcs/:npcId               — Get full NPC JSON
 * POST   /api/servers/:id/expansion/npcs                      — Create NPC
 * PUT    /api/servers/:id/expansion/npcs/:npcId               — Update NPC
 * DELETE /api/servers/:id/expansion/npcs/:npcId               — Delete NPC
 *
 * GET    /api/servers/:id/expansion/objectives                — List all objectives grouped by type
 * GET    /api/servers/:id/expansion/objectives/:objType/:objId — Get specific objective
 * POST   /api/servers/:id/expansion/objectives                — Create objective
 * PUT    /api/servers/:id/expansion/objectives/:objType/:objId — Update objective
 * DELETE /api/servers/:id/expansion/objectives/:objType/:objId — Delete objective
 *
 * GET    /api/servers/:id/expansion/quest-chain               — Quest chain data for visual builder
 */
const ctx = require('../lib/context');
const { addAudit } = require('../lib/audit');
const { authForServer } = require('../middleware/auth');
const logger = require('../lib/logger');
const qm = require('../lib/expansion-quest-manager');

module.exports = function(app) {

    // ─── Helper: resolve server from params ──────────────────
    function findServer(req, res) {
        const srv = ctx.servers.find(s => s.id === req.params.id);
        if (!srv) {
            res.status(404).json({ error: 'Server not found' });
            return null;
        }
        return srv;
    }

    // ═══════════════════════════════════════════════════════════
    //  QUESTS
    // ═══════════════════════════════════════════════════════════

    /**
     * List all quests — returns summary fields only.
     */
    app.get('/api/servers/:id/expansion/quests', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const quests = qm.listQuests(srv);
            const summary = quests.map(q => ({
                ID: q.ID,
                Title: q.Title || '',
                Type: q.Type ?? 0,
                Active: q.Active ?? 1,
                Repeatable: q.Repeatable ?? 0,
                IsDailyQuest: q.IsDailyQuest ?? 0,
                IsWeeklyQuest: q.IsWeeklyQuest ?? 0,
                FollowUpQuest: q.FollowUpQuest ?? -1,
                ObjectiveCount: Array.isArray(q.Objectives) ? q.Objectives.length : 0,
                QuestGiverIDs: q.QuestGiverIDs || [],
            }));
            res.json(summary);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list quests');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Get full quest JSON by ID.
     */
    app.get('/api/servers/:id/expansion/quests/:questId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const questId = parseInt(req.params.questId, 10);
            const quest = qm.getQuest(srv, questId);
            if (!quest) return res.status(404).json({ error: 'Quest not found' });
            res.json(quest);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to get quest');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Create a new quest. Auto-assigns ID if not provided.
     */
    app.post('/api/servers/:id/expansion/quests', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const quest = req.body;
            if (!quest.ID) {
                quest.ID = qm.getNextQuestId(srv);
            }
            qm.saveQuest(srv, quest);

            addAudit(req.user.id, req.user.username, 'expansion.quest.create',
                `Created quest ${quest.ID} "${quest.Title || ''}" on ${srv.name}`);

            res.status(201).json(quest);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create quest');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Update an existing quest.
     */
    app.put('/api/servers/:id/expansion/quests/:questId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const questId = parseInt(req.params.questId, 10);
            const existing = qm.getQuest(srv, questId);
            if (!existing) return res.status(404).json({ error: 'Quest not found' });

            const quest = { ...req.body, ID: questId };
            qm.saveQuest(srv, quest);

            addAudit(req.user.id, req.user.username, 'expansion.quest.update',
                `Updated quest ${questId} "${quest.Title || ''}" on ${srv.name}`);

            res.json(quest);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to update quest');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Delete a quest.
     */
    app.delete('/api/servers/:id/expansion/quests/:questId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const questId = parseInt(req.params.questId, 10);
            const deleted = qm.deleteQuest(srv, questId);
            if (!deleted) return res.status(404).json({ error: 'Quest not found' });

            addAudit(req.user.id, req.user.username, 'expansion.quest.delete',
                `Deleted quest ${questId} on ${srv.name}`);

            res.json({ success: true });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to delete quest');
            safeError(err, req, res, { status: 500 });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  NPCs
    // ═══════════════════════════════════════════════════════════

    /**
     * List all NPCs — returns summary fields only.
     */
    app.get('/api/servers/:id/expansion/npcs', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const npcs = qm.listNPCs(srv);
            const summary = npcs.map(n => ({
                ID: n.ID,
                NPCName: n.NPCName || '',
                ClassName: n.ClassName || '',
                Position: n.Position || [0, 0, 0],
                IsActive: n.IsActive !== undefined ? n.IsActive : true,
            }));
            res.json(summary);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list NPCs');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Get full NPC JSON by ID.
     */
    app.get('/api/servers/:id/expansion/npcs/:npcId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const npcId = parseInt(req.params.npcId, 10);
            const npc = qm.getNPC(srv, npcId);
            if (!npc) return res.status(404).json({ error: 'NPC not found' });
            res.json(npc);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to get NPC');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Create a new NPC. Auto-assigns ID if not provided.
     */
    app.post('/api/servers/:id/expansion/npcs', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const npc = req.body;
            if (!npc.ID) {
                npc.ID = qm.getNextNPCId(srv);
            }
            qm.saveNPC(srv, npc);

            addAudit(req.user.id, req.user.username, 'expansion.npc.create',
                `Created NPC ${npc.ID} "${npc.NPCName || ''}" on ${srv.name}`);

            res.status(201).json(npc);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create NPC');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Update an existing NPC.
     */
    app.put('/api/servers/:id/expansion/npcs/:npcId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const npcId = parseInt(req.params.npcId, 10);
            const existing = qm.getNPC(srv, npcId);
            if (!existing) return res.status(404).json({ error: 'NPC not found' });

            const npc = { ...req.body, ID: npcId };
            qm.saveNPC(srv, npc);

            addAudit(req.user.id, req.user.username, 'expansion.npc.update',
                `Updated NPC ${npcId} "${npc.NPCName || ''}" on ${srv.name}`);

            res.json(npc);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to update NPC');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Delete an NPC.
     */
    app.delete('/api/servers/:id/expansion/npcs/:npcId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const npcId = parseInt(req.params.npcId, 10);
            const deleted = qm.deleteNPC(srv, npcId);
            if (!deleted) return res.status(404).json({ error: 'NPC not found' });

            addAudit(req.user.id, req.user.username, 'expansion.npc.delete',
                `Deleted NPC ${npcId} on ${srv.name}`);

            res.json({ success: true });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to delete NPC');
            safeError(err, req, res, { status: 500 });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  OBJECTIVES
    // ═══════════════════════════════════════════════════════════

    /**
     * List all objectives grouped by type.
     */
    app.get('/api/servers/:id/expansion/objectives', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const objectives = qm.listObjectives(srv);

            // Group by type
            const grouped = {};
            for (const [typeStr, typeInfo] of Object.entries(qm.OBJECTIVE_TYPES)) {
                grouped[typeStr] = {
                    folder: typeInfo.folder,
                    prefix: typeInfo.prefix,
                    objectives: [],
                };
            }
            for (const obj of objectives) {
                const typeKey = String(obj._objType);
                if (grouped[typeKey]) {
                    // Strip internal metadata from response
                    const { _objType, _folder, _prefix, ...cleanObj } = obj;
                    grouped[typeKey].objectives.push(cleanObj);
                }
            }

            res.json(grouped);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to list objectives');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Get a specific objective by type and ID.
     */
    app.get('/api/servers/:id/expansion/objectives/:objType/:objId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const objType = parseInt(req.params.objType, 10);
            const objId = parseInt(req.params.objId, 10);

            if (!qm.OBJECTIVE_TYPES[objType]) {
                return res.status(400).json({ error: `Invalid objective type: ${objType}` });
            }

            const objective = qm.getObjective(srv, objId, objType);
            if (!objective) return res.status(404).json({ error: 'Objective not found' });
            res.json(objective);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to get objective');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Create a new objective. Body must include ObjectiveType. Auto-assigns ID if not provided.
     */
    app.post('/api/servers/:id/expansion/objectives', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const objective = req.body;
            if (!objective.ObjectiveType) {
                return res.status(400).json({ error: 'ObjectiveType is required' });
            }

            const objType = parseInt(objective.ObjectiveType, 10);
            if (!qm.OBJECTIVE_TYPES[objType]) {
                return res.status(400).json({ error: `Invalid objective type: ${objType}` });
            }

            if (!objective.ID) {
                objective.ID = qm.getNextObjectiveId(srv, objType);
            }
            qm.saveObjective(srv, objective);

            const typeInfo = qm.OBJECTIVE_TYPES[objType];
            addAudit(req.user.id, req.user.username, 'expansion.objective.create',
                `Created ${typeInfo.folder} objective ${objective.ID} on ${srv.name}`);

            res.status(201).json(objective);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create objective');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Update an existing objective.
     */
    app.put('/api/servers/:id/expansion/objectives/:objType/:objId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const objType = parseInt(req.params.objType, 10);
            const objId = parseInt(req.params.objId, 10);

            if (!qm.OBJECTIVE_TYPES[objType]) {
                return res.status(400).json({ error: `Invalid objective type: ${objType}` });
            }

            const existing = qm.getObjective(srv, objId, objType);
            if (!existing) return res.status(404).json({ error: 'Objective not found' });

            const objective = { ...req.body, ID: objId, ObjectiveType: objType };
            qm.saveObjective(srv, objective);

            const typeInfo = qm.OBJECTIVE_TYPES[objType];
            addAudit(req.user.id, req.user.username, 'expansion.objective.update',
                `Updated ${typeInfo.folder} objective ${objId} on ${srv.name}`);

            res.json(objective);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to update objective');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Delete an objective.
     */
    app.delete('/api/servers/:id/expansion/objectives/:objType/:objId', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const objType = parseInt(req.params.objType, 10);
            const objId = parseInt(req.params.objId, 10);

            if (!qm.OBJECTIVE_TYPES[objType]) {
                return res.status(400).json({ error: `Invalid objective type: ${objType}` });
            }

            const deleted = qm.deleteObjective(srv, objId, objType);
            if (!deleted) return res.status(404).json({ error: 'Objective not found' });

            const typeInfo = qm.OBJECTIVE_TYPES[objType];
            addAudit(req.user.id, req.user.username, 'expansion.objective.delete',
                `Deleted ${typeInfo.folder} objective ${objId} on ${srv.name}`);

            res.json({ success: true });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to delete objective');
            safeError(err, req, res, { status: 500 });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  QUEST CHAIN
    // ═══════════════════════════════════════════════════════════

    /**
     * Returns all quests with FollowUpQuest and PreQuestIDs resolved
     * for the visual quest chain builder.
     */
    app.get('/api/servers/:id/expansion/quest-chain', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const quests = qm.listQuests(srv);

            // Build a lookup map by quest ID
            const questMap = {};
            for (const q of quests) {
                questMap[q.ID] = q;
            }

            // Build chain data: each quest with its connections
            const chain = quests.map(q => {
                const followUp = q.FollowUpQuest && q.FollowUpQuest > 0
                    ? { ID: q.FollowUpQuest, Title: questMap[q.FollowUpQuest]?.Title || 'Unknown' }
                    : null;

                const preQuests = Array.isArray(q.PreQuestIDs)
                    ? q.PreQuestIDs.map(id => ({
                        ID: id,
                        Title: questMap[id]?.Title || 'Unknown',
                    }))
                    : [];

                return {
                    ID: q.ID,
                    Title: q.Title || '',
                    Type: q.Type,
                    IsActive: q.IsActive !== undefined ? q.IsActive : true,
                    FollowUpQuest: followUp,
                    PreQuests: preQuests,
                    ObjectiveCount: Array.isArray(q.ObjectiveConfigs) ? q.ObjectiveConfigs.length : 0,
                };
            });

            res.json(chain);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to build quest chain');
            safeError(err, req, res, { status: 500 });
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  QUEST WITH RESOLVED OBJECTIVES (for quest builder)
    // ═══════════════════════════════════════════════════════════

    /**
     * Get a quest with all its objectives resolved inline.
     * Looks up ObjectiveFiles and attaches the full objective JSON for each.
     */
    app.get('/api/servers/:id/expansion/quests/:questId/full', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const questId = parseInt(req.params.questId, 10);
            const quest = qm.getQuest(srv, questId);
            if (!quest) return res.status(404).json({ error: 'Quest not found' });

            // Resolve objectives by scanning all objective folders for matching file names
            const allObjectives = qm.listObjectives(srv);
            const resolvedObjectives = [];

            if (Array.isArray(quest.ObjectiveFiles)) {
                for (const fileName of quest.ObjectiveFiles) {
                    const found = allObjectives.find(o => {
                        const typeInfo = qm.OBJECTIVE_TYPES[o._objType];
                        if (!typeInfo) return false;
                        const expectedName = `${typeInfo.prefix}_${o.ID}`;
                        return expectedName === fileName || o.FileName === fileName;
                    });
                    if (found) {
                        const { _objType, _folder, _prefix, ...cleanObj } = found;
                        resolvedObjectives.push({ ...cleanObj, _fileName: fileName, _objType });
                    } else {
                        resolvedObjectives.push({ _fileName: fileName, _missing: true });
                    }
                }
            }

            res.json({ ...quest, _resolvedObjectives: resolvedObjectives });
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to get full quest');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Save a quest along with its objectives in one operation.
     * Body: { quest: {...}, objectives: [{...}, ...] }
     * Creates/updates objectives, then saves the quest with ObjectiveFiles populated.
     */
    app.put('/api/servers/:id/expansion/quests/:questId/full', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const questId = parseInt(req.params.questId, 10);
            const { quest, objectives } = req.body;
            if (!quest) return res.status(400).json({ error: 'quest object is required' });

            // Save each objective and collect file names
            const objectiveFiles = [];
            if (Array.isArray(objectives)) {
                for (const obj of objectives) {
                    if (!obj.ObjectiveType) continue;
                    const objType = parseInt(obj.ObjectiveType, 10);
                    const typeInfo = qm.OBJECTIVE_TYPES[objType];
                    if (!typeInfo) continue;

                    if (!obj.ID) {
                        obj.ID = qm.getNextObjectiveId(srv, objType);
                    }
                    qm.saveObjective(srv, obj);
                    objectiveFiles.push(`${typeInfo.prefix}_${obj.ID}`);
                }
            }

            // Save the quest with updated ObjectiveFiles
            const finalQuest = { ...quest, ID: questId, ObjectiveFiles: objectiveFiles };
            qm.saveQuest(srv, finalQuest);

            addAudit(req.user.id, req.user.username, 'expansion.quest.update',
                `Updated quest ${questId} with ${objectiveFiles.length} objectives on ${srv.name}`);

            res.json(finalQuest);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to save full quest');
            safeError(err, req, res, { status: 500 });
        }
    });

    /**
     * Create a quest along with its objectives in one operation.
     * Body: { quest: {...}, objectives: [{...}, ...] }
     */
    app.post('/api/servers/:id/expansion/quests/full', authForServer('files.edit'), (req, res) => {
        const srv = findServer(req, res);
        if (!srv) return;

        try {
            const { quest, objectives } = req.body;
            if (!quest) return res.status(400).json({ error: 'quest object is required' });

            if (!quest.ID) {
                quest.ID = qm.getNextQuestId(srv);
            }

            // Save each objective and collect file names
            const objectiveFiles = [];
            if (Array.isArray(objectives)) {
                for (const obj of objectives) {
                    if (!obj.ObjectiveType) continue;
                    const objType = parseInt(obj.ObjectiveType, 10);
                    const typeInfo = qm.OBJECTIVE_TYPES[objType];
                    if (!typeInfo) continue;

                    if (!obj.ID) {
                        obj.ID = qm.getNextObjectiveId(srv, objType);
                    }
                    qm.saveObjective(srv, obj);
                    objectiveFiles.push(`${typeInfo.prefix}_${obj.ID}`);
                }
            }

            // Save the quest
            const finalQuest = { ...quest, ObjectiveFiles: objectiveFiles };
            qm.saveQuest(srv, finalQuest);

            addAudit(req.user.id, req.user.username, 'expansion.quest.create',
                `Created quest ${quest.ID} with ${objectiveFiles.length} objectives on ${srv.name}`);

            res.status(201).json(finalQuest);
        } catch (err) {
            logger.error({ err, serverId: req.params.id }, 'Failed to create full quest');
            safeError(err, req, res, { status: 500 });
        }
    });
};
