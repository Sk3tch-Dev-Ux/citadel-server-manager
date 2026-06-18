# TLS / HTTPS Setup

How the Citadel Agent serves HTTPS, and how to make it mandatory for a public launch.

## How the Agent decides HTTP vs HTTPS

At startup the Agent looks for `cert/key.pem` and `cert/cert.pem` in the project root (`<ROOT>/cert/`). If both load successfully it serves **HTTPS** and marks auth cookies `Secure`; otherwise it falls back to **HTTP** (`backend/server.js`).

Two guards then decide whether an insecure boot is allowed:

- `server.requireHttps` (config) / `REQUIRE_HTTPS` (env) — when set, the Agent **refuses to start** without valid TLS. Use this for any public/internet-facing deployment.
- An all-interfaces bind (`bindHost` = `0.0.0.0` or `::`) over plaintext HTTP is **refused** even without `requireHttps`, because it would expose the dashboard and auth cookies to the whole network. Override only if you have accepted the risk: `ALLOW_INSECURE_BIND=1`.

Loopback HTTP (`127.0.0.1`, the dev default, and the correct setup behind a local TLS-terminating reverse proxy) is always allowed.

## Local / LAN testing — self-signed cert

Run the helper from the project root:

```powershell
.\generate-cert.ps1
# or for a specific hostname:
.\generate-cert.ps1 -Hostname dayz.example.com
```

It writes `cert/key.pem` + `cert/cert.pem` (already covered by `.gitignore`). Restart the Agent; the startup banner should switch to `https://`. Browsers will warn on a self-signed cert — expected for local/LAN use.

No openssl? It ships with Git for Windows (`C:\Program Files\Git\usr\bin\openssl.exe`); the script finds it automatically. Manual one-liner:

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout cert/key.pem -out cert/cert.pem -days 825 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

## Public / production deployments

Citadel's intended remote-access path is **Citadel Cloud** (citadel-hub.com), not a directly internet-exposed Agent. If you do expose the Agent directly, do **not** ship a self-signed cert. Two supported options:

1. **Reverse proxy terminates TLS (recommended).** Run the Agent on loopback (`bindHost=127.0.0.1`, plain HTTP — allowed) and put nginx/Caddy/IIS in front with a real certificate (e.g. Let's Encrypt via Caddy or certbot). The proxy handles HTTPS and forwards to `http://127.0.0.1:3001`. Set `TRUSTED_PROXIES` to the proxy IP and add the public origin to `CORS_ORIGINS`.

2. **Agent terminates TLS directly.** Drop a CA-issued `key.pem` + `cert.pem` (full chain) into `cert/`, set `REQUIRE_HTTPS=true`, and renew the cert before expiry (the Agent reads the files at startup, so restart after renewal).

Either way, set `REQUIRE_HTTPS=true` (or `server.requireHttps` in `citadel.config.json`) so a missing/expired cert fails the boot loudly instead of silently dropping to HTTP.

## Quick reference

| Setting | Where | Effect |
|---|---|---|
| `cert/key.pem` + `cert/cert.pem` | `<ROOT>/cert/` | Present → Agent serves HTTPS |
| `server.requireHttps` / `REQUIRE_HTTPS=true` | config / env | No TLS → refuse to start |
| `ALLOW_INSECURE_BIND=1` | env | Permit all-interfaces bind over HTTP (not recommended) |
| `bindHost` / `BIND_HOST` | config / env | `127.0.0.1` default (loopback); `0.0.0.0` exposes to network |
| `TRUSTED_PROXIES` | config / env | Reverse-proxy IPs to trust for client IP |
| `CORS_ORIGINS` | config / env | Allowed browser origins |
