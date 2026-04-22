import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';
import { AlertTriangle, Lock } from './Icon';

/**
 * Slim banner across the top of AppLayout shown when the Citadel license
 * isn't fully healthy. Hidden on the license page itself (where the user
 * already sees full status) and when status is 'active'.
 */
export default function CitadelLicenseBanner() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await API.get('/api/citadel-license/status');
        if (!cancelled) setStatus(res);
      } catch {
        // Admin may not have permission to hit this endpoint — silently hide banner
        if (!cancelled) setStatus({ status: 'hidden' });
      }
    }
    load();
    // Re-poll every 5 minutes so UI reflects state changes from background refresh
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (!status || status.status === 'hidden' || status.status === 'active') return null;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/citadel-license')) return null;

  const copy = {
    grace:       { icon: AlertTriangle, tone: 'warning', text: 'Citadel is running in offline grace mode — reconnect to the internet to refresh your license.' },
    past_due:    { icon: AlertTriangle, tone: 'warning', text: 'Your Citadel subscription has a payment past due. Update your payment method to avoid interruption.' },
    lapsed:      { icon: Lock,          tone: 'danger',  text: 'Your Citadel subscription has lapsed. Re-activate to continue using paid features.' },
    expired:     { icon: Lock,          tone: 'danger',  text: 'Your Citadel grace period has ended. Re-verify to continue.' },
    unactivated: { icon: Lock,          tone: 'warning', text: 'Citadel isn\'t activated yet. Sign in with your citadels.cc account to unlock the full app.' },
  }[status.status];

  if (!copy) return null;
  const Icon = copy.icon;
  const toneColor = copy.tone === 'danger' ? 'var(--danger)' : 'var(--warning)';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 20px',
        background: `color-mix(in srgb, ${toneColor} 12%, var(--bg-card))`,
        borderBottom: `1px solid color-mix(in srgb, ${toneColor} 40%, transparent)`,
        fontSize: 13,
        color: 'var(--text-primary)',
      }}
    >
      <Icon size={16} style={{ color: toneColor, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{copy.text}</span>
      <Link
        to="/citadel-license"
        style={{
          padding: '6px 14px',
          background: toneColor,
          color: 'white',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        Manage
      </Link>
    </div>
  );
}
