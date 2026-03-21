import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import API from '../api';
import Modal from '../components/ui/Modal';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { Search, Save, Plus, Trash2, RefreshCw, Edit, FileCode, ChevronUp, ChevronDown, Filter, X, Copy, Download, Upload } from '../components/Icon';
import './TypesEditorPage.css';

// ─── Constants ──────────────────────────────────────────────

const FLAG_FIELDS = ['count_in_cargo', 'count_in_hoarder', 'count_in_map', 'count_in_player', 'crafted', 'deloot'];
const NUMERIC_FIELDS = ['nominal', 'lifetime', 'restock', 'min', 'quantmin', 'quantmax', 'cost'];
const ALL_COLUMNS = ['name', ...NUMERIC_FIELDS, 'category', 'usage', 'value', 'source_file'];
const COLUMN_LABELS = { name: 'Name', nominal: 'Nominal', lifetime: 'Lifetime', restock: 'Restock', min: 'Min', quantmin: 'QMin', quantmax: 'QMax', cost: 'Cost', category: 'Category', usage: 'Usage', value: 'Value', source_file: 'Source' };

const DEFAULT_ITEM = {
  name: '', nominal: 0, lifetime: 3600, restock: 0, min: 0, quantmin: -1, quantmax: -1, cost: 100,
  category: null, usage: [], value: [], tag: [],
  count_in_cargo: 0, count_in_hoarder: 0, count_in_map: 1, count_in_player: 0, crafted: 0, deloot: 0,
  original_users: [], source_file: '', modified: false,
};

// ─── Main Component ─────────────────────────────────────────

