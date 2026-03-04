/**
 * Backend API client and interaction helpers.
 */
const { MessageFlags } = require('discord.js');
const CONFIG = require('./config');

// Ensure `fetch` is available (Node 18+ has global fetch)
let fetch;
try {
  if (typeof globalThis.fetch === 'function') {
    fetch = globalThis.fetch.bind(globalThis);
  } else {
    const nf = require('node-fetch');
    fetch = nf && (nf.default || nf);
  }
} catch (err) {
  console.warn('fetch unavailable (no global fetch and node-fetch import failed)', err);
}

/** Per-guild selected server (guildId → serverId) */
const selectedServers = new Map();

function getSelectedServerId(guildId) {
  return selectedServers.get(guildId) || null;
}

/**
 * Call the backend Discord action endpoint.
 * @param {string} action - Action name
 * @param {object} params - Action parameters
 * @param {string|null} guildId - Guild ID for server selection
 * @param {object|null} interaction - Discord interaction for user attribution
 */
async function panelAction(action, params = {}, guildId = null, interaction = null) {
  try {
    const mergedParams = { ...params };
    if (!mergedParams.serverId && guildId) {
      const sid = getSelectedServerId(guildId);
      if (sid) mergedParams.serverId = sid;
    }
    // Include Discord user for audit attribution
    if (interaction?.user) {
      mergedParams.discordUser = interaction.user.tag;
      mergedParams.discordUserId = interaction.user.id;
    }
    const res = await fetch(`${CONFIG.apiUrl}/api/discord/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, apiKey: CONFIG.apiKey, params: mergedParams }),
    });
    return await res.json();
  } catch (err) {
    return { error: `API connection failed: ${err.message}` };
  }
}

/**
 * Safe reply helper — handles deferred/replied states gracefully.
 */
async function safeReply(interaction, options) {
  try {
    if (!interaction) return;
    if (!interaction.replied && !interaction.deferred) {
      return await interaction.reply(options);
    }
    const flags = options.flags ?? MessageFlags.Ephemeral;
    return await interaction.followUp(Object.assign({}, options, { flags }));
  } catch (err) {
    console.error('[safeReply] error', err);
  }
}

module.exports = { panelAction, safeReply, selectedServers, getSelectedServerId };
