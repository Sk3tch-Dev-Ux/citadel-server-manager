/* global sessionStorage, CustomEvent */
import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import {
  Shield,
  CheckCircle,
  AlertTriangle,
  Lock,
  Loader,
  RefreshCw,
  LogOut,
  Eye,
  EyeOff,
  Activity,
} from '../components/Icon';

/**
 * Citadel Cloud activation page — where the server admin links this
 * installation to their citadel-hub.com account.
 *
 * Citadel is a paid product ($14.99/month) — activation requires an active
 * Citadel subscription. This page also surfaces the optional Citadel Cloud
 * add-on ($10/month on top, 7-day trial) which unlocks cloud-only features
 * like the Global Ban Database.
 */
export default function CitadelLicensePage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [activating, setActivating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await API.get('/api/citadel-license/status');
      setStatus(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleActivate(e) {
    e.preventDefault();
    setActivating(true);
    setError(null);
    try {
      const suggestedName = name.trim() || window.location.hostname || 'Citadel Server';
      const res = await API.post('/api/citadel-license/activate', {
        email: email.trim(),
        password,
        name: suggestedName,
      });
      if (res.error) {
        // Map server-side error codes to UX-friendly messages. The most
        // common one for a brand-new prospect is SUBSCRIPTION_INACTIVE
        // (their email exists but no active subscription) — point them at
        // the marketing/pricing page.
        if (res.error === 'SUBSCRIPTION_INACTIVE' || res.message?.includes('SUBSCRIPTION_INACTIVE')) {
          setError({
            kind: 'no-subscription',
            message: 'No active Citadel Cloud subscription found on this account.',
          });
        } else {
          setError({ kind: 'generic', message: res.message || res.error });
        }
      } else {
        setEmail('');
        setPassword('');
        setName('');
        await loadStatus();
        // Banner has its own status state polled on a 5-minute timer.
        // Clear its per-session dismissal and nudge it to reload so the
        // "Activate Citadel" strip disappears immediately, not 5 min later.
        try { sessionStorage.removeItem('citadel:license-banner-dismissed'); } catch { /* sessionStorage unavailable */ }
        window.dispatchEvent(new CustomEvent('citadel:license-changed'));
        window.addToast?.('Citadel Cloud activated on this machine.', 'success');
      }
    } catch (err) {
      setError({ kind: 'generic', message: err.message });
    } finally {
      setActivating(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await API.post('/api/citadel-license/refresh', {});
      await loadStatus();
      window.dispatchEvent(new CustomEvent('citadel:license-changed'));
      window.addToast?.('License refreshed.', 'success');
    } catch (err) {
      window.addToast?.(`Refresh failed: ${err.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm('Deactivate this machine?\n\nThis frees one of your device slots on your Citadel account. Citadel will enter read-only mode on THIS machine after the offline grace window until you re-activate. Your Citadel and Cloud subscriptions are NOT canceled — only this machine\'s activation.')) return;
    setDeactivating(true);
    try {
      await API.del('/api/citadel-license/deactivate');
      await loadStatus();
      window.dispatchEvent(new CustomEvent('citadel:license-changed'));
      window.addToast?.('Citadel Cloud deactivated on this machine.', 'info');
    } catch (err) {
      window.addToast?.(`Deactivate failed: ${err.message}`, 'error');
    } finally {
      setDeactivating(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <Loader size={24} className="spin" />
      </div>
    );
  }

  const isActive = status?.status === 'active' || status?.status === 'grace';
  const needsActivation = status?.status === 'unactivated' || !status?.claims;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Shield size={28} style={{ color: 'var(--accent)' }} />
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Citadel Cloud</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            Optional paid service. Sign in to unlock cloud features on this machine.
          </p>
        </div>
      </div>

      <StatusCard status={status} onRefresh={handleRefresh} refreshing={refreshing} />

      {isActive ? (
        <ActivatedCard status={status} onDeactivate={handleDeactivate} deactivating={deactivating} />
      ) : (
        <ActivationForm
          email={email}
          password={password}
          name={name}
          showPassword={showPassword}
          activating={activating}
          error={error}
          needsActivation={needsActivation}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onChangeName={setName}
          onToggleShowPassword={() => setShowPassword((s) => !s)}
          onSubmit={handleActivate}
        />
      )}

      <TelemetryCard />

      <InfoBox />
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function StatusCard({ status, onRefresh, refreshing }) {
  const s = status?.status || 'unactivated';
  const config = {
    active:      { icon: CheckCircle,    color: 'var(--success)', label: 'Active',        tone: 'success' },
    grace:       { icon: AlertTriangle,  color: 'var(--warning)', label: 'Offline grace', tone: 'warning' },
    past_due:    { icon: AlertTriangle,  color: 'var(--warning)', label: 'Payment past due', tone: 'warning' },
    lapsed:      { icon: Lock,           color: 'var(--danger)',  label: 'Subscription lapsed', tone: 'danger' },
    expired:     { icon: Lock,           color: 'var(--danger)',  label: 'Grace window exceeded', tone: 'danger' },
    unactivated: { icon: Lock,           color: 'var(--text-muted)', label: 'Not activated', tone: 'neutral' },
  }[s] || { icon: Lock, color: 'var(--text-muted)', label: s, tone: 'neutral' };
  const Icon = config.icon;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${config.tone === 'success' ? 'var(--success)' : config.tone === 'warning' ? 'var(--warning)' : config.tone === 'danger' ? 'var(--danger)' : 'var(--border)'}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon size={20} style={{ color: config.color }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{config.label}</div>
            {status?.claims?.email && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                Signed in as <strong>{status.claims.email}</strong>
              </div>
            )}
          </div>
        </div>
        {status?.claims && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="btn btn-ghost btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {status?.subscription && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
          <div>Subscription status: <strong style={{ color: 'var(--text-primary)' }}>{status.subscription.status}</strong></div>
          {status.subscription.renewsAt && (
            <div style={{ marginTop: 4 }}>
              Next renewal: {new Date(status.subscription.renewsAt).toLocaleDateString()}
            </div>
          )}
          {status.subscription.cancelAt && (
            <div style={{ marginTop: 4, color: 'var(--warning)' }}>
              Cancels: {new Date(status.subscription.cancelAt).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {status?.lastVerifiedAt && (
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
          Last verified: {new Date(status.lastVerifiedAt).toLocaleString()}
        </div>
      )}

      {status?.machineId && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
          Machine ID: {status.machineId}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function ActivationForm({
  email, password, name, showPassword, activating, error, needsActivation,
  onChangeEmail, onChangePassword, onChangeName, onToggleShowPassword, onSubmit,
}) {
  return (
    <form onSubmit={onSubmit} style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 24,
      marginBottom: 24,
    }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 600 }}>
        {needsActivation ? 'Sign in to Citadel Cloud' : 'Re-activate Citadel Cloud'}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
        Sign in with your <strong>citadel-hub.com</strong> account. This machine will take one of your activated device slots.
        {' '}
        <a
          href="https://citadel-hub.com/cloud"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          New here? Learn about Citadel Cloud →
        </a>
      </p>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => onChangeEmail(e.target.value)}
          className="input"
          placeholder="you@example.com"
          style={{ width: '100%' }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Password</span>
        <div style={{ position: 'relative' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => onChangePassword(e.target.value)}
            className="input"
            style={{ width: '100%', paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={onToggleShowPassword}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
            }}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </label>

      <label style={{ display: 'block', marginBottom: 20 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Device label <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          className="input"
          placeholder="e.g. Chernarus Prod, Home Lab"
          maxLength={100}
          style={{ width: '100%' }}
        />
        <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
          Shown in your citadel-hub.com device list so you can tell machines apart.
        </span>
      </label>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: error.kind === 'no-subscription' ? 'var(--text-primary)' : 'var(--danger)',
            background: error.kind === 'no-subscription'
              ? 'color-mix(in srgb, var(--accent) 10%, transparent)'
              : 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: `1px solid color-mix(in srgb, ${error.kind === 'no-subscription' ? 'var(--accent)' : 'var(--danger)'} 30%, transparent)`,
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 16,
            lineHeight: 1.55,
          }}
        >
          {error.kind === 'no-subscription' ? (
            <>
              <strong style={{ display: 'block', marginBottom: 4 }}>{error.message}</strong>
              <span style={{ color: 'var(--text-secondary)' }}>
                You need an active Citadel subscription to activate this machine. Sign up or
                manage your account at{' '}
                <a
                  href="https://app.citadel-hub.com/account"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)', fontWeight: 500 }}
                >
                  app.citadel-hub.com/account
                </a>
                . Once you have a Citadel subscription, sign in here. The Citadel Cloud add-on
                (Global Ban DB, etc.) is a separate $10/month subscription —{' '}
                <a
                  href="https://citadel-hub.com/cloud"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent)', fontWeight: 500 }}
                >
                  learn more
                </a>
                .
              </span>
            </>
          ) : (
            // Older error shapes (string) flow through the renderer too —
            // tolerate either { message } or a bare string from upstream.
            (typeof error === 'string' ? error : error.message)
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={activating}
          style={{ minWidth: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {activating ? <><Loader size={14} className="spin" /> Activating…</> : 'Sign in'}
        </button>
        <a
          href="https://app.citadel-hub.com/account"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          Manage devices on citadel-hub.com →
        </a>
      </div>
    </form>
  );
}

// ───────────────────────────────────────────────────────────

function ActivatedCard({ status, onDeactivate, deactivating }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
    }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>This machine</h3>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        Deactivate to free a device slot on your account. You can always re-activate this
        or another machine with the same credentials. Your subscriptions are
        not canceled — only this machine&apos;s activation.
      </p>
      <button
        type="button"
        onClick={onDeactivate}
        disabled={deactivating}
        className="btn btn-ghost"
        style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}
      >
        <LogOut size={14} />
        {deactivating ? 'Deactivating…' : 'Deactivate this machine'}
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────

/**
 * TelemetryCard — toggle for the Citadel Cloud diagnostic telemetry stream.
 *
 * Hits GET/POST /api/citadel-license/telemetry-* (see citadel-license.routes.js).
 * Per the D-telemetry decision (opt-out, clearly disclosed) the default is
 * enabled; this card is the disclosure surface AND the off-switch.
 */
function TelemetryCard() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await API.get('/api/citadel-license/telemetry-state');
      setState(res);
    } catch (err) {
      // Silently fail — surface is optional; if it 403s for a non-admin,
      // we just don't render the card.
      setState({ error: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(next) {
    setSaving(true);
    try {
      const res = await API.post('/api/citadel-license/telemetry-toggle', { enabled: next });
      setState((prev) => prev ? { ...prev, enabled: res.enabled } : { enabled: res.enabled });
      window.addToast?.(next ? 'Telemetry enabled.' : 'Telemetry disabled.', 'info');
    } catch (err) {
      window.addToast?.(`Failed to update telemetry: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (state?.error) return null;

  const enabled = Boolean(state?.enabled);

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 20,
      marginBottom: 24,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Activity size={18} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Diagnostic telemetry</h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: saving ? 'wait' : 'pointer' }}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving}
                onChange={(e) => handleToggle(e.target.checked)}
                aria-label="Toggle Citadel Cloud diagnostic telemetry"
                style={{ width: 16, height: 16 }}
              />
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {saving ? 'Saving…' : enabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </div>

          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            Citadel sends a small set of diagnostic events to <strong>api.citadel-hub.com</strong> so we can
            spot bugs in update flows and license activations across the install base. No PII.
            No DayZ data, server names, mod lists, or player info — ever.
            {' '}
            <button
              type="button"
              onClick={() => setShowDetails((s) => !s)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                cursor: 'pointer',
                padding: 0,
                fontSize: 'inherit',
                textDecoration: 'underline',
              }}
            >
              {showDetails ? 'Hide details' : 'See exactly what we send'}
            </button>
          </p>

          {showDetails && (
            <div style={{
              marginTop: 12,
              padding: 12,
              background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>What we collect</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>A SHA-256 hash of this machine's Windows MachineGuid (so we can de-duplicate without seeing the raw id).</li>
                <li>The version of Citadel running.</li>
                <li>One of these event names — nothing else:
                  <code style={{ display: 'block', marginTop: 4, padding: '6px 8px', background: 'var(--bg-card)', borderRadius: 4, fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
                    {(state?.acceptedEvents || []).join(', ') || '—'}
                  </code>
                </li>
                <li>For each event, a tiny payload limited to a fixed allowlist (e.g. version numbers for update events, HTTP status codes for license-refresh failures).</li>
                <li>If you've signed in to Citadel Cloud, the events are linked to your account on our end. If you haven't, they're anonymous and identified only by the hash above.</li>
              </ul>
              {state?.lastFlushAt && (
                <div style={{ marginTop: 10, color: 'var(--text-muted)' }}>
                  Last sent: {new Date(state.lastFlushAt).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────

function InfoBox() {
  return (
    <div style={{
      background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
      border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
      borderRadius: 12,
      padding: 16,
      fontSize: 13,
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>How this works</div>
      Citadel ships as two products you can subscribe to independently:
      <ul style={{ margin: '8px 0 8px 20px', padding: 0 }}>
        <li><strong>Citadel</strong> — $14.99/mo. Required to use this app at all. Activating links
            this Windows installation to your account.</li>
        <li><strong>Citadel Cloud</strong> — $10/mo on top of Citadel. Optional add-on that unlocks
            cloud-only features (Global Ban Database; more coming). Includes a 7-day free trial.</li>
      </ul>
      The app re-verifies every few hours. If your Citadel subscription lapses, this machine enters a
      grace window then read-only. If only your Cloud subscription lapses, the local app keeps working
      and the cloud features pause.
      Manage subscriptions, devices, and billing at{' '}
      <a
        href="https://app.citadel-hub.com/account"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--accent)' }}
      >
        app.citadel-hub.com/account
      </a>
      , or learn more at{' '}
      <a
        href="https://citadel-hub.com/cloud"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--accent)' }}
      >
        citadel-hub.com/cloud
      </a>
      .
    </div>
  );
}
