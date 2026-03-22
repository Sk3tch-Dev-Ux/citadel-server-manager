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

const VALID_FILE_TYPES = ['types', 'spawnabletypes', 'globals', 'economy', 'events', 'messages'];

/**
 * Parse cfgeconomycore.xml content into a structured object.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {{ folders: Array, rawClasses: string|null, rawDefaults: string|null }}
 */
function parseEconomyCoreXml(xmlContent) {
  const folders = [];

  // Extract the <classes>...</classes> block verbatim (to preserve on rebuild)
  const classesMatch = xmlContent.match(/<classes[\s\S]*?<\/classes>/i);
  const rawClasses = classesMatch ? classesMatch[0] : null;

  // Extract the <defaults>...</defaults> block verbatim
  const defaultsMatch = xmlContent.match(/<defaults[\s\S]*?<\/defaults>/i);
  const rawDefaults = defaultsMatch ? defaultsMatch[0] : null;

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
    xml += '    ' + rawClasses.split('\n').join('\n    ').trim() + '\n';
  }

  // Preserve the original <defaults> section
  if (rawDefaults) {
    xml += '    ' + rawDefaults.split('\n').join('\n    ').trim() + '\n';
  }

  // Write the CE folder blocks (editable part)
  for (const ce of folders) {
    if (!ce.files || ce.files.length === 0) {
      xml += `    <ce folder="${escapeXml(ce.folder)}" />\n`;
      continue;
    }
    xml += `    <ce folder="${escapeXml(ce.folder)}">\n`;
    for (const file of ce.files) {
      xml += `        <file name="${escapeXml(file.name)}" type="${escapeXml(file.type)}" />\n`;
    }
    xml += '    </ce>\n';
  }

  xml += '</economycore>\n';
  return xml;
}

/** Escape special XML characters in attribute values */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = { parseEconomyCoreXml, buildEconomyCoreXml, VALID_FILE_TYPES };
