/**
 * serverDZ.cfg parser and writer for DayZ servers.
 */
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

function getServerCfgPath(installDir) {
  return path.join(installDir, 'serverDZ.cfg');
}

function readServerConfig(installDir) {
  const cfgPath = getServerCfgPath(installDir);
  const config = {};
  if (!fs.existsSync(cfgPath)) return config;
  try {
    const content = fs.readFileSync(cfgPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('class') || trimmed === '{' || trimmed === '};') continue;
      const match = trimmed.match(/^([\w]+)\s*=\s*(.+?)\s*;/);
      if (match) {
        const key = match[1];
        let value = match[2].trim();
        const ci = value.indexOf('//');
        if (ci > 0) value = value.substring(0, ci).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (/^\d+$/.test(value)) value = parseInt(value, 10);
        else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);
        config[key] = value;
      }
    }
  } catch (err) {
    logger.warn({ err, installDir }, 'Failed to read serverDZ.cfg');
  }
  return config;
}

function writeServerConfig(installDir, updates) {
  const cfgPath = getServerCfgPath(installDir);
  if (!fs.existsSync(cfgPath)) return false;
  try {
    const backupDir = path.join(installDir, '.backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(cfgPath, path.join(backupDir, `serverDZ.cfg.${Date.now()}.bak`));
    let content = fs.readFileSync(cfgPath, 'utf8');
    const appended = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined) continue;
      const strValue = typeof value === 'string' ? `"${value}"` : String(value);
      const regex = new RegExp(`^(\\s*${key}\\s*=\\s*).+?(\\s*;.*)$`, 'm');
      if (regex.test(content)) {
        // Key exists in file — update in place (including clearing to empty)
        content = content.replace(regex, `$1${strValue}$2`);
      } else if (value !== '' && value !== 0 && value !== false) {
        // Key doesn't exist yet — only append if value is meaningful
        // (skip empty/zero/false to avoid cluttering cfg with defaults the user never set)
        appended.push(`${key} = ${strValue};`);
      }
    }
    // Append new keys at the end of the file
    if (appended.length > 0) {
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      if (!content.endsWith(eol)) content += eol;
      content += eol + '// Added by Citadel' + eol;
      content += appended.join(eol) + eol;
    }
    fs.writeFileSync(cfgPath, content, 'utf8');
    return true;
  } catch (err) {
    logger.error({ err, installDir }, 'Failed to write serverDZ.cfg');
    return false;
  }
}

module.exports = { getServerCfgPath, readServerConfig, writeServerConfig };
