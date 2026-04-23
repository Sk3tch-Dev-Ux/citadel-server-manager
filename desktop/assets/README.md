# Citadel Desktop — Assets

All icon files in this folder are **generated** from `citadel-logo.svg` by `scripts/build-icons.js`. Don't edit them by hand.

## Files

| File | Generated | Purpose |
|---|---|---|
| `citadel-logo.svg` | Source (edit this) | Master logo — purple shield with C cut-out |
| `icon.ico` | Auto | Multi-res Windows icon: 16/24/32/48/64/128/256. Used by the NSIS installer + Electron app.exe + Windows Explorer. |
| `icon.png` | Auto | 512×512 fallback PNG. electron-builder uses it if ICO is missing. |
| `tray.png` | Auto | 32×32 PNG for the system tray icon. |

## Regenerating

After editing `citadel-logo.svg`, rerun:

```bash
npm run build:icons
```

This also runs automatically as the `prepack` script whenever you `npm run build` or `npm run pack` the Electron app.

## Tooling

- **@resvg/resvg-js** — pure-JS SVG → PNG renderer (no native build step)
- **png-to-ico** — tiny PNG → multi-resolution ICO packer

Both are installed as devDependencies.
