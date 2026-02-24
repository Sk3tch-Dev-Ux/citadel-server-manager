import { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import API from '../api';
import Accordion from '../components/Accordion';
import SettingsToggle from '../components/SettingsToggle';
import { X } from '../components/Icon';

export default function ServerSettingsPage({ serverId }) {
  const socket = useSocket();
  const [srv, setSrv] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newParam, setNewParam] = useState('');

  useEffect(() => {
    API.get('/api/servers').then(servers => {
      const s = servers.find(x => x.id === serverId);
      if (s) {
        if (!s.launchParamsList && s.launchParams) {
          s.launchParamsList = s.launchParams.split(' ').filter(Boolean);
        } else if (!s.launchParamsList) {
          s.launchParamsList = [];
        }
        setSrv(s);
      }
    });
  }, [serverId]);

  if (!srv) return null;

  const update = (key, val) => setSrv(s => ({ ...s, [key]: val }));

  const addParam = () => {
    if (!newParam.trim()) return;
    const list = [...(srv.launchParamsList || []), newParam.trim()];
    update('launchParamsList', list);
    update('launchParams', list.join(' '));
    setNewParam('');
  };

  const removeParam = (idx) => {
    const list = (srv.launchParamsList || []).filter((_, i) => i !== idx);
    update('launchParamsList', list);
    update('launchParams', list.join(' '));
  };

  const save = async () => {
    setSaving(true);
    try {
      await API.patch('/api/servers/' + serverId, srv);
      window.addToast('Settings saved', 'success');
    } catch (e) {
      window.addToast('Save failed: ' + e.message, 'error');
    }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="settings-save-bar">
        <button className="settings-save-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <Accordion title="Process" icon="" defaultOpen={true}>
        <div style={{ marginBottom: 14 }}>
          <div className="settings-row-label" style={{ marginBottom: 8 }}>Launch Params</div>
          <div className="chip-list">
            {(srv.launchParamsList || []).map((p, i) => (
              <div className="chip" key={i}>
                {p}
                <span className="chip-remove" onClick={() => removeParam(i)} title="Remove"><X size={12} /></span>
              </div>
            ))}
          </div>
          <div className="chip-add">
            <input className="input" placeholder="Add new launch parameter..." value={newParam}
              onChange={e => setNewParam(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addParam(); }} />
            <button className="btn btn-primary btn-sm" onClick={addParam}>Add</button>
          </div>
        </div>
        <SettingsToggle label="Auto-Start Server" checked={!!srv.autoStart} onChange={v => update('autoStart', v)} />
        <div className="settings-row">
          <span className="settings-row-label">Game Port</span>
          <div className="settings-row-value"><input className="input" type="number" value={srv.gamePort || 2302} onChange={e => update('gamePort', parseInt(e.target.value) || 2302)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Query Port</span>
          <div className="settings-row-value"><input className="input" type="number" value={srv.queryPort || 2303} onChange={e => update('queryPort', parseInt(e.target.value) || 2303)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">RCon Port</span>
          <div className="settings-row-value"><input className="input" type="number" value={srv.rconPort || 2305} onChange={e => update('rconPort', parseInt(e.target.value) || 2305)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Network Interface</span>
          <div className="settings-row-value"><input className="input" value={srv.networkInterface || '0.0.0.0'} onChange={e => update('networkInterface', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">RCon Password</span>
          <div className="settings-row-value">
            <input className="input" value={srv.rconPassword || ''} onChange={e => update('rconPassword', e.target.value)} />
            <div className="settings-hint">{(srv.rconPassword || '').length}/255 characters &nbsp;&nbsp; battleye_rcon RCon</div>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">CPU Affinity Mask</span>
          <div className="settings-row-value">
            <input className="input" type="number" value={srv.cpuAffinity || 0} onChange={e => update('cpuAffinity', parseInt(e.target.value) || 0)} />
            <div className="settings-hint">{srv.cpuAffinity ? 'Custom Affinity Mask Configured (' + srv.cpuAffinity + ')' : 'Default (all cores)'}</div>
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Priority Level</span>
          <div className="settings-row-value">
            <select className="input" value={srv.priorityLevel || 'Normal'} onChange={e => update('priorityLevel', e.target.value)}>
              <option value="Idle">Idle</option>
              <option value="BelowNormal">Below Normal</option>
              <option value="Normal">Normal</option>
              <option value="AboveNormal">Above Normal</option>
              <option value="High">High</option>
              <option value="RealTime">Real Time</option>
            </select>
          </div>
        </div>
      </Accordion>

      <Accordion title="Environment" icon="">
        <div className="settings-row">
          <span className="settings-row-label">Server Name</span>
          <div className="settings-row-value"><input className="input" value={srv.name || ''} onChange={e => update('name', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Install Directory</span>
          <div className="settings-row-value"><input className="input" value={srv.installDir || ''} onChange={e => update('installDir', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Profile Directory</span>
          <div className="settings-row-value"><input className="input" value={srv.profileDir || ''} onChange={e => update('profileDir', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Executable</span>
          <div className="settings-row-value"><input className="input" value={srv.executable || ''} onChange={e => update('executable', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Start Batch File</span>
          <div className="settings-row-value"><input className="input" value={srv.startBat || ''} onChange={e => update('startBat', e.target.value)} placeholder="Optional .bat file" /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Server IP</span>
          <div className="settings-row-value"><input className="input" value={srv.ip || '127.0.0.1'} onChange={e => update('ip', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Map</span>
          <div className="settings-row-value"><input className="input" value={srv.map || 'chernarusplus'} onChange={e => update('map', e.target.value)} /></div>
        </div>
        <div className="settings-row">
          <span className="settings-row-label">Game Title</span>
          <div className="settings-row-value"><input className="input" value={srv.gameTitle || 'DayZ, PC'} onChange={e => update('gameTitle', e.target.value)} /></div>
        </div>
      </Accordion>

      <Accordion title="Server Operations" icon="">
        <SettingsToggle label="Process Integrity Checks" checked={!!srv.processIntegrityChecks} onChange={v => update('processIntegrityChecks', v)} />
        <SettingsToggle label="Integrity Check Mods" checked={!!srv.integrityCheckMods} onChange={v => update('integrityCheckMods', v)} />
        <div className="settings-row">
          <span className="settings-row-label">Grace period for process start (seconds)</span>
          <div className="settings-row-value"><input className="input" type="number" value={srv.startGracePeriod || 30} onChange={e => update('startGracePeriod', parseInt(e.target.value) || 30)} /></div>
        </div>
        <SettingsToggle label="Server Health Monitoring" checked={!!srv.healthMonitoring} onChange={v => update('healthMonitoring', v)} />
        {srv.healthMonitoring && (
          <div style={{ padding: '8px 0 0 0' }}>
            <div className="settings-row">
              <span className="settings-row-label">Min FPS Threshold</span>
              <div className="settings-row-value"><input className="input" type="number" value={srv.healthMinFPS || 5} onChange={e => update('healthMinFPS', parseInt(e.target.value) || 5)} /></div>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Max RAM % Threshold</span>
              <div className="settings-row-value"><input className="input" type="number" value={srv.healthMaxRAM || 90} onChange={e => update('healthMaxRAM', parseInt(e.target.value) || 90)} /></div>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Action on Threshold</span>
              <div className="settings-row-value">
                <select className="input" value={srv.healthAction || 'log'} onChange={e => update('healthAction', e.target.value)}>
                  <option value="log">Log Warning Only</option>
                  <option value="restart">Auto-Restart Server</option>
                  <option value="webhook">Send Webhook Alert</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </Accordion>

      <Accordion title="Update Behaviour" icon="">
        <SettingsToggle label="Shutdown for mod updates" checked={srv.shutdownForModUpdates !== false} onChange={v => update('shutdownForModUpdates', v)} />
        <SettingsToggle label="Shutdown for title updates" checked={srv.shutdownForTitleUpdates !== false} onChange={v => update('shutdownForTitleUpdates', v)} />
        <SettingsToggle label="Ignore server-side mod updates" checked={!!srv.ignoreServerModUpdates} onChange={v => update('ignoreServerModUpdates', v)} />
      </Accordion>

      <Accordion title="Dangerzone" icon="" danger={true}>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
          These operations can permanently affect your server. Proceed with caution.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-danger btn-sm" onClick={() => {
            if (window.confirm('Are you sure you want to delete this server from the panel? This does not delete server files.')) {
              API.del('/api/servers/' + serverId).then(() => {
                window.addToast('Server removed from panel', 'success');
                window.location.reload();
              });
            }
          }}>Delete Server</button>
          <button className="btn btn-danger btn-sm" onClick={() => {
            if (window.confirm('Are you sure you want to WIPE and REINSTALL this server?')) {
              window.addToast('Rebuild initiated', 'info');
              API.post(`/api/servers/${serverId}/rebuild`).then(resp => {
                window.addToast(resp.message || 'Rebuild complete!', 'success');
              }).catch(err => {
                window.addToast(err?.error || err?.message || 'Rebuild failed', 'error');
              });
              const handler = (data) => {
                if (data.serverId === serverId) {
                  window.addToast(data.message || data.status, data.status === 'error' ? 'error' : 'info');
                }
              };
              socket.on('dangerzoneProgress', handler);
              setTimeout(() => socket.off('dangerzoneProgress', handler), 60000);
            }
          }}>Wipe & Reinstall Server</button>
        </div>
      </Accordion>
    </div>
  );
}
