import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';

export default function ConsolePage({ serverId }) {
  const socket = useSocket();
  const [logs, setLogs] = useState([]);
  const [cmd, setCmd] = useState('');
  const outputRef = useRef(null);
  useEffect(() => { API.get(`/api/servers/${serverId}/logs?limit=500`).then(d => setLogs(Array.isArray(d) ? d : [])); }, [serverId]);
  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setLogs(l => [data, ...l].slice(0, 500)); };
    socket.on('log', handler);
    return () => socket.off('log', handler);
  }, [serverId, socket]);
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [logs]);
  const sendCmd = async () => {
    if (!cmd.trim()) return;
    await API.post(`/api/servers/${serverId}/rcon`, { command: cmd });
    setCmd('');
  };
  return (
    <div className="console-wrap">
      <div className="console-output" ref={outputRef}>
        {[...logs].reverse().map((log, i) => (
          <div key={i} className={`console-line ${log.level || ''}`}>
            <span className="console-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span>[{log.source || 'system'}]</span> {log.message}
          </div>
        ))}
      </div>
      <div className="console-input">
        <input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="Enter RCON command..." onKeyDown={e => e.key === 'Enter' && sendCmd()} />
        <button onClick={sendCmd}>SEND</button>
      </div>
    </div>
  );
}
