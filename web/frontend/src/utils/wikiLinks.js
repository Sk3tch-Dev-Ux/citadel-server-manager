/**
 * Build deep-links into the official DayZ Expansion wiki at
 * https://dayzexpansion.com.
 *
 * Used by editor pages (ExpansionEditorPage, TraderEditorPage,
 * QuestCreatorPage, etc.) to give admins a one-click jump to the official docs
 * for whatever they're currently editing.
 *
 * The links here intentionally use the URL semantics of the wiki rather than
 * a hard-coded mapping per file — that keeps this resilient to small upstream
 * URL changes. If a more specific deep-link is wanted later, extend the
 * `SETTINGS_FILE_TO_TOOL` table below.
 */

const WIKI_BASE = 'https://dayzexpansion.com';

/**
 * Wiki page for an Expansion mod (or one of its dependencies).
 * @param {string} modId - e.g. "expansion-hardline", "expansion-quests"
 * @returns {string|null}
 */
export function modWikiUrl(modId) {
  if (!modId || typeof modId !== 'string') return null;
  return `${WIKI_BASE}/mods/${encodeURIComponent(modId)}`;
}

/**
 * Wiki page for a specific custom tool. Returns null if the slug isn't one we
 * know about — protects against typos.
 */
export const WIKI_TOOLS = Object.freeze({
  'market-manager': 'Market Editor',
  'expansion-loadout-builder': 'Loadout Editor',
  'quest-editor': 'Quest Editor',
  'hardline-editor': 'Hardline Editor',
  'settings-editor': 'Settings Editor',
  'json-validator': 'JSON Validator',
  'argb-calculator': 'ARGB ↔ Int',
  'config-diff': 'Config Diff',
  'expansion-icon-browser': 'Icon Browser',
  'trader-price-calculator': 'Price Calculator',
});

export function toolWikiUrl(toolSlug) {
  if (!toolSlug || !(toolSlug in WIKI_TOOLS)) return null;
  return `${WIKI_BASE}/tools/custom/${toolSlug}`;
}

/**
 * For a given settings filename (e.g. "HardlineSettings.json"), pick the most
 * useful wiki destination — the corresponding visual editor tool if one
 * exists, otherwise the mod page. Falls back to the wiki root.
 *
 * Intended for the `?` icon next to a section header in the editor.
 */
const SETTINGS_FILE_TO_TOOL = Object.freeze({
  'HardlineSettings.json': 'hardline-editor',
  'MarketSettings.json': 'market-manager',
  'SpawnSettings.json': 'expansion-loadout-builder',
  // Anything Quest-shaped goes to the Quest Editor.
  'QuestSettings.json': 'quest-editor',
  // Settings Editor handles SafeZones / BaseBuilding / AI Patrols / map markers.
  'SafeZoneSettings.json': 'settings-editor',
  'BaseBuildingSettings.json': 'settings-editor',
  'AIPatrolSettings.json': 'settings-editor',
  'AILocationSettings.json': 'settings-editor',
  'MapSettings.json': 'settings-editor',
});

/**
 * @param {{ fileName?: string, modId?: string }} ctx
 * @returns {string} - always returns a valid URL, never null
 */
export function helpUrlFor({ fileName, modId } = {}) {
  if (fileName) {
    const base = fileName.split('/').pop() || fileName;
    const tool = SETTINGS_FILE_TO_TOOL[base];
    if (tool) return toolWikiUrl(tool);
    // QuestNPC, Quest_*, Objective_* are all quest-shaped
    if (/^(Quest|QuestNPC|Objective)/.test(base)) return toolWikiUrl('quest-editor');
  }
  if (modId) {
    const url = modWikiUrl(modId);
    if (url) return url;
  }
  return WIKI_BASE;
}

/** Convenience: get a human label for the destination, for tooltips. */
export function helpLabelFor({ fileName, modId } = {}) {
  if (fileName) {
    const base = fileName.split('/').pop() || fileName;
    const tool = SETTINGS_FILE_TO_TOOL[base];
    if (tool) return `Open in ${WIKI_TOOLS[tool]}`;
    if (/^(Quest|QuestNPC|Objective)/.test(base)) return `Open in ${WIKI_TOOLS['quest-editor']}`;
  }
  if (modId) return `Open ${modId} on dayzexpansion.com`;
  return 'Open dayzexpansion.com';
}
