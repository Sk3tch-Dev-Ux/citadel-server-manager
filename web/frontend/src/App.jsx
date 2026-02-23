import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useSocket } from './contexts/SocketContext';
import API from './api';
import ToastContainer from './components/ToastContainer';
import ErrorBoundary from './components/ErrorBoundary';
import NotificationCenter from './components/NotificationCenter';
import LoginScreen from './pages/LoginScreen';
import ServerHubPage from './pages/ServerHubPage';
import DeployPage from './pages/DeployPage';
import UsersPage from './pages/UsersPage';
import WebhooksPage from './pages/WebhooksPage';
import ServerOverviewPage from './pages/ServerOverviewPage';
import ServerMetricsPage from './pages/ServerMetricsPage';
import ConsolePage from './pages/ConsolePage';
import PlayersPage from './pages/PlayersPage';
import ModsPage from './pages/ModsPage/ModsPage';
import FilesPage from './pages/FilesPage';
import ConfigPage from './pages/ConfigPage';
import LogsPage from './pages/LogsPage';
import BansPage from './pages/BansPage';
import SchedulerPage from './pages/SchedulerPage';
import ServerSettingsPage from './pages/ServerSettingsPage';
export default function App() {
  const { user, logout } = useAuth();
  const socket = useSocket();
  const [page, setPage] = useState('hub');
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const [serverTab, setServerTab] = useState('overview');

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

  const selectServer = (id) => { setSelectedServer(id); setPage('server'); setServerTab('overview'); };

  const handleStart = async () => { if (!selectedServer) return; await API.post(`/api/servers/${selectedServer}/start`); window.addToast('Starting server...', 'info'); };
  const handleStop = async () => { if (!selectedServer) return; await API.post(`/api/servers/${selectedServer}/stop`); window.addToast('Stopping server...', 'info'); };
  const handleRestart = async () => { if (!selectedServer) return; await API.post(`/api/servers/${selectedServer}/restart`); window.addToast('Restarting server...', 'info'); };

  const currentServerStatus = useMemo(() => servers.find(s => s.id === selectedServer)?.status || 'stopped', [servers, selectedServer]);

  if (!user) return <><LoginScreen /><ToastContainer /></>;

  const navItems = page === 'server' ? [
    { id: 'overview', icon: '\uD83D\uDCCA', label: 'Overview' },
    { id: 'metrics', icon: '\uD83D\uDCC8', label: 'Metrics' },
    { id: 'console', icon: '\uD83D\uDDA5\uFE0F', label: 'Console' },
    { id: 'players', icon: '\uD83D\uDC65', label: 'Players' },
    { id: 'mods', icon: '\uD83D\uDCE6', label: 'Mods' },
    { id: 'files', icon: '\uD83D\uDCC1', label: 'Files' },
    { id: 'config', icon: '\u2699\uFE0F', label: 'Configuration' },
    { id: 'logs', icon: '\uD83D\uDCCB', label: 'Logs' },
    { id: 'bans', icon: '\uD83D\uDEE1\uFE0F', label: 'Bans' },
    { id: 'scheduler', icon: '\uD83D\uDCC5', label: 'Scheduler' },
    { id: 'settings', icon: '\uD83D\uDD27', label: 'Settings' },
  ] : [];

  const pageTitle = page === 'hub' ? 'Server Hub' : page === 'users' ? 'Users & Roles' : page === 'webhooks' ? 'Webhooks' : page === 'deploy' ? 'Deploy Server' : servers.find(s => s.id === selectedServer)?.name || 'Server';

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">DZ</div>
            <div><div className="logo-text">DayZ Panel</div><div className="logo-sub">Server Management</div></div>
          </div>
          {page === 'server' && servers.length > 0 && (
            <div className="server-selector">
              <select value={selectedServer || ''} onChange={e => selectServer(e.target.value)}>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="sidebar-nav">
          <div className="nav-section">General</div>
          <div className={`nav-item ${page === 'hub' ? 'active' : ''}`} onClick={() => { setPage('hub'); setSelectedServer(null); }}>
            <span className="nav-icon">{'\uD83C\uDFE0'}</span>Server Hub
            {servers.filter(s => s.status === 'running').length > 0 && <span className="nav-badge">{servers.filter(s => s.status === 'running').length}</span>}
          </div>
          <div className={`nav-item ${page === 'deploy' ? 'active' : ''}`} onClick={() => setPage('deploy')}>
            <span className="nav-icon">{'\uD83D\uDE80'}</span>Deploy Server
          </div>
          <div className={`nav-item ${page === 'users' ? 'active' : ''}`} onClick={() => setPage('users')}>
            <span className="nav-icon">{'\uD83D\uDC64'}</span>Users
          </div>
          <div className={`nav-item ${page === 'webhooks' ? 'active' : ''}`} onClick={() => setPage('webhooks')}>
            <span className="nav-icon">{'\uD83D\uDD17'}</span>Webhooks
          </div>

          {page === 'server' && (
            <>
              <div className="nav-section" style={{ marginTop: 12 }}>{servers.find(s => s.id === selectedServer)?.name || 'Server'}</div>
              {navItems.map(item => (
                <div key={item.id} className={`nav-item ${serverTab === item.id ? 'active' : ''}`} onClick={() => setServerTab(item.id)}>
                  <span className="nav-icon">{item.icon}</span>{item.label}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="avatar">{user.username?.[0]?.toUpperCase()}</div>
          <div className="user-info"><div className="user-name">{user.username}</div><div className="user-role">{user.role}</div></div>
          <button className="logout-btn" onClick={() => { API.token = ''; localStorage.clear(); logout(); }} title="Sign out">{'\u23FB'}</button>
        </div>
      </div>

      <div className="main">
        <div className="main-header">
          <div>
            <div className="main-title">{pageTitle}</div>
            {page === 'server' && <div className="main-subtitle">
              <span className={`status-badge status-${currentServerStatus}`} style={{ marginRight: 8 }}><span className="status-dot" />{currentServerStatus}</span>
              {serverTab}
            </div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationCenter />
            {page === 'server' && (
              <div className="btn-group">
                <button className="btn btn-primary btn-sm" onClick={handleStart} disabled={currentServerStatus === 'running' || currentServerStatus === 'starting'}>{'\u25B6'} Start</button>
                <button className="btn btn-danger btn-sm" onClick={handleStop} disabled={currentServerStatus === 'stopped'}>{'\u23F9'} Stop</button>
                <button className="btn btn-secondary btn-sm" onClick={handleRestart}>{'\uD83D\uDD04'} Restart</button>
              </div>
            )}
            {page === 'hub' && (
              <button className="btn btn-blue btn-sm" onClick={() => loadServers()}>{'\uD83D\uDD04'} Refresh</button>
            )}
          </div>
        </div>

        <div className="main-content">
          <ErrorBoundary>
            {page === 'hub' && <ServerHubPage servers={servers} onSelect={selectServer} />}
            {page === 'deploy' && <DeployPage onDeployed={loadServers} />}
            {page === 'users' && <UsersPage />}
            {page === 'webhooks' && <WebhooksPage />}
            {page === 'server' && selectedServer && (
              <ErrorBoundary>
                {serverTab === 'overview' && <ServerOverviewPage serverId={selectedServer} />}
                {serverTab === 'metrics' && <ServerMetricsPage serverId={selectedServer} />}
                {serverTab === 'console' && <ConsolePage serverId={selectedServer} />}
                {serverTab === 'players' && <PlayersPage serverId={selectedServer} />}
                {serverTab === 'mods' && <ModsPage serverId={selectedServer} />}
                {serverTab === 'files' && <FilesPage serverId={selectedServer} />}
                {serverTab === 'config' && <ConfigPage serverId={selectedServer} />}
                {serverTab === 'logs' && <LogsPage serverId={selectedServer} />}
                {serverTab === 'bans' && <BansPage serverId={selectedServer} />}
                {serverTab === 'scheduler' && <SchedulerPage serverId={selectedServer} />}
                {serverTab === 'settings' && <ServerSettingsPage serverId={selectedServer} />}
              </ErrorBoundary>
            )}
          </ErrorBoundary>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
