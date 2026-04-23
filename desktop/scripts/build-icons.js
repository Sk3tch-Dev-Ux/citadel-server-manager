#!/usr/bin/env node
/**
 * Generate Electron + NSIS icon assets from assets/citadel-logo.svg.
 *
 * Outputs:
 *   assets/icon.ico   — Multi-resolution ICO (16, 24, 32, 48, 64, 128, 256) for Windows installer + app.exe
 *   assets/icon.png   — 512×512 PNG (electron-builder accepts this as fallback)
 *   assets/tray.png   — 32×32 PNG for the system tray icon
 *
 * Requires @resvg/resvg-js (pure JS SVG renderer, no native build) and
 * png-to-ico (tiny PNG→ICO packer). Installed as devDependencies.
 *
 * Safe to re-run — deterministic output per input SVG.
 */
const fs = require('node:fs');
const path = require('node:path');

const ASSETS_DIR = path.resolve(__dirname, '..', 'assets');
const SVG_PATH = path.join(ASSETS_DIR, 'citadel-logo.svg');

async function main() {
  if (!fs.existsSync(SVG_PATH)) {
    throw new Error(`Source SVG not found: ${SVG_PATH}`);
  }
  const svg = fs.readFileSync(SVG_PATH);

  const { Resvg } = require('@resvg/resvg-js');
  const pngToIco = require('png-to-ico');

  // Sizes bundled into the ICO. Covers taskbar, Alt-Tab, installer, Explorer.
  const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of ICO_SIZES) {
    const rendered = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      background: 'transparent',
    }).render();
    const pngBuffer = rendered.asPng();
    pngs.push(pngBuffer);
  }

  // Combined multi-resolution ICO
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), ico);
  console.log(`  ✓ icon.ico  (${ICO_SIZES.join(', ')}px)`);

  // 512×512 PNG — electron-builder uses this directly if present
  const big = new Resvg(svg, {
    fitTo: { mode: 'width', value: 512 },
    background: 'transparent',
  }).render();
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), big.asPng());
  console.log('  ✓ icon.png  (512×512)');

  // 32×32 tray icon
  const tray = new Resvg(svg, {
    fitTo: { mode: 'width', value: 32 },
    background: 'transparent',
  }).render();
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray.png'), tray.asPng());
  console.log('  ✓ tray.png  (32×32)');
}

main().catch((err) => {
  console.error('Icon build failed:', err.message);
  process.exit(1);
});
