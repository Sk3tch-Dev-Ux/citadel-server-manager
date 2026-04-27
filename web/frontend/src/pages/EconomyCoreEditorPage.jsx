import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import API from '../api';
import {
  FolderOpen, Plus, Trash2, Search, ChevronDown, ChevronRight,
  Copy, FileText, CircleCheck, AlertTriangle, X,
} from '../components/Icon';

// ─── Constants ───────────────────────────────────────────────

const COMMON_FOLDERS = [
  { name: 'custom_ce',    desc: 'General custom economy files' },
  { name: 'expansion_ce', desc: 'DayZ Expansion mod economy' },
  { name: 'trader_ce',    desc: 'Trader mod configuration' },
  { name: 'vehicle_ce',   desc: 'Vehicle spawn configuration' },
  { name: 'weapons_ce',   desc: 'Custom weapon spawns' },
  { name: 'building_ce',  desc: 'Building/base loot tables' },
];

/** Characters allowed in folder names (visual hint for the user). */
const FOLDER_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-]*(\/[a-zA-Z0-9][a-zA-Z0-9_\-]*)*$/;
const FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_\-. ]*\.xml$/i;

// ─── Helpers ─────────────────────────────────────────────────

/** Auto-detect CE file type from filename. */
function guessFileType(filename) {
  if (!filename) return 'types';
  const lower = filename.toLowerCase();
  // Order matters: check more specific names before generic ones
  if (lower.includes('spawnabletypes') || lower.includes('spawnable_types')) return 'spawnabletypes';
  if (lower.includes('types'))    return 'types';
  if (lower.includes('events'))   return 'events';
  if (lower.includes('globals'))  return 'globals';
  if (lower.includes('economy'))  return 'economy';
  if (lower.includes('messages')) return 'messages';
  return 'types';
}

/** Format file count for display. */
function fileCountLabel(count) {
  return count === 1 ? '1 file' : `${count} files`;
}

// ─── Main Component ──────────────────────────────────────────

