import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';
import API from '../api';

const ServersContext = createContext(null);

export function ServersProvider({ children }) {
  const { user } = useAuth();
  const socket = useSocket();
  const [servers, setServers] = useState([]);

  const loadServers = useCallback(async () => {
    // Audit M11 — auth is cookie-based; we no longer gate on API.token
    // (which is always '' under cookie auth). Callers that fire this
    // while logged out are already protected by the `if (user)` guard
    // in the effect below; a stray call returns a 401 and the global
    // session-expired handler does the right thing.
    try {
      const data = await API.get('/api/servers');
      if (Array.isArray(data)) setServers(data);
    } catch {
      // Network blip or session expiry — leave existing list intact;
      // the next poll or socket event will reconcile.
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadServers();
      const i = setInterval(loadServers, 10000);
      return () => clearInterval(i);
    }
  }, [user, loadServers]);

  useEffect(() => {
    const handler = (data) => {
      setServers(svrs => svrs.map(s => s.id === data.serverId ? { ...s, status: data.status } : s));
    };
    socket.on('serverStatus', handler);
    return () => socket.off('serverStatus', handler);
  }, [socket]);

  return (
    <ServersContext.Provider value={{ servers, loadServers }}>
      {children}
    </ServersContext.Provider>
  );
}

export function useServers() {
  const ctx = useContext(ServersContext);
  if (!ctx) throw new Error('useServers must be used within ServersProvider');
  return ctx;
}
