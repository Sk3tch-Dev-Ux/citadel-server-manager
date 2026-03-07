/**
 * DayZ Types XML Parser
 * Parses types.xml, cfglimitsdefinition.xml, cfglimitsdefinitionuser.xml
 * Ported from DayZ-Types-Editor Python source.
 */
const fs = require('fs');
const path = require('path');

// ─── Limits Parser ──────────────────────────────────────────

/**
 * Parse cfglimitsdefinition.xml to extract valid categories, usages, values, tags.
 */
function parseLimitsDefinition(xmlContent) {
  const result = { categories: [], usages: [], values: [], tags: [] };

  const extract = (parentTag, childTag) => {
    const parentRe = new RegExp(`<${parentTag}[^>]*>([\\s\\S]*?)<\\/${parentTag}>`, 'i');
    const parentMatch = xmlContent.match(parentRe);
    if (!parentMatch) return [];
    const body = parentMatch[1];
    const items = [];
    const childRe = new RegExp(`<${childTag}\\s+name="([^"]+)"`, 'gi');
    let m;
    while ((m = childRe.exec(body)) !== null) items.push(m[1]);
    return items.sort();
  };

  result.categories = extract('categories', 'category');
  result.usages = extract('usageflags', 'usage');
  result.values = extract('valueflags', 'value');
  result.tags = extract('tags', 'tag');
  return result;
}

/**
 * Parse cfglimitsdefinitionuser.xml to extract user group definitions.
 * Each user can contain multiple usages, categories, values, or tags.
 */
function parseUserDefinitions(xmlContent) {
  const users = {};
  const userRe = /<user\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/user>/gi;
  let userMatch;
  while ((userMatch = userRe.exec(xmlContent)) !== null) {
    const userName = userMatch[1];
    const body = userMatch[2];
    const def = { usage: [], category: [], value: [], tag: [] };
    for (const key of Object.keys(def)) {
      const childRe = new RegExp(`<${key}\\s+name="([^"]+)"`, 'gi');
      let m;
      while ((m = childRe.exec(body)) !== null) def[key].push(m[1]);
    }
    users[userName] = def;
  }
  return users;
}

/**
 * Expand a user definition into its component parts.
 */
function expandUser(userDefs, userName) {
  return userDefs[userName] || { usage: [], category: [], value: [], tag: [] };
}

// ─── Types XML Parser ───────────────────────────────────────

/**
 * Parse a types.xml file into structured items.
 * Handles <type>, numeric fields, flags, category, usage, value, tag, and user tags.
 */
function parseTypesXml(xmlContent, sourceFile, userDefs) {
  const items = [];
  const typeRe = /<type\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/type>/gi;
  let match;

  while ((match = typeRe.exec(xmlContent)) !== null) {
    const name = match[1];
    const body = match[2];

    const getInt = (tag, def) => {
      const m = body.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*<\\/${tag}>`, 'i'));
      return m ? parseInt(m[1], 10) : def;
    };

    // Parse flags
    const flagsMatch = body.match(/<flags\s+([^/]*)\/?>/i);
    const getFlag = (flagName, def) => {
      if (!flagsMatch) return def;
      const m = flagsMatch[1].match(new RegExp(`${flagName}="(\\d+)"`, 'i'));
      return m ? parseInt(m[1], 10) : def;
    };

    // Parse category
    const catMatch = body.match(/<category\s+name="([^"]+)"/i);

    // Parse multi-value tags
    const collectTags = (tag) => {
      const list = [];
      const re = new RegExp(`<${tag}\\s+name="([^"]+)"`, 'gi');
      let m;
      while ((m = re.exec(body)) !== null) list.push(m[1]);
      return list;
    };

    const usageList = collectTags('usage');
    const valueList = collectTags('value');
    const tagList = collectTags('tag');
    const originalUsers = collectTags('user');

    // Expand user definitions into usage/value/tag lists
    if (userDefs && originalUsers.length > 0) {
      for (const userName of originalUsers) {
        const expanded = expandUser(userDefs, userName);
        usageList.push(...expanded.usage);
        valueList.push(...expanded.value);
        tagList.push(...expanded.tag);
      }
    }

    items.push({
      name,
      nominal: getInt('nominal', 0),
      lifetime: getInt('lifetime', 3600),
      restock: getInt('restock', 0),
      min: getInt('min', 0),
      quantmin: getInt('quantmin', -1),
      quantmax: getInt('quantmax', -1),
      cost: getInt('cost', 100),
      category: catMatch ? catMatch[1] : null,
      usage: usageList,
      value: valueList,
      tag: tagList,
      count_in_cargo: getFlag('count_in_cargo', 0),
      count_in_hoarder: getFlag('count_in_hoarder', 0),
      count_in_map: getFlag('count_in_map', 1),
      count_in_player: getFlag('count_in_player', 0),
      crafted: getFlag('crafted', 0),
      deloot: getFlag('deloot', 0),
      original_users: originalUsers,
      source_file: sourceFile || '',
      modified: false,
    });
  }

  return items;
}

