/**
 * DayZ cfgrandompresets.xml reader.
 *
 * `cfgrandompresets.xml` defines named preset groups that spawnable types can
 * reference. A type entry can have:
 *     <item name="AK_Magazines" chance="1.0" preset="1" />
 *
 * and DayZ will look up `AK_Magazines` in this file to resolve a randomized
 * loot choice. Presets are grouped by kind (cargo or attachments):
 *
 *   <randompresets>
 *     <cargo name="AK_Magazines" chance="1.0">
 *         <item name="Mag_AK74_30Rnd" chance="0.40" />
 *         <item name="Mag_AKM_30Rnd" chance="0.60" />
 *     </cargo>
 *     <attachments name="AK_Optics" chance="0.25">
 *         ...
 *     </attachments>
 *   </randompresets>
 *
 * For the Spawnable Types UI we only need the list of preset NAMES grouped
 * by kind — so users can pick from a dropdown when adding a preset-ref item.
 * The full preset contents are not editable through this surface (there's
 * room for a dedicated Random Presets editor later).
 */
const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'cargo' || name === 'attachments',
});

/**
 * Locate cfgrandompresets.xml in a mission folder.
 * DayZ places it alongside cfgspawnabletypes.xml in `db/`.
 */
function findRandomPresetsFile(missionDir) {
  if (!missionDir) return null;
  const candidates = [
    path.join(missionDir, 'db', 'cfgrandompresets.xml'),
    path.join(missionDir, 'cfgrandompresets.xml'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * Parse cfgrandompresets.xml and return preset summaries grouped by kind.
 *
 * Returns: {
 *   cargo:       [{ name, chance, itemCount }],
 *   attachments: [{ name, chance, itemCount }],
 * }
 */
function parseRandomPresets(xmlContent) {
  if (typeof xmlContent !== 'string' || xmlContent.trim().length === 0) {
    return { cargo: [], attachments: [] };
  }
  let root;
  try {
    root = parser.parse(xmlContent);
  } catch (err) {
    throw new Error(`Failed to parse cfgrandompresets.xml: ${err.message}`);
  }
  const container = root?.randompresets;
  if (!container) return { cargo: [], attachments: [] };

  return {
    cargo: summarize(container.cargo),
    attachments: summarize(container.attachments),
  };
}

function summarize(entries) {
  if (!entries) return [];
  const arr = Array.isArray(entries) ? entries : [entries];
  return arr
    .filter((e) => e && e['@_name'])
    .map((e) => ({
      name: e['@_name'],
      chance: parseFloat(e['@_chance']) || 0,
      itemCount: Array.isArray(e.item) ? e.item.length : (e.item ? 1 : 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read + parse the presets file for a server. Returns null if the file
 * doesn't exist (perfectly normal — not every server has presets defined).
 */
function readRandomPresets(missionDir) {
  const filePath = findRandomPresetsFile(missionDir);
  if (!filePath) return { path: null, cargo: [], attachments: [] };
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseRandomPresets(content);
    return { path: filePath, ...parsed };
  } catch {
    return { path: filePath, cargo: [], attachments: [], error: 'Failed to read or parse cfgrandompresets.xml' };
  }
}

module.exports = {
  findRandomPresetsFile,
  parseRandomPresets,
  readRandomPresets,
};
