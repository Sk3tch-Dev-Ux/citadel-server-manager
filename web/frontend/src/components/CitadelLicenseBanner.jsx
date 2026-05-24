import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';
import { AlertTriangle, Lock, Sparkles, X } from './Icon';

/**
 * Slim banner across the top of AppLayout shown when the customer's Citadel
 * subscription state needs attention. Distinguishes two products:
 *
 *   - Citadel ($14.99/mo) — required to use this app. Lapse → enter grace
 *     then read-only.
 *   - Citadel Cloud ($10/mo, optional add-on) — gates cloud features.
 *     Lapse → cloud features pause; the base app continues working as
 *     long as the Citadel sub is active.
 *
 * State → behavior:
 *   active      → not rendered
 *   hidden      → not rendered (user lacks license.manage permission)
 *   unactivated → marketing-style banner with "Sign in" + "Learn more" CTAs
 *                 (dismissable per session)
 *   grace       → "working offline, last verified X ago" + Reconnect button
 *   past_due    → payment past due reminder
 *   lapsed      → Citadel subscription lapsed; non-dismissable
 *   expired     → grace exceeded; non-dismissable
 *
 * Hidden when the user is already on /citadel-license (avoids duplication).
 */

const SESSION_DISMISS_KEY = 'citadel:license-banner-dismissed';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const LEARN_MORE_URL = 'https://citadels.cc/cloud';

