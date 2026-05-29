/**
 * cfglimitsdefinition.xml Parser & Builder
 *
 * Parses and serializes the limits definition file which defines
 * valid categories, usage flags, value flags, and tags for the DayZ economy.
 */

const { escapeXml } = require('./xml-escape');

/**
 * Parse cfglimitsdefinition.xml content into structured data.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {{ categories: string[], usages: string[], values: string[], tags: string[] }}
 */
function parseLimitsXml(xmlContent) {
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
    return items;
  };

  result.categories = extract('categories', 'category');
  result.usages = extract('usageflags', 'usage');
  result.values = extract('valueflags', 'value');
  result.tags = extract('tags', 'tag');
  return result;
}

/**
 * Serialize limits data back to XML with proper formatting.
 *
 * @param {{ categories: string[], usages: string[], values: string[], tags: string[] }} data
 * @returns {string} Formatted XML string
 */
function buildLimitsXml(data) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<lists>');

  // Categories
  lines.push('    <categories>');
  for (const name of data.categories) {
    lines.push(`        <category name="${escapeXml(name)}"/>`);
  }
  lines.push('    </categories>');

  // Usage flags
  lines.push('    <usageflags>');
  for (const name of data.usages) {
    lines.push(`        <usage name="${escapeXml(name)}"/>`);
  }
  lines.push('    </usageflags>');

  // Value flags
  lines.push('    <valueflags>');
  for (const name of data.values) {
    lines.push(`        <value name="${escapeXml(name)}"/>`);
  }
  lines.push('    </valueflags>');

  // Tags
  lines.push('    <tags>');
  for (const name of data.tags) {
    lines.push(`        <tag name="${escapeXml(name)}"/>`);
  }
  lines.push('    </tags>');

  lines.push('</lists>');
  return lines.join('\n');
}

module.exports = {
  parseLimitsXml,
  buildLimitsXml,
};
