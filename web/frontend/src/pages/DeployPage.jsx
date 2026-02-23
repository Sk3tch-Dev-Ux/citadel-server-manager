import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';

export default function DeployPage({ onDeployed }) {
  const socket = useSocket();
  const [step, setStep] = useState(1);
  const [gameTitle, setGameTitle] = useState('DayZ, PC');
  const [name, setName] = useState('');
  const [installDir, setInstallDir] = useState('C:\\DayZServer');
  const [gamePort, setGamePort] = useState(2302);
  const [queryPort, setQueryPort] = useState(2303);
  const [rconPort, setRconPort] = useState(2305);
  const [rconPassword, setRconPassword] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(60);
  const [map, setMap] = useState('chernarusplus');
  const [deploying, setDeploying] = useState(false);
  const [progress, setProgress] = useState({ status: '', message: '', progress: 0 });

  useEffect(() => {
    const handler = (data) => {
      setProgress(data);
      if (data.status === 'complete') { window.addToast('Server deployed successfully!', 'success'); if (onDeployed) onDeployed(); }
      else if (data.status === 'error') { window.addToast(data.message, 'error'); setDeploying(false); }
    };
    socket.on('deployProgress', handler);
    return () => socket.off('deployProgress', handler);
  }, [onDeployed, socket]);

  const deploy = async () => {
    if (!name || !installDir) { window.addToast('Name and install directory required', 'error'); return; }
    setDeploying(true); setStep(4);
    await API.post('/api/deploy', { name, installDir, gameTitle, gamePort, queryPort, rconPort, rconPassword, maxPlayers, map });
  };

  return (
    <div>
      <div className="deploy-steps">
        <div className={`deploy-step ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`}>1. Game Title</div>
        <div className={`deploy-step ${step >= 2 ? (step > 2 ? 'done' : 'active') : ''}`}>2. Server Details</div>
        <div className={`deploy-step ${step >= 3 ? (step > 3 ? 'done' : 'active') : ''}`}>3. Configuration</div>
        <div className={`deploy-step ${step >= 4 ? 'active' : ''}`}>4. Deploy</div>
      </div>

      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 20 }}>Select Game Title</h3>
          <div className="grid grid-2" style={{ maxWidth: 500 }}>
            <div className={`game-card ${gameTitle === 'DayZ, PC' ? 'selected' : ''}`} onClick={() => setGameTitle('DayZ, PC')}>
              <div className="game-card-icon">{'\uD83C\uDFAE'}</div>
              <div className="game-card-title">DayZ PC</div>
              <div className="game-card-sub">Stable Branch</div>
            </div>
            <div className={`game-card ${gameTitle === 'DayZ, PC (Experimental)' ? 'selected' : ''}`} onClick={() => setGameTitle('DayZ, PC (Experimental)')}>
              <div className="game-card-icon">{'\uD83E\uDDEA'}</div>
              <div className="game-card-title">DayZ PC</div>
              <div className="game-card-sub">Experimental</div>
            </div>
          </div>
          <div style={{ marginTop: 24 }}><button className="btn btn-blue" onClick={() => setStep(2)}>Next {'\u2192'}</button></div>
        </div>
      )}

      {step === 2 && (
        <div style={{ maxWidth: 500 }}>
          <h3 style={{ marginBottom: 20 }}>Server Details</h3>
          <div className="input-group"><label className="input-label">Server Name</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My DayZ Server" /></div>
          <div className="input-group"><label className="input-label">Install Directory</label><input className="input" value={installDir} onChange={e => setInstallDir(e.target.value)} /></div>
          <div className="input-group"><label className="input-label">Map</label>
            <select className="input" value={map} onChange={e => setMap(e.target.value)}>
              <option value="chernarusplus">Chernarus</option>
              <option value="enoch">Livonia</option>
              <option value="deerisle">Deer Isle</option>
              <option value="namalsk">Namalsk</option>
            </select>
          </div>
          <div className="btn-group" style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>{'\u2190'} Back</button>
            <button className="btn btn-blue" onClick={() => setStep(3)}>Next {'\u2192'}</button>
          </div>
        </div>
      )}

      {step === 3 && (
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
            <button className="btn btn-secondary" onClick={() => setStep(2)}>{'\u2190'} Back</button>
            <button className="btn btn-primary" onClick={deploy}>{'\uD83D\uDE80'} Deploy Server</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div style={{ maxWidth: 500, textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{progress.status === 'complete' ? '\u2705' : progress.status === 'error' ? '\u274C' : '\uD83D\uDE80'}</div>
          <h3 style={{ marginBottom: 12 }}>{progress.status === 'complete' ? 'Deployment Complete!' : progress.status === 'error' ? 'Deployment Failed' : 'Deploying...'}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>{progress.message || 'Preparing deployment...'}</p>
          {progress.status !== 'complete' && progress.status !== 'error' && (
            <div className="progress-bar" style={{ maxWidth: 400, margin: '0 auto' }}>
              <div className="progress-fill" style={{ width: `${progress.progress || 5}%` }} />
            </div>
          )}
          {progress.status === 'complete' && <button className="btn btn-primary" onClick={() => { setStep(1); setDeploying(false); }}>Done</button>}
          {progress.status === 'error' && <button className="btn btn-secondary" onClick={() => { setStep(3); setDeploying(false); }}>{'\u2190'} Go Back</button>}
        </div>
      )}
    </div>
  );
}
