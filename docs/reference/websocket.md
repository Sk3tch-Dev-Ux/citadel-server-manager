# WebSocket Events

Citadel uses [Socket.IO](https://socket.io/) for real-time communication between the backend and dashboard.

## Connection

The frontend connects to the backend's Socket.IO server on the same port as the REST API:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', {
  auth: { token: 'your-jwt-token' }
});
```

## Events (Server → Client)

### Server Status

| Event | Payload | Description |
|-------|---------|-------------|
| `serverStatus` | `{ serverId, status }` | Server status change (`running`, `stopped`, `crashed`, `starting`, `stopping`) |

### Players

| Event | Payload | Description |
|-------|---------|-------------|
| `players` | `{ serverId, players: [] }` | Full player list update (sent periodically and after kicks/bans) |

### Metrics

| Event | Payload | Description |
|-------|---------|-------------|
| `metrics` | `{ serverId, cpu, ram, players, fps, timestamp }` | Periodic performance metrics snapshot |

### Logs

| Event | Payload | Description |
|-------|---------|-------------|
| `log` | `{ serverId, level, source, message, timestamp }` | New log entry (RPT, RCON, or system) |

### Map Data

| Event | Payload | Description |
|-------|---------|-------------|
| `mapData` | `{ serverId, players, vehicles }` | Live map position data for players and vehicles |

### Mods

| Event | Payload | Description |
|-------|---------|-------------|
| `mods` | `{ serverId, mods: [] }` | Mod list updated (after install/uninstall/toggle) |
| `modInstallProgress` | `{ serverId, workshopId, progress, status, message }` | Mod installation progress |

### Auto-Updates

| Event | Payload | Description |
|-------|---------|-------------|
| `updateProgress` | `{ serverId, stage, progress, message, ... }` | Auto-update pipeline progress (countdown, stopping, updating, starting) |

### Backups

| Event | Payload | Description |
|-------|---------|-------------|
| `backupCreated` | `{ serverId, filename, type, size, createdAt }` | A backup was created |
| `backupRestore` | `{ serverId, status, filename, error? }` | Backup restore progress (`starting`, `complete`, `error`) |

### Dangerzone

| Event | Payload | Description |
|-------|---------|-------------|
| `dangerzoneProgress` | `{ serverId, status, message, preset? }` | Wipe/rebuild/reinstall progress |

### Notifications

| Event | Payload | Description |
|-------|---------|-------------|
| `notification` | `{ serverId, type, title, message, severity }` | System notification (server events, warnings, errors) |

### Lifecycle Hooks

| Event | Payload | Description |
|-------|---------|-------------|
| `hookResult` | `{ serverId, hook, phase, exitCode, stdout?, error? }` | Lifecycle hook execution result |

## Events (Client → Server)

Socket.IO connections are authenticated via the `auth.token` option. There are no client-to-server events — all actions go through the REST API.
