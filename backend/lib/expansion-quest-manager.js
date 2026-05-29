/**
 * Expansion Quest Manager — File I/O for Expansion Mod quest system.
 *
 * Manages reading/writing of quest definitions, NPCs, and objectives
 * from the ExpansionMod/Quests profile directory.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Objective type → folder name and file prefix mapping
const OBJECTIVE_TYPES = {
    2:  { folder: 'Target',       prefix: 'Objective_TA' },
    3:  { folder: 'Travel',       prefix: 'Objective_T' },
    4:  { folder: 'Collection',   prefix: 'Objective_C' },
    5:  { folder: 'Delivery',     prefix: 'Objective_D' },
    6:  { folder: 'TreasureHunt', prefix: 'Objective_TH' },
    7:  { folder: 'AIPatrol',     prefix: 'Objective_AIP' },
    8:  { folder: 'AICamp',       prefix: 'Objective_AIC' },
    9:  { folder: 'AIVIP',        prefix: 'Objective_AIESCORT' },
    10: { folder: 'Action',       prefix: 'Objective_A' },
    11: { folder: 'Crafting',     prefix: 'Objective_CR' },
};

// ─── Path helpers ────────────────────────────────────────

/**
 * Returns the full filesystem path to the ExpansionMod Quests directory.
 */
function getQuestsDir(srv) {
    const profileDir = srv.profileDir || 'profiles';
    return path.join(srv.installDir, profileDir, 'ExpansionMod', 'Quests');
}

function getQuestFilesDir(srv) {
    return path.join(getQuestsDir(srv), 'Quests');
}

function getNPCsDir(srv) {
    return path.join(getQuestsDir(srv), 'NPCs');
}

function getObjectivesDir(srv) {
    return path.join(getQuestsDir(srv), 'Objectives');
}

function getObjectiveTypeDir(srv, objType) {
    const typeInfo = OBJECTIVE_TYPES[objType];
    if (!typeInfo) return null;
    return path.join(getObjectivesDir(srv), typeInfo.folder);
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Safely read and parse a JSON file. Returns null on error.
 */
function readJSON(filePath) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        logger.error({ err, filePath }, 'Failed to read JSON file');
        return null;
    }
}

/**
 * Write an object as JSON with 4-space indentation.
 */
function writeJSON(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf8');
}

/**
 * Read all JSON files matching a glob pattern in a directory.
 * Returns an array of parsed objects (skips files that fail to parse).
 */
function readAllJSON(dirPath, filePrefix) {
    if (!fs.existsSync(dirPath)) return [];
    try {
        const files = fs.readdirSync(dirPath).filter(f =>
            f.startsWith(filePrefix) && f.endsWith('.json')
        );
        const results = [];
        for (const file of files) {
            const data = readJSON(path.join(dirPath, file));
            if (data) results.push(data);
        }
        return results;
    } catch (err) {
        logger.error({ err, dirPath }, 'Failed to read directory');
        return [];
    }
}

/**
 * Find the maximum numeric ID from an array of objects with an ID field.
 */
function findMaxId(items, idField) {
    let max = 0;
    for (const item of items) {
        const id = typeof item[idField] === 'number' ? item[idField] : parseInt(item[idField], 10);
        if (!isNaN(id) && id > max) max = id;
    }
    return max;
}

// ─── Quest operations ────────────────────────────────────

function listQuests(srv) {
    return readAllJSON(getQuestFilesDir(srv), 'Quest_');
}

function getQuest(srv, questId) {
    const filePath = path.join(getQuestFilesDir(srv), `Quest_${questId}.json`);
    return readJSON(filePath);
}

function saveQuest(srv, quest) {
    const dir = getQuestFilesDir(srv);
    const filePath = path.join(dir, `Quest_${quest.ID}.json`);
    writeJSON(filePath, quest);
    return quest;
}

function deleteQuest(srv, questId) {
    const filePath = path.join(getQuestFilesDir(srv), `Quest_${questId}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

function getNextQuestId(srv) {
    const quests = listQuests(srv);
    return findMaxId(quests, 'ID') + 1;
}

// ─── NPC operations ──────────────────────────────────────

function listNPCs(srv) {
    return readAllJSON(getNPCsDir(srv), 'QuestNPC_');
}

function getNPC(srv, npcId) {
    const filePath = path.join(getNPCsDir(srv), `QuestNPC_${npcId}.json`);
    return readJSON(filePath);
}

function saveNPC(srv, npc) {
    const dir = getNPCsDir(srv);
    const filePath = path.join(dir, `QuestNPC_${npc.ID}.json`);
    writeJSON(filePath, npc);
    return npc;
}

function deleteNPC(srv, npcId) {
    const filePath = path.join(getNPCsDir(srv), `QuestNPC_${npcId}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

function getNextNPCId(srv) {
    const npcs = listNPCs(srv);
    return findMaxId(npcs, 'ID') + 1;
}

// ─── Objective operations ────────────────────────────────

/**
 * List ALL objectives from all type folders.
 * Returns an array of objectives, each enriched with _objType and _typeInfo.
 */
function listObjectives(srv) {
    const results = [];
    for (const [typeStr, typeInfo] of Object.entries(OBJECTIVE_TYPES)) {
        const objType = parseInt(typeStr, 10);
        const dir = path.join(getObjectivesDir(srv), typeInfo.folder);
        const items = readAllJSON(dir, typeInfo.prefix);
        for (const item of items) {
            results.push({
                ...item,
                _objType: objType,
                _folder: typeInfo.folder,
                _prefix: typeInfo.prefix,
            });
        }
    }
    return results;
}

function getObjective(srv, objId, objType) {
    const typeInfo = OBJECTIVE_TYPES[objType];
    if (!typeInfo) return null;
    const dir = getObjectiveTypeDir(srv, objType);
    const filePath = path.join(dir, `${typeInfo.prefix}_${objId}.json`);
    return readJSON(filePath);
}

function saveObjective(srv, objective) {
    const objType = objective.ObjectiveType;
    const typeInfo = OBJECTIVE_TYPES[objType];
    if (!typeInfo) {
        throw new Error(`Unknown objective type: ${objType}`);
    }
    const dir = getObjectiveTypeDir(srv, objType);
    const filePath = path.join(dir, `${typeInfo.prefix}_${objective.ID}.json`);
    writeJSON(filePath, objective);
    return objective;
}

function deleteObjective(srv, objId, objType) {
    const typeInfo = OBJECTIVE_TYPES[objType];
    if (!typeInfo) return false;
    const dir = getObjectiveTypeDir(srv, objType);
    const filePath = path.join(dir, `${typeInfo.prefix}_${objId}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
    }
    return false;
}

function getNextObjectiveId(srv, objType) {
    const typeInfo = OBJECTIVE_TYPES[objType];
    if (!typeInfo) return 1;
    const dir = getObjectiveTypeDir(srv, objType);
    const items = readAllJSON(dir, typeInfo.prefix);
    return findMaxId(items, 'ID') + 1;
}

// ─── Exports ─────────────────────────────────────────────

module.exports = {
    OBJECTIVE_TYPES,
    getQuestsDir,
    listQuests,
    getQuest,
    saveQuest,
    deleteQuest,
    getNextQuestId,
    listNPCs,
    getNPC,
    saveNPC,
    deleteNPC,
    getNextNPCId,
    listObjectives,
    getObjective,
    saveObjective,
    deleteObjective,
    getNextObjectiveId,
};
