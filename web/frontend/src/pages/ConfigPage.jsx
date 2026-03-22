import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';
import Modal from '../components/ui/Modal';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { Save, Bookmark, Trash2, RotateCcw, Clock, Search } from '../components/Icon';

const MAX_TEMPLATES = 20;

// ─── Config Field Definitions (grouped by section) ────────────────
const SECTIONS = [
  {
    title: 'Server Identity',
    color: 'var(--accent-blue)',
    fields: [
      { key: 'hostname', label: 'hostname', type: 'text', description: 'Server name shown in the server browser' },
      { key: 'description', label: 'description', type: 'text', description: 'Server description shown in the DayZ Launcher' },
      { key: 'maxPlayers', label: 'maxPlayers', type: 'number', description: 'Maximum number of players allowed' },
      { key: 'password', label: 'password', type: 'text', description: 'Password required to join (empty = public)' },
      { key: 'passwordAdmin', label: 'passwordAdmin', type: 'text', description: 'Password for RCON admin access' },
      { key: 'enableWhitelist', label: 'enableWhitelist', type: 'toggle', description: 'Only allow whitelisted players to join (0/1)' },
      { key: 'instanceId', label: 'instanceId', type: 'number', description: 'Server instance identifier for persistence' },
    ],
  },
  {
    title: 'Gameplay',
    color: 'var(--accent-green)',
    fields: [
      { key: 'enableCfgGameplayFile', label: 'enableCfgGameplayFile', type: 'toggle', description: 'Load cfggameplay.json for custom gameplay settings (0/1)' },
      { key: 'disable3rdPerson', label: 'disable3rdPerson', type: 'toggle', description: 'Disable third-person camera for all players (0/1)' },
      { key: 'disableCrosshair', label: 'disableCrosshair', type: 'toggle', description: 'Remove the crosshair from all players (0/1)' },
      { key: 'verifySignatures', label: 'verifySignatures', type: 'number', description: 'Verify mod .pbo signatures (only 2 is supported)' },
      { key: 'forceSameBuild', label: 'forceSameBuild', type: 'toggle', description: 'Require clients to match the server game build (0/1)' },
      { key: 'respawnTime', label: 'respawnTime', type: 'number', description: 'Seconds before respawn button becomes available' },
      { key: 'allowFilePatching', label: 'allowFilePatching', type: 'toggle', description: 'Allow clients with -filePatching launch parameter (0/1)' },
    ],
  },
  {
    title: 'Time & Environment',
    color: 'var(--accent-purple, #a78bfa)',
    fields: [
      { key: 'serverTime', label: 'serverTime', type: 'text', description: 'Initial time — use "SystemTime" or YYYY/MM/DD/HH/MM format' },
      { key: 'serverTimeAcceleration', label: 'serverTimeAcceleration', type: 'number', description: 'Daytime speed multiplier (1 = real time, 24 = 24x faster)' },
      { key: 'serverNightTimeAcceleration', label: 'serverNightTimeAcceleration', type: 'number', description: 'Night speed multiplier relative to day acceleration (0.1–64)' },
      { key: 'serverTimePersistent', label: 'serverTimePersistent', type: 'toggle', description: 'Save and restore server time across restarts (0/1)' },
      { key: 'lightingConfig', label: 'lightingConfig', type: 'number', description: 'Night brightness (0 = brighter nights, 1 = darker nights)' },
      { key: 'disablePersonalLight', label: 'disablePersonalLight', type: 'toggle', description: 'Disable the faint personal light around all players (0/1)' },
    ],
  },
  {
    title: 'Voice & Communication',
    color: 'var(--accent-orange, #f59e0b)',
    fields: [
      { key: 'disableVoN', label: 'disableVoN', type: 'toggle', description: 'Disable Voice over Network for all players (0/1)' },
      { key: 'vonCodecQuality', label: 'vonCodecQuality', type: 'number', description: 'Voice codec quality (0–30, higher is better)' },
      { key: 'motdInterval', label: 'motdInterval', type: 'number', description: 'Message of the Day display interval in seconds' },
    ],
  },
  {
    title: 'Network & Performance',
    color: 'var(--accent-red)',
    fields: [
      { key: 'maxPing', label: 'maxPing', type: 'number', description: 'Maximum ping (ms) before a player is kicked' },
      { key: 'loginQueueConcurrentPlayers', label: 'loginQueueConcurrentPlayers', type: 'number', description: 'Players processed simultaneously during login' },
      { key: 'loginQueueMaxPlayers', label: 'loginQueueMaxPlayers', type: 'number', description: 'Maximum players allowed in login queue' },
      { key: 'simulatedPlayersBatch', label: 'simulatedPlayersBatch', type: 'number', description: 'Player simulation limit per server frame' },
      { key: 'multithreadedReplication', label: 'multithreadedReplication', type: 'toggle', description: 'Enable multi-threaded network replication (0/1)' },
      { key: 'guaranteedUpdates', label: 'guaranteedUpdates', type: 'number', description: 'Communication protocol (always use 1)' },
      { key: 'defaultVisibility', label: 'defaultVisibility', type: 'number', description: 'Maximum terrain render distance in meters' },
      { key: 'defaultObjectViewDistance', label: 'defaultObjectViewDistance', type: 'number', description: 'Maximum object render distance in meters' },
      { key: 'networkRangeClose', label: 'networkRangeClose', type: 'number', description: 'Network bubble for nearby objects (meters)' },
      { key: 'networkRangeNear', label: 'networkRangeNear', type: 'number', description: 'Network bubble for near inventory items (meters)' },
      { key: 'networkRangeFar', label: 'networkRangeFar', type: 'number', description: 'Network bubble for far objects (meters)' },
      { key: 'networkRangeDistantEffect', label: 'networkRangeDistantEffect', type: 'number', description: 'Network bubble for effects and sounds (meters)' },
    ],
  },
  {
    title: 'Persistence & Base Building',
    color: 'var(--accent-green)',
    fields: [
      { key: 'storageAutoFix', label: 'storageAutoFix', type: 'toggle', description: 'Auto-repair corrupted persistence files (0/1)' },
      { key: 'storeHouseStateDisabled', label: 'storeHouseStateDisabled', type: 'toggle', description: 'Disable persistence for house doors and windows (0/1)' },
      { key: 'disableBaseDamage', label: 'disableBaseDamage', type: 'toggle', description: 'Prevent damage to fences and watchtowers (0/1)' },
      { key: 'disableContainerDamage', label: 'disableContainerDamage', type: 'toggle', description: 'Prevent damage to tents, barrels, and crates (0/1)' },
      { key: 'lootHistory', label: 'lootHistory', type: 'number', description: 'Number of persistence history files to retain' },
    ],
  },
  {
    title: 'Logging',
    color: 'var(--text-muted)',
    fields: [
      { key: 'logAverageFps', label: 'logAverageFps', type: 'number', description: 'Log average server FPS every N seconds (requires -doLogs)' },
      { key: 'logMemory', label: 'logMemory', type: 'number', description: 'Log server memory usage every N seconds' },
      { key: 'logPlayers', label: 'logPlayers', type: 'number', description: 'Log connected player count every N seconds' },
      { key: 'adminLogPlayerHitsOnly', label: 'adminLogPlayerHitsOnly', type: 'toggle', description: 'Only log player-to-player hits, not AI (0/1)' },
      { key: 'adminLogPlacement', label: 'adminLogPlacement', type: 'toggle', description: 'Log item and object placement actions (0/1)' },
      { key: 'adminLogBuildActions', label: 'adminLogBuildActions', type: 'toggle', description: 'Log base building actions (0/1)' },
      { key: 'adminLogPlayerList', label: 'adminLogPlayerList', type: 'toggle', description: 'Log a full player list every 5 minutes (0/1)' },
      { key: 'enableDebugMonitor', label: 'enableDebugMonitor', type: 'toggle', description: 'Show character debug info window in-game (0/1)' },
      { key: 'timeStampFormat', label: 'timeStampFormat', type: 'text', description: 'Log timestamp format ("Full" or "Short")' },
    ],
  },
];

