# Citadel Desktop

Native Windows desktop app for Citadel. A thin Electron shell that wraps the web dashboard served by the Citadel backend service.

## Architecture

```
┌─────────────────────────────────────┐
│   Citadel Desktop (Electron app)    │  ← this package
│   - System tray, native menus       │
│   - Auto-update                     │
│   - Window chrome                   │
└─────────────┬───────────────────────┘
              │ loads http://localhost:3001
              ▼
┌─────────────────────────────────────┐
│   Citadel Service (NSSM)            │  ← ../backend + ../web
│   - Express API + Socket.IO         │
│   - Serves React dashboard          │
│   - Runs 24/7, survives logoff      │
└─────────────────────────────────────┘
```

The desktop app is a **client** of the service. The service is always the authoritative runtime; Electron just provides a nicer native surface.

## Development

```bash
cd desktop
npm install
npm start          # or npm run dev for verbose logging
```

This assumes the backend is already running on `http://localhost:3001`. From the repo root:

```bash
npm run dev        # starts backend + Vite frontend dev server
cd desktop
npm start          # in a second terminal
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CITADEL_URL` | `http://localhost:3001` | URL the desktop app loads |
| `CITADEL_WAIT_TIMEOUT_MS` | `60000` | How long to wait for backend before showing error |
| `CITADEL_DEV` | unset | When set, extra dev logging |

## Build

```bash
npm run build      # produces dist/CitadelDesktop-{version}.exe (NSIS installer)
npm run pack       # unpacked build for testing (dist/win-unpacked/)
```

Builds require the EV code-signing cert (Phase 3). Without it, the build still succeeds but the output is unsigned — Windows SmartScreen will warn users.

## Files

- `src/main.js` — main process entry
- `src/preload.js` — contextBridge exposed to renderer
- `src/service-manager.js` — polls backend health
- `src/tray.js` — system tray
- `src/menu.js` — application menu bar
- `splash/index.html` — loading / error screen
- `assets/` — icon files (see assets/README.md)
