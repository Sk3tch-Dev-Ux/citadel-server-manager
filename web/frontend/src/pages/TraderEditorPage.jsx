import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';
import { ArrowLeft, Save, Plus, X, Search, ChevronRight, ChevronDown, ShoppingCart, Trash2, Check, Edit, Copy } from '../components/Icon';

const InteractiveMap = lazy(() => import('../components/InteractiveMap'));

// ─── Constants ──────────────────────────────────────────────────────

const TABS = [
  { id: 'categories', label: 'Market Categories' },
  { id: 'traders', label: 'Traders' },
  { id: 'zones', label: 'Trader Zones' },
  { id: 'spawns', label: 'NPC Spawns' },
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
      const data = await API.get(`/api/servers/${serverId}/trader-editor/categories/${encodeURIComponent(fileName)}`);
      if (data && !data.error) {
        setCategoryData(data);
        setOriginalData(JSON.parse(JSON.stringify(data)));
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
      const result = await API.put(`/api/servers/${serverId}/trader-editor/categories/${encodeURIComponent(selectedFile)}`, categoryData);
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
      await API.delete(`/api/servers/${serverId}/trader-editor/categories/${encodeURIComponent(fileName)}`);
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
    setCategoryData(prev => {
      const items = [...(prev.Items || [])];
      for (const idx of selectedItems) {
        if (items[idx]) {
          const updated = { ...items[idx] };
          if (bulkValues.MinPriceThreshold !== '') updated.MinPriceThreshold = Number(bulkValues.MinPriceThreshold);
          if (bulkValues.MaxPriceThreshold !== '') updated.MaxPriceThreshold = Number(bulkValues.MaxPriceThreshold);
          if (bulkValues.MinStockThreshold !== '') updated.MinStockThreshold = Number(bulkValues.MinStockThreshold);
          if (bulkValues.MaxStockThreshold !== '') updated.MaxStockThreshold = Number(bulkValues.MaxStockThreshold);
          items[idx] = updated;
        }
      }
      return { ...prev, Items: items };
    });
    setBulkMode(false);
    setSelectedItems(new Set());
    setBulkValues({ MinPriceThreshold: '', MaxPriceThreshold: '', MinStockThreshold: '', MaxStockThreshold: '' });
    window.addToast?.(`Updated ${selectedItems.size} items`, 'success');
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
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-blue)' }}>Bulk edit {selectedItems.size} items:</span>
                {[
                  { key: 'MinPriceThreshold', label: 'Min Price' },
                  { key: 'MaxPriceThreshold', label: 'Max Price' },
                  { key: 'MinStockThreshold', label: 'Min Stock' },
                  { key: 'MaxStockThreshold', label: 'Max Stock' },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 2 }}>{f.label}</label>
                    <input className="input" type="number" value={bulkValues[f.key]} onChange={e => setBulkValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder="--" style={{ width: 80, fontSize: 12 }} />
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
                            <input className="input" value={item.ClassName || ''} onChange={e => updateItem(realIdx, 'ClassName', e.target.value)}
                              style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }} />
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
                                          <input className="input" value={att} onChange={e => {
                                            const atts = [...item.SpawnAttachments];
                                            atts[aIdx] = e.target.value;
                                            updateItem(realIdx, 'SpawnAttachments', atts);
                                          }} style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }} />
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
                                          <input className="input" value={variant} onChange={e => {
                                            const vars = [...item.Variants];
                                            vars[vIdx] = e.target.value;
                                            updateItem(realIdx, 'Variants', vars);
                                          }} style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }} />
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
  const [traders, setTraders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [traderData, setTraderData] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showNewTrader, setShowNewTrader] = useState(false);
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
      const data = await API.get(`/api/servers/${serverId}/trader-editor/traders/${encodeURIComponent(fileName)}`);
      if (data && !data.error) {
        setTraderData(data);
        setOriginalData(JSON.parse(JSON.stringify(data)));
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
      const result = await API.put(`/api/servers/${serverId}/trader-editor/traders/${encodeURIComponent(selectedFile)}`, traderData);
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

        <div style={{ overflow: 'auto', flex: 1 }}>
          {traders.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No traders found</div>
          ) : (
            traders.map(trader => {
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
            })
          )}
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
                  <input className="input" value={newCurrency} onChange={e => setNewCurrency(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCurrency()}
                    placeholder="Add currency class..." style={{ flex: 1, fontSize: 13 }} />
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
                  <input className="input" value={newItemOverride.className} onChange={e => setNewItemOverride(prev => ({ ...prev, className: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addItemOverride()}
                    placeholder="ClassName..." style={{ flex: 1, fontSize: 13 }} />
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
  const [zones, setZones] = useState([]);
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
      await API.delete(`/api/servers/${serverId}/trader-editor/zones/${encodeURIComponent(fileName)}`);
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
              mapName="chernarusplus"
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
        }}>
          Zone Details
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
              {zoneIds.map(id => {
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
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Tab 4: NPC Spawns ──────────────────────────────────────────────

function NPCSpawnsTab({ serverId }) {
  const [spawnFiles, setSpawnFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [expandedNpc, setExpandedNpc] = useState(null);

  const loadSpawns = useCallback(async () => {
    setLoading(true);
    try {
      // NPC spawns are typically loaded from the traders endpoint
      const data = await API.get(`/api/servers/${serverId}/trader-editor/traders`);
      if (data && !data.error) {
        const traders = Array.isArray(data) ? data : data.traders || [];
        // Build spawn files from trader data with position info
        const files = traders.map(t => {
          const fileName = typeof t === 'string' ? t : (t.fileName || t.name || t);
          const displayName = typeof t === 'object' ? (t.displayName || t.DisplayName || t.fileName) : t;
          const npcs = typeof t === 'object' ? (t.npcs || t.Traders || []) : [];
          return { fileName, displayName, npcs };
        });
        setSpawnFiles(files);
      }
    } catch {
      window.addToast?.('Failed to load NPC spawns', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadSpawns(); }, [loadSpawns]);

  // Collect all NPCs with positions for map
  const allNpcs = useMemo(() => {
    const result = [];
    spawnFiles.forEach(file => {
      (file.npcs || []).forEach((npc, idx) => {
        if (npc.Position && (npc.Position[0] || npc.Position[2])) {
          result.push({
            id: `${file.fileName}-npc-${idx}`,
            x: npc.Position[0] || 0,
            z: npc.Position[2] || 0,
            label: npc.DisplayName || npc.EntityClass || npc.TraderFile || `NPC ${idx + 1}`,
            color: '#3b82f6',
            file: file.fileName,
            npc,
            idx,
          });
        }
      });
    });
    return result;
  }, [spawnFiles]);

  if (loading) {
    return <div className="card" style={{ padding: 40, textAlign: 'center' }}><span style={{ color: 'var(--text-muted)' }}>Loading NPC spawns...</span></div>;
  }

  return (
    <div>
      {/* Map */}
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{
          padding: '10px 16px', fontWeight: 700, fontSize: 14,
          borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-surface, var(--bg-deep))',
        }}>
          NPC Positions ({allNpcs.length})
        </div>
        <div style={{ padding: 8 }}>
          <Suspense fallback={<div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Loading map...</div>}>
            <InteractiveMap
              mapName="chernarusplus"
              height={500}
              markers={allNpcs.map(n => ({
                id: n.id,
                x: n.x,
                z: n.z,
                label: n.label,
                color: selectedFile && n.file === selectedFile ? '#f59e0b' : '#3b82f6',
              }))}
              selectedId={expandedNpc}
              onSelect={setExpandedNpc}
              mode="view"
            />
          </Suspense>
        </div>
      </div>

      {/* Spawn Files List */}
      <div style={{ display: 'flex', gap: 16, minHeight: 300 }}>
        {/* Sidebar */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '0.05em' }}>
            Spawn Files
          </div>
          {spawnFiles.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No spawn files found</div>
          ) : (
            spawnFiles.map(file => {
              const isActive = selectedFile === file.fileName;
              return (
                <div key={file.fileName} onClick={() => setSelectedFile(isActive ? null : file.fileName)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    background: isActive ? 'var(--accent-blue)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-primary)',
                    transition: 'all 0.15s', marginBottom: 1,
                  }}>
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(file.displayName || file.fileName).replace(/_/g, ' ').replace(/\.json$/i, '')}
                  </span>
                  <Badge count={(file.npcs || []).length} color={isActive ? 'rgba(255,255,255,0.25)' : undefined} />
                </div>
              );
            })
          )}
        </div>

        {/* NPC Details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedFile ? (
            <NoData message="Select a spawn file from the sidebar to view NPCs" />
          ) : (() => {
            const file = spawnFiles.find(f => f.fileName === selectedFile);
            const npcs = file?.npcs || [];
            return (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{
                  padding: '10px 16px', fontWeight: 700, fontSize: 14,
                  borderBottom: '1px solid var(--border)', borderLeft: '3px solid var(--accent-blue)',
                  background: 'var(--bg-surface, var(--bg-deep))',
                }}>
                  NPCs in {String(file?.displayName || selectedFile).replace(/_/g, ' ').replace(/\.json$/i, '')} ({npcs.length})
                </div>
                {npcs.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No NPC spawn data found in this file
                  </div>
                ) : (
                  <table className="table" style={{ width: '100%', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Entity Class</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Trader File</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Position</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Orientation</th>
                        <th style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Gear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {npcs.map((npc, idx) => {
                        const npcId = `${selectedFile}-npc-${idx}`;
                        const isExpanded = expandedNpc === npcId;
                        return (
                          <React.Fragment key={idx}>
                            <tr onClick={() => setExpandedNpc(isExpanded ? null : npcId)}
                              style={{ cursor: 'pointer', background: isExpanded ? 'var(--bg-elevated, var(--bg-deep))' : undefined }}>
                              <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono, monospace)' }}>
                                {npc.EntityClass || npc.ClassName || '-'}
                              </td>
                              <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono, monospace)' }}>
                                {npc.TraderFile || npc.traderFile || '-'}
                              </td>
                              <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', fontSize: 11 }}>
                                {npc.Position ? `${(npc.Position[0] || 0).toFixed(0)}, ${(npc.Position[1] || 0).toFixed(0)}, ${(npc.Position[2] || 0).toFixed(0)}` : '-'}
                              </td>
                              <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-muted)', fontSize: 11 }}>
                                {npc.Orientation ? `${(npc.Orientation[0] || 0).toFixed(0)}, ${(npc.Orientation[1] || 0).toFixed(0)}, ${(npc.Orientation[2] || 0).toFixed(0)}` : '-'}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                                {Array.isArray(npc.Gear) ? `${npc.Gear.length} items` : (npc.Gear || '-')}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr>
                                <td colSpan={5} style={{ padding: 0 }}>
                                  <div style={{ padding: 16, background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                      <div>
                                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Full Position</label>
                                        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, padding: '6px 10px', background: 'var(--bg-elevated, var(--bg-card))', borderRadius: 4, border: '1px solid var(--border)' }}>
                                          {JSON.stringify(npc.Position || [])}
                                        </div>
                                      </div>
                                      <div>
                                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Full Orientation</label>
                                        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, padding: '6px 10px', background: 'var(--bg-elevated, var(--bg-card))', borderRadius: 4, border: '1px solid var(--border)' }}>
                                          {JSON.stringify(npc.Orientation || [])}
                                        </div>
                                      </div>
                                    </div>
                                    {Array.isArray(npc.Gear) && npc.Gear.length > 0 && (
                                      <div style={{ marginTop: 12 }}>
                                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Gear Items</label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                          {npc.Gear.map((g, gIdx) => (
                                            <span key={gIdx} style={{
                                              padding: '3px 8px', borderRadius: 4, fontSize: 11,
                                              background: 'var(--bg-elevated, var(--bg-card))', border: '1px solid var(--border)',
                                              fontFamily: 'var(--font-mono, monospace)',
                                            }}>
                                              {typeof g === 'string' ? g : JSON.stringify(g)}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {npc.Loadout && (
                                      <div style={{ marginTop: 12 }}>
                                        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Loadout</label>
                                        <pre style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, padding: '8px 10px', background: 'var(--bg-elevated, var(--bg-card))', borderRadius: 4, border: '1px solid var(--border)', overflow: 'auto', maxHeight: 200, margin: 0 }}>
                                          {typeof npc.Loadout === 'string' ? npc.Loadout : JSON.stringify(npc.Loadout, null, 2)}
                                        </pre>
                                      </div>
                                    )}
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
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page Component ────────────────────────────────────────────

export default function TraderEditorPage({ serverId }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('categories');

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

      {/* Tab Content */}
      {activeTab === 'categories' && <MarketCategoriesTab serverId={serverId} />}
      {activeTab === 'traders' && <TradersTab serverId={serverId} />}
      {activeTab === 'zones' && <TraderZonesTab serverId={serverId} />}
      {activeTab === 'spawns' && <NPCSpawnsTab serverId={serverId} />}
    </div>
  );
}
