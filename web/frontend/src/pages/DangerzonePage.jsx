import { useState } from 'react';

export default function DangerzonePage({ serverId }) {
  const [showConfirm, setShowConfirm] = useState(null);
  const [actionStatus, setActionStatus] = useState('');
  const actions = [
    { key: 'rebuild', label: 'Server Rebuild', desc: 'Wipe and reinstall via SteamCMD.', danger: true },
    { key: 'restore', label: 'Server Restore', desc: 'Restore from backup archive.', danger: true },
    { key: 'modMgmt', label: 'Mod Management', desc: 'Bulk mod operations (verify, clean, rebuild).', danger: false },
    { key: 'export', label: 'Export Server', desc: 'Package server config + mods into portable archive.', danger: false },
    { key: 'clearLogs', label: 'Clear Log Storage', desc: 'Purge RPT/ADM/log files with size display.', danger: true }
  ];
  const handleAction = async (key) => {
    setActionStatus('Processing...');
    setTimeout(() => {
      setActionStatus(key + ' completed!');
      setShowConfirm(null);
    }, 1200);
  };
  return (
    <div>
      <div className="card">
        <div className="card-title" style={{ color: 'var(--accent-red)' }}>Dangerzone / Maintenance</div>
        <div>
          {actions.map(a => (
            <div key={a.key} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, color: a.danger ? 'var(--accent-red)' : 'var(--accent-yellow)' }}>{a.label}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{a.desc}</div>
              <button className={`btn ${a.danger ? 'btn-danger' : 'btn-secondary'}`} onClick={() => setShowConfirm(a.key)}>{a.label}</button>
              {showConfirm === a.key && (
                <div className="modal-overlay" onClick={() => setShowConfirm(null)}>
                  <div className="modal" onClick={e => e.stopPropagation()}>
                    <div style={{ fontWeight: 700, color: 'var(--accent-red)', marginBottom: 8 }}>Are you sure?</div>
                    <div style={{ marginBottom: 12 }}>{a.desc}</div>
                    <div className="btn-group">
                      <button className="btn btn-danger" onClick={() => handleAction(a.key)}>Confirm</button>
                      <button className="btn btn-secondary" onClick={() => setShowConfirm(null)}>Cancel</button>
                    </div>
                    {actionStatus && <div style={{ marginTop: 10, color: 'var(--accent-red)' }}>{actionStatus}</div>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
