# Mod Management

Citadel can install, update, and manage Steam Workshop mods for your DayZ servers.

## Prerequisites

- [SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD) installed on the server
- `STEAMCMD_PATH` configured in `.env`
- Steam account credentials (for Workshop access)

## Installing Mods

### Via Dashboard

1. Navigate to your server's **Mods** tab
2. Enter a Steam Workshop ID or URL
3. Click **Install**
4. Progress is streamed in real-time via WebSocket

### Via API

```bash
POST /api/servers/:id/mods/install
{
  "workshopId": "1559212036",
  "name": "CF"
}
```

## Managing Installed Mods

| Action | Description |
|--------|-------------|
| **Enable/Disable** | Toggle a mod without uninstalling |
| **Change Load Order** | Reorder mods (critical for dependency chains) |
| **Uninstall** | Remove a mod and its files |
| **Update** | Re-download the latest version from Workshop |

## Load Order

DayZ mods must be loaded in dependency order. Citadel lets you drag-and-drop to reorder mods in the dashboard. The load order is reflected in the server's `-mod=` launch parameter.

## Auto-Detection

When adding a server, Citadel scans the installation directory for existing `@` mod folders and automatically adds them to the mod list.
