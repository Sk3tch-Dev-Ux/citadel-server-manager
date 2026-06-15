import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import {
  KeyRound, Lock, Rocket, CheckCircle, XCircle, ArrowLeft, ArrowRight,
  Monitor, Zap, FolderOpen, Loader, Sparkles, Server, Gamepad2, Eye, EyeOff, Shield, AlertTriangle,
  Globe, Network, RefreshCw, Crown, BadgeCheck, ExternalLink, CircleDashed,
} from '../components/Icon';

const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'admin', label: 'Admin Account' },
  { key: 'network', label: 'Network' },
  { key: 'steam', label: 'SteamCMD' },
  { key: 'server', label: 'First Server' },
  { key: 'done', label: 'Complete' },
];
// Note: The old "Citadel Cloud" license-key step was removed post-pivot.
// Subscription activation now happens via /citadel-license after setup, using
// email + password (not a license key).

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const socket = useSocket();
  const { loadServers } = useServers();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Audit N6 — backend errors now include an optional `suggestion` next-step
  // hint. When present, render it as a secondary line under the error banner.
  const [errorSuggestion, setErrorSuggestion] = useState('');

  // Wrapper that accepts either a string (legacy callsites) or an API
  // error response object ({ error, suggestion }). Always sets both
  // pieces of state so the banner stays in sync.
  const setErrorFromApi = (errOrResult) => {
    if (errOrResult && typeof errOrResult === 'object') {
      setError(errOrResult.error || errOrResult.message || 'Request failed');
      setErrorSuggestion(errOrResult.suggestion || '');
    } else {
      setError(errOrResult || '');
      setErrorSuggestion('');
    }
  };

  // Clear stale suggestion whenever the error itself clears (e.g. on
  // setError('') before the next API call). Without this the previous
  // suggestion stays rendered after a successful retry.
  useEffect(() => {
    if (!error) setErrorSuggestion('');
  }, [error]);

  // Admin step
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('');
  const [adminPassConfirm, setAdminPassConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);

  // Network step
  const [serverIp, setServerIp] = useState('');
  const [enableFirewall, setEnableFirewall] = useState(true);
  const [detectedIps, setDetectedIps] = useState([]);
  const [detecting, setDetecting] = useState(false);

  // Steam step
  const [steamMode, setSteamMode] = useState('auto'); // 'auto' | 'manual' | 'skip'
  const [steamPath, setSteamPath] = useState('');
  const [steamUser, setSteamUser] = useState('');
  const [steamPass, setSteamPass] = useState('');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [steamStatus, setSteamStatus] = useState(null); // null | 'detecting' | 'found' | 'not_found' | 'downloaded'
  const [steamCmdPath, setSteamCmdPath] = useState('');
  const [steamNeedsGuard, setSteamNeedsGuard] = useState(false);
  const [steamValidated, setSteamValidated] = useState(false);
  const [steamValidating, setSteamValidating] = useState(false);

  // Server step
  const [serverMode, setServerMode] = useState(null); // 'new' | 'existing' | 'skip'
  const [serverName, setServerName] = useState('My DayZ Server');
  const [installDir, setInstallDir] = useState('C:\\Citadel\\deployments\\');
  const [gameTitle, setGameTitle] = useState('DayZ, PC');
  const [map, setMap] = useState('chernarusplus');
  const [gamePort, setGamePort] = useState(2302);
  const [rconPort, setRconPort] = useState(2305);
  const [rconPassword, setRconPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(60);
  const [deploying, setDeploying] = useState(false);
  const [deployProgress, setDeployProgress] = useState(null);

  // License step

  // Listen for deploy progress
  useEffect(() => {
    if (!socket) return;
    const handler = (data) => {
      setDeployProgress(data);
      if (data.status === 'complete') {
        loadServers();
      }
    };
    socket.on('deployProgress', handler);
    return () => socket.off('deployProgress', handler);
  }, [socket, loadServers]);

  const goNext = () => {
    setError('');
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  };
  const goBack = () => {
    setError('');
    setStep(s => Math.max(s - 1, 0));
  };

  // ─── Step handlers ──────────────────────────────────

  // Mirror the backend password policy (backend/lib/helpers.js:128–143) so the
  // user sees granular per-rule feedback live, instead of submitting and getting
  // a coarse "Password does not meet policy" 400 back. Audit N15.
  const passChecks = useMemo(() => ({
    length: adminPass.length >= 8,
    upper: /[A-Z]/.test(adminPass),
    lower: /[a-z]/.test(adminPass),
    number: /[0-9]/.test(adminPass),
    special: /[^A-Za-z0-9]/.test(adminPass),
  }), [adminPass]);
  const passValid = Object.values(passChecks).every(Boolean);
  const passConfirmValid = adminPassConfirm.length > 0 && adminPassConfirm === adminPass;

  const handleCreateAdmin = async () => {
    if (!adminUser.trim()) return setError('Username is required');
    if (!passValid) return setError('Password does not meet all the requirements below.');
    if (!passConfirmValid) return setError('Passwords do not match');

    setLoading(true);
    setError('');
    try {
      const result = await API.post('/api/setup/admin', {
        username: adminUser.trim(),
        password: adminPass,
      });
      if (result.error) {
        setErrorFromApi(result);
      } else if (result.token) {
        login(result.user, result.token);
        goNext();
      }
    } catch (err) {
      setError(err.message || 'Failed to create admin');
    }
    setLoading(false);
  };

  const detectIps = async () => {
    setDetecting(true);
    try {
      const result = await API.get('/api/setup/network/detect');
      if (result.interfaces) {
        setDetectedIps(result.interfaces);
        if (result.recommended && !serverIp) {
          setServerIp(result.recommended);
        }
      }
    } catch (err) {
      // Auto-detect failure is non-fatal — the user can type the IP manually —
      // but it MUST be visible. Audit N7: silently swallowing this here was
      // half of the v2.18.x "frozen wizard" trap.
      setError(`Couldn't auto-detect network interfaces: ${err.message || 'unknown error'}. You can still type the server IP manually below.`);
    }
    setDetecting(false);
  };

  const handleNetworkSetup = async () => {
    if (!serverIp.trim()) return setError('IP address is required');

    setLoading(true);
    setError('');
    try {
      const result = await API.post('/api/setup/network', {
        ip: serverIp.trim(),
        enableFirewall,
      });
      if (result.error) {
        setErrorFromApi(result);
      } else {
        goNext();
      }
    } catch (err) {
      setError(err.message || 'Failed to configure network');
    }
    setLoading(false);
  };

  const handleSteamSetup = async () => {
    if (steamMode === 'skip') {
      goNext();
      return;
    }

    setLoading(true);
    setError('');
    setSteamStatus('detecting');

    try {
      const result = await API.post('/api/setup/steam', {
        steamCmdPath: steamMode === 'manual' ? steamPath : '',
        username: steamUser || '',
        password: steamPass || '',
      }, { timeout: 90000 });

      if (result.error) {
        setErrorFromApi(result);
        setSteamStatus('not_found');
      } else {
        setSteamCmdPath(result.steamCmdPath);
        setSteamStatus('found');
        // Always show Phase 2 (credential input) so the user can sign in.
        // They can click "Skip Login" if they want to configure later.
      }
    } catch (err) {
      setError(err.message || 'SteamCMD setup failed');
      setSteamStatus('not_found');
    }
    setLoading(false);
  };

  const handleSteamValidate = async () => {
    if (!steamUser || !steamPass) {
      setError('Steam username and password are required');
      return;
    }
    setSteamValidating(true);
    setError('');
    try {
      const payload = { username: steamUser, password: steamPass };
      if (steamGuardCode) payload.guardCode = steamGuardCode;
      const result = await API.post('/api/setup/steam/validate', payload, { timeout: 90000 });
      if (result.success) {
        setSteamValidated(true);
        setSteamNeedsGuard(false);
        setSteamGuardCode('');
        setError('');
      } else if (result.needsGuard) {
        setSteamNeedsGuard(true);
        setError('Steam Guard code required — check your email and enter the code above.');
      } else {
        const msg = (result.error || result.message || 'Login failed').toLowerCase();
        if (msg.includes('guard') || msg.includes('denied') || msg.includes('two-factor') || msg.includes('code required')) {
          setSteamNeedsGuard(true);
          setError('Steam Guard code required — check your email and enter the code above.');
        } else {
          setErrorFromApi(result);
        }
      }
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('timed out')) {
        setSteamNeedsGuard(true);
        setError('Login timed out — this usually means Steam Guard is required. Check your email for a code.');
      } else {
        setError(err.message || 'Failed to validate Steam login');
      }
    }
    setSteamValidating(false);
  };

  const [steamSaving, setSteamSaving] = useState(false);
  const handleSteamSave = async () => {
    if (!steamUser || !steamPass) {
      setError('Steam username and password are required');
      return;
    }
    setSteamSaving(true);
    setError('');
    try {
      const result = await API.post('/api/setup/steam/save', { username: steamUser, password: steamPass });
      if (result.success) {
        setError('');
        goNext();
      } else {
        setError(result.error || 'Failed to save credentials');
      }
    } catch (err) {
      setError(err.message || 'Failed to save credentials');
    }
    setSteamSaving(false);
  };

  const handleDeployServer = async () => {
    if (serverMode === 'skip') {
      await completeSetup();
      return;
    }

    if (!serverName.trim()) return setError('Server name is required');
    if (!installDir.trim()) return setError('Install directory is required');

    setLoading(true);
    setError('');
    setDeploying(true);
    setDeployProgress({ status: 'starting', message: 'Preparing deployment...', progress: 0 });

    try {
      if (serverMode === 'new') {
        const result = await API.post('/api/deploy', {
          name: serverName, installDir, gameTitle,
          gamePort, queryPort: gamePort + 1, rconPort, rconPassword, maxPlayers, map,
          ...(serverIp && { ip: serverIp }),
        });
        if (result.error) {
          setErrorFromApi(result);
          setDeploying(false);
          setDeployProgress(null);
        }
        // Deploy continues in background via socket — completion handled in useEffect
      } else {
        // Add existing server
        const result = await API.post('/api/servers', {
          name: serverName, installDir,
          executable: 'DayZServer_x64.exe',
          launchParams: `-config=serverDZ.cfg -port=${gamePort} -profiles=profiles -dologs -adminlog -netlog -freezecheck`,
          gameTitle, gamePort, queryPort: gamePort + 1, rconPort, rconPassword, maxPlayers, map,
          ...(serverIp && { ip: serverIp }),
        });
        if (result.error) {
          setErrorFromApi(result);
          setDeploying(false);
        } else {
          setDeployProgress({ status: 'complete', message: 'Server added successfully!' });
          loadServers();
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to add server');
      setDeploying(false);
      setDeployProgress(null);
    }
    setLoading(false);
  };

  const completeSetup = async () => {
    setLoading(true);
    setError('');
    try {
      await API.post('/api/setup/complete', {});
      setStep(STEPS.length - 1);
    } catch (err) {
      // Audit N7: previously the catch silently navigated forward. That's
      // exactly the v2.18.x trap — if /api/setup/complete 403s (which it did
      // before the cookie-auth fix), the user landed on the "done" page with
      // a setup that wasn't actually marked complete. Surface the error and
      // stay on the current step so the user can retry / report.
      setError(
        `Couldn't finalize setup: ${err.message || 'unknown error'}. ` +
        'Refresh the page and try again, or check the backend logs.'
      );
      setLoading(false);
      return;
    }
    setLoading(false);
    setStep(STEPS.length - 1);
  };

  // ─── Render ─────────────────────────────────────────

  return (
    <div className="login-screen">
      <div style={{ width: '100%', maxWidth: 560, padding: '0 20px' }}>
        {/* Step indicator */}
        <div className="deploy-steps" style={{ marginBottom: 24 }} aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`deploy-step ${i === step ? 'active' : i < step ? 'done' : ''}`}
              style={{ fontSize: 11, padding: '8px 4px' }}
              aria-current={i === step ? 'step' : undefined}
            >
              {s.label}
            </div>
          ))}
        </div>

        <div className="login-box" style={{ width: '100%', maxWidth: '100%' }}>
          {/* ─── Welcome ─── */}
          {step === 0 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ marginBottom: 16 }}>
                <img src="/citadel-logo.svg" alt="Citadel" style={{ width: 56, height: 56, margin: '0 auto' }} />
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Welcome to Citadel Server Manager</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
                Local DayZ server management for Windows. Let&apos;s get you set up in just a
                few steps — admin account, network, SteamCMD, and your first server.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, margin: '0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <KeyRound size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13 }}>Create admin account</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <Globe size={18} style={{ color: 'var(--accent-cyan, #06b6d4)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13 }}>Configure network access</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <Gamepad2 size={18} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13 }}>Configure SteamCMD</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <Server size={18} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13 }}>Deploy your first server</span>
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 28, padding: '12px 24px', fontSize: 15 }}
                onClick={goNext}
              >
                Get Started <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* ─── Admin Account ─── */}
          {step === 1 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Lock size={32} style={{ color: 'var(--accent-blue)', marginBottom: 8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Create Admin Account</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  This will be your primary login for the panel.
                </p>
              </div>

              <div aria-live="polite">
                {error && (
                  <div>
                    <div className="login-error">
                      <div>{error}</div>
                      {errorSuggestion && (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, fontWeight: 'normal' }}>
                          {errorSuggestion}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => API.downloadDiagnostics(`Setup step ${step} (${STEPS[step]?.key})`)}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        fontSize: 11, textDecoration: 'underline', cursor: 'pointer',
                        padding: '2px 0', marginTop: 2,
                      }}
                    >
                      Download diagnostics (for support)
                    </button>
                  </div>
                )}
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="setup-admin-user">Username</label>
                <input
                  id="setup-admin-user"
                  className="input"
                  value={adminUser}
                  onChange={e => setAdminUser(e.target.value)}
                  autoFocus
                  placeholder="admin"
                />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="setup-admin-pass">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="setup-admin-pass"
                    className="input"
                    type={showPass ? 'text' : 'password'}
                    value={adminPass}
                    onChange={e => setAdminPass(e.target.value)}
                    placeholder="8+ chars, mixed case, number, symbol"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
                    }}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {adminPass.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginTop: 6, fontSize: 11 }}>
                    {[
                      ['length',  '8+ characters'],
                      ['upper',   'Uppercase letter'],
                      ['lower',   'Lowercase letter'],
                      ['number',  'Number'],
                      ['special', 'Symbol (!@#$…)'],
                    ].map(([key, label]) => (
                      <div key={key} style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        color: passChecks[key] ? 'var(--accent-green, #30a46c)' : 'var(--text-muted)',
                      }}>
                        {passChecks[key] ? <CheckCircle size={11} /> : <CircleDashed size={11} />}
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="setup-admin-pass-confirm">Confirm Password</label>
                <input
                  id="setup-admin-pass-confirm"
                  className="input"
                  type={showPass ? 'text' : 'password'}
                  value={adminPassConfirm}
                  onChange={e => setAdminPassConfirm(e.target.value)}
                  placeholder="Retype password"
                  onKeyDown={e => e.key === 'Enter' && handleCreateAdmin()}
                  style={{
                    borderColor: adminPassConfirm.length > 0 && !passConfirmValid
                      ? 'var(--accent-red, #e5484d)' : undefined,
                  }}
                />
                {adminPassConfirm.length > 0 && !passConfirmValid && (
                  <div style={{ fontSize: 11, color: 'var(--accent-red, #e5484d)', marginTop: 4 }}>
                    Passwords don't match.
                  </div>
                )}
              </div>

              <div className="btn-group" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={goBack}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleCreateAdmin}
                  disabled={loading || !adminUser.trim() || !passValid || !passConfirmValid}
                >
                  {loading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</> : <>Create Account <ArrowRight size={14} /></>}
                </button>
              </div>
            </div>
          )}

          {/* ─── Network ─── */}
          {step === 2 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Globe size={32} style={{ color: 'var(--accent-blue)', marginBottom: 8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Network Configuration</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Configure your server&apos;s IP address for remote access. This is essential for VPS and dedicated server deployments.
                </p>
              </div>

              <div aria-live="polite">
                {error && (
                  <div>
                    <div className="login-error">
                      <div>{error}</div>
                      {errorSuggestion && (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, fontWeight: 'normal' }}>
                          {errorSuggestion}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => API.downloadDiagnostics(`Setup step ${step} (${STEPS[step]?.key})`)}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        fontSize: 11, textDecoration: 'underline', cursor: 'pointer',
                        padding: '2px 0', marginTop: 2,
                      }}
                    >
                      Download diagnostics (for support)
                    </button>
                  </div>
                )}
              </div>

              <div className="input-group">
                <label className="input-label" htmlFor="setup-server-ip">Server IP Address</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="setup-server-ip"
                    className="input"
                    value={serverIp}
                    onChange={e => setServerIp(e.target.value)}
                    placeholder="e.g. 192.168.1.100 or 0.0.0.0"
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={detectIps}
                    disabled={detecting}
                    style={{ flexShrink: 0, gap: 6 }}
                  >
                    {detecting ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />}
                    Detect
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Your public or LAN IP. Players and admins will connect using this address.
                </div>
              </div>

              {detectedIps.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                    Detected Interfaces
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {detectedIps.map((iface, i) => (
                      <div
                        key={i}
                        onClick={() => setServerIp(iface.ip)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', background: serverIp === iface.ip ? 'rgba(99,102,241,0.12)' : 'var(--bg-surface)',
                          border: `1px solid ${serverIp === iface.ip ? 'var(--accent-blue)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 13,
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>{iface.name}</span>
                        <code style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary)', fontWeight: 600 }}>{iface.ip}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', marginBottom: 4, cursor: 'pointer',
              }} onClick={() => setEnableFirewall(!enableFirewall)}>
                <input
                  type="checkbox"
                  checked={enableFirewall}
                  onChange={e => setEnableFirewall(e.target.checked)}
                  aria-label="Automatically configure Windows Firewall"
                  style={{ marginTop: 2, accentColor: 'var(--accent-blue)' }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Automatically configure Windows Firewall</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Opens ports for the Citadel Server Manager dashboard and your DayZ servers so they&apos;re reachable from the internet.
                  </div>
                </div>
              </div>

              <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '10px 14px', marginTop: 12, marginBottom: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> Use <code>0.0.0.0</code> to bind to all network interfaces, or enter your specific public IP. If you&apos;re running locally, you can skip this step.
              </div>

              <div className="btn-group" style={{ marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={goBack}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ justifyContent: 'center' }}
                  onClick={goNext}
                >
                  Skip <ArrowRight size={14} />
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleNetworkSetup}
                  disabled={loading}
                >
                  {loading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Configuring...</> : <>Configure <ArrowRight size={14} /></>}
                </button>
              </div>
            </div>
          )}

          {/* ─── SteamCMD + Steam Login ─── */}
          {step === 3 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Gamepad2 size={32} style={{ color: 'var(--accent-purple)', marginBottom: 8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Steam Setup</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  SteamCMD is needed to download and update your DayZ server. DayZ requires a Steam account that owns the game — sign in below to enable server deployment and Workshop mod downloads.
                </p>
              </div>

              <div aria-live="polite">
                {error && (
                  <div>
                    <div className="login-error">
                      <div>{error}</div>
                      {errorSuggestion && (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, fontWeight: 'normal' }}>
                          {errorSuggestion}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => API.downloadDiagnostics(`Setup step ${step} (${STEPS[step]?.key})`)}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        fontSize: 11, textDecoration: 'underline', cursor: 'pointer',
                        padding: '2px 0', marginTop: 2,
                      }}
                    >
                      Download diagnostics (for support)
                    </button>
                  </div>
                )}
              </div>

              {/* Phase 1: SteamCMD location (before steamStatus === 'found') */}
              {steamStatus !== 'found' && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    <div
                      className={`game-card ${steamMode === 'auto' ? 'selected' : ''}`}
                      onClick={() => setSteamMode('auto')}
                      style={{ padding: 14, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <Sparkles size={20} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Auto-detect / Download</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          We&apos;ll find SteamCMD on your system or download it automatically
                        </div>
                      </div>
                    </div>
                    <div
                      className={`game-card ${steamMode === 'manual' ? 'selected' : ''}`}
                      onClick={() => setSteamMode('manual')}
                      style={{ padding: 14, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <FolderOpen size={20} style={{ color: 'var(--accent-yellow)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Manual Path</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          I know where SteamCMD is installed
                        </div>
                      </div>
                    </div>
                    <div
                      className={`game-card ${steamMode === 'skip' ? 'selected' : ''}`}
                      onClick={() => setSteamMode('skip')}
                      style={{ padding: 14, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                    >
                      <ArrowRight size={20} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Skip for Now</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          I&apos;ll configure Steam later in Settings
                        </div>
                      </div>
                    </div>
                  </div>

                  {steamMode === 'manual' && (
                    <div className="input-group">
                      <label className="input-label">SteamCMD Path</label>
                      <input
                        className="input"
                        value={steamPath}
                        onChange={e => setSteamPath(e.target.value)}
                        placeholder="C:\SteamCMD\steamcmd.exe"
                      />
                    </div>
                  )}

                  <div className="btn-group" style={{ marginTop: 12 }}>
                    <button className="btn btn-secondary" onClick={goBack}>
                      <ArrowLeft size={14} /> Back
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ flex: 1, justifyContent: 'center' }}
                      onClick={handleSteamSetup}
                      disabled={loading}
                    >
                      {loading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> {steamMode === 'auto' ? 'Detecting...' : 'Configuring...'}</> :
                        steamMode === 'skip' ? <>Skip <ArrowRight size={14} /></> : <>Find SteamCMD <ArrowRight size={14} /></>}
                    </button>
                  </div>
                </>
              )}

              {/* Phase 2: SteamCMD found — optionally sign in to Steam */}
              {steamStatus === 'found' && !steamValidated && (
                <>
                  <div style={{
                    background: 'rgba(92,184,92,0.08)', border: '1px solid rgba(92,184,92,0.2)',
                    borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16,
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                  }}>
                    <CheckCircle size={16} style={{ color: 'var(--accent-green)' }} />
                    <span>SteamCMD ready at {steamCmdPath}</span>
                  </div>

                  <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>Important:</strong> DayZ dedicated server requires a <strong>Steam account that owns DayZ</strong> to download server files. Sign in now, or configure this later in Settings before deploying.
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                      Sign in to Steam
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
                      Use a dedicated Steam account that owns DayZ. We recommend Steam Guard set to <strong>Email</strong> (not Mobile Authenticator).
                    </div>
                    <div className="input-group">
                      <label className="input-label">Steam Username</label>
                      <input className="input" value={steamUser} onChange={e => setSteamUser(e.target.value)} placeholder="your_steam_username" autoComplete="off" />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Steam Password</label>
                      <input className="input" type="password" value={steamPass} onChange={e => setSteamPass(e.target.value)} placeholder="your_steam_password" autoComplete="off" />
                    </div>

                    <div className="input-group">
                      <label className="input-label">
                        Steam Guard Code
                        {!steamNeedsGuard && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>(leave blank on first attempt)</span>}
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input className="input" value={steamGuardCode} onChange={e => setSteamGuardCode(e.target.value)} placeholder="XXXXX" maxLength={5} style={{ letterSpacing: '0.2em', textAlign: 'center', maxWidth: 140, ...(steamNeedsGuard ? { borderColor: '#f59e0b', boxShadow: '0 0 0 1px rgba(245,158,11,0.3)' } : {}) }} autoComplete="off" />
                        {steamNeedsGuard && <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 500 }}>← Check your email</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Click Verify first. If Steam Guard is enabled, a code will be emailed — enter it here and verify again.
                      </div>
                    </div>

                    <button className="btn btn-primary" onClick={handleSteamValidate} disabled={steamValidating || steamSaving || !steamUser || !steamPass} style={{ width: '100%', justifyContent: 'center' }}>
                      {steamValidating ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Verifying... (up to 15s)</> : (steamGuardCode ? 'Verify with Guard Code' : 'Verify Steam Login')}
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0' }}>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>or</span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>

                    <button className="btn btn-secondary" onClick={handleSteamSave} disabled={steamValidating || steamSaving || !steamUser || !steamPass} style={{ width: '100%', justifyContent: 'center' }}>
                      {steamSaving ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : 'Save & Continue Without Verifying'}
                    </button>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                      Saves credentials and moves on. You can complete Steam Guard authentication manually via SteamCMD on this server.
                    </div>
                  </div>

                  <div className="btn-group" style={{ marginTop: 4 }}>
                    <button className="btn btn-secondary" onClick={() => { setSteamStatus(null); setError(''); }}>
                      <ArrowLeft size={14} /> Back
                    </button>
                    <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 12 }} onClick={goNext}>
                      Skip Entirely <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}

              {/* Phase 3: Steam validated — success */}
              {steamStatus === 'found' && steamValidated && (
                <>
                  <div style={{
                    background: 'rgba(92,184,92,0.08)', border: '1px solid rgba(92,184,92,0.2)',
                    borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 16,
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                  }}>
                    <CheckCircle size={16} style={{ color: 'var(--accent-green)' }} />
                    <span>SteamCMD ready at {steamCmdPath}</span>
                  </div>

                  <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, textAlign: 'center' }}>
                    <Shield size={36} style={{ color: 'var(--text-success, #22c55e)', marginBottom: 12 }} />
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Steam Connected</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Logged in as <strong>{steamUser}</strong></div>
                  </div>

                  <div className="btn-group" style={{ marginTop: 16 }}>
                    <button className="btn btn-secondary" onClick={() => { setSteamValidated(false); setSteamPass(''); }}>
                      <ArrowLeft size={14} /> Use Different Account
                    </button>
                    <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={goNext}>
                      Continue <ArrowRight size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ─── First Server ─── */}
          {step === 4 && !deploying && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Server size={32} style={{ color: 'var(--accent-green)', marginBottom: 8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Your First Server</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Deploy a new DayZ server or add an existing one.
                </p>
              </div>

              <div aria-live="polite">
                {error && (
                  <div>
                    <div className="login-error">
                      <div>{error}</div>
                      {errorSuggestion && (
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9, fontWeight: 'normal' }}>
                          {errorSuggestion}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => API.downloadDiagnostics(`Setup step ${step} (${STEPS[step]?.key})`)}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)',
                        fontSize: 11, textDecoration: 'underline', cursor: 'pointer',
                        padding: '2px 0', marginTop: 2,
                      }}
                    >
                      Download diagnostics (for support)
                    </button>
                  </div>
                )}
              </div>

              {!serverMode && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div
                    className="game-card"
                    onClick={() => setServerMode('new')}
                    style={{ padding: 16, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <Rocket size={22} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Deploy New Server</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        Download DayZ server files via SteamCMD
                      </div>
                    </div>
                  </div>
                  <div
                    className="game-card"
                    onClick={() => setServerMode('existing')}
                    style={{ padding: 16, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <FolderOpen size={22} style={{ color: 'var(--accent-yellow)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Add Existing Server</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        I already have DayZ server files installed
                      </div>
                    </div>
                  </div>
                  <div
                    className="game-card"
                    onClick={() => setServerMode('skip')}
                    style={{ padding: 16, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <ArrowRight size={22} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>Skip for Now</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        I&apos;ll add a server later from the Deploy page
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {serverMode === 'skip' && (
                <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
                  No problem! You can deploy or add a server anytime from the <strong style={{ color: 'var(--text-secondary)' }}>Deploy Server</strong> page in the sidebar.
                </div>
              )}

              {serverMode && serverMode !== 'skip' && (
                <div>
                  <div className="input-group">
                    <label className="input-label">Server Name</label>
                    <input className="input" value={serverName} onChange={e => setServerName(e.target.value)} placeholder="My DayZ Server" />
                  </div>
                  <div className="input-group">
                    <label className="input-label">Install Directory</label>
                    <input className="input" value={installDir} onChange={e => setInstallDir(e.target.value)} placeholder="C:\DayZServer" />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {serverMode === 'new' ? 'Server files will be downloaded here' : 'Path to your existing DayZ server folder'}
                    </div>
                  </div>
                  <div className="grid grid-2">
                    <div className="input-group">
                      <label className="input-label">Branch</label>
                      <select className="input" value={gameTitle} onChange={e => setGameTitle(e.target.value)}>
                        <option value="DayZ, PC">DayZ PC (Stable)</option>
                        <option value="DayZ, PC (Experimental)">DayZ PC (Experimental)</option>
                      </select>
                    </div>
                    <div className="input-group">
                      <label className="input-label">Map</label>
                      <select className="input" value={map} onChange={e => setMap(e.target.value)}>
                        <option value="chernarusplus">Chernarus</option>
                        <option value="enoch">Livonia</option>
                        <option value="deerisle">Deer Isle</option>
                        <option value="namalsk">Namalsk</option>
                        <option value="sakhal">Sakhal</option>
                        <option value="takistanplus">Takistan</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-2">
                    <div className="input-group">
                      <label className="input-label">Game Port</label>
                      <input className="input" type="number" value={gamePort} onChange={e => setGamePort(parseInt(e.target.value) || 2302)} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Max Players</label>
                      <input className="input" type="number" value={maxPlayers} onChange={e => setMaxPlayers(parseInt(e.target.value) || 60)} />
                    </div>
                  </div>
                  <div className="grid grid-2">
                    <div className="input-group">
                      <label className="input-label">RCON Port</label>
                      <input className="input" type="number" value={rconPort} onChange={e => setRconPort(parseInt(e.target.value) || 2305)} />
                    </div>
                    <div className="input-group">
                      <label className="input-label">RCON Password</label>
                      <input className="input" type="password" value={rconPassword} onChange={e => setRconPassword(e.target.value)} placeholder="Leave blank to auto-generate" />
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Citadel configures BattlEye RCON automatically on first start — set a password only if you want a specific one (e.g. for external RCON tools).
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="btn-group" style={{ marginTop: 12 }}>
                <button className="btn btn-secondary" onClick={serverMode ? () => setServerMode(null) : goBack}>
                  <ArrowLeft size={14} /> Back
                </button>
                {(serverMode === 'skip' || serverMode) && (
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={handleDeployServer}
                    disabled={loading}
                  >
                    {serverMode === 'skip' ? <>Finish Setup <ArrowRight size={14} /></> :
                      serverMode === 'new' ? <><Rocket size={14} /> Deploy Server</> :
                        <><FolderOpen size={14} /> Add Server</>}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ─── Deploying ─── */}
          {step === 4 && deploying && (
            <div style={{ textAlign: 'center', padding: '20px 0' }} aria-live="polite">
              <div style={{ marginBottom: 16 }}>
                {deployProgress?.status === 'complete' ?
                  <CheckCircle size={48} style={{ color: 'var(--accent-green)' }} /> :
                  deployProgress?.status === 'error' ?
                    <XCircle size={48} style={{ color: 'var(--accent-red)' }} /> :
                    <Rocket size={48} style={{ color: 'var(--accent-blue)' }} />
                }
              </div>
              <h3 style={{ marginBottom: 8 }}>
                {deployProgress?.status === 'complete' ? 'Server Ready!' :
                  deployProgress?.status === 'error' ? 'Deployment Failed' :
                    'Deploying Server...'}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                {deployProgress?.message || 'Starting deployment...'}
              </p>

              {deployProgress?.status !== 'complete' && deployProgress?.status !== 'error' && (
                <div className="progress-bar" style={{ maxWidth: 360, margin: '0 auto' }}>
                  <div className="progress-fill" style={{ width: `${deployProgress?.progress || 3}%` }} />
                </div>
              )}

              {deployProgress?.status === 'complete' && (
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => { setDeploying(false); completeSetup(); }}>
                  Continue <ArrowRight size={14} />
                </button>
              )}
              {deployProgress?.status === 'error' && (
                <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={() => { setDeploying(false); setDeployProgress(null); }}>
                  <ArrowLeft size={14} /> Try Again
                </button>
              )}
            </div>
          )}

          {/* ─── Done ─── */}
          {step === 5 && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%', margin: '0 auto',
                  background: 'rgba(92,184,92,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CheckCircle size={36} style={{ color: 'var(--accent-green)' }} />
                </div>
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>You&apos;re All Set!</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
                Your Citadel Server Manager is ready. Here&apos;s a summary of your setup:
              </p>

              {/* Setup summary */}
              <div style={{ textAlign: 'left', maxWidth: 340, margin: '0 auto 24px', fontSize: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  <span>Admin account created</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  <span>Network configured{serverIp ? ` (${serverIp})` : ''}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  {steamMode === 'skip' ?
                    <CircleDashed size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> :
                    <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  }
                  <span style={steamMode === 'skip' ? { color: 'var(--text-muted)' } : {}}>
                    {steamMode === 'skip' ? 'SteamCMD skipped' : 'SteamCMD configured'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  {serverMode === 'skip' ?
                    <CircleDashed size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> :
                    <CheckCircle size={15} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                  }
                  <span style={serverMode === 'skip' ? { color: 'var(--text-muted)' } : {}}>
                    {serverMode === 'skip' ? 'Server setup skipped' : `Server "${serverName}" added`}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <CircleDashed size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-muted)' }}>
                    Next: activate your subscription at Subscription in the sidebar
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <CircleDashed size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-muted)' }}>
                    Optional: pair with{' '}
                    <a
                      href="https://citadels.cc/cloud"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent)' }}
                    >
                      Citadel Cloud
                    </a>
                    {' '}for remote control, automations, and the Trust Network
                  </span>
                </div>
              </div>

              <button
                className="btn btn-primary"
                style={{ padding: '12px 32px', fontSize: 15 }}
                onClick={() => navigate('/')}
              >
                Open Dashboard <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          Citadel v2.0
        </div>
      </div>

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
