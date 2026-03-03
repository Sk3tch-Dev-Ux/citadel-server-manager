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
    await API.patch(`/api/servers/${serverId}/config`, config);
    window.addToast('Config saved', 'success');
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

  const fields = [
    { key: 'hostname', label: 'Server Name', type: 'text', description: 'The name shown in the server browser.' },
    { key: 'maxPlayers', label: 'Max Players', type: 'number', description: 'Maximum number of players allowed.' },
    { key: 'password', label: 'Server Password', type: 'text', description: 'Password required to join the server.' },
    { key: 'passwordAdmin', label: 'Admin Password', type: 'text', description: 'Password for admin access.' },
    { key: 'verifySignatures', label: 'Verify Signatures', type: 'toggle', description: 'Enable signature verification for mods.' },
    { key: 'forceSameBuild', label: 'Force Same Build', type: 'toggle', description: 'Require all clients to use the same game build.' },
    { key: 'disableThirdPerson', label: 'Disable 3rd Person', type: 'toggle', description: 'Disables third person camera for players.' },
    { key: 'serverTime', label: 'Server Time', type: 'text', description: 'Initial server time (e.g. 8:00).' },
    { key: 'serverTimeAcceleration', label: 'Time Acceleration', type: 'number', description: 'Multiplier for in-game time speed.' },
    { key: 'respawnTime', label: 'Respawn Time', type: 'number', description: 'Time (seconds) before a player can respawn.' },
    { key: 'loginQueueMaxPlayers', label: 'Login Queue Max', type: 'number', description: 'Maximum players allowed in login queue.' },
    { key: 'template', label: 'Map Template', type: 'text', description: 'Map template used for the server.' },
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

      {/* Config editor grid */}
      <div className="grid grid-2">
        {fields.map(f => (
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
              <input className="input" type={f.type} value={config[f.key] ?? ''} onChange={e => update(f.key, f.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)} />
            )}
          </div>
        ))}
      </div>

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
