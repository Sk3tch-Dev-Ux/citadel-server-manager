import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import PageLoader from './components/PageLoader';
import AppLayout from './layouts/AppLayout';
import ServerLayout from './layouts/ServerLayout';
import LoginScreen from './pages/LoginScreen';
import SetupWizardPage from './pages/SetupWizardPage';
import ServerHubPage from './pages/ServerHubPage';
import SystemDashboardPage from './pages/SystemDashboardPage';
import ServerOverviewPage from './pages/ServerOverviewPage';
import PlayersPage from './pages/PlayersPage';
import ConsolePage from './pages/ConsolePage';
import LogsPage from './pages/LogsPage';
import BansPage from './pages/BansPage';
import ServerSettingsPage from './pages/ServerSettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import AccessDeniedPage from './pages/AccessDeniedPage';
import ToastContainer from './components/ToastContainer';
import API from './api';

// ── Lazy-loaded pages (heavy dependencies, not needed on initial load) ──
const DeployPage = lazy(() => import('./pages/DeployPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const WebhooksPage = lazy(() => import('./pages/WebhooksPage'));
const ServerMetricsPage = lazy(() => import('./pages/ServerMetricsPage'));
const ModsPage = lazy(() => import('./pages/ModsPage/ModsPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const ConfigPage = lazy(() => import('./pages/ConfigPage'));
const TypesEditorPage = lazy(() => import('./pages/TypesEditorPage'));
const DangerzonePage = lazy(() => import('./pages/DangerzonePage'));
const LicensePage = lazy(() => import('./pages/LicensePage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PriorityQueuePage = lazy(() => import('./pages/PriorityQueuePage'));
const StorePage = lazy(() => import('./pages/StorePage'));
const StoreManagementPage = lazy(() => import('./pages/StoreManagementPage'));
const CloudPage = lazy(() => import('./pages/CloudPage'));

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
    moderator: ['server.view','server.start','server.stop','server.restart','players.view','players.kick','mods.view','logs.view','metrics.view','chat.send','bans.manage','scheduler.manage','priority.manage'],
    viewer: ['server.view','players.view','mods.view','logs.view','metrics.view'],
  };
  const perms = rolePerms[user.role] || [];
  if (permission && !perms.includes(permission)) {
    return <AccessDeniedPage />;
  }
  return children;
}

// Wrapper that extracts serverId from URL params and passes as prop
function ServerPage({ Component }) {
  const { serverId } = useParams();
  return <Component serverId={serverId} />;
}

/** Suspense wrapper for lazy-loaded pages */
function Lazy({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
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
        <Route path="/store" element={<Lazy><StorePage /><ToastContainer /></Lazy>} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route index element={<ErrorBoundary><ServerHubPage /></ErrorBoundary>} />
          <Route path="dashboard" element={<ErrorBoundary><SystemDashboardPage /></ErrorBoundary>} />
          <Route path="deploy" element={<PermGuard permission="server.deploy"><ErrorBoundary><Lazy><DeployPage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="users" element={<PermGuard permission="users.manage"><ErrorBoundary><Lazy><UsersPage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="webhooks" element={<PermGuard permission="webhooks.manage"><ErrorBoundary><Lazy><WebhooksPage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="settings" element={<PermGuard permission="license.manage"><ErrorBoundary><Lazy><SettingsPage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="priority-queue" element={<PermGuard permission="priority.manage"><ErrorBoundary><Lazy><PriorityQueuePage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="store-management" element={<PermGuard permission="priority.manage"><ErrorBoundary><Lazy><StoreManagementPage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="license" element={<PermGuard permission="license.manage"><ErrorBoundary><Lazy><LicensePage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="cloud" element={<PermGuard permission="settings.manage"><ErrorBoundary><Lazy><CloudPage /></Lazy></ErrorBoundary></PermGuard>} />
          <Route path="servers/:serverId" element={<ServerLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<ErrorBoundary><ServerPage Component={ServerOverviewPage} /></ErrorBoundary>} />
            <Route path="metrics" element={<ErrorBoundary><Lazy><ServerPage Component={ServerMetricsPage} /></Lazy></ErrorBoundary>} />
            <Route path="console" element={<PermGuard permission="chat.send"><ErrorBoundary><ServerPage Component={ConsolePage} /></ErrorBoundary></PermGuard>} />
            <Route path="players" element={<ErrorBoundary><ServerPage Component={PlayersPage} /></ErrorBoundary>} />
            <Route path="mods" element={<ErrorBoundary><Lazy><ServerPage Component={ModsPage} /></Lazy></ErrorBoundary>} />
            <Route path="files" element={<PermGuard permission="files.manage"><ErrorBoundary><Lazy><ServerPage Component={FilesPage} /></Lazy></ErrorBoundary></PermGuard>} />
            <Route path="config" element={<PermGuard permission="config.manage"><ErrorBoundary><Lazy><ServerPage Component={ConfigPage} /></Lazy></ErrorBoundary></PermGuard>} />
            <Route path="types" element={<PermGuard permission="files.manage"><ErrorBoundary><Lazy><ServerPage Component={TypesEditorPage} /></Lazy></ErrorBoundary></PermGuard>} />
            <Route path="logs" element={<ErrorBoundary><ServerPage Component={LogsPage} /></ErrorBoundary>} />
            <Route path="bans" element={<PermGuard permission="bans.manage"><ErrorBoundary><ServerPage Component={BansPage} /></ErrorBoundary></PermGuard>} />
            <Route path="settings" element={<PermGuard permission="server.settings"><ErrorBoundary><ServerPage Component={ServerSettingsPage} /></ErrorBoundary></PermGuard>} />
            <Route path="dangerzone" element={<PermGuard permission="server.dangerzone"><ErrorBoundary><Lazy><ServerPage Component={DangerzonePage} /></Lazy></ErrorBoundary></PermGuard>} />
          </Route>
          {/* Catch-all — unknown routes */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
