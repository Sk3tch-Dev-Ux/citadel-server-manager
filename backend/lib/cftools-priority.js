/**
 * Priority queue management — CFTools sync + local JSON.
 * Writes to both local storage and CFTools when available.
 */
const { v4: uuid } = require('uuid');
const ctx = require('./context');
const logger = require('./logger');
const { saveJSON } = require('./data-store');
const { getClient, isConfiguredForServer, getSdkTypes } = require('./cftools-client');

/**
 * Add a player to the priority queue (local + CFTools).
 */
async function addToPriorityQueue(serverId, name, steamId, role, expiration) {
  const entry = {
    id: uuid(), name, steamId: steamId || '', role: role || 'VIP',
    addedAt: new Date().toISOString(),
  };
  ctx.priorityQueue.push(entry);
  saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);

  // Sync to CFTools if configured and we have a steamId
  if (isConfiguredForServer(serverId) && steamId) {
    try {
      const client = getClient(serverId);
      const sdk = getSdkTypes();
      if (client && sdk) {
        // putPriorityQueue needs a CFToolsId, so resolve from SteamId64 first
        const cftoolsId = await client.resolve(sdk.SteamId64.of(steamId));
        await client.putPriorityQueue({
          id: cftoolsId,
          comment: `${name} - ${role || 'VIP'}`,
          expires: expiration || 'Permanent',
        });
        logger.info({ serverId, steamId }, 'CFTools priority queue entry created');
      }
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'CFTools putPriorityQueue failed');
    }
  }

  return entry;
}

/**
 * Remove a player from the priority queue (local + CFTools).
 */
async function removeFromPriorityQueue(serverId, entryId) {
  const entry = ctx.priorityQueue.find(p => p.id === entryId);
  ctx.priorityQueue = ctx.priorityQueue.filter(p => p.id !== entryId);
  saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);

  // Remove from CFTools if we have the steamId
  if (isConfiguredForServer(serverId) && entry?.steamId) {
    try {
      const client = getClient(serverId);
      const sdk = getSdkTypes();
      if (client && sdk) {
        const cftoolsId = await client.resolve(sdk.SteamId64.of(entry.steamId));
        await client.deletePriorityQueue(cftoolsId);
        logger.info({ serverId, entryId }, 'CFTools priority queue entry removed');
      }
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'CFTools deletePriorityQueue failed');
    }
  }
}

module.exports = { addToPriorityQueue, removeFromPriorityQueue };
