import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
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
          <Route index element={<ErrorBoundary><ServerHubPage /></ErrorBoundary>} />
          <Route path="dashboard" element={<ErrorBoundary><SystemDashboardPage /></ErrorBoundary>} />
          <Route path="deploy" element={<PermGuard permission="server.deploy"><ErrorBoundary><DeployPage /></ErrorBoundary></PermGuard>} />
          <Route path="users" element={<PermGuard permission="users.manage"><ErrorBoundary><UsersPage /></ErrorBoundary></PermGuard>} />
          <Route path="webhooks" element={<PermGuard permission="webhooks.manage"><ErrorBoundary><WebhooksPage /></ErrorBoundary></PermGuard>} />
          <Route path="settings" element={<PermGuard permission="license.manage"><ErrorBoundary><SettingsPage /></ErrorBoundary></PermGuard>} />
          <Route path="license" element={<PermGuard permission="license.manage"><ErrorBoundary><LicensePage /></ErrorBoundary></PermGuard>} />
          <Route path="servers/:serverId" element={<ServerLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<ErrorBoundary><ServerPage Component={ServerOverviewPage} /></ErrorBoundary>} />
            <Route path="metrics" element={<ErrorBoundary><ServerPage Component={ServerMetricsPage} /></ErrorBoundary>} />
            <Route path="console" element={<PermGuard permission="chat.send"><ErrorBoundary><ServerPage Component={ConsolePage} /></ErrorBoundary></PermGuard>} />
            <Route path="players" element={<ErrorBoundary><ServerPage Component={PlayersPage} /></ErrorBoundary>} />
            <Route path="mods" element={<ErrorBoundary><ServerPage Component={ModsPage} /></ErrorBoundary>} />
            <Route path="files" element={<PermGuard permission="files.manage"><ErrorBoundary><ServerPage Component={FilesPage} /></ErrorBoundary></PermGuard>} />
            <Route path="config" element={<PermGuard permission="config.manage"><ErrorBoundary><ServerPage Component={ConfigPage} /></ErrorBoundary></PermGuard>} />
            <Route path="logs" element={<ErrorBoundary><ServerPage Component={LogsPage} /></ErrorBoundary>} />
            <Route path="bans" element={<PermGuard permission="bans.manage"><ErrorBoundary><ServerPage Component={BansPage} /></ErrorBoundary></PermGuard>} />
            <Route path="scheduler" element={<PermGuard permission="scheduler.manage"><ErrorBoundary><ServerPage Component={SchedulerPage} /></ErrorBoundary></PermGuard>} />
            <Route path="messenger" element={<PermGuard permission="chat.send"><ErrorBoundary><ServerPage Component={MessengerPage} /></ErrorBoundary></PermGuard>} />
            <Route path="map" element={<ErrorBoundary><ServerPage Component={LiveMapPage} /></ErrorBoundary>} />
            <Route path="settings" element={<PermGuard permission="server.settings"><ErrorBoundary><ServerPage Component={ServerSettingsPage} /></ErrorBoundary></PermGuard>} />
            <Route path="dangerzone" element={<PermGuard permission="server.dangerzone"><ErrorBoundary><ServerPage Component={DangerzonePage} /></ErrorBoundary></PermGuard>} />
          </Route>
          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
