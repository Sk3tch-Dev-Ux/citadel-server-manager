import { useToasts } from '../contexts/ToastContext';

export default function ToastContainer() {
  const toasts = useToasts();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          {t.type === 'success' ? '\u2705' : t.type === 'error' ? '\u274C' : '\u2139\uFE0F'} {t.msg}
        </div>
      ))}
    </div>
  );
}
