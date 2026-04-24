## Citadel v2.8.0 — Daily Ops

The features you touch every session got the polish they deserved.

### Console (full rebuild)
- **Command history** — ↑/↓ arrows recall your last 50 commands per server, persisted across sessions
- **Favorites bar** — star commands to pin above the input for one-click re-run
- **Live autocomplete** — matching RCON verbs with descriptions as you type, Tab or Enter to accept
- **Inline help** — current command's description shown below the input
- **Output filters** — All / Server / RCON toggle; double-click a line to copy it
- `/rcon/commands` endpoint exposes the current whitelist so autocomplete stays in sync

### Logs (multi-filter + export)
- **Message-contains search** (debounced)
- **Multi-select source filter** — chip row with counts for every distinct source
- **Time range presets** — 15m / 1h / 6h / 24h / all time
- **CSV export** — one-click download of filtered logs with server name in filename
- **Live-feed pause/resume** — study a window without new entries sliding in
- All filters combinable — complex queries in a single view

### System Dashboard (alerts + trends)
- **Threshold alerts** — CPU/RAM/disk over threshold fires in-app notification with 15-min cooldown. Bell lights up + toast pops; you don't have to be watching the dashboard
- **24-hour rolling metric history** via a new background sampler (CPU/RAM every 30s, disk every 10min)
- **Trend view** with 15m / 1h / 6h / 24h selector; server-side downsampled to render smoothly
- **Threshold banner** at the top when a metric is currently over limit
- **"Cloud Offline" badge now clickable** — links to subscription page with explanation

See the full changelog at https://citadels.cc/docs/changelog
