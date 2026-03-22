import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import SchemaEditor from '../components/SchemaEditor';
import JsonConfigEditor from '../components/JsonConfigEditor';
import { Puzzle, ArrowLeft, Save, RotateCcw } from '../components/Icon';

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
  }, [serverId]);

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
        if (selectedMod && activeTab && modified[activeTab]) {
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
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
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
