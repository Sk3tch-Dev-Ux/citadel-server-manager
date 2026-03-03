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

  /** Leaderboard refresh interval (ms) — 5 minutes */
  LEADERBOARD_INTERVAL_MS: 5 * 60 * 1000,

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

  /** Delay between restart attempts (ms) */
  RESTART_DELAY_MS: 3_000,

  /** Maximum restart attempts before giving up */
  MAX_RESTART_ATTEMPTS: 3,

  // ─── Log & Data Limits ──────────────────────────────────
  /** Max log entries per server kept in memory */
  MAX_LOG_ENTRIES: 5_000,

  /** Max audit trail entries kept in memory */
  MAX_AUDIT_ENTRIES: 10_000,

  /** Max audit entries persisted to disk */
  MAX_AUDIT_PERSIST: 2_000,

  /** Max in-app notifications kept in memory */
  MAX_NOTIFICATION_COUNT: 200,

  /** Max delivery records per webhook */
  MAX_WEBHOOK_DELIVERIES: 50,

  // ─── Timeouts ───────────────────────────────────────────
  /** Default timeout for lifecycle hook execution (ms) */
  HOOK_TIMEOUT_MS: 30_000,

  /** SteamCMD initial self-update timeout (ms) */
  STEAMCMD_INIT_TIMEOUT_MS: 120_000,

  /** SteamCMD login validation timeout (ms) */
  STEAMCMD_LOGIN_TIMEOUT_MS: 60_000,

  /** SteamCMD mod download timeout (ms) — 30 minutes */
  STEAMCMD_DOWNLOAD_TIMEOUT_MS: 30 * 60 * 1000,

  /** SteamCMD game update timeout (ms) — 60 minutes */
  STEAMCMD_UPDATE_TIMEOUT_MS: 60 * 60 * 1000,

  // ─── Graceful Shutdown ──────────────────────────────────
  /** Force-exit timeout after graceful shutdown begins (ms) */
  SHUTDOWN_FORCE_TIMEOUT_MS: 5_000,

  // ─── Health Monitoring ──────────────────────────────────
  /** Cooldown between health alerts per server (ms) — 5 minutes */
  HEALTH_ALERT_COOLDOWN_MS: 5 * 60 * 1000,
};
