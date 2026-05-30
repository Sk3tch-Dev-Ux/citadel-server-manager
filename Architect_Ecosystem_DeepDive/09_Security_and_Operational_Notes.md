# 09 — Security & Operational Notes

Observations gathered during analysis. Nothing here was changed — these are findings and recommendations. Severities are the author's judgment for a single-operator game-hosting box exposed on `0.0.0.0:8090`.

---

## A. Plaintext secrets on disk

| # | Location | Secret | Severity | Note |
|---|----------|--------|----------|------|
| A1 | `Agent\root.txt` | root user password (`db9adc8f-...`) | **High** | The Agent itself says "won't be shown again" — yet it persists in cleartext. Anyone with file read on the host owns the Agent. **Delete after recording it in a vault.** |
| A2 | `deployments\AxiomMain\serverDZ.cfg` | `passwordAdmin="Harker16!"` and `password="Dev"` | **High** | Admin password is the in-game superuser. Cleartext and weak. Rotate; treat the file as a secret. |
| A3 | Manager `connections.json` (userData) | Agent password, plaintext | **High** | Anyone with the operator's profile read gets remote Agent control. Consider OS-keychain storage. |
| A4 | DB `webhooks.details.url` | full Discord webhook URLs | **Medium** | A webhook URL grants channel post access (spam/phish). Cleartext in the 70 MB DB. |
| A5 | `profiles\gamelabs.cfg` | GameLabs `apiKey` | **Medium** | Grants GameLabs/CFTools API actions for this server. |
| A6 | DB `servers.details.environment.priorityApiKey` | CFTools priority key | **Medium** | Reserved-slot API key. Rotate if the DB is ever shared/backed-up off-box. |

**Action:** rotate A1–A3 now; restrict NTFS ACLs on `Agent\`, `deployments\`, and the Manager userData dir; scrub `root.txt`.

---

## B. TLS / transport posture

| # | Finding | Severity | Note |
|---|---------|----------|------|
| B1 | Agent `:8090` uses a **self-signed cert** (issuer org "CFTools Architect"). | Info | Expected for an appliance, but no CA chain → clients can't validate identity normally. |
| B2 | Manager **disables web security** (`webSecurity:false`, `allowRunningInsecureContent:true`) and **blanket-accepts any cert** whose issuer org is "CFTools Architect", plus a `certificate-error` handler that force-accepts. | **Medium** | This is how the Manager trusts the Agent's self-signed cert without prompts — but it weakens TLS validation broadly inside the renderer. A MITM presenting any cert with that issuer org would be trusted. |
| B3 | `disable_remote_root = false` + `address = 0.0.0.0`. | **Medium** | Root can log in from any IP and the port is bound to all interfaces. If 8090 is internet-reachable, the only thing between the world and root is the password + fail2ban (10/60s). **Firewall 8090 to admin IPs / VPN.** |

---

## C. Authentication & access control (the good parts)

- **bcrypt** password hashing (`users.details.password_hash`, 60 chars). ✔
- **fail2ban** on auth (10 attempts / 60 s ban). ✔ — but a 60 s ban is short; consider raising `fail2ban_ban_time`.
- **RBAC** with explicit dotted permissions and a least-privilege `default` role. ✔
- **Compliance-grade audit log** (8.4k rows, with user/session/IP/action/params). ✔ — but `audit_logs_retention=7` days is short for forensic needs; consider 30–90.

---

## D. Operational risks

| # | Finding | Severity | Note |
|---|---------|----------|------|
| D1 | **Metrics tables have no retention/pruning.** `AxiomMain_metrics` (47 MB) + `agent_metrics` (17 MB) = ~95% of a 70 MB DB and grow ~linearly with uptime. The `audit_logs_retention` setting does **not** cover them. | **Medium** | Over months/years this becomes large, slows the 3-hourly full-file backup, and bloats disk. **Add downsampling/retention** (e.g. keep raw 7–14 d, roll up older to 1-min/1-h averages), or periodically VACUUM/prune. |
| D2 | **Priorities provider failing** every 5 min: `Raw={"results":null,"status":false}`. | **Medium** | Reserved-slot/queue-skip is effectively **broken** right now — priority players are not being recognized. Likely an invalid/expired `priorityApiKey` or a `priorityServer` GUID not bound to the CFTools account. **Re-issue the key / re-bind the server in the CFTools dashboard.** |
| D3 | **DB schema drift** logged at boot: `SERVER MANAGER: could not adjust table [AxiomMain_metrics]` and `DATABASE: ... no such column: state`. | **Low** | A query assumes a promoted column that lives only in the JSON `details`. Cosmetic/non-fatal here, but indicates an incomplete migration path in the document-oriented model. Watch after Agent upgrades. |
| D4 | **Force-kill noise** in logs (`pid=0`, "server is not running"). | **Low** | The Observer tried to kill an already-dead process. Harmless, but if frequent it suggests the server is crashing or PID tracking is racing. Check `profiles\crash_*.log` / RPT if it recurs. |
| D5 | **Single point of control.** All management flows through one Agent on one port; no HA/failover. | Info | Expected for single-host hosting. Back up `db\` and `deployments\` off-box. |

---

## E. Data residency / privacy

- Operator **IP addresses are stored cleartext** in `audit` and `agent_events` (e.g. `91.229.114.40`). Fine for self-host; relevant if the DB leaves the box or under GDPR if operators are EU persons.
- Player IPs are geolocated via the third-party `ip-api.com` from the Manager — player IPs leave to a third party for the globe view.
- Crash/error telemetry goes to `sentry.cftools.cloud`; `universe_status` heartbeats and license JWT go to CFTools. This is inherent to the product.

---

## F. Prioritized remediation checklist

1. **Now:** rotate the root password (A1) and scrub `root.txt`; rotate `passwordAdmin` (A2); firewall `:8090` to trusted IPs/VPN (B3).
2. **Now:** fix the Priorities key/binding (D2) so reserved slots work.
3. **This week:** move Manager-stored Agent creds to OS keychain (A3); tighten NTFS ACLs on Agent/deployment/userData dirs.
4. **This week:** implement metrics retention/downsampling (D1); raise `audit_logs_retention` and `fail2ban_ban_time`.
5. **Backlog:** front the Agent with a real reverse proxy + valid TLS instead of relying on the Manager's blanket cert trust (B2); off-box backups of `db\` + `deployments\` (D5).

---

## G. What's strong about the design (for balance)

- Clean tier separation; the Agent is a single self-contained, self-updating Go binary.
- Real supervision (state machine, integrity snapshots, auto-restart on mod/build change).
- Genuine RBAC + audit + fail2ban + bcrypt — more than most DayZ panels ship.
- Deep observability including *in-game* GameLabs metrics, not just OS counters.
- Cloud value-adds (curated catalog, reserved-slot queue, DZSA publishing, centralized identity) that a local-only panel cannot match.

End of document set.
