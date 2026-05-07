import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import API from '../api';
import { reconnectSocket, disconnectSocket } from '../socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });

  // Audit M11 — JWT now lives in an HttpOnly cookie (auth-token) set by
  // /api/auth/login. We no longer mirror it into localStorage, where any
  // DOM-XSS could read it. The user object stays in localStorage as
  // display state (username, role) so the UI doesn't flicker through
  // an unauthenticated render on first paint after a refresh.
  const login = useCallback((userData /* , token */) => {
    // The token argument is accepted but no longer stored. AuthContext
    // callers (LoginScreen, SetupWizard) still pass it; ignoring here
    // keeps their call sites unchanged. The backend already set the
    // auth-token cookie in the same response.
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    reconnectSocket();  // cookie carries the auth; no token to forward
  }, []);

  const logout = useCallback(async () => {
    // Tell the backend to clear the auth-token cookie. Best-effort —
    // even if the network call fails (offline, server restart) the
    // local state below still ends the session for this browser.
    try {
      await API.post('/api/auth/logout', {});
    } catch { /* offline or transient — not a blocker */ }
    API.token = '';
    localStorage.removeItem('user');
    setUser(null);
    disconnectSocket();
  }, []);

  // Listen for session-expired events from the API layer
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('citadel:session-expired', handler);
    return () => window.removeEventListener('citadel:session-expired', handler);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
