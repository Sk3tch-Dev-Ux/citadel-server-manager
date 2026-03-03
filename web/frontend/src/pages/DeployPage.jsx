import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext';
import { useServers } from '../contexts/ServersContext';
import API from '../api';
import { Rocket, CheckCircle, XCircle, ArrowLeft, ArrowRight, Monitor, Zap, FolderOpen, Search, Shield, AlertTriangle, Loader } from '../components/Icon';

const DEPLOY_BASE = 'C:\\Citadel\\deployments';

function sanitizeDirName(name) {
  return name.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
}

export default function DeployPage() {
  const socket = useSocket();
  const navigate = useNavigate();
  const { loadServers } = useServers();
  const [mode, setMode] = useState(null); // 'new' or 'existing'
  const [step, setStep] = useState(1);
  const [gameTitle, setGameTitle] = useState('DayZ, PC');
  const [name, setName] = useState('');
  const [installDir, setInstallDir] = useState(DEPLOY_BASE + '\\');
  const [dirManuallyEdited, setDirManuallyEdited] = useState(false);
  const [executable, setExecutable] = useState('DayZServer_x64.exe');
  const [gamePort, setGamePort] = useState(2302);
  const [queryPort, setQueryPort] = useState(2303);
  const [rconPort, setRconPort] = useState(2305);
  const [rconPassword, setRconPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(60);
  const [map, setMap] = useState('chernarusplus');
  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState({ status: '', message: '', progress: 0 });
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(null);

  // Steam credential state
  const [steamStatus, setSteamStatus] = useState(null); // null = loading, object = loaded
  const [steamLoading, setSteamLoading] = useState(false);
  const [steamUsername, setSteamUsername] = useState('');
  const [steamPassword, setSteamPassword] = useState('');
  const [steamGuardCode, setSteamGuardCode] = useState('');
  const [steamError, setSteamError] = useState('');
  const [steamNeedsGuard, setSteamNeedsGuard] = useState(false);
  const [steamValidating, setSteamValidating] = useState(false);

  useEffect(() => {
    const handler = (data) => {
      setProgress(data);
      if (data.status === 'complete') { window.addToast('Server deployed successfully!', 'success'); loadServers(); }
      else if (data.status === 'error') { window.addToast(data.message, 'error'); setDeploying(false); }
    };
    socket.on('deployProgress', handler);
    return () => socket.off('deployProgress', handler);
  }, [loadServers, socket]);

  // Fetch Steam status when entering the Steam step
  const fetchSteamStatus = useCallback(async () => {
    setSteamLoading(true);
    setSteamError('');
    try {
      const result = await API.get('/api/steam/status');
      setSteamStatus(result);
      if (result.username) setSteamUsername(result.username);
    } catch (err) {
      setSteamStatus({ steamCmdReady: false, username: '', hasPassword: false, loginValidated: false });
    }
    setSteamLoading(false);
  }, []);

  // Validate Steam credentials
  const validateSteamCredentials = async () => {
    if (!steamUsername || !steamPassword) {
      setSteamError('Username and password are required');
      return;
    }
    setSteamValidating(true);
    setSteamError('');
    try {
      const payload = { username: steamUsername, password: steamPassword };
      if (steamGuardCode) payload.guardCode = steamGuardCode;
      const result = await API.post('/api/steam/credentials', payload);
      if (result.success) {
        setSteamStatus(prev => ({ ...prev, username: steamUsername, hasPassword: true, loginValidated: true }));
        setSteamNeedsGuard(false);
        setSteamError('');
        window.addToast(`Steam logged in as ${steamUsername}`, 'success');
      } else if (result.needsGuard) {
        setSteamNeedsGuard(true);
        setSteamError('Steam Guard code required — check your email or authenticator app.');
      } else {
        setSteamError(result.message || 'Login failed');
      }
    } catch (err) {
      setSteamError(err.message || 'Failed to validate credentials');
    }
    setSteamValidating(false);
  };

  const detectServer = async () => {
    if (!installDir) { window.addToast('Enter an install directory first', 'error'); return; }
    setDetecting(true);
    setDetected(null);
    try {
      const result = await API.post('/api/servers/detect', { installDir });
      if (result && result.error) {
        window.addToast(result.error, 'error');
        setDetected({ found: false, reason: result.error });
      } else if (result && result.found) {
        setDetected(result);
        if (result.executable) setExecutable(result.executable);
        if (result.config) {
          if (result.config.name) setName(result.config.name);
          if (result.config.maxPlayers) setMaxPlayers(result.config.maxPlayers);
          if (result.config.map) setMap(result.config.map);
          if (result.config.queryPort) setQueryPort(result.config.queryPort);
          if (result.config.gamePort) setGamePort(result.config.gamePort);
          if (result.config.gameTitle) setGameTitle(result.config.gameTitle);
        }
        window.addToast('Server detected! Fields auto-filled from serverDZ.cfg', 'success');
      } else {
        setDetected(result || { found: false, reason: 'No DayZ server found' });
        window.addToast(result?.reason || 'No DayZ server found in this directory', 'error');
      }
    } catch (err) {
      window.addToast(err.message || 'Detection failed', 'error');
      setDetected({ found: false, reason: err.message });
    }
    setDetecting(false);
  };

  const deploy = async () => {
    if (!name || !installDir) { window.addToast('Name and install directory required', 'error'); return; }
    setDeploying(true); setStep(6);
    try {
      const result = await API.post('/api/deploy', { name, installDir, gameTitle, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map });
      if (result && result.error) { setProgress({ status: 'error', message: result.message || result.error }); setDeploying(false); }
    } catch (err) {
      setProgress({ status: 'error', message: err.message || 'Deploy request failed' }); setDeploying(false);
    }
  };

  const addExisting = async () => {
    if (!name || !installDir) { window.addToast('Name and install directory required', 'error'); return; }
    setDeploying(true); setStep(4);
    try {
      const result = await API.post('/api/servers', {
        name, installDir, executable, gameTitle,
        launchParams: `-config=serverDZ.cfg -port=${gamePort || 2302} -profiles=profiles -dologs -adminlog -netlog -freezecheck`,
        gamePort, queryPort, rconPort, rconPassword, maxPlayers, map,
      });
      if (result && result.error) {
        setProgress({ status: 'error', message: result.error }); setDeploying(false);
      } else {
        setProgress({ status: 'complete', message: 'Server added successfully!' });
        window.addToast('Server added successfully!', 'success');
        loadServers();
      }
    } catch (err) {
      setProgress({ status: 'error', message: err.message || 'Failed to add server' }); setDeploying(false);
    }
  };

  const cancelDeploy = () => { setStep(1); setMode(null); setDeploying(false); setDetected(null); setProgress({ status: '', message: '', progress: 0 }); };

  // Deploy New flow: 1. Mode → 2. Branch → 3. Server Details → 4. Steam Login → 5. Configuration → 6. Deploy
  // Existing flow:   1. Mode → 2. Detect → 3. Configuration → 4. Confirm
  const stepLabels = mode === 'existing'
    ? ['1. Mode', '2. Detect', '3. Configuration']
    : ['1. Mode', '2. Branch', '3. Server Details', '4. Steam Login', '5. Configuration'];

  const steamVerified = steamStatus?.loginValidated === true;

  return (
    <div>
      <div className="deploy-steps">
        {stepLabels.map((label, i) => (
          <div key={i} className={`deploy-step ${step >= i + 1 ? (step > i + 1 ? 'done' : 'active') : ''}`}>{label}</div>
        ))}
        <div className={`deploy-step ${(mode === 'existing' ? step >= 4 : step >= 6) ? (mode === 'existing' ? (step > 4 ? 'done' : 'active') : (step > 6 ? 'done' : 'active')) : ''}`}>{mode === 'existing' ? '4. Confirm' : '6. Deploy'}</div>
      </div>

      {/* ─── Step 1: Mode Selection ─── */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 20 }}>How would you like to add a server?</h3>
          <div className="grid grid-2" style={{ maxWidth: 500 }}>
            <div className={`game-card ${mode === 'new' ? 'selected' : ''}`} onClick={() => setMode('new')}>
              <div className="game-card-icon"><Rocket size={24} /></div>
              <div className="game-card-title">Deploy New</div>
              <div className="game-card-sub">Download via SteamCMD</div>
            </div>
            <div className={`game-card ${mode === 'existing' ? 'selected' : ''}`} onClick={() => setMode('existing')}>
              <div className="game-card-icon"><FolderOpen size={24} /></div>
              <div className="game-card-title">Add Existing</div>
              <div className="game-card-sub">Locate installed server</div>
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <button className="btn btn-blue" onClick={() => setStep(2)} disabled={!mode}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {/* ─── Step 2 (New): Branch Selection ─── */}
      {step === 2 && mode === 'new' && (
        <div>
          <h3 style={{ marginBottom: 20 }}>Select DayZ Branch</h3>
          <div className="grid grid-2" style={{ maxWidth: 500 }}>
            <div className={`game-card ${gameTitle === 'DayZ, PC' ? 'selected' : ''}`} onClick={() => setGameTitle('DayZ, PC')}>
              <div className="game-card-icon"><Monitor size={24} /></div>
              <div className="game-card-title">DayZ PC</div>
              <div className="game-card-sub">Stable Branch</div>
            </div>
            <div className={`game-card ${gameTitle === 'DayZ, PC (Experimental)' ? 'selected' : ''}`} onClick={() => setGameTitle('DayZ, PC (Experimental)')}>
              <div className="game-card-icon"><Zap size={24} /></div>
              <div className="game-card-title">DayZ PC</div>
              <div className="game-card-sub">Experimental</div>
            </div>
          </div>
          <div className="btn-group" style={{ marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-blue" onClick={() => setStep(3)}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {/* ─── Step 2 (Existing): Detect Server ─── */}
      {step === 2 && mode === 'existing' && (
        <div style={{ maxWidth: 500 }}>
          <h3 style={{ marginBottom: 20 }}>Locate Server Installation</h3>
          <div className="input-group">
            <label className="input-label">Install Directory</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input" style={{ flex: 1 }} value={installDir} onChange={e => { setInstallDir(e.target.value); setDetected(null); }} placeholder="C:\Program Files (x86)\Steam\steamapps\common\DayZServer" />
              <button className="btn btn-blue" onClick={detectServer} disabled={detecting || !installDir}>
                {detecting ? 'Scanning...' : <><Search size={14} /> Detect</>}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Enter the path to your DayZ server folder, then click Detect to auto-fill settings</div>
          </div>

          {detected && detected.found && (
            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 12, color: 'var(--text-success)' }}>Server Detected</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>Executable:</span> {detected.executable || 'Not found'}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>Config:</span> {detected.hasCfg ? 'serverDZ.cfg found' : 'Not found'}</div>
                {detected.config?.name && <div><span style={{ color: 'var(--text-muted)' }}>Hostname:</span> {detected.config.name}</div>}
                {detected.config?.maxPlayers && <div><span style={{ color: 'var(--text-muted)' }}>Max Players:</span> {detected.config.maxPlayers}</div>}
                {detected.config?.map && <div><span style={{ color: 'var(--text-muted)' }}>Map:</span> {detected.config.map}</div>}
                {detected.modCount > 0 && <div><span style={{ color: 'var(--text-muted)' }}>Mod Keys:</span> {detected.modCount}</div>}
              </div>
            </div>
          )}

          {detected && !detected.found && (
            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-error, var(--border))', borderRadius: 8, padding: 16, marginTop: 16, color: 'var(--text-error, #ef4444)' }}>
              {detected.reason || 'No DayZ server found in this directory'}
            </div>
          )}

          {detected && detected.found && (
            <>
              <div className="input-group" style={{ marginTop: 16 }}>
                <label className="input-label">Server Name</label>
                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My DayZ Server" />
              </div>
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
            </>
          )}

          <div className="btn-group" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => { setStep(1); setDetected(null); }}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-blue" onClick={() => setStep(3)} disabled={!detected?.found}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {/* ─── Step 3 (New): Server Details ─── */}
      {step === 3 && mode === 'new' && (
        <div style={{ maxWidth: 500 }}>
          <h3 style={{ marginBottom: 20 }}>Server Details</h3>
          <div className="input-group"><label className="input-label">Server Name</label><input className="input" value={name} onChange={e => {
            const newName = e.target.value;
            setName(newName);
            if (!dirManuallyEdited) {
              const sanitized = sanitizeDirName(newName);
              setInstallDir(sanitized ? DEPLOY_BASE + '\\' + sanitized : DEPLOY_BASE + '\\');
            }
          }} placeholder="My DayZ Server" /></div>
          <div className="input-group"><label className="input-label">Install Directory</label><input className="input" value={installDir} onChange={e => { setInstallDir(e.target.value); setDirManuallyEdited(true); }} />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Auto-generated from server name. Edit to override.</div>
          </div>
          <div className="input-group"><label className="input-label">Map</label>
            <select className="input" value={map} onChange={e => setMap(e.target.value)}>
              <option value="chernarusplus">Chernarus</option>
              <option value="enoch">Livonia</option>
              <option value="deerisle">Deer Isle</option>
              <option value="namalsk">Namalsk</option>
              <option value="sakhal">Sakhal</option>
              <option value="takistanplus">Takistan</option>
            </select>
          </div>
          <div className="btn-group" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-blue" onClick={() => { setStep(4); fetchSteamStatus(); }}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {/* ─── Step 4 (New): Steam Login Check ─── */}
      {step === 4 && mode === 'new' && (
        <div style={{ maxWidth: 500 }}>
          <h3 style={{ marginBottom: 8 }}>Steam Login</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            DayZ Dedicated Server requires an authenticated Steam account to download.
          </p>

          {steamLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              <Loader size={24} /> Checking Steam status...
            </div>
          ) : steamVerified ? (
            /* Already verified — show green status, no form needed */
            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, textAlign: 'center' }}>
              <Shield size={36} style={{ color: 'var(--text-success, #22c55e)', marginBottom: 12 }} />
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Steam Connected</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Logged in as <strong>{steamStatus?.username}</strong></div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                You can change your Steam account in <a href="/settings" style={{ color: 'var(--accent-blue)' }}>Settings</a>.
              </div>
            </div>
          ) : (
            /* Not verified — show inline form as fallback */
            <div>
              <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Tip:</strong> For the smoothest experience, use a dedicated Steam account with Steam Guard set to <strong>Email</strong> (not Mobile Authenticator).
              </div>

              <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
                <div className="input-group">
                  <label className="input-label">Steam Username</label>
                  <input className="input" value={steamUsername} onChange={e => setSteamUsername(e.target.value)} placeholder="your_steam_username" autoComplete="off" />
                </div>
                <div className="input-group">
                  <label className="input-label">Steam Password</label>
                  <input className="input" type="password" value={steamPassword} onChange={e => setSteamPassword(e.target.value)} placeholder="your_steam_password" autoComplete="off" />
                </div>

                {steamNeedsGuard && (
                  <div className="input-group">
                    <label className="input-label">Steam Guard Code</label>
                    <input className="input" value={steamGuardCode} onChange={e => setSteamGuardCode(e.target.value)} placeholder="XXXXX" maxLength={5} style={{ letterSpacing: '0.2em', textAlign: 'center', maxWidth: 140 }} autoComplete="off" />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Check your email or Steam mobile app for the code</div>
                  </div>
                )}

                {steamError && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#ef4444' }}>
                    <AlertTriangle size={14} /> {steamError}
                  </div>
                )}

                <button className="btn btn-primary" onClick={validateSteamCredentials} disabled={steamValidating || !steamUsername || !steamPassword} style={{ width: '100%' }}>
                  {steamValidating ? 'Verifying...' : (steamNeedsGuard ? 'Submit Guard Code' : 'Verify Steam Login')}
                </button>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
                  Your credentials are stored locally and used only for SteamCMD operations.
                </div>
              </div>
            </div>
          )}

          <div className="btn-group" style={{ marginTop: 20 }}>
            <button className="btn btn-secondary" onClick={() => setStep(3)}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-blue" onClick={() => setStep(5)} disabled={!steamVerified}>Next <ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {/* ─── Configuration Step (Step 3 existing / Step 5 new) ─── */}
      {((step === 3 && mode === 'existing') || (step === 5 && mode === 'new')) && (
        <div style={{ maxWidth: 500 }}>
          <h3 style={{ marginBottom: 20 }}>Configuration</h3>
          <div className="grid grid-2">
            <div className="input-group"><label className="input-label">Game Port</label><input className="input" type="number" value={gamePort} onChange={e => setGamePort(parseInt(e.target.value))} /></div>
            <div className="input-group"><label className="input-label">Query Port</label><input className="input" type="number" value={queryPort} onChange={e => setQueryPort(parseInt(e.target.value))} /></div>
            <div className="input-group"><label className="input-label">RCON Port</label><input className="input" type="number" value={rconPort} onChange={e => setRconPort(parseInt(e.target.value))} /></div>
            <div className="input-group"><label className="input-label">Max Players</label><input className="input" type="number" value={maxPlayers} onChange={e => setMaxPlayers(parseInt(e.target.value))} /></div>
          </div>
          <div className="input-group"><label className="input-label">RCON Password</label><input className="input" type="password" value={rconPassword} onChange={e => setRconPassword(e.target.value)} /></div>
          <div className="btn-group" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setStep(mode === 'existing' ? 2 : 4)}><ArrowLeft size={14} /> Back</button>
            {mode === 'new' ? (
              <button className="btn btn-primary" onClick={deploy}><Rocket size={14} /> Deploy Server</button>
            ) : (
              <button className="btn btn-primary" onClick={addExisting}><FolderOpen size={14} /> Add Server</button>
            )}
          </div>
        </div>
      )}

      {/* ─── Deploy/Confirm Progress Step ─── */}
      {((step === 4 && mode === 'existing') || (step === 6 && mode === 'new')) && (
        <div style={{ maxWidth: 500, textAlign: 'center', padding: '40px 0' }}>
          <div style={{ marginBottom: 16 }}>{progress.status === 'complete' ? <CheckCircle size={48} /> : progress.status === 'error' ? <XCircle size={48} /> : <Rocket size={48} />}</div>
          <h3 style={{ marginBottom: 12 }}>{progress.status === 'complete' ? (mode === 'existing' ? 'Server Added!' : 'Deployment Complete!') : progress.status === 'error' ? (mode === 'existing' ? 'Failed to Add Server' : 'Deployment Failed') : 'Deploying...'}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>{progress.message || 'Preparing deployment...'}</p>
          {progress.status !== 'complete' && progress.status !== 'error' && (
            <div className="progress-bar" style={{ maxWidth: 400, margin: '0 auto' }}>
              <div className="progress-fill" style={{ width: `${progress.progress || 5}%` }} />
            </div>
          )}
          {progress.status === 'complete' && <button className="btn btn-primary" onClick={cancelDeploy}>Done</button>}
          {progress.status === 'error' && <button className="btn btn-secondary" onClick={() => { setStep(mode === 'existing' ? 3 : 5); setDeploying(false); }}><ArrowLeft size={14} /> Go Back</button>}
          {progress.status !== 'complete' && progress.status !== 'error' && (
            <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={cancelDeploy}>Cancel</button>
          )}
        </div>
      )}
    </div>
  );
}
