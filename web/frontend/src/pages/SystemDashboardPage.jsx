import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import { Cpu, MemoryStick, HardDrive, Network, Monitor, Users, Clock, Server, Wifi, WifiOff, AlertTriangle } from '../components/Icon';
import MiniChart from '../components/MiniChart';

const TIME_RANGES = [
  { id: '15m', label: '15m' },
  { id: '1h', label: '1h' },
  { id: '6h', label: '6h' },
  { id: '24h', label: '24h' },
];

export default function SystemDashboardPage() {
  const { servers } = useServers();
  const [info, setInfo] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [range, setRange] = useState('1h');
  const [history, setHistory] = useState({ samples: [], thresholds: null });

  const loadInfo = useCallback(async () => {
    try {
      const data = await API.get('/api/system/info');
      if (data && !data.error) setInfo(data);
    } catch {}
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const data = await API.get('/api/system/metrics');
      if (data && !data.error) setMetrics(data);
    } catch {}
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await API.get(`/api/system/metrics/history?range=${range}`);
      if (data && !data.error) {
        setHistory({
          samples: Array.isArray(data.samples) ? data.samples : [],
          thresholds: data.thresholds || null,
        });
      }
    } catch {}
  }, [range]);

  useEffect(() => {
    loadInfo();
    loadMetrics();
    loadHistory();
    const metricsInterval = setInterval(loadMetrics, 10000);
    const historyInterval = setInterval(loadHistory, 30000);
    return () => { clearInterval(metricsInterval); clearInterval(historyInterval); };
  }, [loadInfo, loadMetrics, loadHistory]);

  // Threshold detection — aggregate warnings for the top banner
  const activeWarnings = useMemo(() => {
    const out = [];
    const th = history.thresholds;
    if (!th) return out;
    const cpu = metrics?.cpu;
    const mem = metrics?.memory?.percent;
    if (cpu != null && cpu >= (th.cpu?.warn ?? 90)) out.push({ label: th.cpu.label, value: cpu, threshold: th.cpu.warn });
    if (mem != null && mem >= (th.mem?.warn ?? 90)) out.push({ label: th.mem.label, value: mem, threshold: th.mem.warn });
    const diskPct = info?.disk?.totalGB > 0 ? (info.disk.usedGB / info.disk.totalGB) * 100 : 0;
    if (diskPct >= (th.disk?.warn ?? 95)) out.push({ label: th.disk.label, value: diskPct, threshold: th.disk.warn });
    return out;
  }, [metrics, info, history.thresholds]);

  const runningCount = servers.filter(s => s.status === 'running').length;
  const totalPlayers = servers.reduce((a, s) => a + (s.playerCount || 0), 0);

  return (
    <div>
      {/* Host Identity */}
      <div className="system-host-bar">
        <div className="system-host-info">
          <Monitor size={18} />
          <div>
            <div className="system-host-name">{info?.hostname || 'Loading...'}</div>
            <div className="system-host-meta">{info?.platform || ''}</div>
          </div>
        </div>
        <div className="system-host-badges">
          {cloudStatus?.connected ? (
            <span className="cloud-badge connected" title="Citadel is talking to the citadels.cc subscription service (licence check-in)">
              <Wifi size={12} /> Cloud Connected
            </span>
          ) : (
            <Link
              to="/citadel-license"
              className="cloud-badge disconnected"
              title="Citadel can't reach citadels.cc right now. Click to check your licence + network settings."
              style={{ textDecoration: 'none' }}
            >
              <WifiOff size={12} /> Cloud Offline
            </Link>
          )}
        </div>
      </div>

      {/* Threshold warnings — always visible when a metric is over its limit.
          Duplicates what the per-card pulsing does, but guarantees the user
          sees the alert at the top of the dashboard even if they've scrolled. */}
      {activeWarnings.length > 0 && (
        <div style={{
          margin: '0 0 16px', padding: '10px 14px',
          background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
          border: '1px solid color-mix(in srgb, #f59e0b 40%, transparent)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
          <strong style={{ fontSize: 13, color: '#f59e0b' }}>
            Resource threshold{activeWarnings.length === 1 ? '' : 's'} exceeded
          </strong>
          {activeWarnings.map((w) => (
            <span key={w.label} style={{
              fontSize: 11, padding: '2px 8px',
              background: 'color-mix(in srgb, #f59e0b 20%, transparent)',
              color: '#f59e0b', borderRadius: 3, fontWeight: 700,
            }}>
              {w.label}: {w.value.toFixed(1)}% (limit {w.threshold}%)
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Alerts also fire in the notification bell (15-min cooldown per metric).
          </span>
        </div>
      )}

      {/* Time range picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Trend range:</span>
        {TIME_RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`btn btn-xs ${range === r.id ? 'btn-primary' : 'btn-ghost'}`}
          >
            {r.label}
          </button>
        ))}
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>
          {history.samples.length} sample{history.samples.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* System Info Cards */}
      <div className="system-cards">
        <div className="system-card card-accent-blue">
          <div className="system-card-icon"><Cpu size={18} /></div>
          <div className="system-card-label">CPU Cores</div>
          <div className="system-card-value">{info?.cpuCores || '--'}</div>
          <div className="system-card-sub">{info?.arch || ''}</div>
        </div>
        <div className="system-card card-accent-purple">
          <div className="system-card-icon"><MemoryStick size={18} /></div>
          <div className="system-card-label">RAM</div>
          <div className="system-card-value">{info?.totalMemoryGB || '--'} GB</div>
          <div className="system-card-sub">Total System Memory</div>
        </div>
        <div className="system-card card-accent-orange">
          <div className="system-card-icon"><HardDrive size={18} /></div>
          <div className="system-card-label">DISK</div>
          <div className="system-card-value">{info?.disk?.totalGB || '--'} GB</div>
          <div className="system-card-sub">Total Storage</div>
        </div>
        <div className="system-card card-accent-green">
          <div className="system-card-icon"><Users size={18} /></div>
          <div className="system-card-label">Active Servers</div>
          <div className="system-card-value">{runningCount}<span className="system-card-dim">/{servers.length}</span></div>
          <div className="system-card-sub">{totalPlayers} player{totalPlayers !== 1 ? 's' : ''} online</div>
        </div>
      </div>

      {/* Live Metrics */}
      <div className="system-metrics-row">
        <div className="system-metric-card">
          <div className="system-metric-header">
            <Cpu size={16} />
            <span>CPU</span>
            {history.thresholds?.cpu && (metrics?.cpu || 0) >= history.thresholds.cpu.warn && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>⚠ High</span>
            )}
          </div>
          <div className={`system-metric-value ${(metrics?.cpu || 0) > (history.thresholds?.cpu?.warn || 90) ? 'warning' : ''}`}>
            {metrics?.cpu?.toFixed(1) || '0.0'}%
          </div>
          {history.samples.length > 1 && (
            <div className="system-metric-chart">
              <MiniChart data={history.samples.map((s) => s.cpu || 0)} max={100} color="var(--accent-blue)" />
            </div>
          )}
        </div>

        <div className="system-metric-card">
          <div className="system-metric-header">
            <MemoryStick size={16} />
            <span>Memory</span>
            {history.thresholds?.mem && (metrics?.memory?.percent || 0) >= history.thresholds.mem.warn && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#f59e0b', fontWeight: 700 }}>⚠ High</span>
            )}
          </div>
          <div className={`system-metric-value ${(metrics?.memory?.percent || 0) > (history.thresholds?.mem?.warn || 90) ? 'warning' : ''}`}>
            {metrics?.memory?.percent?.toFixed(1) || '0.0'}%
          </div>
          <div className="system-metric-sub">{metrics?.memory?.usedGB || 0} GB used</div>
          {history.samples.length > 1 && (
            <div className="system-metric-chart">
              <MiniChart data={history.samples.map((s) => s.mem || 0)} max={100} color="var(--accent-purple)" />
            </div>
          )}
        </div>

        <div className="system-metric-card">
          <div className="system-metric-header">
            <HardDrive size={16} />
            <span>Disk</span>
          </div>
          <div className="system-metric-ring">
            <DiskRing used={info?.disk?.usedGB || 0} total={info?.disk?.totalGB || 1} />
          </div>
          <div className="system-metric-disk-legend">
            <span><span className="dot used" /> Used: {info?.disk?.usedGB || 0} GB</span>
            <span><span className="dot free" /> Free: {info?.disk?.freeGB || 0} GB</span>
          </div>
        </div>

        <div className="system-metric-card">
          <div className="system-metric-header">
            <Network size={16} />
            <span>Network</span>
          </div>
          <div className="system-metric-network">
            <div className="net-row">
              <span className="net-label">IP</span>
              <span className="net-value">{metrics?.network?.ip || '127.0.0.1'}</span>
            </div>
            {metrics?.network?.interfaces?.map((iface, i) => (
              <div className="net-row" key={i}>
                <span className="net-label">{iface.name}</span>
                <span className="net-value">{iface.address}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Server List Summary */}
      {servers.length > 0 && (
        <div className="system-servers-section">
          <div className="section-title">
            <Server size={16} />
            <span>Server Instances</span>
          </div>
          <div className="system-server-list">
            {servers.map(srv => (
              <Link key={srv.id} to={`/servers/${srv.id}/overview`} className="system-server-row">
                <div className="system-server-status">
                  <span className={`status-dot-sm status-${srv.status || 'stopped'}`} />
                </div>
                <div className="system-server-name">{srv.name}</div>
                <div className="system-server-game">DayZ, PC</div>
                <div className="system-server-players">{srv.playerCount || 0}/{srv.maxPlayers || 60}</div>
                <div className="system-server-cpu">{(srv.cpu || 0).toFixed(0)}%</div>
                <div className="system-server-ram">{(srv.ram || 0).toFixed(1)}%</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Uptime */}
      <div className="system-uptime">
        <Clock size={14} />
        <span>System uptime: {formatUptime(info?.uptime || 0)}</span>
        <span className="system-uptime-sep">|</span>
        <span>Citadel uptime: {formatUptime(info?.processUptime || 0)}</span>
      </div>
    </div>
  );
}

function DiskRing({ used, total }) {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const r = 40;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--accent-purple)" strokeWidth="8"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset 0.5s' }} />
      <text x="50" y="50" textAnchor="middle" dy="5" fill="var(--text-primary)" fontSize="14" fontWeight="700" fontFamily="var(--font-mono)">
        {percent.toFixed(0)}%
      </text>
    </svg>
  );
}

function formatUptime(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
