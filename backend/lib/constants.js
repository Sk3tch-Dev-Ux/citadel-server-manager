/**
 * Shared application constants.
 *
 * Replaces magic numbers scattered across the codebase with named,
 * documented values. Import specific constants where needed rather
 * than importing the whole module.
 */

module.exports = {
  // ─── Polling Intervals ──────────────────────────────────
  /** Main metrics/status polling tick (ms) */
  METRICS_POLL_INTERVAL_MS: 15_000,

  /** Steam Workshop / game-build update polling (ms) — 15 minutes */
  STEAM_UPDATE_POLL_INTERVAL_MS: 15 * 60 * 1000,

  /** Mod auto-detection scan interval (ms) — 5 minutes */
  MOD_DETECT_INTERVAL_MS: 5 * 60 * 1000,

  /** Delay before initial RCON connection attempt after startup (ms) */
  RCON_STARTUP_DELAY_MS: 5_000,

  // ─── Metrics History ────────────────────────────────────
  /** Rolling window size for metrics history (~90 min at 15 s intervals) */
  METRICS_HISTORY_SIZE: 360,

  // ─── Process Management ─────────────────────────────────
  /** Grace period after spawning before declaring launch failed (ms) */
  LAUNCH_GRACE_PERIOD_MS: 10_000,

  /** Timeout for tasklist/taskkill child processes (ms) */
  PROCESS_CMD_TIMEOUT_MS: 5_000,

  /** TTL for cached process-detection results (ms). Metrics polling and the
   *  crash detector both query the same PIDs/executables within a single tick;
   *  a short cache collapses those into one tasklist/Get-Process call. */
  PROCESS_DETECT_TTL_MS: 1_000,

  /** Delay between restart attempts (ms) - DEPRECATED: use exponential backoff in restartServer */
  RESTART_DELAY_MS: 3_000,

  /** Maximum restart attempts before giving up */
  MAX_RESTART_ATTEMPTS: 3,

  /** Exponential backoff delays for restart attempts (ms): 3s, 6s, 12s, 24s, max 120s */
  RESTART_BACKOFF_DELAYS_MS: [3000, 6000, 12000, 24000, 120000],

  /** Cool down window: if server runs for >5 min after restart, reset backoff to 0 */
  RESTART_BACKOFF_COOLDOWN_MS: 5 * 60 * 1000,

  // ─── Log & Data Limits ──────────────────────────────────
  /** Max log entries per server kept in memory */
  MAX_LOG_ENTRIES: 5_000,

  /** Max audit trail entries kept in memory */
  MAX_AUDIT_ENTRIES: 10_000,

  /** Max audit entries persisted to disk (matches MAX_AUDIT_ENTRIES to prevent data loss on restart) */
  MAX_AUDIT_PERSIST: 10_000,

  /** Max in-app notifications kept in memory */
  MAX_NOTIFICATION_COUNT: 200,

  /** Max delivery records per webhook */
  MAX_WEBHOOK_DELIVERIES: 50,

  // ─── Authentication / Tokens ────────────────────────────
  /** Lifetime of a login JWT (ms) — 8h. Drives both the jwt `expiresIn`
   *  and the auth-token cookie maxAge so they can never drift apart. */
  JWT_LOGIN_TTL_MS: 8 * 60 * 60 * 1000,

  /** Clock-skew safety buffer added on top of JWT_LOGIN_TTL_MS when sizing a
   *  user-wide token revocation window (ms) — 5 min. */
  JWT_CLOCK_SKEW_BUFFER_MS: 5 * 60 * 1000,

  /** How long a user-wide revocation entry must live (ms). Login tokens carry
   *  NO jti, so the user-wide branch in isTokenRevoked() is the only revocation
   *  that applies to them — it must outlive the longest-lived login token (its
   *  full TTL) plus a clock-skew buffer, or an admin password-reset / change
   *  stops invalidating sessions partway through the token's life. */
  TOKEN_REVOCATION_TTL_MS: 8 * 60 * 60 * 1000 + 5 * 60 * 1000,

  // ─── Timeouts ───────────────────────────────────────────
  /** Default timeout for lifecycle hook execution (ms) */
  HOOK_TIMEOUT_MS: 30_000,

  /** SteamCMD initial self-update timeout (ms) */
  STEAMCMD_INIT_TIMEOUT_MS: 120_000,

  /** SteamCMD login validation timeout (ms) — 120s to allow time for Steam Guard email delivery */
  STEAMCMD_LOGIN_TIMEOUT_MS: 120_000,

  /** SteamCMD mod download timeout (ms) — 30 minutes */
  STEAMCMD_DOWNLOAD_TIMEOUT_MS: 30 * 60 * 1000,

  /** SteamCMD game update timeout (ms) — 60 minutes */
  STEAMCMD_UPDATE_TIMEOUT_MS: 60 * 60 * 1000,

  /** InHouse sidecar admin-action request timeout (ms). The InHouse provider
   *  funnels ~120 admin methods through a single _request(); without a bound,
   *  one unreachable/hung sidecar wedges every admin call indefinitely. Matches
   *  the sidecar player-data fetch budget. */
  INHOUSE_REQUEST_TIMEOUT_MS: 8_000,

  // ─── Graceful Shutdown ──────────────────────────────────
  /** Force-exit timeout after graceful shutdown begins (ms) */
  SHUTDOWN_FORCE_TIMEOUT_MS: 5_000,

  // ─── Health Monitoring ──────────────────────────────────
  /** Cooldown between health alerts per server (ms) — 5 minutes */
  HEALTH_ALERT_COOLDOWN_MS: 5 * 60 * 1000,

  // ─── Data Store ───────────────────────────────────────
  /** Debounce interval for JSON file writes (ms) */
  DATA_STORE_DEBOUNCE_MS: 1_000,

  // ─── RCON ─────────────────────────────────────────────
  /** RCON login handshake timeout (ms) */
  RCON_LOGIN_TIMEOUT_MS: 10_000,
  /** RCON command response timeout (ms) */
  RCON_COMMAND_TIMEOUT_MS: 5_000,
  /** RCON keep-alive ping interval (ms) — 15s for faster disconnect detection (was 30s) */
  RCON_KEEPALIVE_INTERVAL_MS: 15_000,
  /** Reconnect if no valid packet of any kind has been received in this long (ms).
   *  BattlEye itself drops a connection after ~45s of silence. */
  RCON_STALE_TIMEOUT_MS: 45_000,

  // ─── Crash Detector ───────────────────────────────────
  /** Crash backoff schedule (ms): 5s → 10s → 20s → 40s → 80s → 5 min */
  CRASH_BACKOFF_DELAYS_MS: [5000, 10000, 20000, 40000, 80000, 300000],
  /** Reset crash backoff if server stable for this long (ms) — 10 min */
  CRASH_COOLDOWN_WINDOW_MS: 10 * 60 * 1000,
  /** Circuit breaker: max auto-restarts per hour */
  MAX_CRASH_RESTARTS_PER_HOUR: 10,

  // ─── RPT Tailer ───────────────────────────────────────
  /** Max console output lines buffered per server */
  MAX_CONSOLE_LINES: 500,
};
