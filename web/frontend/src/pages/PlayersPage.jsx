import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { Users } from '../components/Icon';

export default function PlayersPage({ serverId }) {
  const socket = useSocket();
  const [players, setPlayers] = useState([]);
  useEffect(() => { API.get(`/api/servers/${serverId}/players`).then(d => setPlayers(Array.isArray(d) ? d : [])); }, [serverId]);
  useEffect(() => {
    const handler = (data) => { if (data.serverId === serverId) setPlayers(Array.isArray(data.players) ? data.players : []); };
    socket.on('players', handler);
    return () => socket.off('players', handler);
  }, [serverId, socket]);
  const kick = async (id) => { await API.post(`/api/servers/${serverId}/players/${id}/kick`, { reason: 'Kicked by admin' }); window.addToast('Player kicked', 'success'); };
  const ban = async (id) => { await API.post(`/api/servers/${serverId}/players/${id}/ban`, { reason: 'Banned by admin' }); window.addToast('Player banned', 'success'); };
  return (
    <div>
      <div style={{ marginBottom: 16 }}><span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{players.length} player(s) online</span></div>
      {players.length === 0 ? <div className="empty-state"><div className="empty-icon"><Users size={48} /></div><div className="empty-title">No Players Online</div></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>ID</th><th>IP</th><th>Ping</th><th>Actions</th></tr></thead>
          <tbody>{players.map(p => (
            <tr key={p.id}><td style={{ fontWeight: 600 }}>{p.name}</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.id}</td><td>{p.ip || '\u2014'}</td><td>{p.ping || '\u2014'}</td>
              <td><div className="btn-group"><button className="btn btn-sm btn-secondary" onClick={() => kick(p.id)}>Kick</button><button className="btn btn-sm btn-danger" onClick={() => ban(p.id)}>Ban</button></div></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
