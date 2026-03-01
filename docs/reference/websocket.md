# WebSocket Events

Citadel uses [Socket.IO](https://socket.io/) for real-time communication between the backend and dashboard.

## Connection

The frontend connects to the backend's Socket.IO server on the same port as the REST API:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-token' }
});
```

## Events (Server → Client)

### Server Status

| Event | Payload | Description |
|-------|---------|-------------|
| `server:status` | `{ serverId, status, players, cpu, ram }` | Periodic server status update |
| `server:started` | `{ serverId }` | Server process started |
| `server:stopped` | `{ serverId }` | Server process stopped |
| `server:restarting` | `{ serverId }` | Server restart initiated |

### Players

| Event | Payload | Description |
|-------|---------|-------------|
| `players:update` | `{ serverId, players: [] }` | Player list updated |
| `player:connected` | `{ serverId, player }` | Player joined the server |
| `player:disconnected` | `{ serverId, player }` | Player left the server |

### Kill Feed

| Event | Payload | Description |
|-------|---------|-------------|
| `killfeed:entry` | `{ serverId, killer, victim, weapon, distance, timestamp }` | New kill event |

### RCON

| Event | Payload | Description |
|-------|---------|-------------|
| `rcon:output` | `{ serverId, message }` | RCON console output |

### Mods

| Event | Payload | Description |
|-------|---------|-------------|
| `mod:install:progress` | `{ serverId, workshopId, progress, status }` | Mod installation progress |
| `mod:install:complete` | `{ serverId, workshopId }` | Mod installation complete |
| `mod:install:error` | `{ serverId, workshopId, error }` | Mod installation failed |

### Notifications

| Event | Payload | Description |
|-------|---------|-------------|
| `notification` | `{ type, title, message, severity }` | System notification |

## Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe:server` | `{ serverId }` | Subscribe to a server's real-time events |
| `unsubscribe:server` | `{ serverId }` | Unsubscribe from a server's events |
