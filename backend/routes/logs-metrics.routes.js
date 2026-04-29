/**
 * Server logs, console output, and metrics routes.
 */
const ctx = require('../lib/context');
const { authForServer } = require('../middleware/auth');
const { getConsoleBuffer } = require('../lib/rpt-tailer');

function filterLogs(rawLogs, { level, source, q, from, to }) {
  let logs = rawLogs;
  if (level) logs = logs.filter((l) => l.level === level);
  if (source) {
    const sources = String(source).split(',').map((s) => s.trim()).filter(Boolean);
    if (sources.length > 0) logs = logs.filter((l) => sources.includes(l.source));
  }
  if (from) {
    const ts = Date.parse(from);
    if (!Number.isNaN(ts)) logs = logs.filter((l) => Date.parse(l.timestamp) >= ts);
  }
  if (to) {
    const ts = Date.parse(to);
    if (!Number.isNaN(ts)) logs = logs.filter((l) => Date.parse(l.timestamp) <= ts);
  }
  if (q) {
    const needle = String(q).toLowerCase();
    logs = logs.filter((l) =>
      (l.message || '').toLowerCase().includes(needle) ||
      (l.source || '').toLowerCase().includes(needle)
    );
  }
  return logs;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

module.exports = function(app) {
  // System logs (lifecycle events: start, stop, health, updates)
  // Supports: level, source (comma-separated), q (message/source contains),
  //           from/to (ISO timestamps), limit, offset
  app.get('/api/servers/:id/logs', authForServer('logs.view'), (req, res) => {
    const { level, source, q, from, to } = req.query;
    const limit = Math.min(2000, parseInt(req.query.limit, 10) || 200);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const raw = ctx.serverStates[req.params.id]?.logs || [];
    const filtered = filterLogs(raw, { level, source, q, from, to });

    // Back-compat: when no filter/pagination params are present, return a
    // raw array (matches the old behavior used by LogsPage v1).
    const hasParams = level || source || q || from || to || req.query.limit || req.query.offset;
    if (!hasParams) {
      return res.json(raw.slice(0, 200));
    }

    res.json({
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unfilteredTotal: raw.length,
    });
  });

  // Distinct source values for the filter dropdown
  app.get('/api/servers/:id/logs/sources', authForServer('logs.view'), (req, res) => {
    const raw = ctx.serverStates[req.params.id]?.logs || [];
    const counts = {};
    for (const l of raw) {
      if (!l.source) continue;
      counts[l.source] = (counts[l.source] || 0) + 1;
    }
    res.json({
      sources: Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    });
  });

  // CSV export respecting current filters
  app.get('/api/servers/:id/logs/export.csv', authForServer('logs.view'), (req, res) => {
    const { level, source, q, from, to } = req.query;
    const raw = ctx.serverStates[req.params.id]?.logs || [];
    const filtered = filterLogs(raw, { level, source, q, from, to });
    const srvName = ctx.servers.find((s) => s.id === req.params.id)?.name || req.params.id;
    const safeName = srvName.replace(/[^a-zA-Z0-9-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('timestamp,level,source,message\n');
    for (const l of filtered) {
      res.write(`${csvEscape(l.timestamp)},${csvEscape(l.level || '')},${csvEscape(l.source || '')},${csvEscape(l.message || '')}\n`);
    }
    res.end();
  });

  // Server console output (DayZ stdout from server_console.log)
  app.get('/api/servers/:id/console', authForServer('logs.view'), (req, res) => {
    const limit = parseInt(req.query.limit) || 500;
    const buf = getConsoleBuffer(req.params.id);
    res.json(buf.slice(-limit).reverse());
  });

  app.get('/api/servers/:id/metrics', authForServer('metrics.view'), (req, res) => {
    res.json(ctx.serverStates[req.params.id]?.metricsHistory || { cpu: [], ram: [], players: [], fps: [], timestamps: [] });
  });

  app.get('/api/servers/:id/metrics/stream', authForServer('metrics.view'), (req, res) => {
    res.json({ message: 'Use Socket.IO events: metrics' });
  });
};