export default function ConfigPage({ serverId }) {
  const [config, setConfig] = useState({});
  const [originalConfig, setOriginalConfig] = useState({});
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Template state
  const [templates, setTemplates] = useState([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadConfig = useCallback(() => {
    API.get(`/api/servers/${serverId}/config`).then(data => {
      setConfig(data);
      setOriginalConfig(data);
    });
  }, [serverId]);

  const loadTemplates = useCallback(() => {
    API.get(`/api/servers/${serverId}/config/templates`).then(data => {
      if (Array.isArray(data)) setTemplates(data);
    });
  }, [serverId]);

  useEffect(() => { loadConfig(); loadTemplates(); }, [loadConfig, loadTemplates]);

  const update = (key, value) => setConfig(c => ({ ...c, [key]: value }));

  const modifiedKeys = useMemo(() => {
    const keys = new Set();
    for (const [key, value] of Object.entries(config)) {
      if (JSON.stringify(value) !== JSON.stringify(originalConfig[key])) keys.add(key);
    }
    return keys;
  }, [config, originalConfig]);

  const modifiedCount = modifiedKeys.size;

  const save = async () => {
    setSaving(true);
    try {
      const result = await API.patch(`/api/servers/${serverId}/config`, config);
      if (result.error) {
        window.addToast('Save failed: ' + result.error, 'error');
      } else {
        setConfig(result);
        setOriginalConfig(result);
        window.addToast('Config saved', 'success');
      }
    } catch (e) {
      window.addToast('Save failed: ' + (e.message || 'Unknown error'), 'error');
    }
    setSaving(false);
  };

  useKeyboardShortcuts({ 'ctrl+s': () => save() });

  // ─── Template actions ─────────────────────────────────
  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    setSavingTemplate(true);
    const result = await API.post(`/api/servers/${serverId}/config/templates`, { name: templateName.trim() });
    if (result.error) window.addToast(result.error, 'error');
    else { window.addToast(`Template "${result.name}" saved`, 'success'); loadTemplates(); }
    setSavingTemplate(false);
    setShowSaveModal(false);
    setTemplateName('');
  };

  const handleRestore = async (template) => {
    setRestoring(true);
    const result = await API.post(`/api/servers/${serverId}/config/templates/${template.id}/restore`);
    if (result.error) window.addToast(result.error, 'error');
    else { setConfig(result); setOriginalConfig(result); window.addToast(`Restored template "${template.name}"`, 'success'); }
    setRestoring(false);
    setConfirmRestore(null);
  };

  const handleDelete = async (template) => {
    setDeleting(true);
    const result = await API.del(`/api/servers/${serverId}/config/templates/${template.id}`);
    if (result.error) window.addToast(result.error, 'error');
    else { window.addToast(`Deleted template "${template.name}"`, 'success'); loadTemplates(); }
    setDeleting(false);
    setConfirmDelete(null);
  };

  const formatDate = (iso) => {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
  };

  // Filter sections/fields by search
  const filteredSections = useMemo(() => {
    if (!searchText.trim()) return SECTIONS;
    const q = searchText.toLowerCase();
    return SECTIONS.map(section => ({
      ...section,
      fields: section.fields.filter(f =>
        f.key.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)
      ),
    })).filter(s => s.fields.length > 0);
  }, [searchText]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 300 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search settings..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ paddingLeft: 32, width: '100%' }}
          />
        </div>
        {modifiedCount > 0 && (
          <span style={{ color: 'var(--accent-orange, #f59e0b)', fontWeight: 600, fontSize: 13 }}>
            {modifiedCount} unsaved change{modifiedCount !== 1 ? 's' : ''}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setTemplateName(''); setShowSaveModal(true); }}
            disabled={templates.length >= MAX_TEMPLATES}
            title="Save current config as a template"
          >
            <Bookmark size={14} /> Template
          </button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : <><Save size={14} /> Save Config</>}
          </button>
        </div>
      </div>

      {/* Config sections — Globals Editor style */}
      {filteredSections.map(section => (
        <div key={section.title} className="card" style={{ overflow: 'hidden' }}>
          <div style={{
            padding: '10px 16px',
            fontWeight: 700,
            fontSize: 14,
            borderBottom: '1px solid var(--border)',
            borderLeft: `3px solid ${section.color}`,
            background: 'var(--bg-surface, var(--bg-deep))',
          }}>
            {section.title}
          </div>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: '28%', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Setting</th>
                <th style={{ width: '18%', padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Value</th>
                <th style={{ padding: '8px 16px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {section.fields.map(f => {
                const modified = modifiedKeys.has(f.key);
                return (
                  <tr key={f.key} style={{ background: modified ? 'rgba(234, 179, 8, 0.06)' : undefined }}>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono, monospace)', fontSize: 13, fontWeight: 500 }}>
                      {f.key}
                      {modified && <span style={{ marginLeft: 6, color: 'var(--accent-orange, #f59e0b)', fontSize: 11, fontWeight: 700 }}>*</span>}
                    </td>
                    <td style={{ padding: '8px 16px' }}>
                      {f.type === 'toggle' ? (
                        <button
                          onClick={() => update(f.key, config[f.key] ? 0 : 1)}
                          style={{
                            padding: '4px 14px',
                            fontSize: 12,
                            fontWeight: 600,
                            borderRadius: 4,
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                            background: config[f.key] ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))',
                            color: config[f.key] ? '#fff' : 'var(--text-muted)',
                            transition: 'all 0.15s',
                          }}
                        >
                          {config[f.key] ? 'ON' : 'OFF'}
                        </button>
                      ) : (
                        <input
                          className="input"
                          type={f.type}
                          value={config[f.key] ?? ''}
                          onChange={e => update(f.key, f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value) || 0) : e.target.value)}
                          style={{ width: '100%', maxWidth: 160, fontSize: 13 }}
                        />
                      )}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
                      {f.description}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Templates panel */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Bookmark size={14} /> Config Templates
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{templates.length}/{MAX_TEMPLATES}</span>
        </div>
        {templates.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No templates saved yet. Save your current config as a template to enable quick rollback.
          </div>
        ) : (
          <div>
            {templates.map(t => (
              <div
                key={t.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 16px', borderBottom: '1px solid var(--border)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={10} /> {formatDate(t.createdAt)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setConfirmRestore(t)} style={{ fontSize: 11, padding: '3px 10px' }}>
                    <RotateCcw size={12} /> Restore
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(t)} style={{ fontSize: 11, padding: '3px 10px' }}>
                    <Trash2 size={12} />
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
          Save the current serverDZ.cfg values as a named template for quick rollback.
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

      {/* Restore Confirmation */}
      <Modal open={!!confirmRestore} onClose={() => setConfirmRestore(null)} title="Restore Template">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8 }}>
          Restore <strong>{confirmRestore?.name}</strong>? This will overwrite your current serverDZ.cfg. A backup will be created.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={() => setConfirmRestore(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleRestore(confirmRestore)} disabled={restoring}>
            {restoring ? 'Restoring...' : <><RotateCcw size={14} /> Restore</>}
          </button>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Template">
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
          Delete template <strong>{confirmDelete?.name}</strong>? This cannot be undone.
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
