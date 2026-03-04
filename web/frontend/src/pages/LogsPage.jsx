import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';

export default function LogsPage({ serverId }) {
  const socket = useSocket();
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  useEffect(() => { API.get(`/api/servers/${serverId}/logs?limit=500`).then(d => setLogs(Array.isArray(d) ? d : [])); }, [serverId]);
  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setLogs(l => [data, ...l].slice(0, 500)); };
    socket.on('log', handler);
    return () => socket.off('log', handler);
  }, [serverId, socket]);
  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'info', 'warn', 'error'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
      </div>
      <div className="console-wrap" style={{ height: 'calc(100vh - 260px)' }}>
        <div className="console-output">
          {[...filtered].reverse().map((log, i) => (
            <div key={i} className={`console-line ${log.level || ''}`}>
              <span className="console-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
              <span>[{log.source}]</span> {log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
