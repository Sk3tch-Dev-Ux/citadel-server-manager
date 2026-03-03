import { useState, useEffect } from 'react';
import API from '../api';
import { timeAgo } from '../utils';
import { ShieldBan } from '../components/Icon';

export default function BansPage({ serverId }) {
  const [bans, setBans] = useState([]);
  useEffect(() => { API.get(`/api/servers/${serverId}/bans`).then(d => setBans(Array.isArray(d) ? d : [])); }, [serverId]);
  const unban = async (id) => {
    await API.del(`/api/servers/${serverId}/bans/${id}`);
    setBans(b => b.filter(x => x.id !== id));
    window.addToast('Ban removed', 'success');
  };
  return (
    <div>
      {bans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon empty-state-icon-large"><ShieldBan size={48} /></div>
          <div className="empty-title">No Active Bans</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>Banned players will appear here. Use the Players page to issue bans.</p>
        </div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>ID</th><th>Reason</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>{bans.map(b => (
            <tr key={b.id}><td>{b.name}</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{b.id}</td><td>{b.reason}</td><td>{timeAgo(b.bannedAt)}</td>
              <td><button className="btn btn-sm btn-secondary" onClick={() => unban(b.id)}>Unban</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