export default function TypesEditorPage({ serverId }) {
  // Data state
  const [items, setItems] = useState([]);
  const [files, setFiles] = useState([]);
  const [limits, setLimits] = useState({ categories: [], usages: [], values: [], tags: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filter state
  const [searchText, setSearchText] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterUsage, setFilterUsage] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [filterFile, setFilterFile] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Sort state
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Selection state
  const [selectedNames, setSelectedNames] = useState(new Set());
  const lastClickedIdx = useRef(null);

  // Modal state
  const [editItem, setEditItem] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // Pagination
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 200;

  // ─── Data Loading ───────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsData, limitsData] = await Promise.all([
        API.get(`/api/servers/${serverId}/types/items`),
        API.get(`/api/servers/${serverId}/types/limits`),
      ]);
      if (itemsData.items) {
        setItems(itemsData.items);
        setFiles(itemsData.files || []);
      }
      if (!limitsData.error) setLimits(limitsData);
    } catch (err) {
      window.addToast?.('Failed to load types data', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Filtering & Sorting ───────────────────────────────

  const filtered = useMemo(() => {
    let result = items;
    if (searchText) {
      const s = searchText.toLowerCase();
      result = result.filter(i => i.name.toLowerCase().includes(s));
    }
    if (filterCategory) result = result.filter(i => i.category === filterCategory);
    if (filterUsage) result = result.filter(i => i.usage.includes(filterUsage));
    if (filterValue) result = result.filter(i => i.value.includes(filterValue));
    if (filterFile) result = result.filter(i => i.source_file === filterFile);
    return result;
  }, [items, searchText, filterCategory, filterUsage, filterValue, filterFile]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (sortCol === 'usage' || sortCol === 'value') {
        va = (va || []).join(', '); vb = (vb || []).join(', ');
      }
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      va = String(va || ''); vb = String(vb || '');
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const paged = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  useEffect(() => setPage(0), [searchText, filterCategory, filterUsage, filterValue, filterFile]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // ─── Selection ──────────────────────────────────────────

  const handleRowClick = (item, idx, e) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIdx.current !== null) {
        const start = Math.min(lastClickedIdx.current, idx);
        const end = Math.max(lastClickedIdx.current, idx);
        for (let i = start; i <= end; i++) next.add(paged[i].name);
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(item.name)) next.delete(item.name); else next.add(item.name);
      } else {
        const wasOnly = next.size === 1 && next.has(item.name);
        next.clear();
        if (!wasOnly) next.add(item.name);
      }
      return next;
    });
    lastClickedIdx.current = idx;
  };

  const handleSelectAll = () => {
    if (selectedNames.size === paged.length) setSelectedNames(new Set());
    else setSelectedNames(new Set(paged.map(i => i.name)));
  };

  // ─── Modification Tracking ─────────────────────────────

  const modifiedCount = useMemo(() => items.filter(i => i.modified).length, [items]);

  const updateItem = (name, changes) => {
    setItems(prev => prev.map(item =>
      item.name === name ? { ...item, ...changes, modified: true } : item
    ));
  };

  const updateItems = (names, changes) => {
    setItems(prev => prev.map(item =>
      names.has(item.name) ? { ...item, ...changes, modified: true } : item
    ));
  };

  // ─── Save ───────────────────────────────────────────────

  const handleSave = async () => {
    const modified = items.filter(i => i.modified);
    if (modified.length === 0) { window.addToast?.('No changes to save', 'info'); return; }
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/types/save`, { items: modified });
      if (result.error) { window.addToast?.(result.error, 'error'); }
      else {
        window.addToast?.(`Saved ${result.itemCount} items across ${result.savedFiles.length} file(s)`, 'success');
        setItems(prev => prev.map(i => ({ ...i, modified: false })));
      }
    } catch { window.addToast?.('Failed to save', 'error'); }
    setSaving(false);
  };

  useKeyboardShortcuts({ 'ctrl+s': handleSave });

  // ─── Add Item ───────────────────────────────────────────

  const handleAddItem = async (newItem, targetFile) => {
    const result = await API.post(`/api/servers/${serverId}/types/add`, { item: newItem, targetFile });
    if (result.error) { window.addToast?.(result.error, 'error'); return false; }
    window.addToast?.(`Added "${newItem.name}"`, 'success');
    await loadData();
    setShowAddModal(false);
    return true;
  };

  // ─── Delete Item ────────────────────────────────────────

  const handleDeleteItem = async (item) => {
    const result = await API.del(`/api/servers/${serverId}/types/item?name=${encodeURIComponent(item.name)}&sourceFile=${encodeURIComponent(item.source_file)}`);
    if (result?.error) { window.addToast?.(result.error, 'error'); return; }
    window.addToast?.(`Deleted "${item.name}"`, 'success');
    setItems(prev => prev.filter(i => i.name !== item.name));
    setShowDeleteConfirm(null);
  };

  // ─── Import/Export ─────────────────────────────────────
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handleClick = () => setShowExportMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showExportMenu]);

  const handleExport = async (format) => {
    setShowExportMenu(false);
    try {
      const data = await API.get(`/api/servers/${serverId}/types/export?format=${format}`);
      const content = format === 'json' ? JSON.stringify(data, null, 2) : data;
      const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `types-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      window.addToast?.(`Exported as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      window.addToast?.('Export failed: ' + (err.message || err), 'error');
    }
  };

  const handleImport = async (importItems, targetFile, mode) => {
    try {
      const result = await API.post(`/api/servers/${serverId}/types/import`, { items: importItems, targetFile, mode });
      if (result.error) { window.addToast?.(result.error, 'error'); return false; }
      window.addToast?.(`Imported ${result.imported} items (${result.added} added, ${result.updated} updated)`, 'success');
      setShowImportModal(false);
      await loadData();
      return true;
    } catch (err) {
      window.addToast?.('Import failed: ' + (err.message || err), 'error');
      return false;
    }
  };

  // ─── Unique filter values from data ─────────────────────

  const uniqueCategories = useMemo(() => [...new Set(items.map(i => i.category).filter(Boolean))].sort(), [items]);
  const uniqueUsages = useMemo(() => [...new Set(items.flatMap(i => i.usage))].sort(), [items]);
  const uniqueValues = useMemo(() => [...new Set(items.flatMap(i => i.value))].sort(), [items]);

  const hasActiveFilters = filterCategory || filterUsage || filterValue || filterFile;
  const clearFilters = () => { setFilterCategory(''); setFilterUsage(''); setFilterValue(''); setFilterFile(''); setSearchText(''); };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="types-editor">
        <div className="types-loading">
          <RefreshCw size={24} className="spin" />
          <span>Loading types data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="types-editor">
      {/* Toolbar */}
      <div className="types-toolbar">
        <div className="types-toolbar-left">
          <div className="types-search">
            <Search size={14} />
            <input
              className="input"
              placeholder="Search items..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
          <button className={`btn btn-sm btn-secondary ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
            <Filter size={14} /> Filters {hasActiveFilters && <span className="filter-dot" />}
          </button>
          {hasActiveFilters && (
            <button className="btn btn-sm btn-secondary" onClick={clearFilters}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
        <div className="types-toolbar-right">
          <span className="types-stats">
            {sorted.length.toLocaleString()} items
            {modifiedCount > 0 && <span className="types-modified-badge">{modifiedCount} modified</span>}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Add Item
          </button>
          {selectedNames.size > 1 && (
            <button className="btn btn-sm btn-secondary" onClick={() => setShowBatchModal(true)}>
              <Edit size={14} /> Batch Edit ({selectedNames.size})
            </button>
          )}
          <div className="types-export-wrap" style={{ position: 'relative' }}>
            <button className="btn btn-sm btn-secondary" onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); }}>
              <Download size={14} /> Export <ChevronDown size={12} />
            </button>
            {showExportMenu && (
              <div className="types-dropdown-menu">
                <button onClick={() => handleExport('json')}>Export JSON</button>
                <button onClick={() => handleExport('csv')}>Export CSV</button>
              </div>
            )}
          </div>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={14} /> Import
          </button>
          <button className="btn btn-sm btn-secondary" onClick={loadData}>
            <RefreshCw size={14} /> Reload
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || modifiedCount === 0}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      {showFilters && (
        <div className="types-filters">
          <div className="types-filter-group">
            <label>Category</label>
            <select className="input" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
              <option value="">All Categories</option>
              {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="types-filter-group">
            <label>Usage</label>
            <select className="input" value={filterUsage} onChange={e => setFilterUsage(e.target.value)}>
              <option value="">All Usages</option>
              {uniqueUsages.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="types-filter-group">
            <label>Value</label>
            <select className="input" value={filterValue} onChange={e => setFilterValue(e.target.value)}>
              <option value="">All Values</option>
              {uniqueValues.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="types-filter-group">
            <label>Source File</label>
            <select className="input" value={filterFile} onChange={e => setFilterFile(e.target.value)}>
              <option value="">All Files</option>
              {files.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="types-table-wrap">
        <table className="types-table">
          <thead>
            <tr>
              <th className="types-th-check">
                <input type="checkbox" checked={selectedNames.size === paged.length && paged.length > 0} onChange={handleSelectAll} />
              </th>
              {ALL_COLUMNS.map(col => (
                <th key={col} className={`types-th sortable ${sortCol === col ? 'sorted' : ''}`} onClick={() => handleSort(col)}>
                  {COLUMN_LABELS[col]}
                  {sortCol === col && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </th>
              ))}
              <th className="types-th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((item, idx) => (
              <tr
                key={item.name}
                className={`${selectedNames.has(item.name) ? 'selected' : ''} ${item.modified ? 'modified' : ''}`}
                onClick={e => handleRowClick(item, idx, e)}
                onDoubleClick={() => setEditItem({ ...item })}
              >
                <td className="types-td-check">
                  <input type="checkbox" checked={selectedNames.has(item.name)} readOnly />
                </td>
                <td className="types-td-name" title={item.name}>{item.name}</td>
                <td className="types-td-num">{item.nominal}</td>
                <td className="types-td-num">{item.lifetime}</td>
                <td className="types-td-num">{item.restock}</td>
                <td className="types-td-num">{item.min}</td>
                <td className="types-td-num">{item.quantmin}</td>
                <td className="types-td-num">{item.quantmax}</td>
                <td className="types-td-num">{item.cost}</td>
                <td className="types-td-cat">{item.category || ''}</td>
                <td className="types-td-tags" title={(item.usage || []).join(', ')}>{(item.usage || []).join(', ')}</td>
                <td className="types-td-tags" title={(item.value || []).join(', ')}>{(item.value || []).join(', ')}</td>
                <td className="types-td-source" title={item.source_file}>{item.source_file?.split('/').pop()}</td>
                <td className="types-td-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn-icon btn-icon-sm" title="Edit" onClick={() => setEditItem({ ...item })}>
                    <Edit size={13} />
                  </button>
                  <button className="btn-icon btn-icon-sm" title="Delete" onClick={() => setShowDeleteConfirm(item)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="types-pagination">
          <button className="btn btn-sm btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span className="types-page-info">Page {page + 1} of {totalPages}</span>
          <button className="btn btn-sm btn-secondary" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {/* Edit Item Modal */}
      {editItem && (
        <EditItemModal
          item={editItem}
          limits={limits}
          onSave={(updated) => { updateItem(updated.name, updated); setEditItem(null); }}
          onClose={() => setEditItem(null)}
        />
      )}

      {/* Add Item Modal */}
      {showAddModal && (
        <AddItemModal
          files={files}
          limits={limits}
          onAdd={handleAddItem}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Batch Edit Modal */}
      {showBatchModal && (
        <BatchEditModal
          items={items.filter(i => selectedNames.has(i.name))}
          limits={limits}
          onApply={(changes, multiplyFields) => {
            if (multiplyFields && multiplyFields.length > 0) {
              // Per-item multiply calculation
              setItems(prev => prev.map(item => {
                if (!selectedNames.has(item.name)) return item;
                const updated = { ...item, ...changes, modified: true };
                for (const { name, factor } of multiplyFields) {
                  updated[name] = Math.round(item[name] * factor);
                }
                return updated;
              }));
            } else {
              updateItems(selectedNames, changes);
            }
            setShowBatchModal(false);
            window.addToast?.(`Batch updated ${selectedNames.size} items`, 'success');
          }}
          onClose={() => setShowBatchModal(false)}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <ImportModal
          files={files}
          onImport={handleImport}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* Delete Confirm */}
      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(null)} title="Delete Item">
          <p style={{ marginBottom: 16 }}>Delete <strong>{showDeleteConfirm.name}</strong> from <em>{showDeleteConfirm.source_file}</em>?</p>
          <p style={{ marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>A backup will be created before deletion.</p>
          <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteItem(showDeleteConfirm)}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Edit Item Modal ────────────────────────────────────────

function EditItemModal({ item, limits, onSave, onClose }) {
  const [form, setForm] = useState({ ...item });
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const toggleInList = (field, val) => {
    setForm(f => {
      const list = [...(f[field] || [])];
      const idx = list.indexOf(val);
      if (idx >= 0) list.splice(idx, 1); else list.push(val);
      return { ...f, [field]: list };
    });
  };

  return (
    <Modal open onClose={onClose} title={`Edit: ${item.name}`} className="modal-lg types-edit-modal">
      <div className="types-edit-grid">
        {/* Numeric Fields */}
        <div className="types-edit-section">
          <h4>Spawn Values</h4>
          <div className="types-edit-fields">
            {NUMERIC_FIELDS.map(field => (
              <div key={field} className="types-edit-field">
                <label>{COLUMN_LABELS[field] || field}</label>
                <input type="number" className="input" value={form[field]} onChange={e => set(field, parseInt(e.target.value) || 0)} />
              </div>
            ))}
          </div>
        </div>

        {/* Flags */}
        <div className="types-edit-section">
          <h4>Flags</h4>
          <div className="types-edit-flags">
            {FLAG_FIELDS.map(flag => (
              <label key={flag} className="types-flag-label">
                <input type="checkbox" checked={form[flag] === 1} onChange={e => set(flag, e.target.checked ? 1 : 0)} />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        {/* Category */}
        <div className="types-edit-section">
          <h4>Category</h4>
          <select className="input" value={form.category || ''} onChange={e => set('category', e.target.value || null)}>
            <option value="">None</option>
            {limits.categories?.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Usage Tags */}
        <div className="types-edit-section">
          <h4>Usage</h4>
          <div className="types-tag-grid">
            {(limits.usages || []).map(u => (
              <label key={u} className="types-tag-label">
                <input type="checkbox" checked={(form.usage || []).includes(u)} onChange={() => toggleInList('usage', u)} />
                {u}
              </label>
            ))}
          </div>
        </div>

        {/* Value Tags */}
        <div className="types-edit-section">
          <h4>Value</h4>
          <div className="types-tag-grid">
            {(limits.values || []).map(v => (
              <label key={v} className="types-tag-label">
                <input type="checkbox" checked={(form.value || []).includes(v)} onChange={() => toggleInList('value', v)} />
                {v}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(form)}>Save Changes</button>
      </div>
    </Modal>
  );
}

// ─── Add Item Modal ─────────────────────────────────────────

function AddItemModal({ files, limits, onAdd, onClose }) {
  const [form, setForm] = useState({ ...DEFAULT_ITEM });
  const [targetFile, setTargetFile] = useState(files[0] || '');
  const [adding, setAdding] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const toggleInList = (field, val) => {
    setForm(f => {
      const list = [...(f[field] || [])];
      const idx = list.indexOf(val);
      if (idx >= 0) list.splice(idx, 1); else list.push(val);
      return { ...f, [field]: list };
    });
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { window.addToast?.('Item name is required', 'error'); return; }
    if (!targetFile) { window.addToast?.('Select a target file', 'error'); return; }
    setAdding(true);
    await onAdd({ ...form, name: form.name.trim() }, targetFile);
    setAdding(false);
  };

  return (
    <Modal open onClose={onClose} title="Add New Item" className="modal-lg types-edit-modal">
      <div className="types-edit-grid">
        <div className="types-edit-section">
          <h4>Item Name</h4>
          <input className="input" placeholder="e.g. MyCustomItem" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
        </div>

        <div className="types-edit-section">
          <h4>Target File</h4>
          <select className="input" value={targetFile} onChange={e => setTargetFile(e.target.value)}>
            {files.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div className="types-edit-section">
          <h4>Spawn Values</h4>
          <div className="types-edit-fields">
            {NUMERIC_FIELDS.map(field => (
              <div key={field} className="types-edit-field">
                <label>{COLUMN_LABELS[field] || field}</label>
                <input type="number" className="input" value={form[field]} onChange={e => set(field, parseInt(e.target.value) || 0)} />
              </div>
            ))}
          </div>
        </div>

        <div className="types-edit-section">
          <h4>Flags</h4>
          <div className="types-edit-flags">
            {FLAG_FIELDS.map(flag => (
              <label key={flag} className="types-flag-label">
                <input type="checkbox" checked={form[flag] === 1} onChange={e => set(flag, e.target.checked ? 1 : 0)} />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        <div className="types-edit-section">
          <h4>Category</h4>
          <select className="input" value={form.category || ''} onChange={e => set('category', e.target.value || null)}>
            <option value="">None</option>
            {limits.categories?.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="types-edit-section">
          <h4>Usage</h4>
          <div className="types-tag-grid">
            {(limits.usages || []).map(u => (
              <label key={u} className="types-tag-label">
                <input type="checkbox" checked={(form.usage || []).includes(u)} onChange={() => toggleInList('usage', u)} />
                {u}
              </label>
            ))}
          </div>
        </div>

        <div className="types-edit-section">
          <h4>Value</h4>
          <div className="types-tag-grid">
            {(limits.values || []).map(v => (
              <label key={v} className="types-tag-label">
                <input type="checkbox" checked={(form.value || []).includes(v)} onChange={() => toggleInList('value', v)} />
                {v}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={handleSubmit} disabled={adding}>
          {adding ? 'Adding...' : 'Add Item'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Batch Edit Modal ───────────────────────────────────────

function BatchEditModal({ items, limits, onApply, onClose }) {
  const [fields, setFields] = useState({});
  // fields: { fieldName: { enabled: bool, mode: 'set'|'multiply', value: number } }

  const toggleField = (name) => {
    setFields(f => {
      const next = { ...f };
      if (next[name]) delete next[name];
      else next[name] = { enabled: true, mode: 'set', value: 0 };
      return next;
    });
  };

  const setFieldProp = (name, prop, val) => {
    setFields(f => ({ ...f, [name]: { ...f[name], [prop]: val } }));
  };

  // Category batch
  const [categoryEnabled, setCategoryEnabled] = useState(false);
  const [categoryValue, setCategoryValue] = useState('');

  // Flags batch
  const [flagChanges, setFlagChanges] = useState({});
  const toggleFlagChange = (flag) => {
    setFlagChanges(f => {
      const next = { ...f };
      if (flag in next) delete next[flag]; else next[flag] = 0;
      return next;
    });
  };

  const computeChanges = () => {
    const changes = {};
    for (const [name, conf] of Object.entries(fields)) {
      if (!conf.enabled) continue;
      // For batch, we apply per-item in the parent — here we just return the config
      changes[name] = conf;
    }
    return changes;
  };

  const handleApply = () => {
    const result = {};

    // Numeric fields
    for (const [name, conf] of Object.entries(fields)) {
      if (!conf.enabled) continue;
      if (conf.mode === 'set') result[name] = conf.value;
      // multiply mode: apply inline
    }

    // Category
    if (categoryEnabled) result.category = categoryValue || null;

    // Flags
    for (const [flag, val] of Object.entries(flagChanges)) {
      result[flag] = val;
    }

    if (Object.keys(result).length === 0 && Object.keys(fields).filter(k => fields[k].mode === 'multiply').length === 0) {
      window.addToast?.('No changes selected', 'info');
      return;
    }

    // For multiply mode, we need special handling — compute per item
    const multiplyFields = Object.entries(fields).filter(([, c]) => c.enabled && c.mode === 'multiply');

    if (multiplyFields.length > 0) {
      // We can't do multiply in a single changes object — need per-item logic
      // This is handled by the parent caller, so we emit both set-changes and multiply-configs
      onApply(result, multiplyFields.map(([name, conf]) => ({ name, factor: conf.value })));
    } else {
      onApply(result);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Batch Edit (${items.length} items)`} className="modal-lg types-edit-modal">
      <div className="types-batch-info">
        Editing {items.length} selected items. Only checked fields will be modified.
      </div>

      <div className="types-edit-grid">
        {/* Numeric Fields */}
        <div className="types-edit-section">
          <h4>Numeric Fields</h4>
          {NUMERIC_FIELDS.map(field => (
            <div key={field} className="types-batch-field">
              <label className="types-flag-label">
                <input type="checkbox" checked={!!fields[field]} onChange={() => toggleField(field)} />
                {COLUMN_LABELS[field]}
              </label>
              {fields[field] && (
                <div className="types-batch-controls">
                  <select className="input types-batch-mode" value={fields[field].mode} onChange={e => setFieldProp(field, 'mode', e.target.value)}>
                    <option value="set">Set to</option>
                    <option value="multiply">Multiply by</option>
                  </select>
                  <input
                    type="number"
                    className="input types-batch-value"
                    step={fields[field].mode === 'multiply' ? 0.1 : 1}
                    value={fields[field].value}
                    onChange={e => setFieldProp(field, 'value', parseFloat(e.target.value) || 0)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Category */}
        <div className="types-edit-section">
          <h4>Category</h4>
          <label className="types-flag-label">
            <input type="checkbox" checked={categoryEnabled} onChange={() => setCategoryEnabled(!categoryEnabled)} />
            Set category
          </label>
          {categoryEnabled && (
            <select className="input" style={{ marginTop: 8 }} value={categoryValue} onChange={e => setCategoryValue(e.target.value)}>
              <option value="">Clear</option>
              {limits.categories?.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {/* Flags */}
        <div className="types-edit-section">
          <h4>Flags</h4>
          {FLAG_FIELDS.map(flag => (
            <div key={flag} className="types-batch-field">
              <label className="types-flag-label">
                <input type="checkbox" checked={flag in flagChanges} onChange={() => toggleFlagChange(flag)} />
                {flag.replace(/_/g, ' ')}
              </label>
              {flag in flagChanges && (
                <select className="input types-batch-mode" value={flagChanges[flag]} onChange={e => setFlagChanges(f => ({ ...f, [flag]: parseInt(e.target.value) }))}>
                  <option value={0}>Off (0)</option>
                  <option value={1}>On (1)</option>
                </select>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={handleApply}>Apply Changes</button>
      </div>
    </Modal>
  );
}

// ─── CSV Parser ──────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] || '';
    });
    // Convert numeric fields
    ['nominal', 'lifetime', 'restock', 'min', 'quantmin', 'quantmax', 'cost'].forEach(f => {
      if (obj[f] !== undefined) obj[f] = parseInt(obj[f], 10) || 0;
    });
    // Convert semicolon-joined arrays
    if (obj.usage) obj.usage = obj.usage.split(';').filter(Boolean);
    else obj.usage = [];
    if (obj.value) obj.value = obj.value.split(';').filter(Boolean);
    else obj.value = [];
    return obj;
  });
}

// ─── Import Modal ────────────────────────────────────────────

function ImportModal({ files, onImport, onClose }) {
  const [importItems, setImportItems] = useState(null);
  const [targetFile, setTargetFile] = useState(files[0] || '');
  const [mode, setMode] = useState('merge');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState('');

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        let parsed;
        if (file.name.endsWith('.json')) {
          parsed = JSON.parse(text);
          if (!Array.isArray(parsed)) {
            window.addToast?.('JSON file must contain an array of items', 'error');
            return;
          }
        } else if (file.name.endsWith('.csv')) {
          parsed = parseCSV(text);
        } else {
          window.addToast?.('Unsupported file type. Use .json or .csv', 'error');
          return;
        }
        setImportItems(parsed);
      } catch (err) {
        window.addToast?.('Failed to parse file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!importItems || importItems.length === 0) {
      window.addToast?.('No items to import', 'error');
      return;
    }
    if (!targetFile) {
      window.addToast?.('Select a target file', 'error');
      return;
    }
    setImporting(true);
    await onImport(importItems, targetFile, mode);
    setImporting(false);
  };

  return (
    <Modal open onClose={onClose} title="Import Types" className="types-edit-modal">
      <div className="types-edit-grid">
        <div className="types-edit-section">
          <h4>Select File</h4>
          <input
            type="file"
            accept=".json,.csv"
            onChange={handleFileSelect}
            className="input"
            style={{ padding: '6px' }}
          />
          {importItems && (
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              Found <strong>{importItems.length}</strong> items in <em>{fileName}</em>
            </p>
          )}
        </div>

        <div className="types-edit-section">
          <h4>Target File</h4>
          <select className="input" value={targetFile} onChange={e => setTargetFile(e.target.value)}>
            {files.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div className="types-edit-section">
          <h4>Import Mode</h4>
          <div className="types-edit-flags">
            <label className="types-flag-label">
              <input type="radio" name="importMode" value="merge" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              Merge (add new items, update existing by name)
            </label>
            <label className="types-flag-label">
              <input type="radio" name="importMode" value="replace" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              Replace (overwrite entire file with imported items)
            </label>
          </div>
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={handleSubmit} disabled={importing || !importItems}>
          {importing ? 'Importing...' : 'Import'}
        </button>
      </div>
    </Modal>
  );
}
