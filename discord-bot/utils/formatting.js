/**
 * Formatting helpers for Discord embeds.
 */

/** Format playtime seconds to readable string */
function formatPlaytime(seconds) {
  if (!seconds || seconds <= 0) return '0h';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Format uptime from ISO date */
function formatUptime(startedAt) {
  if (!startedAt) return 'N/A';
  const diff = Date.now() - new Date(startedAt).getTime();
  if (diff < 0) return 'N/A';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** ASCII progress bar */
function progressBar(pct, length = 10) {
  const filled = Math.round((pct / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/** Status indicator emoji */
function statusIndicator(status) {
  const map = { running: '🟢', stopped: '🔴', starting: '🟡', stopping: '🟡', crashed: '💥', unknown: '⚪' };
  return map[status] || '⚪';
}

module.exports = { formatPlaytime, formatUptime, progressBar, statusIndicator };
