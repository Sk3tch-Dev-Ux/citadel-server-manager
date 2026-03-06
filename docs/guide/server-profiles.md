# Server Profiles

Server profiles store the configuration for each DayZ server instance managed by Citadel.

## Creating a Profile

### Via Dashboard

1. Navigate to **Servers** in the sidebar
2. Click **Add Server**
3. Fill in the server details or use **Auto-Detect** to scan an existing installation

### Via Auto-Detect

Citadel can automatically detect an existing DayZ server:

```bash
POST /api/servers/detect
{
  "path": "C:\\DayZServer"
}
```

This scans the directory for:
- `serverDZ.cfg` — Parses hostname, ports, passwords
- `@` mod folders — Detects installed mods
- Executable and launch parameters

## Profile Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the server |
| `installDir` | string | Path to the DayZ server installation |
| `gamePort` | number | Game port (default: 2302) |
| `steamQueryPort` | number | Steam query port (default: gamePort + 1, typically 2303) |
| `rconPort` | number | BattlEye RCON port |
| `rconPassword` | string | RCON password |
| `map` | string | Map name (e.g., `chernarusplus`, `enoch`) |
| `launchParams` | string | Additional launch parameters |
| `maxPlayers` | number | Maximum player slots |
| `providers` | array | Ordered list of action providers |

## Default Launch Parameters

When deploying a server through Citadel, the following launch parameters are automatically configured:

```
-config=serverDZ.cfg -ip=0.0.0.0 -port=2302 -steamQueryPort=2303 -profiles=profiles -dologs -adminlog -netlog -freezecheck
```

| Parameter | Purpose |
|-----------|---------|
| `-ip=0.0.0.0` | Bind to all network interfaces (required for external access) |
| `-port=2302` | Game port |
| `-steamQueryPort=2303` | Steam query port (must match `steamQueryPort` in `serverDZ.cfg`) |
| `-profiles=profiles` | Profile directory for RPT logs, BattlEye config, and mod configs |
| `-dologs -adminlog -netlog` | Enable logging |
| `-freezecheck` | Enable freeze detection |

::: warning
The `-ip=0.0.0.0` and `-steamQueryPort=` parameters are critical. Without them, the server will not be reachable by Steam for queries or the server browser.
:::

## Multi-Server Setup

Citadel supports managing multiple DayZ servers from a single dashboard. Each server has its own:

- Profile configuration
- Provider chain
- Scheduler jobs
- Backup settings
- Mod list

Simply add additional server profiles through the dashboard or API.
