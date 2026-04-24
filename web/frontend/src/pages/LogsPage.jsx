/**
 * Server logs page.
 *
 * Reworked in v2.8:
 *   - Debounced message-contains search
 *   - Level + source filters (combinable — multi-select sources)
 *   - Time range presets: last 15m, 1h, 6h, 24h, or a custom window
 *   - CSV export respecting current filters
 *   - Live socket updates merged into view in real time (skipped when
 *     filters would hide them — toggle pauses the stream visibly)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import { useDebouncedValue, timeAgo } from '../utils';
import {
  FileCode, Search, Download, RefreshCw, X, AlertTriangle,
  Info, CheckCircle, Activity, Pause, Play,
} from '../components/Icon';

const PAGE_LIMIT = 1000; // fetched
const LEVELS = [
  { id: '', label: 'All levels', color: 'var(--text-muted)' },
  { id: 'info', label: 'INFO', color: '#3b82f6' },
  { id: 'warn', label: 'WARN', color: '#f59e0b' },
  { id: 'error', label: 'ERROR', color: '#ef4444' },
];
const TIME_PRESETS = [
  { id: '', label: 'All time', minutes: null },
  { id: '15m', label: 'Last 15 min', minutes: 15 },
  { id: '1h', label: 'Last 1 hr', minutes: 60 },
  { id: '6h', label: 'Last 6 hrs', minutes: 360 },
  { id: '24h', label: 'Last 24 hrs', minutes: 1440 },
];

function levelColor(level) {
  const l = (level || '').toLowerCase();
  if (l === 'error') return '#ef4444';
  if (l === 'warn' || l === 'warning') return '#f59e0b';
  if (l === 'info') return '#3b82f6';
  return 'var(--text-muted)';
}

export default function LogsPage({ serverId }) {
  const socket = useSocket();

  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [sources, setSources] = useState([]); // [{ name, count }]
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [levelFilter, setLevelFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState(new Set()); // multi-select
  const [timePreset, setTimePreset] = useState('');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 200);

  // Live-feed toggle (lets users pause to study a window without new entries
  // sliding in)
  const [live, setLive] = useState(true);

  const fromIso = useMemo(() => {
    const preset = TIME_PRESETS.find((p) => p.id === timePreset);
    if (!preset || !preset.minutes) return '';
    return new Date(Date.now() - preset.minutes * 60000).toISOString();
  }, [timePreset]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (levelFilter) p.set('level', levelFilter);
    if (sourceFilter.size > 0) p.set('source', [...sourceFilter].join(','));
    if (debouncedQ) p.set('q', debouncedQ);
    if (fromIso) p.set('from', fromIso);
    return p;
  }, [levelFilter, sourceFilter, debouncedQ, fromIso]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [logsRes, sourcesRes] = await Promise.all([
        API.get(`/api/servers/${serverId}/logs?${params.toString()}`),
        sources.length === 0 ? API.get(`/api/servers/${serverId}/logs/sources`) : Promise.resolve(null),
      ]);
      // Backward-compat: endpoint returns a plain array when no filters are present
      if (Array.isArray(logsRes)) {
        setEntries(logsRes);
        setTotal(logsRes.length);
        setUnfilteredTotal(logsRes.length);
      } else {
        setEntries(Array.isArray(logsRes?.entries) ? logsRes.entries : []);
        setTotal(logsRes?.total || 0);
        setUnfilteredTotal(logsRes?.unfilteredTotal || 0);
      }
      if (sourcesRes) setSources(sourcesRes.sources || []);
      setLoaded(true);
    } catch (err) {
      setError(err.message || 'Failed to load logs');
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, serverId]);

  useEffect(() => { load(); }, [load]);

  // Live updates
  useEffect(() => {
    if (!socket || !live) return;
    const handler = (data) => {
      if (data.serverId !== serverId) return;
      // Apply active filters client-side so live entries don't leak through
      if (levelFilter && data.level !== levelFilter) return;
      if (sourceFilter.size > 0 && !sourceFilter.has(data.source)) return;
      if (debouncedQ) {
        const needle = debouncedQ.toLowerCase();
        if (!(data.message || '').toLowerCase().includes(needle) &&
            !(data.source || '').toLowerCase().includes(needle)) return;
      }
      if (fromIso && Date.parse(data.timestamp) < Date.parse(fromIso)) return;
      setEntries((prev) => [data, ...prev].slice(0, PAGE_LIMIT));
      setTotal((t) => t + 1);
      setUnfilteredTotal((t) => t + 1);
    };
    socket.on('log', handler);
    return () => socket.off('log', handler);
  }, [socket, serverId, live, levelFilter, sourceFilter, debouncedQ, fromIso]);

  const hasFilters = !!(levelFilter || sourceFilter.size > 0 || timePreset || debouncedQ);
  const handleClear = () => {
    setLevelFilter(''); setSourceFilter(new Set()); setTimePreset(''); setQ('');
  };

  const toggleSource = (name) => {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleExport = () => {
    const exportParams = new URLSearchParams(params);
    exportParams.delete('limit');
    API.raw(`/api/servers/${serverId}/logs/export.csv?${exportParams.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = res.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'logs.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      })
      .catch((err) => window.addToast?.(`Export failed: ${err.message}`, 'error'));
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <FileCode size={20} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Logs</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {hasFilters
            ? `${total.toLocaleString()} of ${unfilteredTotal.toLocaleString()}`
            : `${unfilteredTotal.toLocaleString()}`} line{unfilteredTotal === 1 ? '' : 's'}
        </span>
        {live ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#22c55e' }}>
            <Activity size={10} className="pulse" /> Live
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Paused</span>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={() => setLive((v) => !v)} title={live ? 'Pause live stream' : 'Resume live stream'}>
          {live ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}
        </button>
        <button className="btn btn-sm btn-secondary" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn btn-sm btn-secondary" onClick={handleExport} disabled={entries.length === 0}>
          <Download size={13} /> Export CSV
        </button>
      </div>

      {/* Filter row 1 — search + level + time preset + clear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px', minWidth: 240 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search in messages + sources…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 30, width: '100%' }}
          />
        </div>
        <select className="input" value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} style={{ width: 140 }}>
          {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <select className="input" value={timePreset} onChange={(e) => setTimePreset(e.target.value)} style={{ width: 140 }}>
          {TIME_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {hasFilters && (
          <button className="btn btn-sm btn-ghost" onClick={handleClear}>
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* Filter row 2 — source chips (multi-select) */}
      {sources.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginRight: 4 }}>Source:</span>
          {sources.slice(0, 15).map((s) => (
            <button
              key={s.name}
              onClick={() => toggleSource(s.name)}
              className={`btn btn-xs ${sourceFilter.has(s.name) ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 10 }}
            >
              {s.name} ({s.count})
            </button>
          ))}
          {sourceFilter.size > 0 && (
            <button className="btn btn-xs btn-ghost" onClick={() => setSourceFilter(new Set())} style={{ color: 'var(--text-muted)' }}>
              Clear sources
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* Output */}
      <div className="console-wrap" style={{ flex: 1, minHeight: 0 }}>
        <div className="console-output" style={{ height: '100%' }}>
          {!loaded ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<FileCode size={36} />}
              title={hasFilters ? 'No logs match your filters' : 'No logs yet'}
              description={hasFilters
                ? 'Try widening the time range or clearing filters.'
                : 'Server logs will appear here once the server is running. If the server is already up, give it a few seconds.'}
              action={hasFilters ? (
                <button className="btn btn-sm btn-secondary" onClick={handleClear}>
                  <X size={13} /> Clear filters
                </button>
              ) : null}
            />
          ) : (
            [...entries].reverse().map((log, i) => (
              <div key={`${log.timestamp}-${i}`} className="console-line">
                <span className="console-time" title={log.timestamp}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 5px', marginRight: 6, letterSpacing: 0.3,
                  background: `color-mix(in srgb, ${levelColor(log.level)} 15%, transparent)`,
                  color: levelColor(log.level), borderRadius: 3, textTransform: 'uppercase',
                }}>
                  {log.level || 'info'}
                </span>
                <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>[{log.source || '—'}]</span>
                {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
