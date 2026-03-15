/* eslint-disable no-shadow-restricted-names */
import { useState, useEffect } from 'react';
import API from '../api';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Shield, Crown, Check, Server, Users,
  Calendar, Mail, KeyRound, ArrowUpRight, BadgeCheck, Star,
  ExternalLink, Zap,
} from '../components/Icon';

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    price: { month: 0, year: 0 },
    desc: 'For small communities getting started.',
    features: [
      '1 server', '3 team members', '3-day data retention',
      'Real-time metrics & logs', 'Basic admin actions',
      '2 webhooks', '60 API requests/min',
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: { month: 4.99, year: 47.88 },
    desc: 'Full features for small communities.',
    features: [
      '2 servers', '5 team members', '14-day data retention',
      'All admin actions', 'Cross-server search', 'Shared ban lists',
      'In-game VIP store', '5 webhooks', '120 API requests/min',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    popular: true,
    price: { month: 9.99, year: 95.88 },
    desc: 'For growing communities that need more.',
    features: [
      '5 servers', '15 team members', '30-day data retention',
      'Everything in Basic', '15 webhooks', '25 store products',
      'Data export', '300 API requests/min',
    ],
  },
  {
    id: 'community',
    name: 'Community',
    price: { month: 24.99, year: 239.88 },
    desc: 'For large networks and serious operators.',
    features: [
      'Unlimited servers', 'Unlimited team members', '365-day data retention',
      'Everything in Pro', 'Unlimited webhooks', 'Custom branding',
      'Priority support', '1000 API requests/min',
    ],
  },
];

