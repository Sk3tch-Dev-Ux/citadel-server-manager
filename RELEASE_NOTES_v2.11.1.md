## Citadel v2.11.1 — Hotfix: silent auto-update was aborting

### Fixed
- **Auto-update closed the app but didn&apos;t install** — the NSIS installer&apos;s pre-install port-conflict check was aborting in silent mode (`/S`, used by electron-updater) because the existing Citadel service was holding port 3001 — the port check that was meant to detect *external* conflicts was incorrectly triggering on our own service. Result: app quit, installer aborted with no UI, nothing relaunched.
- The installer now skips the port-conflict check entirely when an existing Citadel install is detected (registered under `HKLM\Software\Citadel`). The install Section already handles the existing-install case correctly by stopping the service before file copy.
- For genuine fresh-install conflicts in silent mode, the message-box default is now **YES** (continue) instead of **NO** (abort), so auto-updates aren&apos;t blocked by transient port-binding edge cases.

### If your v2.11.0 update closed the app and never reopened
This is the bug. Recovery options:

**Option 1 — manually run the installer** (interactive, not silent):
The new installer was downloaded by electron-updater to `%LOCALAPPDATA%\citadel-updater\pending\CitadelSetup-2.11.0.exe`. Right-click → Run as administrator. The port-conflict dialog will appear; click **Yes** to continue. Install completes.

**Option 2 — stop the service first, then any installer works**:
```powershell
# Elevated PowerShell
nssm stop CitadelServer
```
Then run the v2.11.1 installer (or v2.11.0 — both work after the service is stopped).

**Option 3 — fresh download from citadels.cc/account**:
Run interactively as admin, click Yes on the port dialog if it appears.

### Includes everything from v2.11.0
License activation URL fix (`citadels.cc` → `api.citadels.cc`), safe upgrades (service-stop before file copy + .env preservation), manual **Help → Check for Updates…** menu, About dialog, and the `app-update.yml` fix that makes the auto-updater work in the first place.

See the full changelog at https://citadels.cc/docs/changelog
