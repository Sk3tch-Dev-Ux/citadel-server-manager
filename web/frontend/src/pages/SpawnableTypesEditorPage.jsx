/**
 * Spawnable Types Editor — cfgspawnabletypes.xml full-feature editor.
 *
 * Reworked in v2.6:
 *   - Side-panel detail view (was: accordion expand-row — unusable with 500+ types)
 *   - Debounced search (180ms) + column sort
 *   - 200 items/page (was: 100)
 *   - Preset references: items within groups can be either direct class names
 *     or references to cfgrandompresets.xml entries (preset="1")
 *   - Damage min/max editor (was: silently dropped during save)
 *   - Parser rewritten on fast-xml-parser — round-trip preserves all fields
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import API from '../api';
import { useDebouncedValue } from '../utils';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import {
  Search, Save, Plus, Trash2, X, ChevronUp, ChevronDown, AlertTriangle,
  Package, Layers, Crosshair, RefreshCw,
} from '../components/Icon';

const PAGE_SIZE = 200;

const DEFAULT_TYPE = { name: '', hoarder: false, damage: null, attachments: [], cargo: [] };
const DEFAULT_GROUP = { chance: 0.50, items: [] };
const DEFAULT_ITEM = { name: '', chance: 1.00, preset: false };

export default function SpawnableTypesEditorPage({ serverId }) {
  const [items, setItems] = useState([]);
  const [presets, setPresets] = useState({ cargo: [], attachments: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedName, setSelectedName] = useState(null);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [modifiedNames, setModifiedNames] = useState(new Set());

  const debouncedSearch = useDebouncedValue(searchText, 180);
  const saveInFlight = useRef(false);

  // ─── Load ────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [typesRes, presetsRes] = await Promise.all([
        API.get(`/api/servers/${serverId}/spawnabletypes`),
        API.get(`/api/servers/${serverId}/spawnabletypes/presets`).catch(() => ({ cargo: [], attachments: [] })),
      ]);
      if (typesRes?.error) {
        window.addToast?.(typesRes.error, 'error');
      } else {
        setItems(Array.isArray(typesRes?.items) ? typesRes.items : []);
        setModifiedNames(new Set());
      }
      setPresets({
        cargo: Array.isArray(presetsRes?.cargo) ? presetsRes.cargo : [],
        attachments: Array.isArray(presetsRes?.attachments) ? presetsRes.attachments : [],
      });
    } catch (err) {
      window.addToast?.(`Failed to load spawnable types: ${err.message}`, 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Filter + sort + paginate ────────────────────────────
  const filtered = useMemo(() => {
    let out = items;
    const q = debouncedSearch.trim().toLowerCase();
    if (q) out = out.filter((i) => i.name.toLowerCase().includes(q));
    const dir = sortDir === 'asc' ? 1 : -1;
    const sorter = {
      name: (a, b) => a.name.localeCompare(b.name),
      attachments: (a, b) => (a.attachments?.length || 0) - (b.attachments?.length || 0),
      cargo: (a, b) => (a.cargo?.length || 0) - (b.cargo?.length || 0),
      hoarder: (a, b) => Number(!!b.hoarder) - Number(!!a.hoarder),
    }[sortBy] || ((a, b) => a.name.localeCompare(b.name));
    out = [...out].sort((a, b) => dir * sorter(a, b));
    return out;
  }, [items, debouncedSearch, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  useEffect(() => { setPage(0); }, [debouncedSearch, sortBy, sortDir]);

  const selected = useMemo(
    () => (selectedName ? items.find((i) => i.name === selectedName) : null),
    [selectedName, items]
  );

  // ─── Mutations ───────────────────────────────────────────
  const markModified = (name) => setModifiedNames((prev) => new Set(prev).add(name));

  const updateSelected = (patch) => {
    if (!selectedName) return;
    setItems((prev) => prev.map((it) => (it.name === selectedName ? { ...it, ...patch } : it)));
    markModified(selectedName);
  };

  const setGroup = (kind, idx, patch) => {
    if (!selected) return;
    const groups = [...(selected[kind] || [])];
    groups[idx] = { ...groups[idx], ...patch };
    updateSelected({ [kind]: groups });
  };

  const addGroup = (kind) => {
    if (!selected) return;
    updateSelected({ [kind]: [...(selected[kind] || []), { ...DEFAULT_GROUP, items: [] }] });
  };

  const removeGroup = (kind, idx) => {
    if (!selected) return;
    const groups = [...(selected[kind] || [])];
    groups.splice(idx, 1);
    updateSelected({ [kind]: groups });
  };

  const setGroupItem = (kind, groupIdx, itemIdx, patch) => {
    if (!selected) return;
    const groups = [...(selected[kind] || [])];
    const groupItems = [...(groups[groupIdx].items || [])];
    groupItems[itemIdx] = { ...groupItems[itemIdx], ...patch };
    groups[groupIdx] = { ...groups[groupIdx], items: groupItems };
    updateSelected({ [kind]: groups });
  };

  const addGroupItem = (kind, groupIdx) => {
    if (!selected) return;
    const groups = [...(selected[kind] || [])];
    const groupItems = [...(groups[groupIdx].items || []), { ...DEFAULT_ITEM }];
    groups[groupIdx] = { ...groups[groupIdx], items: groupItems };
    updateSelected({ [kind]: groups });
  };

  const removeGroupItem = (kind, groupIdx, itemIdx) => {
    if (!selected) return;
    const groups = [...(selected[kind] || [])];
    const groupItems = [...(groups[groupIdx].items || [])];
    groupItems.splice(itemIdx, 1);
    groups[groupIdx] = { ...groups[groupIdx], items: groupItems };
    updateSelected({ [kind]: groups });
  };

  // ─── Save ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    try {
      const res = await API.put(`/api/servers/${serverId}/spawnabletypes`, { items });
      if (res?.error) throw new Error(res.error);
      setModifiedNames(new Set());
      window.addToast?.(`Saved ${items.length} spawnable types`, 'success');
    } catch (err) {
      window.addToast?.(`Save failed: ${err.message}`, 'error');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }, [items, serverId]);

  useKeyboardShortcuts({
    'ctrl+s': () => { if (modifiedNames.size > 0) handleSave(); },
    'escape': () => setSelectedName(null),
  });

  const handleAddType = (name, hoarder) => {
    const trimmed = name.trim();
    if (!trimmed) return window.addToast?.('Name is required', 'error');
    if (items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase())) {
      return window.addToast?.(`"${trimmed}" already exists`, 'error');
    }
    const next = { ...DEFAULT_TYPE, name: trimmed, hoarder: !!hoarder };
    setItems((prev) => [next, ...prev]);
    markModified(trimmed);
    setSelectedName(trimmed);
    setShowAddModal(false);
  };

  const handleDeleteType = (name) => {
    setItems((prev) => prev.filter((i) => i.name !== name));
    setModifiedNames((prev) => {
      const next = new Set(prev);
      next.add(name); // mark the deletion as dirty so Save flushes it
      return next;
    });
    if (selectedName === name) setSelectedName(null);
    setDeleteConfirm(null);
  };

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  // ─── Render ──────────────────────────────────────────────
  return (
    <div style={{ padding: 16, height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={20} style={{ color: 'var(--accent)' }} />
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Spawnable Types</h1>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} of {items.length} type{items.length === 1 ? '' : 's'}
          {modifiedNames.size > 0 && <> · <span style={{ color: '#f59e0b' }}>{modifiedNames.size} modified</span></>}
        </span>

        <div style={{ flex: 1 }} />

        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Filter by name…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ paddingLeft: 30, minWidth: 220 }}
          />
        </div>

        <button className="btn btn-sm btn-secondary" onClick={loadData} disabled={loading || saving}>
          <RefreshCw size={13} /> Reload
        </button>
        <button className="btn btn-sm btn-secondary" onClick={() => setShowAddModal(true)}>
          <Plus size={13} /> Add Type
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={handleSave}
          disabled={saving || modifiedNames.size === 0}
          title="Ctrl+S"
        >
          <Save size={13} /> {saving ? 'Saving…' : `Save${modifiedNames.size > 0 ? ` (${modifiedNames.size})` : ''}`}
        </button>
      </div>

      {/* Main split — table left, detail panel right */}
      <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="table-wrap" style={{ flex: 1, overflow: 'auto' }}>
            <table>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-surface, var(--bg-card))' }}>
                <tr>
                  <SortableTh col="name" label="Name" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} />
                  <SortableTh col="hoarder" label="Hoarder" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} style={{ width: 80 }} />
                  <SortableTh col="attachments" label="Attachments" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} style={{ width: 120 }} />
                  <SortableTh col="cargo" label="Cargo" sortBy={sortBy} sortDir={sortDir} onClick={toggleSort} style={{ width: 100 }} />
                  <th style={{ width: 60 }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</td></tr>
                ) : paged.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    {items.length === 0 ? 'No spawnable types in this file.' : 'No matches for current filter.'}
                  </td></tr>
                ) : paged.map((item) => (
                  <tr
                    key={item.name}
                    onClick={() => setSelectedName(item.name)}
                    style={{
                      cursor: 'pointer',
                      background: selectedName === item.name ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined,
                    }}
                  >
                    <td style={{ fontWeight: 600 }}>
                      {item.name}
                      {modifiedNames.has(item.name) && <span style={{ color: '#f59e0b', marginLeft: 6 }}>•</span>}
                    </td>
                    <td>
                      {item.hoarder ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', background: 'color-mix(in srgb, #22c55e 15%, transparent)', color: '#22c55e', borderRadius: 3 }}>HOARDER</span>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td>{(item.attachments || []).length}</td>
                    <td>{(item.cargo || []).length}</td>
                    <td>
                      <button
                        className="btn btn-xs btn-ghost"
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(item.name); }}
                        title="Delete type"
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 10 }}>
              <button className="btn btn-xs btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
              <button className="btn btn-xs btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel
            item={selected}
            presets={presets}
            onClose={() => setSelectedName(null)}
            onPatch={updateSelected}
            onGroupPatch={setGroup}
            onGroupAdd={addGroup}
            onGroupRemove={removeGroup}
            onItemPatch={setGroupItem}
            onItemAdd={addGroupItem}
            onItemRemove={removeGroupItem}
          />
        )}
      </div>

      {showAddModal && <AddTypeModal onAdd={handleAddType} onClose={() => setShowAddModal(false)} />}
      {deleteConfirm && (
        <ConfirmDeleteModal
          name={deleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => handleDeleteType(deleteConfirm)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────

function SortableTh({ col, label, sortBy, sortDir, onClick, style }) {
  const active = sortBy === col;
  return (
    <th
      onClick={() => onClick(col)}
      style={{ cursor: 'pointer', userSelect: 'none', ...style }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {active && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </span>
    </th>
  );
}

function DetailPanel({ item, presets, onClose, onPatch, onGroupPatch, onGroupAdd, onGroupRemove, onItemPatch, onItemAdd, onItemRemove }) {
  return (
    <div style={{
      width: 460, flexShrink: 0,
      background: 'var(--bg-surface, var(--bg-card))',
      border: '1px solid var(--border)',
      borderRadius: 8,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Crosshair size={14} style={{ color: 'var(--accent)' }} />
        <strong style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</strong>
        <button onClick={onClose} className="btn btn-xs btn-ghost" title="Close (Esc)"><X size={12} /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Flags */}
        <section>
          <h4 style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>Flags</h4>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!item.hoarder}
              onChange={(e) => onPatch({ hoarder: e.target.checked })}
            />
            Hoarder <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(this item may contain hoarded loot)</span>
          </label>
        </section>

        {/* Damage */}
        <section>
          <h4 style={{ margin: '0 0 8px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>Damage range</h4>
          <DamageEditor
            damage={item.damage}
            onChange={(damage) => onPatch({ damage })}
          />
        </section>

        {/* Attachments */}
        <GroupListEditor
          kind="attachments"
          label="Attachment Groups"
          icon={<Layers size={12} />}
          groups={item.attachments || []}
          presets={presets.attachments}
          onGroupPatch={(idx, patch) => onGroupPatch('attachments', idx, patch)}
          onGroupAdd={() => onGroupAdd('attachments')}
          onGroupRemove={(idx) => onGroupRemove('attachments', idx)}
          onItemPatch={(gi, ii, patch) => onItemPatch('attachments', gi, ii, patch)}
          onItemAdd={(gi) => onItemAdd('attachments', gi)}
          onItemRemove={(gi, ii) => onItemRemove('attachments', gi, ii)}
        />

        {/* Cargo */}
        <GroupListEditor
          kind="cargo"
          label="Cargo Groups"
          icon={<Package size={12} />}
          groups={item.cargo || []}
          presets={presets.cargo}
          onGroupPatch={(idx, patch) => onGroupPatch('cargo', idx, patch)}
          onGroupAdd={() => onGroupAdd('cargo')}
          onGroupRemove={(idx) => onGroupRemove('cargo', idx)}
          onItemPatch={(gi, ii, patch) => onItemPatch('cargo', gi, ii, patch)}
          onItemAdd={(gi) => onItemAdd('cargo', gi)}
          onItemRemove={(gi, ii) => onItemRemove('cargo', gi, ii)}
        />
      </div>
    </div>
  );
}

function DamageEditor({ damage, onChange }) {
  const enabled = !!damage;
  const min = damage?.min ?? 0;
  const max = damage?.max ?? 1;
  return (
    <div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { min: 0, max: 1 } : null)}
        />
        Override spawn health range
      </label>
      {enabled && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', flex: 1 }}>
            Min
            <input
              className="input"
              type="number" step="0.05" min="0" max="1"
              value={min}
              onChange={(e) => onChange({ ...damage, min: parseFloat(e.target.value) || 0 })}
              style={{ marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', flex: 1 }}>
            Max
            <input
              className="input"
              type="number" step="0.05" min="0" max="1"
              value={max}
              onChange={(e) => onChange({ ...damage, max: parseFloat(e.target.value) || 1 })}
              style={{ marginTop: 2 }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function GroupListEditor({ kind, label, icon, groups, presets, onGroupPatch, onGroupAdd, onGroupRemove, onItemPatch, onItemAdd, onItemRemove }) {
  const datalistId = `spawnable-presets-${kind}`;
  return (
    <section>
      {/* Shared datalist for all preset pickers in this group section. */}
      <datalist id={datalistId}>
        {presets.map((p) => <option key={p.name} value={p.name}>{`${p.itemCount} items`}</option>)}
      </datalist>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {icon} {label} ({groups.length})
        </h4>
        <button className="btn btn-xs btn-ghost" onClick={onGroupAdd}><Plus size={11} /> Add group</button>
      </div>
      {groups.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>No groups.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {groups.map((group, gi) => (
            <div key={gi} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>chance</span>
                <input
                  className="input"
                  type="number" step="0.05" min="0" max="1"
                  value={group.chance}
                  onChange={(e) => onGroupPatch(gi, { chance: parseFloat(e.target.value) || 0 })}
                  style={{ width: 70, fontSize: 12 }}
                />
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{(group.items || []).length} item{(group.items || []).length === 1 ? '' : 's'}</span>
                <button className="btn btn-xs btn-ghost" onClick={() => onGroupRemove(gi)} title="Delete group" style={{ color: 'var(--danger)' }}>
                  <Trash2 size={11} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(group.items || []).map((it, ii) => (
                  <ItemRow
                    key={ii}
                    item={it}
                    presetDatalistId={datalistId}
                    hasPresets={presets.length > 0}
                    onChange={(patch) => onItemPatch(gi, ii, patch)}
                    onRemove={() => onItemRemove(gi, ii)}
                  />
                ))}
                <button
                  className="btn btn-xs btn-ghost"
                  onClick={() => onItemAdd(gi)}
                  style={{ alignSelf: 'flex-start', color: 'var(--text-muted)' }}
                >
                  <Plus size={10} /> Add item
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ItemRow({ item, presetDatalistId, hasPresets, onChange, onRemove }) {
  const isPreset = !!item.preset;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
      {/* Item type toggle — direct class vs preset reference */}
      <select
        className="input"
        value={isPreset ? 'preset' : 'item'}
        onChange={(e) => onChange({ preset: e.target.value === 'preset' })}
        style={{ width: 70, fontSize: 11, padding: '2px 4px' }}
        title={isPreset ? 'Resolves from cfgrandompresets.xml' : 'Direct item class'}
      >
        <option value="item">Item</option>
        <option value="preset">Preset</option>
      </select>

      {/* Name — preset mode uses the shared datalist for autocomplete */}
      <input
        className="input"
        list={isPreset && hasPresets ? presetDatalistId : undefined}
        value={item.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={isPreset ? 'preset name…' : 'item class…'}
        style={{ flex: 1, fontSize: 12, padding: '2px 6px' }}
      />

      {/* Chance */}
      <input
        className="input"
        type="number" step="0.05" min="0" max="1"
        value={item.chance}
        onChange={(e) => onChange({ chance: parseFloat(e.target.value) || 0 })}
        style={{ width: 60, fontSize: 12, padding: '2px 4px' }}
      />

      <button className="btn btn-xs btn-ghost" onClick={onRemove} title="Remove item" style={{ color: 'var(--danger)' }}>
        <X size={10} />
      </button>
    </div>
  );
}

function AddTypeModal({ onAdd, onClose }) {
  const [name, setName] = useState('');
  const [hoarder, setHoarder] = useState(false);
  return (
    <div role="dialog" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 360,
      }}>
        <h3 style={{ margin: '0 0 12px' }}>Add Spawnable Type</h3>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Class name</label>
        <input
          className="input"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. AKM"
          style={{ width: '100%' }}
          onKeyDown={(e) => { if (e.key === 'Enter') onAdd(name, hoarder); }}
        />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" checked={hoarder} onChange={(e) => setHoarder(e.target.checked)} />
          Hoarder
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => onAdd(name, hoarder)}>Add</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDeleteModal({ name, onCancel, onConfirm }) {
  return (
    <div role="dialog" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}
      onClick={onCancel}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 380,
      }}>
        <h3 style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={16} style={{ color: 'var(--danger)' }} /> Delete type?
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Remove <code>{name}</code> from cfgspawnabletypes.xml? This only affects the in-memory edit —
          changes aren&apos;t written until you press Save.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-danger" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}
