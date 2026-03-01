import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import API from '../api';
import { reconnectSocket, disconnectSocket } from '../socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });

  const login = useCallback((userData, token) => {
    API.token = token;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    reconnectSocket(token);
  }, []);

  const logout = useCallback(() => {
    API.token = '';
    localStorage.clear();
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
