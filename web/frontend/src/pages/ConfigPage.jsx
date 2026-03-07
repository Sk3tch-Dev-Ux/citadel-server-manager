import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import Modal from '../components/ui/Modal';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { Save, Bookmark, Trash2, RotateCcw, Plus, Clock } from '../components/Icon';

const MAX_TEMPLATES = 20;

export default function ConfigPage({ serverId }) {
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);

  // Template state
  const [templates, setTemplates] = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(null); // template object or null
  const [confirmDelete, setConfirmDelete] = useState(null);   // template object or null
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadConfig = useCallback(() => {
    API.get(`/api/servers/${serverId}/config`).then(setConfig);
  }, [serverId]);

  const loadTemplates = useCallback(() => {
    API.get(`/api/servers/${serverId}/config/templates`).then(data => {
      if (Array.isArray(data)) setTemplates(data);
    });
  }, [serverId]);

  useEffect(() => { loadConfig(); loadTemplates(); }, [loadConfig, loadTemplates]);

  const update = (key, value) => setConfig(c => ({ ...c, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const result = await API.patch(`/api/servers/${serverId}/config`, config);
      if (result.error) {
        window.addToast('Save failed: ' + result.error, 'error');
      } else {
        // Reload persisted config to reflect what's actually on disk
        setConfig(result);
        window.addToast('Config saved', 'success');
      }
    } catch (e) {
      window.addToast('Save failed: ' + (e.message || 'Unknown error'), 'error');
    }
    setSaving(false);
  };

  // Ctrl+S to save config
  useKeyboardShortcuts({ 'ctrl+s': () => save() });

  // ─── Template actions ─────────────────────────────────

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    setSavingTemplate(true);
    const result = await API.post(`/api/servers/${serverId}/config/templates`, { name: templateName.trim() });
    if (result.error) {
      window.addToast(result.error, 'error');
    } else {
      window.addToast(`Template "${result.name}" saved`, 'success');
      loadTemplates();
    }
    setSavingTemplate(false);
    setShowSaveModal(false);
    setTemplateName('');
  };

  const handleRestore = async (template) => {
    setRestoring(true);
    const result = await API.post(`/api/servers/${serverId}/config/templates/${template.id}/restore`);
    if (result.error) {
      window.addToast(result.error, 'error');
    } else {
      setConfig(result);
      window.addToast(`Restored template "${template.name}"`, 'success');
    }
    setRestoring(false);
    setConfirmRestore(null);
  };

  const handleDelete = async (template) => {
    setDeleting(true);
    const result = await API.del(`/api/servers/${serverId}/config/templates/${template.id}`);
    if (result.error) {
      window.addToast(result.error, 'error');
    } else {
      window.addToast(`Deleted template "${template.name}"`, 'success');
      loadTemplates();
    }
    setDeleting(false);
    setConfirmDelete(null);
  };

  const formatDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  // ─── Config Field Definitions (grouped by section) ────
  const sections = [
    {
      title: 'Server Identity',
      fields: [
        { key: 'hostname', label: 'Server Name', type: 'text', description: 'The name shown in the server browser.' },
        { key: 'description', label: 'Description', type: 'text', description: 'Server description shown in the DayZ Launcher.' },
        { key: 'maxPlayers', label: 'Max Players', type: 'number', description: 'Maximum number of players allowed.' },
        { key: 'password', label: 'Server Password', type: 'text', description: 'Password required to join. Leave empty for public.' },
        { key: 'passwordAdmin', label: 'Admin Password', type: 'text', description: 'Password for RCON admin access.' },
        { key: 'enableWhitelist', label: 'Enable Whitelist', type: 'toggle', description: 'Only allow whitelisted players to join.' },
        { key: 'template', label: 'Map Template', type: 'text', description: 'Mission template (e.g. dayzOffline.chernarusplus).' },
        { key: 'instanceId', label: 'Instance ID', type: 'number', description: 'Server instance identifier for persistence.' },
      ],
    },
    {
      title: 'Gameplay',
      fields: [
        { key: 'enableCfgGameplayFile', label: 'Enable Gameplay File', type: 'toggle', description: 'Load cfggameplay.json for custom gameplay settings.' },
        { key: 'disable3rdPerson', label: 'Disable 3rd Person', type: 'toggle', description: 'Disables third-person camera for players.' },
        { key: 'disableCrosshair', label: 'Disable Crosshair', type: 'toggle', description: 'Removes the crosshair from all players.' },
        { key: 'verifySignatures', label: 'Verify Signatures', type: 'toggle', description: 'Verify mod .pbo files against .bisign signatures.' },
        { key: 'forceSameBuild', label: 'Force Same Build', type: 'toggle', description: 'Require clients to match the server game build.' },
        { key: 'respawnTime', label: 'Respawn Time', type: 'number', description: 'Seconds before respawn button becomes available.' },
        { key: 'allowFilePatching', label: 'Allow File Patching', type: 'toggle', description: 'Allow clients with -filePatching launch parameter.' },
      ],
    },
    {
      title: 'Time & Environment',
      fields: [
        { key: 'serverTime', label: 'Server Time', type: 'text', description: 'Initial time. Use "SystemTime" or YYYY/MM/DD/HH/MM format.' },
        { key: 'serverTimeAcceleration', label: 'Day Time Acceleration', type: 'number', description: 'Daytime speed multiplier (1 = real time, 12 = 12x faster).' },
        { key: 'serverNightTimeAcceleration', label: 'Night Time Acceleration', type: 'number', description: 'Night speed multiplier relative to day acceleration (0.1–64).' },
        { key: 'serverTimePersistent', label: 'Persistent Time', type: 'toggle', description: 'Save and restore server time across restarts.' },
        { key: 'lightingConfig', label: 'Lighting Config', type: 'number', description: 'Night brightness (0 = brighter nights, 1 = darker nights).' },
        { key: 'disablePersonalLight', label: 'Disable Personal Light', type: 'toggle', description: 'Disable the faint personal light around all players.' },
      ],
    },
    {
      title: 'Voice & Communication',
      fields: [
        { key: 'disableVoN', label: 'Disable Voice Chat', type: 'toggle', description: 'Disable Voice over Network for all players.' },
        { key: 'vonCodecQuality', label: 'VoN Codec Quality', type: 'number', description: 'Voice codec quality (0–30). Higher is better.' },
        { key: 'motdInterval', label: 'MOTD Interval', type: 'number', description: 'Message of the Day display interval in seconds.' },
      ],
    },
    {
      title: 'Network & Performance',
      fields: [
        { key: 'maxPing', label: 'Max Ping', type: 'number', description: 'Maximum ping in ms before a player is kicked.' },
        { key: 'loginQueueConcurrentPlayers', label: 'Login Queue Concurrent', type: 'number', description: 'Players processed simultaneously during login.' },
        { key: 'loginQueueMaxPlayers', label: 'Login Queue Max', type: 'number', description: 'Maximum players allowed in login queue.' },
        { key: 'simulatedPlayersBatch', label: 'Simulated Players Batch', type: 'number', description: 'Player simulation limit per server frame.' },
        { key: 'multithreadedReplication', label: 'Multithreaded Replication', type: 'toggle', description: 'Enable multi-threaded network replication.' },
        { key: 'defaultVisibility', label: 'Terrain View Distance', type: 'number', description: 'Maximum terrain render distance in meters.' },
        { key: 'defaultObjectViewDistance', label: 'Object View Distance', type: 'number', description: 'Maximum object render distance in meters.' },
        { key: 'networkRangeClose', label: 'Network Range Close', type: 'number', description: 'Network bubble for nearby objects (meters).' },
        { key: 'networkRangeNear', label: 'Network Range Near', type: 'number', description: 'Network bubble for near inventory items (meters).' },
        { key: 'networkRangeFar', label: 'Network Range Far', type: 'number', description: 'Network bubble for far objects (meters).' },
        { key: 'networkRangeDistantEffect', label: 'Network Range Distant', type: 'number', description: 'Network bubble for effects and sounds (meters).' },
      ],
    },
    {
      title: 'Persistence & Base Building',
      fields: [
        { key: 'storageAutoFix', label: 'Storage Auto Fix', type: 'toggle', description: 'Automatically repair corrupted persistence files.' },
        { key: 'storeHouseStateDisabled', label: 'Disable House State', type: 'toggle', description: 'Disable persistence for house doors and windows.' },
        { key: 'disableBaseDamage', label: 'Disable Base Damage', type: 'toggle', description: 'Prevent damage to fences and watchtowers.' },
        { key: 'disableContainerDamage', label: 'Disable Container Damage', type: 'toggle', description: 'Prevent damage to tents, barrels, and crates.' },
        { key: 'lootHistory', label: 'Loot History', type: 'number', description: 'Number of persistence history files to retain.' },
      ],
    },
    {
      title: 'Logging',
      fields: [
        { key: 'logAverageFps', label: 'Log Average FPS', type: 'number', description: 'Log average server FPS every N seconds (requires -doLogs).' },
        { key: 'logMemory', label: 'Log Memory', type: 'number', description: 'Log server memory usage every N seconds.' },
        { key: 'logPlayers', label: 'Log Players', type: 'number', description: 'Log connected player count every N seconds.' },
        { key: 'adminLogPlayerHitsOnly', label: 'Log Player Hits Only', type: 'toggle', description: 'Only log player-to-player hits (not AI).' },
        { key: 'adminLogPlacement', label: 'Log Placements', type: 'toggle', description: 'Log item and object placement actions.' },
        { key: 'adminLogBuildActions', label: 'Log Build Actions', type: 'toggle', description: 'Log base building actions.' },
        { key: 'adminLogPlayerList', label: 'Log Player List', type: 'toggle', description: 'Log a full player list every 5 minutes.' },
        { key: 'enableDebugMonitor', label: 'Debug Monitor', type: 'toggle', description: 'Show character debug info window in-game.' },
        { key: 'timeStampFormat', label: 'Timestamp Format', type: 'text', description: 'Log timestamp format ("Full" or "Short").' },
      ],
    },
  ];

  return (
    <div>
      {/* Header row with config title and action buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div className="card-title">serverDZ.cfg Editor</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => { setTemplateName(''); setShowSaveModal(true); }}
            disabled={templates.length >= MAX_TEMPLATES}
            title={templates.length >= MAX_TEMPLATES ? 'Maximum templates reached' : 'Save current config as a template'}
          >
            <Bookmark size={14} /> Save as Template
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : <><Save size={14} /> Save Config</>}
          </button>
        </div>
      </div>

      {/* Config editor — grouped sections */}
      {sections.map(section => (
        <div key={section.title} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
            {section.title}
          </div>
          <div className="grid grid-2">
            {section.fields.map(f => (
              <div key={f.key} className="input-group">
                <label className="input-label">{f.label}</label>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{f.description}</div>
                {f.type === 'toggle' ? (
                  <div>
                    <label>
                      <input type="checkbox" checked={!!config[f.key]} onChange={e => update(f.key, e.target.checked ? 1 : 0)} />
                    </label>
                  </div>
                ) : (
                  <input className="input" type={f.type} value={config[f.key] ?? ''} onChange={e => update(f.key, f.type === 'number' ? (e.target.value === '' ? '' : parseInt(e.target.value) || 0) : e.target.value)} />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Templates panel */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            <Bookmark size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
            Config Templates
          </div>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{templates.length}/{MAX_TEMPLATES} templates</span>
        </div>
        {templates.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)' }}>
            No templates saved yet. Save your current config as a template to enable quick rollback.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {templates.map(t => (
              <div
                key={t.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={11} /> {formatDate(t.createdAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRestore(t)} title="Restore this template">
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(t)} title="Delete this template">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Template Modal */}
      <Modal open={showSaveModal} onClose={() => setShowSaveModal(false)} title="Save Config Template">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
          Save the current serverDZ.cfg values as a named template. You can restore it later to roll back your config.
        </p>
        <div className="input-group">
          <label className="input-label">Template Name</label>
          <input
            className="input"
            type="text"
            placeholder="e.g. Pre-wipe settings"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && templateName.trim()) handleSaveTemplate(); }}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={() => setShowSaveModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveTemplate} disabled={!templateName.trim() || savingTemplate}>
            {savingTemplate ? 'Saving...' : <><Bookmark size={14} /> Save Template</>}
          </button>
        </div>
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal open={!!confirmRestore} onClose={() => setConfirmRestore(null)} title="Restore Template">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8 }}>
          Are you sure you want to restore <strong>{confirmRestore?.name}</strong>?
        </p>
        <p style={{ color: 'var(--warning, #e5a539)', fontSize: 13, marginBottom: 20 }}>
          This will overwrite your current serverDZ.cfg with the values saved in this template. A backup will be created automatically.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setConfirmRestore(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleRestore(confirmRestore)} disabled={restoring}>
            {restoring ? 'Restoring...' : <><RotateCcw size={14} /> Restore</>}
          </button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Template">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
          Are you sure you want to delete the template <strong>{confirmDelete?.name}</strong>? This cannot be undone.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
          <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)} disabled={deleting}>
            {deleting ? 'Deleting...' : <><Trash2 size={14} /> Delete</>}
          </button>
        </div>
      </Modal>
    </div>
  );
}
