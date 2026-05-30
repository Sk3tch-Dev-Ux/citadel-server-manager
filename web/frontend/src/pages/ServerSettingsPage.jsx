import { useState, useEffect } from 'react';
import API from '../api';
import { formatBytes } from '../utils';
import Accordion from '../components/Accordion';
import SettingsToggle from '../components/SettingsToggle';
import DirectoryBrowserModal from '../components/DirectoryBrowserModal';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { X, Info, Download, Trash2, HardDrive, RotateCcw } from '../components/Icon';
import CloudLinkCard from '../components/CloudLinkCard';

export default function ServerSettingsPage({ serverId }) {
  const { confirm, DialogComponent } = useConfirmDialog();
  const [srv, setSrv] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newParam, setNewParam] = useState('');

  // Backup state
  const [backupConfig, setBackupConfig] = useState(null);
  const [backups, setBackups] = useState([]);
  const [newBackupPath, setNewBackupPath] = useState('');
  const [dirBrowserOpen, setDirBrowserOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(null); // filename of currently restoring backup

  const saveRef = { current: null };

  // Ctrl+S to save settings (must be before any conditional returns)
  useKeyboardShortcuts({ 'ctrl+s': () => saveRef.current?.() });

  // Default notification configs (must match backend DEFAULT_NOTIFICATIONS)
  const defaultNotifications = {
    shutdown:   { enabled: true, duration: 120, interval: 5, message: 'Server is restarting in {{countdown}} seconds', kickOnCountdown: false, lockOnCountdown: false },
    gameUpdate: { enabled: true, duration: 120, interval: 5, message: 'Server is restarting in {{countdown}} seconds', kickOnCountdown: false, lockOnCountdown: false },
    modUpdate:  { enabled: true, duration: 120, interval: 5, message: 'Server is restarting in {{countdown}} seconds', kickOnCountdown: false, lockOnCountdown: false },
  };

  useEffect(() => {
    API.get('/api/servers').then(servers => {
      const s = servers.find(x => x.id === serverId);
      if (s) {
        if (!s.launchParamsList && s.launchParams) {
          s.launchParamsList = s.launchParams.split(' ').filter(Boolean);
        } else if (!s.launchParamsList) {
          s.launchParamsList = [];
        }
        // Initialize notification configs with defaults for any missing fields
        if (!s.notifications) s.notifications = {};
        for (const type of ['shutdown', 'gameUpdate', 'modUpdate']) {
          s.notifications[type] = { ...defaultNotifications[type], ...(s.notifications[type] || {}) };
        }
        // Migrate old field name
        if (s.ignoreServerModUpdates !== undefined && s.ignoreModUpdates === undefined) {
          s.ignoreModUpdates = s.ignoreServerModUpdates;
        }
        setSrv(s);
      }
    });
    // Load backup config + list
    API.get(`/api/servers/${serverId}/backup-config`).then(data => {
      if (data && !data.error) setBackupConfig(data);
    }).catch(() => {});
    API.get(`/api/servers/${serverId}/backups`).then(data => {
      if (Array.isArray(data)) setBackups(data);
    }).catch(() => {});
  }, [serverId]);

  if (!srv) return null;

  const update = (key, val) => setSrv(s => ({ ...s, [key]: val }));
  const updateBackup = (key, val) => setBackupConfig(c => ({ ...c, [key]: val }));
  const updateNotification = (type, key, val) => setSrv(s => ({
    ...s,
    notifications: {
      ...s.notifications,
      [type]: { ...s.notifications[type], [key]: val },
    },
  }));

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
      const result = await API.patch('/api/servers/' + serverId, srv);
      if (result?.error) {
        window.addToast('Save failed: ' + result.error, 'error');
        setSaving(false);
        return;
      }
      if (backupConfig) {
        const backupResult = await API.put(`/api/servers/${serverId}/backup-config`, backupConfig);
        if (backupResult?.error) {
          window.addToast('Backup config save failed: ' + backupResult.error, 'error');
          setSaving(false);
          return;
        }
      }
      // Reload saved data to confirm persistence
      const servers = await API.get('/api/servers');
      const fresh = servers.find(x => x.id === serverId);
      if (fresh) {
        if (!fresh.launchParamsList && fresh.launchParams) {
          fresh.launchParamsList = fresh.launchParams.split(' ').filter(Boolean);
        } else if (!fresh.launchParamsList) {
          fresh.launchParamsList = [];
        }
        setSrv(fresh);
      }
      window.addToast('Settings saved', 'success');
    } catch (e) {
      window.addToast('Save failed: ' + (e.message || 'Unknown error'), 'error');
    }
    setSaving(false);
  };

  // Wire save function to keyboard shortcut ref
  saveRef.current = save;

  // ─── Backup helpers ─────────────────────────────────────
  const addBackupPath = (pathStr) => {
    const p = (pathStr || newBackupPath).trim();
    if (!p) return;
    if ((backupConfig.paths || []).includes(p)) {
      window.addToast?.('Path already added', 'error');
      return;
    }
    updateBackup('paths', [...(backupConfig.paths || []), p]);
    setNewBackupPath('');
  };

  const removeBackupPath = (idx) => {
    updateBackup('paths', (backupConfig.paths || []).filter((_, i) => i !== idx));
  };

  const triggerBackup = async () => {
    setBackingUp(true);
    try {
      const result = await API.post(`/api/servers/${serverId}/backups`);
      if (result.error) throw new Error(result.error);
      window.addToast?.(result.message || 'Backup created', 'success');
      const updated = await API.get(`/api/servers/${serverId}/backups`);
      if (Array.isArray(updated)) setBackups(updated);
    } catch (e) {
      window.addToast?.('Backup failed: ' + (e.message || 'Unknown error'), 'error');
    }
    setBackingUp(false);
  };

  const handleDeleteBackup = async (filename, type) => {
    if (!await confirm({ title: 'Delete Backup', message: `Delete backup ${filename}?`, confirmLabel: 'Delete', variant: 'danger' })) return;
    try {
      await API.del(`/api/servers/${serverId}/backups/${encodeURIComponent(filename)}?type=${type}`);
      setBackups(prev => prev.filter(b => !(b.filename === filename && b.type === type)));
      window.addToast?.('Backup deleted', 'success');
    } catch {
      window.addToast?.('Failed to delete backup', 'error');
    }
  };

  const downloadBackup = (filename, type) => {
    window.open(`/api/servers/${serverId}/backups/${encodeURIComponent(filename)}/download?type=${type}&token=${API.token}`, '_blank');
  };

  const handleRestoreBackup = async (filename, type) => {
    if (!await confirm({ title: 'Restore Backup', message: `Restore backup "${filename}"?\n\nThis will overwrite current server files. A safety backup will be created first.\n\nThe server must be stopped before restoring.`, confirmLabel: 'Restore', variant: 'danger' })) return;
    setRestoring(filename);
    try {
      const result = await API.post(`/api/servers/${serverId}/backups/${encodeURIComponent(filename)}/restore?type=${type}`);
      if (result.error) throw new Error(result.error);
      window.addToast?.(result.message || 'Backup restored successfully', 'success');
      // Refresh backup list (safety backup may have been created)
      const updated = await API.get(`/api/servers/${serverId}/backups`);
      if (Array.isArray(updated)) setBackups(updated);
    } catch (e) {
      window.addToast?.('Restore failed: ' + (e.message || 'Unknown error'), 'error');
    }
    setRestoring(null);
  };

  const formatSize = formatBytes;

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="settings-save-bar">
        <button className="settings-save-btn" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Citadel Cloud pairing — pasted Server ID + API key from citadels.cc */}
      <CloudLinkCard serverId={serverId} />

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
        <SettingsToggle
          label="Engine Auto-Tune (dayzsetting.xml)"
          checked={srv.engineAutoTune !== false}
          onChange={v => update('engineAutoTune', v)}
        />
        <div className="settings-hint" style={{ marginTop: -4 }}>
          On start, Citadel sizes the DayZ job system (max/reserved cores, queue depths) to this host&apos;s CPU. Disable to manage dayzsetting.xml manually.
        </div>
        <SettingsToggle
          label="Publish mod list to DZSA Launcher"
          checked={srv.dzsaPublish === true}
          onChange={v => update('dzsaPublish', v)}
        />
        <div className="settings-hint" style={{ marginTop: -4 }}>
          Serves this server&apos;s mod list at <code>http://{srv.ip || 'SERVER_IP'}:{(parseInt(srv.gamePort) || 2302) + 10}/</code> so the DayZ Standalone Launcher can discover it and players can one-click-subscribe to the exact mod set. Requires opening that port in your firewall.
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

      <Accordion title="Notifications" icon="" defaultOpen={true}>
        <SettingsToggle label="Auto-Update Enabled" checked={!!srv.autoUpdateEnabled} onChange={v => update('autoUpdateEnabled', v)} />
        <div className="settings-hint" style={{ marginBottom: 16, marginTop: -4 }}>
          When enabled, detected game and mod updates will automatically trigger the shutdown/update/restart pipeline.
        </div>

        <SettingsToggle label="Shutdown for mod updates" checked={srv.shutdownForModUpdates !== false} onChange={v => update('shutdownForModUpdates', v)} />
        <SettingsToggle label="Shutdown for title updates" checked={srv.shutdownForTitleUpdates !== false} onChange={v => update('shutdownForTitleUpdates', v)} />
        <SettingsToggle label="Ignore server-side mod updates" checked={!!srv.ignoreModUpdates} onChange={v => update('ignoreModUpdates', v)} />

        {/* ── Shutdown Notification ─────────────────────── */}
        <div style={{ marginTop: 20, padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
          <SettingsToggle label="Shutdown Notification" checked={srv.notifications.shutdown.enabled} onChange={v => updateNotification('shutdown', 'enabled', v)} />
          <div className="settings-row">
            <span className="settings-row-label">Duration (seconds):</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={0} value={srv.notifications.shutdown.duration} onChange={e => updateNotification('shutdown', 'duration', parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Interval (seconds):</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={1} value={srv.notifications.shutdown.interval} onChange={e => updateNotification('shutdown', 'interval', parseInt(e.target.value) || 5)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Message:</span>
            <div className="settings-row-value">
              <input className="input" value={srv.notifications.shutdown.message} onChange={e => updateNotification('shutdown', 'message', e.target.value)} />
              <div className="settings-hint">Available placeholders: {'{{countdown}}'}</div>
            </div>
          </div>
          <SettingsToggle label="Kick on countdown" checked={!!srv.notifications.shutdown.kickOnCountdown} onChange={v => updateNotification('shutdown', 'kickOnCountdown', v)} />
          <SettingsToggle label="Lock server on countdown" checked={!!srv.notifications.shutdown.lockOnCountdown} onChange={v => updateNotification('shutdown', 'lockOnCountdown', v)} />
        </div>

        {/* ── Update Game Notification ─────────────────── */}
        <div style={{ marginTop: 12, padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
          <SettingsToggle label="Update Game Notification" checked={srv.notifications.gameUpdate.enabled} onChange={v => updateNotification('gameUpdate', 'enabled', v)} />
          <div className="settings-row">
            <span className="settings-row-label">Duration (seconds):</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={0} value={srv.notifications.gameUpdate.duration} onChange={e => updateNotification('gameUpdate', 'duration', parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Interval (seconds):</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={1} value={srv.notifications.gameUpdate.interval} onChange={e => updateNotification('gameUpdate', 'interval', parseInt(e.target.value) || 5)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Message:</span>
            <div className="settings-row-value">
              <input className="input" value={srv.notifications.gameUpdate.message} onChange={e => updateNotification('gameUpdate', 'message', e.target.value)} />
              <div className="settings-hint">Available placeholders: {'{{countdown}}'}</div>
            </div>
          </div>
          <SettingsToggle label="Kick on countdown" checked={!!srv.notifications.gameUpdate.kickOnCountdown} onChange={v => updateNotification('gameUpdate', 'kickOnCountdown', v)} />
          <SettingsToggle label="Lock server on countdown" checked={!!srv.notifications.gameUpdate.lockOnCountdown} onChange={v => updateNotification('gameUpdate', 'lockOnCountdown', v)} />
        </div>

        {/* ── Update Mod Notification ──────────────────── */}
        <div style={{ marginTop: 12, padding: 16, background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
          <SettingsToggle label="Update Mod Notification" checked={srv.notifications.modUpdate.enabled} onChange={v => updateNotification('modUpdate', 'enabled', v)} />
          <div className="settings-row">
            <span className="settings-row-label">Duration (seconds):</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={0} value={srv.notifications.modUpdate.duration} onChange={e => updateNotification('modUpdate', 'duration', parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Interval (seconds):</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={1} value={srv.notifications.modUpdate.interval} onChange={e => updateNotification('modUpdate', 'interval', parseInt(e.target.value) || 5)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Message:</span>
            <div className="settings-row-value">
              <input className="input" value={srv.notifications.modUpdate.message} onChange={e => updateNotification('modUpdate', 'message', e.target.value)} />
              <div className="settings-hint">Available placeholders: {'{{countdown}}'}, {'{{mod}}'}</div>
            </div>
          </div>
          <SettingsToggle label="Kick on countdown" checked={!!srv.notifications.modUpdate.kickOnCountdown} onChange={v => updateNotification('modUpdate', 'kickOnCountdown', v)} />
          <SettingsToggle label="Lock server on countdown" checked={!!srv.notifications.modUpdate.lockOnCountdown} onChange={v => updateNotification('modUpdate', 'lockOnCountdown', v)} />
        </div>
      </Accordion>

      {/* ─── Backup Settings ─────────────────────────────── */}
      {backupConfig && (
        <Accordion title="Backup Settings" icon="">
          <SettingsToggle label="Enable Automated Backups" checked={!!backupConfig.enabled} onChange={v => updateBackup('enabled', v)} />
          <SettingsToggle label="Backup at Startup" checked={!!backupConfig.backupAtStartup} onChange={v => updateBackup('backupAtStartup', v)} />

          <div className="settings-row">
            <span className="settings-row-label">Backup Interval (minutes)</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={5} max={1440}
                value={backupConfig.intervalMinutes || 60}
                onChange={e => updateBackup('intervalMinutes', parseInt(e.target.value) || 60)} />
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Maximum Keep Time (days)</span>
            <div className="settings-row-value">
              <input className="input" type="number" min={1} max={90}
                value={backupConfig.maxKeepDays || 7}
                onChange={e => updateBackup('maxKeepDays', parseInt(e.target.value) || 7)} />
            </div>
          </div>

          {/* Backup Paths */}
          <div style={{ marginTop: 14 }}>
            <div className="settings-row-label" style={{ marginBottom: 8, fontWeight: 600 }}>Backup Paths</div>
            <div className="info-banner">
              <Info size={14} />
              <span>
                <strong>Important:</strong> Define directory paths to backup. Use the Browse button to select directories or enter relative paths manually like &quot;saves&quot; or &quot;mpmissions&quot;. Wildcards are supported (e.g., &quot;profiles/*.ADM&quot;, &quot;mpmissions/*&quot;). Without paths, backups will not function.
              </span>
            </div>

            {(backupConfig.paths || []).map((p, i) => (
              <div className="backup-path-item" key={i}>
                <span>{p}</span>
                <span className="path-remove" onClick={() => removeBackupPath(i)} title="Remove">
                  <Trash2 size={14} />
                </span>
              </div>
            ))}

            <div className="chip-add" style={{ marginTop: 8 }}>
              <input className="input" placeholder="Enter directory path (e.g., saves)" value={newBackupPath}
                onChange={e => setNewBackupPath(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addBackupPath(); }}
                style={{ flex: 1 }} />
              <button className="btn btn-primary btn-sm" onClick={() => setDirBrowserOpen(true)}>Browse</button>
              <button className="btn btn-primary btn-sm" onClick={() => addBackupPath()}>Add</button>
            </div>
          </div>

          {/* Manual Backup + History */}
          <div className="backup-section-divider">
            <div className="backup-actions-row">
              <button className="btn btn-primary btn-sm" onClick={triggerBackup} disabled={backingUp}>
                <HardDrive size={14} /> {backingUp ? 'Creating Backup...' : 'Backup Now'}
              </button>
              {backupConfig.lastBackupAt && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Last backup: {new Date(backupConfig.lastBackupAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {backups.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="settings-row-label" style={{ marginBottom: 8, fontWeight: 600 }}>Backup History</div>
              <div className="backup-list">
                {backups.map(b => (
                  <div className="backup-list-item" key={b.filename + b.type}>
                    <div className="backup-info">
                      <div className="backup-name">{b.filename}</div>
                      <div className="backup-meta">
                        <span className={`backup-type-badge ${b.type}`}>{b.type}</span>
                        {' '}{formatSize(b.size)} &middot; {new Date(b.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="backup-actions">
                      <button className="btn btn-sm btn-icon btn-ghost" onClick={() => handleRestoreBackup(b.filename, b.type)}
                        title="Restore" disabled={restoring === b.filename}>
                        <RotateCcw size={14} className={restoring === b.filename ? 'spin' : ''} />
                      </button>
                      <button className="btn btn-sm btn-icon btn-ghost" onClick={() => downloadBackup(b.filename, b.type)} title="Download">
                        <Download size={14} />
                      </button>
                      <button className="btn btn-sm btn-icon btn-ghost btn-danger-ghost" onClick={() => handleDeleteBackup(b.filename, b.type)} title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DirectoryBrowserModal
            open={dirBrowserOpen}
            onClose={() => setDirBrowserOpen(false)}
            serverId={serverId}
            onSelect={(dirPath) => {
              addBackupPath(dirPath);
              setDirBrowserOpen(false);
            }}
          />
        </Accordion>
      )}

      <Accordion title="Dangerzone" icon="" danger={true}>
        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
          Server wipes, rebuilds, replication, and destructive operations have moved to the dedicated Dangerzone page.
        </div>
        <a href={`/servers/${serverId}/dangerzone`} className="btn btn-danger btn-sm" style={{ textDecoration: 'none' }}>
          Open Dangerzone
        </a>
      </Accordion>

      {DialogComponent}
    </div>
  );
}
