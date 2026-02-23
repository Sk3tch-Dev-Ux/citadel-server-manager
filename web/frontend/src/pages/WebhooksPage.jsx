import { useState, useEffect } from 'react';
import API from '../api';

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState([]);
  const [tab, setTab] = useState('webhooks');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedWh, setSelectedWh] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const [newWh, setNewWh] = useState({ event: 'server.started', url: '', template: '', retryEnabled: true });

  useEffect(() => { API.get('/api/webhooks').then(setWebhooks); }, []);

  const events = [
    'server.started', 'server.stopped', 'server.crashed', 'server.restarted',
    'server.health', 'player.kick', 'player.ban', 'mod.installed', 'mod.removed'
  ];
  const eventIcons = {
    'server.started': '\uD83D\uDFE2', 'server.stopped': '\uD83D\uDD34', 'server.crashed': '\uD83D\uDCA5', 'server.restarted': '\uD83D\uDD04',
    'server.health': '\u26A0\uFE0F', 'player.kick': '\uD83E\uDDB6', 'player.ban': '\uD83D\uDD28', 'mod.installed': '\uD83D\uDCE6', 'mod.removed': '\uD83D\uDDD1\uFE0F'
  };
  const eventColor = (e) => {
    if (e === 'server.started') return 'started';
    if (e === 'server.stopped') return 'stopped';
    if (e === 'server.crashed') return 'crashed';
    if (e === 'server.restarted') return 'restarted';
    return '';
  };

  const addWebhook = async () => {
    if (!newWh.url) return;
    const wh = await API.post('/api/webhooks', newWh);
    if (wh.error) { window.addToast(wh.error, 'error'); return; }
    setWebhooks(ws => [...ws, wh]); setShowAdd(false);
    setNewWh({ event: 'server.started', url: '', template: '', retryEnabled: true });
    window.addToast('Webhook created', 'success');
  };

  const deleteWebhook = async (id) => {
    await API.del(`/api/webhooks/${id}`);
    setWebhooks(ws => ws.filter(w => w.id !== id));
    window.addToast('Webhook deleted', 'success');
  };

  const testWebhook = async (id) => {
    const r = await API.post(`/api/webhooks/${id}/test`);
    window.addToast(r.message || 'Test sent', 'success');
  };

  const toggleWebhook = async (id, enabled) => {
    await API.patch(`/api/webhooks/${id}`, { enabled: !enabled });
    setWebhooks(ws => ws.map(w => w.id === id ? { ...w, enabled: !enabled } : w));
  };

  const viewDeliveries = async (wh) => {
    setSelectedWh(wh);
    const d = await API.get(`/api/webhooks/${wh.id}/deliveries`);
    setDeliveries(d);
    setTab('deliveries');
  };

  return (
    <div>
      <div className="tabs">
        <div className={`tab ${tab === 'webhooks' ? 'active' : ''}`} onClick={() => setTab('webhooks')}>WebHooks</div>
        <div className={`tab ${tab === 'deliveries' ? 'active' : ''}`} onClick={() => setTab('deliveries')}>Deliveries {selectedWh && `(${selectedWh.event})`}</div>
      </div>

      {tab === 'webhooks' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Webhook</button>
          </div>
          {webhooks.length === 0 ? <div className="empty-state"><div className="empty-icon">{'\uD83D\uDD17'}</div><div className="empty-title">No Webhooks</div><p>Add webhooks to receive notifications for server events.</p></div> : (
            <div>
              {webhooks.map(wh => (
                <div key={wh.id} className="card" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <span className={`webhook-event-badge ${eventColor(wh.event)}`}>{eventIcons[wh.event] || '\uD83D\uDD17'} {wh.event}</span>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }} title={wh.url}>{wh.isDiscord ? '\uD83D\uDFE3 Discord' : wh.url}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{wh.retryEnabled ? 'Retry: On' : 'Retry: Off'}</span>
                    <span className={`toggle ${wh.enabled ? 'on' : ''}`} onClick={() => toggleWebhook(wh.id, wh.enabled)}><div className="toggle-knob" /></span>
                    <button className="btn btn-sm btn-secondary" onClick={() => testWebhook(wh.id)}>Test</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => viewDeliveries(wh)}>History</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteWebhook(wh.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showAdd && (
            <div className="modal-overlay" onClick={() => setShowAdd(false)}>
              <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                <div className="modal-title">Add Webhook</div>
                <div className="input-group"><label className="input-label">Event</label>
                  <select className="input" value={newWh.event} onChange={e => setNewWh({ ...newWh, event: e.target.value })}>
                    {events.map(ev => <option key={ev} value={ev}>{eventIcons[ev] || '\uD83D\uDD17'} {ev}</option>)}
                  </select>
                </div>
                <div className="input-group"><label className="input-label">Webhook URL</label><input className="input" value={newWh.url} onChange={e => setNewWh({ ...newWh, url: e.target.value })} placeholder="https://discord.com/api/webhooks/..." /></div>
                <div className="input-group">
                  <label className="input-label">Template (JSON body for Discord)</label>
                  <textarea className="input" value={newWh.template} onChange={e => setNewWh({ ...newWh, template: e.target.value })} placeholder={'{"content": "**{server.name}** event at {timestamp}"}'} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div className={`toggle ${newWh.retryEnabled ? 'on' : ''}`} onClick={() => setNewWh({ ...newWh, retryEnabled: !newWh.retryEnabled })}><div className="toggle-knob" /></div>
                  <span style={{ fontSize: 13 }}>Enable retry on failure</span>
                </div>
                <div className="btn-group"><button className="btn btn-primary" onClick={addWebhook}>Create Webhook</button><button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button></div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'deliveries' && (
        <div>
          {deliveries.length === 0 ? <div className="empty-state"><div className="empty-icon">{'\uD83D\uDCEC'}</div><div className="empty-title">No Deliveries Yet</div></div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Error</th></tr></thead>
              <tbody>{deliveries.map((d, i) => (
                <tr key={i}><td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(d.timestamp).toLocaleString()}</td>
                  <td><span className={`webhook-event-badge ${eventColor(d.event)}`}>{d.event}</span></td>
                  <td><span className={`status-badge ${d.status === 'success' ? 'status-running' : 'status-crashed'}`}><span className="status-dot" />{d.status}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--accent-red)' }}>{d.error || '\u2014'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}
    </div>
  );
}
