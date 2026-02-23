import { useToasts } from '../contexts/ToastContext';
import { CheckCircle, XCircle, Info } from './Icon';

export default function ToastContainer() {
  const toasts = useToasts();
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span className="toast-icon">
            {t.type === 'success' ? <CheckCircle size={16} /> : t.type === 'error' ? <XCircle size={16} /> : <Info size={16} />}
          </span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
