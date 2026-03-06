# Notifications

Citadel supports notifications through Discord webhooks and the web dashboard.

## Dashboard Notifications

The web dashboard displays real-time notifications for:
- Server start/stop/restart events
- Player connection/disconnection
- Scheduled job execution
- Errors and warnings

Notifications appear in the notification center (bell icon in the top bar).

## Discord Webhooks

Configure Discord webhooks to receive alerts in your Discord channels.

### Setup

1. In Discord, go to **Channel Settings → Integrations → Webhooks**
2. Click **New Webhook** and copy the URL
3. In Citadel, go to **Settings → Webhooks**
4. Add the webhook URL and select the events to trigger on

### Supported Events

| Event | Description |
|-------|-------------|
| `server.start` | Server process started |
| `server.stop` | Server stopped or crashed |
| `server.restart` | Server restarted |
| `player.kick` | Player was kicked |
| `player.ban` | Player was banned (includes global ban database entries) |
| `player.unban` | Player was unbanned (ban removed from global database) |
| `scheduler.job` | Scheduled job executed |
| `backup.complete` | Backup completed |
| `backup.failed` | Backup failed |

### Webhook Payload

Webhooks are sent as Discord embed messages with:
- Color-coded severity (green=info, yellow=warning, red=error)
- Event type and description
- Server name
- Timestamp
- Relevant details (player name, action, etc.)
