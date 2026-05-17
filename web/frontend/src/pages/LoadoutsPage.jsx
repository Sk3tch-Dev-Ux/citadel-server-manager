/**
 * LoadoutsPage — Expansion player + AI loadout editor.
 *
 * Manages JSON files under <server>/Profiles/ExpansionMod/Loadouts/, schema-
 * driven via backend/schemas/expansion/BanditLoadout.schema.json. Each file
 * is a freestanding loadout (player spawn loadout, AI faction loadout, etc.).
 *
 * Pattern matches Quest Creator / Trader Editor: file list on the left, schema
 * editor on the right, Docs deep-link + Save in the top toolbar, "+ New from
 * template" reuses the FilesPage template picker flow via direct API calls.
 *
 * Backend: /api/servers/:id/expansion/loadouts (CRUD)
 * Schema:  /api/mod-configs/expansion          (fetches BanditLoadout.schema.json)
 * Wiki:    https://dayzexpansion.com/tools/custom/expansion-loadout-builder
 */
import { useState, useEffect, useCallback } from 'react';
import API from '../api';
import SchemaEditor from '../components/SchemaEditor';
import { ArrowLeft, Save, Plus, X, Trash2, RefreshCw } from '../components/Icon';
import { toolWikiUrl, WIKI_TOOLS } from '../utils/wikiLinks';

const KIND_COLORS = {
  Player: 'var(--accent-blue)',
  Hero: 'var(--accent-green)',
  Bandit: 'var(--accent-red)',
  AI: 'var(--accent-orange, #f59e0b)',
  Loadout: 'var(--accent-purple, #a78bfa)',
  Custom: 'var(--text-muted)',
};

function KindBadge({ kind }) {
  const color = KIND_COLORS[kind] || KIND_COLORS.Custom;
  return (
    <span style={{
      padding: '1px 6px', fontSize: 10, fontWeight: 600, borderRadius: 3,
      background: `${color}22`, border: `1px solid ${color}55`, color,
      whiteSpace: 'nowrap',
    }}>{kind}</span>
  );
}

