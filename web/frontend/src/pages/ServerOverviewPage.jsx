import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { formatUptime } from '../utils';
import MiniChart from '../components/MiniChart';
import PageLoader from '../components/PageLoader';
import { Cpu, MemoryStick, Users, Clock, Activity, Server, Globe } from '../components/Icon';
import UpdateBanner from '../components/UpdateBanner';

export default function ServerOverviewPage({ serverId }) {
  const socket = useSocket();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [metricsHistory, setMetricsHistory] = useState([]);

  const load = useCallback(async () => {
    const s = await API.get(`/api/servers/${serverId}/status`);
    setStatus(s);
    setLoading(false);
    if (s && !s.error) {
      setMetricsHistory(prev => [...prev.slice(-29), { cpu: s.cpu || 0, ram: s.ram || 0, ts: Date.now() }]);
    }
  }, [serverId]);

  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);
  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setStatus(s => ({ ...s, status: data.status })); };
    socket.on('serverStatus', handler);
    return () => socket.off('serverStatus', handler);
  }, [serverId, socket]);

  if (loading || !status) return <PageLoader />;

  return (
    <div>
      <UpdateBanner serverId={serverId} />

      {/* Map info bar */}
      {status.map && (
        <div className="overview-map-bar">
          Map: <strong>{status.map}</strong>
        </div>
      )}

      {/* Port Display */}
      <div className="overview-ports">
        <div className="port-card">
          <div className="port-value">{status.ports?.game || 2302}</div>
          <div className="port-label">Game port</div>
        </div>
        <div className="port-divider" />
        <div className="port-card">
          <div className="port-value">{status.ports?.query || 2303}</div>
          <div className="port-label">Query port</div>
        </div>
        <div className="port-divider" />
        <div className="port-card">
          <div className="port-value">{status.ports?.rcon || 2305}</div>
          <div className="port-label">RCon port</div>
        </div>
      </div>

      {/* Live Metrics Grid */}
      <div className="overview-metrics-grid">
        <div className="overview-metric-card">
          <div className="overview-metric-icon blue"><Cpu size={18} /></div>
          <div className="overview-metric-body">
            <div className="overview-metric-label">CPU Usage</div>
            <div className="overview-metric-value">{(status.cpu || 0).toFixed(1)}%</div>
          </div>
          {metricsHistory.length > 1 && (
            <div className="overview-metric-spark">
              <MiniChart data={metricsHistory.map(m => m.cpu)} max={100} color="var(--accent-blue)" />
            </div>
          )}
        </div>

        <div className="overview-metric-card">
          <div className="overview-metric-icon purple"><MemoryStick size={18} /></div>
          <div className="overview-metric-body">
            <div className="overview-metric-label">Memory</div>
            <div className="overview-metric-value">{(status.ram || 0).toFixed(1)}%</div>
          </div>
          {metricsHistory.length > 1 && (
            <div className="overview-metric-spark">
              <MiniChart data={metricsHistory.map(m => m.ram)} max={100} color="var(--accent-purple)" />
            </div>
          )}
        </div>

        <div className="overview-metric-card">
          <div className="overview-metric-icon green"><Users size={18} /></div>
          <div className="overview-metric-body">
            <div className="overview-metric-label">Players</div>
            <div className="overview-metric-value">{status.playerCount}<span className="overview-metric-dim">/{status.maxPlayers}</span></div>
          </div>
        </div>

        <div className="overview-metric-card">
          <div className="overview-metric-icon yellow"><Activity size={18} /></div>
          <div className="overview-metric-body">
            <div className="overview-metric-label">Server FPS</div>
            <div className="overview-metric-value">{status.fps || '--'}</div>
          </div>
        </div>

        <div className="overview-metric-card">
          <div className="overview-metric-icon orange"><Clock size={18} /></div>
          <div className="overview-metric-body">
            <div className="overview-metric-label">Uptime</div>
            <div className="overview-metric-value">{formatUptime(status.uptime)}</div>
          </div>
        </div>

        <div className="overview-metric-card">
          <div className="overview-metric-icon blue"><Globe size={18} /></div>
          <div className="overview-metric-body">
            <div className="overview-metric-label">Server IP</div>
            <div className="overview-metric-value" style={{ fontSize: 16 }}>{status.ip || '127.0.0.1'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
