import { useState, useEffect, useMemo, useCallback } from 'react';
import API from '../api';
import Modal from '../components/ui/Modal';
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts';
import { Search, Save, Plus, Trash2, RefreshCw, Edit, ChevronUp, ChevronDown, X } from '../components/Icon';

// ─── Constants ──────────────────────────────────────────────

const NUMERIC_FIELDS = ['nominal', 'min', 'max', 'lifetime', 'restock', 'saferadius', 'distanceradius', 'cleanupradius'];
const NUMERIC_LABELS = {
  nominal: 'Nominal', min: 'Min', max: 'Max', lifetime: 'Lifetime', restock: 'Restock',
  saferadius: 'Safe Radius', distanceradius: 'Distance Radius', cleanupradius: 'Cleanup Radius',
};
const FLAG_FIELDS = ['deletable', 'init_random', 'remove_damaged'];
const TABLE_COLUMNS = ['name', 'nominal', 'min', 'max', 'lifetime', 'restock', 'position', 'children'];
const COLUMN_LABELS = {
  name: 'Name', nominal: 'Nominal', min: 'Min', max: 'Max', lifetime: 'Lifetime',
  restock: 'Restock', position: 'Position', children: 'Children',
};

const DEFAULT_EVENT = {
  name: '', nominal: 0, min: 0, max: 0, lifetime: 0, restock: 0,
  saferadius: 0, distanceradius: 0, cleanupradius: 0,
  flags: { deletable: 0, init_random: 0, remove_damaged: 0 },
  position: 'fixed', secondary: null, children: [],
};

const DEFAULT_CHILD = { type: '', lootmin: 0, lootmax: 0, min: 0, max: 0 };

const PAGE_SIZE = 100;

// ─── Main Component ─────────────────────────────────────────

