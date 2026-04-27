/**
 * CitadelUpdateBanner — Notifies users when a new Citadel version is available.
 *
 * This is the web UI counterpart to AppUpdateBanner (which handles Electron
 * desktop auto-updates). This banner covers the majority case: users who
 * access Citadel through a browser pointed at their server's port 3001.
 *
 * Flow:
 *   1. Fetches /api/updates/status on mount
 *   2. Listens for 'citadelUpdate' Socket.IO events for real-time pushes
 *   3. Shows a banner when status === 'update_available'
 *   4. Dismiss hides the banner via POST /api/updates/dismiss
 *
 * Does NOT show if:
 *   - Running inside the Electron wrapper (AppUpdateBanner handles that)
 *   - No update available
 *   - User dismissed it (until a newer version is released)
 */
import { useEffect, useState, useCallback } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { Sparkles, Download, X } from './Icon';

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export default function CitadelUpdateBanner() {
  // Skip if running inside Electron — AppUpdateBanner handles desktop updates
  const isDesktop = typeof window !== 'undefined' && !!window.citadel?.updater;
  const socket = useSocket();
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Fetch initial state
  useEffect(() => {
    if (isDesktop) return;
    let cancelled = false;
    API.get('/api/updates/status')
      .then(data => { if (!cancelled) setState(data); })
      .catch(() => {}); // Silently ignore — update check is non-critical
    return () => { cancelled = true; };
  }, [isDesktop]);

  // Listen for real-time Socket.IO pushes
  useEffect(() => {
    if (isDesktop || !socket) return;
    const handler = (data) => {
      setState(data);
      // If a new version appears (different from what was dismissed), show again
      if (data.status === 'update_available' && !data.dismissed) {
        setDismissed(false);
      }
    };
    socket.on('citadelUpdate', handler);
    return () => { socket.off('citadelUpdate', handler); };
  }, [socket, isDesktop]);

  const handleDismiss = useCallback(async () => {
    setDismissed(true);
    try {
      await API.post('/api/updates/dismiss');
    } catch {
      // Non-critical — banner stays hidden locally regardless
    }
  }, []);

  // Don't render in Electron, when no data, when current, or when dismissed
  if (isDesktop) return null;
  if (!state || state.status !== 'update_available') return null;
  if (dismissed || state.dismissed) return null;

  const sizeStr = state.size ? ` (${fmtSize(state.size)})` : '';
  const downloadHref = state.downloadUrl || 'https://api.citadels.cc/downloads/installer';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        color: 'var(--accent)',
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <Sparkles size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Citadel <strong>v{state.latestVersion}</strong> is available — you're running v{state.currentVersion}
      </span>
      <a
        href={downloadHref}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          background: 'var(--accent)',
          color: 'white',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        <Download size={13} />
        Download{sizeStr}
      </a>
      <button
        onClick={handleDismiss}
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 4, flexShrink: 0 }}
        title="Dismiss"
        aria-label="Dismiss update notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}
