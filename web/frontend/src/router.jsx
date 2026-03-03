import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AppLayout from './layouts/AppLayout';
import ServerLayout from './layouts/ServerLayout';
import LoginScreen from './pages/LoginScreen';
import SetupWizardPage from './pages/SetupWizardPage';
import ServerHubPage from './pages/ServerHubPage';
import SystemDashboardPage from './pages/SystemDashboardPage';
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
import MessengerPage from './pages/MessengerPage';
import ServerSettingsPage from './pages/ServerSettingsPage';
import DangerzonePage from './pages/DangerzonePage';
import LiveMapPage from './pages/LiveMapPage';
import LicensePage from './pages/LicensePage';
import SettingsPage from './pages/SettingsPage';
import ToastContainer from './components/ToastContainer';
import API from './api';

function AuthGuard({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/**
 * Permission-based route guard.
 * Falls back to ServerHub if user lacks the required permission.
 */
function PermGuard({ permission, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // Admin role always has access
  if (user.role === 'admin') return children;
  // Map roles to allowed permissions (matches backend role definitions)
  const rolePerms = {
    moderator: ['server.view','server.start','server.stop','server.restart','players.view','players.kick','mods.view','logs.view','metrics.view','chat.send','bans.manage','scheduler.manage'],
    viewer: ['server.view','players.view','mods.view','logs.view','metrics.view'],
  };
  const perms = rolePerms[user.role] || [];
  if (permission && !perms.includes(permission)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

// Wrapper that extracts serverId from URL params and passes as prop
function ServerPage({ Component }) {
  const { serverId } = useParams();
  return <Component serverId={serverId} />;
}

/**
 * Smart entry point that checks if setup is needed.
 * If the panel has never been configured, redirects to the setup wizard.
 */
function SmartLogin() {
  const { user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    API.get('/api/setup/status').then(data => {
      if (cancelled) return;
      if (data && data.needsSetup) {
        setNeedsSetup(true);
      }
      setChecking(false);
    }).catch(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, []);

  if (user) return <Navigate to="/" replace />;
  if (checking) {
    return (
      <div className="login-screen">
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <img src="/citadel-logo.svg" alt="Citadel" style={{ width: 48, height: 48, margin: '0 auto 16px' }} />
          Loading...
        </div>
      </div>
    );
  }
  if (needsSetup) return <Navigate to="/setup" replace />;
  return <><LoginScreen /><ToastContainer /></>;
}

export default function AppRouter() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<SmartLogin />} />
        <Route path="/setup" element={<><SetupWizardPage /><ToastContainer /></>} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route index element={<ServerHubPage />} />
          <Route path="dashboard" element={<SystemDashboardPage />} />
          <Route path="deploy" element={<PermGuard permission="server.deploy"><DeployPage /></PermGuard>} />
          <Route path="users" element={<PermGuard permission="users.manage"><UsersPage /></PermGuard>} />
          <Route path="webhooks" element={<PermGuard permission="webhooks.manage"><WebhooksPage /></PermGuard>} />
          <Route path="settings" element={<PermGuard permission="license.manage"><SettingsPage /></PermGuard>} />
          <Route path="license" element={<PermGuard permission="license.manage"><LicensePage /></PermGuard>} />
          <Route path="servers/:serverId" element={<ServerLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<ServerPage Component={ServerOverviewPage} />} />
            <Route path="metrics" element={<ServerPage Component={ServerMetricsPage} />} />
            <Route path="console" element={<PermGuard permission="chat.send"><ServerPage Component={ConsolePage} /></PermGuard>} />
            <Route path="players" element={<ServerPage Component={PlayersPage} />} />
            <Route path="mods" element={<ServerPage Component={ModsPage} />} />
            <Route path="files" element={<PermGuard permission="files.manage"><ServerPage Component={FilesPage} /></PermGuard>} />
            <Route path="config" element={<PermGuard permission="config.manage"><ServerPage Component={ConfigPage} /></PermGuard>} />
            <Route path="logs" element={<ServerPage Component={LogsPage} />} />
            <Route path="bans" element={<PermGuard permission="bans.manage"><ServerPage Component={BansPage} /></PermGuard>} />
            <Route path="scheduler" element={<PermGuard permission="scheduler.manage"><ServerPage Component={SchedulerPage} /></PermGuard>} />
            <Route path="messenger" element={<PermGuard permission="chat.send"><ServerPage Component={MessengerPage} /></PermGuard>} />
            <Route path="map" element={<ServerPage Component={LiveMapPage} />} />
            <Route path="settings" element={<PermGuard permission="server.settings"><ServerPage Component={ServerSettingsPage} /></PermGuard>} />
            <Route path="dangerzone" element={<PermGuard permission="server.dangerzone"><ServerPage Component={DangerzonePage} /></PermGuard>} />
          </Route>
          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
