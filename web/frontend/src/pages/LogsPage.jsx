import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import { FileCode } from '../components/Icon';

export default function LogsPage({ serverId }) {
  const socket = useSocket();
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    API.get(`/api/servers/${serverId}/logs?limit=500`).then(d => {
      setLogs(Array.isArray(d) ? d : []);
      setLoaded(true);
    });
  }, [serverId]);

  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setLogs(l => [data, ...l].slice(0, 500)); };
    socket.on('log', handler);
    return () => socket.off('log', handler);
  }, [serverId, socket]);

  const filtered = filter === 'all' ? logs : logs.filter(l => l.level === filter);
  const isEmpty = loaded && filtered.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'info', 'warn', 'error'].map(f => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>{f.toUpperCase()}</button>
        ))}
      </div>
      <div className="console-wrap" style={{ height: 'calc(100vh - 260px)' }}>
        <div className="console-output">
          {isEmpty ? (
            <EmptyState
              icon={<FileCode size={36} />}
              title={filter === 'all' ? 'No logs yet' : `No ${filter.toUpperCase()} entries`}
              description={
                filter === 'all'
                  ? 'Server logs will appear here once the server is running. If the server is already up, logs may still be populating — give it a few seconds.'
                  : `Nothing matched the ${filter.toUpperCase()} filter. Try "All" to see everything.`
              }
            />
          ) : (
            [...filtered].reverse().map((log, i) => (
              <div key={i} className={`console-line ${log.level || ''}`}>
                <span className="console-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span>[{log.source}]</span> {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