// ─── Types XML Writer ───────────────────────────────────────

/**
 * Serialize a single item back to XML string.
 */
function itemToXml(item, userDefs) {
  const lines = [`    <type name="${item.name}">`];
  lines.push(`        <nominal>${item.nominal}</nominal>`);
  lines.push(`        <lifetime>${item.lifetime}</lifetime>`);
  lines.push(`        <restock>${item.restock}</restock>`);
  lines.push(`        <min>${item.min}</min>`);
  lines.push(`        <quantmin>${item.quantmin}</quantmin>`);
  lines.push(`        <quantmax>${item.quantmax}</quantmax>`);
  lines.push(`        <cost>${item.cost}</cost>`);
  lines.push(
    `        <flags count_in_cargo="${item.count_in_cargo}" ` +
    `count_in_hoarder="${item.count_in_hoarder}" ` +
    `count_in_map="${item.count_in_map}" ` +
    `count_in_player="${item.count_in_player}" ` +
    `crafted="${item.crafted}" ` +
    `deloot="${item.deloot}"/>`
  );

  if (item.category) {
    lines.push(`        <category name="${item.category}"/>`);
  }

  // Smart user tag preservation
  const remainingUsage = [...item.usage];
  const remainingValue = [...item.value];
  const remainingTag = [...item.tag];

  if (userDefs && item.original_users && item.original_users.length > 0) {
    const preserved = [];
    for (const userName of item.original_users) {
      const def = expandUser(userDefs, userName);
      const allPresent =
        def.usage.every(u => remainingUsage.includes(u)) &&
        def.value.every(v => remainingValue.includes(v)) &&
        def.tag.every(t => remainingTag.includes(t));
      if (allPresent) {
        preserved.push(userName);
        for (const u of def.usage) { const i = remainingUsage.indexOf(u); if (i >= 0) remainingUsage.splice(i, 1); }
        for (const v of def.value) { const i = remainingValue.indexOf(v); if (i >= 0) remainingValue.splice(i, 1); }
        for (const t of def.tag) { const i = remainingTag.indexOf(t); if (i >= 0) remainingTag.splice(i, 1); }
      }
    }
    for (const u of preserved) lines.push(`        <user name="${u}"/>`);
  }

  for (const u of remainingUsage) lines.push(`        <usage name="${u}"/>`);
  for (const v of remainingValue) lines.push(`        <value name="${v}"/>`);
  for (const t of remainingTag) lines.push(`        <tag name="${t}"/>`);

  lines.push('    </type>');
  return lines.join('\n');
}

/**
 * Rebuild a complete types.xml file from items.
 * Preserves header/footer comments from original content.
 */
function buildTypesXml(items, originalContent, userDefs) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<types>');
  for (const item of items) {
    lines.push(itemToXml(item, userDefs));
  }
  lines.push('</types>');
  return lines.join('\n');
}

// ─── Economy Core Parser ────────────────────────────────────

/**
 * Parse cfgeconomycore.xml and return paths for types and spawnabletypes files.
 */
function parseEconomyCore(xmlContent) {
  const typesFiles = [];
  const ceRe = /<ce\s+folder="([^"]+)"[^>]*>([\s\S]*?)<\/ce>/gi;
  let ceMatch;
  while ((ceMatch = ceRe.exec(xmlContent)) !== null) {
    const folder = ceMatch[1];
    const body = ceMatch[2];
    // Match type="types" with name in either order
    const fileRe = /<file\s+[^>]*name="([^"]+)"[^>]*type="types"[^>]*\/?>/gi;
    const fileRe2 = /<file\s+[^>]*type="types"[^>]*name="([^"]+)"[^>]*\/?>/gi;
    let m;
    while ((m = fileRe.exec(body)) !== null) {
      typesFiles.push(folder + '/' + m[1]);
    }
    while ((m = fileRe2.exec(body)) !== null) {
      const p = folder + '/' + m[1];
      if (!typesFiles.includes(p)) typesFiles.push(p);
    }
  }
  return typesFiles;
}

module.exports = {
  parseLimitsDefinition,
  parseUserDefinitions,
  expandUser,
  parseTypesXml,
  itemToXml,
  buildTypesXml,
  parseEconomyCore,
};