export default function EconomyCoreEditorPage({ serverId }) {
  const [folders, setFolders] = useState([]);
  const [original, setOriginal] = useState([]);
  const [validTypes, setValidTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsed, setCollapsed] = useState({});   // { [folderIdx]: bool }
  const [creatingFolder, setCreatingFolder] = useState(null); // folder name being created on disk
  const saveTimerRef = useRef(null);

  // ─── Data Loading ────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await API.get(`/api/servers/${serverId}/economycore`);
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        const data = result.folders || [];
        setFolders(data);
        setOriginal(JSON.parse(JSON.stringify(data)));
        setValidTypes(result.validTypes || []);
      }
    } catch {
      window.addToast?.('Failed to load cfgeconomycore.xml', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Change tracking ────────────────────────────────────

  const hasChanges = useMemo(() => {
    return JSON.stringify(folders) !== JSON.stringify(original);
  }, [folders, original]);

  // ─── Unsaved changes warning ────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // ─── Keyboard shortcut (Ctrl+S) with debounce ──────────

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && !saving) {
          // Debounce: ignore rapid Ctrl+S
          if (saveTimerRef.current) return;
          saveTimerRef.current = setTimeout(() => { saveTimerRef.current = null; }, 500);
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasChanges, saving, folders]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Validation ─────────────────────────────────────────

  const validationErrors = useMemo(() => {
    const errs = [];
    const seenFolders = new Set();

    folders.forEach((ce, i) => {
      const folder = (ce.folder || '').trim();
      if (!folder) {
        errs.push({ folderIdx: i, msg: 'Folder name is empty' });
      } else if (!FOLDER_NAME_REGEX.test(folder)) {
        errs.push({ folderIdx: i, msg: `"${folder}" — use only letters, numbers, hyphens, underscores` });
      } else if (seenFolders.has(folder.toLowerCase())) {
        errs.push({ folderIdx: i, msg: `Duplicate folder "${folder}"` });
      }
      seenFolders.add(folder.toLowerCase());

      const seenFiles = new Set();
      (ce.files || []).forEach((file, j) => {
        const name = (file.name || '').trim();
        if (!name) {
          errs.push({ folderIdx: i, fileIdx: j, msg: `Empty file name in "${folder || `Folder #${i + 1}`}"` });
        } else if (!FILENAME_REGEX.test(name)) {
          errs.push({ folderIdx: i, fileIdx: j, msg: `"${name}" — must end in .xml, no special characters` });
        } else if (seenFiles.has(name.toLowerCase())) {
          errs.push({ folderIdx: i, fileIdx: j, msg: `Duplicate file "${name}" in "${folder}"` });
        }
        seenFiles.add(name.toLowerCase());
      });
    });

    return errs;
  }, [folders]);

  // ─── Save ───────────────────────────────────────────────

  const handleSave = async () => {
    if (!hasChanges) {
      window.addToast?.('No changes to save', 'info');
      return;
    }
    if (validationErrors.length > 0) {
      window.addToast?.(`Fix ${validationErrors.length} validation error(s) before saving`, 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = folders.map(f => ({
        folder: f.folder.trim(),
        files: (f.files || []).map(file => ({ name: file.name.trim(), type: file.type })),
      }));
      const result = await API.put(`/api/servers/${serverId}/economycore`, { folders: payload });
      if (result.error) {
        // Show validation details from server if present
        const msg = result.details
          ? result.details.join('\n')
          : result.error;
        window.addToast?.(msg, 'error');
      } else {
        window.addToast?.('Economy core config saved', 'success');
        const data = result.folders || payload;
        setFolders(data);
        setOriginal(JSON.parse(JSON.stringify(data)));
      }
    } catch {
      window.addToast?.('Failed to save — check your connection', 'error');
    }
    setSaving(false);
  };

  // ─── Folder operations ─────────────────────────────────

  const addFolder = (name = '') => {
    const folderName = name || '';
    setFolders(prev => [...prev, { folder: folderName, files: [], exists: false, diskFiles: [] }]);
    // Auto-expand the new folder
    setCollapsed(prev => ({ ...prev, [folders.length]: false }));
  };

  const removeFolder = (idx) => {
    setFolders(prev => prev.filter((_, i) => i !== idx));
  };

  const duplicateFolder = (idx) => {
    const source = folders[idx];
    const copy = {
      ...JSON.parse(JSON.stringify(source)),
      folder: source.folder + '_copy',
      exists: false,
      diskFiles: [],
    };
    setFolders(prev => [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]);
  };

  const moveFolder = (idx, direction) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= folders.length) return;
    setFolders(prev => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  const updateFolderName = (idx, name) => {
    setFolders(prev => prev.map((f, i) => i === idx ? { ...f, folder: name } : f));
  };

  // ─── File operations ───────────────────────────────────

  const addFile = (folderIdx) => {
    setFolders(prev => prev.map((f, i) => {
      if (i !== folderIdx) return f;
      return { ...f, files: [...(f.files || []), { name: '', type: 'types' }] };
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
        // Only auto-guess type if user hasn't manually set it yet
        const autoType = name && !file._manualType ? guessFileType(name) : file.type;
        return { ...file, name, type: autoType };
      });
      return { ...f, files };
    }));
  };

  const updateFileType = (folderIdx, fileIdx, type) => {
    setFolders(prev => prev.map((f, i) => {
      if (i !== folderIdx) return f;
      const files = f.files.map((file, fi) => fi === fileIdx ? { ...file, type, _manualType: true } : file);
      return { ...f, files };
    }));
  };

  // ─── Create folder on disk ─────────────────────────────

  const createFolderOnDisk = async (folderName) => {
    setCreatingFolder(folderName);
    try {
      const result = await API.post(`/api/servers/${serverId}/economycore/folders`, { folder: folderName });
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        window.addToast?.(`Folder "${folderName}" created on disk`, 'success');
        // Update the folder's exists state
        setFolders(prev => prev.map(f =>
          f.folder === folderName ? { ...f, exists: true } : f
        ));
      }
    } catch {
      window.addToast?.('Failed to create folder', 'error');
    }
    setCreatingFolder(null);
  };

  // ─── Toggle collapse ──────────────────────────────────

  const toggleCollapse = (idx) => {
    setCollapsed(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const collapseAll = () => {
    const all = {};
    folders.forEach((_, i) => { all[i] = true; });
    setCollapsed(all);
  };

  const expandAll = () => setCollapsed({});

  // ─── Search/filter ─────────────────────────────────────

  const filteredIndices = useMemo(() => {
    if (!searchTerm.trim()) return folders.map((_, i) => i);
    const term = searchTerm.toLowerCase();
    return folders.reduce((acc, f, i) => {
      const folderMatch = f.folder.toLowerCase().includes(term);
      const fileMatch = (f.files || []).some(file => file.name.toLowerCase().includes(term));
      if (folderMatch || fileMatch) acc.push(i);
      return acc;
    }, []);
  }, [folders, searchTerm]);

  // ─── Errors for a specific folder ──────────────────────

  const folderErrors = useCallback((idx) => {
    return validationErrors.filter(e => e.folderIdx === idx);
  }, [validationErrors]);

  // ─── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <div className="spinner" /> Loading cfgeconomycore.xml...
        </div>
      </div>
    );
  }

  const availablePresets = COMMON_FOLDERS.filter(p => !folders.some(f => f.folder === p.name));

  return (
    <div style={{ padding: 24, maxWidth: 1040, margin: '0 auto' }}>
      {/* ── Header ─────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: 20, fontWeight: 600 }}>Economy Core Config</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
            cfgeconomycore.xml — Defines which CE folders and XML files the DayZ economy engine loads.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {hasChanges && (
            <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 500, padding: '4px 10px', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', borderRadius: 4 }}>
              Unsaved changes
            </span>
          )}
          {validationErrors.length > 0 && (
            <span style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 500, padding: '4px 10px', background: 'color-mix(in srgb, var(--danger) 12%, transparent)', borderRadius: 4 }}>
              {validationErrors.length} error{validationErrors.length > 1 ? 's' : ''}
            </span>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={!hasChanges || saving || validationErrors.length > 0} title="Save (Ctrl+S)">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Toolbar ────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
        padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search folders and files..."
            style={{
              width: '100%', padding: '6px 10px 6px 32px', fontSize: 13,
              background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
              <X size={12} />
            </button>
          )}
        </div>

        {/* Collapse/Expand */}
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={collapseAll}>Collapse All</button>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={expandAll}>Expand All</button>

        {/* Folder count */}
        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 'auto' }}>
          {folders.length} folder{folders.length !== 1 ? 's' : ''}{searchTerm && ` (${filteredIndices.length} shown)`}
        </span>
      </div>

      {/* ── Add Folder ─────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
        padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px dashed var(--border)',
      }}>
        <FolderOpen size={16} style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Add CE Folder:</span>

        {availablePresets.slice(0, 4).map(preset => (
          <button
            key={preset.name}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => addFolder(preset.name)}
            title={preset.desc}
          >
            + {preset.name}
          </button>
        ))}
        {availablePresets.length > 4 && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>+{availablePresets.length - 4} more</span>
        )}
        <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => addFolder('')}>
          <Plus size={12} /> Custom Folder
        </button>
      </div>

      {/* ── Empty State ────────────────────────────────── */}
      {folders.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 48, color: 'var(--text-muted)',
          background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)',
        }}>
          <FolderOpen size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>No CE folders configured</div>
          <div style={{ fontSize: 13 }}>Add a folder above to tell DayZ which custom XML files to load.</div>
        </div>
      )}

      {/* ── No Results ─────────────────────────────────── */}
      {folders.length > 0 && filteredIndices.length === 0 && searchTerm && (
        <div style={{
          textAlign: 'center', padding: 32, color: 'var(--text-muted)',
          background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)',
        }}>
          No folders or files match "{searchTerm}"
        </div>
      )}

      {/* ── Folder Cards ───────────────────────────────── */}
      {filteredIndices.map((folderIdx) => {
        const ce = folders[folderIdx];
        const isCollapsed = collapsed[folderIdx];
        const errors = folderErrors(folderIdx);
        const hasError = errors.length > 0;

        return (
          <div key={folderIdx} style={{
            marginBottom: 12, background: 'var(--bg-card)',
            border: `1px solid ${hasError ? 'var(--danger)' : 'var(--border)'}`,
            borderRadius: 8, overflow: 'hidden',
            transition: 'border-color 0.2s ease',
          }}>
            {/* ── Card Header ───────────────────────── */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', background: 'var(--bg-elevated)',
                cursor: 'pointer', userSelect: 'none',
              }}
              onClick={() => toggleCollapse(folderIdx)}
            >
              {/* Expand/collapse chevron */}
              {isCollapsed
                ? <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                : <ChevronDown size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              }

              {/* Folder icon */}
              <FolderOpen size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />

              {/* Folder name input */}
              <input
                type="text"
                value={ce.folder}
                onChange={(e) => updateFolderName(folderIdx, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="folder_name"
                spellCheck={false}
                style={{
                  background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 4,
                  color: 'var(--text-primary)', padding: '3px 8px', fontSize: 14, fontFamily: 'monospace',
                  flex: '1 1 200px', maxWidth: 300, minWidth: 120,
                }}
              />

              {/* Status badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                {ce.exists === true && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    color: '#22c55e', fontSize: 11, padding: '2px 8px',
                    background: 'color-mix(in srgb, #22c55e 10%, transparent)', borderRadius: 4,
                  }}>
                    <CircleCheck size={11} /> On Disk
                  </span>
                )}
                {ce.exists === false && ce.folder?.trim() && (
                  <button
                    className="btn"
                    style={{
                      fontSize: 11, padding: '2px 8px', color: 'var(--warning)',
                      background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--warning) 25%, transparent)',
                      borderRadius: 4, cursor: 'pointer',
                    }}
                    onClick={(e) => { e.stopPropagation(); createFolderOnDisk(ce.folder.trim()); }}
                    disabled={creatingFolder === ce.folder.trim()}
                    title="Create this folder in the mission directory"
                  >
                    {creatingFolder === ce.folder.trim() ? 'Creating...' : 'Create Folder'}
                  </button>
                )}

                {/* File count */}
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {fileCountLabel((ce.files || []).length)}
                </span>

                {/* Disk file count hint */}
                {ce.diskFiles?.length > 0 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={`${ce.diskFiles.length} XML file(s) on disk in this folder`}>
                    ({ce.diskFiles.length} on disk)
                  </span>
                )}
              </div>

              {/* Actions (right side) */}
              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => moveFolder(folderIdx, -1)} disabled={folderIdx === 0} title="Move up">
                  ▲
                </button>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => moveFolder(folderIdx, 1)} disabled={folderIdx === folders.length - 1} title="Move down">
                  ▼
                </button>
                <button className="btn btn-secondary" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => duplicateFolder(folderIdx)} title="Duplicate folder">
                  <Copy size={12} />
                </button>
                <button className="btn btn-danger" style={{ fontSize: 11, padding: '3px 6px' }} onClick={() => removeFolder(folderIdx)} title="Remove folder from config">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {/* ── Validation Errors ─────────────────── */}
            {hasError && !isCollapsed && (
              <div style={{ padding: '6px 14px', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', borderBottom: '1px solid var(--border)' }}>
                {errors.map((err, i) => (
                  <div key={i} style={{ color: 'var(--danger)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 0' }}>
                    <AlertTriangle size={11} /> {err.msg}
                  </div>
                ))}
              </div>
            )}

            {/* ── Card Body (Files) ─────────────────── */}
            {!isCollapsed && (
              <div style={{ padding: '12px 14px' }}>
                {(ce.files || []).length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Column headers */}
                    <div style={{ display: 'flex', gap: 8, padding: '0 4px 4px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>File Name</span>
                      <span style={{ width: 160, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>Type</span>
                      <span style={{ width: 32 }} />
                    </div>

                    {ce.files.map((file, fileIdx) => {
                      const fileHasError = validationErrors.some(e => e.folderIdx === folderIdx && e.fileIdx === fileIdx);
                      return (
                        <div key={fileIdx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileText size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <input
                              type="text"
                              value={file.name}
                              onChange={(e) => updateFileName(folderIdx, fileIdx, e.target.value)}
                              placeholder="filename.xml"
                              spellCheck={false}
                              style={{
                                background: 'var(--bg-deep)',
                                border: `1px solid ${fileHasError ? 'var(--danger)' : 'var(--border)'}`,
                                borderRadius: 4,
                                color: 'var(--text-primary)', padding: '4px 8px', fontSize: 13,
                                fontFamily: 'monospace', width: '100%',
                              }}
                            />
                          </div>
                          <select
                            value={file.type}
                            onChange={(e) => updateFileType(folderIdx, fileIdx, e.target.value)}
                            style={{
                              width: 160, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 4,
                              color: 'var(--text-primary)', padding: '4px 8px', fontSize: 13, flexShrink: 0,
                            }}
                          >
                            {validTypes.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <button
                            className="btn btn-danger"
                            style={{ fontSize: 11, padding: '4px 6px', flexShrink: 0 }}
                            onClick={() => removeFile(folderIdx, fileIdx)}
                            title="Remove file"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '4px 0', textAlign: 'center' }}>
                    No files — this folder will be registered but empty.
                  </div>
                )}

                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => addFile(folderIdx)}>
                    <Plus size={12} /> Add File
                  </button>

                  {/* Quick-add common files if folder is empty */}
                  {(ce.files || []).length === 0 && (
                    <>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Quick:</span>
                      {['types', 'events', 'globals'].map(type => (
                        <button
                          key={type}
                          className="btn btn-secondary"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => {
                            const name = ce.folder ? `${ce.folder.replace(/\//g, '_')}_${type}.xml` : `${type}.xml`;
                            setFolders(prev => prev.map((f, i) => {
                              if (i !== folderIdx) return f;
                              return { ...f, files: [...(f.files || []), { name, type }] };
                            }));
                          }}
                        >
                          + {type}.xml
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Bottom Save Bar ────────────────────────────── */}
      {folders.length > 0 && hasChanges && (
        <div style={{
          position: 'sticky', bottom: 0, padding: '12px 16px', marginTop: 8,
          background: 'var(--bg-card)', borderRadius: 8,
          border: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.15)',
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {validationErrors.length > 0
              ? `${validationErrors.length} error(s) — fix before saving`
              : 'You have unsaved changes'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={loadData} disabled={saving}>Discard</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || validationErrors.length > 0}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
