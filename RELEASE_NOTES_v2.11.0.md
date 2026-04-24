## Citadel v2.11.0 — License activation fix + safe upgrades + manual update check

### Fixed — License activation failing with HTTP 404
The desktop client was pointing at `https://citadels.cc/api/v1/license/activate`, but the Fastify API lives on the `api.citadels.cc` subdomain. Every activation 404&apos;d on the marketing site. Fixed the default URL in the bundled license client. New installs work out of the box; existing installs can either upgrade or set `CITADEL_LICENSE_API=https://api.citadels.cc` in their `.env` as a temporary workaround.

### Added — Safe upgrade path
Re-installing Citadel over an existing install now preserves your customizations and unlocks file replacement that previously could silently fail:

- **Service stops BEFORE file copy** — prevents `node.exe` from locking backend files during upgrade (previously code files could partially-fail to overwrite)
- **Electron app window gets closed** — prevents the desktop `Citadel.exe` / `app.asar` from being locked during upgrade
- **`.env` preserved** — your custom env vars (like `CITADEL_LICENSE_API` overrides or API keys) survive the upgrade. Backed up to `.env.upgrade-backup` during the install then restored
- **`data/` preserved** — server configs, backups, license cache, user DB all untouched (was already the case; now explicitly documented in the installer)

### Added — Manual "Check for Updates" menu item
**Help → Check for Updates…** in the app menu. Triggers an immediate update check instead of waiting for the 6-hour periodic poll. Shows a native dialog with the result:
- "Update available — will download in background"
- "Up to date — you&apos;re on the latest"
- "Update ready — Restart & Install"
- "Check failed — network/firewall issue"

Also added an **About Citadel** dialog showing version + Electron/Node/Chromium versions.

### Notes on upgrade
- Automatic updates via electron-updater continue to work — they just download the new NSIS installer and run it silently with `/S`. Same safety logic applies.
- If you&apos;re already on v2.10.0 with a custom `.env` you set for the activation workaround, you can delete the `CITADEL_LICENSE_API` line after upgrading to v2.11.0 — the new default URL is correct.

See the full changelog at https://citadels.cc/docs/changelog