export default function EventsEditorPage({ serverId }) {
  // Data state
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filter / sort state
  const [searchText, setSearchText] = useState('');
  const [sortCol, setSortCol] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  // Modal state
  const [editEvent, setEditEvent] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);

  // Pagination
  const [page, setPage] = useState(0);

  // Track which event names have been modified
  const [modifiedNames, setModifiedNames] = useState(new Set());

  // ─── Data Loading ───────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await API.get(`/api/servers/${serverId}/events`);
      if (data.events) {
        setEvents(data.events);
        setModifiedNames(new Set());
      } else if (data.error) {
        window.addToast?.(data.error, 'error');
      }
    } catch (err) {
      window.addToast?.('Failed to load events data', 'error');
    }
    setLoading(false);
  }, [serverId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Filtering & Sorting ───────────────────────────────

  const filtered = useMemo(() => {
    if (!searchText) return events;
    const s = searchText.toLowerCase();
    return events.filter(e => e.name.toLowerCase().includes(s));
  }, [events, searchText]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va, vb;
      if (sortCol === 'children') {
        va = (a.children || []).length;
        vb = (b.children || []).length;
      } else {
        va = a[sortCol];
        vb = b[sortCol];
      }
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      va = String(va || ''); vb = String(vb || '');
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const paged = useMemo(() => sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [sorted, page]);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  useEffect(() => setPage(0), [searchText]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  // ─── Modification Tracking ─────────────────────────────

  const modifiedCount = modifiedNames.size;

  const updateEvent = (name, updated) => {
    setEvents(prev => prev.map(e => e.name === name ? { ...updated } : e));
    setModifiedNames(prev => new Set(prev).add(name));
  };

  // ─── Save ───────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (modifiedNames.size === 0) { window.addToast?.('No changes to save', 'info'); return; }
    setSaving(true);
    try {
      const result = await API.put(`/api/servers/${serverId}/events`, { events });
      if (result.error) { window.addToast?.(result.error, 'error'); }
      else {
        window.addToast?.(`Saved ${result.eventCount} events`, 'success');
        setModifiedNames(new Set());
      }
    } catch { window.addToast?.('Failed to save', 'error'); }
    setSaving(false);
  }, [serverId, events, modifiedNames]);

  useKeyboardShortcuts({ 'ctrl+s': handleSave });

  // ─── Add Event ─────────────────────────────────────────

  const handleAddEvent = async (newEvent) => {
    const result = await API.post(`/api/servers/${serverId}/events/add`, { event: newEvent });
    if (result.error) { window.addToast?.(result.error, 'error'); return false; }
    window.addToast?.(`Added "${newEvent.name}"`, 'success');
    await loadData();
    setShowAddModal(false);
    return true;
  };

  // ─── Delete Event ──────────────────────────────────────

  const handleDeleteEvent = async (event) => {
    const result = await API.del(`/api/servers/${serverId}/events/item?name=${encodeURIComponent(event.name)}`);
    if (result?.error) { window.addToast?.(result.error, 'error'); return; }
    window.addToast?.(`Deleted "${event.name}"`, 'success');
    setEvents(prev => prev.filter(e => e.name !== event.name));
    setModifiedNames(prev => {
      const next = new Set(prev);
      next.delete(event.name);
      return next;
    });
    setShowDeleteConfirm(null);
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="types-editor">
        <div className="types-loading">
          <RefreshCw size={24} className="spin" />
          <span>Loading events data...</span>
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
              placeholder="Search events..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>
          {searchText && (
            <button className="btn btn-sm btn-secondary" onClick={() => setSearchText('')}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
        <div className="types-toolbar-right">
          <span className="types-stats">
            {sorted.length.toLocaleString()} events
            {modifiedCount > 0 && <span className="types-modified-badge">{modifiedCount} modified</span>}
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Add Event
          </button>
          <button className="btn btn-sm btn-secondary" onClick={loadData}>
            <RefreshCw size={14} /> Reload
          </button>
          <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving || modifiedCount === 0}>
            <Save size={14} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="types-table-wrap">
        <table className="types-table">
          <thead>
            <tr>
              {TABLE_COLUMNS.map(col => (
                <th key={col} className={`types-th sortable ${sortCol === col ? 'sorted' : ''}`} onClick={() => handleSort(col)}>
                  {COLUMN_LABELS[col]}
                  {sortCol === col && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </th>
              ))}
              <th className="types-th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((event) => (
              <tr
                key={event.name}
                className={modifiedNames.has(event.name) ? 'modified' : ''}
                onDoubleClick={() => setEditEvent({ ...event, flags: { ...event.flags }, children: event.children.map(c => ({ ...c })) })}
              >
                <td className="types-td-name" title={event.name}>{event.name}</td>
                <td className="types-td-num">{event.nominal}</td>
                <td className="types-td-num">{event.min}</td>
                <td className="types-td-num">{event.max}</td>
                <td className="types-td-num">{event.lifetime}</td>
                <td className="types-td-num">{event.restock}</td>
                <td className="types-td-cat">{event.position}</td>
                <td className="types-td-num">{(event.children || []).length}</td>
                <td className="types-td-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn-icon btn-icon-sm" title="Edit" onClick={() => setEditEvent({ ...event, flags: { ...event.flags }, children: event.children.map(c => ({ ...c })) })}>
                    <Edit size={13} />
                  </button>
                  <button className="btn-icon btn-icon-sm" title="Delete" onClick={() => setShowDeleteConfirm(event)}>
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

      {/* Edit Event Modal */}
      {editEvent && (
        <EditEventModal
          event={editEvent}
          onSave={(updated) => { updateEvent(updated.name, updated); setEditEvent(null); }}
          onClose={() => setEditEvent(null)}
        />
      )}

      {/* Add Event Modal */}
      {showAddModal && (
        <AddEventModal
          onAdd={handleAddEvent}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Delete Confirm */}
      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(null)} title="Delete Event">
          <p style={{ marginBottom: 16 }}>Delete event <strong>{showDeleteConfirm.name}</strong>?</p>
          <p style={{ marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>A backup will be created before deletion.</p>
          <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowDeleteConfirm(null)}>Cancel</button>
            <button className="btn btn-sm btn-danger" onClick={() => handleDeleteEvent(showDeleteConfirm)}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Children Sub-Table ─────────────────────────────────────

function ChildrenEditor({ children, onChange }) {
  const addChild = () => onChange([...children, { ...DEFAULT_CHILD }]);
  const removeChild = (idx) => onChange(children.filter((_, i) => i !== idx));
  const updateChild = (idx, field, value) => {
    const updated = children.map((c, i) => i === idx ? { ...c, [field]: value } : c);
    onChange(updated);
  };

  return (
    <div>
      <table className="types-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Type</th>
            <th>Loot Min</th>
            <th>Loot Max</th>
            <th>Min</th>
            <th>Max</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {children.map((child, idx) => (
            <tr key={idx}>
              <td>
                <input className="input" value={child.type} onChange={e => updateChild(idx, 'type', e.target.value)} placeholder="Type classname" />
              </td>
              <td>
                <input type="number" className="input" value={child.lootmin} onChange={e => updateChild(idx, 'lootmin', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <input type="number" className="input" value={child.lootmax} onChange={e => updateChild(idx, 'lootmax', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <input type="number" className="input" value={child.min} onChange={e => updateChild(idx, 'min', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <input type="number" className="input" value={child.max} onChange={e => updateChild(idx, 'max', parseInt(e.target.value) || 0)} />
              </td>
              <td>
                <button className="btn-icon btn-icon-sm" title="Remove" onClick={() => removeChild(idx)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
          {children.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12 }}>No children defined</td></tr>
          )}
        </tbody>
      </table>
      <button className="btn btn-sm btn-secondary" onClick={addChild}>
        <Plus size={14} /> Add Child
      </button>
    </div>
  );
}

// ─── Edit Event Modal ───────────────────────────────────────

function EditEventModal({ event, onSave, onClose }) {
  const [form, setForm] = useState({ ...event });
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setFlag = (flag, val) => setForm(f => ({ ...f, flags: { ...f.flags, [flag]: val } }));

  return (
    <Modal open onClose={onClose} title={`Edit: ${event.name}`} className="modal-lg types-edit-modal">
      <div className="types-edit-grid">
        {/* Numeric Fields */}
        <div className="types-edit-section">
          <h4>Spawn Values</h4>
          <div className="types-edit-fields">
            {NUMERIC_FIELDS.map(field => (
              <div key={field} className="types-edit-field">
                <label>{NUMERIC_LABELS[field]}</label>
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
                <input type="checkbox" checked={form.flags[flag] === 1} onChange={e => setFlag(flag, e.target.checked ? 1 : 0)} />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        {/* Position */}
        <div className="types-edit-section">
          <h4>Position</h4>
          <input className="input" value={form.position || ''} onChange={e => set('position', e.target.value)} placeholder="e.g. fixed, player" />
        </div>

        {/* Secondary */}
        <div className="types-edit-section">
          <h4>Secondary</h4>
          <input className="input" value={form.secondary || ''} onChange={e => set('secondary', e.target.value || null)} placeholder="Optional secondary type" />
        </div>

        {/* Children */}
        <div className="types-edit-section">
          <h4>Children</h4>
          <ChildrenEditor children={form.children || []} onChange={c => set('children', c)} />
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={() => onSave(form)}>Save Changes</button>
      </div>
    </Modal>
  );
}

// ─── Add Event Modal ────────────────────────────────────────

function AddEventModal({ onAdd, onClose }) {
  const [form, setForm] = useState({ ...DEFAULT_EVENT, flags: { ...DEFAULT_EVENT.flags }, children: [] });
  const [adding, setAdding] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setFlag = (flag, val) => setForm(f => ({ ...f, flags: { ...f.flags, [flag]: val } }));

  const handleSubmit = async () => {
    if (!form.name.trim()) { window.addToast?.('Event name is required', 'error'); return; }
    setAdding(true);
    await onAdd({ ...form, name: form.name.trim() });
    setAdding(false);
  };

  return (
    <Modal open onClose={onClose} title="Add New Event" className="modal-lg types-edit-modal">
      <div className="types-edit-grid">
        <div className="types-edit-section">
          <h4>Event Name</h4>
          <input className="input" placeholder="e.g. StaticHeliCrash" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
        </div>

        <div className="types-edit-section">
          <h4>Spawn Values</h4>
          <div className="types-edit-fields">
            {NUMERIC_FIELDS.map(field => (
              <div key={field} className="types-edit-field">
                <label>{NUMERIC_LABELS[field]}</label>
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
                <input type="checkbox" checked={form.flags[flag] === 1} onChange={e => setFlag(flag, e.target.checked ? 1 : 0)} />
                {flag.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </div>

        <div className="types-edit-section">
          <h4>Position</h4>
          <input className="input" value={form.position || ''} onChange={e => set('position', e.target.value)} placeholder="e.g. fixed, player" />
        </div>

        <div className="types-edit-section">
          <h4>Secondary</h4>
          <input className="input" value={form.secondary || ''} onChange={e => set('secondary', e.target.value || null)} placeholder="Optional secondary type" />
        </div>

        <div className="types-edit-section">
          <h4>Children</h4>
          <ChildrenEditor children={form.children || []} onChange={c => set('children', c)} />
        </div>
      </div>

      <div className="btn-group" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-sm btn-primary" onClick={handleSubmit} disabled={adding}>
          {adding ? 'Adding...' : 'Add Event'}
        </button>
      </div>
    </Modal>
  );
}