export default function LoadoutsPage({ serverId }) {
  const [loadouts, setLoadouts] = useState([]);          // [{name, kind, slotCount, itemCount, ...}]
  const [selected, setSelected] = useState(null);         // name string
  const [data, setData] = useState(null);                 // current loadout body
  const [originalData, setOriginalData] = useState(null); // baseline for "is modified"
  const [schema, setSchema] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  // -- Load file list --
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await API.get(`/api/servers/${serverId}/expansion/loadouts`);
      setLoadouts(Array.isArray(list) ? list : []);
    } catch (err) {
      window.addToast?.(err.message || 'Failed to load loadouts', 'error');
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  // -- Load schema (BanditLoadout) --
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // /mod-configs/:schemaId returns { manifest, schemas, configs } for
        // the mod. We pull just BanditLoadout — all Expansion loadout files
        // share the same shape so one schema covers them all.
        const bundle = await API.get(`/api/servers/${serverId}/mod-configs/expansion`);
        if (cancelled || !bundle) return;
        const schemas = bundle.schemas || {};
        // The schemas map is keyed by fileName (the manifest's `fileName` field).
        // BanditLoadout in our generated manifest is keyed under the upstream
        // file path. Find any key that ends in BanditLoadout.json.
        const key = Object.keys(schemas).find(k => k.endsWith('BanditLoadout.json'))
          || Object.keys(schemas).find(k => k.endsWith('Loadout.json'));
        if (key) setSchema(schemas[key]);
      } catch {
        // Schema fetch failure isn't fatal — editor falls back to raw view.
      }
    })();
    return () => { cancelled = true; };
  }, [serverId]);

  useEffect(() => { refresh(); }, [refresh]);

  // -- Select a loadout --
  const selectLoadout = useCallback(async (name) => {
    if (selected === name) return;
    if (data && JSON.stringify(data) !== JSON.stringify(originalData)) {
      if (!window.confirm('Discard unsaved changes?')) return;
    }
    setSelected(name);
    setData(null);
    setOriginalData(null);
    try {
      const body = await API.get(`/api/servers/${serverId}/expansion/loadouts/${encodeURIComponent(name)}`);
      setData(body);
      setOriginalData(JSON.parse(JSON.stringify(body)));
    } catch (err) {
      window.addToast?.(err.message || 'Failed to load file', 'error');
    }
  }, [serverId, selected, data, originalData]);

  const isModified = data && originalData && JSON.stringify(data) !== JSON.stringify(originalData);

  const handleSave = async () => {
    if (!selected || !data) return;
    setSaving(true);
    try {
      await API.put(`/api/servers/${serverId}/expansion/loadouts/${encodeURIComponent(selected)}`, data);
      setOriginalData(JSON.parse(JSON.stringify(data)));
      window.addToast?.('Saved (backup created)', 'success');
      // Refresh the list — slot/item counts may have changed.
      refresh();
    } catch (err) {
      window.addToast?.(err.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected}.json? A backup will be kept.`)) return;
    try {
      await API.delete(`/api/servers/${serverId}/expansion/loadouts/${encodeURIComponent(selected)}`);
      window.addToast?.('Deleted (backup kept)', 'success');
      setSelected(null);
      setData(null);
      setOriginalData(null);
      refresh();
    } catch (err) {
      window.addToast?.(err.message || 'Delete failed', 'error');
    }
  };

  const filtered = search
    ? loadouts.filter(l => l.name.toLowerCase().includes(search.toLowerCase()))
    : loadouts;

  return (
    <div className="fade-in">
      {/* Top toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Expansion Loadouts</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Player spawn loadouts + AI faction loadouts &middot; <code>Profiles/ExpansionMod/Loadouts/</code>
          </div>
        </div>
        {isModified && (
          <span style={{ color: 'var(--accent-orange, #f59e0b)', fontWeight: 600, fontSize: 13 }}>Unsaved changes</span>
        )}
        <a
          href={toolWikiUrl('expansion-loadout-builder')}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary"
          title={`Open in ${WIKI_TOOLS['expansion-loadout-builder']}`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 12, textDecoration: 'none' }}
        >
          Docs ↗
        </a>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !isModified}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        >
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Main split */}
      <div style={{ display: 'flex', gap: 16, minHeight: 600 }}>
        {/* Sidebar — loadout file list */}
        <div style={{
          width: 260, flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <input
              className="input"
              placeholder={`Search ${loadouts.length || ''} loadouts...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
            />
            <button className="btn btn-secondary btn-sm" onClick={() => setShowNew(true)} title="New loadout" style={{ padding: '4px 8px', fontSize: 12 }}>
              <Plus size={14} />
            </button>
            <button className="btn btn-ghost btn-sm" onClick={refresh} title="Refresh" style={{ padding: '4px 8px', fontSize: 12 }}>
              <RefreshCw size={14} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>}
            {!loading && filtered.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                {loadouts.length === 0
                  ? <>No loadouts found.<br/><br/>Click <Plus size={12} /> to create one.</>
                  : 'No matches.'}
              </div>
            )}
            {filtered.map(l => {
              const isActive = selected === l.name;
              return (
                <div
                  key={l.name}
                  onClick={() => selectLoadout(l.name)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    borderLeft: `3px solid ${isActive ? (KIND_COLORS[l.kind] || KIND_COLORS.Custom) : 'transparent'}`,
                    background: isActive ? 'var(--bg-elevated, var(--bg-deep))' : 'transparent',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <KindBadge kind={l.kind} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                    {l.slotCount != null ? `${l.slotCount} slots` : ''}
                    {l.slotCount != null && l.itemCount != null ? ' · ' : ''}
                    {l.itemCount != null ? `${l.itemCount} items` : ''}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
            {loadouts.length} loadout{loadouts.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected && (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Select a loadout from the list, or click <Plus size={12} /> to create one from a template.
            </div>
          )}
          {selected && !data && (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading {selected}…
            </div>
          )}
          {selected && data && (
            <div>
              <div className="card" style={{
                padding: '10px 16px', marginBottom: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{selected}.json</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {schema ? 'Schema-driven editor' : 'No schema available — basic editor'}
                  </div>
                </div>
                <button className="btn btn-danger btn-sm" onClick={handleDelete} title="Delete this loadout" style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>

              <div className="card" style={{ padding: 20 }}>
                {schema ? (
                  <SchemaEditor
                    schema={schema}
                    data={data || {}}
                    onChange={setData}
                  />
                ) : (
                  <pre style={{
                    fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
                    background: 'var(--bg-deep)', padding: 12, borderRadius: 4,
                    maxHeight: 600, overflow: 'auto',
                  }}>{JSON.stringify(data, null, 2)}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewLoadoutModal
          serverId={serverId}
          onClose={() => setShowNew(false)}
          onCreated={(name) => {
            setShowNew(false);
            refresh().then(() => selectLoadout(name));
          }}
        />
      )}
    </div>
  );
}

// ─── New loadout modal ──────────────────────────────────────────────
//
// Pulls the loadout-shaped templates from /api/expansion-docs/templates
// (Loadout, BanditLoadout, ExampleLoadout, etc.), lets the user pick one
// and provide a target name, and writes the rendered template via the
// existing /loadouts PUT endpoint.

const LOADOUT_TEMPLATE_PATTERN = /(Loadout|Bandit|Hero|Player|Spawn)/i;

function NewLoadoutModal({ serverId, onClose, onCreated }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [targetName, setTargetName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await API.get('/api/expansion-docs/templates');
        if (cancelled) return;
        const filtered = (Array.isArray(list) ? list : []).filter(t => LOADOUT_TEMPLATE_PATTERN.test(t.name));
        setTemplates(filtered);
      } catch {
        // ignore — empty list will render the "no templates" message
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // Default the target name to the template name minus any disambiguators.
    if (selected) {
      const cleaned = selected.name.replace(/_(Example|1|2|3)$/i, '');
      setTargetName(cleaned + '_New');
    }
  }, [selected]);

  const handleCreate = async () => {
    if (!selected || !targetName) return;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(targetName)) {
      window.addToast?.('Name can only contain letters, numbers, underscore, hyphen.', 'error');
      return;
    }
    setCreating(true);
    try {
      const body = await API.get(`/api/expansion-docs/templates/${encodeURIComponent(selected.name)}`);
      await API.put(`/api/servers/${serverId}/expansion/loadouts/${encodeURIComponent(targetName)}`, body);
      onCreated(targetName);
    } catch (err) {
      window.addToast?.(err.message || 'Create failed', 'error');
      setCreating(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card"
        style={{ width: 'min(560px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: 0 }}
      >
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontWeight: 600, flex: 1 }}>New loadout from template</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close"><X size={14} /></button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && templates.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
              No loadout templates available.
            </div>
          )}
          {!loading && templates.map(t => (
            <div
              key={t.name}
              onClick={() => setSelected(t)}
              style={{
                padding: '6px 10px', cursor: 'pointer', borderRadius: 4,
                background: selected?.name === t.name ? 'var(--bg-surface, var(--bg-deep))' : 'transparent',
                fontFamily: 'var(--font-mono, monospace)', fontSize: 12,
                borderLeft: selected?.name === t.name ? '2px solid var(--accent-blue)' : '2px solid transparent',
              }}
            >
              {t.name}
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', background: 'var(--bg-surface, var(--bg-deep))' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              File name (without .json)
            </label>
            <input
              className="input"
              value={targetName}
              onChange={e => setTargetName(e.target.value)}
              style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}
            />
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Will be written to <code>Profiles/ExpansionMod/Loadouts/{targetName || '...'}.json</code>
            </div>
          </div>
        )}

        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={creating}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={!selected || !targetName || creating}>
            {creating ? 'Creating…' : 'Create loadout'}
          </button>
        </div>
      </div>
    </div>
  );
}
