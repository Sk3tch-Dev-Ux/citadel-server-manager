import { useMemo, useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useServers } from '../contexts/ServersContext';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import API from '../api';
import ToastContainer from '../components/ToastContainer';
import ErrorBoundary from '../components/ErrorBoundary';
import NotificationCenter from '../components/NotificationCenter';
import { Home, Rocket, Users, Webhook, Play, Square, RotateCcw, RefreshCw, LogOut, Monitor, Gauge, Settings, Menu, X, Crown } from '../components/Icon';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { servers, loadServers } = useServers();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation (mobile)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

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
    : location.pathname === '/priority-queue' ? 'Priority Queue'
    : location.pathname === '/settings' ? 'Settings'
    : location.pathname === '/dashboard' ? 'Dashboard'
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

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    'ctrl+shift+r': () => { if (selectedServerId) handleRestart(); },
    'escape': () => {
      // Close any open Radix modals by dispatching Escape
      // (Radix handles this natively, but this ensures it propagates)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    },
  });

  return (
    <div className="app">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-logo" style={{ textDecoration: 'none', color: 'inherit' }}>
            <img src="/citadel-logo.svg" alt="Citadel" style={{ width: 38, height: 38 }} />
            <div><div className="logo-text">Citadel</div><div className="logo-sub">All-In-One DayZ Tool</div></div>
          </Link>
        </div>

        <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
          {/* System Section */}
          <div className="nav-section">System</div>
          <Link to="/dashboard" className={`nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}>
            <span className="nav-icon"><Gauge size={16} /></span>Dashboard
          </Link>
          <Link to="/users" className={`nav-item ${location.pathname === '/users' ? 'active' : ''}`}>
            <span className="nav-icon"><Users size={16} /></span>Users
          </Link>
          <Link to="/webhooks" className={`nav-item ${location.pathname === '/webhooks' ? 'active' : ''}`}>
            <span className="nav-icon"><Webhook size={16} /></span>Webhooks
          </Link>
          <Link to="/priority-queue" className={`nav-item ${location.pathname === '/priority-queue' ? 'active' : ''}`}>
            <span className="nav-icon"><Crown size={16} /></span>Priority Queue
          </Link>
          {user.role === 'admin' && (
            <Link to="/settings" className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`}>
              <span className="nav-icon"><Settings size={16} /></span>Settings
            </Link>
          )}

          {/* Deploy */}
          <Link to="/deploy" className={`nav-item ${location.pathname === '/deploy' ? 'active' : ''}`}>
            <span className="nav-icon"><Rocket size={16} /></span>Deploy Server
          </Link>

          {/* Servers Section */}
          <div className="nav-section" style={{ marginTop: 8 }}>Servers</div>
          {servers.length === 0 ? (
            <div className="nav-empty">No servers configured</div>
          ) : (
            servers.map(srv => (
              <Link
                key={srv.id}
                to={`/servers/${srv.id}/overview`}
                className={`nav-item nav-server-item ${selectedServerId === srv.id ? 'active' : ''}`}
              >
                <span className={`nav-server-dot status-${srv.status || 'stopped'}`} />
                <span className="nav-server-name">{srv.name}</span>
              </Link>
            ))
          )}

          {/* Server sub-navigation when on a server page */}
          {isServerPage && <ServerNav serverId={selectedServerId} serverName={currentServer?.name} activeTab={serverTab} />}
        </nav>

        <div className="sidebar-footer">
          <div className="avatar">{user.username?.[0]?.toUpperCase()}</div>
          <div className="user-info"><div className="user-name">{user.username}</div><div className="user-role">{user.role}</div></div>
          <button className="logout-btn" onClick={() => { API.token = ''; localStorage.clear(); logout(); navigate('/login'); }} title="Sign out"><LogOut size={16} /></button>
        </div>
      </div>

      <div className="main" role="main">
        {/* Server status bar — shown on server pages */}
        {isServerPage && currentServer && (
          <div className="server-status-bar" aria-label="Server status">
            <div className="status-bar-metrics">
              <span className={`status-bar-chip ${(currentServer.cpu || 0) > 70 ? 'warning' : ''}`}>CPU: {(currentServer.cpu || 0).toFixed(1)}%</span>
              <span className={`status-bar-chip ${(currentServer.ram || 0) > 70 ? 'warning' : ''}`}>RAM: {(currentServer.ram || 0).toFixed(1)}%</span>
              <span className="status-bar-chip">Players: {currentServer.playerCount || 0}/{currentServer.maxPlayers || 60}</span>
            </div>
          </div>
        )}

        <div className="main-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle navigation"><Menu size={20} /></button>
            <div className="main-title">{pageTitle}</div>
            {isServerPage && <div className="main-subtitle">
              <span className={`status-badge status-${currentServerStatus}`} style={{ marginRight: 8 }}><span className="status-dot" />{currentServerStatus}</span>
              DayZ, PC
            </div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NotificationCenter />
            {isServerPage && (
              <div className="btn-group">
                <button className="btn btn-primary btn-sm" onClick={handleStart} disabled={currentServerStatus === 'running' || currentServerStatus === 'starting'}><Play size={14} /> Start</button>
                <button className="btn btn-danger btn-sm" onClick={handleStop} disabled={currentServerStatus === 'stopped'}><Square size={14} /> Stop</button>
                <button className="btn btn-secondary btn-sm" onClick={handleRestart} title="Restart server (Ctrl+Shift+R)"><RotateCcw size={14} /> Restart</button>
              </div>
            )}
            {(location.pathname === '/' || location.pathname === '/dashboard') && (
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
import { LayoutDashboard, BarChart3, Terminal, Package, FolderOpen, FileText, FileCode, ShieldBan, Wrench, AlertTriangle, Zap, Globe, Layers, MapPin, Filter, Puzzle, ShoppingCart, Eye, Clock, Star } from '../components/Icon';

function ServerNav({ serverId, serverName, activeTab }) {
  const serverItems = [
    { id: 'overview', icon: <LayoutDashboard size={16} />, label: 'Overview' },
    { id: 'metrics', icon: <BarChart3 size={16} />, label: 'Metrics' },
    { id: 'console', icon: <Terminal size={16} />, label: 'Console' },
    { id: 'players', icon: <Users size={16} />, label: 'Players' },
    { id: 'logs', icon: <FileText size={16} />, label: 'Logs' },
    { id: 'bans', icon: <ShieldBan size={16} />, label: 'Bans' },
    { id: 'scheduler', icon: <Clock size={16} />, label: 'Restart Scheduler' },
  ];

  const economyItems = [
    { id: 'economy', icon: <BarChart3 size={16} />, label: 'Economy Hub' },
    { id: 'types', icon: <FileCode size={16} />, label: 'Types' },
    { id: 'events', icon: <Zap size={16} />, label: 'Events' },
    { id: 'globals', icon: <Globe size={16} />, label: 'Globals' },
    { id: 'spawnabletypes', icon: <Layers size={16} />, label: 'Spawnable Types' },
    { id: 'spawnpoints', icon: <MapPin size={16} />, label: 'Spawn Points' },
    { id: 'limits', icon: <Filter size={16} />, label: 'Limits Def' },
    { id: 'economycore', icon: <FolderOpen size={16} />, label: 'Economy Core' },
    { id: 'loot-visualizer', icon: <Eye size={16} />, label: 'Loot Visualizer' },
  ];

  const modConfigItems = [
    { id: 'mod-configs', icon: <Puzzle size={16} />, label: 'Mod Configs' },
    { id: 'expansion', icon: <Puzzle size={16} />, label: 'Expansion' },
    { id: 'trader-editor', icon: <ShoppingCart size={16} />, label: 'Trader Editor' },
    { id: 'quest-creator', icon: <Star size={16} />, label: 'Quest Creator' },
  ];

  const configItems = [
    { id: 'config', icon: <Settings size={16} />, label: 'serverDZ.cfg' },
    { id: 'files', icon: <FolderOpen size={16} />, label: 'Files' },
    { id: 'mods', icon: <Package size={16} />, label: 'Mods' },
    { id: 'settings', icon: <Wrench size={16} />, label: 'Settings' },
    { id: 'dangerzone', icon: <AlertTriangle size={16} />, label: 'Dangerzone' },
  ];

  const renderNavGroup = (items) => items.map(item => (
    <Link key={item.id} to={`/servers/${serverId}/${item.id}`} className={`nav-item ${activeTab === item.id ? 'active' : ''}`}>
      <span className="nav-icon">{item.icon}</span>{item.label}
    </Link>
  ));

  return (
    <div role="navigation" aria-label={`${serverName || 'Server'} navigation`}>
      <div className="nav-divider" />
      <div className="nav-section" style={{ fontSize: 10, marginTop: 4 }}>Server</div>
      {renderNavGroup(serverItems)}
      <div className="nav-section" style={{ fontSize: 10, marginTop: 8 }}>Economy Editors</div>
      {renderNavGroup(economyItems)}
      <div className="nav-section" style={{ fontSize: 10, marginTop: 8 }}>Mod Configs</div>
      {renderNavGroup(modConfigItems)}
      <div className="nav-section" style={{ fontSize: 10, marginTop: 8 }}>Configuration</div>
      {renderNavGroup(configItems)}
    </div>
  );
}
