import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import {
  KeyRound, Lock, Rocket, CheckCircle, XCircle, ArrowLeft, ArrowRight,
  Monitor, Zap, FolderOpen, Loader, Sparkles, Server, Gamepad2, Eye, EyeOff, Shield, AlertTriangle,
} from '../components/Icon';

const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'admin', label: 'Admin Account' },
  { key: 'steam', label: 'SteamCMD' },
  { key: 'server', label: 'First Server' },
  { key: 'done', label: 'Complete' },
];

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const socket = useSocket();
  const { loadServers } = useServers();

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Admin step
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('');
  const [adminPassConfirm, setAdminPassConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);

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

  const handleCreateAdmin = async () => {
    if (!adminUser.trim()) return setError('Username is required');
    if (adminPass.length < 6) return setError('Password must be at least 6 characters');
    if (adminPass !== adminPassConfirm) return setError('Passwords do not match');

    setLoading(true);
    setError('');
    try {
      const result = await API.post('/api/setup/admin', {
        username: adminUser.trim(),
        password: adminPass,
      });
      if (result.error) {
        setError(result.error);
      } else if (result.token) {
        login(result.user, result.token);
        goNext();
      }
    } catch (err) {
      setError(err.message || 'Failed to create admin');
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
      });

      if (result.error) {
        setError(result.error);
        setSteamStatus('not_found');
      } else {
        setSteamCmdPath(result.steamCmdPath);
        setSteamStatus('found');
        // If no credentials provided, just advance
        if (!steamUser || !steamPass) {
          setTimeout(() => goNext(), 800);
        }
        // If credentials provided, we'll validate them next (user clicks Verify)
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
      const result = await API.post('/api/setup/steam/validate', payload);
      if (result.success) {
        setSteamValidated(true);
        setSteamNeedsGuard(false);
        setError('');
      } else if (result.needsGuard) {
        setSteamNeedsGuard(true);
        setError('Steam Guard code required — check your email or authenticator app.');
      } else {
        setError(result.error || result.message || 'Login failed');
      }
    } catch (err) {
      setError(err.message || 'Failed to validate Steam login');
    }
    setSteamValidating(false);
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
        });
        if (result.error) {
          setError(result.error);
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
        });
        if (result.error) {
          setError(result.error);
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
    try {
      await API.post('/api/setup/complete', {});
      setStep(STEPS.length - 1);
    } catch (err) {
      // Non-critical — still navigate
    }
    setLoading(false);
    setStep(STEPS.length - 1);
  };

  // ─── Render ─────────────────────────────────────────

  return (
    <div className="login-screen">
      <div style={{ width: '100%', maxWidth: 560, padding: '0 20px' }}>
        {/* Step indicator */}
        <div className="deploy-steps" style={{ marginBottom: 24 }}>
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`deploy-step ${i === step ? 'active' : i < step ? 'done' : ''}`}
              style={{ fontSize: 11, padding: '8px 4px' }}
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
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Welcome to Citadel</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
                Let&apos;s get you set up in just a few steps. You&apos;ll create your admin account,
                configure SteamCMD, and optionally deploy your first DayZ server.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, margin: '0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <KeyRound size={18} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                  <span style={{ fontSize: 13 }}>Create admin account</span>
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

              {error && <div className="login-error">{error}</div>}

              <div className="input-group">
                <label className="input-label">Username</label>
                <input
                  className="input"
                  value={adminUser}
                  onChange={e => setAdminUser(e.target.value)}
                  autoFocus
                  placeholder="admin"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    className="input"
                    type={showPass ? 'text' : 'password'}
                    value={adminPass}
                    onChange={e => setAdminPass(e.target.value)}
                    placeholder="At least 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
                    }}
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Confirm Password</label>
                <input
                  className="input"
                  type={showPass ? 'text' : 'password'}
                  value={adminPassConfirm}
                  onChange={e => setAdminPassConfirm(e.target.value)}
                  placeholder="Retype password"
                  onKeyDown={e => e.key === 'Enter' && handleCreateAdmin()}
                />
              </div>

              <div className="btn-group" style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={goBack}>
                  <ArrowLeft size={14} /> Back
                </button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={handleCreateAdmin}
                  disabled={loading}
                >
                  {loading ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</> : <>Create Account <ArrowRight size={14} /></>}
                </button>
              </div>
            </div>
          )}

          {/* ─── SteamCMD + Steam Login ─── */}
          {step === 2 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Gamepad2 size={32} style={{ color: 'var(--accent-purple)', marginBottom: 8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Steam Setup</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  SteamCMD is needed to download and update your DayZ server. Sign in to Steam so deployments work seamlessly.
                </p>
              </div>

              {error && <div className="login-error">{error}</div>}

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

              {/* Phase 2: SteamCMD found — now sign in to Steam */}
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
                    <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> We recommend using a dedicated Steam account for server management with Steam Guard set to <strong>Email</strong> (not Mobile Authenticator). After your first login, SteamCMD caches the session so you won&apos;t need a guard code each time.
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
                      Sign in to Steam
                    </div>
                    <div className="input-group">
                      <label className="input-label">Steam Username</label>
                      <input className="input" value={steamUser} onChange={e => setSteamUser(e.target.value)} placeholder="your_steam_username" autoComplete="off" />
                    </div>
                    <div className="input-group">
                      <label className="input-label">Steam Password</label>
                      <input className="input" type="password" value={steamPass} onChange={e => setSteamPass(e.target.value)} placeholder="your_steam_password" autoComplete="off" />
                    </div>

                    {steamNeedsGuard && (
                      <div className="input-group">
                        <label className="input-label">Steam Guard Code</label>
                        <input className="input" value={steamGuardCode} onChange={e => setSteamGuardCode(e.target.value)} placeholder="XXXXX" maxLength={5} style={{ letterSpacing: '0.2em', textAlign: 'center', maxWidth: 140 }} autoComplete="off" />
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Check your email or Steam mobile app for the code</div>
                      </div>
                    )}

                    <button className="btn btn-primary" onClick={handleSteamValidate} disabled={steamValidating || !steamUser || !steamPass} style={{ width: '100%', justifyContent: 'center' }}>
                      {steamValidating ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Verifying...</> : (steamNeedsGuard ? 'Submit Guard Code' : 'Verify Steam Login')}
                    </button>
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
                    Your credentials are stored locally and used only for SteamCMD operations.
                  </div>

                  <div className="btn-group" style={{ marginTop: 16 }}>
                    <button className="btn btn-secondary" onClick={() => { setSteamStatus(null); setError(''); }}>
                      <ArrowLeft size={14} /> Back
                    </button>
                    <button className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={goNext}>
                      Skip Login <ArrowRight size={14} />
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
          {step === 3 && !deploying && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <Server size={32} style={{ color: 'var(--accent-green)', marginBottom: 8 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700 }}>Your First Server</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Deploy a new DayZ server or add an existing one.
                </p>
              </div>

              {error && <div className="login-error">{error}</div>}

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
                      <input className="input" type="password" value={rconPassword} onChange={e => setRconPassword(e.target.value)} placeholder="Optional" />
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
          {step === 3 && deploying && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
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
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={completeSetup}>
                  Finish Setup <ArrowRight size={14} />
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
          {step === 4 && (
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
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
                Your Citadel panel is ready to go. You can manage your servers,
                install mods, configure settings, and monitor everything from the dashboard.
              </p>
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
