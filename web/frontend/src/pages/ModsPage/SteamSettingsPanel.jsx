import { useState, useEffect } from 'react';
import API from '../../api';

export default function SteamSettingsPanel() {
  const [status, setStatus] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [guardCode, setGuardCode] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { API.get('/api/steam/status').then(s => { setStatus(s); setUsername(s.username || ''); }); }, []);
  const save = async () => {
    setSaving(true);
    const body = { username };
    if (password) body.password = password;
    if (guardCode) body.guardCode = guardCode;
    const r = await API.post('/api/steam/credentials', body);
    if (r.needsGuard) window.addToast('Steam Guard code required', 'info');
    else if (r.success) { window.addToast('Steam login validated!', 'success'); setGuardCode(''); }
    else window.addToast(r.message || 'Failed', 'error');
    setSaving(false);
    API.get('/api/steam/status').then(setStatus);
  };
  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <div className="card-title" style={{ marginBottom: 16 }}>Steam Credentials</div>
      <div style={{ marginBottom: 12 }}>
        {status?.loginValidated ? <span className="status-badge status-running"><span className="status-dot" />Connected as {status.username}</span> : <span className="status-badge status-stopped"><span className="status-dot" />Not connected</span>}
      </div>
      <div className="input-group"><label className="input-label">Username</label><input className="input" value={username} onChange={e => setUsername(e.target.value)} /></div>
      <div className="input-group"><label className="input-label">Password</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'} /></div>
      <div className="input-group"><label className="input-label">Steam Guard Code (if needed)</label><input className="input" value={guardCode} onChange={e => setGuardCode(e.target.value)} placeholder="XXXXX" /></div>
      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Validating...' : 'Save & Validate'}</button>
    </div>
  );
}
