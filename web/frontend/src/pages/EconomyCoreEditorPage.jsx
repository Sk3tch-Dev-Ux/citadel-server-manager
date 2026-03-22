import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';

// ─── Helpers ──────────────────────────────────────────────────

const COMMON_FOLDER_NAMES = ['custom_ce', 'expansion_ce', 'trader_ce'];

/** Auto-detect file type from filename */
function guessFileType(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('spawnabletypes')) return 'spawnabletypes';
  if (lower.includes('types')) return 'types';
  if (lower.includes('events')) return 'events';
  if (lower.includes('globals')) return 'globals';
  if (lower.includes('economy')) return 'economy';
  if (lower.includes('messages')) return 'messages';
  return 'types';
}

// ─── Main Component ──────────────────────────────────────────

export default function EconomyCoreEditorPage({ serverId }) {
  const [folders, setFolders] = useState([]);
  const [original, setOriginal] = useState([]);
  const [validTypes, setValidTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Data Loading ────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await API.get(`/api/servers/${serverId}/economycore`);
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        setFolders(result.folders || []);
        setOriginal(JSON.parse(JSON.stringify(result.folders || [])));
        setValidTypes(result.validTypes || []);
      }
    } catch {
      window.addToast?.('Failed to load cfgeconomycore.xml', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Modification tracking ───────────────────────────────

  const hasChanges = useMemo(() => {
    return JSON.stringify(folders) !== JSON.stringify(original);
  }, [folders, original]);

  // ─── Keyboard shortcut (Ctrl+S) ─────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ─── Save ────────────────────────────────────────────────

  const handleSave = async () => {
    if (!hasChanges) {
      window.addToast?.('No changes to save', 'info');
      return;
    }

    // Validate: no empty folder names
    for (const ce of folders) {
      if (!ce.folder.trim()) {
        window.addToast?.('Folder name cannot be empty', 'error');
        return;
      }
      for (const file of ce.files) {
        if (!file.name.trim()) {
          window.addToast?.(`File name cannot be empty in folder "${ce.folder}"`, 'error');
          return;
        }
      }
    }

    setSaving(true);
    try {
      const payload = folders.map(f => ({
        folder: f.folder,
        files: f.files.map(file => ({ name: file.name, type: file.type })),
      }));
      const result = await API.put(`/api/servers/${serverId}/economycore`, { folders: payload });
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        window.addToast?.('Economy core config saved', 'success');
        setFolders(result.folders || payload);
        setOriginal(JSON.parse(JSON.stringify(result.folders || payload)));
      }
    } catch {
      window.addToast?.('Failed to save cfgeconomycore.xml', 'error');
    }
    setSaving(false);
  };

  // ─── Folder operations ──────────────────────────────────

  const addFolder = (name) => {
    const folderName = name || 'new_ce';
    setFolders(prev => [...prev, { folder: folderName, files: [], exists: false }]);
  };

  const removeFolder = (idx) => {
    setFolders(prev => prev.filter((_, i) => i !== idx));
  };

  const updateFolderName = (idx, name) => {
    setFolders(prev => prev.map((f, i) => i === idx ? { ...f, folder: name } : f));
  };

  // ─── File operations ────────────────────────────────────

  const addFile = (folderIdx) => {
    setFolders(prev => prev.map((f, i) => {
      if (i !== folderIdx) return f;
      return { ...f, files: [...f.files, { name: '', type: 'types' }] };
    }));
  };

  const removeFile = (folderIdx, fileIdx) => {
    setFolders(prev => prev.map((f, i) => {
      if (i !== folderIdx) return f;
      return { ...f, files: f.files.filter((_, fi) => fi !== fileIdx) };
    }));
  };

  const updateFileName = (folderIdx, fileIdx, name) => {
    setFolders(prev => prev.map((f, i) => {
      if (i !== folderIdx) return f;
      const files = f.files.map((file, fi) => {
        if (fi !== fileIdx) return file;
        return { ...file, name, type: name ? guessFileType(name) : file.type };
      });
      return { ...f, files };
    }));
  };

  const updateFileType = (folderIdx, fileIdx, type) => {
    setFolders(prev => prev.map((f, i) => {
      if (i !== folderIdx) return f;
      const files = f.files.map((file, fi) => fi === fileIdx ? { ...file, type } : file);
      return { ...f, files };
    }));
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading cfgeconomycore.xml...
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 20 }}>Economy Core Config</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            cfgeconomycore.xml — Controls which CE folders and files the economy engine loads.
            {hasChanges && <span style={{ color: 'var(--accent-blue)', marginLeft: 8 }}>(unsaved changes)</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!hasChanges || saving}
            title="Save (Ctrl+S)"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Add Folder Controls */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
        padding: 12, background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)',
      }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13, marginRight: 4 }}>Add CE Folder:</span>
        {COMMON_FOLDER_NAMES
          .filter(name => !folders.some(f => f.folder === name))
          .map(name => (
            <button key={name} className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => addFolder(name)}>
              + {name}
            </button>
          ))}
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => addFolder('')}>
          + Custom
        </button>
      </div>

      {/* CE Folder Cards */}
      {folders.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 48, color: 'var(--text-muted)',
          background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)',
        }}>
          No CE folders configured. Add one above to get started.
        </div>
      )}

      {folders.map((ce, folderIdx) => (
        <div key={folderIdx} className="card" style={{
          marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8,
        }}>
          {/* Card Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: '8px 8px 0 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>CE Folder:</span>
              <input
                type="text"
                value={ce.folder}
                onChange={(e) => updateFolderName(folderIdx, e.target.value)}
                placeholder="folder_name"
                style={{
                  background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 4,
                  color: 'var(--text-primary)', padding: '4px 8px', fontSize: 14, fontFamily: 'monospace',
                  flex: 1, maxWidth: 300,
                }}
              />
              {ce.exists === false && ce.folder && (
                <span style={{
                  color: 'var(--accent-red)', fontSize: 11, padding: '2px 8px',
                  background: 'rgba(255,59,59,0.1)', borderRadius: 4,
                }}>
                  Folder not found on disk
                </span>
              )}
              {ce.exists === true && (
                <span style={{
                  color: 'var(--accent-green)', fontSize: 11, padding: '2px 8px',
                  background: 'rgba(0,255,106,0.1)', borderRadius: 4,
                }}>
                  Exists
                </span>
              )}
            </div>
            <button
              className="btn btn-danger"
              style={{ fontSize: 12, padding: '4px 10px' }}
              onClick={() => removeFolder(folderIdx)}
            >
              Remove Folder
            </button>
          </div>

          {/* Files Table */}
          <div style={{ padding: 16 }}>
            {ce.files.length > 0 && (
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>File Name</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', borderBottom: '1px solid var(--border)', width: 180 }}>Type</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {ce.files.map((file, fileIdx) => (
                    <tr key={fileIdx}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                        <input
                          type="text"
                          value={file.name}
                          onChange={(e) => updateFileName(folderIdx, fileIdx, e.target.value)}
                          placeholder="filename.xml"
                          style={{
                            background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 4,
                            color: 'var(--text-primary)', padding: '4px 8px', fontSize: 13,
                            fontFamily: 'monospace', width: '100%',
                          }}
                        />
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
                        <select
                          value={file.type}
                          onChange={(e) => updateFileType(folderIdx, fileIdx, e.target.value)}
                          style={{
                            background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 4,
                            color: 'var(--text-primary)', padding: '4px 8px', fontSize: 13, width: '100%',
                          }}
                        >
                          {validTypes.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                        <button
                          className="btn btn-danger"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => removeFile(folderIdx, fileIdx)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {ce.files.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0', textAlign: 'center' }}>
                No files in this folder. Add one below.
              </div>
            )}

            <button
              className="btn btn-secondary"
              style={{ fontSize: 12 }}
              onClick={() => addFile(folderIdx)}
            >
              + Add File
            </button>
          </div>
        </div>
      ))}

      {/* Bottom Save */}
      {folders.length > 0 && hasChanges && (
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
