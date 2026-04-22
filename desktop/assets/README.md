# Citadel Desktop — Assets

Binary assets required for branding. These are generated in **Phase 3** (installer polish) once the EV code-signing cert ships.

## Required files

| File | Purpose | Spec |
|---|---|---|
| `icon.ico` | Windows app & installer icon | 256x256 multi-resolution ICO (contains 16/32/48/64/128/256 sizes) |
| `tray.png` | System tray icon | 16x16 or 32x32 PNG, monochrome or subtly-colored so it reads on Windows 11 dark + light taskbars |
| `icon.png` | Fallback app icon | 512x512 PNG |

## Source of truth

The brand mark lives at `web/frontend/public/citadel-logo.svg` (and a copy at `docs/public/citadel-logo.svg`). All icons below should derive from that SVG.

## Generating

Using ImageMagick (one option — any SVG-to-ICO pipeline works):

```bash
# icon.ico — multi-resolution
magick citadel-logo.svg -define icon:auto-resize=16,32,48,64,128,256 icon.ico

# tray.png — monochrome 32x32
magick citadel-logo.svg -resize 32x32 -colorspace gray tray.png

# icon.png — 512x512 fallback
magick citadel-logo.svg -resize 512x512 icon.png
```

## Until these exist

`main.js` and `tray.js` gracefully handle missing assets — Electron falls back to the default OS icon. The app still launches, just without branding.
