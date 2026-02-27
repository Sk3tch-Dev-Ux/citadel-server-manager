import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AppLayout from './layouts/AppLayout';
import ServerLayout from './layouts/ServerLayout';
import LoginScreen from './pages/LoginScreen';
import SetupWizardPage from './pages/SetupWizardPage';
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
import MessengerPage from './pages/MessengerPage';
import ServerSettingsPage from './pages/ServerSettingsPage';
import ToastContainer from './components/ToastContainer';
import API from './api';

function AuthGuard({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
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
          <div className="logo-icon" style={{ width: 48, height: 48, fontSize: 20, margin: '0 auto 16px' }}>DZ</div>
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
          <Route path="deploy" element={<DeployPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="webhooks" element={<WebhooksPage />} />
          <Route path="servers/:serverId" element={<ServerLayout />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<ServerPage Component={ServerOverviewPage} />} />
            <Route path="metrics" element={<ServerPage Component={ServerMetricsPage} />} />
            <Route path="console" element={<ServerPage Component={ConsolePage} />} />
            <Route path="players" element={<ServerPage Component={PlayersPage} />} />
            <Route path="mods" element={<ServerPage Component={ModsPage} />} />
            <Route path="files" element={<ServerPage Component={FilesPage} />} />
            <Route path="config" element={<ServerPage Component={ConfigPage} />} />
            <Route path="logs" element={<ServerPage Component={LogsPage} />} />
            <Route path="bans" element={<ServerPage Component={BansPage} />} />
            <Route path="scheduler" element={<ServerPage Component={SchedulerPage} />} />
            <Route path="messenger" element={<ServerPage Component={MessengerPage} />} />
            <Route path="settings" element={<ServerPage Component={ServerSettingsPage} />} />
          </Route>
          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}
