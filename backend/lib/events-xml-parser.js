/**
 * DayZ Events XML Parser
 * Parses and serializes events.xml for event spawn configuration.
 */

const { escapeXml, escapeXmlText } = require('./xml-escape');

// ─── Events XML Parser ──────────────────────────────────────

/**
 * Parse an events.xml file into structured event objects.
 * Handles <event>, numeric fields, flags, position, secondary, and children.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {Array} Array of event objects
 */
function parseEventsXml(xmlContent) {
  const events = [];
  const eventRe = /<event\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/event>/gi;
  let match;

  while ((match = eventRe.exec(xmlContent)) !== null) {
    const name = match[1];
    const body = match[2];

    const getInt = (tag, def) => {
      const m = body.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*<\\/${tag}>`, 'i'));
      return m ? parseInt(m[1], 10) : def;
    };

    const getText = (tag) => {
      const m = body.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*<\\/${tag}>`, 'i'));
      return m ? m[1] : null;
    };

    // Parse flags
    const flagsMatch = body.match(/<flags\s+([^/]*)\/?>/i);
    const getFlag = (flagName, def) => {
      if (!flagsMatch) return def;
      const m = flagsMatch[1].match(new RegExp(`${flagName}="(\\d+)"`, 'i'));
      return m ? parseInt(m[1], 10) : def;
    };

    // Parse children
    const children = [];
    const childrenBlockMatch = body.match(/<children>([\s\S]*?)<\/children>/i);
    if (childrenBlockMatch) {
      const childRe = /<child\s+([^/]*)\/?>/gi;
      let childMatch;
      while ((childMatch = childRe.exec(childrenBlockMatch[1])) !== null) {
        const attrs = childMatch[1];
        const getAttr = (attrName, def) => {
          const m = attrs.match(new RegExp(`${attrName}="([^"]+)"`, 'i'));
          return m ? m[1] : def;
        };
        children.push({
          type: getAttr('type', ''),
          lootmax: parseInt(getAttr('lootmax', '0'), 10),
          lootmin: parseInt(getAttr('lootmin', '0'), 10),
          max: parseInt(getAttr('max', '0'), 10),
          min: parseInt(getAttr('min', '0'), 10),
        });
      }
    }

    // Parse <limit> element — child, parent, mixed, or custom string
    const limit = getText('limit') || null;

    // Parse <active> element — 0 or 1
    const active = getInt('active', null);

    // Parse <contamination> element — 0 or 1
    const contamination = getInt('contamination', null);

    events.push({
      name,
      nominal: getInt('nominal', 0),
      min: getInt('min', 0),
      max: getInt('max', 0),
      lifetime: getInt('lifetime', 0),
      restock: getInt('restock', 0),
      saferadius: getInt('saferadius', 0),
      distanceradius: getInt('distanceradius', 0),
      cleanupradius: getInt('cleanupradius', 0),
      limit,
      active,
      contamination,
      flags: {
        deletable: getFlag('deletable', 0),
        init_random: getFlag('init_random', 0),
        remove_damaged: getFlag('remove_damaged', 0),
      },
      position: getText('position') || 'fixed',
      secondary: getText('secondary') || null,
      children,
    });
  }

  return events;
}

// ─── Events XML Writer ──────────────────────────────────────

/**
 * Serialize a single event object back to XML string.
 *
 * @param {object} event - Event object
 * @returns {string} XML fragment
 */
function eventToXml(event) {
  const lines = [`    <event name="${escapeXml(event.name)}">`];
  lines.push(`        <nominal>${event.nominal}</nominal>`);
  lines.push(`        <min>${event.min}</min>`);
  lines.push(`        <max>${event.max}</max>`);
  lines.push(`        <lifetime>${event.lifetime}</lifetime>`);
  lines.push(`        <restock>${event.restock}</restock>`);
  lines.push(`        <saferadius>${event.saferadius}</saferadius>`);
  lines.push(`        <distanceradius>${event.distanceradius}</distanceradius>`);
  lines.push(`        <cleanupradius>${event.cleanupradius}</cleanupradius>`);

  if (event.limit != null) {
    lines.push(`        <limit>${event.limit}</limit>`);
  }

  if (event.active != null) {
    lines.push(`        <active>${event.active}</active>`);
  }

  if (event.contamination != null) {
    lines.push(`        <contamination>${event.contamination}</contamination>`);
  }

  if (event.secondary) {
    lines.push(`        <secondary>${escapeXmlText(event.secondary)}</secondary>`);
  }

  const flags = event.flags || {};
  lines.push(
    `        <flags deletable="${flags.deletable || 0}" ` +
    `init_random="${flags.init_random || 0}" ` +
    `remove_damaged="${flags.remove_damaged || 0}"/>`
  );

  lines.push(`        <position>${escapeXmlText(event.position || 'fixed')}</position>`);

  if (event.children && event.children.length > 0) {
    lines.push('        <children>');
    for (const child of event.children) {
      lines.push(
        `            <child lootmax="${child.lootmax}" lootmin="${child.lootmin}" ` +
        `max="${child.max}" min="${child.min}" type="${escapeXml(child.type)}"/>`
      );
    }
    lines.push('        </children>');
  }

  lines.push('    </event>');
  return lines.join('\n');
}

/**
 * Rebuild a complete events.xml file from an array of event objects.
 *
 * @param {Array} events - Array of event objects
 * @returns {string} Complete XML string
 */
function buildEventsXml(events) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');
  lines.push('<events>');
  for (const event of events) {
    lines.push(eventToXml(event));
  }
  lines.push('</events>');
  return lines.join('\n');
}

module.exports = {
  parseEventsXml,
  eventToXml,
  buildEventsXml,
};
