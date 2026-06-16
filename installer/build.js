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
const crypto = require('crypto');
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
// SHA256 of the official nssm-2.24.zip from nssm.cc/release/. Pinned so a
// compromised download mirror can't ship a tampered binary that ends up
// running as LOCAL SYSTEM on customer machines (audit L27).
//
// To populate / rotate: download nssm-X.Y.zip directly from
// https://nssm.cc/release/ on a known-clean machine, verify it boots and
// behaves, then compute via:
//
//   PowerShell:  Get-FileHash -Algorithm SHA256 nssm-X.Y.zip
//   POSIX:       sha256sum nssm-X.Y.zip
//
// Set this constant to the lowercase hex digest. Setting it to '' (empty
// string) makes the build emit a loud warning but still succeed — that
// keeps existing CI pipelines green on the first commit, with a clear
// signal to fill it in. Once set, a mismatch is fatal.
const NSSM_SHA256 = process.env.NSSM_SHA256 || '';

const pkg = require(path.join(ROOT, 'package.json'));
const VERSION = pkg.version || '2.0.0';

// Files/dirs to copy into the installer staging area.
//
// The Discord bot was extracted to the separate citadel-bot repo / Citadel
// Cloud in the v2.19.0 product split, where discord-bot/DEPRECATED.md kept the
// folder bundled "for one release only" behind the CITADEL_AGENT_SPAWN_BOT=1
// legacy escape hatch. That one-release compat window is long past (we are at
// v2.21.9, ~9 releases later), so discord-bot/ is no longer staged into the
// installer — customers run the bot via citadel-bot / Citadel Cloud. The
// CITADEL_AGENT_SPAWN_BOT=1 path still works for from-source installs that have
// the folder; for installer builds it now no-ops gracefully (bot-manager's
// spawn error handler logs and skips when discord-bot/bot.js is absent).
const COPY_ITEMS = [
  'backend',
  'web',
  // The sidecar is the per-server IPC bridge to the @CitadelAdmin in-game mod
  // (live map positions, admin actions, killfeed). A non-bundled install
  // resolves SIDECAR_ENTRY to <root>/sidecar/server.js (see backend/lib/paths.js);
  // if this folder isn't staged the sidecar spawn exits code 1 on every server
  // start and the mod bridge is dead. MUST be staged + have its prod deps
  // installed (Step 5).
  'sidecar',
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
  // opts.display lets a caller log a REDACTED form of the command (e.g. to keep
  // a signing password out of CI logs) while still executing the real one.
  const { display, ...execOpts } = opts;
  log(`> ${display || cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...execOpts });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Locate makensis.exe. Checks PATH first, then common Windows install
 * locations so the build works in shells where PATH is stale right after
 * a fresh NSIS install (classic papercut).
 *
 * Returns absolute path to makensis.exe, or null if not found.
 */
function findMakensis() {
  // 1. Try PATH via `where.exe` (Windows built-in)
  try {
    const out = execSync('where.exe makensis', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch { /* fall through */ }

  // 2. Try common install locations
  const candidates = [
    'C:\\Program Files (x86)\\NSIS\\makensis.exe',
    'C:\\Program Files\\NSIS\\makensis.exe',
    // Chocolatey sometimes shims here
    process.env.ProgramData && path.join(process.env.ProgramData, 'chocolatey', 'bin', 'makensis.exe'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      // Probe it with /VERSION to confirm it's executable
      try {
        execSync(`"${c}" /VERSION`, { stdio: 'pipe' });
        return c;
      } catch { /* not runnable, try next */ }
    }
  }
  return null;
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
    const cleanup = (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    };
    file.on('error', cleanup);
    const request = (url) => {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          cleanup(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', cleanup);
    };
    request(url);
  });
}

/**
 * Compute SHA256 of a file on disk as a lowercase hex string.
 */
function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/**
 * Fetch a small text resource over HTTPS with redirect support.
 */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Fetch failed: HTTP ${res.statusCode} ${u}`));
        }
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    };
    request(url);
  });
}

/**
 * Verify a downloaded NSSM zip against the pinned NSSM_SHA256 constant.
 * If NSSM_SHA256 is the empty string (rotation pending), warn loudly but
 * don't fail the build — the build still works, the customer is just
 * trusting nssm.cc for that particular release.
 */
