import { useState, useEffect } from 'react';
import API from '../api';
import {
  Shield, Crown, Check, Server, FolderOpen, Clock, Terminal, Package,
  Map, Send, Globe, ShieldBan, Users, BarChart3, Skull, Zap,
  Calendar, Mail, KeyRound, AlertTriangle, ArrowUpRight, BadgeCheck, Star, Infinity,
} from '../components/Icon';

export default function LicensePage() {
  const [license, setLicense] = useState(null);
  const [activateKey, setActivateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const lic = await API.get('/api/license');
      if (lic && !lic.error) setLicense(lic);
    } catch {
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
    } catch {
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

  if (loading) return <div className="license-loading">Loading license information...</div>;

  const isLicensed = license?.licensed === true;
  const isExpired = license?.expiresAt && new Date(license.expiresAt) < new Date();

  return (
    <div className="license-page">

      {/* Hero Status */}
      <div className={`license-hero ${isLicensed ? 'licensed' : 'unlicensed'}`}>
        <div className="license-hero-glow" />
        <div className="license-hero-content">
          <div className={`license-icon-ring ${isLicensed ? 'active' : ''}`}>
            {isLicensed ? <Crown size={28} /> : <Shield size={28} />}
          </div>
          <div className="license-hero-text">
            <div className={`license-status-badge ${isLicensed ? (isExpired ? 'expired' : 'active') : 'inactive'}`}>
              {isLicensed ? (isExpired ? 'Expired' : 'Licensed') : 'Free Tier'}
            </div>
            <h2 className="license-hero-title">
              {isLicensed
                ? 'Citadel Pro'
                : 'Upgrade to Citadel Pro'}
            </h2>
            <p className="license-hero-desc">
              {isLicensed
                ? 'Full access to all features and premium support.'
                : 'Unlock the complete server management toolkit for your DayZ community.'}
            </p>
          </div>
        </div>

        {isLicensed && (
          <div className="license-details-row">
            {license?.licensee && (
              <div className="license-detail">
                <BadgeCheck size={14} />
                <span>{license.licensee}</span>
              </div>
            )}
            {license?.email && (
              <div className="license-detail">
                <Mail size={14} />
                <span>{license.email}</span>
              </div>
            )}
            {license?.expiresAt ? (
              <div className={`license-detail ${isExpired ? 'expired' : ''}`}>
                <Calendar size={14} />
                <span>{isExpired ? 'Expired' : 'Expires'}: {new Date(license.expiresAt).toLocaleDateString()}</span>
              </div>
            ) : (
              <div className="license-detail">
                <Infinity size={14} />
                <span>Permanent License</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pricing + Features */}
      {!isLicensed && (
        <div className="license-offer-grid">
          {/* Pricing Card */}
          <div className="license-pricing-card">
            <div className="license-pricing-header">
              <Star size={16} />
              <span>One-Time Purchase</span>
            </div>
            <div className="license-price">
              <span className="license-price-dollar">$</span>
              <span className="license-price-amount">34</span>
              <span className="license-price-cents">.99</span>
              <span className="license-price-unit">USD</span>
            </div>
            <div className="license-price-note">Pay once, own it forever. No subscriptions.</div>
            {license?.purchaseUrl && (
              <a href={license.purchaseUrl} target="_blank" rel="noopener noreferrer" className="license-buy-btn">
                Purchase License <ArrowUpRight size={16} />
              </a>
            )}
            <div className="license-guarantee">
              <Shield size={12} />
              <span>30-day money-back guarantee</span>
            </div>
          </div>

          {/* Features Card */}
          <div className="license-features-card">
            <div className="license-features-header">Everything you need to run DayZ servers</div>
            <div className="license-features-grid">
              {[
                { icon: <Server size={15} />, label: 'Unlimited Servers' },
                { icon: <FolderOpen size={15} />, label: 'File Manager' },
                { icon: <Clock size={15} />, label: 'Scheduler' },
                { icon: <Zap size={15} />, label: 'Backup System' },
                { icon: <Terminal size={15} />, label: 'RCON Console' },
                { icon: <Map size={15} />, label: 'Live Map' },
                { icon: <Package size={15} />, label: 'Mod Manager' },
                { icon: <Send size={15} />, label: 'Discord Bot' },
                { icon: <Globe size={15} />, label: 'Webhooks' },
                { icon: <Users size={15} />, label: 'Priority Queue' },
                { icon: <ShieldBan size={15} />, label: 'Ban Management' },
                { icon: <BarChart3 size={15} />, label: 'Leaderboards' },
                { icon: <Skull size={15} />, label: 'Killfeed' },
                { icon: <Users size={15} />, label: 'Player Management' },
                { icon: <AlertTriangle size={15} />, label: 'Watchlist' },
                { icon: <Package size={15} />, label: 'SteamCMD Deploy' },
              ].map(f => (
                <div key={f.label} className="license-feature-item">
                  <div className="license-feature-icon">{f.icon}</div>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Activate License */}
      <div className="license-activate-card">
        <div className="license-activate-header">
          <KeyRound size={18} />
          <div>
            <div className="license-activate-title">{isLicensed ? 'Manage License' : 'Activate License'}</div>
            <div className="license-activate-desc">
              {isLicensed ? 'Change or deactivate your current license key.' : 'Already purchased? Enter your license key below.'}
            </div>
          </div>
        </div>
        <form onSubmit={handleActivate} className="license-activate-form">
          <input
            type="text"
            className="input license-key-input"
            value={activateKey}
            onChange={e => setActivateKey(e.target.value)}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
          />
          <button className="btn btn-primary license-activate-btn" type="submit" disabled={activating || !activateKey.trim()}>
            {activating ? 'Activating...' : <><Check size={14} /> Activate</>}
          </button>
        </form>
        {isLicensed && (
          <div className="license-deactivate-row">
            <button className="btn btn-danger btn-sm" onClick={handleDeactivate}>
              Deactivate License
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
