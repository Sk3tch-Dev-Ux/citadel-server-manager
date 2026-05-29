# Domain Report: Cross-platform support & operations

> Cross-reference of **Citadel** (current) vs the reference **mr-guard/dayz-server-manager 3.10.0**.

## How the reference does it

**Reference (DSM v3.10)** employs a platform-aware architecture with TypeScript/DI that cleanly separates Windows-only and Linux-specific logic:

- **OS Detection** (`src/util/detect-os.ts`): Unified `detectOS()` returns 'windows', 'linux', or 'unknown', covers 7 Unix variants (linux, darwin, freebsd, openbsd, sunos) plus Windows.
- **Requirements** (`src/services/requirements.ts`): OS-aware validation—Windows checks VCRedist/DirectX via DLL markers (C:/Windows/System32/SysWOW64), Linux checks libraries via `dpkg -l` and `ldconfig -p`, with user-facing download links and installation instructions.
- **Firewall** (`src/services/netsh.ts`): Pure Windows implementation using netsh commands for rule creation; Linux stub returns true (defer to firewall config).
- **GUI Detection** (`src/util/is-run-from-gui.ts`): Windows-specific WMIC parsing to detect ApplicationFrameHost.exe/explorer.exe as parent process.
- **Docker**: Full Dockerfile + docker-compose.yml for Linux containerized deployment; installs libcap-dev, lib32gcc-s1, libcurl4, libcurl4-openssl-dev; runs DayZ server and manager in same container with user `dayz:1001`.
- **Service Management**: Requires Windows (no systemd/init equivalent in codebase for Linux).
- **README Documentation**: Detailed Linux Server section covering binary setup, systemd service creation, Docker deployment, and platform-specific library requirements.
- **Build & CI**: GitHub Actions workflow compiles to single binary (cross-platform Go-like distribution model).

## How Citadel does it

**Current (Citadel)** is Windows-only with no platform-agnostic architecture:

- **No OS Detection**: No util/detect-os equivalent; assumes Win32 throughout (`process.platform` checks only in tests).
- **Firewall** (`backend/lib/firewall-manager.js`): Pure Windows PowerShell-based inbound rules using `Get-NetFirewallRule` and `New-NetFirewallRule` with elevated execution and UAC prompts; no Linux/macOS stub.
- **Service Management** (`backend/lib/service-installer.js`): 100% Windows NSSM-based (Non-Sucking Service Manager); auto-installs via `install.ps1` PowerShell script with elevation checks; generates systemd-like behavior (auto-start, restart-on-failure, logging) but only on Windows.
- **Setup** (`backend/lib/setup.js`): Generates .env with JWT secrets and admin credentials; creates data/ directory; no platform conditional logic.
- **Installer** (`install.ps1`): Pure PowerShell Windows service installer; checks for citadel-node.exe, nssm.exe; stops existing service before upgrade; copies files preserving data/ and .env.
- **Desktop** (`desktop/`): Electron-based GUI (screenshot/assets/scripts folders present) for Windows UI.
- **README**: States "The local DayZ server management app for **Windows**" with badge "platform: Windows".
- **Docker**: None; no Dockerfile or docker-compose support.
- **No cross-platform planning**: No stubs, shims, or conditional paths for Linux/macOS; architecture assumes single OS.

## Detailed analysis

# Cross-Platform Support & Operations: Citadel vs. DayZ Server Manager (Reference)

## Executive Summary

The reference codebase (DSM v3.10) was designed for cross-platform deployment from the ground up, supporting both Windows and Linux via a clean OS-detection abstraction layer and containerization. Citadel, by contrast, is a Windows-only commercial product with significantly more features (Electron desktop app, advanced firewall/service management) but zero platform abstraction. This report identifies gaps, operational risks, and a low-risk roadmap to add platform awareness without requiring a full rewrite.

## Key Differences

### 1. Operating System Detection & Abstraction

**Reference**: `src/util/detect-os.ts` exports a single `detectOS()` function that normalizes platform detection across Windows and seven Unix variants (linux, darwin, freebsd, openbsd, sunos). This function is injected as a dependency throughout the codebase (e.g., Requirements service, NetSH service) and gates OS-specific logic with clean conditionals.

**Citadel**: No OS detection abstraction. Platform-specific code is scattered and assumes Windows throughout. For example:
- `service-installer.js` requires NSSM without checking if it's available.
- `firewall-manager.js` spawns PowerShell commands directly.
- `install.ps1` is pure PowerShell with no fallback for non-Windows systems.

