# 03 — The `SMP1.0` Protocol & RPC API

The Manager and Agent communicate over a single bespoke protocol the codebase names **`SMP1.0`** (likely "Server Management Protocol 1.0"). It is JSON-RPC-style messaging carried over a WebSocket, with two HTTP side-channels for binary transfer. This document specifies it bit-by-bit and catalogs every action.

---

## 1. Transport & endpoints

All on the Agent's single port (default **8090**, TLS per `use_ssl=true`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `wss://HOST:8090/ws` | WebSocket upgrade | The `SMP1.0` control channel (all RPCs + push). |
| `https://HOST:8090/upload` | `POST` | Binary upload (multipart), Basic auth. |
| `https://HOST:8090/download` | `POST` | Binary download; body `{ "token": "<one-time token>" }`, Basic auth. Capped by `max_manager_download_size` (30 MB). |

When the Agent's `use_ssl=false`, the schemes degrade to `ws://` / `http://`. The Manager's connection form defaults the port field to `8090`.

---

## 2. Handshake & authentication

1. The client opens the WebSocket with **three subprotocol tokens**:
   ```js
   new WebSocket("wss://HOST:8090/ws", ["SMP1.0", username, password]);
   ```
   i.e. the protocol identifier followed by the credentials. (During the Manager's "test connection" probe it also sends `Authorization: Basic base64(user:pass)` to `/ws`; the Agent answering **HTTP 400** is treated by the Manager as "credentials valid, but this is a WS endpoint" — a deliberate probe signal.)
2. The Agent authenticates the credentials (bcrypt compare), applies **fail2ban** (ban after 10 fails/60 s), and if OK upgrades the socket.
3. **Bootstrap sequence** the client runs immediately on open:
   1. `whoami` → returns `{username, permissions[]}`. The client caches these to gate its UI.
   2. `request_system_info` → host facts (OS, CPU, RAM, disks, NICs).
   3. If Agent version ≥ 1.1.26: `proxy → installation_details` (cloud round-trip for license/install metadata).
   4. `request_agent_health` → daemon health snapshot.
   5. Conditionally `enable_stdout` (if the user has `agent.enable_stdout`) to begin receiving server console streams.

---

## 3. The RPC envelope

Every request is a JSON object:

```jsonc
{
  "action": "server_start",            // the verb
  "parameters": { "server": "AxiomMain" }, // action-specific args
  "idempotence": "a8F3...random..."    // correlation token (client-generated)
}
```

Every reply echoes the `idempotence` token and carries a status:

```jsonc
{
  "idempotence": "a8F3...random...",
  "status": "ok",                      // "ok" | "error"
  "parameters": { ... }                // result payload (or error detail)
}
```

Mechanics:
- The client keeps a **pending-promise map keyed by `idempotence`**; when a reply with that token arrives, the corresponding promise resolves/rejects. Default **timeout 10 s**.
- **Per-connection latency** is measured (request→reply round-trip) and surfaced in the Manager.
- The token is random per request, so multiple in-flight actions multiplex over the one socket without head-of-line coupling.

---

## 4. The `proxy` action (cloud bridge)

`proxy` wraps a nested `{action, parameters}` that the Agent forwards **upstream to CFTools Cloud** on the client's behalf, returning the cloud's answer back down the same socket. Observed proxied actions:
- `installation_details` — license/install metadata.
- `titles` — the authoritative supported-title list.
- `universe_status` — a recurring heartbeat (seen every ~10 s in the live log: `Got a new proxy request with action: 'universe_status'`). This is the entitlement/content-availability poll.

This is why the Manager needs no direct line to the cloud for these — the Agent is the broker.

---

## 5. Pub/sub (live push)

- `subscribe` / `unsubscribe` with `{ "topic": "<serverId>" }` register the connection for live events about a server.
- The Agent then pushes **unsolicited** messages over the same socket (no `idempotence` request): `agent_health`, `system_info`, `stdout` (server console lines), server state changes, and RCON reads. The Manager's dashboards/charts consume these directly.

---

## 6. Permission model

Authorization is a set of **dotted permission keys** returned by `whoami` and enforced server-side on every action. `root` holds the wildcard `*`. Observed keys (non-exhaustive):

```
agent.enable_stdout   agent.events        agent.system_info
server.deploy server.start server.stop server.update server.delete
server.rcon  server.metrics  server.view
servers.cpu  servers.ram  servers.players  servers.status  servers.uptime
file.read  file.update  file.download
user.create  user.delete  user.give_roles
role.create  role.delete  role.list
webhook.manage   application.manage   rcon.message   title.request_manifest
```

Roles `root` and `default` are special-cased; `default` is a read-only allow-list.

---

## 7. Full action catalog

Collected from the renderer chunks and corroborated by the Agent logs. Grouped by domain.

### Identity / RBAC / audit
`whoami` · `list_users` · `create_user` · `delete_user` · `user_password`/`password` · `user_give_roles` · `user_revoke_roles` · `list_roles` · `create_role` · `delete_role` · `role_update` · `list_permissions` · `audit_events` · `list_sessions`

### Agent / system
`request_system_info` · `request_agent_health` · `agent_statistics` · `agent_metrics` · `query_agent_events` · `enable_stdout` · `list_actions` · `system_command` (e.g. `{command:"ip -brief addr show"}`) · `installation_details` · `universe_status` · `kill` · `transaction` · `subscribe` / `unsubscribe`

### Game-server lifecycle
`servers` / `server` · `server_deploy` (`{id, title, configuration:{ports:{game,query,rcon},...}}`) · `server_start` · `server_stop` · `server_stop_cancel` · `restart` · `server_kill` / `server_force_kill` · `server_update` · `server_rebuild` · `server_remove` · `server_wipe` · `server_archives` · `server_export` / `server_import` · `server_restore` · `server_metrics` / `query_server_metrics` · `query_server_events` · `server_filetree` (`{server, root, levels}`)

### RCON
`server_rcon_send` (`{server, payload:"version"}`) · `server_rcon_read` (`{server, since}`, polled)

### Game config / files
`server_gameconfig_read` · `server_gameconfig_write` · `configuration` · `settings` · `read_file` / `write_file` · `file_list` / `server_filetree` · `file_upload` / `file_download` · `file_zip` / `file_unzip` · `move_file` · `delete_file`

### Mods / titles / Steam
`titles` · `titles_status` · `list_supported_titles` · `title_features` · `title_mods` · `title_rebuild` · `title_remove` · `request_title_manifest` · `mod` / `mods` · `add_mod` · `remove_mod` · `install_mod` (`{entity_id, server, universe:"steam", name,...}`) · `download_mod` · `mod_change` · `mod_rebuild` · `server_mod_bindings` · `server_mods_clear` · `steam_list_downloads` · `steam_cancel_download` · `steam_refresh_content_servers` · `list_available_steam_servers` · `list_excluded_steam_servers` · `query_downloader_log`

### Backups
`create_backup` (`{server}`) · `query_backups` · `delete_backup` · `restore_backup`

### Scheduled tasks (cron engine — present, dormant on this host)
`tasks_list` · `task_create` · `task_update` · `task_delete` · `task_info` · `query_task_executions`

### Webhooks
`list_webhooks` · `create_webhook` · `update_webhook` · `delete_webhook` · `get_webhook_events` · `list_webhook_deliveries`

### Applications (non-game services)
`applications` / `application_list` · `application_install` · `application_uninstall` · `application_start` · `application_stop`

### SQL databases (managed game DBs)
`sql_databases_list` · `sql_database_create` · `sql_database_delete`

---

## 8. Worked example

Restart Axiom Main with a 5-minute warning, from a raw client:

```jsonc
// 1) authenticate by opening the socket
new WebSocket("wss://host:8090/ws", ["SMP1.0", "root", "<password>"])

// 2) confirm identity/permissions
→ { "action":"whoami", "parameters":{}, "idempotence":"k1" }
← { "idempotence":"k1", "status":"ok", "parameters":{ "username":"root", "permissions":["*"] } }

// 3) broadcast over RCON
→ { "action":"server_rcon_send",
    "parameters":{ "server":"AxiomMain", "payload":"say -1 Restart in 5 minutes" },
    "idempotence":"k2" }
← { "idempotence":"k2", "status":"ok", "parameters":{} }

// 4) restart (SERVER OBSERVER handles graceful stop → start)
→ { "action":"restart", "parameters":{ "server":"AxiomMain" }, "idempotence":"k3" }
← { "idempotence":"k3", "status":"ok", "parameters":{ "state":"server.stopping" } }
```

Continue with `04_Database_Schema.md`.
