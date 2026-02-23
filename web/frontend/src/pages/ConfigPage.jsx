import { useState, useEffect } from 'react';
import API from '../api';

export default function ConfigPage({ serverId }) {
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { API.get(`/api/servers/${serverId}/config`).then(setConfig); }, [serverId]);
  const update = (key, value) => setConfig(c => ({ ...c, [key]: value }));
  const save = async () => {
    setSaving(true);
    await API.patch(`/api/servers/${serverId}/config`, config);
    window.addToast('Config saved', 'success');
    setSaving(false);
  };
  const fields = [
    { key: 'hostname', label: 'Server Name', type: 'text', description: 'The name shown in the server browser.' },
    { key: 'maxPlayers', label: 'Max Players', type: 'number', description: 'Maximum number of players allowed.' },
    { key: 'password', label: 'Server Password', type: 'text', description: 'Password required to join the server.' },
    { key: 'passwordAdmin', label: 'Admin Password', type: 'text', description: 'Password for admin access.' },
    { key: 'verifySignatures', label: 'Verify Signatures', type: 'toggle', description: 'Enable signature verification for mods.' },
    { key: 'forceSameBuild', label: 'Force Same Build', type: 'toggle', description: 'Require all clients to use the same game build.' },
    { key: 'disableThirdPerson', label: 'Disable 3rd Person', type: 'toggle', description: 'Disables third person camera for players.' },
    { key: 'serverTime', label: 'Server Time', type: 'text', description: 'Initial server time (e.g. 8:00).' },
    { key: 'serverTimeAcceleration', label: 'Time Acceleration', type: 'number', description: 'Multiplier for in-game time speed.' },
    { key: 'respawnTime', label: 'Respawn Time', type: 'number', description: 'Time (seconds) before a player can respawn.' },
    { key: 'loginQueueMaxPlayers', label: 'Login Queue Max', type: 'number', description: 'Maximum players allowed in login queue.' },
    { key: 'template', label: 'Map Template', type: 'text', description: 'Map template used for the server.' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div className="card-title">serverDZ.cfg Editor</div>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : '\uD83D\uDCBE Save Config'}</button>
      </div>
      <div className="grid grid-2">
        {fields.map(f => (
          <div key={f.key} className="input-group">
            <label className="input-label">{f.label}</label>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{f.description}</div>
            {f.type === 'toggle' ? (
              <div>
                <label>
                  <input type="checkbox" checked={!!config[f.key]} onChange={e => update(f.key, e.target.checked ? 1 : 0)} />
                </label>
              </div>
            ) : (
              <input className="input" type={f.type} value={config[f.key] ?? ''} onChange={e => update(f.key, f.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
