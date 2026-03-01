import { useMemo } from 'react';
import { Outlet, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import ToastContainer from '../components/ToastContainer';
import ErrorBoundary from '../components/ErrorBoundary';
import NotificationCenter from '../components/NotificationCenter';
import { Home, Rocket, Users, Webhook, Play, Square, RotateCcw, RefreshCw, LogOut } from '../components/Icon';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { servers, loadServers } = useServers();
  const location = useLocation();
  const navigate = useNavigate();

  // Determine if we're on a server page
  const serverMatch = location.pathname.match(/^\/servers\/([^/]+)/);
  const selectedServerId = serverMatch ? serverMatch[1] : null;
  const isServerPage = !!selectedServerId;

  const currentServer = useMemo(() => servers.find(s => s.id === selectedServerId), [servers, selectedServerId]);
  const currentServerStatus = currentServer?.status || 'stopped';

  const pageTitle = isServerPage
    ? currentServer?.name || 'Server'
    : location.pathname === '/deploy' ? 'Deploy Server'
    : location.pathname === '/users' ? 'Users & Roles'
    : location.pathname === '/webhooks' ? 'Webhooks'
    : 'Server Hub';

  // Determine which server sub-tab is active
  const serverTab = isServerPage
    ? location.pathname.split('/').pop() || 'overview'
    : null;

  const handleStart = async () => {
    if (!selectedServerId) return;
    await API.post(`/api/servers/${selectedServerId}/start`);
    window.addToast('Starting server...', 'info');
  };
  const handleStop = async () => {
    if (!selectedServerId) return;
    await API.post(`/api/servers/${selectedServerId}/stop`);
    window.addToast('Stopping server...', 'info');
  };
  const handleRestart = async () => {
    if (!selectedServerId) return;
    await API.post(`/api/servers/${selectedServerId}/restart`);
    window.addToast('Restarting server...', 'info');
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="logo-icon">C</div>
            <div><div className="logo-text">Citadel</div><div className="logo-sub">Server Management</div></div>
          </div>
          {isServerPage && servers.length > 0 && (
            <div className="server-selector">
              <select value={selectedServerId || ''} onChange={e => navigate(`/servers/${e.target.value}/overview`)}>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="sidebar-nav">
          <div className="nav-section">General</div>
          <Link to="/" className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
            <span className="nav-icon"><Home size={16} /></span>Server Hub
            {servers.filter(s => s.status === 'running').length > 0 && <span className="nav-badge">{servers.filter(s => s.status === 'running').length}</span>}
          </Link>
          <Link to="/deploy" className={`nav-item ${location.pathname === '/deploy' ? 'active' : ''}`}>
            <span className="nav-icon"><Rocket size={16} /></span>Deploy Server
          </Link>
          <Link to="/users" className={`nav-item ${location.pathname === '/users' ? 'active' : ''}`}>
            <span className="nav-icon"><Users size={16} /></span>Users
          </Link>
          <Link to="/webhooks" className={`nav-item ${location.pathname === '/webhooks' ? 'active' : ''}`}>
            <span className="nav-icon"><Webhook size={16} /></span>Webhooks
          </Link>

          {isServerPage && <ServerNav serverId={selectedServerId} serverName={currentServer?.name} activeTab={serverTab} />}
        </div>

        <div className="sidebar-footer">
          <div className="avatar">{user.username?.[0]?.toUpperCase()}</div>
          <div className="user-info"><div className="user-name">{user.username}</div><div className="user-role">{user.role}</div></div>
          <button className="logout-btn" onClick={() => { API.token = ''; localStorage.clear(); logout(); navigate('/login'); }} title="Sign out"><LogOut size={16} /></button>
        </div>
      </div>

      <div className="main">
        <div className="main-header">
          <div>
            <div className="main-title">{pageTitle}</div>
            {isServerPage && <div className="main-subtitle">
              <span className={`status-badge status-${currentServerStatus}`} style={{ marginRight: 8 }}><span className="status-dot" />{currentServerStatus}</span>
              {serverTab}
            </div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationCenter />
            {isServerPage && (
              <div className="btn-group">
                <button className="btn btn-primary btn-sm" onClick={handleStart} disabled={currentServerStatus === 'running' || currentServerStatus === 'starting'}><Play size={14} /> Start</button>
                <button className="btn btn-danger btn-sm" onClick={handleStop} disabled={currentServerStatus === 'stopped'}><Square size={14} /> Stop</button>
                <button className="btn btn-secondary btn-sm" onClick={handleRestart}><RotateCcw size={14} /> Restart</button>
              </div>
            )}
            {location.pathname === '/' && (
              <button className="btn btn-blue btn-sm" onClick={() => loadServers()}><RefreshCw size={14} /> Refresh</button>
            )}
          </div>
        </div>

        <div className="main-content">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}

// Server sub-navigation extracted as a sub-component
import { LayoutDashboard, BarChart3, Terminal, Package, FolderOpen, Settings, FileText, ShieldBan, Clock, Send, Wrench, AlertTriangle, Map } from '../components/Icon';

function ServerNav({ serverId, serverName, activeTab }) {
  const navItems = [
    { id: 'overview', icon: <LayoutDashboard size={16} />, label: 'Overview' },
    { id: 'map', icon: <Map size={16} />, label: 'Live Map' },
    { id: 'metrics', icon: <BarChart3 size={16} />, label: 'Metrics' },
    { id: 'console', icon: <Terminal size={16} />, label: 'Console' },
    { id: 'players', icon: <Users size={16} />, label: 'Players' },
    { id: 'mods', icon: <Package size={16} />, label: 'Mods' },
    { id: 'files', icon: <FolderOpen size={16} />, label: 'Files' },
    { id: 'config', icon: <Settings size={16} />, label: 'Configuration' },
    { id: 'logs', icon: <FileText size={16} />, label: 'Logs' },
    { id: 'bans', icon: <ShieldBan size={16} />, label: 'Bans' },
    { id: 'scheduler', icon: <Clock size={16} />, label: 'Scheduler' },
    { id: 'messenger', icon: <Send size={16} />, label: 'Messenger' },
    { id: 'settings', icon: <Wrench size={16} />, label: 'Settings' },
    { id: 'dangerzone', icon: <AlertTriangle size={16} />, label: 'Dangerzone' },
  ];

  return (
    <>
      <div className="nav-section" style={{ marginTop: 12 }}>{serverName || 'Server'}</div>
      {navItems.map(item => (
        <Link key={item.id} to={`/servers/${serverId}/${item.id}`} className={`nav-item ${activeTab === item.id ? 'active' : ''}`}>
          <span className="nav-icon">{item.icon}</span>{item.label}
        </Link>
      ))}
    </>
  );
}
