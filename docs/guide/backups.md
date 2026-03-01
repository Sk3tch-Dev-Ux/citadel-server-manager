# Backups

Citadel supports automated and manual backups for both application configuration and game server files.

## Game Server Backups

Back up your DayZ server's mission files, profiles, and other critical data.

### Configuration

Navigate to a server's **Backups** tab or use the API:

```bash
PUT /api/servers/:id/backup-config
{
  "enabled": true,
  "intervalMinutes": 60,
  "retentionCount": 24,
  "paths": [
    "mpmissions",
    "profiles"
  ]
}
```

| Setting | Description |
|---------|-------------|
| `enabled` | Enable/disable automated backups |
| `intervalMinutes` | How often to create a backup |
| `retentionCount` | Maximum number of backups to keep (oldest deleted first) |
| `paths` | Relative paths within the server directory to include |

### Manual Backup

Trigger a manual backup at any time:

```bash
POST /api/servers/:id/backups
```

### Download & Restore

Backups are stored as zip archives. Download via the dashboard or API:

```bash
GET /api/servers/:id/backups/:filename/download
```

## Application Config Backups

Back up Citadel's own configuration (server profiles, users, roles, webhooks):

```bash
# Download
GET /api/backup/servers
GET /api/backup/users
GET /api/backup/roles
GET /api/backup/webhooks

# Restore
POST /api/restore/servers
POST /api/restore/users
```

::: tip Quick Full Backup
For a quick full backup of all Citadel data, simply copy the `data/` directory.
:::
