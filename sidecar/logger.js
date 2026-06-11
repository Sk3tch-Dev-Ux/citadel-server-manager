/**
 * Citadel Sidecar — Logger (pino)
 */
const pino = require('pino');

// pino-pretty is a devDependency — absent from production installs. Resolve it
// before asking pino to use it: an unresolvable transport throws at require
// time, which crash-looped the sidecar (and starved the dashboards of all
// in-game data) on installed builds.
let transport;
if (process.env.NODE_ENV !== 'production') {
  try {
    require.resolve('pino-pretty');
    transport = { target: 'pino-pretty', options: { colorize: true } };
  } catch { /* fall through to plain JSON logging */ }
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport,
});

module.exports = logger;
