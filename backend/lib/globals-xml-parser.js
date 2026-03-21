/**
 * DayZ globals.xml Parser
 * Parses and rebuilds globals.xml for the Globals Editor.
 */

// ─── Metadata for known globals variables ────────────────────

const GLOBALS_METADATA = {
  AnimalMaxCount:              { description: 'Maximum animals on the map',                          category: 'Animals & Infected', min: 0, max: 2000 },
  ZombieMaxCount:              { description: 'Maximum zombies on the map',                          category: 'Animals & Infected', min: 0, max: 5000 },
  CleanupAvoidance:            { description: 'Avoidance radius for item cleanup (meters)',          category: 'Cleanup',            min: 0, max: 1000 },
  CleanupLifetimeDeadAnimal:   { description: 'Time before dead animals are cleaned up (seconds)',   category: 'Cleanup',            min: 0, max: 86400 },
  CleanupLifetimeDeadInfected: { description: 'Time before dead infected are cleaned up (seconds)',  category: 'Cleanup',            min: 0, max: 86400 },
  CleanupLifetimeDeadPlayer:   { description: 'Time before dead players are cleaned up (seconds)',   category: 'Cleanup',            min: 0, max: 86400 },
  CleanupLifetimeDefault:      { description: 'Default cleanup lifetime (seconds)',                  category: 'Cleanup',            min: 0, max: 86400 },
  CleanupLifetimeLimit:        { description: 'Maximum cleanup lifetime (seconds)',                  category: 'Cleanup',            min: 0, max: 86400 },
  CleanupLifetimeRuined:       { description: 'Time before ruined items are cleaned up (seconds)',   category: 'Cleanup',            min: 0, max: 86400 },
  FlagRefreshFrequency:        { description: 'How often territory flags need refreshing (seconds)', category: 'Economy',            min: 0, max: 8640000 },
  FlagRefreshMaxDuration:      { description: 'Maximum flag lifetime before decay (seconds)',        category: 'Economy',            min: 0, max: 8640000 },
  FoodDecay:                   { description: 'Enable food decay (0/1)',                             category: 'World',              min: 0, max: 1 },
  IdleModeCountdown:           { description: 'Countdown before idle mode activates (seconds)',      category: 'Economy',            min: 0, max: 3600 },
  IdleModeStartup:             { description: 'Enable idle mode on startup (0/1)',                   category: 'Economy',            min: 0, max: 1 },
  InitialSpawn:                { description: 'Initial spawn percentage (0-100)',                    category: 'Economy',            min: 0, max: 100 },
  LootProxyPlacement:          { description: 'Enable loot proxy placement (0/1)',                   category: 'Economy',            min: 0, max: 1 },
  RespawnAttempt:              { description: 'Number of respawn attempts per tick',                 category: 'Economy',            min: 0, max: 100 },
  RespawnLimit:                { description: 'Respawn limit per tick',                              category: 'Economy',            min: 0, max: 100 },
  RespawnTypes:                { description: 'Types of respawn behavior (bitmask)',                 category: 'Economy',            min: 0, max: 255 },
  RestartSpawn:                { description: 'Spawn percentage on restart (0-100)',                 category: 'Economy',            min: 0, max: 100 },
  SpawnInitial:                { description: 'Initial spawn delay (seconds)',                       category: 'Economy',            min: 0, max: 86400 },
  TimeHopping:                 { description: 'Server hop cooldown (seconds)',                       category: 'Player',             min: 0, max: 3600 },
  TimePenalty:                 { description: 'Penalty time for combat log (seconds)',               category: 'Player',             min: 0, max: 3600 },
  TimeLogin:                   { description: 'Login timer (seconds)',                               category: 'Player',             min: 0, max: 120 },
  TimeLogout:                  { description: 'Logout timer (seconds)',                              category: 'Player',             min: 0, max: 120 },
  WorldWetTempUpdate:          { description: 'Enable wet/temperature updates (0/1)',                category: 'World',              min: 0, max: 1 },
  ZoneSpawnDist:               { description: 'Distance threshold for zone spawning (meters)',       category: 'Economy',            min: 0, max: 5000 },
};

// ─── Parser ──────────────────────────────────────────────────

/**
 * Parse globals.xml content into an array of { name, type, value } objects.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {Array<{name: string, type: string, value: string}>}
 */
function parseGlobalsXml(xmlContent) {
  const globals = [];
  const varRe = /<var\s+name="([^"]+)"\s+type="([^"]+)"\s+value="([^"]+)"\s*\/>/gi;
  let match;
  while ((match = varRe.exec(xmlContent)) !== null) {
    globals.push({
      name: match[1],
      type: match[2],
      value: match[3],
    });
  }
  return globals;
}

// ─── Builder ─────────────────────────────────────────────────

/**
 * Serialize an array of globals back to XML string, preserving the standard format.
 *
 * @param {Array<{name: string, type: string, value: string}>} globals
 * @returns {string} XML content
 */
function buildGlobalsXml(globals) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<variables>',
  ];
  for (const g of globals) {
    lines.push(`    <var name="${g.name}" type="${g.type}" value="${g.value}"/>`);
  }
  lines.push('</variables>');
  return lines.join('\n') + '\n';
}

module.exports = {
  parseGlobalsXml,
  buildGlobalsXml,
  GLOBALS_METADATA,
};
