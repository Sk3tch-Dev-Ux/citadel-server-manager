import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import SchemaEditor from '../components/SchemaEditor';
import JsonConfigEditor from '../components/JsonConfigEditor';
import { Puzzle, ArrowLeft, Save, RotateCcw, RefreshCw, FileCode, FolderOpen, AlertTriangle } from '../components/Icon';
import { formatBytes, timeAgo } from '../utils';

/**
 * ModConfigsPage — the main mod config hub page.
 *
 * Props: { serverId }
 *
 * Two views:
 *   A) Hub View (default) — lists all detected mods as cards
 *   B) Editor View (when a mod is selected) — config file tabs with schema or raw editor
 */
export default function ModConfigsPage({ serverId }) {
  const navigate = useNavigate();
  const [selectedMod, setSelectedMod] = useState(null);
  const [modList, setModList] = useState({ installed: [], available: [] });
  const [modData, setModData] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [modified, setModified] = useState({});     // { [fileName]: boolean }
  const [editedData, setEditedData] = useState({});  // { [fileName]: data }
  const [loading, setLoading] = useState(true);
  const [loadingMod, setLoadingMod] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef(null);

  // ─── Auto-detected configs (generic JSON files in profiles/) ─────
  const [detected, setDetected] = useState({ profileDir: null, groups: [], truncated: false });
  const [detectedLoading, setDetectedLoading] = useState(true);
  const [detectedError, setDetectedError] = useState(null);
  const [selectedDetectedFile, setSelectedDetectedFile] = useState(null); // { relativePath, fileName, modName }
  const [detectedFileContent, setDetectedFileContent] = useState(null);    // parsed JSON
  const [detectedFileRaw, setDetectedFileRaw] = useState(null);            // raw text
  const [detectedFileParseError, setDetectedFileParseError] = useState(null);
  const [detectedFileLoading, setDetectedFileLoading] = useState(false);
  const [detectedFileDirty, setDetectedFileDirty] = useState(false);

  const loadDetected = useCallback(() => {
    setDetectedLoading(true);
    setDetectedError(null);
    API.get(`/api/servers/${serverId}/mod-configs/detected`)
      .then((data) => {
        if (data && !data.error) {
          setDetected({
            profileDir: data.profileDir || null,
            groups: Array.isArray(data.groups) ? data.groups : [],
            truncated: !!data.truncated,
          });
        } else {
          setDetectedError(data?.error || 'Failed to load');
        }
      })
      .catch((err) => setDetectedError(err?.message || 'Failed to load detected configs'))
      .finally(() => setDetectedLoading(false));
  }, [serverId]);

  // Load mod list on mount
  useEffect(() => {
    setLoading(true);
    API.get(`/api/servers/${serverId}/mod-configs`)
      .then(data => {
        if (data && !data.error) {
          setModList({
            installed: Array.isArray(data.installed) ? data.installed : [],
            available: Array.isArray(data.available) ? data.available : [],
          });
        }
      })
      .catch(() => window.addToast?.('Failed to load mod configs', 'error'))
      .finally(() => setLoading(false));
    loadDetected();
  }, [serverId, loadDetected]);

  // Load a detected file's contents when one is selected
  useEffect(() => {
    if (!selectedDetectedFile) {
      setDetectedFileContent(null);
      setDetectedFileRaw(null);
      setDetectedFileParseError(null);
      setDetectedFileDirty(false);
      return;
    }
    setDetectedFileLoading(true);
    API.get(`/api/servers/${serverId}/mod-configs/detected/content?path=${encodeURIComponent(selectedDetectedFile.relativePath)}`)
      .then((data) => {
        if (data && !data.error) {
          setDetectedFileRaw(data.content || '');
          setDetectedFileContent(data.parsed);
          setDetectedFileParseError(data.parseError || null);
          setDetectedFileDirty(false);
        } else {
          window.addToast?.(data?.error || 'Failed to load config', 'error');
          setSelectedDetectedFile(null);
        }
      })
      .catch((err) => {
        window.addToast?.(`Failed to load config: ${err.message}`, 'error');
        setSelectedDetectedFile(null);
      })
      .finally(() => setDetectedFileLoading(false));
  }, [selectedDetectedFile, serverId]);

  const handleSaveDetectedFile = useCallback(async () => {
    if (!selectedDetectedFile || !detectedFileDirty) return;
    // JsonConfigEditor edits the parsed object; stringify with 4-space indent
    // to match DayZ's conventional formatting
    const text = typeof detectedFileRaw === 'string'
      ? detectedFileRaw
      : JSON.stringify(detectedFileContent, null, 4);
    setSaving(true);
    try {
      // Validate JSON before sending
      JSON.parse(text);
      await API.put(`/api/servers/${serverId}/mod-configs/detected/content`, {
        path: selectedDetectedFile.relativePath,
        content: text,
      });
      setDetectedFileDirty(false);
      window.addToast?.(`Saved ${selectedDetectedFile.fileName}`, 'success');
    } catch (err) {
      window.addToast?.(`Save failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [selectedDetectedFile, detectedFileDirty, detectedFileRaw, detectedFileContent, serverId]);

  // Load mod data when a mod is selected
  useEffect(() => {
    if (!selectedMod) { setModData(null); return; }
    setLoadingMod(true);
    API.get(`/api/servers/${serverId}/mod-configs/${selectedMod}`)
      .then(data => {
        if (data && !data.error) {
          setModData(data);
          // Initialize edited data from the loaded config
          const configs = data.configs || {};
          const fileNames = Object.keys(configs);
          const initialEdited = {};
          fileNames.forEach(fn => {
            initialEdited[fn] = configs[fn].data;
          });
          setEditedData(initialEdited);
          setModified({});
          // Set first tab
          if (fileNames.length > 0 && !activeTab) {
            setActiveTab(fileNames[0]);
          } else if (fileNames.length > 0 && !fileNames.includes(activeTab)) {
            setActiveTab(fileNames[0]);
          }
        } else {
          window.addToast?.('Failed to load mod config', 'error');
        }
      })
      .catch(() => window.addToast?.('Failed to load mod config', 'error'))
      .finally(() => setLoadingMod(false));
  }, [selectedMod, serverId]);

  // Ctrl+S save shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (selectedDetectedFile && detectedFileDirty) {
          handleSaveDetectedFile();
        } else if (selectedMod && activeTab && modified[activeTab]) {
          handleSave();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleSelectMod = useCallback((schemaId) => {
    // Redirect to dedicated editor for Expansion
    if (schemaId === 'expansion') {
      navigate(`/servers/${serverId}/expansion`);
      return;
    }
    setSelectedMod(schemaId);
    setActiveTab(null);
    setModData(null);
    setEditedData({});
    setModified({});
  }, [navigate, serverId]);

  const handleBack = useCallback(() => {
    setSelectedMod(null);
    setModData(null);
    setActiveTab(null);
    setEditedData({});
    setModified({});
  }, []);

  const handleDataChange = useCallback((fileName, newData) => {
    setEditedData(prev => ({ ...prev, [fileName]: newData }));
    setModified(prev => ({ ...prev, [fileName]: true }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeTab || !selectedMod) return;
    setSaving(true);
    try {
      const payload = {
        fileName: activeTab,
        data: editedData[activeTab],
      };
      const result = await API.put(`/api/servers/${serverId}/mod-configs/${selectedMod}`, payload);
      if (result && !result.error) {
        window.addToast?.('Config saved successfully', 'success');
        setModified(prev => ({ ...prev, [activeTab]: false }));
      } else {
        window.addToast?.(result?.error || 'Failed to save config', 'error');
      }
    } catch {
      window.addToast?.('Failed to save config', 'error');
    } finally {
      setSaving(false);
    }
  }, [activeTab, selectedMod, editedData, serverId]);

  const handleReset = useCallback(async () => {
    if (!activeTab || !selectedMod) return;
    if (!confirm('Reset this config file to defaults? Your changes will be lost.')) return;
    try {
      const result = await API.post(`/api/servers/${serverId}/mod-configs/${selectedMod}/reset`, { fileName: activeTab });
      if (result && !result.error) {
        window.addToast?.('Config reset to defaults', 'success');
        // Reload the mod data
        setSelectedMod(prev => {
          // Force re-fetch by toggling
          setTimeout(() => setSelectedMod(selectedMod), 0);
          return null;
        });
      } else {
        window.addToast?.(result?.error || 'Failed to reset config', 'error');
      }
    } catch {
      window.addToast?.('Failed to reset config', 'error');
    }
  }, [activeTab, selectedMod, serverId]);

  // ── Detected File Editor View (generic JSON config editor for auto-detected files) ──
  if (selectedDetectedFile) {
    return (
      <div style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button
            onClick={() => {
              if (detectedFileDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
              setSelectedDetectedFile(null);
            }}
            className="btn btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ArrowLeft size={16} /> Back to Mod Configs
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileCode size={18} style={{ color: 'var(--accent)' }} />
              {selectedDetectedFile.fileName}
              {detectedFileDirty && <span style={{ color: '#ffd700', fontSize: 13 }}>{'\u25CF'} Modified</span>}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono, monospace)' }}>
              {selectedDetectedFile.modName} › {selectedDetectedFile.relativePath}
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSaveDetectedFile}
            disabled={!detectedFileDirty || saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Save size={14} /> {saving ? 'Saving…' : 'Save (Ctrl+S)'}
          </button>
        </div>

        {detectedFileLoading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading config file…</div>
        ) : detectedFileParseError ? (
          <div style={{
            padding: 16, background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 8, marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)', fontWeight: 600 }}>
              <AlertTriangle size={14} /> File is not valid JSON
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
              {detectedFileParseError}. You can still view + save the raw content below, but make sure it parses before saving — save is blocked otherwise.
            </div>
            <textarea
              className="input"
              value={detectedFileRaw || ''}
              onChange={(e) => { setDetectedFileRaw(e.target.value); setDetectedFileDirty(true); }}
              spellCheck={false}
              style={{ width: '100%', minHeight: '60vh', marginTop: 12, fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
            />
          </div>
        ) : (
          <JsonConfigEditor
            data={detectedFileContent}
            onChange={(newData) => {
              setDetectedFileContent(newData);
              setDetectedFileRaw(JSON.stringify(newData, null, 4));
              setDetectedFileDirty(true);
            }}
          />
        )}
      </div>
    );
  }

  // ── Hub View ──
  if (!selectedMod) {
    return (
      <div style={{ padding: 0 }}>
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Mod Configs</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>
            Configure your installed mods with schema-driven editors or raw JSON editing.
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading mod configs...</div>
        ) : modList.installed.length === 0 ? (
          <div className="card" style={{ padding: 32, textAlign: 'center' }}>
            <Puzzle size={48} style={{ opacity: 0.3, marginBottom: 12 }} />
            <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 500 }}>No mod configs detected</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
              Mod configs are automatically detected when mods are installed that have known configuration schemas.
              Install mods from the Mods page and their configs will appear here.
            </p>
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 16,
            }}>
              {modList.installed.map(mod => (
                <div
                  key={mod.schemaId}
                  className="card"
                  style={{ padding: 20, cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onClick={() => handleSelectMod(mod.schemaId)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: 'var(--bg-tertiary, #252540)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Puzzle size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{mod.displayName || mod.modName}</div>
                      {mod.description && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                          {mod.description}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                        <span>{mod.configFileCount || 0} config file{mod.configFileCount !== 1 ? 's' : ''}</span>
                        {mod.hasSchema && (
                          <span style={{ color: 'var(--success, #48bb78)' }}>Schema available</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, textAlign: 'right' }}>
                    <button className="btn btn-primary" style={{ fontSize: 13, padding: '6px 16px' }}>
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Available schemas section */}
            {modList.available.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 12, color: 'var(--text-muted)' }}>
                  Available Schemas (Not Installed)
                </h3>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 12,
                }}>
                  {modList.available.map(mod => (
                    <div
                      key={mod.schemaId}
                      className="card"
                      style={{ padding: 16, opacity: 0.6 }}
                    >
                      <div style={{ fontWeight: 500, fontSize: 14 }}>{mod.displayName || mod.modName}</div>
                      {mod.description && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{mod.description}</div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                        Install this mod to configure it here
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── Auto-detected configs ──────────────────────────────────
            Generic JSON files found in the server's profile directory.
            Grouped by top-level folder (= mod name). For mods without a
            schema-based editor — any mod that writes configs into
            profiles/ gets first-class UI for free. */}
        <div style={{ marginTop: 40, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderOpen size={16} style={{ color: 'var(--accent)' }} /> Auto-detected Configs
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                JSON config files discovered in your server&apos;s profile directory.
                {detected.profileDir && (
                  <> Scan root: <code style={{ fontSize: 11 }}>{detected.profileDir}</code></>
                )}
              </p>
            </div>
            <button
              className="btn btn-sm btn-secondary"
              onClick={loadDetected}
              disabled={detectedLoading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={13} /> {detectedLoading ? 'Scanning…' : 'Rescan'}
            </button>
          </div>

          {detected.truncated && (
            <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={12} /> Scan hit the 2,000-file safety cap — some configs may be missing.
            </div>
          )}

          {detectedLoading ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>Scanning profile directory…</div>
          ) : detectedError ? (
            <div style={{ padding: 12, color: 'var(--danger)', fontSize: 13 }}>
              <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              {detectedError}
            </div>
          ) : !detected.profileDir ? (
            <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No profile directory configured for this server. Set one under Settings → Server Paths, then rescan.
            </div>
          ) : detected.groups.length === 0 ? (
            <div className="card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No JSON configs found. Start your server once so mods can generate their default configs, then rescan.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {detected.groups.map((group) => (
                <div key={group.modName} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: '10px 14px', borderBottom: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface, var(--bg-card))',
                  }}>
                    <Puzzle size={14} style={{ color: 'var(--accent)' }} />
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{group.modName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {group.files.length} file{group.files.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div>
                    {group.files.map((f) => (
                      <button
                        key={f.relativePath}
                        onClick={() => setSelectedDetectedFile({
                          relativePath: f.relativePath,
                          fileName: f.fileName,
                          modName: group.modName,
                        })}
                        style={{
                          width: '100%', textAlign: 'left', padding: '8px 14px',
                          background: 'none', border: 'none', borderTop: '1px solid var(--border)',
                          cursor: 'pointer', color: 'inherit',
                          display: 'flex', alignItems: 'center', gap: 10,
                          fontSize: 13,
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 5%, transparent)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                      >
                        <FileCode size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                          {f.relativePath}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {formatBytes(f.size)} · {timeAgo(f.modifiedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Editor View ──
  const configs = modData?.configs || {};
  const fileNames = Object.keys(configs);
  const currentConfig = activeTab ? configs[activeTab] : null;
  const currentData = activeTab ? editedData[activeTab] : null;
  const hasSchema = currentConfig?.schema && Object.keys(currentConfig.schema.properties || {}).length > 0;
  const isModified = activeTab ? modified[activeTab] : false;

  return (
    <div style={{ padding: 0 }}>
      {/* Header with back button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          className="btn btn-secondary"
          onClick={handleBack}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13 }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            {modData?.modName || selectedMod}
          </h2>
          {modData?.modDir && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {modData.modDir}
            </div>
          )}
        </div>
      </div>

      {loadingMod ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading config...</div>
      ) : fileNames.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No config files found for this mod.</p>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid var(--border)',
            marginBottom: 20,
            overflowX: 'auto',
          }}>
            {fileNames.map(fn => {
              const cfg = configs[fn];
              const isActive = activeTab === fn;
              const isFileModified = modified[fn];
              return (
                <button
                  key={fn}
                  onClick={() => setActiveTab(fn)}
                  style={{
                    padding: '10px 20px',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                    background: 'none',
                    border: 'none',
                    borderBottom: isActive ? '2px solid var(--primary, #6366f1)' : '2px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'color 0.15s, border-color 0.15s',
                  }}
                >
                  {cfg.displayName || fn}
                  {isFileModified && <span style={{ color: 'var(--warning, #ecc94b)', marginLeft: 4 }}>*</span>}
                </button>
              );
            })}
          </div>

          {/* Active tab content */}
          {activeTab && currentConfig && (
            <div>
              {/* Config description */}
              {currentConfig.description && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                  {currentConfig.description}
                </div>
              )}

              {/* Parse error warning */}
              {currentConfig.parseError && (
                <div style={{
                  padding: '10px 14px',
                  marginBottom: 16,
                  borderRadius: 6,
                  background: 'var(--danger-bg, rgba(229,62,62,0.1))',
                  color: 'var(--danger, #e53e3e)',
                  fontSize: 13,
                }}>
                  Parse error: {currentConfig.parseError}. Showing raw content below.
                </div>
              )}

              {/* File not found */}
              {currentConfig.found === false ? (
                <div className="card" style={{ padding: 32, textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    Config file not found on disk. It may need to be created by running the mod first.
                  </p>
                </div>
              ) : hasSchema && !currentConfig.parseError ? (
                /* Schema editor */
                <div className="card" style={{ padding: 20 }}>
                  <SchemaEditor
                    schema={currentConfig.schema}
                    data={currentData || {}}
                    onChange={newData => handleDataChange(activeTab, newData)}
                  />
                </div>
              ) : (
                /* Raw JSON editor */
                <div className="card" style={{ padding: 20 }}>
                  <JsonConfigEditor
                    content={currentConfig.parseError ? (currentConfig.raw || '') : (currentData || currentConfig.data || {})}
                    onChange={newContent => handleDataChange(activeTab, newContent)}
                  />
                </div>
              )}

              {/* Action buttons */}
              {currentConfig.found !== false && (
                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={handleReset}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                  >
                    <RotateCcw size={14} /> Reset to Defaults
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={saving || !isModified}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                  >
                    <Save size={14} /> {saving ? 'Saving...' : 'Save'}{isModified ? ' *' : ''}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