export default function LicensePage() {
  const { confirm: confirmDialog, DialogComponent } = useConfirmDialog();
  const [license, setLicense] = useState(null);
  const [activateKey, setActivateKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [billingInterval, setBillingInterval] = useState('month');

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
        window.addToast?.('License activated!', 'success');
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
    if (!await confirmDialog({ title: 'Deactivate License', message: 'This will revert to the Free tier. Continue?', confirmLabel: 'Deactivate', variant: 'danger' })) return;
    try {
      await API.del('/api/license');
      window.addToast?.('Reverted to Free tier', 'info');
      loadData();
    } catch {
      window.addToast?.('Failed to deactivate', 'error');
    }
  }

  if (loading) return <div className="license-loading">Loading license information...</div>;

  const currentTier = license?.tier || 'free';
  const isExpired = license?.expiresAt && new Date(license.expiresAt) < new Date();
  const tierIndex = TIERS.findIndex(t => t.id === currentTier);

  return (
    <div className="license-page">

      {/* Hero Status */}
      <div className={`license-hero ${currentTier !== 'free' ? 'licensed' : 'unlicensed'}`}>
        <div className="license-hero-glow" />
        <div className="license-hero-content">
          <div className={`license-icon-ring ${currentTier !== 'free' ? 'active' : ''}`}>
            {currentTier !== 'free' ? <Crown size={28} /> : <Shield size={28} />}
          </div>
          <div className="license-hero-text">
            <div className={`license-status-badge ${currentTier !== 'free' ? (isExpired ? 'expired' : 'active') : 'inactive'}`}>
              {currentTier !== 'free' ? (isExpired ? 'Expired' : TIERS[tierIndex]?.name) : 'Free Tier'}
            </div>
            <h2 className="license-hero-title">
              {currentTier !== 'free'
                ? `Citadel ${TIERS[tierIndex]?.name}`
                : 'Upgrade Your Plan'}
            </h2>
            <p className="license-hero-desc">
              {currentTier !== 'free'
                ? `You're on the ${TIERS[tierIndex]?.name} plan. ${TIERS[tierIndex]?.desc}`
                : 'Start free with one server. Upgrade when your community grows.'}
            </p>
          </div>
        </div>

        {currentTier !== 'free' && (
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
            {license?.expiresAt && (
              <div className={`license-detail ${isExpired ? 'expired' : ''}`}>
                <Calendar size={14} />
                <span>{isExpired ? 'Expired' : 'Renews'}: {new Date(license.expiresAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Subscription management via Cloud */}
        {currentTier !== 'free' && (
          <div className="license-hero-actions">
            <a className="btn btn-secondary btn-sm" href="https://cloud.citadelforge.com" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} /> Manage on Citadel Cloud
            </a>
          </div>
        )}
      </div>

      {/* Pricing Tiers */}
      <div className="license-pricing-section">
        <div className="license-pricing-heading">
          <h3>Simple, transparent pricing</h3>
          <p>Start free with one server. Upgrade when your community grows. No hidden fees, cancel anytime.</p>
        </div>

        {/* Billing interval toggle */}
        <div className="license-interval-toggle">
          <span className={billingInterval === 'month' ? 'active' : ''}>Monthly</span>
          <button
            className={`license-toggle-switch ${billingInterval === 'year' ? 'yearly' : ''}`}
            onClick={() => setBillingInterval(b => b === 'month' ? 'year' : 'month')}
            aria-label="Toggle billing interval"
          >
            <span className="license-toggle-thumb" />
          </button>
          <span className={billingInterval === 'year' ? 'active' : ''}>
            Yearly <span className="license-save-badge">Save 20%</span>
          </span>
        </div>

        <div className="license-tier-grid">
          {TIERS.map((tier, i) => {
            const isCurrent = tier.id === currentTier;
            const isUpgrade = i > tierIndex;
            const isDowngrade = i < tierIndex && currentTier !== 'free';
            const price = billingInterval === 'year'
              ? (tier.price.year / 12).toFixed(2)
              : tier.price.month.toFixed(2);

            return (
              <div key={tier.id} className={`license-tier-card ${isCurrent ? 'current' : ''} ${tier.popular ? 'popular' : ''}`}>
                {tier.popular && <div className="license-popular-badge">Most Popular</div>}
                <div className="license-tier-name">{tier.name}</div>
                <div className="license-tier-price">
                  <span className="license-tier-dollar">$</span>
                  <span className="license-tier-amount">{price.split('.')[0]}</span>
                  <span className="license-tier-cents">.{price.split('.')[1]}</span>
                  <span className="license-tier-period">/month</span>
                </div>
                {billingInterval === 'year' && tier.price.year > 0 && (
                  <div className="license-tier-yearly">Billed ${tier.price.year.toFixed(2)}/year</div>
                )}
                <div className="license-tier-desc">{tier.desc}</div>

                {isCurrent ? (
                  <button className="btn btn-secondary license-tier-btn" disabled>
                    <Check size={14} /> Current Plan
                  </button>
                ) : tier.id === 'free' ? (
                  currentTier !== 'free' ? (
                    <button className="btn btn-secondary license-tier-btn" disabled>Free Tier</button>
                  ) : (
                    <button className="btn btn-secondary license-tier-btn" disabled>
                      <Check size={14} /> Current Plan
                    </button>
                  )
                ) : (
                  <a
                    className={`btn ${tier.popular ? 'btn-primary' : 'btn-secondary'} license-tier-btn`}
                    href="https://cloud.citadelforge.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {isUpgrade ? 'Subscribe on Cloud' : isDowngrade ? 'Manage on Cloud' : 'Subscribe on Cloud'}
                    <ArrowUpRight size={14} />
                  </a>
                )}

                <ul className="license-tier-features">
                  {tier.features.map(f => (
                    <li key={f}>
                      <Check size={14} className="license-check-icon" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Activate License Key */}
      <div className="license-activate-card">
        <div className="license-activate-header">
          <KeyRound size={18} />
          <div>
            <div className="license-activate-title">{currentTier !== 'free' ? 'Manage License' : 'Activate License'}</div>
            <div className="license-activate-desc">
              {currentTier !== 'free' ? 'Update your license key or deactivate.' : 'Subscribe on Citadel Cloud, then paste your license key here.'}
            </div>
          </div>
        </div>
        <form onSubmit={handleActivate} className="license-activate-form">
          <input
            type="text"
            className="input license-key-input"
            value={activateKey}
            onChange={e => setActivateKey(e.target.value)}
            placeholder="Paste your license key here"
          />
          <button className="btn btn-primary license-activate-btn" type="submit" disabled={activating || !activateKey.trim()}>
            {activating ? 'Activating...' : <><Check size={14} /> Activate</>}
          </button>
        </form>
        {currentTier !== 'free' && (
          <div className="license-deactivate-row">
            <button className="btn btn-danger btn-sm" onClick={handleDeactivate}>
              Deactivate License
            </button>
          </div>
        )}
      </div>

      {DialogComponent}
    </div>
  );
}
