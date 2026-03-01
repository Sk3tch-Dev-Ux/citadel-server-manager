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
- `.bat` launch files — Extracts launch parameters

## Profile Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the server |
| `installDir` | string | Path to the DayZ server installation |
| `gamePort` | number | Game port (default: 2302) |
| `steamQueryPort` | number | Steam query port (default: 27016) |
| `rconPort` | number | BattlEye RCON port |
| `rconPassword` | string | RCON password |
| `map` | string | Map name (e.g., `chernarusplus`, `enoch`) |
| `launchParams` | string | Additional launch parameters |
| `maxPlayers` | number | Maximum player slots |
| `providers` | array | Ordered list of action providers |

## Multi-Server Setup

Citadel supports managing multiple DayZ servers from a single dashboard. Each server has its own:

- Profile configuration
- Provider chain
- Scheduler jobs
- Backup settings
- Mod list

Simply add additional server profiles through the dashboard or API.
