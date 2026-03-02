import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import { Cpu, MemoryStick, HardDrive, Network, Monitor, Users, Clock, Server, Wifi, WifiOff } from '../components/Icon';
import MiniChart from '../components/MiniChart';

export default function SystemDashboardPage() {
  const { servers } = useServers();
  const [info, setInfo] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [cloudStatus, setCloudStatus] = useState(null);
  const [metricsHistory, setMetricsHistory] = useState([]);

  const loadInfo = useCallback(async () => {
    try {
      const data = await API.get('/api/system/info');
      if (data && !data.error) setInfo(data);
    } catch {}
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const data = await API.get('/api/system/metrics');
      if (data && !data.error) {
        setMetrics(data);
        setMetricsHistory(prev => [...prev.slice(-59), { cpu: data.cpu, mem: data.memory.percent, ts: Date.now() }]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadInfo();
    loadMetrics();
    const i = setInterval(loadMetrics, 10000);
    return () => clearInterval(i);
  }, [loadInfo, loadMetrics]);

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
            <span className="cloud-badge connected"><Wifi size={12} /> Cloud Connected</span>
          ) : (
            <span className="cloud-badge disconnected"><WifiOff size={12} /> Cloud Offline</span>
          )}
        </div>
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
          </div>
          <div className={`system-metric-value ${(metrics?.cpu || 0) > 80 ? 'warning' : ''}`}>
            {metrics?.cpu?.toFixed(1) || '0.0'}%
          </div>
          {metricsHistory.length > 1 && (
            <div className="system-metric-chart">
              <MiniChart data={metricsHistory.map(m => m.cpu)} max={100} color="var(--accent-blue)" />
            </div>
          )}
        </div>

        <div className="system-metric-card">
          <div className="system-metric-header">
            <MemoryStick size={16} />
            <span>Memory</span>
          </div>
          <div className={`system-metric-value ${(metrics?.memory?.percent || 0) > 80 ? 'warning' : ''}`}>
            {metrics?.memory?.percent?.toFixed(1) || '0.0'}%
          </div>
          <div className="system-metric-sub">{metrics?.memory?.usedGB || 0} GB used</div>
          {metricsHistory.length > 1 && (
            <div className="system-metric-chart">
              <MiniChart data={metricsHistory.map(m => m.mem)} max={100} color="var(--accent-purple)" />
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