export default function CitadelLicenseBanner() {
  const [status, setStatus] = useState(null);
  const [cloudBansStats, setCloudBansStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Read dismissal flag once at mount; sessionStorage clears on app close so
  // the banner returns next launch (matches D1 "dismissable per session").
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  const loadStatus = useCallback(async () => {
    try {
      const res = await API.get('/api/citadel-license/status');
      setStatus(res);
    } catch {
      // Admin may not have permission to hit this endpoint — silently hide banner
      setStatus({ status: 'hidden' });
    }
  }, []);

  // P3.10 — pull Cloud Bans cache stats so we can show loss-aversion copy
  // when the customer lapses ("X cheaters were on your community ban list").
  // Only attempted when status is lapsed/expired so we don't spam the
  // endpoint on every banner render. Errors silently no-op (the banner
  // falls back to its non-stat copy).
  const loadCloudBansStats = useCallback(async () => {
    try {
      const res = await API.get('/api/cloud-bans/status');
      if (res && res.cache) setCloudBansStats(res.cache);
    } catch {
      setCloudBansStats(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await loadStatus(); })();
    const timer = setInterval(loadStatus, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [loadStatus]);

  // Pull cloud-bans stats only for the states where we'd show them.
  useEffect(() => {
    if (status?.status === 'lapsed' || status?.status === 'expired' || status?.status === 'past_due') {
      loadCloudBansStats();
    }
  }, [status?.status, loadCloudBansStats]);

  // ── Render guards ──
  if (!status) return null;
  if (status.status === 'hidden' || status.status === 'active') return null;
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/citadel-license')) return null;

  const isUnactivated = status.status === 'unactivated';
  // Only the unactivated marketing banner is dismissable. State changes that
  // affect a paying customer (grace, lapsed) are sticky — we want them to act.
  if (isUnactivated && dismissed) return null;

  function dismiss() {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  }

  async function handleReconnect() {
    setRefreshing(true);
    try {
      await API.post('/api/citadel-license/refresh', {});
      await loadStatus();
    } catch {
      // Toasts are surfaced from the page-level refresh. The banner stays quiet.
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <BannerBody
      status={status}
      cloudBansStats={cloudBansStats}
      onDismiss={isUnactivated ? dismiss : null}
      onReconnect={status.status === 'grace' ? handleReconnect : null}
      reconnecting={refreshing}
    />
  );
}

// ───────────────────────────────────────────────────────────

function BannerBody({ status, cloudBansStats, onDismiss, onReconnect, reconnecting }) {
  const variant = variants[status.status] || variants.unactivated;
  const Icon = variant.icon;
  const toneColor = variant.tone === 'danger' ? 'var(--danger)'
                  : variant.tone === 'warning' ? 'var(--warning)'
                  : 'var(--accent)';

  // Grace state shows a relative-time hint ("last verified 2d ago") so the
  // user knows whether this is a brief blip or something to fix soon.
  const lastVerifiedHint = status.status === 'grace' && status.lastVerifiedAt
    ? formatRelative(status.lastVerifiedAt) : null;

  // P3.10 — loss-aversion copy. When the Citadel subscription has fully
  // lapsed (lapsed/expired) and the local cloud-bans cache shows they were
  // getting protection, surface the count so they can see what's about to
  // disappear. Past-due intentionally NOT included — billing's about to
  // recover one way or the other; loss-aversion before that's resolved is
  // premature.
  const showLossAversion = (status.status === 'lapsed' || status.status === 'expired')
    && cloudBansStats?.total > 0;

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

      <span style={{ flex: 1 }}>
        {showLossAversion ? (
          // Override the variant text with the stats-driven copy. Speaks
          // specifically about the Cloud add-on protection the customer is
          // losing, not the Citadel base sub (which has its own consequence).
          <>
            Citadel subscription inactive — and you&apos;ll lose protection from{' '}
            <strong>{cloudBansStats.total.toLocaleString()}</strong> community-banned cheaters
            on the Cloud add-on. Renew billing to restore everything.
          </>
        ) : (
          <>
            {variant.text}
            {lastVerifiedHint && (
              <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
                ({lastVerifiedHint})
              </span>
            )}
          </>
        )}
      </span>

      {/* Reconnect — grace state only */}
      {onReconnect && (
        <button
          type="button"
          onClick={onReconnect}
          disabled={reconnecting}
          className="btn btn-sm btn-ghost"
          style={{ flexShrink: 0 }}
        >
          {reconnecting ? 'Reconnecting…' : 'Reconnect now'}
        </button>
      )}

      {/* Primary CTA — paid-only marketing for unactivated, "Manage" elsewhere */}
      {variant.primary && (
        variant.primary.external ? (
          <a
            href={variant.primary.to}
            target="_blank"
            rel="noopener noreferrer"
            style={ctaStyle(toneColor)}
          >
            {variant.primary.label}
          </a>
        ) : (
          <Link to={variant.primary.to} style={ctaStyle(toneColor)}>
            {variant.primary.label}
          </Link>
        )
      )}

      {/* Secondary CTA — only on the unactivated marketing banner */}
      {variant.secondary && (
        <Link
          to={variant.secondary.to}
          style={{
            padding: '6px 14px',
            color: 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 500,
            textDecoration: 'none',
            flexShrink: 0,
          }}
        >
          {variant.secondary.label}
        </Link>
      )}

      {/* Session-dismiss — only on the unactivated marketing banner */}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function ctaStyle(toneColor) {
  return {
    padding: '6px 14px',
    background: toneColor,
    color: 'white',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    textDecoration: 'none',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
}

// ───────────────────────────────────────────────────────────
// State → copy + CTAs

const variants = {
  // Marketing banner — fires when this machine is unactivated (no cached
  // license). Could mean: customer has no Citadel sub at all, or has one
  // but hasn't signed in yet on this box. Dismissable per session.
  //
  // CTA structure: primary = activate the base Citadel subscription (what
  // unlocks the Agent). Secondary = learn about the optional Citadel Cloud
  // add-on (remote control, automations, Trust Network).
  unactivated: {
    icon: Sparkles,
    tone: 'accent',
    text: 'Activate your Citadel subscription to unlock the full Agent — and optionally pair with Citadel Cloud for remote control and the Trust Network.',
    primary: { to: '/citadel-license', label: 'Activate Citadel', external: false },
    secondary: { to: LEARN_MORE_URL, label: 'About Citadel Cloud →' },
  },

  // Customer is paying but offline / verify failed. Surface "Reconnect" instead
  // of an upgrade CTA — they don't need to learn more.
  // This is the Citadel base subscription verify, not the Cloud add-on.
  grace: {
    icon: AlertTriangle,
    tone: 'warning',
    text: 'Citadel subscription is working offline — license verification failed.',
    primary: { to: '/citadel-license', label: 'Manage', external: false },
  },

  // Citadel base subscription billing past due. Cloud add-on may also be
  // affected since it rides on the same billing account.
  past_due: {
    icon: AlertTriangle,
    tone: 'warning',
    text: 'Your Citadel subscription payment is past due. Update your payment method to avoid interruption.',
    primary: { to: 'https://citadels.cc/account', label: 'Open account', external: true },
  },

  // Sticky — non-dismissable. The customer's Citadel base subscription has
  // lapsed, which means the app will enter grace then read-only. Updating
  // billing is the only action that recovers it. Cloud add-on is also lost
  // until the base sub is restored (it can't exist without one).
  lapsed: {
    icon: Lock,
    tone: 'danger',
    text: 'Citadel subscription is no longer active. Renew billing to restore the Agent.',
    primary: { to: 'https://citadels.cc/account', label: 'Manage subscription', external: true },
  },

  // Base-sub grace period exceeded. Same recovery path as `grace` but the
  // app is now read-only until reconnect succeeds.
  expired: {
    icon: Lock,
    tone: 'danger',
    text: 'Citadel subscription grace period has ended. Reconnect to refresh your license.',
    primary: { to: '/citadel-license', label: 'Reconnect', external: false },
  },
};

// ───────────────────────────────────────────────────────────

function formatRelative(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `last verified ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `last verified ${h}h ago`;
  const d = Math.floor(h / 24);
  return `last verified ${d}d ago`;
}
