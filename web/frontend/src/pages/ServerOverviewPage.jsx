import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { formatUptime } from '../utils';

export default function ServerOverviewPage({ serverId }) {
  const socket = useSocket();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const s = await API.get(`/api/servers/${serverId}/status`);
    setStatus(s); setLoading(false);
  }, [serverId]);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);
  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setStatus(s => ({ ...s, status: data.status })); };
    socket.on('serverStatus', handler);
    return () => socket.off('serverStatus', handler);
  }, [serverId, socket]);

  if (loading || !status) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>;
  return (
    <div>
      <div className="stat-row">
        <div className="stat-box"><div className="stat-label">Status</div><span className={`status-badge status-${status.status}`}><span className="status-dot" />{status.status}</span></div>
        <div className="stat-box"><div className="stat-label">Players</div><div className="stat-value">{status.playerCount}<span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/{status.maxPlayers}</span></div></div>
        <div className="stat-box"><div className="stat-label">CPU</div><div className="stat-value">{(status.cpu || 0).toFixed(0)}%</div></div>
        <div className="stat-box"><div className="stat-label">RAM</div><div className="stat-value">{(status.ram || 0).toFixed(1)}%</div></div>
        <div className="stat-box"><div className="stat-label">Uptime</div><div className="stat-value">{formatUptime(status.uptime)}</div></div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
        <div className="card" style={{ flex: 1 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Server Name</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{status.serverName || 'DayZ Server'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Map: {status.map || 'chernarusplus'}</div>
        </div>
        <div className="card" style={{ flex: 1 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>Network Ports</div>
          <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>
            <div>Game: <span style={{ color: 'var(--accent-blue)' }}>{status.ports?.game || 2302}</span></div>
            <div>Query: <span style={{ color: 'var(--accent-blue)' }}>{status.ports?.query || 2303}</span></div>
            <div>RCON: <span style={{ color: 'var(--accent-yellow)' }}>{status.ports?.rcon || 2305}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
