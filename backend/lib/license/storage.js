/**
 * Local license cache — persists the activation token and metadata in
 * `data/license.json` so we can survive restarts without re-activating.
 */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../paths');

const LICENSE_FILE = path.join(ROOT, 'data', 'license.json');

function read() {
  try {
    if (!fs.existsSync(LICENSE_FILE)) return null;
    const raw = fs.readFileSync(LICENSE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(data) {
  try {
    const dir = path.dirname(LICENSE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function clear() {
  try {
    if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
    return true;
  } catch {
    return false;
  }
}

module.exports = { read, write, clear, LICENSE_FILE };
