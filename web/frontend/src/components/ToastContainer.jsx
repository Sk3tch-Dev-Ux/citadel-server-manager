import { useState, useEffect } from 'react';
import { useToasts } from '../contexts/ToastContext';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from './Icon';

const ICON_MAP = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

function ToastItem({ toast, onDismiss }) {
  const [progress, setProgress] = useState(100);
  const Icon = ICON_MAP[toast.type] || Info;
  const duration = toast.duration || 5000;

  useEffect(() => {
    const startTime = toast.createdAt || Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [toast.createdAt, duration]);

  return (
    <div
      className={`toast ${toast.type} ${toast.exiting ? 'toast-exit' : ''}`}
      onClick={() => onDismiss(toast.id)}
      style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
    >
      <span className="toast-icon"><Icon size={16} /></span>
      <span style={{ flex: 1 }}>{toast.msg}</span>
      <button className="toast-dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}>
        <X size={14} />
      </button>
      <div className="toast-progress" style={{ width: `${progress}%` }} />
    </div>
  );
}

export default function ToastContainer() {
  const { toasts, removeToast } = useToasts();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
      ))}
    </div>
  );
}