function verifyNssmChecksum(zipPath) {
  if (!NSSM_SHA256) {
    log('  ⚠ NSSM_SHA256 is not set — skipping verification.');
    log('    To enable: compute sha256 of a known-good nssm-' + NSSM_VERSION + '.zip,');
    log('    then set NSSM_SHA256 in installer/build.js (or export NSSM_SHA256=...).');
    return;
  }
  const expected = NSSM_SHA256.toLowerCase();
  const actual = sha256File(zipPath).toLowerCase();
  if (expected !== actual) {
    throw new Error(
      `SHA256 mismatch for ${NSSM_ZIP}!\n` +
      `  expected: ${expected}\n` +
      `  actual:   ${actual}\n` +
      `  This could mean nssm.cc has shipped a new build (rotate NSSM_SHA256)\n` +
      `  OR the download was tampered with. Verify the source before updating.`
    );
  }
  log(`  ✓ NSSM SHA256 verified`);
}

/**
 * Verify a downloaded Node.js zip against the official SHASUMS256.txt that
 * nodejs.org publishes alongside every release. Throws on mismatch so we
 * never ship a tampered runtime.
 */
async function verifyNodeChecksum(zipPath) {
  const shasumsUrl = `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`;
  log(`  Verifying ${NODE_ZIP} against ${shasumsUrl}`);
  const shasums = await fetchText(shasumsUrl);
  const line = shasums.split('\n').find((l) => l.endsWith(`  ${NODE_ZIP}`));
  if (!line) {
    throw new Error(`Expected hash for ${NODE_ZIP} not found in SHASUMS256.txt`);
  }
  const expected = line.split(/\s+/)[0].toLowerCase();
  const actual = sha256File(zipPath).toLowerCase();
  if (expected !== actual) {
    throw new Error(
      `SHA256 mismatch for ${NODE_ZIP}!\n` +
      `  expected: ${expected}\n` +
      `  actual:   ${actual}\n` +
      `  This could mean the download was corrupted or tampered with. Delete ` +
      `  ${zipPath} and re-run the build.`
    );
  }
  log(`  ✓ SHA256 verified`);
}

