#!/usr/bin/env node
/**
 * Citadel Installer Build Script
 *
 * Stages all files, downloads Node.js runtime, builds the frontend,
 * installs production dependencies, and invokes NSIS to produce the final installer.
 *
 * Usage:
 *   node installer/build.js
 *
 * Prerequisites:
 *   - NSIS (makensis) must be installed and on PATH
 *     Install via: choco install nsis   (or download from nsis.sourceforge.io)
 *
 * Output:
 *   build/CitadelSetup-{version}.exe
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const { createWriteStream } = require('fs');

// ─── Config ──────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const STAGING_DIR = path.join(BUILD_DIR, 'staging');
const CACHE_DIR = path.join(BUILD_DIR, 'cache');

const NODE_VERSION = '20.18.1';
const NODE_ARCH = 'win-x64';
const NODE_ZIP = `node-v${NODE_VERSION}-${NODE_ARCH}.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

const NSSM_VERSION = '2.24';
const NSSM_ZIP = `nssm-${NSSM_VERSION}.zip`;
// Multiple download sources — nssm.cc is unreliable
const NSSM_URLS = [
  `https://nssm.cc/release/${NSSM_ZIP}`,
  `https://nssm.cc/ci/${NSSM_ZIP}`,
];

const pkg = require(path.join(ROOT, 'package.json'));
const VERSION = pkg.version || '2.0.0';

// Files/dirs to copy into the installer staging area
const COPY_ITEMS = [
  'backend',
  'discord-bot',
  'web',
  'package.json',
  'package-lock.json',
  '.env.example',
];

// Directories to exclude from the copy
const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  '__tests__',
  'test',
  '.claude',
];

// ─── Helpers ─────────────────────────────────────────────

function log(msg) {
  console.log(`  [build] ${msg}`);
}

function run(cmd, opts = {}) {
  log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ensureDir(dir);
}

/**
 * Recursively copy a directory, excluding specified subdirectories.
 */
function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Download a file via HTTPS with redirect support.
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (url) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    request(url);
  });
}

