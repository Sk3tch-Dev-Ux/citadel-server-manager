# Data Store

Citadel uses a JSON file-based data store — no database required. All data lives in the `data/` directory.

## Files

| File | Contents | Description |
|------|----------|-------------|
| `servers.json` | Server profiles | Server configurations, connection details, provider settings |
| `users.json` | User accounts | Usernames, hashed passwords, roles, MFA settings |
| `audit.json` | Audit trail | Action log with who, what, when, result |
| `webhooks.json` | Webhook configs | Discord and HTTP webhook configurations |
| `leaderboard.json` | Leaderboard cache | Player stats leaderboard data |
| `setup_complete.json` | Setup state | Tracks whether initial setup has been completed |

## Backup & Restore

### Manual Backup

Copy the entire `data/` directory:

```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
```

### API Backup

Download individual config files via the REST API:

```bash
# Download server configs
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/backup/servers > servers-backup.json

# Restore
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @servers-backup.json \
  http://localhost:3000/api/restore/servers
```

Available backup types: `servers`, `users`, `roles`, `webhooks`

## Data Safety

- The data store uses atomic writes to prevent corruption during crashes
- If a JSON file becomes corrupted, restore from a backup or delete it to reset to defaults
- The `data/` directory is created automatically on first startup
