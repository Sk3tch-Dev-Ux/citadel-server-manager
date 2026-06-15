import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import Toggle from './ui/Toggle';
import { Cloud, CloudOff, Link as LinkIcon, AlertTriangle, Loader, ExternalLink, Trash2 } from './Icon';

/**
 * Citadel Cloud pairing card — per-DayZ-server pasting of the Server ID +
 * API key the operator generated at citadels.cc/account. Owned by the
 * Citadel Cloud Account page; this card just opens the WS by handing the
 * credentials to the backend's cloud-bridge supervisor.
 *
 * States:
 *   not-linked   → form (Server ID, API key, optional label) + "Pair"
 *   connected    → green status, last-seen time, "Unlink" button
 *   disconnected → amber status (running but WS dropped) + retry hint
 *   auth-failed  → red status + last error + "Replace credentials" CTA
 *   unknown      → just saved, supervisor hasn't reconciled yet (≤5s)
 */
const STATUS_POLL_MS = 5_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_MIN = 32;
const KEY_MAX = 256;

export default function CloudLinkCard({ serverId }) {
  const [link, setLink] = useState(null);          // null until first load; { lastStatus, ... } once known
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const [cloudServerId, setCloudServerId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await API.get(`/api/servers/${serverId}/cloud-link`);
      setLink(res?.link ?? null);
    } catch {
      // Surface as if unlinked — the routes return {link: null} on no-link
      setLink(null);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
    const t = setInterval(load, STATUS_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const handlePair = async (e) => {
    e?.preventDefault?.();
    setError(null);

    const sid = cloudServerId.trim();
    const key = apiKey.trim();
    if (!UUID_RE.test(sid)) { setError('Server ID must look like the UUID shown after creating the server on citadels.cc.'); return; }
    if (key.length < KEY_MIN || key.length > KEY_MAX) { setError(`API key looks wrong — expected ${KEY_MIN}-${KEY_MAX} characters.`); return; }

    setSubmitting(true);
    try {
      const res = await API.post(`/api/servers/${serverId}/cloud-link`, {
        cloudServerId: sid,
        apiKey: key,
        name: name.trim() || undefined,
      });
      if (res?.error) {
        setError(res.message || res.error);
      } else {
        setLink(res.link);
        setEditing(false);
        setCloudServerId(''); setApiKey(''); setName('');
        window.addToast?.('Citadel Cloud pairing saved — connecting…', 'success');
      }
    } catch (err) {
      setError(err.message || 'Pairing failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlink = async () => {
    if (!window.confirm('Unlink this server from Citadel Cloud?\n\nThe Agent will close the WS connection and forget the API key. The Cloud row stays — you can re-pair anytime with the same Server ID + key (rotate the key first if you suspect it leaked).')) return;
    try {
      await API.del(`/api/servers/${serverId}/cloud-link`);
      setLink(null);
      setEditing(false);
      window.addToast?.('Cloud pairing removed.', 'info');
    } catch (err) {
      window.addToast?.(`Unlink failed: ${err.message}`, 'error');
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ padding: 16, marginBottom: 16, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader size={14} className="spin" /> Loading Citadel Cloud status…
      </div>
    );
  }

  // ── No link yet, or operator chose to replace credentials ───────────
  if (!link || editing) {
    return (
      <PairingForm
        cloudServerId={cloudServerId}
        apiKey={apiKey}
        name={name}
        onChangeCloudServerId={setCloudServerId}
        onChangeApiKey={setApiKey}
        onChangeName={setName}
        onSubmit={handlePair}
        onCancel={editing ? () => setEditing(false) : null}
        submitting={submitting}
        error={error}
        isReplacing={!!editing && !!link}
      />
    );
  }

  // ── Linked: show status + actions ──────────────────────────────────
  return <LinkedView link={link} serverId={serverId} onReplace={() => setEditing(true)} onUnlink={handleUnlink} />;
}

// ─── Pairing form ──────────────────────────────────────────────────────

function PairingForm({
  cloudServerId, apiKey, name,
  onChangeCloudServerId, onChangeApiKey, onChangeName,
  onSubmit, onCancel, submitting, error, isReplacing,
}) {
  return (
    <form onSubmit={onSubmit} style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
      padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Cloud size={16} style={{ color: 'var(--accent)' }} />
        <strong>Citadel Cloud</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
          {isReplacing ? 'Replace credentials' : 'Not paired'}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        Pair this DayZ server with Citadel Cloud so it shows up in the live ops console. Get the Server ID + API key from{' '}
        <a href="https://citadels.cc/account" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
          citadels.cc/account → Plugin servers → Add server <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
        </a>.
      </div>

      <div className="input-group">
        <label className="input-label">Cloud Server ID</label>
        <input className="input" value={cloudServerId} onChange={(e) => onChangeCloudServerId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" />
      </div>

      <div className="input-group">
        <label className="input-label">API Key</label>
        <input className="input" type="password" value={apiKey} onChange={(e) => onChangeApiKey(e.target.value)} placeholder="Paste the key from the reveal modal" autoComplete="off" />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          The key is stored encrypted locally and never sent anywhere except citadels.cc.
        </div>
      </div>

      <div className="input-group">
        <label className="input-label">Label <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>(optional)</span></label>
        <input className="input" value={name} onChange={(e) => onChangeName(e.target.value)} placeholder="Same name you gave it on citadels.cc" maxLength={100} />
      </div>

      {error && (
        <div role="alert" style={{
          fontSize: 13, color: 'var(--danger)',
          background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          borderRadius: 6, padding: '8px 12px', marginBottom: 12, marginTop: 4,
        }}>
          <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {error}
        </div>
      )}

      <div className="btn-group" style={{ marginTop: 12, gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <><Loader size={14} className="spin" /> Pairing…</> : <><LinkIcon size={14} /> Pair</>}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
        )}
      </div>
    </form>
  );
}

// ─── Linked view ───────────────────────────────────────────────────────

function LinkedView({ link, serverId, onReplace, onUnlink }) {
  const status = link.lastStatus || 'unknown';
  const { icon, color, label } = statusVisuals(status);

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
      padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icon}
        <strong>Citadel Cloud</strong>
        <span style={{
          marginLeft: 'auto', fontSize: 11, padding: '2px 10px', borderRadius: 4,
          background: 'color-mix(in srgb, ' + color + ' 14%, transparent)', color,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
          {label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 13, marginBottom: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>Cloud Server ID</span>
        <code style={{ fontSize: 12 }}>{link.cloudServerId}</code>
        {link.name && (<>
          <span style={{ color: 'var(--text-muted)' }}>Label</span>
          <span>{link.name}</span>
        </>)}
        <span style={{ color: 'var(--text-muted)' }}>Linked</span>
        <span>{formatRelative(link.linkedAt)}</span>
        <span style={{ color: 'var(--text-muted)' }}>Last status</span>
        <span>{formatRelative(link.lastStatusAt)}</span>
        {link.lastError && (<>
          <span style={{ color: 'var(--text-muted)' }}>Last error</span>
          <span style={{ color: 'var(--danger)', fontSize: 12 }}>{link.lastError}</span>
        </>)}
      </div>

      {status === 'auth-failed' && (
        <div role="alert" style={{
          fontSize: 12,
          background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
          borderRadius: 6, padding: '8px 12px', marginBottom: 12, color: 'var(--text-primary)',
        }}>
          <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4, color: 'var(--danger)' }} />
          Cloud refused the API key. The key may have been rotated on citadels.cc — paste the new one to repair the link.
        </div>
      )}

      <PolicyControls serverId={serverId} policy={link.policy} />

      <div className="btn-group" style={{ gap: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={onReplace}>
          <LinkIcon size={14} /> Replace credentials
        </button>
        <button type="button" className="btn btn-danger" onClick={onUnlink} style={{ marginLeft: 'auto' }}>
          <Trash2 size={14} /> Unlink
        </button>
      </div>
    </div>
  );
}

// ─── Privacy & safety toggles ──────────────────────────────────────────
// Maps to PATCH /api/servers/:id/cloud-link/policy. Optimistic: flip the
// switch immediately, revert + toast on failure. The 5s status poll keeps
// these in sync if the policy changes elsewhere.

function PolicyControls({ serverId, policy }) {
  const [forwardPII, setForwardPII] = useState(policy?.forwardPlayerPII !== false);
  const [allowWipe, setAllowWipe] = useState(!!policy?.allowRemoteWipe);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!policy) return;
    setForwardPII(policy.forwardPlayerPII !== false);
    setAllowWipe(!!policy.allowRemoteWipe);
    // Sync on the primitive policy values, not the (always-new) object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy?.forwardPlayerPII, policy?.allowRemoteWipe]);

  const save = async (patch, apply, revert) => {
    apply();
    setSaving(true);
    try {
      const res = await API.patch(`/api/servers/${serverId}/cloud-link/policy`, patch);
      if (res?.error) throw new Error(res.message || res.error);
    } catch (err) {
      revert();
      window.addToast?.(`Couldn't update policy: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 12, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
        Privacy &amp; safety
      </div>

      <PolicyRow
        title="Forward player IP & GUID to Cloud"
        desc="Needed for Cloud VPN/Geo checks and cross-server identity. Turn off to keep player IPs on this machine — those Cloud features then simply skip."
        checked={forwardPII}
        disabled={saving}
        onChange={(v) => save({ forwardPlayerPII: v }, () => setForwardPII(v), () => setForwardPII(!v))}
      />
      <PolicyRow
        title="Allow remote world-wipe"
        desc="Let Cloud wipe AI / vehicles on this server. Off by default so a leaked Cloud key can't wipe your world. Restart and player moderation are always allowed."
        checked={allowWipe}
        disabled={saving}
        onChange={(v) => save({ allowRemoteWipe: v }, () => setAllowWipe(v), () => setAllowWipe(!v))}
      />
    </div>
  );
}

function PolicyRow({ title, desc, checked, disabled, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
      </div>
      <div style={{ paddingTop: 2 }}>
        <Toggle checked={checked} onChange={(v) => !disabled && onChange(v)} />
      </div>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function statusVisuals(status) {
  switch (status) {
    case 'connected':
      return { icon: <Cloud size={16} style={{ color: 'var(--success)' }} />, color: 'var(--success)', label: 'Connected' };
    case 'auth-failed':
      return { icon: <CloudOff size={16} style={{ color: 'var(--danger)' }} />, color: 'var(--danger)', label: 'Auth failed' };
    case 'disconnected':
      return { icon: <CloudOff size={16} style={{ color: 'var(--warning)' }} />, color: 'var(--warning)', label: 'Disconnected' };
    case 'unknown':
    default:
      return { icon: <Cloud size={16} style={{ color: 'var(--text-muted)' }} />, color: 'var(--text-muted)', label: 'Pending' };
  }
}

function formatRelative(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const ms = Date.now() - t;
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

