/**
 * Parser/builder for cfgeconomycore.xml — the Central Economy loader config.
 *
 * The file has three main sections:
 *   1. <classes> — Root class definitions (weapons, items, characters, vehicles)
 *   2. <defaults> — Default CE parameters and logging flags
 *   3. <ce> blocks — Folder/file mappings that tell CE which XML files to load
 *
 * IMPORTANT: The builder preserves the original <classes> and <defaults> sections
 * verbatim. Only the <ce> blocks are editable through the UI.
 */

const { escapeXml } = require('./xml-escape');

const VALID_FILE_TYPES = ['types', 'spawnabletypes', 'globals', 'economy', 'events', 'messages'];

/**
 * Strict regex for valid CE folder names.
 * Allows alphanumeric, hyphens, underscores, and single-level subdirectories.
 * Blocks path traversal (../), absolute paths, and special characters.
 */
const VALID_FOLDER_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*(\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/;

/**
 * Strict regex for valid XML file names.
 * Must end in .xml, only allows safe characters.
 */
const VALID_FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-. ]*\.xml$/i;

/**
 * Validate a CE folder name against path traversal and injection attacks.
 * @param {string} name
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateFolderName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, reason: 'Folder name is required' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Folder name cannot be empty' };
  }
  if (trimmed.length > 128) {
    return { valid: false, reason: 'Folder name too long (max 128 characters)' };
  }
  if (trimmed.includes('..')) {
    return { valid: false, reason: 'Folder name cannot contain ".."' };
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[A-Z]:/i.test(trimmed)) {
    return { valid: false, reason: 'Folder name cannot be an absolute path' };
  }
  if (!VALID_FOLDER_REGEX.test(trimmed)) {
    return { valid: false, reason: 'Folder name contains invalid characters (use letters, numbers, hyphens, underscores)' };
  }
  return { valid: true };
}

/**
 * Validate a file name.
 * @param {string} name
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateFileName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, reason: 'File name is required' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'File name cannot be empty' };
  }
  if (trimmed.length > 128) {
    return { valid: false, reason: 'File name too long (max 128 characters)' };
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return { valid: false, reason: 'File name cannot contain path separators' };
  }
  if (!VALID_FILENAME_REGEX.test(trimmed)) {
    return { valid: false, reason: 'File name must end in .xml and contain only letters, numbers, hyphens, underscores, dots, or spaces' };
  }
  return { valid: true };
}

/**
 * Parse cfgeconomycore.xml content into a structured object.
 *
 * Uses bounded matching to avoid ReDoS on malformed XML.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {{ folders: Array, rawClasses: string|null, rawDefaults: string|null }}
 */
function parseEconomyCoreXml(xmlContent) {
  if (!xmlContent || typeof xmlContent !== 'string') {
    return { folders: [], rawClasses: null, rawDefaults: null };
  }

  // Limit input size to prevent DoS (10MB should cover any real config)
  if (xmlContent.length > 10 * 1024 * 1024) {
    throw new Error('cfgeconomycore.xml is too large to parse (>10MB)');
  }

  const folders = [];

  // Extract the <classes>...</classes> block verbatim (to preserve on rebuild).
  // Use indexOf-based extraction instead of [\s\S]*? regex to avoid ReDoS.
  const rawClasses = extractBlock(xmlContent, 'classes');
  const rawDefaults = extractBlock(xmlContent, 'defaults');

  // Match each <ce folder="..."> ... </ce> block (or self-closing)
  const ceRegex = /<ce\s+folder="([^"]*)"([^>]*?)(?:\/>|>([\s\S]*?)<\/ce>)/gi;
  let ceMatch;

  while ((ceMatch = ceRegex.exec(xmlContent)) !== null) {
    const folderName = ceMatch[1];
    const innerContent = ceMatch[3] || '';
    const files = [];

    // Match <file> entries — handle attributes in any order
    const fileRegex = /<file\s+([^>]*?)\s*\/>/gi;
    let fileMatch;
    while ((fileMatch = fileRegex.exec(innerContent)) !== null) {
      const attrs = fileMatch[1];
      const nameMatch = attrs.match(/name="([^"]*)"/);
      const typeMatch = attrs.match(/type="([^"]*)"/);
      if (nameMatch && typeMatch) {
        files.push({ name: nameMatch[1], type: typeMatch[1] });
      }
    }

    folders.push({ folder: folderName, files });
  }

  return { folders, rawClasses, rawDefaults };
}

/**
 * Extract a top-level XML block by tag name using indexOf (ReDoS-safe).
 * Returns the full block including tags, or null if not found.
 *
 * @param {string} xml
 * @param {string} tagName
 * @returns {string|null}
 */
function extractBlock(xml, tagName) {
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  const startIdx = xml.indexOf(openTag);
  if (startIdx === -1) return null;
  const endIdx = xml.indexOf(closeTag, startIdx);
  if (endIdx === -1) return null; // Unclosed tag — don't attempt greedy match
  return xml.substring(startIdx, endIdx + closeTag.length);
}

/**
 * Build cfgeconomycore.xml from structured data.
 * Preserves the original <classes> and <defaults> sections verbatim.
 *
 * @param {Array<{folder: string, files: Array<{name: string, type: string}>}>} folders
 * @param {string|null} rawClasses - Original <classes> block to preserve
 * @param {string|null} rawDefaults - Original <defaults> block to preserve
 * @returns {string} Formatted XML string
 */
function buildEconomyCoreXml(folders, rawClasses, rawDefaults) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n';
  xml += '<economycore>\n';

  // Preserve the original <classes> section
  if (rawClasses) {
    xml += '    ' + normalizeIndent(rawClasses) + '\n';
  }

  // Preserve the original <defaults> section
  if (rawDefaults) {
    xml += '    ' + normalizeIndent(rawDefaults) + '\n';
  }

  // Write the CE folder blocks (editable part)
  for (const ce of folders) {
    const safeFolderName = escapeXml(ce.folder);

    if (!ce.files || ce.files.length === 0) {
      xml += `    <ce folder="${safeFolderName}" />\n`;
      continue;
    }
    xml += `    <ce folder="${safeFolderName}">\n`;
    for (const file of ce.files) {
      xml += `        <file name="${escapeXml(file.name)}" type="${escapeXml(file.type)}" />\n`;
    }
    xml += '    </ce>\n';
  }

  xml += '</economycore>\n';
  return xml;
}

/**
 * Normalize indentation for a block being re-inserted.
 * Handles both \r\n and \n line endings.
 */
function normalizeIndent(block) {
  return block.replace(/\r\n/g, '\n').split('\n').join('\n    ').trim();
}

module.exports = {
  parseEconomyCoreXml,
  buildEconomyCoreXml,
  escapeXml,
  validateFolderName,
  validateFileName,
  VALID_FILE_TYPES,
  VALID_FOLDER_REGEX,
  VALID_FILENAME_REGEX,
};
