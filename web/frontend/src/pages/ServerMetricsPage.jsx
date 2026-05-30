import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import MiniChart from '../components/MiniChart';
import PageLoader from '../components/PageLoader';
import { RefreshCw, Download } from '../components/Icon';

// Time ranges for the persisted-history view. `downsample` (seconds) keeps the
// point count manageable for long windows. 'live' uses the in-memory window +
// realtime socket updates (the original behavior).
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const RANGES = {
  live: { label: 'Live' },
  '6h':  { label: '6h',  ms: 6 * HOUR,  downsample: 60 },
  '24h': { label: '24h', ms: DAY,       downsample: 300 },
  '7d':  { label: '7d',  ms: 7 * DAY,   downsample: 1800 },
  '30d': { label: '30d', ms: 30 * DAY,  downsample: 3600 },
};

// Series tracked across both the live window and persisted history. The first
// four are OS/basic signals; the rest are the @CitadelAdmin mod's in-game
// telemetry (simulation tick time and world entity counts).
const SERIES = ['cpu', 'ram', 'players', 'fps', 'tick_avg', 'entity_count', 'ai_count', 'vehicle_count'];
const emptySeries = () => SERIES.reduce((o, k) => ((o[k] = []), o), { timestamps: [] });
const EMPTY = emptySeries();

