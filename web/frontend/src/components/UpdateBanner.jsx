import { useState, useEffect, useRef } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import { Download, Loader, AlertTriangle, CheckCircle, XCircle, X } from './Icon';

const STATE_CONFIG = {
  detected: {
    icon: AlertTriangle,
    label: (type, info) => `${type === 'mod' ? `Mod update detected (${info?.modName || 'unknown'})` : 'Game update detected'} — preparing...`,
    variant: 'detected',
  },
  countdown: {
    icon: Download,
    label: (type, info, countdown) => {
      const time = countdown >= 60
        ? `${Math.ceil(countdown / 60)}m ${countdown % 60}s`
        : `${countdown}s`;
      const what = type === 'mod' ? `Mod update (${info?.modName || 'unknown'})` : 'Game update';
      return `${what} — restarting in ${time}`;
    },
    variant: 'countdown',
  },
  stopping: {
    icon: Loader,
    label: () => 'Stopping server...',
    variant: 'stopping',
  },
  updating: {
    icon: Loader,
    label: (type, info) => type === 'mod'
      ? `Updating mod: ${info?.modName || 'unknown'}...`
      : 'Downloading game update...',
    variant: 'updating',
  },
  starting: {
    icon: Loader,
    label: () => 'Starting server...',
    variant: 'starting',
  },
};

function formatCountdown(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  return `0:${seconds.toString().padStart(2, '0')}`;
}

export default function UpdateBanner({ serverId }) {
  const socket = useSocket();
  const [update, setUpdate] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const totalDurationRef = useRef(0);

  // Fetch initial state on mount
  useEffect(() => {
    let mounted = true;
    API.get(`/api/servers/${serverId}/update/status`).then(data => {
      if (mounted && data && !data.error && data.state !== 'idle') {
        if (data.countdown > 0 && totalDurationRef.current === 0) {
          totalDurationRef.current = data.countdown;
        }
        setUpdate(data);
        setDismissed(false);
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [serverId]);

  // Listen for real-time update progress
  useEffect(() => {
    const handler = (data) => {
      if (data.serverId !== serverId) return;

      if (data.state === 'idle') {
        // Show brief success, then auto-dismiss
        setUpdate(prev => {
          if (prev && prev.state !== 'idle') {
            return { ...data, _completed: true };
          }
          return null;
        });
        return;
      }

      // Track total duration for progress bar on first countdown event
      if (data.state === 'countdown' && data.countdown > 0) {
        if (totalDurationRef.current === 0 || data.countdown > totalDurationRef.current) {
          totalDurationRef.current = data.countdown;
        }
      }

      setUpdate(data);
      setDismissed(false);
      setCancelling(false);
    };

    socket.on('updateProgress', handler);
    return () => socket.off('updateProgress', handler);
  }, [serverId, socket]);

  // Auto-dismiss completed state after 5s
  useEffect(() => {
    if (update?._completed) {
      const t = setTimeout(() => {
        setUpdate(null);
        totalDurationRef.current = 0;
      }, 5000);
      return () => clearTimeout(t);
    }
  }, [update?._completed]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const result = await API.post(`/api/servers/${serverId}/update/cancel`);
      if (result?.error) {
        window.addToast?.(result.error, 'error');
        setCancelling(false);
      }
    } catch {
      window.addToast?.('Failed to cancel update', 'error');
      setCancelling(false);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    setUpdate(null);
    totalDurationRef.current = 0;
  }

  // Nothing to show
  if (!update || dismissed) return null;

  // Completed state
  if (update._completed) {
    return (
      <div className="update-banner update-banner--complete">
        <CheckCircle size={18} className="update-banner__icon" />
        <span className="update-banner__text">Update complete — server is back online</span>
        <button className="update-banner__dismiss" onClick={handleDismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  // Error state
  if (update.error) {
    return (
      <div className="update-banner update-banner--error">
        <XCircle size={18} className="update-banner__icon" />
        <span className="update-banner__text">Update failed: {update.error}</span>
        <button className="update-banner__dismiss" onClick={handleDismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      </div>
    );
  }

  const config = STATE_CONFIG[update.state];
  if (!config) return null;

  const Icon = config.icon;
  const isSpinner = Icon === Loader;
  const canCancel = update.state === 'detected' || update.state === 'countdown';
  const progress = update.state === 'countdown' && totalDurationRef.current > 0
    ? Math.max(0, Math.min(1, 1 - (update.countdown / totalDurationRef.current)))
    : null;

  return (
    <div className={`update-banner update-banner--${config.variant}`}>
      <Icon size={18} className={`update-banner__icon ${isSpinner ? 'update-banner__spinner' : ''}`} />
      <div className="update-banner__body">
        <span className="update-banner__text">
          {config.label(update.updateType, update.updateInfo, update.countdown)}
        </span>
        {progress !== null && (
          <div className="update-banner__progress-track">
            <div className="update-banner__progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <div className="update-banner__actions">
        {update.state === 'countdown' && (
          <span className="update-banner__countdown">{formatCountdown(update.countdown)}</span>
        )}
        {canCancel && (
          <button
            className="btn btn-sm update-banner__cancel"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling...' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
