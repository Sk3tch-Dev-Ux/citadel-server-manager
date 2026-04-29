import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import API from '../api';
import { AlertTriangle, Lock, Sparkles, X } from './Icon';

/**
 * Slim banner across the top of AppLayout shown when the Citadel Cloud
 * license needs the user's attention. The banner is purely advisory:
 * Citadel itself is free and keeps working, the banner only surfaces the
 * Citadel Cloud paid service.
 *
 * State → behavior:
 *   active      → not rendered
 *   hidden      → not rendered (user lacks license.manage permission)
 *   unactivated → marketing-style banner with "Sign in" + "Learn more" CTAs
 *                 (dismissable per session)
 *   grace       → "working offline, last verified X ago" + Reconnect button
 *   past_due    → payment past due reminder
 *   lapsed      → subscription lapsed; cloud features paused (non-dismissable)
 *   expired     → grace exceeded; non-dismissable
 *
 * Hidden when the user is already on /citadel-license (avoids duplication).
 */

const SESSION_DISMISS_KEY = 'citadel:license-banner-dismissed';
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const LEARN_MORE_URL = 'https://citadels.cc/cloud';

export default function CitadelLicenseBanner() {
  const [status, setStatus] = useState(null);
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

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await loadStatus(); })();
    const timer = setInterval(loadStatus, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [loadStatus]);

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
      onDismiss={isUnactivated ? dismiss : null}
      onReconnect={status.status === 'grace' ? handleReconnect : null}
      reconnecting={refreshing}
    />
  );
}

// ───────────────────────────────────────────────────────────

function BannerBody({ status, onDismiss, onReconnect, reconnecting }) {
  const variant = variants[status.status] || variants.unactivated;
  const Icon = variant.icon;
  const toneColor = variant.tone === 'danger' ? 'var(--danger)'
                  : variant.tone === 'warning' ? 'var(--warning)'
                  : 'var(--accent)';

  // Grace state shows a relative-time hint ("last verified 2d ago") so the
  // user knows whether this is a brief blip or something to fix soon.
  const lastVerifiedHint = status.status === 'grace' && status.lastVerifiedAt
    ? formatRelative(status.lastVerifiedAt) : null;

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
        {variant.text}
        {lastVerifiedHint && (
          <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>
            ({lastVerifiedHint})
          </span>
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
  // Marketing banner — Citadel itself is free; this is purely a pitch for the
  // paid Citadel Cloud upgrade. Dismissable per session (handled by caller).
  unactivated: {
    icon: Sparkles,
    tone: 'accent',
    text: 'Unlock global ban DB, off-site backups, and more with Citadel Cloud.',
    primary: { to: '/citadel-license', label: 'Sign in to Citadel Cloud', external: false },
    secondary: { to: LEARN_MORE_URL, label: 'Learn more →' },
  },

  // Customer is paying but offline / verify failed. Surface "Reconnect" instead
  // of an upgrade CTA — they don't need to learn more.
  grace: {
    icon: AlertTriangle,
    tone: 'warning',
    text: 'Citadel Cloud is working offline.',
    primary: { to: '/citadel-license', label: 'Manage', external: false },
  },

  past_due: {
    icon: AlertTriangle,
    tone: 'warning',
    text: 'Your Citadel Cloud payment is past due. Update your payment method to avoid interruption.',
    primary: { to: 'https://citadels.cc/account', label: 'Open account', external: true },
  },

  // Sticky — non-dismissable. Cloud features have stopped; local app still works.
  lapsed: {
    icon: Lock,
    tone: 'danger',
    text: 'Citadel Cloud subscription inactive. Cloud features are paused; the local app keeps working.',
    primary: { to: 'https://citadels.cc/account', label: 'Manage subscription', external: true },
  },

  expired: {
    icon: Lock,
    tone: 'danger',
    text: 'Citadel Cloud grace period has ended. Reconnect to refresh your license.',
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
