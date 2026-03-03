import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

const MAX_VISIBLE = 5;
const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    // Mark as exiting for animation
    setToasts(t => t.map(x => x.id === id ? { ...x, exiting: true } : x));
    // Remove after exit animation
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id]);
        delete timersRef.current[id];
      }
    }, 200);
  }, []);

  const addToast = useCallback((msg, type = 'info', duration = DEFAULT_DURATION) => {
    const id = ++idRef.current;
    const createdAt = Date.now();
    setToasts(t => {
      const updated = [...t, { id, msg, type, createdAt, duration }];
      // Keep only MAX_VISIBLE visible — remove oldest beyond limit
      if (updated.filter(x => !x.exiting).length > MAX_VISIBLE) {
        const oldest = updated.find(x => !x.exiting);
        if (oldest) {
          oldest.exiting = true;
          setTimeout(() => setToasts(prev => prev.filter(x => x.id !== oldest.id)), 200);
        }
      }
      return updated;
    });
    timersRef.current[id] = setTimeout(() => removeToast(id), duration);
    return id;
  }, [removeToast]);

  // Backward-compat shim for components still using window.addToast
  window.addToast = addToast;

  return (
    <ToastContext.Provider value={{ addToast, removeToast, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx?.addToast;
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  return { toasts: ctx?.toasts || [], removeToast: ctx?.removeToast };
}
