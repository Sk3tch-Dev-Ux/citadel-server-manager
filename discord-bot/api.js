/**
 * Backend API client and interaction helpers.
 */
const crypto = require('node:crypto');
const { MessageFlags } = require('discord.js');
const CONFIG = require('./config');
const logger = require('./lib/logger');

/**
 * Audit H6 Layer 2 — HMAC-sign each Discord-bot call so the backend can
 * verify the claimed Discord user identity wasn't spoofed by anyone in
 * possession of the API key alone (the bot's API key is shared by the
 * Citadel deployment; the HMAC binds the call to a specific Discord user).
 *
 * Signature scheme:
 *   ts        = unix seconds at call time
 *   payload   = `${ts}.${action}.${discordUserId}`
 *   sig       = HMAC-SHA256(apiKey, payload), hex
 *
 * Sent as headers X-Discord-Ts and X-Discord-Sig. The backend verifies
 * the same payload and rejects calls older than 5 minutes (replay window).
 *
 * Legacy/missing-headers callers still work — the backend treats them as
 * 'unverified' and labels the audit log accordingly. That keeps an
 * older bot in the wild from breaking when the panel upgrades, but new
 * deployments get verifiable attribution out of the box.
 */
function signCall(apiKey, action, discordUserId) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${ts}.${action}.${discordUserId || 'bot'}`;
  const sig = crypto.createHmac('sha256', apiKey).update(payload).digest('hex');
  return { ts, sig };
}

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
  logger.warn(`fetch unavailable (no global fetch and node-fetch import failed): ${err.message}`);
}

/** Per-guild selected server (guildId → serverId) */
const selectedServers = new Map();

/** Default fetch timeout in milliseconds */
const DEFAULT_FETCH_TIMEOUT_MS = 8000;

/** Retry delay for failed 5xx errors */
const RETRY_DELAY_MS = 2000;

function getSelectedServerId(guildId) {
  return selectedServers.get(guildId) || null;
}

/**
 * Make a fetch request with timeout, response checking, and retry logic.
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @returns {Promise<{ok: boolean, status: number, data: any, error: string|null}>}
 */
async function fetchWithTimeout(url, options = {}) {
  const timeout = options.timeout || DEFAULT_FETCH_TIMEOUT_MS;
  delete options.timeout; // Remove custom timeout option

  try {
    // Add AbortSignal for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    // Check response status
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return {
        ok: false,
        status: response.status,
        data: null,
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`
      };
    }

    // Parse response
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        return {
          ok: false,
          status: response.status,
          data: null,
          error: 'Invalid JSON response'
        };
      }
    } else {
      data = await response.text();
    }

    return { ok: true, status: response.status, data, error: null };
  } catch (err) {
    if (err.name === 'AbortError') {
      return {
        ok: false,
        status: null,
        data: null,
        error: `Request timeout (${timeout}ms)`
      };
    }
    return {
      ok: false,
      status: null,
      data: null,
      error: err.message || 'Network error'
    };
  }
}

/**
 * Make a fetch request with retry logic for 5xx errors.
 * @param {string} url - The URL to fetch
 * @param {object} options - Fetch options
 * @param {number} attempt - Current attempt (internal)
 * @returns {Promise<{ok: boolean, status: number, data: any, error: string|null}>}
 */
async function fetchWithRetry(url, options = {}, attempt = 1) {
  const maxAttempts = 2; // 1 initial + 1 retry

  const result = await fetchWithTimeout(url, options);

  // Retry on 5xx errors
  if (!result.ok && result.status >= 500 && result.status < 600 && attempt < maxAttempts) {
    logger.warn({ url, status: result.status, error: result.error }, `5xx error on attempt ${attempt}, retrying in ${RETRY_DELAY_MS}ms`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    return fetchWithRetry(url, options, attempt + 1);
  }

  return result;
}

/**
 * Call the backend Discord action endpoint.
 * @param {string} action - Action name
 * @param {object} params - Action parameters
 * @param {string|null} guildId - Guild ID for server selection
 * @param {object|null} interaction - Discord interaction for user attribution
 * @returns {Promise<{success: boolean, data: any, error: string|null}>}
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

    const { ts, sig } = signCall(CONFIG.apiKey, action, mergedParams.discordUserId);
    const result = await fetchWithRetry(`${CONFIG.apiUrl}/api/discord/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.apiKey}`,
        'X-Discord-Ts': String(ts),
        'X-Discord-Sig': sig,
      },
      body: JSON.stringify({ action, params: mergedParams }),
      timeout: DEFAULT_FETCH_TIMEOUT_MS,
    });

    if (!result.ok) {
      return { success: false, error: result.error };
    }

    // Spread backend response data at top level so callers can access fields directly
    // e.g. { success: true, error: null, servers: [...], status: 'running', ... }
    const payload = (typeof result.data === 'object' && result.data !== null) ? result.data : {};
    return { success: true, error: null, ...payload };
  } catch (err) {
    return { success: false, error: `API connection failed: ${err.message}` };
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
    logger.error({ err: err.message }, 'safeReply error');
  }
}

module.exports = { panelAction, safeReply, selectedServers, getSelectedServerId, fetchWithTimeout, fetchWithRetry };