**Risk**: If Citadel were to run on Linux (e.g., in a Docker container or remote VPS), these modules would fail at runtime with cryptic errors (NSSM not found, PowerShell not available).

### 2. Requirements Validation

**Reference**: The Requirements service (`src/services/requirements.ts`, lines 1–277) is OS-aware:
- **Windows**: Checks for VCRedist and DirectX by looking for marker DLLs (VCRuntime140.dll, XAPOFX1_5.dll) in C:/Windows/System32 and C:/Windows/SysWOW64. Provides download links and user instructions if missing.
- **Linux**: Validates runtime dependencies via `dpkg -l` (libcap-dev, lib32gcc-s1, libcurl4, libcurl4-openssl-dev) and `ldconfig -p` for library markers. Provides apt-get install commands.
- **Optional**: Windows Error Reporting registry check to prevent server hangs.

**Citadel**: No requirements validation. The `setup.js` module only generates .env and config files; it does not check system prerequisites.

**Impact**: Citadel users installing on fresh systems may experience cryptic failures if DLL or library dependencies are missing. Linux users (future) would not get helpful diagnostics.

### 3. Firewall Management

**Reference**: `src/services/netsh.ts` is Windows-specific and uses netsh commands. The Requirements service gates firewall checks with `if (detectOS() === 'windows')` and returns true for Linux (stub). No firewall rule creation is attempted on non-Windows.

**Citadel**: `backend/lib/firewall-manager.js` is fully Windows-only:
- Spawns PowerShell to check and create rules using `Get-NetFirewallRule` and `New-NetFirewallRule`.
- Implements elevated execution via `Start-Process -Verb RunAs` (UAC prompt).
- No OS check; assumes PowerShell is available.

**Operational Note**: Citadel's implementation is actually more sophisticated—it handles partial success (verifies rules one-by-one after elevation fails), has a longer timeout (30s), and implements cleanup. However, it is not portable.

### 4. Service Management

**Reference**: Does not include a service installer in the checked files; README mentions systemd setup instructions for Linux (manual user steps).

**Citadel**: `backend/lib/service-installer.js` is a polished Windows NSSM manager with advanced features:
- Finds nssm.exe via multiple paths (project root, runtime/, node.exe dir, PATH).
- Configures NSSM with production settings:
  - AppThrottle 15000ms (prevents failures on slow disks during cold start).
  - AppRestartDelay 3000ms (prevents rapid restart loops).
  - AppExit Default Restart (ensures service auto-restarts).
  - Failure recovery: 3 restart attempts with 60s delays.
  - Log rotation at 5MB.
- Implements a `repairService()` command to reset NSSM's failure counter (solves user issues where the service gets stuck in PAUSED state).

**Comparison**: Citadel's NSSM configuration is more mature and user-friendly than the reference. However, it lacks any abstraction for Linux (systemd) or macOS.

### 5. Installer & Deployment

**Reference**: Provides a Dockerfile + docker-compose.yml for containerized Linux deployment. The Dockerfile:
- Starts from `ubuntu`.
- Installs required libraries (libcap-dev, lib32gcc-s1, libcurl4, libcurl4-openssl-dev).
- Creates a dedicated `dayz:1001` user for security.
- Copies the pre-compiled manager binary into /usr/local/bin/.
- Sets WORKDIR and USER, then runs the manager.

**Citadel**: No Dockerfile, docker-compose.yml, or containerization support. The `install.ps1` PowerShell script is Windows-only and assumes citadel-node.exe and nssm.exe are in the package.

### 6. Installation & Upgrade Process

**Reference**: Documented in README; users manually set up systemd service or Docker.

**Citadel**: `install.ps1` is comprehensive:
- Self-elevates to Administrator if needed (line 16–20).
- Stops the existing service before copying files (lines 45–63) to avoid file locks during upgrade (important for node.exe).
- Preserves data/ and .env on upgrade (idempotent).
- Creates the data/ directory if missing.
- Generates .env from .env.example if needed.
- Registers the Windows service via NSSM with full configuration.

**Comparison**: Citadel's installer is more polished and user-friendly; the service-stop-before-copy pattern is a best practice not evident in the reference.

### 7. Desktop Application

**Reference**: CLI-based; users access the manager via a web browser.

**Citadel**: Includes an Electron desktop app (desktop/ folder with assets, scripts, splash screens). This is a significant feature not in the reference and differentiates Citadel as a commercial product.

### 8. Documentation

**Reference**: README includes a dedicated "Linux Server" section with:
- Binary setup instructions (install libs, create user, enable systemd).
- Docker setup with docker-compose example.
- Platform-specific library dependencies clearly listed.

