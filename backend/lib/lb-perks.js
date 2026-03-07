/**
 * LB Master Perks Engine — Direct file modification for LB Master mod integration.
 *
 * Since Citadel runs on the same machine as the DayZ server, we read/write
 * LB Master config files directly to apply perks (chat prefixes, group tag
 * colors, etc.) when players purchase VIP products.
 *
 * Supported perks (Advanced Groups mod):
 *   - Chat Prefixes: assigns player to a prefix group in ChatConfig.json
 *
 * File locations (per server):
 *   profiles/LBmaster/Config/Common/Api.json       — confirms LB Core installed
 *   profiles/LBmaster/Config/LBGroup/ChatConfig.json — chat prefix groups
 *   profiles/LBmaster/Data/LBGroup/Groups/*.json    — per-group data (tag colors)
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const ctx = require('./context');

// ─── Path Helpers ────────────────────────────────────────

/**
 * Get the LB Master base config directory for a server.
 * @param {object} server - Server object with installDir + profileDir
 * @returns {string} Absolute path to LBmaster config root
 */
function _lbBasePath(server) {
  const profileDir = server.profileDir || 'profiles';
  return path.join(server.installDir, profileDir, 'LBmaster');
}

/**
 * Get the path to a specific LB Master config file.
 * @param {object} server
 * @param {...string} segments - Path segments after LBmaster/
 * @returns {string}
 */
function _lbPath(server, ...segments) {
  return path.join(_lbBasePath(server), ...segments);
}

// ─── Safe JSON File I/O ──────────────────────────────────

/**
 * Read and parse a JSON file. Returns null on any error.
 */
function _readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err: err.message, filePath }, 'Failed to read LB Master JSON file');
    }
    return null;
  }
}

/**
 * Write JSON to a file with backup.
 * Creates a .bak copy before overwriting.
 */
function _writeJSON(filePath, data) {
  try {
    // Backup existing file
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4), 'utf-8');
    return true;
  } catch (err) {
    logger.error({ err: err.message, filePath }, 'Failed to write LB Master JSON file');
    return false;
  }
}

// ─── Detection ───────────────────────────────────────────

/**
 * Check if LB Master Core is installed on a server.
 * Looks for the Api.json config file in the expected location.
 *
 * @param {object} server - Server object
 * @returns {{ installed: boolean, hasAdvancedGroups: boolean }}
 */
function detectLBMaster(server) {
  if (!server?.installDir) return { installed: false, hasAdvancedGroups: false };

  const apiJsonPath = _lbPath(server, 'Config', 'Common', 'Api.json');
  const chatConfigPath = _lbPath(server, 'Config', 'LBGroup', 'ChatConfig.json');

  const installed = fs.existsSync(apiJsonPath);
  const hasAdvancedGroups = fs.existsSync(chatConfigPath);

  return { installed, hasAdvancedGroups };
}

/**
 * Get LB Master status across all configured servers.
 * @returns {Array<{ serverId, serverName, installed, hasAdvancedGroups }>}
 */
function getLBStatus() {
  return (ctx.servers || []).map(server => {
    const detection = detectLBMaster(server);
    return {
      serverId: server.id,
      serverName: server.name,
      ...detection,
    };
  });
}

// ─── Prefix Group Discovery ─────────────────────────────

/**
 * Discover available prefix groups from a server's ChatConfig.json.
 *
 * The ChatConfig.json file contains a `prefixGroups` array. Each group has:
 *   - A prefix text (e.g., "[VIP]")
 *   - A list of member Steam UIDs
 *   - Styling info (colors, etc.)
 *
 * Since the exact schema varies by mod version, we read the file dynamically
 * and extract what we can identify.
 *
 * @param {object} server - Server object
 * @returns {Array<{ index, prefix, memberCount, permissionGroup }>}
 */