// ─── Build Steps ─────────────────────────────────────────

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   Citadel Installer Build v' + VERSION.padEnd(10) + '║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // Step 1: Clean staging directory
  log('Step 1/7: Cleaning build directory...');
  cleanDir(STAGING_DIR);
  ensureDir(CACHE_DIR);

  // Step 2: Download Node.js runtime
  log('Step 2/7: Downloading Node.js runtime...');
  const cachedZip = path.join(CACHE_DIR, NODE_ZIP);
  if (fs.existsSync(cachedZip)) {
    log(`  Using cached ${NODE_ZIP}`);
  } else {
    log(`  Downloading ${NODE_URL}`);
    await download(NODE_URL, cachedZip);
    log('  Download complete');
  }

  // Verify checksum against Node.js's official SHASUMS256.txt — catches a
  // corrupted download or a MITM-tampered zip. Always run, even on cached.
  await verifyNodeChecksum(cachedZip);

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
    // Verify cached zips too — protects against an attacker who managed
    // to drop a tampered file into build/cache/ between builds.
    verifyNssmChecksum(cachedNssmZip);
  } else {
    log('  Downloading NSSM service wrapper...');
    let downloaded = false;
    for (const url of NSSM_URLS) {
      try {
        log(`  Trying ${url}`);
        await download(url, cachedNssmZip);
        log('  NSSM download complete');
        verifyNssmChecksum(cachedNssmZip);
        downloaded = true;
        break;
      } catch (err) {
        log(`  Failed: ${err.message}`);
        // If verify failed, the cached file is bad. Delete it so the next
        // attempt has a chance to re-download from a different mirror.
        try { fs.unlinkSync(cachedNssmZip); } catch { /* ignore */ }
      }
    }
    if (!downloaded) {
      // Fall back: try to find the real nssm.exe (not Chocolatey shims)
      log('  All download URLs failed — searching for nssm.exe...');
      let found = false;

      // Check Chocolatey's actual binary location first (shims on PATH are ~60KB wrappers)
      const chocoBase = process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey';
      const chocoNssmPaths = [
        path.join(chocoBase, 'lib', 'NSSM', 'tools', 'win64', 'nssm.exe'),
        path.join(chocoBase, 'lib', 'nssm', 'tools', 'win64', 'nssm.exe'),
        path.join(chocoBase, 'lib', 'NSSM', 'tools', 'nssm.exe'),
        path.join(chocoBase, 'lib', 'nssm', 'tools', 'nssm.exe'),
      ];
      for (const p of chocoNssmPaths) {
        if (fs.existsSync(p)) {
          const stat = fs.statSync(p);
          if (stat.size > 100000) { // Real nssm.exe is >200KB; shims are ~60KB
            fs.copyFileSync(p, nssmDest);
            log(`  Copied real nssm.exe from ${p} (${stat.size} bytes)`);
            found = true;
            break;
          }
        }
      }

      // Fall back to PATH, but verify it's not a shim
      if (!found) {
        try {
          const whereResult = execSync('where nssm.exe', { encoding: 'utf8', windowsHide: true }).trim().split('\n')[0].trim();
          if (whereResult && fs.existsSync(whereResult)) {
            const stat = fs.statSync(whereResult);
            if (stat.size > 100000) {
              fs.copyFileSync(whereResult, nssmDest);
              log(`  Copied nssm.exe from ${whereResult} (${stat.size} bytes)`);
              found = true;
            } else {
              log(`  Skipping ${whereResult} — appears to be a Chocolatey shim (${stat.size} bytes)`);
            }
          }
        } catch { /* not on PATH */ }
      }

      if (!found) {
        throw new Error(
          'Failed to download NSSM and real nssm.exe not found locally.\n' +
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
  log('Step 3/7: Copying application files...');
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
  log('Step 4/7: Building frontend...');
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
  log('Step 5/7: Installing production dependencies...');
  // Install root-level deps
  run('npm install --production --ignore-scripts', { cwd: appDir });
  // Install backend deps
  const backendDir = path.join(appDir, 'backend');
  if (fs.existsSync(path.join(backendDir, 'package.json'))) {
    run('npm install --production', { cwd: backendDir });
    log('  Backend dependencies installed');
  }
  // Install sidecar deps — the sidecar is spawned as its own node process
  // (express/pino/uuid/dotenv) and needs its own node_modules or it exits
  // code 1 the moment a server starts.
  const sidecarDir = path.join(appDir, 'sidecar');
  if (fs.existsSync(path.join(sidecarDir, 'package.json'))) {
    run('npm install --production', { cwd: sidecarDir });
    log('  Sidecar dependencies installed');
  }
  // (discord-bot/ is no longer staged — see COPY_ITEMS above — so there are no
  // bot dependencies to install. The bot lives in the citadel-bot repo / Cloud.)

  // Step 6: Build Electron desktop app
  log('Step 6/7: Building Electron desktop app...');
  const desktopSrcDir = path.join(ROOT, 'desktop');
  if (fs.existsSync(path.join(desktopSrcDir, 'package.json'))) {
    // Keep the Electron app's version in lockstep with the root version that
    // stamps latest.yml. electron-updater compares app.getVersion() (baked from
    // desktop/package.json at pack time) against latest.yml's version; if they
    // drift, a fresh install reports the old version forever and shows a
    // perpetual "update available" prompt. Syncing here means a single root
    // version bump is always sufficient.
    const desktopPkgPath = path.join(desktopSrcDir, 'package.json');
    const desktopPkg = JSON.parse(fs.readFileSync(desktopPkgPath, 'utf-8'));
    if (desktopPkg.version !== VERSION) {
      log(`  Syncing desktop/package.json version ${desktopPkg.version} -> ${VERSION}`);
      desktopPkg.version = VERSION;
      fs.writeFileSync(desktopPkgPath, JSON.stringify(desktopPkg, null, 2) + '\n', 'utf-8');
    }
    const desktopNodeModules = path.join(desktopSrcDir, 'node_modules');
    if (!fs.existsSync(desktopNodeModules)) {
      log('  Installing desktop/ dependencies (first run — downloads Electron ~150MB)...');
      run('npm install', { cwd: desktopSrcDir });
    }
    // Build the FULL nsis target (not --dir). electron-updater's silent
    // self-update spawns <install>/desktop/resources/elevate.exe to trigger
    // the per-machine UAC elevation; `--dir` never produces that helper, so
    // quitAndInstall failed with "spawn elevate.exe ENOENT" and the app
    // relaunched on the old version → perpetual "update available" loop.
    // The full nsis build downloads the NSIS resources and lays elevate.exe
    // into win-unpacked/resources/. `--publish never` stops electron-builder
    // from pushing its own CitadelDesktop-*.exe to GitHub Releases in CI
    // (we ship CitadelSetup via citadel.nsi, not electron-builder's installer).
    log('  Running electron-builder (full nsis target, --publish never)...');
    run('npm run build -- --publish never', { cwd: desktopSrcDir });

    // The full build still produces dist/win-unpacked/ (plus an installer we
    // ignore). win-unpacked now contains resources/elevate.exe.
    const unpackedDir = path.join(desktopSrcDir, 'dist', 'win-unpacked');
    if (!fs.existsSync(unpackedDir)) {
      throw new Error(`Electron output not found at ${unpackedDir}`);
    }
    const stagingDesktop = path.join(STAGING_DIR, 'desktop');
    ensureDir(stagingDesktop);
    copyDir(unpackedDir, stagingDesktop);
    log(`  Desktop app staged at ${stagingDesktop}`);

    // Hard gate: the in-app auto-updater is dead without elevate.exe. Fail the
    // build loudly here rather than ship another silent self-update loop.
    const elevateExe = path.join(stagingDesktop, 'resources', 'elevate.exe');
    if (!fs.existsSync(elevateExe)) {
      throw new Error(
        'desktop/resources/elevate.exe missing after the electron-builder build. ' +
        'The in-app auto-updater cannot elevate without it (spawn ENOENT → update loop). ' +
        'Confirm the win target is "nsis" and the build was a full (non --dir) run.'
      );
    }
    log('  Verified elevate.exe present for auto-updater elevation');

    // ─── Generate app-update.yml ─────────────────────────────
    // electron-updater reads this file at runtime to know which provider
    // to query for new releases. It's normally auto-generated by
    // electron-builder during a full `dist` build, but our `--dir` mode
    // (which only produces unpacked binaries) doesn't always emit it.
    // We write it ourselves so the auto-updater never fires the dreaded
    // "ENOENT app-update.yml" error.
    //
    // Path must be exactly `<install>/desktop/resources/app-update.yml`
    // because that's what electron-updater hard-codes to look for.
    const resourcesDir = path.join(stagingDesktop, 'resources');
    ensureDir(resourcesDir);
    const appUpdateYml =
      'provider: github\n' +
      'owner: Sk3tch-Dev-Ux\n' +
      'repo: DayzServerController\n' +
      'updaterCacheDirName: citadel-updater\n';
    fs.writeFileSync(path.join(resourcesDir, 'app-update.yml'), appUpdateYml, 'utf-8');
    log('  Wrote app-update.yml for electron-updater');
  } else {
    log('  desktop/ not found — skipping (backend-only build)');
  }

  // Step 7: Build NSIS installer
  log('Step 7/7: Building NSIS installer...');
  const nsisScript = path.join(ROOT, 'installer', 'citadel.nsi');
  if (!fs.existsSync(nsisScript)) {
    throw new Error('citadel.nsi not found at ' + nsisScript);
  }

  // Resolve makensis — try PATH first, then common Windows install locations.
  // This keeps the build working across shells where PATH may be stale right
  // after a fresh NSIS install.
  const makensisExe = findMakensis();
  if (!makensisExe) {
    throw new Error(
      'makensis not found. Install NSIS:\n' +
      '  choco install nsis\n' +
      '  Or download from https://nsis.sourceforge.io/Download\n' +
      'Checked: PATH, C:\\Program Files (x86)\\NSIS\\, C:\\Program Files\\NSIS\\'
    );
  }
  log(`  Using NSIS at: ${makensisExe}`);

  run(
    `"${makensisExe}" /DVERSION=${VERSION} /DSTAGING_DIR=${STAGING_DIR.replace(/\\/g, '\\\\')} /DOUTPUT_DIR=${BUILD_DIR.replace(/\\/g, '\\\\')} "${nsisScript}"`,
    { cwd: ROOT }
  );

  // ─── Code-sign the NSIS .exe (audit N4) ────────────────────
  // Sign before computing the sha512 so the hash in latest.yml matches the
  // file users actually download. electron-updater verifies the hash; if we
  // sign AFTER hashing, every update would fail integrity verification.
  //
  // Opt-in: only runs when both CITADEL_SIGN_PFX and CITADEL_SIGN_PASSWORD
  // env vars are set. Skipped silently with a heads-up log otherwise so
  // dev builds (and the public CI workflow until a cert lands) keep working.
  //
  // The release runbook is in installer/SIGNING.md.
  const installerPath = path.join(BUILD_DIR, `CitadelSetup-${VERSION}.exe`);
  if (!fs.existsSync(installerPath)) {
    throw new Error(`Expected installer at ${installerPath} — NSIS build did not produce it.`);
  }
  signInstallerIfConfigured(installerPath);

  // ─── Generate latest.yml for electron-updater ──────────────
  // electron-updater reads this file from the GitHub Release to discover
  // new versions. Since we use a custom NSIS installer (not electron-builder's
  // built-in one), we have to produce latest.yml ourselves.
  log('Generating latest.yml for auto-updater...');
  const installerBuffer = fs.readFileSync(installerPath);
  const sha512 = crypto.createHash('sha512').update(installerBuffer).digest('base64');
  const size = installerBuffer.length;
  const releaseDate = new Date().toISOString();
  const installerName = `CitadelSetup-${VERSION}.exe`;

  // electron-updater's expected YAML shape. Keep indentation as-is — the parser
  // is permissive but consistency helps debugging.
  const latestYml =
    `version: ${VERSION}\n` +
    `files:\n` +
    `  - url: ${installerName}\n` +
    `    sha512: ${sha512}\n` +
    `    size: ${size}\n` +
    `path: ${installerName}\n` +
    `sha512: ${sha512}\n` +
    `releaseDate: '${releaseDate}'\n`;

  const latestYmlPath = path.join(BUILD_DIR, 'latest.yml');
  fs.writeFileSync(latestYmlPath, latestYml, 'utf-8');

  console.log('');
  log('Build complete!');
  log(`Installer: build/CitadelSetup-${VERSION}.exe`);
  log(`Update manifest: build/latest.yml  (upload alongside the .exe to GitHub Releases)`);
  console.log('');
}

/**
 * Audit N4 — sign the produced installer with the operator's code-signing
 * certificate, if one is configured via env vars. Skipped (with a loud log
 * message) when unconfigured so dev builds and the unsigned CI path keep
 * working.
 *
 * Env vars (all required for the step to run):
 *   CITADEL_SIGN_PFX           Absolute path to the PFX/PKCS12 cert file.
 *   CITADEL_SIGN_PASSWORD      Password that unlocks the PFX.
 *   CITADEL_SIGN_TIMESTAMP_URL Optional. RFC 3161 timestamp URL. Defaults
 *                              to http://timestamp.digicert.com.
 *
 * Requires `signtool.exe` on PATH. On Windows the standard locations are
 * the Windows 10/11 SDK (`C:\Program Files (x86)\Windows Kits\10\bin\<ver>\x64\signtool.exe`).
 * GitHub's `windows-latest` runner ships it preinstalled in the SDK.
 *
 * On macOS / Linux dev hosts the step is a no-op (we couldn't sign even if
 * configured — signtool is Windows-only). The CI runner is Windows.
 */
function signInstallerIfConfigured(installerPath) {
  const pfx = process.env.CITADEL_SIGN_PFX;
  const password = process.env.CITADEL_SIGN_PASSWORD;
  if (!pfx || !password) {
    log('⚠️  Code-signing skipped — CITADEL_SIGN_PFX / CITADEL_SIGN_PASSWORD not set.');
    log('   Users will see a SmartScreen "Unknown publisher" warning. See installer/SIGNING.md.');
    return;
  }
  if (process.platform !== 'win32') {
    log(`⚠️  Code-signing skipped — signtool.exe is Windows-only (host is ${process.platform}).`);
    return;
  }
  if (!fs.existsSync(pfx)) {
    throw new Error(`CITADEL_SIGN_PFX points at "${pfx}" but the file does not exist.`);
  }
  const timestampUrl = process.env.CITADEL_SIGN_TIMESTAMP_URL || 'http://timestamp.digicert.com';
  log(`Signing ${path.basename(installerPath)} with ${path.basename(pfx)}...`);
  // /tr  — RFC 3161 timestamp server (counter-signs the signature so the
  //        installer stays valid after the cert expires)
  // /td  — digest algorithm for the timestamp request (sha256)
  // /fd  — digest algorithm for the file signature (sha256)
  // /f /p  — pfx + password
  // signtool will exit non-zero on any failure (bad password, expired cert,
  // network error contacting the timestamp server, etc.) — `run` throws.
  const signCmd = `signtool sign /tr "${timestampUrl}" /td sha256 /fd sha256 /f "${pfx}" /p "${password}" "${installerPath}"`;
  run(signCmd, {
    cwd: ROOT,
    stdio: 'inherit',
    // Never log the real /p "<password>" — redact it for the build/CI log.
    display: signCmd.replace(`/p "${password}"`, '/p "***"'),
  });
  // Re-verify the signature just landed correctly. If signtool reported
  // success but the file isn't actually signed (rare driver glitch),
  // this catches it before we publish a "signed" release that isn't.
  run(`signtool verify /pa "${installerPath}"`, { cwd: ROOT, stdio: 'inherit' });
  log(`✓ Signed and verified ${path.basename(installerPath)}`);
}

main().catch(err => {
  console.error('');
  console.error(`  [build] ERROR: ${err.message}`);
  console.error('');
  process.exit(1);
});
