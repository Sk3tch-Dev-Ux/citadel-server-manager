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

  const autoScrollRef = useRef(true);
  useEffect(() => {
    const el = outputRef.current;
    if (el && autoScrollRef.current) el.scrollTop = el.scrollHeight;
  }, [logs]);
  const handleScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    // Auto-scroll if user is within 80px of the bottom
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const [sending, setSending] = useState(false);
  const sendCmd = async () => {
    if (!cmd.trim() || sending) return;
    setSending(true);
    try {
      const result = await API.post(`/api/servers/${serverId}/rcon`, { command: cmd });
      if (result?.error) {
        window.addToast?.(result.error, 'error');
      }
      setCmd('');
    } catch (err) {
      window.addToast?.(`RCON command failed: ${err.message}`, 'error');
    }
    setSending(false);
  };

  return (
    <div className="console-wrap">
      <div className="console-output" ref={outputRef} onScroll={handleScroll}>
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
        <button onClick={sendCmd} disabled={sending}>{sending ? '...' : 'SEND'}</button>
      </div>
    </div>
  );
}