// ─── Build Steps ─────────────────────────────────────────

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   Citadel Installer Build v' + VERSION.padEnd(10) + '║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // Step 1: Clean staging directory
  log('Step 1/6: Cleaning build directory...');
  cleanDir(STAGING_DIR);
  ensureDir(CACHE_DIR);

  // Step 2: Download Node.js runtime
  log('Step 2/6: Downloading Node.js runtime...');
  const cachedZip = path.join(CACHE_DIR, NODE_ZIP);
  if (fs.existsSync(cachedZip)) {
    log(`  Using cached ${NODE_ZIP}`);
  } else {
    log(`  Downloading ${NODE_URL}`);
    await download(NODE_URL, cachedZip);
    log('  Download complete');
  }

  // Extract node.exe from the zip
  const runtimeDir = path.join(STAGING_DIR, 'runtime');
  ensureDir(runtimeDir);
  log('  Extracting node.exe...');
  // Use PowerShell to extract just node.exe from the zip
  run(
    `powershell -NoProfile -Command "` +
    `Add-Type -Assembly System.IO.Compression.FileSystem; ` +
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${cachedZip.replace(/\\/g, '\\\\')}'); ` +
    `$entry = $zip.Entries | Where-Object { $_.Name -eq 'node.exe' } | Select-Object -First 1; ` +
    `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${path.join(runtimeDir, 'node.exe').replace(/\\/g, '\\\\')}', $true); ` +
    `$zip.Dispose()"`,
    { cwd: ROOT }
  );
  log('  node.exe extracted');

  // Download and extract NSSM (service wrapper)
  const nssmDest = path.join(runtimeDir, 'nssm.exe');
  const cachedNssmZip = path.join(CACHE_DIR, NSSM_ZIP);

  if (fs.existsSync(cachedNssmZip)) {
    log(`  Using cached ${NSSM_ZIP}`);
  } else {
    log('  Downloading NSSM service wrapper...');
    let downloaded = false;
    for (const url of NSSM_URLS) {
      try {
        log(`  Trying ${url}`);
        await download(url, cachedNssmZip);
        log('  NSSM download complete');
        downloaded = true;
        break;
      } catch (err) {
        log(`  Failed: ${err.message}`);
        if (fs.existsSync(cachedNssmZip)) fs.unlinkSync(cachedNssmZip);
      }
    }
    if (!downloaded) {
      // Fall back: try to find nssm.exe on PATH (e.g. installed via choco install nssm)
      log('  All download URLs failed — checking PATH for nssm.exe...');
      try {
        const whereResult = execSync('where nssm.exe', { encoding: 'utf8', windowsHide: true }).trim().split('\n')[0].trim();
        if (whereResult && fs.existsSync(whereResult)) {
          fs.copyFileSync(whereResult, nssmDest);
          log(`  Copied nssm.exe from ${whereResult}`);
        } else {
          throw new Error('not found');
        }
      } catch {
        throw new Error(
          'Failed to download NSSM and nssm.exe not found on PATH.\n' +
          '  Install via: choco install nssm\n' +
          '  Or download manually from https://nssm.cc/download'
        );
      }
    }
  }

  // Extract nssm.exe from zip (skip if already copied from PATH)
  if (!fs.existsSync(nssmDest) && fs.existsSync(cachedNssmZip)) {
    log('  Extracting nssm.exe...');
    run(
      `powershell -NoProfile -Command "` +
      `Add-Type -Assembly System.IO.Compression.FileSystem; ` +
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${cachedNssmZip.replace(/\\/g, '\\\\')}'); ` +
      `$entry = $zip.Entries | Where-Object { $_.FullName -match 'win64/nssm.exe$' } | Select-Object -First 1; ` +
      `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${nssmDest.replace(/\\/g, '\\\\')}', $true); ` +
      `$zip.Dispose()"`,
      { cwd: ROOT }
    );
    log('  nssm.exe extracted');
  }

  // Step 3: Copy application files
  log('Step 3/6: Copying application files...');
  const appDir = path.join(STAGING_DIR, 'app');
  ensureDir(appDir);
  for (const item of COPY_ITEMS) {
    const src = path.join(ROOT, item);
    const dest = path.join(appDir, item);
    if (!fs.existsSync(src)) {
      log(`  WARNING: ${item} not found, skipping`);
      continue;
    }
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
    }
    log(`  Copied ${item}`);
  }

  // Step 4: Build frontend
  log('Step 4/6: Building frontend...');
  const frontendDir = path.join(appDir, 'web', 'frontend');
  if (fs.existsSync(frontendDir)) {
    run('npm install', { cwd: frontendDir });
    run('npm run build', { cwd: frontendDir });
    // Remove frontend source (only dist is needed)
    const srcDir = path.join(frontendDir, 'src');
    if (fs.existsSync(srcDir)) fs.rmSync(srcDir, { recursive: true, force: true });
    // Remove frontend node_modules (not needed at runtime)
    const fmods = path.join(frontendDir, 'node_modules');
    if (fs.existsSync(fmods)) fs.rmSync(fmods, { recursive: true, force: true });
    log('  Frontend built and cleaned');
  }

  // Step 5: Install production dependencies
  log('Step 5/6: Installing production dependencies...');
  // Install root-level deps
  run('npm install --production --ignore-scripts', { cwd: appDir });
  // Install backend deps
  const backendDir = path.join(appDir, 'backend');
  if (fs.existsSync(path.join(backendDir, 'package.json'))) {
    run('npm install --production', { cwd: backendDir });
    log('  Backend dependencies installed');
  }
  // Install discord-bot deps
  const discordDir = path.join(appDir, 'discord-bot');
  if (fs.existsSync(path.join(discordDir, 'package.json'))) {
    run('npm install --production', { cwd: discordDir });
    log('  Discord bot dependencies installed');
  }

  // Step 6: Build NSIS installer
  log('Step 6/6: Building NSIS installer...');
  const nsisScript = path.join(ROOT, 'installer', 'citadel.nsi');
  if (!fs.existsSync(nsisScript)) {
    throw new Error('citadel.nsi not found at ' + nsisScript);
  }

  // Check if makensis is available
  try {
    execSync('makensis /VERSION', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'makensis not found on PATH. Install NSIS:\n' +
      '  choco install nsis\n' +
      '  Or download from https://nsis.sourceforge.io/Download'
    );
  }

  run(
    `makensis /DVERSION=${VERSION} /DSTAGING_DIR=${STAGING_DIR.replace(/\\/g, '\\\\')} /DOUTPUT_DIR=${BUILD_DIR.replace(/\\/g, '\\\\')} "${nsisScript}"`,
    { cwd: ROOT }
  );

  console.log('');
  log('Build complete!');
  log(`Installer: build/CitadelSetup-${VERSION}.exe`);
  console.log('');
}

main().catch(err => {
  console.error('');
  console.error(`  [build] ERROR: ${err.message}`);
  console.error('');
  process.exit(1);
});
