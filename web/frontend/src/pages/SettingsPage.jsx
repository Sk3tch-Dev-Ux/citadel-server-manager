import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import { Shield, AlertTriangle, Loader, CheckCircle, Gamepad2 } from '../components/Icon';

export default function SettingsPage() {
  // Steam state
  const [steamStatus, setSteamStatus] = useState(null);
  const [steamLoading, setSteamLoading] = useState(true);
  const [steamUsername, setSteamUsername] = useState('');
  const [steamPassword, setSteamPassword] = useState('');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [steamError, setSteamError] = useState('');
  const [steamNeedsGuard, setSteamNeedsGuard] = useState(false);
  const [steamValidating, setSteamValidating] = useState(false);
  const [editing, setEditing] = useState(false);

  const fetchSteamStatus = useCallback(async () => {
    setSteamLoading(true);
    setSteamError('');
    try {
      const result = await API.get('/api/steam/status');
      setSteamStatus(result);
      if (result.username) setSteamUsername(result.username);
    } catch {
      setSteamStatus({ steamCmdReady: false, username: '', hasPassword: false, loginValidated: false });
    }
    setSteamLoading(false);
  }, []);

  useEffect(() => { fetchSteamStatus(); }, [fetchSteamStatus]);

  const validateSteamCredentials = async () => {
    if (!steamUsername || !steamPassword) {
      setSteamError('Username and password are required');
      return;
    }
    setSteamValidating(true);
    setSteamError('');
    try {
      const payload = { username: steamUsername, password: steamPassword };
      if (steamGuardCode) payload.guardCode = steamGuardCode;
      const result = await API.post('/api/steam/credentials', payload);
      if (result.success) {
        setSteamStatus(prev => ({ ...prev, username: steamUsername, hasPassword: true, loginValidated: true }));
        setSteamNeedsGuard(false);
        setSteamError('');
        setEditing(false);
        window.addToast(`Steam logged in as ${steamUsername}`, 'success');
      } else if (result.needsGuard) {
        setSteamNeedsGuard(true);
        setSteamError('Steam Guard code required — check your email or authenticator app.');
      } else {
        setSteamError(result.message || 'Login failed');
      }
    } catch (err) {
      setSteamError(err.message || 'Failed to validate credentials');
    }
    setSteamValidating(false);
  };

  const steamVerified = steamStatus?.loginValidated === true;

  return (
    <div style={{ maxWidth: 600 }}>
      {/* ─── Steam Section ─── */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Gamepad2 size={20} style={{ color: 'var(--accent-purple)' }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Steam</h3>
        </div>

        <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> For the smoothest experience, we recommend using a dedicated Steam account for server management with Steam Guard set to <strong>Email</strong> (not Mobile Authenticator). After your first login, SteamCMD caches the session so you won&apos;t need to re-enter a guard code each time.
        </div>

        {steamLoading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            <Loader size={24} /> Checking Steam status...
          </div>
        ) : steamVerified && !editing ? (
          /* Verified — show green status */
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Shield size={28} style={{ color: 'var(--text-success, #22c55e)' }} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Steam Connected</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Logged in as <strong>{steamStatus?.username}</strong></div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              <CheckCircle size={14} style={{ color: 'var(--accent-green)' }} />
              SteamCMD session cached — deployments and mod downloads will use this account automatically.
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setSteamPassword(''); setSteamGuardCode(''); setSteamNeedsGuard(false); setSteamError(''); }}>
              Change Account
            </button>
          </div>
        ) : (
          /* Credential form */
          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            {!steamStatus?.steamCmdReady && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,168,68,0.1)', border: '1px solid rgba(239,168,68,0.3)', borderRadius: 6, marginBottom: 16, fontSize: 13, color: '#f59e0b' }}>
                <AlertTriangle size={14} /> SteamCMD not found. Run the setup wizard first or configure it manually.
              </div>
            )}

            <div className="input-group">
              <label className="input-label">Steam Username</label>
              <input className="input" value={steamUsername} onChange={e => setSteamUsername(e.target.value)} placeholder="your_steam_username" autoComplete="off" />
            </div>
            <div className="input-group">
              <label className="input-label">Steam Password</label>
              <input className="input" type="password" value={steamPassword} onChange={e => setSteamPassword(e.target.value)} placeholder="your_steam_password" autoComplete="off" />
            </div>

            {steamNeedsGuard && (
              <div className="input-group">
                <label className="input-label">Steam Guard Code</label>
                <input className="input" value={steamGuardCode} onChange={e => setSteamGuardCode(e.target.value)} placeholder="XXXXX" maxLength={5} style={{ letterSpacing: '0.2em', textAlign: 'center', maxWidth: 140 }} autoComplete="off" />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Check your email or Steam mobile app for the code</div>
              </div>
            )}

            {steamError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#ef4444' }}>
                <AlertTriangle size={14} /> {steamError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {editing && (
                <button className="btn btn-secondary" onClick={() => { setEditing(false); setSteamError(''); }}>
                  Cancel
                </button>
              )}
              <button className="btn btn-primary" onClick={validateSteamCredentials} disabled={steamValidating || !steamUsername || !steamPassword} style={{ flex: 1, justifyContent: 'center' }}>
                {steamValidating ? 'Verifying...' : (steamNeedsGuard ? 'Submit Guard Code' : 'Verify Steam Login')}
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
              Your credentials are stored locally and used only for SteamCMD operations. They are never sent to any third party.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
