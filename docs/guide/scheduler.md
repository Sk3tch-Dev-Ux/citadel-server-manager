# Scheduler & Tasks

Citadel includes a built-in scheduler for automating server operations like restarts, messages, and maintenance.

## Creating a Scheduled Job

### Via Dashboard

1. Select a server from the sidebar
2. Navigate to **Scheduler**
3. Click **New Job**
4. Configure the schedule, action, and options

### Via API

```bash
POST /api/servers/:id/scheduler
{
  "name": "Daily Restart",
  "type": "restart",
  "cron": "0 4 * * *",
  "enabled": true,
  "options": {
    "warnings": [15, 10, 5, 1],
    "warningMessage": "Server restart in {minutes} minutes",
    "lockBeforeRestart": true,
    "kickBeforeRestart": true
  }
}
```

## Schedule Types

| Type | Description |
|------|-------------|
| `restart` | Restart the server. Supports pre-restart warnings |
| `stop` | Stop the server |
| `message` | Send a broadcast message to all players |

## Cron Syntax

Jobs use standard cron expressions:

```
┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12)
│ │ │ │ ┌───────────── day of week (0–7, Sun=0 or 7)
│ │ │ │ │
* * * * *
```

**Examples:**
| Expression | Description |
|-----------|-------------|
| `0 */4 * * *` | Every 4 hours |
| `0 4 * * *` | Daily at 4:00 AM |
| `0 4,16 * * *` | Twice daily at 4:00 AM and 4:00 PM |
| `30 3 * * 1` | Every Monday at 3:30 AM |

## Restart Warnings

When a restart job is configured with warnings, Citadel sends countdown messages to players before the restart:

```
[15 min] Server restart in 15 minutes
[10 min] Server restart in 10 minutes
[5 min]  Server restart in 5 minutes
[1 min]  Server restart in 1 minute
```

The warning message template supports `{minutes}` placeholder.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `warnings` | number[] | `[]` | Minutes before restart to send warnings |
| `warningMessage` | string | `"Server restarting in {minutes} minutes"` | Warning message template |
| `lockBeforeRestart` | boolean | `false` | Lock server before restart to prevent new joins |
| `kickBeforeRestart` | boolean | `false` | Kick all players before restart |
