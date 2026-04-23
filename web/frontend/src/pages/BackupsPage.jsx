import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import PageLoader from '../components/PageLoader';
import Modal from '../components/ui/Modal';
import {
  Package, Plus, Trash2, Download, RotateCcw, Eye, Save, RefreshCw,
  Clock, AlertTriangle, CheckCircle, X, FolderOpen, Zap,
} from '../components/Icon';
import { formatBytes, timeAgo } from '../utils';

const INTERVAL_PRESETS = [
  { minutes: 15, label: 'Every 15 minutes' },
  { minutes: 30, label: 'Every 30 minutes' },
  { minutes: 60, label: 'Every hour' },
  { minutes: 120, label: 'Every 2 hours' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Every 24 hours' },
];

export default function BackupsPage({ serverId }) {
  const [config, setConfig] = useState(null);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [filter, setFilter] = useState('all'); // all | manual | automated

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, list] = await Promise.all([
        API.get(`/api/servers/${serverId}/backup-config`),
        API.get(`/api/servers/${serverId}/backups`),
      ]);
      setConfig(cfg);
      // list returns { automated: [...], manual: [...] } or a flat array depending on the backend
      const flat = Array.isArray(list)
        ? list
        : [
            ...(list.automated || []).map((b) => ({ ...b, type: 'automated' })),
            ...(list.manual || []).map((b) => ({ ...b, type: 'manual' })),
          ];
      setBackups(flat);
    } catch (err) {
      window.addToast?.(`Failed to load backups: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const saved = await API.put(`/api/servers/${serverId}/backup-config`, config);
      setConfig(saved);
      window.addToast?.('Backup schedule saved.', 'success');
    } catch (err) {
      window.addToast?.(`Save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const backupNow = async () => {
    setCreating(true);
    try {
      const res = await API.post(`/api/servers/${serverId}/backups`, {});
      if (res?.filename) {
        window.addToast?.(`Backup created: ${res.filename}`, 'success');
        load();
      }
    } catch (err) {
      window.addToast?.(`Backup failed: ${err.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  const deleteBackup = async (b) => {
    if (!window.confirm(`Delete backup "${b.filename}"? This cannot be undone.`)) return;
    try {
      await API.del(`/api/servers/${serverId}/backups/${encodeURIComponent(b.filename)}?type=${b.type || 'manual'}`);
      window.addToast?.('Backup deleted.', 'info');
      setBackups((prev) => prev.filter((x) => x.filename !== b.filename));
    } catch (err) {
      window.addToast?.(`Delete failed: ${err.message}`, 'error');
    }
  };

  const restoreBackup = async (b) => {
    const msg =
      `Restore "${b.filename}"?\n\n` +
      'This will REPLACE current server files with the backed-up version. ' +
      'The server must be stopped first.';
    if (!window.confirm(msg)) return;
    try {
      await API.post(`/api/servers/${serverId}/backups/${encodeURIComponent(b.filename)}/restore?type=${b.type || 'manual'}`, {});
      window.addToast?.('Backup restored.', 'success');
    } catch (err) {
      window.addToast?.(`Restore failed: ${err.message}`, 'error');
    }
  };

  const downloadBackup = (b) => {
    const token = localStorage.getItem('token');
    const url = `/api/servers/${serverId}/backups/${encodeURIComponent(b.filename)}/download?type=${b.type || 'manual'}&token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  };

  const previewBackup = async (b) => {
    setPreviewing({ ...b, loading: true });
    try {
      const res = await API.get(`/api/servers/${serverId}/backups/${encodeURIComponent(b.filename)}/contents?type=${b.type || 'manual'}`);
      setPreviewing({ ...b, entries: res?.entries || [], loading: false });
    } catch (err) {
      setPreviewing({ ...b, error: err.message, loading: false });
    }
  };

  const filtered = useMemo(() => {
    const sorted = [...backups].sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
    if (filter === 'all') return sorted;
    return sorted.filter((b) => b.type === filter);
  }, [backups, filter]);

  if (loading) return <div style={{ padding: 16 }}><PageLoader /></div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Package size={22} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Backups</h1>
        {config?.lastBackupAt && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Last backup: {timeAgo(config.lastBackupAt)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-sm btn-secondary" onClick={load} title="Reload"><RefreshCw size={14} /> Refresh</button>
          <button className="btn btn-sm btn-primary" onClick={backupNow} disabled={creating}>
            <Zap size={14} /> {creating ? 'Creating…' : 'Backup now'}
          </button>
        </div>
      </div>

      {config && (
        <ScheduleCard config={config} onChange={setConfig} onSave={saveConfig} saving={saving} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Backup history</h2>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({backups.length} total)</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {['all', 'manual', 'automated'].map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Package size={36} />}
          title="No backups yet"
          description="Click Backup Now to create one, or enable the schedule above to back up automatically. Backups are stored alongside your server under .backups/."
        />
      ) : (
        <BackupList
          backups={filtered}
          onDownload={downloadBackup}
          onRestore={restoreBackup}
          onDelete={deleteBackup}
          onPreview={previewBackup}
        />
      )}

      {previewing && (
        <PreviewModal data={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function ScheduleCard({ config, onChange, onSave, saving }) {
  const update = (patch) => onChange({ ...config, ...patch });
  const isCustomInterval = !INTERVAL_PRESETS.find((p) => p.minutes === config.intervalMinutes);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Clock size={16} style={{ color: 'var(--accent)' }} />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Automatic schedule</h2>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!config.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          {config.enabled ? (
            <span style={{ color: 'var(--accent-green, #22c55e)' }}><CheckCircle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />Enabled</span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>Disabled</span>
          )}
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <div>
          <label className="input-label">Frequency</label>
          <select
            className="input"
            value={isCustomInterval ? 'custom' : config.intervalMinutes}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              update({ intervalMinutes: Number(e.target.value) });
            }}
            disabled={!config.enabled}
          >
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.minutes} value={p.minutes}>{p.label}</option>
            ))}
            <option value="custom">Custom…</option>
          </select>
          {isCustomInterval && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                className="input"
                min={5} max={1440}
                value={config.intervalMinutes}
                onChange={(e) => update({ intervalMinutes: Math.max(5, Math.min(1440, parseInt(e.target.value, 10) || 60)) })}
                disabled={!config.enabled}
                style={{ width: 100 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>minutes (5–1440)</span>
            </div>
          )}
        </div>

        <div>
          <label className="input-label">Keep backups for</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              className="input"
              min={1} max={90}
              value={config.maxKeepDays}
              onChange={(e) => update({ maxKeepDays: Math.max(1, Math.min(90, parseInt(e.target.value, 10) || 7)) })}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days (1–90)</span>
          </div>
        </div>

        <div>
          <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={!!config.backupAtStartup} onChange={(e) => update({ backupAtStartup: e.target.checked })} />
            Back up on server startup
          </label>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Creates a snapshot before each start, independent of the schedule.
          </p>
        </div>
      </div>

      <PathsEditor paths={config.paths || []} onChange={(paths) => update({ paths })} />

      <div style={{ display: 'flex', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <button className="btn btn-sm btn-primary" onClick={onSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </div>
  );
}

function PathsEditor({ paths, onChange }) {
  const [newPath, setNewPath] = useState('');

  const add = () => {
    const p = newPath.trim().replace(/\\/g, '/');
    if (!p || p.includes('..') || paths.includes(p)) return;
    onChange([...paths, p]);
    setNewPath('');
  };

  const remove = (idx) => onChange(paths.filter((_, i) => i !== idx));

  return (
    <div style={{ marginTop: 16 }}>
      <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <FolderOpen size={13} /> Paths to include (relative to server install dir)
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {paths.map((p, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px',
            background: 'var(--bg-deep)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {p}
            <button className="btn-icon btn-icon-sm" onClick={() => remove(i)} aria-label={`Remove ${p}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        {paths.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No paths configured — backups will be empty.
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          placeholder="mpmissions/dayzOffline.chernarusplus/storage_1"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ flex: 1 }}
        />
        <button className="btn btn-sm btn-secondary" onClick={add} disabled={!newPath.trim()}>
          <Plus size={14} /> Add path
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
        Supports wildcards in the last segment: <code>profiles/*.ADM</code>, <code>mpmissions/*</code>.
        Absolute paths and <code>..</code> are rejected.
      </p>
    </div>
  );
}

function BackupList({ backups, onDownload, onRestore, onDelete, onPreview }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Filename</th>
            <th style={{ width: 100 }}>Type</th>
            <th style={{ width: 100, textAlign: 'right' }}>Size</th>
            <th style={{ width: 140 }}>Created</th>
            <th style={{ width: 200, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={`${b.type}-${b.filename}`}>
              <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{b.filename}</td>
              <td>
                <span style={{
                  padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                  background: b.type === 'automated' ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'color-mix(in srgb, var(--accent-purple, #a78bfa) 15%, transparent)',
                  color: b.type === 'automated' ? 'var(--accent)' : 'var(--accent-purple, #a78bfa)',
                  borderRadius: 4,
                }}>
                  {b.type || 'manual'}
                </span>
              </td>
              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{formatBytes(b.size || 0)}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                {b.modifiedAt ? timeAgo(b.modifiedAt) : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', gap: 4 }}>
                  <button className="btn-icon btn-icon-sm" title="Preview contents" onClick={() => onPreview(b)}>
                    <Eye size={14} />
                  </button>
                  <button className="btn-icon btn-icon-sm" title="Download" onClick={() => onDownload(b)}>
                    <Download size={14} />
                  </button>
                  <button className="btn-icon btn-icon-sm" title="Restore (server must be stopped)" onClick={() => onRestore(b)}>
                    <RotateCcw size={14} />
                  </button>
                  <button className="btn-icon btn-icon-sm" title="Delete" onClick={() => onDelete(b)} style={{ color: 'var(--danger)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewModal({ data, onClose }) {
  return (
    <Modal open={true} onClose={onClose} title={`Preview — ${data.filename}`}>
      <div style={{ padding: 4 }}>
        {data.loading && <PageLoader />}
        {data.error && (
          <div style={{ padding: 12, color: 'var(--danger)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <AlertTriangle size={14} /> {data.error}
          </div>
        )}
        {data.entries && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {data.entries.length} entries in this archive
            </p>
            <div style={{ maxHeight: 420, overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
              {data.entries.map((e, i) => (
                <div key={i} style={{ padding: '3px 0', borderBottom: '1px dashed var(--border)', display: 'flex' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path || e.name || e}</span>
                  {e.size !== undefined && <span style={{ color: 'var(--text-muted)', marginLeft: 12 }}>{formatBytes(e.size)}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
