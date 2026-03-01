/**
 * Priority queue management — InHouse sidecar sync + local JSON.
 * Writes to both local storage and sidecar when available.
 * No CFTools dependency.
 */
const { v4: uuid } = require('uuid');
const ctx = require('./context');
const logger = require('./logger');
const { saveJSON } = require('./data-store');

/**
 * Add a player to the priority queue (local + sidecar).
 */
async function addToPriorityQueue(serverId, name, steamId, role, expiration) {
  const entry = {
    id: uuid(), name, steamId: steamId || '', role: role || 'VIP',
    addedAt: new Date().toISOString(),
  };
  ctx.priorityQueue.push(entry);
  saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);

  // Sync to sidecar if configured and we have a steamId
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;
  if (baseUrl && steamId) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

      await fetch(`${baseUrl}/priority-queue`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          steamId,
          name: name || 'Unknown',
          role: role || 'VIP',
          expiration: expiration || null,
        }),
      });
      logger.info({ serverId, steamId }, 'Sidecar priority queue entry created');
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'Sidecar priority queue sync failed');
    }
  }

  return entry;
}

/**
 * Remove a player from the priority queue (local + sidecar).
 */
async function removeFromPriorityQueue(serverId, entryId) {
  const entry = ctx.priorityQueue.find(p => p.id === entryId);
  ctx.priorityQueue = ctx.priorityQueue.filter(p => p.id !== entryId);
  saveJSON(ctx.CONFIG.dataDir, 'priority_queue.json', ctx.priorityQueue);

  // Remove from sidecar
  const srv = ctx.servers.find(s => s.id === serverId);
  const baseUrl = srv?.inHouseApiUrl;
  if (baseUrl && entry) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (srv.inHouseApiKey) headers['Authorization'] = `Bearer ${srv.inHouseApiKey}`;

      await fetch(`${baseUrl}/priority-queue/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
        headers,
      });
      logger.info({ serverId, entryId }, 'Sidecar priority queue entry removed');
    } catch (err) {
      logger.warn({ err: err.message, serverId }, 'Sidecar priority queue remove failed');
    }
  }
}

module.exports = { addToPriorityQueue, removeFromPriorityQueue };