**Citadel**: README states platform is Windows only; no multi-platform documentation. The feature list emphasizes GUI, cloud pairing, and advanced features (VIP priority queue, killfeed, watchlist) that align with a premium product positioning.

## Detailed Code Analysis

### Firewall Manager (Citadel vs. Reference)

**Citadel** (`backend/lib/firewall-manager.js`, 290 lines):
- `runPS()`: Non-elevated PowerShell command with 30s timeout.
- `runElevatedPS()`: Elevated PowerShell using `Start-Process -Verb RunAs`; writes script to temp file, reads exit code from temp file.
- `buildRuleSpecs()`: Generates rules for game, query, and RCON ports.
- `ensureFirewallRules()`: Idempotent; checks existence first (non-elevated), then creates missing rules in a single elevated batch.
- **Strength**: Partial success handling (lines 212–226) verifies rules one-by-one if batch creation fails; robust error logging.
- **Weakness**: No OS guard; will fail if `powershell.exe` is not available or not Windows.

**Reference** (`src/services/netsh.ts`, 97 lines):
- Much simpler; uses netsh `firewall` and `advfirewall` commands directly.
- `addRule()`: Adds a single rule (legacy netsh syntax).
- `getAllRules()`: Parses verbose netsh output into a JSON array.
- `getRulesByPath()`: Filters rules by executable path.
- **Simplicity**: Fewer edge cases; relies on netsh being available (Windows only).

### Service Installer (Citadel)

**Citadel** (`backend/lib/service-installer.js`, 499 lines):
- `findNssm()`: Checks 4 fallback locations before failing; handles legacy and new layouts.
- `requireElevation()`: Prompts user if not admin; includes helpful error message with instructions.
- `installService()`: Comprehensive setup with 10 steps (display name, description, directory, environment, logging, rotation, throttle, restart policy, failure recovery).
- `repairService()`: Novel feature to reset NSSM failure counter and restart (addresses user pain point where service gets stuck PAUSED).
- **Comments & Clarity**: Well-documented with inline explanations of NSSM throttle (15s) and why it matters (cold start + AV scanning).

**Comparison**: No equivalent in the reference (which leaves systemd setup to the user).

### Setup Script (Citadel)

**Citadel** (`backend/lib/setup.js`, 157 lines):
- Generates .env with crypto-secure JWT and API key secrets.
- Creates data/ directory.
- Validates and patches existing .env (replaces placeholder secrets if re-run).
- Generates citadel.config.json with schema-driven defaults.
- **Strength**: Safe defaults; never overwrites user files; can be run multiple times without data loss.
- **No platform dependency**: Safe to run on any OS (uses only fs, path, crypto).

## Operational Risks & Gaps

| Risk | Current Status | Impact | Mitigation |
|------|---|---|---|
| **Hardcoded Windows paths** | Service-installer, firewall-manager require Win32 | Code fails on Linux/macOS | Add OS detection guard; export stubs for non-Windows |
| **NSSM dependency not validated** | Service-installer tries to find nssm.exe but doesn't gracefully degrade | Unhelpful error on non-Windows systems | Wrap NSSM code in `if (detectOS() === 'windows')` guard |
| **PowerShell hardcoded** | Firewall-manager spawns `powershell` without OS check | Fails on non-Windows; no fallback | Add `detectOS()` check; log stub message on Linux |
| **No requirements validation** | Setup skips VCRedist/DirectX checks | Users may hit DLL-not-found errors post-install | Create requirements-checker.js following reference pattern |
| **No Docker support** | No Dockerfile or docker-compose | Cannot containerize Citadel for cloud/VPS | Create Dockerfile + docker-compose.yml (larger effort) |
| **Installer is PowerShell-only** | install.ps1 only runs on Windows | No way to install Citadel on Linux | Future: create install.sh for Linux (deferred) |

## Strengths of Current Citadel Implementation

1. **NSSM Maturity**: The 15s AppThrottle config is a thoughtful detail; addresses real user pain (slow disk + AV). Reference doesn't have an equivalent.
2. **Firewall Partial Success**: Retry verification (lines 212–226) is robust; ensures at least some rules are created even if elevation fails.
3. **Installer Best Practice**: Stopping the service before copying files prevents node.exe lock on upgrades. This is a pattern the reference doesn't document.
4. **Secure Defaults**: setup.js generates cryptographically-secure secrets, never overwrites existing config.
5. **Desktop App**: Electron GUI is a commercial differentiator not in the reference.

