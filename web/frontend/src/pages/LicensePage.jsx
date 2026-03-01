import { useState, useEffect } from 'react';
import API from '../api';

export default function LicensePage() {
  const [license, setLicense] = useState(null);
  const [activateKey, setActivateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const lic = await API.get('/api/license');
      if (lic && !lic.error) setLicense(lic);
    } catch (err) {
      window.addToast?.('Failed to load license info', 'error');
    }
    setLoading(false);
  }

  async function handleActivate(e) {
    e.preventDefault();
    if (!activateKey.trim()) return;
    setActivating(true);
    try {
      const result = await API.post('/api/license/activate', { key: activateKey.trim() });
      if (result?.success) {
        window.addToast?.('License activated — full access enabled!', 'success');
        setActivateKey('');
        loadData();
      } else {
        window.addToast?.(result?.error || 'Activation failed', 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to activate license', 'error');
    }
    setActivating(false);
  }

  async function handleDeactivate() {
    if (!confirm('Are you sure you want to deactivate your license?')) return;
    try {
      await API.del('/api/license');
      window.addToast?.('License deactivated', 'info');
      loadData();
    } catch {
      window.addToast?.('Failed to deactivate', 'error');
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading license information...</div>;

  const isLicensed = license?.licensed === true;

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>

      {/* License Status Card */}
      <div className="card" style={{ marginBottom: 24, textAlign: 'center', padding: 32 }}>
        <div style={{
          display: 'inline-block',
          width: 64, height: 64, borderRadius: '50%',
          background: isLicensed ? 'rgba(0, 255, 106, 0.12)' : 'rgba(255, 255, 255, 0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
          border: `2px solid ${isLicensed ? 'var(--accent)' : 'var(--border)'}`,
        }}>
          <span style={{ fontSize: 28 }}>{isLicensed ? '✓' : '○'}</span>
        </div>

        <div style={{
          background: isLicensed ? 'var(--accent)' : '#6b7280',
          color: isLicensed ? '#000' : '#fff',
          padding: '6px 20px',
          borderRadius: 6,
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          display: 'inline-block',
          marginBottom: 16,
        }}>
          {isLicensed ? 'Licensed' : 'Unlicensed'}
        </div>

        {isLicensed && license?.licensee && (
          <div style={{ color: 'var(--text)', fontSize: 15, marginBottom: 4 }}>
            Licensed to: <strong>{license.licensee}</strong>
          </div>
        )}
        {isLicensed && license?.email && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>{license.email}</div>
        )}
        {isLicensed && license?.expiresAt && (
          <div style={{ color: new Date(license.expiresAt) < new Date() ? '#ef4444' : 'var(--text-muted)', fontSize: 13 }}>
            {new Date(license.expiresAt) < new Date() ? 'Expired' : 'Expires'}: {new Date(license.expiresAt).toLocaleDateString()}
          </div>
        )}
        {isLicensed && !license?.expiresAt && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Permanent license</div>
        )}

        {!isLicensed && (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
            Purchase a license for <strong style={{ color: 'var(--text)' }}>$19.99 USD</strong> (one-time) to unlock full access to all Citadel features.
          </div>
        )}

        {!isLicensed && license?.purchaseUrl && (
          <a
            href={license.purchaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '12px 32px',
              background: 'var(--accent)',
              color: '#000',
              fontWeight: 700,
              fontSize: 15,
              borderRadius: 8,
              textDecoration: 'none',
              letterSpacing: 0.3,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            Purchase License — $19.99
          </a>
        )}
      </div>

      {/* What You Get */}
      {!isLicensed && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Full Access Includes</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[
              'Unlimited Servers', 'File Manager', 'Scheduler', 'Backup System',
              'RCON Console', 'Live Map', 'Mod Manager', 'Discord Bot',
              'Webhooks', 'Priority Queue', 'Watchlist', 'SteamCMD Deploy',
              'Leaderboards', 'Killfeed', 'Player Management', 'Ban Management',
            ].map(f => (
              <div key={f} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 0', fontSize: 13, color: 'var(--text-muted)',
              }}>
                <span style={{ color: 'var(--accent)' }}>✓</span> {f}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activate */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
          {isLicensed ? 'Change License Key' : 'Activate License'}
        </div>
        <form onSubmit={handleActivate} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="input"
            value={activateKey}
            onChange={e => setActivateKey(e.target.value)}
            placeholder="Paste your license key here..."
            style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
          />
          <button className="btn btn-primary" type="submit" disabled={activating || !activateKey.trim()}>
            {activating ? 'Activating...' : 'Activate'}
          </button>
        </form>
        {isLicensed && (
          <button className="btn btn-danger btn-sm" onClick={handleDeactivate} style={{ marginTop: 12 }}>
            Deactivate License
          </button>
        )}
      </div>
    </div>
  );
}
