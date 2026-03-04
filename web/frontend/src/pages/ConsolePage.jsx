import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';

export default function ConsolePage({ serverId }) {
  const socket = useSocket();
  const [logs, setLogs] = useState([]);
  const [cmd, setCmd] = useState('');
  const outputRef = useRef(null);

  // Fetch server console output (DayZ stdout)
  useEffect(() => { API.get(`/api/servers/${serverId}/console?limit=500`).then(d => setLogs(Array.isArray(d) ? d : [])); }, [serverId]);

  // Live updates: server console output + RCON responses
  useEffect(() => {
    const consoleHandler = (data) => {
      if (data.serverId === serverId) setLogs(l => [data, ...l].slice(0, 500));
    };
    const rconHandler = (data) => {
      if (data.serverId && data.serverId !== serverId) return;
      setLogs(l => [{ timestamp: data.timestamp || new Date().toISOString(), level: 'info', source: 'rcon', message: data.message }, ...l].slice(0, 500));
    };
    socket.on('consoleLog', consoleHandler);
    socket.on('rconMessage', rconHandler);
    return () => { socket.off('consoleLog', consoleHandler); socket.off('rconMessage', rconHandler); };
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
            {log.source === 'rcon' && <span>[rcon] </span>}
            {log.message}
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
