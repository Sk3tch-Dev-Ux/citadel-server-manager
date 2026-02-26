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
    if (!API.token) return;
    const data = await API.get('/api/servers');
    if (Array.isArray(data)) setServers(data);
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
