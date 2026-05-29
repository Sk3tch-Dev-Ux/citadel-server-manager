/**
 * DayZ cfgspawnabletypes.xml parser & serializer.
 *
 * cfgspawnabletypes.xml drives the loot that spawns inside an item (cargo) or
 * attached to it (attachments). A single `<type>` entry looks like this:
 *
 *   <type name="AKM">
 *       <damage min="0.0" max="0.5" />
 *       <hoarder />
 *       <cargo chance="0.25">
 *           <item name="AK_Bayonet" chance="0.30" />
 *           <item name="AK_Magazines" chance="0.70" preset="1" />
 *       </cargo>
 *       <attachments chance="0.60">
 *           <item name="AK74_Suppressor" chance="0.15" />
 *       </attachments>
 *   </type>
 *
 * Key notes on the schema:
 *   - `<hoarder />` is a boolean presence marker — it may appear empty
 *     (`<hoarder />`) or with a nested config (rare, but legal)
 *   - `<damage min max />` sets the spawn-health range (0.0 = ruined, 1.0 = pristine)
 *   - Items within groups may have `preset="1"` — in that case the `name`
 *     references an entry in cfgrandompresets.xml instead of an item class
 *   - Groups and items can appear in any order; we preserve insertion order
 *
 * We parse with fast-xml-parser for robustness, then hand-serialize for total
 * control over formatting (4-space indent matching DayZ conventions).
 */
const { XMLParser } = require('fast-xml-parser');
const { escapeXml } = require('./xml-escape');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false, // keep attributes as strings; we cast ourselves
  trimValues: true,
  // Ensure repeatable children are always arrays (attachments/cargo/item groups)
  isArray: (name, jpath) => {
    if (name === 'type') return true;
    if (name === 'attachments') return true;
    if (name === 'cargo') return true;
    if (name === 'item' && /\/(attachments|cargo)\/item$/.test(jpath)) return true;
    return false;
  },
});

// ─── Parse ────────────────────────────────────────────────────

/**
 * Parse cfgspawnabletypes.xml into a list of spawnable type objects.
 *
 * Returned shape (preserves ALL fields the UI knows about):
 *   {
 *     name,
 *     hoarder: boolean,
 *     damage: { min, max } | null,
 *     attachments: [{ chance, items: [{ name, chance, preset }] }],
 *     cargo:       [{ chance, items: [{ name, chance, preset }] }]
 *   }
 */
function parseSpawnableTypes(xmlContent) {
  if (typeof xmlContent !== 'string' || xmlContent.trim().length === 0) return [];
  let root;
  try {
    root = parser.parse(xmlContent);
  } catch (err) {
    throw new Error(`Failed to parse cfgspawnabletypes.xml: ${err.message}`);
  }
  const container = root?.spawnabletypes;
  if (!container) return [];
  const types = Array.isArray(container.type) ? container.type : (container.type ? [container.type] : []);
  return types.map(parseType).filter(Boolean);
}

function parseType(t) {
  if (!t || typeof t !== 'object') return null;
  const name = t['@_name'];
  if (!name) return null;
  return {
    name,
    hoarder: 'hoarder' in t,
    damage: parseDamage(t.damage),
    attachments: parseGroupArray(t.attachments),
    cargo: parseGroupArray(t.cargo),
  };
}

function parseDamage(d) {
  if (!d || typeof d !== 'object') return null;
  const min = d['@_min'];
  const max = d['@_max'];
  if (min == null && max == null) return null;
  return {
    min: num(min, 0),
    max: num(max, 1),
  };
}

function parseGroupArray(raw) {
  if (!raw) return [];
  const groups = Array.isArray(raw) ? raw : [raw];
  return groups.map(parseGroup).filter(Boolean);
}

function parseGroup(g) {
  if (!g || typeof g !== 'object') return null;
  const chance = num(g['@_chance'], 0);
  const rawItems = g.item;
  const items = !rawItems ? [] : (Array.isArray(rawItems) ? rawItems : [rawItems])
    .map(parseItem)
    .filter(Boolean);
  return { chance, items };
}

function parseItem(it) {
  if (!it || typeof it !== 'object') return null;
  const name = it['@_name'];
  if (!name) return null;
  return {
    name,
    chance: num(it['@_chance'], 0),
    preset: it['@_preset'] === '1' || it['@_preset'] === 1 || it['@_preset'] === true,
  };
}

function num(v, fallback) {
  if (v == null || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Serialize ────────────────────────────────────────────────

function buildSpawnableTypes(items) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
    '<spawnabletypes>',
  ];
  for (const it of (items || [])) {
    serializeType(lines, it);
  }
  lines.push('</spawnabletypes>');
  return lines.join('\n') + '\n';
}

function serializeType(lines, item) {
  if (!item || !item.name) return;
  lines.push(`    <type name="${escXml(item.name)}">`);

  if (item.damage && (item.damage.min != null || item.damage.max != null)) {
    lines.push(`        <damage min="${fmtChance(item.damage.min)}" max="${fmtChance(item.damage.max)}" />`);
  }

  if (item.hoarder) {
    lines.push('        <hoarder />');
  }

  for (const g of item.attachments || []) {
    serializeGroup(lines, 'attachments', g);
  }
  for (const g of item.cargo || []) {
    serializeGroup(lines, 'cargo', g);
  }

  lines.push('    </type>');
}

function serializeGroup(lines, tag, group) {
  if (!group) return;
  const items = Array.isArray(group.items) ? group.items : [];
  if (items.length === 0) {
    // An empty group is still valid DayZ XML — self-close it
    lines.push(`        <${tag} chance="${fmtChance(group.chance)}" />`);
    return;
  }
  lines.push(`        <${tag} chance="${fmtChance(group.chance)}">`);
  for (const it of items) {
    const presetAttr = it.preset ? ' preset="1"' : '';
    lines.push(`            <item name="${escXml(it.name)}" chance="${fmtChance(it.chance)}"${presetAttr} />`);
  }
  lines.push(`        </${tag}>`);
}

function fmtChance(val) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

// Alias kept for the existing call sites; delegates to the shared escaper
// (which additionally escapes `'` and collapses CR/LF/TAB — harmless for the
// item/preset class names used here, none of which contain those characters).
const escXml = escapeXml;

module.exports = {
  parseSpawnableTypes,
  buildSpawnableTypes,
};
