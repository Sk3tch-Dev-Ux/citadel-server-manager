'use strict';

/**
 * Shared XML escaping helpers for the mission-file (economy) serializers.
 *
 * DayZ mission XML (types.xml, events.xml, globals.xml, cfglimitsdefinition.xml,
 * cfgspawnabletypes.xml, cfgeventspawns.xml, cfgeconomycore.xml) is hand-built
 * via template strings throughout backend/lib/*-parser.js. Any user-supplied
 * value that contains `&`, `<`, `>`, `"` or `'` will otherwise produce malformed
 * XML that the DayZ server silently rejects on boot — corrupting the economy.
 *
 * Use {@link escapeXml} for attribute values (collapses CR/LF/TAB to a single
 * space, since XML attributes cannot span lines), and {@link escapeXmlText} for
 * element text content (preserves whitespace).
 */

const ENTITY_RE = /[&<>"']/g;
const ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/**
 * Escape the five predefined XML entities in an attribute value and collapse
 * any embedded CR/LF/TAB to a single space (attributes cannot contain raw
 * newlines without being reformatted by parsers).
 *
 * @param {*} str - value to escape; coerced to string
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(ENTITY_RE, (c) => ENTITIES[c])
    .replace(/[\r\n\t]+/g, ' ');
}

/**
 * Escape the five predefined XML entities in element text content, preserving
 * whitespace.
 *
 * @param {*} str - value to escape; coerced to string
 * @returns {string}
 */
function escapeXmlText(str) {
  return String(str).replace(ENTITY_RE, (c) => ENTITIES[c]);
}

module.exports = { escapeXml, escapeXmlText };