function discoverPrefixGroups(server) {
  if (!server?.installDir) return [];

  const chatConfigPath = _lbPath(server, 'Config', 'LBGroup', 'ChatConfig.json');
  const config = _readJSON(chatConfigPath);
  if (!config) return [];

  // Find the prefix groups array — try common field names
  const groups = config.prefixGroups || config.PrefixGroups || config.prefix_groups || [];
  if (!Array.isArray(groups)) {
    logger.debug({ server: server.name }, 'No prefixGroups array found in ChatConfig.json');
    return [];
  }

  return groups.map((group, index) => {
    // Extract prefix text — try common field names
    const prefix = group.prefix || group.Prefix || group.name || group.Name || `Group ${index}`;
    // Extract members array
    const members = group.members || group.Members || group.steamIds || group.SteamIds || [];
    // Extract permission group identifier
    const permissionGroup = group.permissionToApplyGroup || group.PermissionToApplyGroup
      || group.permissionGroup || group.PermissionGroup || '';

    return {
      index,
      prefix,
      memberCount: Array.isArray(members) ? members.length : 0,
      permissionGroup,
    };
  });
}

/**
 * Get the raw ChatConfig.json content for a server.
 * Useful for debugging or admin inspection.
 */
function getChatConfig(server) {
  if (!server?.installDir) return null;
  const chatConfigPath = _lbPath(server, 'Config', 'LBGroup', 'ChatConfig.json');
  return _readJSON(chatConfigPath);
}

// ─── Perk Application ────────────────────────────────────

/**
 * Add a player to a prefix group in a server's ChatConfig.json.
 *
 * @param {object} server - Server object
 * @param {string} steamId - Player's Steam64 ID
 * @param {number} prefixGroupIndex - Index of the prefix group in the prefixGroups array
 * @returns {{ success: boolean, error?: string, prefix?: string }}
 */
function applyPrefixPerk(server, steamId, prefixGroupIndex) {
  if (!server?.installDir) {
    return { success: false, error: 'Server has no installDir' };
  }

  const chatConfigPath = _lbPath(server, 'Config', 'LBGroup', 'ChatConfig.json');
  const config = _readJSON(chatConfigPath);
  if (!config) {
    return { success: false, error: 'ChatConfig.json not found or invalid' };
  }

  // Get the prefix groups array
  const groupsKey = config.prefixGroups ? 'prefixGroups'
    : config.PrefixGroups ? 'PrefixGroups'
    : config.prefix_groups ? 'prefix_groups'
    : null;

  if (!groupsKey || !Array.isArray(config[groupsKey])) {
    return { success: false, error: 'No prefixGroups array in ChatConfig.json' };
  }

  const groups = config[groupsKey];
  if (prefixGroupIndex < 0 || prefixGroupIndex >= groups.length) {
    return { success: false, error: `Prefix group index ${prefixGroupIndex} out of range (0-${groups.length - 1})` };
  }

  const group = groups[prefixGroupIndex];

  // Find the members array — try common field names
  const membersKey = group.members ? 'members'
    : group.Members ? 'Members'
    : group.steamIds ? 'steamIds'
    : group.SteamIds ? 'SteamIds'
    : null;

  // If no members array exists yet, create one
  if (!membersKey) {
    group.members = [];
  }

  const members = group[membersKey || 'members'];
  if (!Array.isArray(members)) {
    group[membersKey || 'members'] = [];
  }

  const memberArray = group[membersKey || 'members'];

  // Deduplicate — don't add if already a member
  if (memberArray.includes(steamId)) {
    const prefix = group.prefix || group.Prefix || group.name || `Group ${prefixGroupIndex}`;
    logger.debug({ steamId, prefix, server: server.name }, 'Player already in prefix group');
    return { success: true, prefix, alreadyMember: true };
  }

  // Add the player
  memberArray.push(steamId);

  // Write back
  const written = _writeJSON(chatConfigPath, config);
  if (!written) {
    return { success: false, error: 'Failed to write ChatConfig.json' };
  }

  const prefix = group.prefix || group.Prefix || group.name || `Group ${prefixGroupIndex}`;
  logger.info({ steamId, prefix, server: server.name }, 'Applied chat prefix perk');
  return { success: true, prefix };
}

/**
 * Remove a player from a prefix group in a server's ChatConfig.json.
 *
 * @param {object} server - Server object
 * @param {string} steamId - Player's Steam64 ID
 * @param {number} prefixGroupIndex - Index of the prefix group
 * @returns {{ success: boolean, error?: string }}
 */
