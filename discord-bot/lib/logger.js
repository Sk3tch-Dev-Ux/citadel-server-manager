/**
 * Simple structured logger for the Discord bot.
 * Wraps console with consistent prefixes and JSON context.
 * Output is captured by bot-manager when running as a child process.
 */

function formatMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) return '';
  return ' ' + JSON.stringify(meta);
}

const logger = {
  info(msgOrMeta, msg) {
    if (typeof msgOrMeta === 'string') {
      console.log(`[bot] ${msgOrMeta}`);
    } else {
      console.log(`[bot] ${msg}${formatMeta(msgOrMeta)}`);
    }
  },

  warn(msgOrMeta, msg) {
    if (typeof msgOrMeta === 'string') {
      console.warn(`[bot] WARN: ${msgOrMeta}`);
    } else {
      console.warn(`[bot] WARN: ${msg}${formatMeta(msgOrMeta)}`);
    }
  },

  error(msgOrMeta, msg) {
    if (typeof msgOrMeta === 'string') {
      console.error(`[bot] ERROR: ${msgOrMeta}`);
    } else {
      console.error(`[bot] ERROR: ${msg}${formatMeta(msgOrMeta)}`);
    }
  },

  debug(msgOrMeta, msg) {
    if (process.env.DEBUG) {
      if (typeof msgOrMeta === 'string') {
        console.log(`[bot] DEBUG: ${msgOrMeta}`);
      } else {
        console.log(`[bot] DEBUG: ${msg}${formatMeta(msgOrMeta)}`);
      }
    }
  },
};

module.exports = logger;