## Recommendations

### Immediate (Low Risk, High Value)

1. **Create `backend/lib/detect-os.js`** (trivial effort):
   ```javascript
   exports.detectOS = () => {
     if (process.platform === 'win32') return 'windows';
     if (['linux', 'darwin', 'freebsd'].includes(process.platform)) return 'linux';
     return 'unknown';
   };
   ```
   Then import and use in firewall-manager and service-installer.

2. **Guard firewall-manager exports** (small effort):
   ```javascript
   const { detectOS } = require('./detect-os');
   async function ensureFirewallRules(serverName, ports) {
     if (detectOS() !== 'windows') {
       logger.info('Firewall rules managed via OS-native firewall');
       return { success: true, created: [], skipped: [], errors: [] };
     }
     // ... rest of implementation
   }
   ```

3. **Guard service-installer exports** (small effort):
   ```javascript
   const { detectOS } = require('./detect-os');
   async function installService() {
     if (detectOS() !== 'windows') {
       console.error('Windows service management requires Windows OS');
       return { ok: false, error: 'not-windows' };
     }
     // ... rest of implementation
   }
   ```

4. **Update README** (trivial):
   Add: "Currently Windows-only. Linux and Docker support planned for v3.x roadmap."

### Medium Term (Moderate Effort, Strategic Value)

5. **Create `backend/lib/requirements-checker.js`** (medium effort):
   - Check VCRedist/DirectX on Windows (follow reference pattern).
   - Check libcap-dev, lib32gcc-s1, libcurl4, libcurl4-openssl-dev on Linux.
   - Called during setup or health-check; provide user-friendly remediation commands.

6. **Create Dockerfile + docker-compose.yml** (medium-large effort):
   - Base image: `node:18-alpine` (lightweight) or `ubuntu` (reference pattern).
   - Install runtime libs.
   - Copy Citadel binaries + config template.
   - Expose ports (2302–2312 game, 8766 query, 27016 RCON, 3001 web).
   - Run as non-root user.

### Future (Larger Effort, Strategic Positioning)

7. **Linux native support** (large effort):
   - Create `install.sh` for Linux; replace install.ps1 pattern with bash.
   - Systemd service generator (not NSSM).
   - Conditional code paths in server-starter, log-reader, process-manager for Linux file paths and process APIs.

## Conclusion

Citadel is a feature-rich commercial product with Windows-specific operational tooling (NSSM, PowerShell, Electron) that is more polished than the reference in several ways (15s throttle, failure recovery, firewall partial success). However, it lacks any platform abstraction, which creates operational risk if non-Windows deployment is ever considered and makes the codebase fragile to accidental breakage.

The recommended path is to:
1. **Immediately** add a thin OS detection layer and platform guards to firewall-manager and service-installer (4–6 hours of work).
2. **Near-term** add requirements validation and Docker support (16–24 hours).
3. **Future** add native Linux support if the business case materializes (40+ hours).

This approach unblocks future multi-platform work without disrupting the current Windows-focused product and maintains the high quality of Citadel's operational features.

## Feature gaps

| Title | Direction | Priority | Effort | Description |
|---|---|---|---|---|
| Linux Server Support (Binary & Containerization) | ref_has_current_lacks | high | large | Reference supports full Linux deployment (binary, systemd, Docker); Citadel is Windows-only with no Docker. |
| Cross-platform OS Detection Layer | ref_has_current_lacks | high | small | Reference has clean `detectOS()` utility covering 7 Unix variants; Citadel has no abstraction (hardcoded Win32). |
| Multi-platform Requirements Checking | ref_has_current_lacks | medium | medium | Reference checks VCRedist/DirectX on Windows, libcap/libcurl on Linux; Citadel has no requirements validation. |
| Firewall Abstraction & Linux Support | ref_has_current_lacks | high | medium | Reference has OS-aware firewall (Windows netsh, Linux stub); Citadel hardcoded to PowerShell netsh, not portable. |
| Service Management (Windows NSSM vs Generic) | both_have_current_better | medium | trivial | Citadel has more robust NSSM config (15s throttle, failure recovery, log rotation) than reference; reference offers systemd for Linux as alternative. |
| GUI Detection Portability | ref_has_current_lacks | low | small | Reference detects Windows GUI (WMIC); Citadel has no equivalent; both Windows-centric. |
| Desktop App (Electron) | current_has_ref_lacks | medium | large | Citadel has desktop/Electron app; reference is CLI-only (web UI via browser). |
| Installer Robustness | current_has_ref_lacks | low | trivial | Citadel's install.ps1 stops existing service before copying files (prevents lock); reference lacks this detail. |

