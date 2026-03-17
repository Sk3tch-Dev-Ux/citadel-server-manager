#!/usr/bin/env node
/**
 * Citadel Build Script — esbuild bundler + zip packager.
 *
 * Bundles each entry point (backend, discord-bot, sidecar) into a single JS
 * file with all dependencies inlined. Eliminates node_modules entirely,
 * preventing all CJS/ESM incompatibility issues.
 *
 * Usage:
 *   node build/bundle.js
 *
 * Output:
 *   dist/Citadel-{version}-win-x64.zip
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const { createWriteStream } = require('fs');

// ─── Config ──────────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const STAGING_DIR = path.join(DIST_DIR, 'staging', 'Citadel');
const CACHE_DIR = path.join(DIST_DIR, 'cache');

const NODE_VERSION = '20.18.1';
const NODE_ARCH = 'win-x64';
const NODE_ZIP = `node-v${NODE_VERSION}-${NODE_ARCH}.zip`;
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ZIP}`;

const NSSM_VERSION = '2.24';
const NSSM_ZIP = `nssm-${NSSM_VERSION}.zip`;
const NSSM_URLS = [
  `https://nssm.cc/release/${NSSM_ZIP}`,
  `https://nssm.cc/ci/${NSSM_ZIP}`,
];

const pkg = require(path.join(ROOT, 'package.json'));
const VERSION = pkg.version || '2.0.0';

// Entry points to bundle
const BUNDLES = [
  {
    name: 'citadel-server',
    entry: path.join(ROOT, 'backend', 'server.js'),
    output: path.join(STAGING_DIR, 'citadel-server.js'),
  },
  {
    name: 'citadel-discord-bot',
    entry: path.join(ROOT, 'discord-bot', 'bot.js'),
    output: path.join(STAGING_DIR, 'citadel-discord-bot.js'),
  },
  {
    name: 'citadel-sidecar',
    entry: path.join(ROOT, 'sidecar', 'server.js'),
    output: path.join(STAGING_DIR, 'citadel-sidecar.js'),
  },
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

function copyDir(src, dest, exclude = []) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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

function psEscape(p) { return p.replace(/\\/g, '\\\\'); }

// ─── Build Steps ─────────────────────────────────────────

async function main() {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   Citadel Bundle Build v' + VERSION.padEnd(10) + '  ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // Step 1: Clean
  log('Step 1/7: Cleaning build directory...');
  cleanDir(STAGING_DIR);
  ensureDir(CACHE_DIR);

  // Step 2: Install dependencies (needed for esbuild to resolve)
  log('Step 2/7: Installing dependencies...');
  if (!fs.existsSync(path.join(ROOT, 'backend', 'node_modules'))) {
    run('npm install', { cwd: path.join(ROOT, 'backend') });
  }
  if (fs.existsSync(path.join(ROOT, 'discord-bot', 'package.json'))) {
    if (!fs.existsSync(path.join(ROOT, 'discord-bot', 'node_modules'))) {
      run('npm install', { cwd: path.join(ROOT, 'discord-bot') });
    }
  }
  if (fs.existsSync(path.join(ROOT, 'sidecar', 'package.json'))) {
    if (!fs.existsSync(path.join(ROOT, 'sidecar', 'node_modules'))) {
      run('npm install', { cwd: path.join(ROOT, 'sidecar') });
    }
  }

  // Step 3: Bundle with esbuild
  log('Step 3/7: Bundling with esbuild...');

  // Ensure esbuild is available
  try {
    require.resolve('esbuild');
  } catch {
    log('  Installing esbuild...');
    run('npm install --save-dev esbuild', { cwd: path.join(ROOT, 'backend') });
  }

  const esbuild = require('esbuild');

  for (const bundle of BUNDLES) {
    if (!fs.existsSync(bundle.entry)) {
      log(`  Skipping ${bundle.name} (entry not found: ${bundle.entry})`);
      continue;
    }

    log(`  Bundling ${bundle.name}...`);
    try {
      const result = await esbuild.build({
        entryPoints: [bundle.entry],
        outfile: bundle.output,
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        minify: false,
        sourcemap: false,
        // Mark optional/unavailable packages as external
        external: [
          'cftools-sdk',     // Optional lazy-loaded SDK
          'pino-pretty',     // Dev-only, graceful fallback exists
          'bufferutil',      // Optional native ws optimization
          'utf-8-validate',  // Optional native ws optimization
        ],
        define: {
          '__CITADEL_BUNDLED__': 'true',
        },
        // Suppress warnings about require() of dynamic expressions
        logLevel: 'warning',
        banner: {
          js: '/* Citadel v' + VERSION + ' — bundled with esbuild */',
        },
      });

      if (result.errors.length > 0) {
        console.error(`  Errors bundling ${bundle.name}:`, result.errors);
        process.exit(1);
      }
      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          log(`  Warning: ${w.text}`);
        }
      }

      const size = fs.statSync(bundle.output).size;
      log(`  ${bundle.name}.js — ${(size / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.error(`  Failed to bundle ${bundle.name}: ${err.message}`);
      process.exit(1);
    }
  }

  // Step 4: Build frontend
  log('Step 4/7: Building frontend...');
  const frontendDir = path.join(ROOT, 'web', 'frontend');
  const webDistDir = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(frontendDir)) {
    run('npm install', { cwd: frontendDir });
    run('npm run build', { cwd: frontendDir });
    // Copy web/dist to staging
    if (fs.existsSync(webDistDir)) {
      copyDir(webDistDir, path.join(STAGING_DIR, 'web', 'dist'));
      log('  Frontend built and copied');
    } else {
      log('  WARNING: web/dist not found after build');
    }
  }

  // Step 5: Download Node.js runtime
  log('Step 5/7: Downloading Node.js runtime...');
  const cachedZip = path.join(CACHE_DIR, NODE_ZIP);
  if (fs.existsSync(cachedZip)) {
    log(`  Using cached ${NODE_ZIP}`);
  } else {
    log(`  Downloading ${NODE_URL}`);
    await download(NODE_URL, cachedZip);
    log('  Download complete');
  }

  // Extract node.exe → citadel-node.exe
  const nodeExeDest = path.join(STAGING_DIR, 'citadel-node.exe');
  log('  Extracting node.exe → citadel-node.exe...');
  run(
    `powershell -NoProfile -Command "` +
    `Add-Type -Assembly System.IO.Compression.FileSystem; ` +
    `$zip = [System.IO.Compression.ZipFile]::OpenRead('${psEscape(cachedZip)}'); ` +
    `$entry = $zip.Entries | Where-Object { $_.Name -eq 'node.exe' } | Select-Object -First 1; ` +
    `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${psEscape(nodeExeDest)}', $true); ` +
    `$zip.Dispose()"`
  );
  log('  citadel-node.exe extracted');

  // Step 6: Download and extract NSSM
  log('Step 6/7: Downloading NSSM...');
  const nssmDest = path.join(STAGING_DIR, 'nssm.exe');
  const cachedNssmZip = path.join(CACHE_DIR, NSSM_ZIP);

  if (fs.existsSync(cachedNssmZip)) {
    log(`  Using cached ${NSSM_ZIP}`);
  } else {
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
      }
    }
    if (!downloaded) {
      // Try Chocolatey's actual binary (not the shim)
      const chocoBase = process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey';
      const chocoNssmPaths = [
        path.join(chocoBase, 'lib', 'NSSM', 'tools', 'win64', 'nssm.exe'),
        path.join(chocoBase, 'lib', 'nssm', 'tools', 'win64', 'nssm.exe'),
        path.join(chocoBase, 'lib', 'NSSM', 'tools', 'nssm.exe'),
        path.join(chocoBase, 'lib', 'nssm', 'tools', 'nssm.exe'),
      ];
      let found = false;
      for (const p of chocoNssmPaths) {
        if (fs.existsSync(p) && fs.statSync(p).size > 100000) {
          fs.copyFileSync(p, nssmDest);
          log(`  Copied real nssm.exe from ${p}`);
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error('Failed to download NSSM. Install via: choco install nssm');
      }
    }
  }

  if (!fs.existsSync(nssmDest) && fs.existsSync(cachedNssmZip)) {
    log('  Extracting nssm.exe...');
    run(
      `powershell -NoProfile -Command "` +
      `Add-Type -Assembly System.IO.Compression.FileSystem; ` +
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${psEscape(cachedNssmZip)}'); ` +
      `$entry = $zip.Entries | Where-Object { $_.FullName -match 'win64/nssm.exe$' } | Select-Object -First 1; ` +
      `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, '${psEscape(nssmDest)}', $true); ` +
      `$zip.Dispose()"`
    );
    log('  nssm.exe extracted');
  }

  // Copy supporting files
  const envExample = path.join(ROOT, '.env.example');
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(STAGING_DIR, '.env.example'));
  }

  // Copy install/uninstall scripts
  for (const script of ['install.ps1', 'uninstall.ps1']) {
    const src = path.join(ROOT, script);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(STAGING_DIR, script));
    }
  }

  // Step 7: Create zip
  log('Step 7/7: Creating zip archive...');
  const zipName = `Citadel-v${VERSION}-win-x64.zip`;
  const zipPath = path.join(DIST_DIR, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  run(
    `powershell -NoProfile -Command "` +
    `Compress-Archive -Path '${psEscape(STAGING_DIR)}' -DestinationPath '${psEscape(zipPath)}' -Force"`
  );

  const zipSize = fs.statSync(zipPath).size;
  console.log('');
  log('Build complete!');
  log(`Output: dist/${zipName} (${(zipSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log('');
}

main().catch(err => {
  console.error('');
  console.error(`  [build] ERROR: ${err.message}`);
  console.error('');
  process.exit(1);
});
