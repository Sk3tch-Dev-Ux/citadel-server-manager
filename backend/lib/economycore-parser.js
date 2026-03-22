/**
 * Parser/builder for cfgeconomycore.xml — the Central Economy loader config.
 *
 * Each <ce folder="X"> contains <file name="..." type="..." /> entries that
 * tell the CE engine which XML files to load from each mission sub-folder.
 */

const VALID_FILE_TYPES = ['types', 'spawnabletypes', 'globals', 'economy', 'events', 'messages'];

/**
 * Parse cfgeconomycore.xml content into a structured array.
 *
 * @param {string} xmlContent - Raw XML string
 * @returns {Array<{folder: string, files: Array<{name: string, type: string}>}>}
 */
function parseEconomyCoreXml(xmlContent) {
  const folders = [];

  // Match each <ce folder="..."> ... </ce> block (or self-closing)
  const ceRegex = /<ce\s+folder="([^"]*)"([^>]*?)(?:\/>|>([\s\S]*?)<\/ce>)/gi;
  let ceMatch;

  while ((ceMatch = ceRegex.exec(xmlContent)) !== null) {
    const folderName = ceMatch[1];
    const innerContent = ceMatch[3] || '';
    const files = [];

    // Match each <file ... /> inside the ce block
    const fileRegex = /<file\s+name="([^"]*?)"\s+type="([^"]*?)"\s*\/>/gi;
    let fileMatch;
    while ((fileMatch = fileRegex.exec(innerContent)) !== null) {
      files.push({ name: fileMatch[1], type: fileMatch[2] });
    }

    folders.push({ folder: folderName, files });
  }

  return folders;
}

/**
 * Build cfgeconomycore.xml from a structured array.
 *
 * @param {Array<{folder: string, files: Array<{name: string, type: string}>}>} folders
 * @returns {string} Formatted XML string
 */
function buildEconomyCoreXml(folders) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n';
  xml += '<economycore>\n';

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
