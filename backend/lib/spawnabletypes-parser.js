/**
 * DayZ cfgspawnabletypes.xml Parser
 * Parses and rebuilds cfgspawnabletypes.xml which defines attachments and cargo
 * that spawn on items (weapons, clothing, etc.).
 */

// ─── Parser ──────────────────────────────────────────────────

/**
 * Parse cfgspawnabletypes.xml content into an array of spawnable type objects.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {Array<{name: string, hoarder: boolean, attachments: Array, cargo: Array}>}
 */
function parseSpawnableTypes(xmlContent) {
  const items = [];
  const typeRe = /<type\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/type>/gi;
  let match;

  while ((match = typeRe.exec(xmlContent)) !== null) {
    const name = match[1];
    const body = match[2];

    // Check for <hoarder /> tag
    const hoarder = /<hoarder\s*\/?>/.test(body);

    // Parse attachment groups
    const attachments = parseGroups(body, 'attachments');

    // Parse cargo groups
    const cargo = parseGroups(body, 'cargo');

    items.push({ name, hoarder, attachments, cargo });
  }

  return items;
}

/**
 * Parse groups (attachments or cargo) from a type body.
 *
 * @param {string} body - Inner XML of a <type> element
 * @param {string} groupTag - 'attachments' or 'cargo'
 * @returns {Array<{chance: number, items: Array<{name: string, chance: number}>}>}
 */
function parseGroups(body, groupTag) {
  const groups = [];
  const groupRe = new RegExp(`<${groupTag}\\s+chance="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${groupTag}>`, 'gi');
  let groupMatch;

  while ((groupMatch = groupRe.exec(body)) !== null) {
    const chance = parseFloat(groupMatch[1]) || 0;
    const groupBody = groupMatch[2];
    const groupItems = [];

    const itemRe = /<item\s+name="([^"]+)"\s+chance="([^"]+)"\s*\/>/gi;
    let itemMatch;
    while ((itemMatch = itemRe.exec(groupBody)) !== null) {
      groupItems.push({
        name: itemMatch[1],
        chance: parseFloat(itemMatch[2]) || 0,
      });
    }

    groups.push({ chance, items: groupItems });
  }

  return groups;
}

// ─── Builder ─────────────────────────────────────────────────

/**
 * Serialize an array of spawnable type objects back to XML string.
 *
 * @param {Array} items - Array of spawnable type objects
 * @returns {string} XML content
 */
function buildSpawnableTypes(items) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
    '<spawnabletypes>',
  ];

  for (const item of items) {
    lines.push(`    <type name="${escXml(item.name)}">`);

    // Hoarder tag
    if (item.hoarder) {
      lines.push('        <hoarder />');
    }

    // Attachment groups
    for (const group of item.attachments || []) {
      lines.push(`        <attachments chance="${fmtChance(group.chance)}">`);
      for (const it of group.items || []) {
        lines.push(`            <item name="${escXml(it.name)}" chance="${fmtChance(it.chance)}" />`);
      }
      lines.push('        </attachments>');
    }

    // Cargo groups
    for (const group of item.cargo || []) {
      lines.push(`        <cargo chance="${fmtChance(group.chance)}">`);
      for (const it of group.items || []) {
        lines.push(`            <item name="${escXml(it.name)}" chance="${fmtChance(it.chance)}" />`);
      }
      lines.push('        </cargo>');
    }

    lines.push('    </type>');
  }

  lines.push('</spawnabletypes>');
  return lines.join('\n') + '\n';
}

/**
 * Format a chance value as a string with two decimal places.
 */
function fmtChance(val) {
  const n = parseFloat(val) || 0;
  return n.toFixed(2);
}

/**
 * Escape XML special characters in attribute values.
 */
function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  parseSpawnableTypes,
  buildSpawnableTypes,
};
