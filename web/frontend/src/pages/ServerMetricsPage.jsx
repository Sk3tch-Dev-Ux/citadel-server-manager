import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import MiniChart from '../components/MiniChart';

export default function ServerMetricsPage({ serverId }) {
  const socket = useSocket();
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const m = await API.get(`/api/servers/${serverId}/metrics`);
    setMetrics(m); setLoading(false);
  }, [serverId]);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);
  useEffect(() => {
    const handler = (data) => {
      if (data.serverId !== serverId) return;
      setMetrics(prev => {
        if (!prev) return prev;
        const m = { ...prev };
        m.cpu = [...(m.cpu || []), data.cpu].slice(-360);
        m.ram = [...(m.ram || []), data.ram].slice(-360);
        m.players = [...(m.players || []), data.players].slice(-360);
        m.fps = [...(m.fps || []), data.fps].slice(-360);
        m.timestamps = [...(m.timestamps || []), data.timestamp].slice(-360);
        return m;
      });
    };
    socket.on('metrics', handler);
    return () => socket.off('metrics', handler);
  }, [serverId, socket]);

  const calcStats = (arr) => {
    if (!arr || arr.length === 0) return { current: 0, min: 0, max: 0, avg: 0 };
    const current = arr[arr.length - 1];
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { current, min, max, avg };
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading metrics...</div>;
  if (!metrics) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>No metrics data available.</div>;

  const cpuStats = calcStats(metrics.cpu);
  const ramStats = calcStats(metrics.ram);
  const playerStats = calcStats(metrics.players);
  const fpsStats = calcStats(metrics.fps);
  const dataPoints = metrics.timestamps?.length || 0;
  const timeSpan = dataPoints > 1 ? Math.round((new Date(metrics.timestamps[dataPoints - 1]) - new Date(metrics.timestamps[0])) / 60000) : 0;

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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dataPoints} data points {'\u00B7'} {timeSpan > 0 ? `${timeSpan}m window` : 'just started'} {'\u00B7'} updates every 15s</div>
        <button className="btn btn-secondary btn-sm" onClick={load}>{'\uD83D\uDD04'} Refresh</button>
      </div>
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard label="CPU" stats={cpuStats} unit="%" color="#6cb4f0" />
        <StatCard label="RAM" stats={ramStats} unit="%" color="#c49bff" />
        <StatCard label="Players" stats={playerStats} unit="" color="#5cb85c" />
        <StatCard label="FPS" stats={fpsStats} unit="" color="#e5c07b" />
      </div>
      <div className="grid grid-2">
        <MiniChart data={metrics.cpu || []} color="#6cb4f0" height={240} label="CPU %" />
        <MiniChart data={metrics.ram || []} color="#c49bff" height={240} label="RAM %" />
        <MiniChart data={metrics.players || []} color="#5cb85c" height={240} label="Players" />
        <MiniChart data={metrics.fps || []} color="#e5c07b" height={240} label="FPS" />
      </div>
    </div>
  );
}
