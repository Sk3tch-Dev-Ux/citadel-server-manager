import { useState, useEffect, useMemo, useCallback } from 'react';
import API from '../api';

// ─── Constants ──────────────────────────────────────────────

const PAGE_SIZE = 100;

const DEFAULT_TYPE = {
  name: '',
  hoarder: false,
  attachments: [],
  cargo: [],
};

const DEFAULT_GROUP = { chance: 0.50, items: [] };
const DEFAULT_GROUP_ITEM = { name: '', chance: 1.00 };

// ─── Main Component ─────────────────────────────────────────

export default function SpawnableTypesEditorPage({ serverId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [expandedName, setExpandedName] = useState(null);
  const [page, setPage] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [modifiedNames, setModifiedNames] = useState(new Set());

  // ─── Data Loading ───────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/spawnabletypes`);
      if (data.error) {
        window.addToast?.(data.error, 'error');
      } else {
        setItems(data.items || []);
        setModifiedNames(new Set());
      }
    } catch {
      window.addToast?.('Failed to load spawnable types', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Filtering & Pagination ─────────────────────────────

  const filtered = useMemo(() => {
    if (!searchText) return items;
    const s = searchText.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(s));
  }, [items, searchText]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  useEffect(() => setPage(0), [searchText]);

  // ─── Modification Tracking ─────────────────────────────

  const markModified = (name) => {
    setModifiedNames(prev => new Set(prev).add(name));
  };

  const modifiedCount = modifiedNames.size;

  // ─── Inline Editing Helpers ────────────────────────────

  const updateItemField = (name, field, value) => {
    setItems(prev => prev.map(item =>
      item.name === name ? { ...item, [field]: value } : item
    ));
    markModified(name);
  };

  const updateGroup = (typeName, groupType, groupIdx, changes) => {
    setItems(prev => prev.map(item => {
      if (item.name !== typeName) return item;
      const groups = [...item[groupType]];
      groups[groupIdx] = { ...groups[groupIdx], ...changes };
      return { ...item, [groupType]: groups };
    }));
    markModified(typeName);
  };

  const addGroup = (typeName, groupType) => {
    setItems(prev => prev.map(item => {
      if (item.name !== typeName) return item;
      return { ...item, [groupType]: [...item[groupType], { ...DEFAULT_GROUP, items: [] }] };
    }));
    markModified(typeName);
  };

  const removeGroup = (typeName, groupType, groupIdx) => {
    setItems(prev => prev.map(item => {
      if (item.name !== typeName) return item;
      const groups = [...item[groupType]];
      groups.splice(groupIdx, 1);
      return { ...item, [groupType]: groups };
    }));
    markModified(typeName);
  };

  const addGroupItem = (typeName, groupType, groupIdx) => {
    setItems(prev => prev.map(item => {
      if (item.name !== typeName) return item;
      const groups = [...item[groupType]];
      groups[groupIdx] = {
        ...groups[groupIdx],
        items: [...groups[groupIdx].items, { ...DEFAULT_GROUP_ITEM }],
      };
      return { ...item, [groupType]: groups };
    }));
    markModified(typeName);
  };

  const updateGroupItem = (typeName, groupType, groupIdx, itemIdx, changes) => {
    setItems(prev => prev.map(item => {
      if (item.name !== typeName) return item;
      const groups = [...item[groupType]];
      const groupItems = [...groups[groupIdx].items];
      groupItems[itemIdx] = { ...groupItems[itemIdx], ...changes };
      groups[groupIdx] = { ...groups[groupIdx], items: groupItems };
      return { ...item, [groupType]: groups };
    }));
    markModified(typeName);
  };

  const removeGroupItem = (typeName, groupType, groupIdx, itemIdx) => {
    setItems(prev => prev.map(item => {
      if (item.name !== typeName) return item;
      const groups = [...item[groupType]];
      const groupItems = [...groups[groupIdx].items];
      groupItems.splice(itemIdx, 1);
      groups[groupIdx] = { ...groups[groupIdx], items: groupItems };
      return { ...item, [groupType]: groups };
    }));
    markModified(typeName);
  };

  // ─── Save ───────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (modifiedNames.size === 0) {
      window.addToast?.('No changes to save', 'info');
      return;
    }
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/spawnabletypes`, { items });
      if (result.error) {
        window.addToast?.(result.error, 'error');
      } else {
        window.addToast?.(`Saved ${result.itemCount} spawnable types`, 'success');
        setModifiedNames(new Set());
      }
    } catch {
      window.addToast?.('Failed to save', 'error');
    }
    setSaving(false);
  }, [serverId, items, modifiedNames]);

  // Ctrl+S shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // ─── Add Type ───────────────────────────────────────────

  const handleAddType = async (newItem) => {
    try {
      const result = await API.post(`/api/servers/${serverId}/spawnabletypes/add`, { item: newItem });
      if (result.error) {
        window.addToast?.(result.error, 'error');
        return false;
      }
      window.addToast?.(`Added "${newItem.name}"`, 'success');
      await loadData();
      setShowAddModal(false);
      return true;
    } catch {
      window.addToast?.('Failed to add type', 'error');
      return false;
    }
  };

  // ─── Delete Type ────────────────────────────────────────

  const handleDeleteType = async (name) => {
    try {
      const result = await API.del(`/api/servers/${serverId}/spawnabletypes/item?name=${encodeURIComponent(name)}`);
      if (result?.error) {
        window.addToast?.(result.error, 'error');
        return;
      }
      window.addToast?.(`Deleted "${name}"`, 'success');
      setItems(prev => prev.filter(i => i.name !== name));
      setDeleteConfirm(null);
      if (expandedName === name) setExpandedName(null);
    } catch {
      window.addToast?.('Failed to delete type', 'error');
    }
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading spawnable types...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toolbar */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Search by name..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ flex: '1 1 200px', maxWidth: 300 }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          {filtered.length} items
          {modifiedCount > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--warning)', fontWeight: 600 }}>
              {modifiedCount} modified
            </span>
          )}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => setShowAddModal(true)}>
            + Add Type
          </button>
          <button className="btn btn-secondary" onClick={loadData}>
            Reload
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || modifiedCount === 0}
          >
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'auto' }}>
        <table className="table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '35%' }}>Name</th>
              <th style={{ width: '12%', textAlign: 'center' }}>Hoarder</th>
              <th style={{ width: '15%', textAlign: 'center' }}>Attachment Groups</th>
              <th style={{ width: '15%', textAlign: 'center' }}>Cargo Groups</th>
              <th style={{ width: '23%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map(item => (
              <SpawnableTypeRow
                key={item.name}
                item={item}
                expanded={expandedName === item.name}
                modified={modifiedNames.has(item.name)}
                onToggleExpand={() => setExpandedName(expandedName === item.name ? null : item.name)}
                onToggleHoarder={() => updateItemField(item.name, 'hoarder', !item.hoarder)}
                onUpdateGroup={(groupType, groupIdx, changes) => updateGroup(item.name, groupType, groupIdx, changes)}
                onAddGroup={(groupType) => addGroup(item.name, groupType)}
                onRemoveGroup={(groupType, groupIdx) => removeGroup(item.name, groupType, groupIdx)}
                onAddGroupItem={(groupType, groupIdx) => addGroupItem(item.name, groupType, groupIdx)}
                onUpdateGroupItem={(groupType, groupIdx, itemIdx, changes) => updateGroupItem(item.name, groupType, groupIdx, itemIdx, changes)}
                onRemoveGroupItem={(groupType, groupIdx, itemIdx) => removeGroupItem(item.name, groupType, groupIdx, itemIdx)}
                onDelete={() => setDeleteConfirm(item.name)}
              />
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                  {searchText ? 'No matching spawnable types found.' : 'No spawnable types loaded.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</button>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page {page + 1} of {totalPages}</span>
          <button className="btn btn-secondary" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <AddTypeModal
          onAdd={handleAddType}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>Delete Spawnable Type</h3>
            <p>Are you sure you want to delete <strong>{deleteConfirm}</strong>?</p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>A backup will be created before deletion.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDeleteType(deleteConfirm)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row Component ──────────────────────────────────────────

function SpawnableTypeRow({
  item, expanded, modified,
  onToggleExpand, onToggleHoarder,
  onUpdateGroup, onAddGroup, onRemoveGroup,
  onAddGroupItem, onUpdateGroupItem, onRemoveGroupItem,
  onDelete,
}) {
  return (
    <>
      <tr
        onClick={onToggleExpand}
        style={{
          cursor: 'pointer',
          background: modified ? 'var(--warning-bg, rgba(255, 193, 7, 0.08))' : undefined,
        }}
      >
        <td style={{ fontWeight: 500 }}>
          <span style={{ marginRight: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {expanded ? '\u25BC' : '\u25B6'}
          </span>
          {item.name}
          {modified && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--warning)', fontWeight: 700 }}>*</span>}
        </td>
        <td style={{ textAlign: 'center' }}>
          {item.hoarder && (
            <span style={{
              display: 'inline-block', padding: '2px 8px', fontSize: 11, fontWeight: 600,
              borderRadius: 4, background: 'var(--accent-bg, rgba(99, 102, 241, 0.15))', color: 'var(--accent, #6366f1)',
            }}>
              HOARDER
            </span>
          )}
        </td>
        <td style={{ textAlign: 'center' }}>{item.attachments?.length || 0}</td>
        <td style={{ textAlign: 'center' }}>{item.cargo?.length || 0}</td>
        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
          <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onDelete}>
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <ExpandedDetails
              item={item}
              onToggleHoarder={onToggleHoarder}
              onUpdateGroup={onUpdateGroup}
              onAddGroup={onAddGroup}
              onRemoveGroup={onRemoveGroup}
              onAddGroupItem={onAddGroupItem}
              onUpdateGroupItem={onUpdateGroupItem}
              onRemoveGroupItem={onRemoveGroupItem}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Expanded Details ───────────────────────────────────────

function ExpandedDetails({
  item, onToggleHoarder,
  onUpdateGroup, onAddGroup, onRemoveGroup,
  onAddGroupItem, onUpdateGroupItem, onRemoveGroupItem,
}) {
  return (
    <div style={{ padding: '16px 24px', background: 'var(--surface-raised, rgba(0,0,0,0.02))', borderTop: '1px solid var(--border)' }}>
      {/* Hoarder toggle */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
          <input type="checkbox" checked={item.hoarder} onChange={onToggleHoarder} />
          Hoarder
        </label>
      </div>

      {/* Attachment Groups */}
      <GroupEditor
        title="Attachment Groups"
        groups={item.attachments || []}
        groupType="attachments"
        onUpdateGroup={onUpdateGroup}
        onAddGroup={onAddGroup}
        onRemoveGroup={onRemoveGroup}
        onAddGroupItem={onAddGroupItem}
        onUpdateGroupItem={onUpdateGroupItem}
        onRemoveGroupItem={onRemoveGroupItem}
      />

      {/* Cargo Groups */}
      <GroupEditor
        title="Cargo Groups"
        groups={item.cargo || []}
        groupType="cargo"
        onUpdateGroup={onUpdateGroup}
        onAddGroup={onAddGroup}
        onRemoveGroup={onRemoveGroup}
        onAddGroupItem={onAddGroupItem}
        onUpdateGroupItem={onUpdateGroupItem}
        onRemoveGroupItem={onRemoveGroupItem}
      />
    </div>
  );
}

// ─── Group Editor ───────────────────────────────────────────

function GroupEditor({
  title, groups, groupType,
  onUpdateGroup, onAddGroup, onRemoveGroup,
  onAddGroupItem, onUpdateGroupItem, onRemoveGroupItem,
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>{title} ({groups.length})</h4>
        <button
          className="btn btn-secondary"
          style={{ padding: '3px 10px', fontSize: 12 }}
          onClick={() => onAddGroup(groupType)}
        >
          + Add Group
        </button>
      </div>

      {groups.length === 0 && (
        <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          No {groupType} groups defined.
        </div>
      )}

      {groups.map((group, gIdx) => (
        <div
          key={gIdx}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 8,
            background: 'var(--surface, #fff)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 500 }}>Group Chance:</label>
            <input
              type="number"
              className="input"
              min="0" max="1" step="0.01"
              value={group.chance}
              onChange={e => onUpdateGroup(groupType, gIdx, { chance: parseFloat(e.target.value) || 0 })}
              style={{ width: 80 }}
            />
            <button
              className="btn btn-secondary"
              style={{ padding: '3px 10px', fontSize: 12 }}
              onClick={() => onAddGroupItem(groupType, gIdx)}
            >
              + Item
            </button>
            <button
              className="btn btn-danger"
              style={{ padding: '3px 10px', fontSize: 12, marginLeft: 'auto' }}
              onClick={() => onRemoveGroup(groupType, gIdx)}
            >
              Remove Group
            </button>
          </div>

          {group.items.length > 0 && (
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>Item Name</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500, width: 100 }}>Chance</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((it, iIdx) => (
                  <tr key={iIdx} style={{ borderBottom: '1px solid var(--border-light, var(--border))' }}>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        className="input"
                        value={it.name}
                        onChange={e => onUpdateGroupItem(groupType, gIdx, iIdx, { name: e.target.value })}
                        placeholder="Item classname"
                        style={{ width: '100%', fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        className="input"
                        min="0" max="1" step="0.01"
                        value={it.chance}
                        onChange={e => onUpdateGroupItem(groupType, gIdx, iIdx, { chance: parseFloat(e.target.value) || 0 })}
                        style={{ width: 80, fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={() => onRemoveGroupItem(groupType, gIdx, iIdx)}
                      >
                        X
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {group.items.length === 0 && (
            <div style={{ padding: '4px 0', color: 'var(--text-muted)', fontSize: 12 }}>
              No items in this group. Click "+ Item" to add one.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Add Type Modal ─────────────────────────────────────────

function AddTypeModal({ onAdd, onClose }) {
  const [name, setName] = useState('');
  const [hoarder, setHoarder] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.addToast?.('Type name is required', 'error');
      return;
    }
    setAdding(true);
    await onAdd({
      ...DEFAULT_TYPE,
      name: trimmed,
      hoarder,
    });
    setAdding(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, padding: 24 }}>
        <h3 style={{ marginTop: 0 }}>Add Spawnable Type</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, fontWeight: 500 }}>Type Name</label>
            <input
              className="input"
              placeholder="e.g. AKM"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              style={{ width: '100%' }}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
            <input type="checkbox" checked={hoarder} onChange={e => setHoarder(e.target.checked)} />
            Hoarder
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={adding}>
            {adding ? 'Adding...' : 'Add Type'}
          </button>
        </div>
      </div>
    </div>
  );
}
