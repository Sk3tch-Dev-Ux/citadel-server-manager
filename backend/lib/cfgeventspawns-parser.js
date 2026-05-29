/**
 * DayZ cfgeventspawns.xml Parser
 * Parses and serializes cfgeventspawns.xml for map-based event spawn editing.
 *
 * This file lives at the mission root (not in db/).
 * Format:
 *   <eventposdef>
 *     <event name="...">
 *       <pos x="..." z="..." a="..." y="..." group="..." />
 *       <zone smin="..." smax="..." dmin="..." dmax="..." r="..." />
 *     </event>
 *   </eventposdef>
 *
 * A <zone> element always follows its corresponding <pos> and belongs to that position.
 */

const { escapeXml } = require('./xml-escape');

// ─── cfgeventspawns.xml Parser ─────────────────────────────────

/**
 * Parse a cfgeventspawns.xml file into structured event objects.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {{ events: Array }} Parsed structure
 */
function parseCfgEventSpawns(xmlContent) {
  const events = [];
  const eventRe = /<event\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/event>/gi;
  // Also match self-closing / empty events: <event name="Foo" /> or <event name="Foo"></event>
  const eventSelfCloseRe = /<event\s+name="([^"]*)"[^/]*\/>/gi;
  let match;

  while ((match = eventRe.exec(xmlContent)) !== null) {
    const name = match[1];
    const body = match[2];
    const positions = parsePositions(body);
    events.push({ name, positions });
  }

  // Handle self-closing event tags (no children)
  while ((match = eventSelfCloseRe.exec(xmlContent)) !== null) {
    const name = match[1];
    // Avoid duplicates if already matched by the block regex
    if (!events.some(e => e.name === name)) {
      events.push({ name, positions: [] });
    }
  }

  return { events };
}

/**
 * Parse all <pos> and <zone> elements inside an event body.
 * A <zone> always follows its corresponding <pos>.
 *
 * @param {string} body - Inner XML of an <event> block
 * @returns {Array} Array of position objects
 */
function parsePositions(body) {
  const positions = [];

  // Match all <pos .../> and <zone .../> tags in order
  const tagRe = /<(pos|zone)\s+([^/]*?)\/?>/gi;
  let tagMatch;
  let currentPos = null;

  while ((tagMatch = tagRe.exec(body)) !== null) {
    const tagName = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2];

    if (tagName === 'pos') {
      // Flush previous position
      if (currentPos) {
        positions.push(currentPos);
      }

      const getFloat = (name) => {
        const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
        return m ? parseFloat(m[1]) : null;
      };
      const getString = (name) => {
        const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
        return m ? m[1] : null;
      };

      currentPos = {
        x: getFloat('x'),
        z: getFloat('z'),
        a: getFloat('a'),
        y: getFloat('y'),
        group: getString('group'),
        zone: null,
      };
    } else if (tagName === 'zone' && currentPos) {
      const getZoneInt = (name) => {
        const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
        return m ? parseInt(m[1], 10) : 0;
      };

      currentPos.zone = {
        smin: getZoneInt('smin'),
        smax: getZoneInt('smax'),
        dmin: getZoneInt('dmin'),
        dmax: getZoneInt('dmax'),
        r: getZoneInt('r'),
      };
    }
  }

  // Flush last position
  if (currentPos) {
    positions.push(currentPos);
  }

  return positions;
}

// ─── cfgeventspawns.xml Writer ─────────────────────────────────

/**
 * Serialize a single position object to XML string(s).
 *
 * @param {object} pos - Position object
 * @returns {string} XML fragment (pos line, optionally followed by zone line)
 */
function positionToXml(pos) {
  const parts = [];

  // Build <pos> attributes
  let posAttrs = '';
  if (pos.x != null) posAttrs += ` x="${pos.x}"`;
  if (pos.z != null) posAttrs += ` z="${pos.z}"`;
  if (pos.a != null) posAttrs += ` a="${pos.a}"`;
  if (pos.y != null) posAttrs += ` y="${pos.y}"`;
  if (pos.group) posAttrs += ` group="${escapeXml(pos.group)}"`;

  parts.push(`        <pos${posAttrs} />`);

  // If zone data is attached, emit it on the next line
  if (pos.zone) {
    const z = pos.zone;
    parts.push(`        <zone smin="${z.smin}" smax="${z.smax}" dmin="${z.dmin}" dmax="${z.dmax}" r="${z.r}" />`);
  }

  return parts.join('\n');
}

/**
 * Serialize a single event object to XML string.
 *
 * @param {object} event - Event object { name, positions }
 * @returns {string} XML fragment
 */
function eventSpawnToXml(event) {
  if (!event.positions || event.positions.length === 0) {
    return `    <event name="${escapeXml(event.name)}">\n    </event>`;
  }

  const lines = [`    <event name="${escapeXml(event.name)}">`];
  for (const pos of event.positions) {
    lines.push(positionToXml(pos));
  }
  lines.push('    </event>');
  return lines.join('\n');
}

/**
 * Rebuild a complete cfgeventspawns.xml file from the parsed structure.
 *
 * @param {{ events: Array }} data - Parsed structure
 * @returns {string} Complete XML string
 */
function buildCfgEventSpawns(data) {
  const events = data.events || data;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');
  lines.push('<eventposdef>');
  for (const event of events) {
    lines.push(eventSpawnToXml(event));
  }
  lines.push('</eventposdef>');
  return lines.join('\n');
}

module.exports = {
  parseCfgEventSpawns,
  buildCfgEventSpawns,
  eventSpawnToXml,
};