function removePrefixPerk(server, steamId, prefixGroupIndex) {
  if (!server?.installDir) {
    return { success: false, error: 'Server has no installDir' };
  }

  const chatConfigPath = _lbPath(server, 'Config', 'LBGroup', 'ChatConfig.json');
  const config = _readJSON(chatConfigPath);
  if (!config) {
    return { success: false, error: 'ChatConfig.json not found or invalid' };
  }

  const groupsKey = config.prefixGroups ? 'prefixGroups'
    : config.PrefixGroups ? 'PrefixGroups'
    : config.prefix_groups ? 'prefix_groups'
    : null;

  if (!groupsKey || !Array.isArray(config[groupsKey])) {
    return { success: false, error: 'No prefixGroups array in ChatConfig.json' };
  }

  const groups = config[groupsKey];
  if (prefixGroupIndex < 0 || prefixGroupIndex >= groups.length) {
    return { success: false, error: `Prefix group index ${prefixGroupIndex} out of range` };
  }

  const group = groups[prefixGroupIndex];
  const membersKey = group.members ? 'members'
    : group.Members ? 'Members'
    : group.steamIds ? 'steamIds'
    : group.SteamIds ? 'SteamIds'
    : null;

  if (!membersKey || !Array.isArray(group[membersKey])) {
    return { success: true }; // No members array = nothing to remove
  }

  const idx = group[membersKey].indexOf(steamId);
  if (idx === -1) {
    return { success: true }; // Not a member = nothing to remove
  }

  group[membersKey].splice(idx, 1);

  const written = _writeJSON(chatConfigPath, config);
  if (!written) {
    return { success: false, error: 'Failed to write ChatConfig.json' };
  }

  logger.info({ steamId, prefixGroupIndex, server: server.name }, 'Removed chat prefix perk');
  return { success: true };
}

// ─── Purchase Fulfillment ────────────────────────────────

/**
 * Apply all LB Master perks for a purchase across all applicable servers.
 *
 * Called from store.js after a successful Stripe webhook.
 * Iterates all servers that have LB Master installed and applies each perk.
 *
 * @param {string} steamId - Player's Steam64 ID
 * @param {Array<{ type: string, prefixGroupIndex?: number }>} lbPerks - Perks to apply
 * @returns {Array<{ type, prefixGroupIndex, serversApplied, serversFailed, success }>}
 */
function applyPerksForPurchase(steamId, lbPerks) {
  if (!lbPerks || !Array.isArray(lbPerks) || lbPerks.length === 0) return [];
  if (!steamId) return [];

  const results = [];

  for (const perk of lbPerks) {
    if (perk.type === 'chatPrefix' && perk.prefixGroupIndex != null) {
      const serversApplied = [];
      const serversFailed = [];

      for (const server of (ctx.servers || [])) {
        const detection = detectLBMaster(server);
        if (!detection.installed || !detection.hasAdvancedGroups) continue;

        const result = applyPrefixPerk(server, steamId, perk.prefixGroupIndex);
        if (result.success) {
          serversApplied.push(server.name);
        } else {
          serversFailed.push({ server: server.name, error: result.error });
          logger.warn({
            steamId, server: server.name,
            error: result.error, prefixGroupIndex: perk.prefixGroupIndex,
          }, 'Failed to apply prefix perk on server');
        }
      }

      results.push({
        type: 'chatPrefix',
        prefixGroupIndex: perk.prefixGroupIndex,
        serversApplied,
        serversFailed: serversFailed.length > 0 ? serversFailed : undefined,
        success: serversApplied.length > 0,
      });
    } else {
      // Unknown perk type — log and skip
      logger.warn({ perk }, 'Unknown LB Master perk type — skipping');
      results.push({
        type: perk.type || 'unknown',
        success: false,
        error: `Unsupported perk type: ${perk.type}`,
      });
    }
  }

  return results;
}

module.exports = {
  // Detection
  detectLBMaster,
  getLBStatus,
  // Discovery
  discoverPrefixGroups,
  getChatConfig,
  // Perk application
  applyPrefixPerk,
  removePrefixPerk,
  // Purchase fulfillment
  applyPerksForPurchase,
};
