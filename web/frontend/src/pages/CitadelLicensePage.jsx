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
} from '../components/Icon';

/**
 * Citadel subscription management page — where the server admin signs
 * this installation in to their citadels.cc account to activate the
 * license that gates this Citadel copy.
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
        setError(res.message || res.error);
      } else {
        setEmail('');
        setPassword('');
        setName('');
        await loadStatus();
        window.addToast?.('Citadel activated — subscription is now active on this machine.', 'success');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setActivating(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await API.post('/api/citadel-license/refresh', {});
      await loadStatus();
      window.addToast?.('License refreshed.', 'success');
    } catch (err) {
      window.addToast?.(`Refresh failed: ${err.message}`, 'error');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm('Deactivate Citadel on this machine?\n\nThis frees up one of your two device slots. The app will stop working until you activate again.')) return;
    setDeactivating(true);
    try {
      await API.del('/api/citadel-license/deactivate');
      await loadStatus();
      window.addToast?.('Citadel deactivated on this machine.', 'info');
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
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Citadel Subscription</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--text-muted)' }}>
            Link this installation to your citadels.cc account.
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
        {needsActivation ? 'Activate Citadel' : 'Re-activate Citadel'}
      </h2>
      <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
        Enter your <strong>citadels.cc</strong> email and password. This machine will take one of your two activated device slots.
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
          Shown in your citadels.cc device list so you can tell machines apart.
        </span>
      </label>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--danger)',
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={activating}
          style={{ minWidth: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {activating ? <><Loader size={14} className="spin" /> Activating…</> : 'Activate'}
        </button>
        <a
          href="https://citadels.cc/account"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          Manage devices on citadels.cc →
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
        Deactivate to free the slot on your account. You can always re-activate with the same credentials.
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
      Your citadels.cc subscription unlocks up to <strong>2 devices</strong>. Activating links this specific
      Windows installation to your account. The app re-verifies every few hours; if your subscription lapses
      or a payment fails, you'll see a warning here and Citadel will enter read-only mode after the offline
      grace window. You can manage devices, change your plan, or update billing at{' '}
      <a
        href="https://citadels.cc/account"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--accent)' }}
      >
        citadels.cc/account
      </a>.
    </div>
  );
}
