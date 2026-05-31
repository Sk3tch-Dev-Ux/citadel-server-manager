import React, { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import API from '../api';
import { ArrowLeft, Save, Plus, X, Search, ChevronRight, ChevronDown, ShoppingCart, Trash2, Check, Edit, Copy, Upload, Download } from '../components/Icon';
import { toolWikiUrl, WIKI_TOOLS } from '../utils/wikiLinks';
import ItemPicker from '../components/ItemPicker';
import useItemCatalog from '../hooks/useItemCatalog';

const InteractiveMap = lazy(() => import('../components/InteractiveMap'));
import useServerMap from '../hooks/useServerMap';

// ─── Constants ──────────────────────────────────────────────────────

const TABS = [
  { id: 'categories', label: 'Market Categories' },
  { id: 'traders', label: 'Traders' },
  { id: 'zones', label: 'Trader Zones' },
  { id: 'spawns', label: 'NPC Spawns' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

const ICON_OPTIONS = [
  'Deliver', 'Package', 'Rifle', 'Shotgun', 'Pistol', 'Melee', 'Gear', 'Clothing',
  'Food', 'Medical', 'Ammo', 'Attachment', 'Vehicle', 'VehicleParts', 'Building',
  'Electronics', 'Barter', 'Industrial', 'Tools', 'Backpack', 'Container',
];

const SELL_MODES = [
  { value: 0, label: 'Buy & Sell' },
  { value: 1, label: 'Buy Only' },
  { value: 2, label: 'Sell Only' },
  { value: 3, label: 'Hidden' },
];

// ─── Helper Components ──────────────────────────────────────────────

function ColorInput({ value, onChange }) {
  const argbToCSS = (hex) => {
    if (!hex || hex.length < 8) return '#888';
    const a = parseInt(hex.substring(0, 2), 16) / 255;
    const r = parseInt(hex.substring(2, 4), 16);
    const g = parseInt(hex.substring(4, 6), 16);
    const b = parseInt(hex.substring(6, 8), 16);
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  };
  const cssToARGB = (cssHex) => {
    const r = cssHex.substring(1, 3).toUpperCase();
    const g = cssHex.substring(3, 5).toUpperCase();
    const b = cssHex.substring(5, 7).toUpperCase();
    const existingAlpha = (value && value.length >= 8) ? value.substring(0, 2) : 'FF';
    return `${existingAlpha}${r}${g}${b}`;
  };
  const toPickerValue = (hex) => {
    if (!hex || hex.length < 8) return '#ffffff';
    return `#${hex.substring(2, 8)}`;
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type="color" value={toPickerValue(value)} style={{ width: 32, height: 24, padding: 0, border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', background: 'none' }}
        onChange={e => onChange(cssToARGB(e.target.value))} />
      <div style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid var(--border)', background: argbToCSS(value) }} />
      <input className="input" value={value || ''} style={{ width: 100, fontSize: 11, fontFamily: 'var(--font-mono, monospace)', padding: '2px 6px' }}
        onChange={e => onChange(e.target.value.toUpperCase())} placeholder="AARRGGBB" />
    </div>
  );
}

function NoData({ message }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center' }}>
      <span style={{ color: 'var(--text-muted)' }}>{message || 'Select an item from the sidebar to edit'}</span>
    </div>
  );
}

function Badge({ count, color }) {
  return (
    <span style={{
      background: color || 'var(--bg-elevated, var(--bg-card))',
      color: color ? '#fff' : 'var(--text-muted)',
      padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      minWidth: 22, textAlign: 'center', display: 'inline-block',
    }}>
      {count}
    </span>
  );
}

// ─── Tab 1: Market Categories ───────────────────────────────────────

function MarketCategoriesTab({ serverId }) {
  const catalog = useItemCatalog(serverId);
  const [categories, setCategories] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [categoryData, setCategoryData] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkValues, setBulkValues] = useState({ MinPriceThreshold: '', MaxPriceThreshold: '', MinStockThreshold: '', MaxStockThreshold: '' });
  // bulkOp: 'set' (direct value), 'multiply' (×factor), 'add' (+offset)
  // Applied to ALL four bulkValues columns uniformly so an admin can e.g.
  // "multiply every selected item's Min + Max price by 1.5" in one shot.
  const [bulkOp, setBulkOp] = useState('set');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/trader-editor/categories`);
      if (data && !data.error) {
        setCategories(Array.isArray(data) ? data : data.categories || []);
      }
    } catch {
      window.addToast?.('Failed to load market categories', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadCategories(); }, [loadCategories]);

  const loadCategory = useCallback(async (fileName) => {
    try {
      const res = await API.get(`/api/servers/${serverId}/trader-editor/categories/${encodeURIComponent(fileName)}`);
      if (res && !res.error) {
        const d = res.data || res;
        setCategoryData(d);
        setOriginalData(JSON.parse(JSON.stringify(d)));
        setExpandedRows(new Set());
        setSelectedItems(new Set());
      }
    } catch {
      window.addToast?.('Failed to load category', 'error');
    }
  }, [serverId]);

  const selectCategory = (fileName) => {
    setSelectedFile(fileName);
    loadCategory(fileName);
  };

  const isModified = useMemo(() => {
    if (!categoryData || !originalData) return false;
    return JSON.stringify(categoryData) !== JSON.stringify(originalData);
  }, [categoryData, originalData]);

  const handleSave = async () => {
    if (!selectedFile || !categoryData) return;
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/trader-editor/categories/${encodeURIComponent(selectedFile)}`, { data: categoryData });
      if (result && !result.error) {
        window.addToast?.('Category saved successfully', 'success');
        setOriginalData(JSON.parse(JSON.stringify(categoryData)));
        loadCategories();
      } else {
        window.addToast?.('Failed to save category', 'error');
      }
    } catch {
      window.addToast?.('Failed to save category', 'error');
    }
    setSaving(false);
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      const result = await API.post(`/api/servers/${serverId}/trader-editor/categories`, {
        fileName: newCategoryName.trim(),
        data: {
          m_Version: 12,
          DisplayName: newCategoryName.trim(),
          Icon: 'Deliver',
          Color: 'FBFCFEFF',
          IsExchange: 0,
          InitStockPercent: 75.0,
          Items: [],
        },
      });
      if (result && !result.error) {
        window.addToast?.('Category created', 'success');
        setNewCategoryName('');
        setShowNewCategory(false);
        loadCategories();
      }
    } catch {
      window.addToast?.('Failed to create category', 'error');
    }
  };

  const handleDeleteCategory = async (fileName) => {
    if (!confirm(`Delete category "${fileName}"? This cannot be undone.`)) return;
    try {
      await API.del(`/api/servers/${serverId}/trader-editor/categories/${encodeURIComponent(fileName)}`);
      window.addToast?.('Category deleted', 'success');
      if (selectedFile === fileName) {
        setSelectedFile(null);
        setCategoryData(null);
      }
      loadCategories();
    } catch {
      window.addToast?.('Failed to delete category', 'error');
    }
  };

  const updateCategoryField = (key, val) => {
    setCategoryData(prev => ({ ...prev, [key]: val }));
  };

  const updateItem = (idx, key, val) => {
    setCategoryData(prev => {
      const items = [...(prev.Items || [])];
      items[idx] = { ...items[idx], [key]: val };
      return { ...prev, Items: items };
    });
  };

  const addItem = () => {
    setCategoryData(prev => ({
      ...prev,
      Items: [...(prev.Items || []), {
        ClassName: 'new_item',
        MaxPriceThreshold: 1000,
        MinPriceThreshold: 500,
        SellPricePercent: -1.0,
        MaxStockThreshold: 100,
        MinStockThreshold: 1,
        QuantityPercent: -1,
        SpawnAttachments: [],
        Variants: [],
      }],
    }));
  };

  const removeItem = (idx) => {
    setCategoryData(prev => ({
      ...prev,
      Items: prev.Items.filter((_, i) => i !== idx),
    }));
  };

  const duplicateItem = (idx) => {
    setCategoryData(prev => {
      const items = [...prev.Items];
      const clone = JSON.parse(JSON.stringify(items[idx]));
      clone.ClassName = clone.ClassName + '_copy';
      items.splice(idx + 1, 0, clone);
      return { ...prev, Items: items };
    });
  };

  const toggleRow = (idx) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleSelectItem = (idx) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const filteredItems = getFilteredItems();
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((_, i) => i)));
    }
  };

  const applyBulkEdit = () => {
    // Apply the current bulkOp to each selected item. For 'set' we replace
    // the field outright. For 'multiply' / 'add' we use the current value
    // as the base — if a field is empty in bulkValues we skip it, so admins
    // can e.g. multiply only prices (leave stock columns blank).
    const keys = ['MinPriceThreshold', 'MaxPriceThreshold', 'MinStockThreshold', 'MaxStockThreshold'];
    setCategoryData((prev) => {
      const items = [...(prev.Items || [])];
      for (const idx of selectedItems) {
        if (!items[idx]) continue;
        const updated = { ...items[idx] };
        for (const key of keys) {
          const raw = bulkValues[key];
          if (raw === '' || raw == null) continue;
          const v = Number(raw);
          if (!Number.isFinite(v)) continue;
          if (bulkOp === 'set') {
            updated[key] = v;
          } else if (bulkOp === 'multiply') {
            const current = Number(updated[key]) || 0;
            updated[key] = Math.round(current * v);
          } else if (bulkOp === 'add') {
            const current = Number(updated[key]) || 0;
            updated[key] = Math.round(current + v);
          }
        }
        items[idx] = updated;
      }
      return { ...prev, Items: items };
    });
    const opLabel = bulkOp === 'multiply' ? 'multiplied' : bulkOp === 'add' ? 'adjusted' : 'updated';
    window.addToast?.(`${opLabel} ${selectedItems.size} item${selectedItems.size === 1 ? '' : 's'}`, 'success');
    setBulkMode(false);
    setSelectedItems(new Set());
    setBulkValues({ MinPriceThreshold: '', MaxPriceThreshold: '', MinStockThreshold: '', MaxStockThreshold: '' });
    setBulkOp('set');
  };

  const getFilteredItems = () => {
    if (!categoryData?.Items) return [];
    if (!searchText) return categoryData.Items;
    const lower = searchText.toLowerCase();
    return categoryData.Items.filter(item =>
      (item.ClassName || '').toLowerCase().includes(lower)
    );
  };

  const filteredItems = getFilteredItems();

  // Ctrl+S to save
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

  if (loading) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span style={{ color: 'var(--text-muted)' }}>Loading market categories...</span></div>;
  }

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 600 }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <button className="btn btn-primary" onClick={() => setShowNewCategory(true)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 12 }}>
            <Plus size={14} /> New Category
          </button>
        </div>

        {showNewCategory && (
          <div className="card" style={{ padding: 8, marginBottom: 8 }}>
            <input className="input" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
              placeholder="Category name..." style={{ width: '100%', fontSize: 12, marginBottom: 6 }} autoFocus />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary" onClick={handleCreateCategory} style={{ flex: 1, fontSize: 11, padding: '3px 8px' }}>Create</button>
              <button className="btn btn-secondary" onClick={() => { setShowNewCategory(false); setNewCategoryName(''); }} style={{ fontSize: 11, padding: '3px 8px' }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ overflow: 'auto', flex: 1 }}>
          {categories.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No categories found</div>
          ) : (
            categories.map(cat => {
              const fileName = typeof cat === 'string' ? cat : (cat.fileName || cat.name || cat);
              const displayName = typeof cat === 'object' ? (cat.displayName || cat.DisplayName || cat.fileName || cat.name) : cat;
              const itemCount = typeof cat === 'object' ? (cat.itemCount ?? cat.Items?.length ?? '?') : '?';
              const isActive = selectedFile === fileName;
              return (
                <div key={fileName}
                  onClick={() => selectCategory(fileName)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    background: isActive ? 'var(--accent-blue)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-primary)',
                    transition: 'all 0.15s',
                    marginBottom: 1,
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(displayName).replace(/_/g, ' ').replace(/\.json$/i, '')}
                  </span>
                  <Badge count={itemCount} color={isActive ? 'rgba(255,255,255,0.25)' : undefined} />
                  <button onClick={e => { e.stopPropagation(); handleDeleteCategory(fileName); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: isActive ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', padding: 0, display: 'flex' }}>
                    <X size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!categoryData ? (
          <NoData message="Select a market category from the sidebar to edit its items" />
        ) : (
          <>
            {/* Category Header */}
            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div style={{
                padding: '10px 16px', fontWeight: 700, fontSize: 14,
                borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-orange, #f59e0b)',
                background: 'var(--bg-surface, var(--bg-deep))',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>Category Settings</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isModified && <span style={{ fontSize: 11, color: 'var(--accent-orange, #f59e0b)', fontWeight: 600 }}>Unsaved changes</span>}
                  <a
                    href={toolWikiUrl('market-manager')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary"
                    title={`Open in ${WIKI_TOOLS['market-manager']}`}
                    style={{ padding: '4px 10px', fontSize: 11, textDecoration: 'none' }}
                  >
                    Docs ↗
                  </a>
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving || !isModified}
                    style={{ padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Save size={12} /> {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Name</label>
                  <input className="input" value={categoryData.DisplayName || ''} onChange={e => updateCategoryField('DisplayName', e.target.value)}
                    style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Icon</label>
                  <select className="input" value={categoryData.Icon || 'Deliver'} onChange={e => updateCategoryField('Icon', e.target.value)}
                    style={{ width: '100%', fontSize: 13 }}>
                    {ICON_OPTIONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Color (ARGB)</label>
                  <ColorInput value={categoryData.Color || 'FBFCFEFF'} onChange={v => updateCategoryField('Color', v)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Init Stock %</label>
                  <input className="input" type="number" value={categoryData.InitStockPercent ?? 75} onChange={e => updateCategoryField('InitStockPercent', Number(e.target.value))}
                    style={{ width: '100%', fontSize: 13 }} min={0} max={100} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Is Exchange</label>
                  <button onClick={() => updateCategoryField('IsExchange', categoryData.IsExchange ? 0 : 1)}
                    style={{
                      padding: '4px 14px', fontSize: 12, fontWeight: 600, borderRadius: 4, border: '1px solid var(--border)', cursor: 'pointer',
                      background: categoryData.IsExchange ? 'var(--accent-green)' : 'var(--bg-elevated, var(--bg-card))',
                      color: categoryData.IsExchange ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s',
                    }}>
                    {categoryData.IsExchange ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>
            </div>

            {/* Items Header / Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Items ({(categoryData.Items || []).length})</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search size={14} style={{ position: 'absolute', left: 8, color: 'var(--text-muted)' }} />
                  <input className="input" value={searchText} onChange={e => setSearchText(e.target.value)}
                    placeholder="Filter items..." style={{ paddingLeft: 28, width: 200, fontSize: 12 }} />
                </div>
                {selectedItems.size > 0 && (
                  <button className="btn btn-secondary" onClick={() => setBulkMode(!bulkMode)}
                    style={{ padding: '4px 10px', fontSize: 12 }}>
                    Bulk Edit ({selectedItems.size})
                  </button>
                )}
                <button className="btn btn-primary" onClick={addItem}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 12 }}>
                  <Plus size={14} /> Add Item
                </button>
              </div>
            </div>

            {/* Bulk edit bar */}
            {bulkMode && selectedItems.size > 0 && (
              <div className="card" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)' }}>
                    Bulk edit {selectedItems.size} item{selectedItems.size === 1 ? '' : 's'}
                  </div>
                  <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
                    {[
                      { id: 'set', label: 'Set to', hint: 'Replace with value' },
                      { id: 'multiply', label: '× Factor', hint: 'Multiply current by value (e.g. 1.5)' },
                      { id: 'add', label: '+ Offset', hint: 'Add value to current (e.g. -100)' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setBulkOp(m.id)}
                        className={`btn btn-xs ${bulkOp === m.id ? 'btn-primary' : 'btn-ghost'}`}
                        title={m.hint}
                        style={{ fontSize: 10 }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                {[
                  { key: 'MinPriceThreshold', label: 'Min Price' },
                  { key: 'MaxPriceThreshold', label: 'Max Price' },
                  { key: 'MinStockThreshold', label: 'Min Stock' },
                  { key: 'MaxStockThreshold', label: 'Max Stock' },
                ].map((f) => (
                  <div key={f.key}>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>
                      {f.label}{bulkOp === 'multiply' ? ' ×' : bulkOp === 'add' ? ' +/−' : ''}
                    </label>
                    <input
                      className="input"
                      type="number"
                      step={bulkOp === 'multiply' ? '0.1' : '1'}
                      value={bulkValues[f.key]}
                      onChange={(e) => setBulkValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={bulkOp === 'multiply' ? '1.5' : bulkOp === 'add' ? '+100' : '--'}
                      style={{ width: 80, fontSize: 12 }}
                    />
                  </div>
                ))}
                <button className="btn btn-primary" onClick={applyBulkEdit} style={{ padding: '4px 12px', fontSize: 12 }}>
                  <Check size={12} /> Apply
                </button>
                <button className="btn btn-secondary" onClick={() => { setBulkMode(false); setSelectedItems(new Set()); }}
                  style={{ padding: '4px 10px', fontSize: 12 }}>Cancel</button>
              </div>
            )}

            {/* Items Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="table" style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '6px 8px', width: 30 }}>
                      <input type="checkbox" checked={filteredItems.length > 0 && selectedItems.size === filteredItems.length}
                        onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                    </th>
                    <th style={{ padding: '6px 10px', width: 24 }}></th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>ClassName</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Min Price</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Max Price</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sell %</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Min Stock</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Max Stock</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Att.</th>
                    <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', width: 80 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 && (
                    <tr><td colSpan={10} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                      {searchText ? 'No items match your search' : 'No items in this category'}
                    </td></tr>
                  )}
                  {filteredItems.map((item, displayIdx) => {
                    // Find real index in the unfiltered array
                    const realIdx = categoryData.Items.indexOf(item);
                    const isExpanded = expandedRows.has(realIdx);
                    const isSelected = selectedItems.has(realIdx);
                    return (
                      <React.Fragment key={realIdx}>
                        <tr style={{ background: isSelected ? 'rgba(59,130,246,0.08)' : undefined }}>
                          <td style={{ padding: '4px 8px' }}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleSelectItem(realIdx)} style={{ cursor: 'pointer' }} />
                          </td>
                          <td style={{ padding: '4px 6px' }}>
                            <button onClick={() => toggleRow(realIdx)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', display: 'flex' }}>
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <ItemPicker value={item.ClassName || ''} onChange={v => updateItem(realIdx, 'ClassName', v)} catalog={catalog} style={{ minWidth: 0 }} />
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <input className="input" type="number" value={item.MinPriceThreshold ?? 0} onChange={e => updateItem(realIdx, 'MinPriceThreshold', Number(e.target.value))}
                              style={{ width: 80, fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <input className="input" type="number" value={item.MaxPriceThreshold ?? 0} onChange={e => updateItem(realIdx, 'MaxPriceThreshold', Number(e.target.value))}
                              style={{ width: 80, fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <input className="input" type="number" value={item.SellPricePercent ?? -1} onChange={e => updateItem(realIdx, 'SellPricePercent', Number(e.target.value))}
                              style={{ width: 60, fontSize: 12 }} step="0.1" />
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <input className="input" type="number" value={item.MinStockThreshold ?? 0} onChange={e => updateItem(realIdx, 'MinStockThreshold', Number(e.target.value))}
                              style={{ width: 60, fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '4px 10px' }}>
                            <input className="input" type="number" value={item.MaxStockThreshold ?? 0} onChange={e => updateItem(realIdx, 'MaxStockThreshold', Number(e.target.value))}
                              style={{ width: 60, fontSize: 12 }} />
                          </td>
                          <td style={{ padding: '4px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>
                            {(item.SpawnAttachments || []).length}
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => duplicateItem(realIdx)} title="Duplicate"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex' }}>
                                <Copy size={13} />
                              </button>
                              <button onClick={() => removeItem(realIdx)} title="Delete"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex' }}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={10} style={{ padding: 0 }}>
                              <div style={{ padding: 16, background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                  {/* Spawn Attachments */}
                                  <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                      Spawn Attachments ({(item.SpawnAttachments || []).length})
                                    </label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {(item.SpawnAttachments || []).map((att, aIdx) => (
                                        <div key={aIdx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                          <ItemPicker value={att} onChange={v => {
                                            const atts = [...item.SpawnAttachments];
                                            atts[aIdx] = v;
                                            updateItem(realIdx, 'SpawnAttachments', atts);
                                          }} catalog={catalog} />
                                          <button onClick={() => {
                                            const atts = item.SpawnAttachments.filter((_, i) => i !== aIdx);
                                            updateItem(realIdx, 'SpawnAttachments', atts);
                                          }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
                                            <X size={12} />
                                          </button>
                                        </div>
                                      ))}
                                      <button className="btn btn-secondary" onClick={() => {
                                        updateItem(realIdx, 'SpawnAttachments', [...(item.SpawnAttachments || []), '']);
                                      }} style={{ padding: '3px 10px', fontSize: 11, alignSelf: 'flex-start', marginTop: 4 }}>
                                        <Plus size={12} /> Add Attachment
                                      </button>
                                    </div>
                                  </div>
                                  {/* Variants */}
                                  <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                      Variants ({(item.Variants || []).length})
                                    </label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      {(item.Variants || []).map((variant, vIdx) => (
                                        <div key={vIdx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                          <ItemPicker value={variant} onChange={v => {
                                            const vars = [...item.Variants];
                                            vars[vIdx] = v;
                                            updateItem(realIdx, 'Variants', vars);
                                          }} catalog={catalog} />
                                          <button onClick={() => {
                                            const vars = item.Variants.filter((_, i) => i !== vIdx);
                                            updateItem(realIdx, 'Variants', vars);
                                          }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2 }}>
                                            <X size={12} />
                                          </button>
                                        </div>
                                      ))}
                                      <button className="btn btn-secondary" onClick={() => {
                                        updateItem(realIdx, 'Variants', [...(item.Variants || []), '']);
                                      }} style={{ padding: '3px 10px', fontSize: 11, alignSelf: 'flex-start', marginTop: 4 }}>
                                        <Plus size={12} /> Add Variant
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                {/* Additional fields */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 12 }}>
                                  <div>
                                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>Quantity %</label>
                                    <input className="input" type="number" value={item.QuantityPercent ?? -1} onChange={e => updateItem(realIdx, 'QuantityPercent', Number(e.target.value))}
                                      style={{ width: '100%', fontSize: 12 }} />
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab 2: Traders ─────────────────────────────────────────────────

function TradersTab({ serverId }) {
  const catalog = useItemCatalog(serverId);
  const [traders, setTraders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [traderData, setTraderData] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNewTrader, setShowNewTrader] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [newTraderName, setNewTraderName] = useState('');
  const [newCurrency, setNewCurrency] = useState('');
  const [newItemOverride, setNewItemOverride] = useState({ className: '', mode: 0 });

  const loadTraders = useCallback(async () => {
    setLoading(true);
    try {
      const [traderRes, catRes] = await Promise.all([
        API.get(`/api/servers/${serverId}/trader-editor/traders`),
        API.get(`/api/servers/${serverId}/trader-editor/categories`),
      ]);
      if (traderRes && !traderRes.error) {
        setTraders(Array.isArray(traderRes) ? traderRes : traderRes.traders || []);
      }
      if (catRes && !catRes.error) {
        setCategories(Array.isArray(catRes) ? catRes : catRes.categories || []);
      }
    } catch {
      window.addToast?.('Failed to load traders', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadTraders(); }, [loadTraders]);

  const loadTrader = useCallback(async (fileName) => {
    try {
      const res = await API.get(`/api/servers/${serverId}/trader-editor/traders/${encodeURIComponent(fileName)}`);
      if (res && !res.error) {
        const d = res.data || res;
        setTraderData(d);
        setOriginalData(JSON.parse(JSON.stringify(d)));
      }
    } catch {
      window.addToast?.('Failed to load trader', 'error');
    }
  }, [serverId]);

  const selectTrader = (fileName) => {
    setSelectedFile(fileName);
    loadTrader(fileName);
  };

  const isModified = useMemo(() => {
    if (!traderData || !originalData) return false;
    return JSON.stringify(traderData) !== JSON.stringify(originalData);
  }, [traderData, originalData]);

  const handleSave = async () => {
    if (!selectedFile || !traderData) return;
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/trader-editor/traders/${encodeURIComponent(selectedFile)}`, { data: traderData });
      if (result && !result.error) {
        window.addToast?.('Trader saved successfully', 'success');
        setOriginalData(JSON.parse(JSON.stringify(traderData)));
      } else {
        window.addToast?.('Failed to save trader', 'error');
      }
    } catch {
      window.addToast?.('Failed to save trader', 'error');
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!newTraderName.trim()) return;
    try {
      const result = await API.post(`/api/servers/${serverId}/trader-editor/traders`, {
        fileName: newTraderName.trim(),
        data: {
          m_Version: 13,
          DisplayName: newTraderName.trim(),
          MinRequiredReputation: 0,
          MaxRequiredReputation: 2147483647,
          TraderIcon: 'Shotgun',
          Currencies: ['expansionbanknotehryvnia'],
          Categories: [],
          Items: {},
        },
      });
      if (result && !result.error) {
        window.addToast?.('Trader created', 'success');
        setNewTraderName('');
        setShowNewTrader(false);
        loadTraders();
      }
    } catch {
      window.addToast?.('Failed to create trader', 'error');
    }
  };

  const updateField = (key, val) => setTraderData(prev => ({ ...prev, [key]: val }));

  const addCurrency = () => {
    if (!newCurrency.trim()) return;
    updateField('Currencies', [...(traderData.Currencies || []), newCurrency.trim()]);
    setNewCurrency('');
  };

  const removeCurrency = (idx) => {
    updateField('Currencies', (traderData.Currencies || []).filter((_, i) => i !== idx));
  };

  // Parse category entry "CategoryName" or "CategoryName:3"
  const parseCategoryEntry = (entry) => {
    const parts = String(entry).split(':');
    return { name: parts[0], mode: parts.length > 1 ? parseInt(parts[1]) : 0 };
  };

  const formatCategoryEntry = (name, mode) => {
    return mode ? `${name}:${mode}` : name;
  };

  const updateCategoryMode = (idx, mode) => {
    const cats = [...(traderData.Categories || [])];
    const parsed = parseCategoryEntry(cats[idx]);
    cats[idx] = formatCategoryEntry(parsed.name, mode);
    updateField('Categories', cats);
  };

  const removeCategory = (idx) => {
    updateField('Categories', (traderData.Categories || []).filter((_, i) => i !== idx));
  };

  const addCategory = (catName) => {
    updateField('Categories', [...(traderData.Categories || []), catName]);
  };

  const addItemOverride = () => {
    if (!newItemOverride.className.trim()) return;
    const items = { ...(traderData.Items || {}) };
    items[newItemOverride.className.trim()] = newItemOverride.mode;
    updateField('Items', items);
    setNewItemOverride({ className: '', mode: 0 });
  };

  const removeItemOverride = (className) => {
    const items = { ...(traderData.Items || {}) };
    delete items[className];
    updateField('Items', items);
  };

  // Categories available to assign
  const assignedCatNames = useMemo(() => {
    return new Set((traderData?.Categories || []).map(c => parseCategoryEntry(c).name));
  }, [traderData]);

  const availableCategories = useMemo(() => {
    return categories
      .map(c => typeof c === 'string' ? c : (c.fileName || c.name || c.DisplayName || ''))
      .map(n => n.replace(/\.json$/i, ''))
      .filter(n => n && !assignedCatNames.has(n));
  }, [categories, assignedCatNames]);

  // Ctrl+S
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

  if (loading) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span style={{ color: 'var(--text-muted)' }}>Loading traders...</span></div>;
  }

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 600 }}>
      {/* Sidebar */}
      <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button className="btn btn-primary" onClick={() => setShowNewTrader(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', fontSize: 12, marginBottom: 8 }}>
          <Plus size={14} /> New Trader
        </button>

        {showNewTrader && (
          <div className="card" style={{ padding: 8, marginBottom: 8 }}>
            <input className="input" value={newTraderName} onChange={e => setNewTraderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Trader name..." style={{ width: '100%', fontSize: 12, marginBottom: 6 }} autoFocus />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary" onClick={handleCreate} style={{ flex: 1, fontSize: 11, padding: '3px 8px' }}>Create</button>
              <button className="btn btn-secondary" onClick={() => { setShowNewTrader(false); setNewTraderName(''); }} style={{ fontSize: 11, padding: '3px 8px' }}>Cancel</button>
            </div>
          </div>
        )}

        <input
          className="input"
          value={sidebarSearch}
          onChange={(e) => setSidebarSearch(e.target.value)}
          placeholder="Search traders…"
          style={{ width: '100%', fontSize: 12, padding: '4px 8px', marginBottom: 6 }}
        />
        <div style={{ overflow: 'auto', flex: 1 }}>
          {(() => {
            const q = sidebarSearch.trim().toLowerCase();
            const filtered = !q ? traders : traders.filter((t) => {
              const s = (typeof t === 'string' ? t : (t.displayName || t.DisplayName || t.fileName || t.name || '')).toLowerCase();
              return s.includes(q);
            });
            if (filtered.length === 0) {
              return (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  {q ? `No traders match "${sidebarSearch}"` : 'No traders found'}
                </div>
              );
            }
            return filtered.map((trader) => {
              const fileName = typeof trader === 'string' ? trader : (trader.fileName || trader.name || trader);
              const displayName = typeof trader === 'object' ? (trader.displayName || trader.DisplayName || trader.fileName || trader.name) : trader;
              const isActive = selectedFile === fileName;
              return (
                <div key={fileName} onClick={() => selectTrader(fileName)}
                  style={{
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    background: isActive ? 'var(--accent-blue)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-primary)',
                    transition: 'all 0.15s', marginBottom: 1, fontSize: 13,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                  {String(displayName).replace(/_/g, ' ').replace(/\.json$/i, '')}
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!traderData ? (
          <NoData message="Select a trader from the sidebar to configure" />
        ) : (
          <>
            {/* Trader Header */}
            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div style={{
                padding: '10px 16px', fontWeight: 700, fontSize: 14,
                borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
                background: 'var(--bg-surface, var(--bg-deep))',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span>Trader Settings</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isModified && <span style={{ fontSize: 11, color: 'var(--accent-orange, #f59e0b)', fontWeight: 600 }}>Unsaved changes</span>}
                  <button className="btn btn-primary" onClick={handleSave} disabled={saving || !isModified}
                    style={{ padding: '4px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Save size={12} /> {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Name</label>
                  <input className="input" value={traderData.DisplayName || ''} onChange={e => updateField('DisplayName', e.target.value)}
                    style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Trader Icon</label>
                  <select className="input" value={traderData.TraderIcon || 'Shotgun'} onChange={e => updateField('TraderIcon', e.target.value)}
                    style={{ width: '100%', fontSize: 13 }}>
                    {ICON_OPTIONS.map(icon => <option key={icon} value={icon}>{icon}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Min Reputation</label>
                  <input className="input" type="number" value={traderData.MinRequiredReputation ?? 0} onChange={e => updateField('MinRequiredReputation', Number(e.target.value))}
                    style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Max Reputation</label>
                  <input className="input" type="number" value={traderData.MaxRequiredReputation ?? 2147483647} onChange={e => updateField('MaxRequiredReputation', Number(e.target.value))}
                    style={{ width: '100%', fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Required Faction</label>
                  <input className="input" value={traderData.RequiredFaction || ''} onChange={e => updateField('RequiredFaction', e.target.value)}
                    style={{ width: '100%', fontSize: 13 }} placeholder="(none)" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Required Completed Quest ID</label>
                  <input className="input" type="number" value={traderData.RequiredCompletedQuestID ?? -1} onChange={e => updateField('RequiredCompletedQuestID', Number(e.target.value))}
                    style={{ width: '100%', fontSize: 13 }} title="-1 = no quest required" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Currency Name</label>
                  <input className="input" value={traderData.DisplayCurrencyName || ''} onChange={e => updateField('DisplayCurrencyName', e.target.value)}
                    style={{ width: '100%', fontSize: 13 }} placeholder="(optional label)" />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Display Currency Value</label>
                  <button className="btn btn-secondary" onClick={() => updateField('DisplayCurrencyValue', traderData.DisplayCurrencyValue ? 0 : 1)}
                    style={{ width: '100%', fontSize: 13, padding: '6px 12px', background: traderData.DisplayCurrencyValue ? 'var(--accent-green)' : undefined, color: traderData.DisplayCurrencyValue ? '#fff' : undefined }}>
                    {traderData.DisplayCurrencyValue ? 'Yes' : 'No'}
                  </button>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Use Category Order</label>
                  <button className="btn btn-secondary" onClick={() => updateField('UseCategoryOrder', traderData.UseCategoryOrder ? 0 : 1)}
                    style={{ width: '100%', fontSize: 13, padding: '6px 12px', background: traderData.UseCategoryOrder ? 'var(--accent-green)' : undefined, color: traderData.UseCategoryOrder ? '#fff' : undefined }}
                    title="Respect the explicit category ordering below">
                    {traderData.UseCategoryOrder ? 'Yes' : 'No'}
                  </button>
                </div>
              </div>
            </div>

            {/* Currencies */}
            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div style={{
                padding: '10px 16px', fontWeight: 700, fontSize: 14,
                borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-green)',
                background: 'var(--bg-surface, var(--bg-deep))',
              }}>
                Currencies ({(traderData.Currencies || []).length})
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                  {(traderData.Currencies || []).map((cur, idx) => (
                    <div key={idx} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px',
                      borderRadius: 4, background: 'var(--bg-deep)', border: '1px solid var(--border)',
                    }}>
                      <span style={{ flex: 1, fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>{cur}</span>
                      <button onClick={() => removeCurrency(idx)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex' }}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <ItemPicker value={newCurrency} onChange={setNewCurrency} catalog={catalog} placeholder="Add currency class..." />
                  <button className="btn btn-secondary" onClick={addCurrency}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 13 }}>
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </div>

            {/* Assigned Categories */}
            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div style={{
                padding: '10px 16px', fontWeight: 700, fontSize: 14,
                borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-orange, #f59e0b)',
                background: 'var(--bg-surface, var(--bg-deep))',
              }}>
                Assigned Categories ({(traderData.Categories || []).length})
              </div>
              <div style={{ padding: 12 }}>
                {(traderData.Categories || []).length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No categories assigned</div>
                ) : (
                  <table className="table" style={{ width: '100%', fontSize: 13, marginBottom: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Category</th>
                        <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', width: 180 }}>Buy/Sell Mode</th>
                        <th style={{ padding: '6px 10px', width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(traderData.Categories || []).map((catEntry, idx) => {
                        const parsed = parseCategoryEntry(catEntry);
                        return (
                          <tr key={idx}>
                            <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono, monospace)' }}>{parsed.name}</td>
                            <td style={{ padding: '6px 10px' }}>
                              <select className="input" value={parsed.mode} onChange={e => updateCategoryMode(idx, parseInt(e.target.value))}
                                style={{ width: '100%', fontSize: 12 }}>
                                {SELL_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                              </select>
                            </td>
                            <td style={{ padding: '6px 10px' }}>
                              <button onClick={() => removeCategory(idx)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex' }}>
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {/* Available categories */}
                {availableCategories.length > 0 && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6, color: 'var(--text-muted)' }}>
                      Available Categories
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {availableCategories.map(catName => (
                        <button key={catName} className="btn btn-secondary" onClick={() => addCategory(catName)}
                          style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Plus size={10} /> {catName.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Items Override Map */}
            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div style={{
                padding: '10px 16px', fontWeight: 700, fontSize: 14,
                borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-purple, #a78bfa)',
                background: 'var(--bg-surface, var(--bg-deep))',
              }}>
                Item Overrides ({Object.keys(traderData.Items || {}).length})
              </div>
              <div style={{ padding: 12 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
                  Override buy/sell mode for specific items. Mode: 0=Buy&Sell, 1=Buy Only, 2=Sell Only, 3=Hidden
                </p>
                {Object.keys(traderData.Items || {}).length > 0 && (
                  <table className="table" style={{ width: '100%', fontSize: 13, marginBottom: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>ClassName</th>
                        <th style={{ padding: '6px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', width: 180 }}>Mode</th>
                        <th style={{ padding: '6px 10px', width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(traderData.Items || {}).map(([className, mode]) => (
                        <tr key={className}>
                          <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono, monospace)' }}>{className}</td>
                          <td style={{ padding: '6px 10px' }}>
                            <select className="input" value={mode} onChange={e => {
                              const items = { ...traderData.Items };
                              items[className] = parseInt(e.target.value);
                              updateField('Items', items);
                            }} style={{ width: '100%', fontSize: 12 }}>
                              {SELL_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            <button onClick={() => removeItemOverride(className)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-red)', padding: 2, display: 'flex' }}>
                              <X size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <ItemPicker value={newItemOverride.className} onChange={v => setNewItemOverride(prev => ({ ...prev, className: v }))}
                    catalog={catalog} placeholder="ClassName..." />
                  <select className="input" value={newItemOverride.mode} onChange={e => setNewItemOverride(prev => ({ ...prev, mode: parseInt(e.target.value) }))}
                    style={{ width: 140, fontSize: 12 }}>
                    {SELL_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <button className="btn btn-secondary" onClick={addItemOverride}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', fontSize: 13 }}>
                    <Plus size={14} /> Add
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab 3: Trader Zones ────────────────────────────────────────────

function TraderZonesTab({ serverId }) {
  const serverMap = useServerMap(serverId);
  const [zones, setZones] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedZone, setSelectedZone] = useState(null);
  const [mapMode, setMapMode] = useState('view');
  const [editData, setEditData] = useState({});

  const loadZones = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/trader-editor/zones`);
      if (data && !data.error) {
        const zoneList = Array.isArray(data) ? data : data.zones || [];
        setZones(zoneList);
        // Build edit data map
        const ed = {};
        zoneList.forEach((z, i) => {
          const id = z.fileName || z.name || `zone-${i}`;
          ed[id] = JSON.parse(JSON.stringify(z));
        });
        setEditData(ed);
      }
    } catch {
      window.addToast?.('Failed to load trader zones', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadZones(); }, [loadZones]);

  const saveZone = async (zoneId) => {
    const zone = editData[zoneId];
    if (!zone) return;
    setSaving(true);
    try {
      const fileName = zone.fileName || zoneId;
      const result = await API.put(`/api/servers/${serverId}/trader-editor/zones/${encodeURIComponent(fileName)}`, zone);
      if (result && !result.error) {
        window.addToast?.('Zone saved', 'success');
        loadZones();
      } else {
        window.addToast?.('Failed to save zone', 'error');
      }
    } catch {
      window.addToast?.('Failed to save zone', 'error');
    }
    setSaving(false);
  };

  const createZone = async (x, z) => {
    try {
      const result = await API.post(`/api/servers/${serverId}/trader-editor/zones`, {
        data: {
          m_Version: 4,
          DisplayName: 'New Trading Zone',
          Position: [Math.round(x || 7500), 0, Math.round(z || 7500)],
          Radius: 150,
          BuyPricePercent: 100,
          SellPricePercent: 100,
          Traders: [],
        },
      });
      if (result && !result.error) {
        window.addToast?.('Zone created', 'success');
        setMapMode('view');
        loadZones();
      }
    } catch {
      window.addToast?.('Failed to create zone', 'error');
    }
  };

  const deleteZone = async (zoneId) => {
    const zone = editData[zoneId];
    if (!zone) return;
    if (!confirm(`Delete zone "${zone.DisplayName || zoneId}"?`)) return;
    try {
      const fileName = zone.fileName || zoneId;
      await API.del(`/api/servers/${serverId}/trader-editor/zones/${encodeURIComponent(fileName)}`);
      window.addToast?.('Zone deleted', 'success');
      if (selectedZone === zoneId) setSelectedZone(null);
      loadZones();
    } catch {
      window.addToast?.('Failed to delete zone', 'error');
    }
  };

  const updateZoneField = (zoneId, key, val) => {
    setEditData(prev => ({
      ...prev,
      [zoneId]: { ...prev[zoneId], [key]: val },
    }));
  };

  if (loading) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span style={{ color: 'var(--text-muted)' }}>Loading trader zones...</span></div>;
  }

  const zoneIds = Object.keys(editData);

  return (
    <div>
      {/* Map */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-green)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>Trader Zones ({zoneIds.length})</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn ${mapMode === 'addMarker' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setMapMode(mapMode === 'addMarker' ? 'view' : 'addMarker')}>
              <Plus size={12} /> {mapMode === 'addMarker' ? 'Cancel' : 'Click to Place'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '3px 10px', fontSize: 11 }}
              onClick={() => createZone(7500, 7500)}>
              <Plus size={12} /> Add at Center
            </button>
          </div>
        </div>
        <div style={{ padding: 8 }}>
          <Suspense fallback={<div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading map...</div>}>
            <InteractiveMap
              mapName={serverMap}
              height={500}
              circles={zoneIds.map(id => {
                const z = editData[id];
                const pos = z.Position || [0, 0, 0];
                return {
                  id,
                  x: pos[0] || 0,
                  z: pos[2] || 0,
                  radius: z.Radius || 150,
                  color: selectedZone === id ? '#f59e0b' : '#22c55e',
                  label: z.DisplayName || id,
                  draggable: true,
                };
              })}
              selectedId={selectedZone}
              onSelect={setSelectedZone}
              onCircleMove={(id, x, z) => {
                if (editData[id]) {
                  const pos = [...(editData[id].Position || [0, 0, 0])];
                  pos[0] = Math.round(x);
                  pos[2] = Math.round(z);
                  updateZoneField(id, 'Position', pos);
                }
              }}
              onMarkerAdd={(x, z) => createZone(x, z)}
              onMarkerDelete={(id) => deleteZone(id)}
              mode={mapMode}
            />
          </Suspense>
        </div>
        {mapMode === 'addMarker' && (
          <div style={{ padding: '8px 16px', background: 'rgba(34,197,94,0.1)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--accent-green)' }}>
            Click anywhere on the map to place a new trading zone. Right-click a zone to delete it.
          </div>
        )}
      </div>

      {/* Zone Details */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between',
        }}>
          <span>Zone Details</span>
          {zoneIds.length > 4 && (
            <input
              className="input"
              placeholder="Search zones…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220, fontSize: 12, padding: '4px 8px' }}
            />
          )}
        </div>
        {zoneIds.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No trading zones found. Use the map above to place zones.
          </div>
        ) : (
          <table className="table" style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Display Name</th>
                <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>X</th>
                <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Z</th>
                <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Radius</th>
                <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Buy %</th>
                <th style={{ padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Sell %</th>
                <th style={{ padding: '8px 12px', width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const q = search.trim().toLowerCase();
                const visibleIds = !q ? zoneIds : zoneIds.filter((id) => {
                  const z = editData[id];
                  return id.toLowerCase().includes(q) || (z?.DisplayName || '').toLowerCase().includes(q);
                });
                if (visibleIds.length === 0) {
                  return <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No zones match &ldquo;{search}&rdquo;</td></tr>;
                }
                return visibleIds.map(id => {
                const z = editData[id];
                const pos = z.Position || [0, 0, 0];
                const isSelected = selectedZone === id;
                return (
                  <tr key={id} onClick={() => setSelectedZone(id)}
                    style={{ cursor: 'pointer', background: isSelected ? 'rgba(34,197,94,0.1)' : undefined }}>
                    <td style={{ padding: '6px 12px' }}>
                      <input className="input" value={z.DisplayName || ''} onChange={e => updateZoneField(id, 'DisplayName', e.target.value)}
                        onClick={e => e.stopPropagation()} style={{ width: '100%', fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input className="input" type="number" value={pos[0] ?? 0} onClick={e => e.stopPropagation()}
                        onChange={e => { const p = [...pos]; p[0] = Number(e.target.value); updateZoneField(id, 'Position', p); }}
                        style={{ width: 80, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input className="input" type="number" value={pos[2] ?? 0} onClick={e => e.stopPropagation()}
                        onChange={e => { const p = [...pos]; p[2] = Number(e.target.value); updateZoneField(id, 'Position', p); }}
                        style={{ width: 80, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input className="input" type="number" value={z.Radius ?? 150} onClick={e => e.stopPropagation()}
                        onChange={e => updateZoneField(id, 'Radius', Number(e.target.value))}
                        style={{ width: 70, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input className="input" type="number" value={z.BuyPricePercent ?? 100} onClick={e => e.stopPropagation()}
                        onChange={e => updateZoneField(id, 'BuyPricePercent', Number(e.target.value))}
                        style={{ width: 60, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <input className="input" type="number" value={z.SellPricePercent ?? 100} onClick={e => e.stopPropagation()}
                        onChange={e => updateZoneField(id, 'SellPricePercent', Number(e.target.value))}
                        style={{ width: 60, fontSize: 12 }} />
                    </td>
                    <td style={{ padding: '6px 12px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-primary" onClick={e => { e.stopPropagation(); saveZone(id); }} disabled={saving}
                          style={{ padding: '2px 8px', fontSize: 11 }}>
                          <Save size={11} />
                        </button>
                        <button className="btn btn-danger" onClick={e => { e.stopPropagation(); deleteZone(id); }}
                          style={{ padding: '2px 8px', fontSize: 11 }}>
                          <X size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              });
              })()}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Tab 4: NPC Spawns ──────────────────────────────────────────────

function NPCSpawnsTab({ serverId }) {
  const serverMap = useServerMap(serverId);
  // spawnFiles: [{ fileName, spawns: [{ entityClass, traderFile, position: {x,y,z}, orientation: {yaw,pitch,roll}, gear: [] }], raw, dirty }]
  // All data comes from /trader-editor/spawns which parses the Expansion .map
  // format server-side and returns structured objects. The prior version of
  // this tab pulled from /traders (the JSON trader configs) which don't have
  // the same fields — positions were wrong and gear was untouchable.
  const [spawnFiles, setSpawnFiles] = useState([]);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [expandedNpcIdx, setExpandedNpcIdx] = useState(null);
  const [mapMode, setMapMode] = useState('view'); // 'view' | 'addMarker'

  const loadSpawns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/trader-editor/spawns`);
      if (Array.isArray(data)) {
        setSpawnFiles(data.map((f) => ({
          fileName: f.fileName,
          displayName: f.fileName,
          spawns: Array.isArray(f.spawns) ? f.spawns : [],
          raw: f.raw || '',
          dirty: false,
        })));
      } else if (data?.error) {
        window.addToast?.(data.error, 'error');
      }
    } catch (err) {
      window.addToast?.(`Failed to load NPC spawns: ${err.message}`, 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadSpawns(); }, [loadSpawns]);

  // ─── Mutation helpers ──────────────────────────────────
  // Each mutation goes through updateFile which marks the file dirty.
  const updateFile = useCallback((fileName, mutator) => {
    setSpawnFiles((prev) => prev.map((f) => {
      if (f.fileName !== fileName) return f;
      const next = mutator({ ...f, spawns: [...f.spawns] });
      return { ...next, dirty: true };
    }));
  }, []);

  const updateSpawn = useCallback((fileName, idx, patch) => {
    updateFile(fileName, (f) => {
      const spawns = [...f.spawns];
      if (!spawns[idx]) return f;
      spawns[idx] = { ...spawns[idx], ...patch };
      return { ...f, spawns };
    });
  }, [updateFile]);

  const updatePosition = useCallback((fileName, idx, axis, value) => {
    updateFile(fileName, (f) => {
      const spawns = [...f.spawns];
      if (!spawns[idx]) return f;
      const pos = { ...(spawns[idx].position || { x: 0, y: 0, z: 0 }) };
      pos[axis] = Number(value) || 0;
      spawns[idx] = { ...spawns[idx], position: pos };
      return { ...f, spawns };
    });
  }, [updateFile]);

  const updateOrientation = useCallback((fileName, idx, axis, value) => {
    updateFile(fileName, (f) => {
      const spawns = [...f.spawns];
      if (!spawns[idx]) return f;
      const ori = { ...(spawns[idx].orientation || { yaw: 0, pitch: 0, roll: 0 }) };
      ori[axis] = Number(value) || 0;
      spawns[idx] = { ...spawns[idx], orientation: ori };
      return { ...f, spawns };
    });
  }, [updateFile]);

  const addSpawn = useCallback((fileName, x, z) => {
    updateFile(fileName, (f) => ({
      ...f,
      spawns: [...f.spawns, {
        entityClass: '',
        traderFile: '',
        position: { x: Math.round(x || 0), y: 0, z: Math.round(z || 0) },
        orientation: { yaw: 0, pitch: 0, roll: 0 },
        gear: [],
      }],
    }));
  }, [updateFile]);

  const deleteSpawn = useCallback((fileName, idx) => {
    updateFile(fileName, (f) => {
      const spawns = [...f.spawns];
      spawns.splice(idx, 1);
      return { ...f, spawns };
    });
    // Clear expanded state if we just deleted the expanded row
    setExpandedNpcIdx((prev) => (prev === idx ? null : (prev > idx ? prev - 1 : prev)));
  }, [updateFile]);

  const addGearItem = useCallback((fileName, idx, className) => {
    const cn = (className || '').trim();
    if (!cn) return;
    updateFile(fileName, (f) => {
      const spawns = [...f.spawns];
      if (!spawns[idx]) return f;
      spawns[idx] = { ...spawns[idx], gear: [...(spawns[idx].gear || []), cn] };
      return { ...f, spawns };
    });
  }, [updateFile]);

  const removeGearItem = useCallback((fileName, idx, gearIdx) => {
    updateFile(fileName, (f) => {
      const spawns = [...f.spawns];
      if (!spawns[idx]) return f;
      const gear = [...(spawns[idx].gear || [])];
      gear.splice(gearIdx, 1);
      spawns[idx] = { ...spawns[idx], gear };
      return { ...f, spawns };
    });
  }, [updateFile]);

  const saveFile = useCallback(async (fileName) => {
    const file = spawnFiles.find((f) => f.fileName === fileName);
    if (!file || !file.dirty) return;
    setSaving(true);
    try {
      await API.put(`/api/servers/${serverId}/trader-editor/spawns/${encodeURIComponent(fileName)}`, {
        spawns: file.spawns,
      });
      setSpawnFiles((prev) => prev.map((f) => (f.fileName === fileName ? { ...f, dirty: false } : f)));
      window.addToast?.(`Saved ${fileName}`, 'success');
    } catch (err) {
      window.addToast?.(`Save failed: ${err.message}`, 'error');
    }
    setSaving(false);
  }, [spawnFiles, serverId]);

  // ─── Map markers ───────────────────────────────────────
  // One marker per spawn across all files — selected file's spawns get a
  // contrasting color so the user can see "which file am I editing?" at a
  // glance. Marker IDs are `${fileName}::${idx}` so drag handlers can
  // unambiguously route the position update.
  const allMarkers = useMemo(() => {
    const out = [];
    spawnFiles.forEach((file) => {
      file.spawns.forEach((spawn, idx) => {
        const p = spawn.position || { x: 0, z: 0 };
        if (!p.x && !p.z) return;
        const isInSelectedFile = file.fileName === selectedFile;
        out.push({
          id: `${file.fileName}::${idx}`,
          x: p.x,
          z: p.z,
          label: spawn.entityClass || spawn.traderFile || `NPC ${idx + 1}`,
          color: isInSelectedFile ? '#f59e0b' : '#3b82f6',
          draggable: true,
        });
      });
    });
    return out;
  }, [spawnFiles, selectedFile]);

  const handleMarkerMove = useCallback((id, x, z) => {
    const [fileName, idxStr] = id.split('::');
    const idx = Number(idxStr);
    if (Number.isNaN(idx)) return;
    updatePosition(fileName, idx, 'x', Math.round(x));
    updatePosition(fileName, idx, 'z', Math.round(z));
  }, [updatePosition]);

  const handleMarkerSelect = useCallback((id) => {
    const [fileName, idxStr] = id.split('::');
    const idx = Number(idxStr);
    setSelectedFile(fileName);
    setExpandedNpcIdx(idx);
  }, []);

  const handleMarkerAdd = useCallback((x, z) => {
    if (!selectedFile) {
      window.addToast?.('Select a spawn file first', 'warning');
      return;
    }
    addSpawn(selectedFile, x, z);
    setMapMode('view');
  }, [selectedFile, addSpawn]);

  if (loading) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span style={{ color: 'var(--text-muted)' }}>Loading NPC spawns...</span></div>;
  }

  const selectedFileData = spawnFiles.find((f) => f.fileName === selectedFile);

  return (
    <div>
      {/* Map */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>NPC Positions ({allMarkers.length})</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`btn ${mapMode === 'addMarker' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '3px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              onClick={() => setMapMode(mapMode === 'addMarker' ? 'view' : 'addMarker')}
              disabled={!selectedFile}
              title={selectedFile ? 'Click the map to place a new NPC in the selected file' : 'Select a spawn file first'}
            >
              <Plus size={12} /> {mapMode === 'addMarker' ? 'Cancel' : 'Click to Place'}
            </button>
          </div>
        </div>
        <div style={{ padding: 8 }}>
          <Suspense fallback={<div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading map...</div>}>
            <InteractiveMap
              mapName={serverMap}
              height={500}
              markers={allMarkers}
              selectedId={selectedFile && expandedNpcIdx != null ? `${selectedFile}::${expandedNpcIdx}` : null}
              onSelect={handleMarkerSelect}
              onMarkerMove={handleMarkerMove}
              onMarkerAdd={handleMarkerAdd}
              mode={mapMode}
            />
          </Suspense>
        </div>
        {mapMode === 'addMarker' && (
          <div style={{ padding: '8px 16px', background: 'rgba(34,197,94,0.1)', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--accent-green)' }}>
            Click anywhere on the map to place a new NPC in <strong>{selectedFile}</strong>.
          </div>
        )}
        <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
          Orange markers = selected file&apos;s NPCs. Drag any marker to move that NPC. Click to select + expand its details below.
        </div>
      </div>

      {/* Spawn Files List */}
      <div style={{ display: 'flex', gap: 16, minHeight: 300 }}>
        {/* Sidebar */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>
            Spawn Files
          </div>
          <input
            className="input"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Search files + NPC classes…"
            style={{ width: '100%', fontSize: 12, padding: '4px 8px', marginBottom: 6 }}
          />
          {(() => {
            if (spawnFiles.length === 0) {
              return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No spawn files found</div>;
            }
            const q = sidebarSearch.trim().toLowerCase();
            const filtered = !q ? spawnFiles : spawnFiles.filter((file) => {
              const name = String(file.displayName || file.fileName).toLowerCase();
              if (name.includes(q)) return true;
              // Also match on NPC EntityClass names so admins can find "where does Hermit spawn?"
              return (file.npcs || []).some((npc) =>
                (npc.EntityClass || npc.entityClass || '').toLowerCase().includes(q)
              );
            });
            if (filtered.length === 0) {
              return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No files match &ldquo;{sidebarSearch}&rdquo;</div>;
            }
            return filtered.map((file) => {
              const isActive = selectedFile === file.fileName;
              return (
                <div key={file.fileName} onClick={() => setSelectedFile(isActive ? null : file.fileName)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    background: isActive ? 'var(--accent-blue)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-primary)',
                    transition: 'all 0.15s', marginBottom: 1,
                  }}>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(file.displayName || file.fileName).replace(/_/g, ' ').replace(/\.map$/i, '')}
                  </span>
                  {file.dirty && <span style={{ color: isActive ? '#fde68a' : '#f59e0b', fontWeight: 700, fontSize: 12 }} title="Unsaved changes">●</span>}
                  <Badge count={(file.spawns || []).length} color={isActive ? 'rgba(255,255,255,0.25)' : undefined} />
                </div>
              );
            });
          })()}
        </div>

        {/* NPC Details — editable */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedFile || !selectedFileData ? (
            <NoData message="Select a spawn file from the sidebar to view + edit its NPCs" />
          ) : (
            <SpawnFileEditor
              file={selectedFileData}
              saving={saving}
              expandedIdx={expandedNpcIdx}
              onExpand={setExpandedNpcIdx}
              onUpdateSpawn={(idx, patch) => updateSpawn(selectedFile, idx, patch)}
              onUpdatePosition={(idx, axis, val) => updatePosition(selectedFile, idx, axis, val)}
              onUpdateOrientation={(idx, axis, val) => updateOrientation(selectedFile, idx, axis, val)}
              onAddSpawn={() => addSpawn(selectedFile, 7500, 7500)}
              onDeleteSpawn={(idx) => deleteSpawn(selectedFile, idx)}
              onAddGear={(idx, cn) => addGearItem(selectedFile, idx, cn)}
              onRemoveGear={(idx, gIdx) => removeGearItem(selectedFile, idx, gIdx)}
              onSave={() => saveFile(selectedFile)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Editable single-file spawn editor ─────────────────────────────

/**
 * Table of an .map file's NPCs with inline editing. Collapsed rows show
 * the common fields (class, X, Z, Yaw, gear count); expanded rows add
 * TraderFile, full position/orientation, and the gear list.
 */
function SpawnFileEditor({
  file, saving, expandedIdx, onExpand,
  onUpdateSpawn, onUpdatePosition, onUpdateOrientation,
  onAddSpawn, onDeleteSpawn, onAddGear, onRemoveGear, onSave,
}) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '10px 16px', fontWeight: 700, fontSize: 14,
        borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
        background: 'var(--bg-surface, var(--bg-deep))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap',
      }}>
        <span>
          NPCs in {String(file.fileName).replace(/_/g, ' ').replace(/\.map$/i, '')} ({file.spawns.length})
          {file.dirty && <span style={{ color: '#f59e0b', marginLeft: 8, fontSize: 12 }}>● unsaved</span>}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary" onClick={onAddSpawn} style={{ padding: '3px 10px', fontSize: 11 }}>
            <Plus size={12} /> Add NPC
          </button>
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={!file.dirty || saving}
            style={{ padding: '3px 10px', fontSize: 11 }}
          >
            <Save size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {file.spawns.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No NPCs in this file yet. Use <strong>Add NPC</strong> or <strong>Click to Place</strong> on the map.
        </div>
      ) : (
        <table className="table" style={{ width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Entity Class</th>
              <th style={{ padding: '8px 10px', width: 90, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>X</th>
              <th style={{ padding: '8px 10px', width: 90, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Z</th>
              <th style={{ padding: '8px 10px', width: 70, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Yaw</th>
              <th style={{ padding: '8px 10px', width: 90, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Gear</th>
              <th style={{ padding: '8px 10px', width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {file.spawns.map((spawn, idx) => {
              const isExpanded = expandedIdx === idx;
              const pos = spawn.position || { x: 0, y: 0, z: 0 };
              const ori = spawn.orientation || { yaw: 0, pitch: 0, roll: 0 };
              const gear = Array.isArray(spawn.gear) ? spawn.gear : [];
              return (
                <React.Fragment key={idx}>
                  <tr
                    onClick={() => onExpand(isExpanded ? null : idx)}
                    style={{ cursor: 'pointer', background: isExpanded ? 'var(--bg-elevated, var(--bg-deep))' : undefined }}
                  >
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        className="input"
                        value={spawn.entityClass || ''}
                        onChange={(e) => onUpdateSpawn(idx, { entityClass: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="e.g. TraderNPC"
                        style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        className="input"
                        type="number"
                        value={pos.x}
                        onChange={(e) => onUpdatePosition(idx, 'x', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        className="input"
                        type="number"
                        value={pos.z}
                        onChange={(e) => onUpdatePosition(idx, 'z', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <input
                        className="input"
                        type="number"
                        value={ori.yaw}
                        onChange={(e) => onUpdateOrientation(idx, 'yaw', e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '100%', fontSize: 12 }}
                      />
                    </td>
                    <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                      {gear.length} item{gear.length === 1 ? '' : 's'}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <button
                        className="btn btn-danger"
                        onClick={(e) => { e.stopPropagation(); onDeleteSpawn(idx); }}
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        title="Delete this NPC"
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} style={{ padding: 0 }}>
                        <div style={{ padding: 16, background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                                Trader file reference
                              </label>
                              <input
                                className="input"
                                value={spawn.traderFile || ''}
                                onChange={(e) => onUpdateSpawn(idx, { traderFile: e.target.value })}
                                placeholder="TraderWeapons (matches a .json in /traders)"
                                style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}
                              />
                              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                Name (no .json) of the trader config this NPC sells.
                              </div>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                                Y (terrain height — usually 0 for auto-snap)
                              </label>
                              <input
                                className="input"
                                type="number"
                                value={pos.y}
                                onChange={(e) => onUpdatePosition(idx, 'y', e.target.value)}
                                style={{ width: '100%', fontSize: 12 }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Pitch</label>
                              <input
                                className="input"
                                type="number"
                                value={ori.pitch}
                                onChange={(e) => onUpdateOrientation(idx, 'pitch', e.target.value)}
                                style={{ width: '100%', fontSize: 12 }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Roll</label>
                              <input
                                className="input"
                                type="number"
                                value={ori.roll}
                                onChange={(e) => onUpdateOrientation(idx, 'roll', e.target.value)}
                                style={{ width: '100%', fontSize: 12 }}
                              />
                            </div>
                          </div>

                          <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                            Gear ({gear.length})
                          </label>
                          <GearEditor
                            gear={gear}
                            onAdd={(cn) => onAddGear(idx, cn)}
                            onRemove={(gIdx) => onRemoveGear(idx, gIdx)}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Gear list editor — chip row of item class names + an input that appends
 * on Enter. Gear is the 4th field of a trader .map line (comma-separated
 * class names of what the NPC wears/holds when spawned).
 */
function GearEditor({ gear, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft('');
  };
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
        {gear.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No gear — NPC spawns with default loadout.
          </span>
        ) : gear.map((g, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 6px 3px 8px',
            background: 'var(--bg-elevated, var(--bg-card))',
            borderRadius: 4, fontSize: 11,
            fontFamily: 'var(--font-mono, monospace)',
            border: '1px solid var(--border)',
          }}>
            {g}
            <button
              onClick={() => onRemove(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--accent-red)' }}
              title="Remove"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          placeholder="Add item class + Enter (e.g. CombatKnife)"
          style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}
        />
        <button className="btn btn-secondary" onClick={commit} style={{ padding: '4px 10px', fontSize: 11 }}>
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────────────

// ─── Diagnostics engine ─────────────────────────────────────────────
//
// Pure function over the loaded category + trader files (each {fileName, data}).
// Returns issues sorted by severity. Mirrors the official Market Manager's
// Diagnostics panel: inverted prices/stock, duplicate classnames (in-file and
// cross-file), missing DisplayName, traders pointing at categories that don't
// exist, and a light missing-dependency hint.
const SEV_ORDER = { error: 0, warn: 1, info: 2 };
const DEP_HINTS = [
  { pattern: /optic|scope|nvg|rangefinder|reflexoptic|acog|pso/i, requires: /battery9v|battery|energizer/i, label: 'optics/NVGs typically need a battery (e.g. Battery9V)' },
];

function runDiagnostics(categories, traders) {
  const issues = [];
  const add = (severity, file, message, detail) => issues.push({ severity, file, message, detail });

  const soldClasses = new Map(); // className(lower) -> [fileName,...]

  for (const c of categories || []) {
    const d = c.data;
    if (!d) { add('error', c.fileName, 'File could not be parsed', c.error); continue; }
    if (!d.DisplayName) add('warn', c.fileName, 'Missing DisplayName');
    const seenInFile = new Set();
    for (const it of d.Items || []) {
      const cn = (it.ClassName || '').trim();
      if (!cn) { add('warn', c.fileName, 'Item with empty ClassName'); continue; }
      const low = cn.toLowerCase();
      if (seenInFile.has(low)) add('warn', c.fileName, `Duplicate ClassName in file: ${cn}`);
      seenInFile.add(low);
      soldClasses.set(low, [...(soldClasses.get(low) || []), c.fileName]);
      const minP = it.MinPriceThreshold, maxP = it.MaxPriceThreshold;
      if (minP >= 0 && maxP >= 0 && minP > maxP) add('error', c.fileName, `Inverted price on ${cn}: min ${minP} > max ${maxP}`);
      const minS = it.MinStockThreshold, maxS = it.MaxStockThreshold;
      if (minS >= 0 && maxS >= 0 && minS > maxS) add('error', c.fileName, `Inverted stock on ${cn}: min ${minS} > max ${maxS}`);
    }
  }

  // Cross-file duplicate classnames (same item sold by multiple category files).
  for (const [low, files] of soldClasses) {
    if (files.length > 1) add('info', files.join(', '), `Sold in ${files.length} category files: ${low}`);
  }

  // Missing-dependency hints.
  const allSold = [...soldClasses.keys()];
  for (const hint of DEP_HINTS) {
    const needers = allSold.filter((cn) => hint.pattern.test(cn));
    const hasDep = allSold.some((cn) => hint.requires.test(cn));
    if (needers.length && !hasDep) add('info', '(market)', `${hint.label} — sold: ${needers.slice(0, 3).join(', ')}${needers.length > 3 ? '…' : ''}`);
  }

  // Trader checks.
  const categoryNames = new Set((categories || []).map((c) => c.fileName.replace(/\.json$/i, '').toLowerCase()));
  for (const t of traders || []) {
    const d = t.data;
    if (!d) { add('error', t.fileName, 'File could not be parsed', t.error); continue; }
    if (!d.DisplayName) add('warn', t.fileName, 'Missing DisplayName');
    if (!(d.Currencies || []).length) add('warn', t.fileName, 'No currencies — trader cannot transact');
    for (const entry of d.Categories || []) {
      const name = String(entry).split(':')[0].trim();
      if (name && !categoryNames.has(name.toLowerCase())) add('error', t.fileName, `References missing category file: ${name}.json`);
    }
  }

  return issues.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

const SEV_STYLE = {
  error: { color: 'var(--accent-red, #ef4444)', label: 'Error' },
  warn: { color: 'var(--accent-orange, #f59e0b)', label: 'Warning' },
  info: { color: 'var(--accent-blue, #3b82f6)', label: 'Info' },
};

function DiagnosticsTab({ serverId }) {
  const [issues, setIssues] = useState(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const [cats, trds] = await Promise.all([
        API.get(`/api/servers/${serverId}/trader-editor/categories`).catch(() => []),
        API.get(`/api/servers/${serverId}/trader-editor/traders`).catch(() => []),
      ]);
      setIssues(runDiagnostics(Array.isArray(cats) ? cats : [], Array.isArray(trds) ? trds : []));
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => { run(); }, [run]);

  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 };
    (issues || []).forEach((i) => { c[i.severity]++; });
    return c;
  }, [issues]);

  if (loading) return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Scanning market & trader files…</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ color: SEV_STYLE.error.color, fontWeight: 700 }}>{counts.error} errors</span>
          <span style={{ color: SEV_STYLE.warn.color, fontWeight: 700 }}>{counts.warn} warnings</span>
          <span style={{ color: SEV_STYLE.info.color, fontWeight: 700 }}>{counts.info} info</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={run} style={{ fontSize: 12 }}>Re-scan</button>
      </div>
      {issues && issues.length === 0 && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--accent-green, #22c55e)' }}>
          ✓ No issues found — prices, stock, duplicates, and trader references all look valid.
        </div>
      )}
      {issues && issues.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {issues.map((iss, i) => {
            const s = SEV_STYLE[iss.severity];
            return (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 14px', borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${s.color}` }}>
                <span style={{ color: s.color, fontSize: 11, fontWeight: 700, minWidth: 58, textTransform: 'uppercase' }}>{s.label}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13 }}>{iss.message}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, fontFamily: 'var(--font-mono, monospace)' }}>{iss.file}{iss.detail ? ` — ${iss.detail}` : ''}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Import / Export (single .json + bulk ZIP) ──────────────────────
// Category files have an Items[] array; trader files have Currencies/Categories.
function detectFileType(data) {
  if (data && Array.isArray(data.Items)) return 'category';
  if (data && (Array.isArray(data.Currencies) || Array.isArray(data.Categories))) return 'trader';
  return null;
}

async function importOneFile(serverId, fileName, data) {
  const type = detectFileType(data);
  if (!type) throw new Error(`${fileName}: unrecognized (not a market category or trader file)`);
  const base = type === 'category' ? 'categories' : 'traders';
  const name = fileName.endsWith('.json') ? fileName : `${fileName}.json`;
  // NOTE: the API layer returns { error } for non-2xx (it does not throw), so we
  // inspect the response. A create that fails (typically "already exists") is
  // retried as an overwrite via PUT.
  const created = await API.post(`/api/servers/${serverId}/trader-editor/${base}`, { fileName: name, data });
  if (created && created.error) {
    const saved = await API.put(`/api/servers/${serverId}/trader-editor/${base}/${encodeURIComponent(name)}`, { data });
    if (saved && saved.error) throw new Error(`${name}: ${saved.error}`);
  }
  return type;
}

export default function TraderEditorPage({ serverId }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('categories');
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Export every market + trader file as a ZIP (Market/ + Traders/ folders).
  const handleExportAll = async () => {
    setBusy(true);
    try {
      const [cats, trds] = await Promise.all([
        API.get(`/api/servers/${serverId}/trader-editor/categories`).catch(() => []),
        API.get(`/api/servers/${serverId}/trader-editor/traders`).catch(() => []),
      ]);
      const zip = new JSZip();
      (Array.isArray(cats) ? cats : []).forEach((c) => c.data && zip.file(`Market/${c.fileName}`, JSON.stringify(c.data, null, 2)));
      (Array.isArray(trds) ? trds : []).forEach((t) => t.data && zip.file(`Traders/${t.fileName}`, JSON.stringify(t.data, null, 2)));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `market_export_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      window.addToast?.('Exported market + trader files', 'success');
    } catch (err) {
      window.addToast?.(`Export failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Import a single .json or a .zip of many. ZIP entries are routed by content.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm(`Import "${file.name}"? Existing files with the same name will be overwritten (backups are kept on save).`)) return;
    setBusy(true);
    let ok = 0; const errors = [];
    try {
      if (/\.zip$/i.test(file.name)) {
        const zip = await JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter((f) => !f.dir && /\.json$/i.test(f.name));
        for (const entry of entries) {
          try {
            const data = JSON.parse(await entry.async('string'));
            await importOneFile(serverId, entry.name.split('/').pop(), data);
            ok++;
          } catch (err) { errors.push(err.message); }
        }
      } else if (/\.json$/i.test(file.name)) {
        const data = JSON.parse(await file.text());
        await importOneFile(serverId, file.name, data);
        ok++;
      } else {
        throw new Error('Please choose a .json or .zip file');
      }
      setRefreshKey((k) => k + 1); // force the active tab to reload
      window.addToast?.(`Imported ${ok} file(s)${errors.length ? `, ${errors.length} skipped` : ''}`, errors.length ? 'warning' : 'success');
      if (errors.length) console.warn('Market import skips:', errors);
    } catch (err) {
      window.addToast?.(`Import failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap',
      }}>
        <button
          className="btn btn-secondary"
          onClick={() => navigate(`/servers/${serverId}/economy`)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13 }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingCart size={20} /> Trader Editor
          </h2>
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json,.zip" style={{ display: 'none' }} onChange={handleImportFile} />
        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}
          title="Import a .json (single file) or .zip (bulk) — e.g. exported from the official Market Manager"
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13 }}>
          <Upload size={16} /> Import
        </button>
        <button className="btn btn-secondary" onClick={handleExportAll} disabled={busy}
          title="Export all market + trader files as a ZIP"
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13 }}>
          <Download size={16} /> {busy ? 'Working…' : 'Export All'}
        </button>
      </div>

      {/* Tab Bar */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 16,
        borderBottom: '2px solid var(--border)',
      }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '10px 20px', fontSize: 13, fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
                borderBottom: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                marginBottom: -2, transition: 'all 0.15s',
              }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content (refreshKey forces a reload after an import) */}
      {activeTab === 'categories' && <MarketCategoriesTab key={refreshKey} serverId={serverId} />}
      {activeTab === 'traders' && <TradersTab key={refreshKey} serverId={serverId} />}
      {activeTab === 'zones' && <TraderZonesTab serverId={serverId} />}
      {activeTab === 'spawns' && <NPCSpawnsTab serverId={serverId} />}
      {activeTab === 'diagnostics' && <DiagnosticsTab key={refreshKey} serverId={serverId} />}
    </div>
  );
}
