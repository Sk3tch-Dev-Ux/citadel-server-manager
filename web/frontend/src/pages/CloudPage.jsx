import { useState, useEffect } from 'react';
import { useServers } from '../contexts/ServersContext';
import { useAuth } from '../contexts/AuthContext';
import API from '../api';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Globe, Wifi, WifiOff, Unlink, Server, ArrowUpRight,
  RefreshCw, Power, Check, AlertTriangle, KeyRound,
} from '../components/Icon';

export default function CloudPage() {
  const { confirm: confirmDialog, DialogComponent } = useConfirmDialog();
  const { servers } = useServers();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [cloudStatus, setCloudStatus] = useState(null);
  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [connectDialog, setConnectDialog] = useState(null); // { serverId, serverName }
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [connecting, setConnecting] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [status, lic] = await Promise.all([
        API.get('/api/cloud/status'),
        API.get('/api/license'),
      ]);
      if (status && !status.error) setCloudStatus(status);
      if (lic && !lic.error) setLicense(lic);
    } catch {
      window.addToast?.('Failed to load cloud status', 'error');
    }
    setLoading(false);
  }

  async function handleToggleCloud() {
    const action = cloudStatus?.enabled ? 'disable' : 'enable';
    if (action === 'disable') {
      if (!await confirmDialog({ title: 'Disable Cloud', message: 'This will disconnect all servers from Citadel Cloud. Continue?', confirmLabel: 'Disable', variant: 'danger' })) return;
    }
    setToggling(true);
    try {
      await API.post(`/api/cloud/${action}`);
      window.addToast?.(`Cloud integration ${action}d`, 'success');
      loadData();
    } catch {
      window.addToast?.(`Failed to ${action} cloud`, 'error');
    }
    setToggling(false);
  }

  async function handleConnect(serverId) {
    if (!apiKeyInput.trim()) return;
    setConnecting(true);
    try {
      const result = await API.post(`/api/cloud/connect/${serverId}`, { apiKey: apiKeyInput.trim() });
      if (result?.ok) {
        window.addToast?.('Server connected to Citadel Cloud', 'success');
        setConnectDialog(null);
        setApiKeyInput('');
        loadData();
      } else {
        window.addToast?.(result?.error || 'Connection failed', 'error');
      }
    } catch {
      window.addToast?.('Failed to connect', 'error');
    }
    setConnecting(false);
  }

  async function handleDisconnect(serverId) {
    if (!await confirmDialog({ title: 'Disconnect Server', message: 'Remove this server from Citadel Cloud?', confirmLabel: 'Disconnect', variant: 'danger' })) return;
    try {
      await API.post(`/api/cloud/disconnect/${serverId}`);
      window.addToast?.('Server disconnected', 'info');
      loadData();
    } catch {
      window.addToast?.('Failed to disconnect', 'error');
    }
  }

  async function handleReconnect(serverId) {
    try {
      await API.post(`/api/cloud/reconnect/${serverId}`);
      window.addToast?.('Reconnecting...', 'info');
      setTimeout(loadData, 2000);
    } catch {
      window.addToast?.('Failed to reconnect', 'error');
    }
  }

  if (loading) return <div className="cloud-loading">Loading cloud status...</div>;

  const isEnabled = cloudStatus?.enabled;
  const connections = cloudStatus?.connections || {};
  const tierName = license?.tier ? license.tier.charAt(0).toUpperCase() + license.tier.slice(1) : 'Free';

  return (
    <div className="cloud-page">

      {/* Hero Section */}
      <div className={`cloud-hero ${isEnabled ? 'enabled' : 'disabled'}`}>
        <div className="cloud-hero-content">
          <div className={`cloud-icon-ring ${isEnabled ? 'active' : ''}`}>
            <Globe size={28} />
          </div>
          <div className="cloud-hero-text">
            <div className={`cloud-status-badge ${isEnabled ? 'connected' : 'offline'}`}>
              {isEnabled ? 'Connected' : 'Offline'}
            </div>
            <h2 className="cloud-hero-title">Citadel Cloud</h2>
            <p className="cloud-hero-desc">
              {isEnabled
                ? `Connected to Citadel Cloud. Manage your servers remotely from anywhere.`
                : 'Connect your servers to Citadel Cloud for remote management, shared ban lists, and more.'}
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="cloud-hero-actions">
            <button
              className={`btn ${isEnabled ? 'btn-danger' : 'btn-primary'} btn-sm`}
              onClick={handleToggleCloud}
              disabled={toggling}
            >
              <Power size={14} />
              {toggling ? 'Processing...' : isEnabled ? 'Disable Cloud' : 'Enable Cloud'}
            </button>
          </div>
        )}

        <div className="cloud-details-row">
          <div className="cloud-detail">
            <Wifi size={14} />
            <span>Relay: {cloudStatus?.relayUrl || 'Not configured'}</span>
          </div>
          <div className="cloud-detail">
            <Server size={14} />
            <span>Tier: {tierName}</span>
          </div>
        </div>
      </div>

      {/* Server Connections */}
      {isEnabled && (
        <div className="cloud-servers-card">
          <div className="cloud-card-header">
            <div className="cloud-card-header-text">
              <h3>Server Connections</h3>
              <p>Connect your local servers to Citadel Cloud for remote access.</p>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={loadData}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {servers.length === 0 ? (
            <div className="cloud-empty">No servers configured. Deploy a server first.</div>
          ) : (
            <div className="cloud-server-list">
              {servers.map(srv => {
                const conn = connections[srv.id];
                const status = conn?.status || 'disconnected';
                const hasKey = !!srv.cloudApiKey;

                return (
                  <div key={srv.id} className={`cloud-server-item ${status}`}>
                    <div className="cloud-server-info">
                      <span className={`cloud-server-dot status-${status}`} />
                      <div>
                        <div className="cloud-server-name">{srv.name}</div>
                        <div className="cloud-server-status">
                          {status === 'connected' && 'Connected to Cloud'}
                          {status === 'connecting' && 'Connecting...'}
                          {status === 'auth-failed' && 'Authentication failed'}
                          {status === 'disconnected' && (hasKey ? 'Disconnected' : 'Not connected')}
                        </div>
                      </div>
                    </div>
                    <div className="cloud-server-actions">
                      {!hasKey && (
                        <button className="btn btn-primary btn-sm" onClick={() => { setConnectDialog({ serverId: srv.id, serverName: srv.name }); setApiKeyInput(''); }}>
                          <KeyRound size={14} /> Connect
                        </button>
                      )}
                      {hasKey && status !== 'connected' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => handleReconnect(srv.id)}>
                          <RefreshCw size={14} /> Reconnect
                        </button>
                      )}
                      {hasKey && (
                        <button className="btn btn-danger btn-sm" onClick={() => handleDisconnect(srv.id)}>
                          <Unlink size={14} /> Disconnect
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Connect Dialog */}
      {connectDialog && (
        <div className="cloud-dialog-overlay" onClick={() => setConnectDialog(null)}>
          <div className="cloud-dialog" onClick={e => e.stopPropagation()}>
            <h3>Connect "{connectDialog.serverName}" to Cloud</h3>
            <p>Enter the API key from your Citadel Cloud dashboard.</p>
            <form onSubmit={e => { e.preventDefault(); handleConnect(connectDialog.serverId); }}>
              <input
                type="text"
                className="input"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
                placeholder="Paste your Cloud API key"
                autoFocus
              />
              <div className="cloud-dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setConnectDialog(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={connecting || !apiKeyInput.trim()}>
                  {connecting ? 'Connecting...' : <><Check size={14} /> Connect</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Setup Guide */}
      <div className="cloud-guide-card">
        <h3>Getting Started with Citadel Cloud</h3>
        <div className="cloud-steps">
          <div className="cloud-step">
            <span className="cloud-step-num">1</span>
            <div>
              <div className="cloud-step-title">Sign up at Citadel Cloud</div>
              <div className="cloud-step-desc">Create your account at cloud.citadel.gg</div>
            </div>
          </div>
          <div className="cloud-step">
            <span className="cloud-step-num">2</span>
            <div>
              <div className="cloud-step-title">Add your server</div>
              <div className="cloud-step-desc">Create a server entry in the Cloud dashboard and copy the API key</div>
            </div>
          </div>
          <div className="cloud-step">
            <span className="cloud-step-num">3</span>
            <div>
              <div className="cloud-step-title">Enable Cloud here</div>
              <div className="cloud-step-desc">Click "Enable Cloud" above, then connect each server with its API key</div>
            </div>
          </div>
          <div className="cloud-step">
            <span className="cloud-step-num">4</span>
            <div>
              <div className="cloud-step-title">Manage remotely</div>
              <div className="cloud-step-desc">Access your servers from anywhere via the Cloud dashboard</div>
            </div>
          </div>
        </div>
        <a href="https://cloud.citadel.gg" target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ marginTop: 16 }}>
          <Globe size={14} /> Open Citadel Cloud <ArrowUpRight size={14} />
        </a>
      </div>

      {DialogComponent}
    </div>
  );
}
