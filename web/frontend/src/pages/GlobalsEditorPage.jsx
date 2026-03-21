import { useState, useEffect, useMemo, useCallback } from 'react';
import API from '../api';

// ─── Category display order ─────────────────────────────────

const CATEGORY_ORDER = ['Animals & Infected', 'Cleanup', 'Economy', 'Player', 'World', 'Other'];

// ─── Main Component ─────────────────────────────────────────

export default function GlobalsEditorPage({ serverId }) {
  const [globals, setGlobals] = useState([]);
  const [original, setOriginal] = useState([]);
  const [metadata, setMetadata] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');

  // ─── Data Loading ───────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/globals`);
      if (data.error) {
        window.addToast?.(data.error, 'error');
      } else {
        setGlobals(data.globals || []);
        setOriginal(JSON.parse(JSON.stringify(data.globals || [])));
        setMetadata(data.metadata || {});
      }
    } catch (err) {
      window.addToast?.('Failed to load globals data', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Keyboard shortcut (Ctrl+S) ────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // ─── Modification tracking ─────────────────────────────

  const modifiedNames = useMemo(() => {
    const set = new Set();
    for (const g of globals) {
      const orig = original.find(o => o.name === g.name);
      if (!orig || orig.value !== g.value) set.add(g.name);
    }
    return set;
  }, [globals, original]);

  const modifiedCount = modifiedNames.size;

  // ─── Update a single global value ──────────────────────

  const updateValue = (name, newValue) => {
    setGlobals(prev => prev.map(g =>
      g.name === name ? { ...g, value: newValue } : g
    ));
  };

  // ─── Save ──────────────────────────────────────────────

  const handleSave = async () => {
    if (modifiedCount === 0) {
      window.addToast?.('No changes to save', 'info');
      return;
    }
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/globals`, { globals });
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        window.addToast?.(`Saved ${result.count} global variables`, 'success');
        setOriginal(JSON.parse(JSON.stringify(globals)));
      }
    } catch {
      window.addToast?.('Failed to save globals', 'error');
    }
    setSaving(false);
  };

  // ─── Reset ─────────────────────────────────────────────

  const handleReset = () => {
    setGlobals(JSON.parse(JSON.stringify(original)));
  };

  // ─── Filter & Group ────────────────────────────────────

  const filtered = useMemo(() => {
    if (!searchText) return globals;
    const s = searchText.toLowerCase();
    return globals.filter(g => g.name.toLowerCase().includes(s));
  }, [globals, searchText]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const g of filtered) {
      const meta = metadata[g.name];
      const category = meta ? meta.category : 'Other';
      if (!groups[category]) groups[category] = [];
      groups[category].push(g);
    }
    // Sort by defined order
    const sorted = {};
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]) sorted[cat] = groups[cat];
    }
    // Include any categories not in the predefined order
    for (const cat of Object.keys(groups)) {
      if (!sorted[cat]) sorted[cat] = groups[cat];
    }
    return sorted;
  }, [filtered, metadata]);

  // ─── Render ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        <span>Loading globals data...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Search variables..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {filtered.length} variable{filtered.length !== 1 ? 's' : ''}
          {modifiedCount > 0 && (
            <span style={{
              marginLeft: 8,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'var(--warning, #f59e0b)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
            }}>
              {modifiedCount} modified
            </span>
          )}
        </span>
        <button
          className="btn btn-secondary"
          onClick={handleReset}
          disabled={modifiedCount === 0}
        >
          Reset
        </button>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || modifiedCount === 0}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Grouped Tables */}
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '10px 16px',
            fontWeight: 600,
            fontSize: 14,
            borderBottom: '1px solid var(--border, #333)',
            background: 'var(--bg-secondary, #1a1a2e)',
          }}>
            {category}
          </div>
          <table className="table" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th style={{ width: '30%' }}>Variable Name</th>
                <th style={{ width: '150px' }}>Value</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {items.map(g => {
                const meta = metadata[g.name];
                const isModified = modifiedNames.has(g.name);
                return (
                  <tr
                    key={g.name}
                    style={isModified ? { background: 'rgba(245, 158, 11, 0.08)' } : undefined}
                  >
                    <td style={{ fontFamily: 'monospace', fontSize: 13 }}>
                      {g.name}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input"
                        value={g.value}
                        min={meta ? meta.min : undefined}
                        max={meta ? meta.max : undefined}
                        onChange={e => updateValue(g.name, e.target.value)}
                        style={{ width: '100%', maxWidth: 120 }}
                      />
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {meta ? meta.description : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {searchText ? 'No variables match your search.' : 'No globals variables found.'}
        </div>
      )}
    </div>
  );
}
