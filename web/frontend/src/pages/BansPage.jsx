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
      {bans.length === 0 ? <div className="empty-state"><div className="empty-icon"><ShieldBan size={48} /></div><div className="empty-title">No Active Bans</div></div> : (
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
