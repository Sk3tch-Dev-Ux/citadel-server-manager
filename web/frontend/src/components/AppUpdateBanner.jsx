/**
 * AppUpdateBanner — shows a strip at the top of the app when the desktop
 * auto-updater has news.
 *
 * Subscribes to `window.citadel.updater` events (exposed by desktop/preload.js).
 * If `window.citadel` isn't present (user opened the web UI in a browser instead
 * of the Electron app), the banner renders nothing — updates only apply to
 * the packaged Electron installer.
 *
 * States:
 *   - checking    (subtle, transient)
 *   - available   (informational, we're auto-downloading)
 *   - downloading (progress bar)
 *   - downloaded  ("Restart to install" CTA)
 *   - error       (dismissible red warning)
 */
import { useEffect, useState } from 'react';
import { Download, RefreshCw, AlertTriangle, X, CheckCircle } from './Icon';

function fmtBytes(b) {
  if (!b || b < 1024) return `${b || 0} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function AppUpdateBanner() {
  const isDesktop = typeof window !== 'undefined' && !!window.citadel?.updater;
  const [state, setState] = useState({ phase: 'idle', version: null, progress: null, error: null });
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;

    const api = window.citadel.updater;

    // Pull initial state
    api.getStatus().then((s) => s && setState(s)).catch(() => {});

    const offChecking = api.onChecking(() => setState((s) => ({ ...s, phase: 'checking', error: null })));
    const offAvail = api.onUpdateAvailable((info) =>
      setState((s) => ({ ...s, phase: 'available', version: info?.version || s.version, error: null }))
    );
    const offNone = api.onNotAvailable(() =>
      setState((s) => ({ ...s, phase: 'not-available', error: null }))
    );
    const offProg = api.onProgress((p) =>
      setState((s) => ({ ...s, phase: 'downloading', progress: p }))
    );
    const offDone = api.onDownloaded((info) =>
      setState((s) => ({ ...s, phase: 'downloaded', version: info?.version || s.version, error: null }))
    );
    const offErr = api.onError((e) =>
      setState((s) => ({ ...s, phase: 'error', error: e?.message || 'Update failed' }))
    );

    return () => {
      offChecking?.();
      offAvail?.();
      offNone?.();
      offProg?.();
      offDone?.();
      offErr?.();
    };
  }, [isDesktop]);

  if (!isDesktop) return null;

  // Show nothing for idle / not-available / checking (too chatty otherwise)
  // plus honour the dismiss
  if (dismissed) return null;
  if (state.phase === 'idle' || state.phase === 'not-available' || state.phase === 'checking') return null;

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      await window.citadel.updater.install();
    } catch {
      setInstalling(false);
    }
  };

  // Derive visuals
  let variant = 'info';
  let icon = Download;
  let label = '';
  let showDismiss = false;
  let action = null;

  if (state.phase === 'available') {
    variant = 'info';
    icon = Download;
    label = `Update ${state.version ? `v${state.version} ` : ''}available — downloading in background…`;
  } else if (state.phase === 'downloading') {
    variant = 'info';
    icon = Download;
    const pct = state.progress?.percent || 0;
    const xfer = state.progress?.transferred || 0;
    const total = state.progress?.total || 0;
    label = `Downloading update${state.version ? ` v${state.version}` : ''} — ${pct}% (${fmtBytes(xfer)} / ${fmtBytes(total)})`;
  } else if (state.phase === 'downloaded') {
    variant = 'success';
    icon = CheckCircle;
    label = `Update ${state.version ? `v${state.version} ` : ''}ready to install.`;
    action = (
      <button
        className="btn btn-sm btn-primary"
        onClick={handleInstall}
        disabled={installing}
        style={{ marginLeft: 'auto' }}
      >
        <RefreshCw size={14} /> {installing ? 'Restarting…' : 'Restart & Install'}
      </button>
    );
  } else if (state.phase === 'error') {
    variant = 'danger';
    icon = AlertTriangle;
    label = `Update check failed: ${state.error || 'unknown error'}`;
    showDismiss = true;
  }

  const BG = {
    info: 'color-mix(in srgb, var(--accent) 12%, transparent)',
    success: 'color-mix(in srgb, #22c55e 12%, transparent)',
    danger: 'color-mix(in srgb, var(--danger) 12%, transparent)',
  }[variant];

  const BORDER = {
    info: 'color-mix(in srgb, var(--accent) 35%, transparent)',
    success: 'color-mix(in srgb, #22c55e 35%, transparent)',
    danger: 'color-mix(in srgb, var(--danger) 35%, transparent)',
  }[variant];

  const FG = {
    info: 'var(--accent)',
    success: '#22c55e',
    danger: 'var(--danger)',
  }[variant];

  const Icon = icon;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        background: BG,
        borderBottom: `1px solid ${BORDER}`,
        color: FG,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <Icon size={16} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {state.phase === 'downloading' && state.progress?.percent != null && (
        <div style={{
          width: 120,
          height: 4,
          background: 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.max(0, Math.min(100, state.progress.percent))}%`,
            height: '100%',
            background: FG,
            transition: 'width 200ms ease',
          }} />
        </div>
      )}
      {action}
      {showDismiss && (
        <button
          onClick={() => setDismissed(true)}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4 }}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
