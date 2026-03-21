/**
 * DayZ cfgplayerspawnpoints.xml Parser
 * Parses and rebuilds cfgplayerspawnpoints.xml which defines player spawn locations
 * for fresh spawns, server hops, and travel spawns.
 */

// ─── Parser ──────────────────────────────────────────────────

/**
 * Parse cfgplayerspawnpoints.xml content into spawn point data.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {{ fresh: Array<{x: number, z: number}>, hop: Array<{x: number, z: number}>, travel: Array<{x: number, z: number}> }}
 */
function parseSpawnPoints(xmlContent) {
  const result = { fresh: [], hop: [], travel: [] };

  for (const group of ['fresh', 'hop', 'travel']) {
    const groupRe = new RegExp(`<${group}[^>]*>([\\s\\S]*?)<\\/${group}>`, 'i');
    const groupMatch = groupRe.exec(xmlContent);
    if (!groupMatch) continue;

    const body = groupMatch[1];
    const pointRe = /<spawn_point\s+x="([^"]+)"\s+z="([^"]+)"\s*\/>/gi;
    let pointMatch;

    while ((pointMatch = pointRe.exec(body)) !== null) {
      result[group].push({
        x: parseFloat(pointMatch[1]) || 0,
        z: parseFloat(pointMatch[2]) || 0,
      });
    }
  }

  return result;
}

// ─── Builder ─────────────────────────────────────────────────

/**
 * Serialize spawn point data back to XML string.
 *
 * @param {{ fresh: Array<{x: number, z: number}>, hop: Array<{x: number, z: number}>, travel: Array<{x: number, z: number}> }} data
 * @returns {string} XML content
 */
function buildSpawnPoints(data) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<playerspawnpoints>',
  ];

  for (const group of ['fresh', 'hop', 'travel']) {
    const points = data[group] || [];
    lines.push(`    <${group}>`);
    for (const pt of points) {
      lines.push(`        <spawn_point x="${fmtCoord(pt.x)}" z="${fmtCoord(pt.z)}" />`);
    }
    lines.push(`    </${group}>`);
  }

  lines.push('</playerspawnpoints>');
  return lines.join('\n') + '\n';
}

/**
 * Format a coordinate value with one decimal place.
 */
function fmtCoord(val) {
  const n = parseFloat(val) || 0;
  return n.toFixed(1);
}

module.exports = {
  parseSpawnPoints,
  buildSpawnPoints,
};
