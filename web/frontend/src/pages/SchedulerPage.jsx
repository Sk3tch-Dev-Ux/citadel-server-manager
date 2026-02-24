import { useState, useEffect } from 'react';
import API from '../api';
import { Clock, CheckCircle, XCircle } from '../components/Icon';

export default function SchedulerPage({ serverId }) {
  const [tasks, setTasks] = useState([]);
  const [cron, setCron] = useState('');
  const [label, setLabel] = useState('');
  useEffect(() => { API.get(`/api/servers/${serverId}/schedule`).then(d => setTasks(Array.isArray(d) ? d : [])); }, [serverId]);
  const add = async () => {
    if (!label) return;
    const t = await API.post(`/api/servers/${serverId}/schedule`, { cronExpression: cron, label, enabled: true });
    setTasks(ts => [...ts, t]);
    setCron(''); setLabel('');
    window.addToast('Task added', 'success');
  };
  const remove = async (id) => {
    await API.del(`/api/servers/${serverId}/schedule/${id}`);
    setTasks(ts => ts.filter(t => t.id !== id));
  };
  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title" style={{ marginBottom: 12 }}>Add Scheduled Task</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="Label (e.g. Daily Restart)" value={label} onChange={e => setLabel(e.target.value)} style={{ flex: 1 }} />
          <input className="input" placeholder="Cron (e.g. 0 4 * * *)" value={cron} onChange={e => setCron(e.target.value)} style={{ width: 180 }} />
          <button className="btn btn-primary" onClick={add}>Add</button>
        </div>
      </div>
      {tasks.length === 0 ? <div className="empty-state"><div className="empty-icon"><Clock size={48} /></div><div className="empty-title">No Scheduled Tasks</div></div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Label</th><th>Cron</th><th>Enabled</th><th>Actions</th></tr></thead>
          <tbody>{tasks.map(t => (
            <tr key={t.id}><td>{t.label}</td><td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t.cronExpression}</td>
              <td>{t.enabled ? <CheckCircle size={14} /> : <XCircle size={14} />}</td>
              <td><button className="btn btn-sm btn-danger" onClick={() => remove(t.id)}>Remove</button></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
