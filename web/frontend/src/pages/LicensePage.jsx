import { useState, useEffect } from 'react';
import API from '../api';

const TIER_COLORS = {
  community: '#6b7280',
  standard: '#3b82f6',
  professional: '#8b5cf6',
  enterprise: '#f59e0b',
};

const TIER_LABELS = {
  community: 'Community (Free)',
  standard: 'Standard',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

export default function LicensePage() {
  const [license, setLicense] = useState(null);
  const [tiers, setTiers] = useState([]);
  const [features, setFeatures] = useState({});
  const [activateKey, setActivateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [lic, tierList, featureMap] = await Promise.all([
        API.get('/api/license'),
        API.get('/api/license/tiers'),
        API.get('/api/license/features'),
      ]);
      setLicense(lic);
      setTiers(Array.isArray(tierList) ? tierList : []);
      setFeatures(featureMap && !featureMap.error ? featureMap : {});
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
        window.addToast?.('License activated successfully!', 'success');
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
    if (!confirm('Are you sure you want to deactivate your license? You will revert to the Community (free) tier.')) return;
    try {
      await API.del('/api/license');
      window.addToast?.('License deactivated', 'info');
      loadData();
    } catch {
      window.addToast?.('Failed to deactivate', 'error');
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading license information...</div>;

  const tierColor = TIER_COLORS[license?.tier] || '#6b7280';
  const isFreeTier = license?.tier === 'community';

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Current License Card */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                background: tierColor,
                color: '#fff',
                padding: '4px 14px',
                borderRadius: 6,
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}>
                {TIER_LABELS[license?.tier] || license?.tier}
              </span>
              {license?.valid && <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 13 }}>Active</span>}
            </div>
            {license?.licensee && <div style={{ color: 'var(--text)', fontSize: 15, marginBottom: 4 }}>Licensed to: <strong>{license.licensee}</strong></div>}
            {license?.email && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 4 }}>{license.email}</div>}
            {license?.expiresAt && (
              <div style={{ color: new Date(license.expiresAt) < new Date() ? '#ef4444' : 'var(--text-muted)', fontSize: 13 }}>
                {new Date(license.expiresAt) < new Date() ? 'Expired' : 'Expires'}: {new Date(license.expiresAt).toLocaleDateString()}
              </div>
            )}
            {!license?.expiresAt && !isFreeTier && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Permanent license</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>Server Slots</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
              {license?.currentServers || 0}<span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 16 }}> / {license?.maxServers === Infinity ? '∞' : license?.maxServers}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Activate / Deactivate */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
          {isFreeTier ? 'Activate License' : 'Change License Key'}
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
        {!isFreeTier && (
          <button className="btn btn-danger btn-sm" onClick={handleDeactivate} style={{ marginTop: 12 }}>
            Deactivate License
          </button>
        )}
      </div>

      {/* Feature Availability */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Feature Availability</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {Object.entries(features).map(([feature, enabled]) => (
            <div key={feature} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              background: enabled ? 'rgba(0, 255, 106, 0.08)' : 'rgba(255, 59, 59, 0.08)',
              border: `1px solid ${enabled ? 'rgba(0, 255, 106, 0.2)' : 'rgba(255, 59, 59, 0.2)'}`,
            }}>
              <span style={{ fontSize: 14 }}>{enabled ? '✓' : '✗'}</span>
              <span style={{ fontSize: 13, color: enabled ? 'var(--text)' : 'var(--text-muted)' }}>
                {feature.replace(/_/g, ' ').replace(/\./g, ' › ').replace(/\b\w/g, l => l.toUpperCase())}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tier Comparison */}
      <div className="card">
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Available Tiers</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {tiers.map(tier => {
            const isCurrentTier = tier.id === license?.tier;
            const color = TIER_COLORS[tier.id] || '#6b7280';
            return (
              <div key={tier.id} style={{
                borderRadius: 10, padding: 16,
                border: isCurrentTier ? `2px solid ${color}` : '1px solid var(--border)',
                background: isCurrentTier ? `${color}10` : 'var(--card-bg)',
                position: 'relative',
              }}>
                {isCurrentTier && (
                  <div style={{
                    position: 'absolute', top: -10, right: 12,
                    background: color, color: '#fff', padding: '2px 8px',
                    borderRadius: 4, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  }}>Current</div>
                )}
                <div style={{ fontWeight: 700, fontSize: 16, color, marginBottom: 4 }}>{tier.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Up to {tier.maxServers} server{tier.maxServers !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {tier.features.includes('*') ? (
                    <div>All features included</div>
                  ) : (
                    tier.features.slice(0, 8).map(f => (
                      <div key={f} style={{ marginBottom: 2 }}>✓ {f.replace(/_/g, ' ').replace(/\./g, ' › ')}</div>
                    ))
                  )}
                  {!tier.features.includes('*') && tier.features.length > 8 && (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>+{tier.features.length - 8} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