export default function ServerMetricsPage({ serverId }) {
  const socket = useSocket();
  const [range, setRange] = useState('live');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [persistence, setPersistence] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (range === 'live') {
      const m = await API.get(`/api/servers/${serverId}/metrics`);
      setMetrics(m);
      setLoading(false);
      return;
    }
    // Persisted history: fetch a downsampled window and reshape into arrays.
    const since = Date.now() - RANGES[range].ms;
    const ds = RANGES[range].downsample;
    const resp = await API.get(
      `/api/servers/${serverId}/metrics/history?since=${since}&downsample=${ds}&limit=50000`
    );
    setPersistence(resp.persistence !== false);
    const rows = resp.metrics || [];
    const m = emptySeries();
    for (const r of rows) {
      for (const k of SERIES) m[k].push(r[k] ?? 0);
      m.timestamps.push(new Date(r.ts).toISOString());
    }
    setMetrics(m);
    setLoading(false);
  }, [serverId, range]);

  // Reload whenever the range changes; poll live every 10s, history every 60s.
  useEffect(() => {
    setLoading(true);
    load();
    const i = setInterval(load, range === 'live' ? 10000 : 60000);
    return () => clearInterval(i);
  }, [load, range]);

  // Realtime appends only make sense for the live window.
  useEffect(() => {
    if (range !== 'live') return undefined;
    const handler = (data) => {
      if (data.serverId !== serverId) return;
      setMetrics(prev => {
        if (!prev) return prev;
        const m = { ...prev };
        for (const k of SERIES) m[k] = [...(m[k] || []), data[k] ?? 0].slice(-360);
        m.timestamps = [...(m.timestamps || []), data.timestamp].slice(-360);
        return m;
      });
    };
    socket.on('metrics', handler);
    return () => socket.off('metrics', handler);
  }, [serverId, socket, range]);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      // For the live view, default the export to the last 24h of persisted data.
      const r = range === 'live' ? '24h' : range;
      const since = Date.now() - RANGES[r].ms;
      const ds = RANGES[r].downsample;
      await API.download(
        `/api/servers/${serverId}/metrics/history.csv?since=${since}&downsample=${ds}&limit=50000`,
        `metrics-${serverId}-${r}.csv`
      );
    } finally {
      setExporting(false);
    }
  }, [serverId, range]);

  const calcStats = (arr) => {
    if (!arr || arr.length === 0) return { current: 0, min: 0, max: 0, avg: 0 };
    const current = arr[arr.length - 1];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { current, min, max, avg };
  };

  if (loading) return <PageLoader message="Loading metrics..." />;
  const m = metrics || EMPTY;

  const cpuStats = calcStats(m.cpu);
  const ramStats = calcStats(m.ram);
  const playerStats = calcStats(m.players);
  const fpsStats = calcStats(m.fps);
  const tickStats = calcStats(m.tick_avg);
  const entityStats = calcStats(m.entity_count);
  const aiStats = calcStats(m.ai_count);
  const vehicleStats = calcStats(m.vehicle_count);
  // The in-game section is only meaningful once the mod reports — detect any
  // non-zero entity/tick reading so we don't show an empty panel on servers
  // without @CitadelAdmin.
  const hasInGame = (m.entity_count || []).some((v) => v > 0) || (m.tick_avg || []).some((v) => v > 0);
  const dataPoints = m.timestamps?.length || 0;
  const timeSpan = dataPoints > 1
    ? Math.round((new Date(m.timestamps[dataPoints - 1]) - new Date(m.timestamps[0])) / 60000)
    : 0;

  const StatCard = ({ label, stats, unit, color }) => (
    <div className="card">
      <div className="card-header"><div className="card-title" style={{ color }}>{label}</div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>current</span></div>
      <div className="card-value" style={{ color }}>{stats.current.toFixed(1)}{unit}</div>
      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Min</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>{stats.min.toFixed(1)}{unit}</div></div>
        <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Avg</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>{stats.avg.toFixed(1)}{unit}</div></div>
        <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Max</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600 }}>{stats.max.toFixed(1)}{unit}</div></div>
      </div>
    </div>
  );

  const meta = range === 'live'
    ? `${dataPoints} data points · ${timeSpan > 0 ? `${timeSpan}m window` : 'just started'} · updates every 15s`
    : (persistence
        ? `${dataPoints} points · ${RANGES[range].label} window · downsampled to ${RANGES[range].downsample}s`
        : 'Metrics persistence is disabled (better-sqlite3 unavailable) — history is empty.');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {Object.entries(RANGES).map(([key, r]) => (
            <button
              key={key}
              className={`btn btn-sm ${range === key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setRange(key)}
            >{r.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta}</span>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={exporting}>
            <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {range !== 'live' && persistence && dataPoints === 0 ? (
        <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
          No persisted metrics in this window yet. History accumulates while the server runs.
        </div>
      ) : (
        <>
          <div className="grid grid-4" style={{ marginBottom: 20 }}>
            <StatCard label="CPU" stats={cpuStats} unit="%" color="#6cb4f0" />
            <StatCard label="RAM" stats={ramStats} unit="%" color="#c49bff" />
            <StatCard label="Players" stats={playerStats} unit="" color="#5cb85c" />
            <StatCard label="FPS" stats={fpsStats} unit="" color="#e5c07b" />
          </div>
          <div className="grid grid-2">
            <MiniChart data={m.cpu || []} color="#6cb4f0" height={240} label="CPU %" />
            <MiniChart data={m.ram || []} color="#c49bff" height={240} label="RAM %" />
            <MiniChart data={m.players || []} color="#5cb85c" height={240} label="Players" />
            <MiniChart data={m.fps || []} color="#e5c07b" height={240} label="FPS" />
          </div>

          {hasInGame && (
            <>
              <div style={{ margin: '28px 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                In-Game World (via @CitadelAdmin)
              </div>
              <div className="grid grid-4" style={{ marginBottom: 20 }}>
                <StatCard label="Tick Time" stats={tickStats} unit="ms" color="#ef7c8e" />
                <StatCard label="Entities" stats={entityStats} unit="" color="#56c2c2" />
                <StatCard label="AI" stats={aiStats} unit="" color="#d98e4a" />
                <StatCard label="Vehicles" stats={vehicleStats} unit="" color="#9aa7ff" />
              </div>
              <div className="grid grid-2">
                <MiniChart data={m.tick_avg || []} color="#ef7c8e" height={240} label="Tick Time (ms)" />
                <MiniChart data={m.entity_count || []} color="#56c2c2" height={240} label="Entity Count" />
                <MiniChart data={m.ai_count || []} color="#d98e4a" height={240} label="AI Count" />
                <MiniChart data={m.vehicle_count || []} color="#9aa7ff" height={240} label="Vehicle Count" />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