## Code improvements

| Title | File | Priority | Effort | Risk | Description |
|---|---|---|---|---|---|
| Create util/detect-os.js to abstract platform detection | `backend/lib/detect-os.js (new)` | high | trivial | low | Export `detectOS()` function returning 'windows', 'linux', or 'unknown'. Cover process.platform check for win32 vs unix variants (darwin, linux, freebsd). Use in firewall-manager, service-installer, and setup modules to gate platform-specific code. Follows reference pattern from src/util/detect-os.ts. |
| Extend firewall-manager.js with Linux/macOS stub | `backend/lib/firewall-manager.js` | high | small | low | Wrap ensureFirewallRules() and removeFirewallRules() in detectOS() check. On non-Windows, log a stub message (e.g., 'Firewall rules managed via OS firewall') instead of spawning PowerShell. Prevents port-binding failures on non-Windows; aligns with reference pattern. |
| Refactor service-installer.js for platform abstraction | `backend/lib/service-installer.js` | high | medium | medium | Wrap all NSSM-dependent code (lines 41–498) inside a Windows-only guard using detectOS(). Export a no-op or systemd-stub for non-Windows. Move OS check to module level; currently expects NSSM on all platforms. Prevents failures on non-Windows where NSSM is unavailable. |
| Add requirements validation for Windows/Linux | `backend/lib/requirements-checker.js (new)` | medium | medium | low | Create async function `checkRuntimeLibs()` that on Windows checks for VCRedist/DirectX (like reference), on Linux checks libcap-dev, lib32gcc-s1, libcurl4 via dpkg. Log user-friendly installation commands. Called during setup or health-check. Follows reference's requirements.ts pattern. |
| Fortify install.ps1 with pre-copy service stop verification | `install.ps1 (lines 46–63)` | low | trivial | low | Already stops service before copying (lines 45–63), but add explicit retry loop waiting for process exit (already present). Verify the service is fully stopped before file copy proceeds. Current implementation is sound; document in code that this prevents node.exe lock on upgrade. |
| Add README section for future Linux/Docker support | `README.md` | medium | trivial | low | Add a 'Roadmap / Future' section mentioning that Linux and Docker support are planned. Link to reference implementation as proof-of-concept. Set user expectations: currently Windows-only, multi-platform support in development. |
| Sanitize FirewallRule names like reference (alphabetic only) | `backend/lib/firewall-manager.js (line 133)` | low | trivial | low | Already sanitizes using `(name \|\| 'Server').replace(/[^a-zA-Z0-9 _\-.]/g, '')` on line 133, matching reference pattern exactly. No change needed; code is well-written. |

## Recommendations

| Title | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|
| Implement OS detection abstraction layer (detect-os.js) | critical | small | low | Unblocks all subsequent cross-platform work. Reference demonstrates clean separation; Citadel has zero platform abstraction. Creates foundation for graceful Linux/macOS stubs without rewriting firewall/service modules. |
| Add platform guards to firewall-manager.js and service-installer.js | critical | small | low | These modules will fail on non-Windows (NSSM not found, PowerShell hardcoded). Quick surgical fixes prevent runtime errors if code ever runs on Linux. Align with reference's approach (linux stub returns true). |
| Plan Linux/Docker support in v3.x roadmap | high | large | medium | Reference proves DayZ server manager can run on Linux (native binary + Docker). Citadel is feature-rich commercial product with GUI; adding Linux would differentiate from reference and unlock VPS/cloud markets. Effort is large but strategic value high. |
| Document Windows-specific assumptions in code comments | medium | trivial | low | Install.ps1, service-installer.js, firewall-manager.js all assume Win32. Add comments like 'Windows-only: NSSM dependency' to every function. Helps future maintainers and prevents accidental breakage when porting. |
| Adopt reference's requirements validation pattern (later phase) | medium | medium | low | Reference's Requirements service is robust and multi-platform. If Linux support is added, reuse this pattern: detect VCRedist/DirectX on Windows, dpkg/ldconfig on Linux, provide user-friendly install commands. Not urgent for Windows-only product but valuable for future multi-platform support. |
| Keep NSSM configuration as-is (15s throttle, restart policy) | low | trivial | low | Citadel's service installer is more mature than reference (lines 240–268). 15s AppThrottle handles slow disks/AV; failure recovery with 3 retarts + 60s delays prevents PAUSED state. Reference has bare-bones systemd. Current implementation is a strength; do not regress. |

