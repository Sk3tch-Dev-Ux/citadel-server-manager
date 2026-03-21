import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';

// ─── Section config ──────────────────────────────────────────

const SECTIONS = [
  { key: 'categories', label: 'Categories' },
  { key: 'usages', label: 'Usage Flags' },
  { key: 'values', label: 'Value Flags' },
  { key: 'tags', label: 'Tags' },
];

// ─── Main Component ──────────────────────────────────────────

export default function LimitsEditorPage({ serverId }) {
  const [data, setData] = useState({ categories: [], usages: [], values: [], tags: [] });
  const [original, setOriginal] = useState({ categories: [], usages: [], values: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addInputs, setAddInputs] = useState({ categories: '', usages: '', values: '', tags: '' });
  const [editingItem, setEditingItem] = useState(null); // { section, index }
  const [editValue, setEditValue] = useState('');

  // ─── Data Loading ────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await API.get(`/api/servers/${serverId}/limits`);
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        const d = {
          categories: result.categories || [],
          usages: result.usages || [],
          values: result.values || [],
          tags: result.tags || [],
        };
        setData(d);
        setOriginal(JSON.parse(JSON.stringify(d)));
      }
    } catch (err) {
      window.addToast?.('Failed to load limits definition', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Modification tracking ───────────────────────────────

  const hasChanges = useMemo(() => {
    return JSON.stringify(data) !== JSON.stringify(original);
  }, [data, original]);

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
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/limits`, data);
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        window.addToast?.('Limits definition saved', 'success');
        setOriginal(JSON.parse(JSON.stringify(data)));
      }
    } catch (err) {
      window.addToast?.('Failed to save limits definition', 'error');
    }
    setSaving(false);
  };

  // ─── Item operations ─────────────────────────────────────

  const addItem = (section) => {
    const value = addInputs[section].trim();
    if (!value) return;
    if (data[section].includes(value)) {
      window.addToast?.(`"${value}" already exists in ${section}`, 'error');
      return;
    }
    setData(prev => ({ ...prev, [section]: [...prev[section], value] }));
    setAddInputs(prev => ({ ...prev, [section]: '' }));
  };

  const removeItem = (section, index) => {
    setData(prev => ({
      ...prev,
      [section]: prev[section].filter((_, i) => i !== index),
    }));
    // Cancel editing if we removed the edited item
    if (editingItem && editingItem.section === section && editingItem.index === index) {
      setEditingItem(null);
    }
  };

  const startEdit = (section, index) => {
    setEditingItem({ section, index });
    setEditValue(data[section][index]);
  };

  const confirmEdit = () => {
    if (!editingItem) return;
    const { section, index } = editingItem;
    const trimmed = editValue.trim();
    if (!trimmed) {
      setEditingItem(null);
      return;
    }
    // Check for duplicates (except self)
    if (data[section].some((v, i) => i !== index && v === trimmed)) {
      window.addToast?.(`"${trimmed}" already exists`, 'error');
      return;
    }
    setData(prev => ({
      ...prev,
      [section]: prev[section].map((v, i) => i === index ? trimmed : v),
    }));
    setEditingItem(null);
  };

  const cancelEdit = () => {
    setEditingItem(null);
  };

  // ─── Render ──────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading limits definition...
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>Limits Definition Editor</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            cfglimitsdefinition.xml — Categories, usage flags, value flags, and tags
          </p>
        </div>
        <button
          className={`btn ${hasChanges ? 'btn-primary' : 'btn-secondary'}`}
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving...' : hasChanges ? 'Save Changes (Ctrl+S)' : 'No Changes'}
        </button>
      </div>

      {/* Four-column grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {SECTIONS.map(({ key, label }) => {
          const items = data[key];
          const origItems = original[key];
          const changed = JSON.stringify(items) !== JSON.stringify(origItems);

          return (
            <div key={key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Column header */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--bg-secondary, var(--bg-card))',
              }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 10,
                  background: changed ? 'var(--accent, #3b82f6)' : 'var(--bg-tertiary, rgba(255,255,255,0.06))',
                  color: changed ? '#fff' : 'var(--text-muted)',
                }}>
                  {items.length}
                </span>
              </div>

              {/* Items list */}
              <div style={{ maxHeight: 400, overflowY: 'auto', padding: '4px 0' }}>
                {items.length === 0 && (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No items
                  </div>
                )}
                {items.map((item, index) => {
                  const isEditing = editingItem && editingItem.section === key && editingItem.index === index;
                  return (
                    <div
                      key={`${key}-${index}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        gap: 8,
                        borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.04))',
                      }}
                    >
                      {isEditing ? (
                        <input
                          className="input"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') confirmEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          onBlur={confirmEdit}
                          autoFocus
                          style={{ flex: 1, padding: '2px 6px', fontSize: 13 }}
                        />
                      ) : (
                        <span
                          onClick={() => startEdit(key, index)}
                          style={{
                            flex: 1,
                            fontSize: 13,
                            cursor: 'pointer',
                            color: 'var(--text-primary)',
                            padding: '2px 0',
                          }}
                          title="Click to rename"
                        >
                          {item}
                        </span>
                      )}
                      <button
                        onClick={() => removeItem(key, index)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          fontSize: 14,
                          lineHeight: 1,
                          padding: '2px 4px',
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                        onMouseEnter={e => e.target.style.color = 'var(--danger, #ef4444)'}
                        onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}
                        title="Remove"
                      >
                        X
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add input */}
              <div style={{
                padding: '8px 12px',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: 6,
              }}>
                <input
                  className="input"
                  placeholder={`Add ${label.toLowerCase()}...`}
                  value={addInputs[key]}
                  onChange={e => setAddInputs(prev => ({ ...prev, [key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addItem(key); }}
                  style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => addItem(key)}
                  disabled={!addInputs[key].trim()}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
