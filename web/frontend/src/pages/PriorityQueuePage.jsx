import { useState, useEffect, useRef } from 'react';
import API from '../api';
import { timeAgo } from '../utils';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { Crown, Plus, Search, Download, Upload, Trash2, Edit, Clock, Infinity } from '../components/Icon';

/** Duration presets for the Add/Edit modal */
const DURATION_PRESETS = [
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
  { label: '1 Year', days: 365 },
  { label: 'Permanent', days: null },
  { label: 'Custom', days: -1 },
];

/** Role options */
const ROLES = ['VIP', 'Supporter', 'Premium'];

/** Role badge colors */
const ROLE_COLORS = {
  VIP: '#f59e0b',
  Supporter: '#8b5cf6',
  Premium: '#ec4899',
};

/** Format expiration display */
function formatExpiry(expiresAt) {
  if (!expiresAt) return { text: 'Permanent', color: 'var(--text-muted)', icon: 'infinity' };
  const now = new Date();
  const exp = new Date(expiresAt);
  const diff = exp - now;
  if (diff <= 0) return { text: 'Expired', color: '#ef4444', icon: 'expired' };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 30) return { text: `${days} days left`, color: 'var(--accent)', icon: 'ok' };
  if (days > 7) return { text: `${days} days left`, color: '#f59e0b', icon: 'warn' };
  if (days > 0) return { text: `${days}d ${hours}h left`, color: '#ef4444', icon: 'warn' };
  return { text: `${hours}h left`, color: '#ef4444', icon: 'warn' };
}

export default function PriorityQueuePage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const { confirm, DialogComponent } = useConfirmDialog();

  // ─── Load entries ──────────────────────────────────────
  const loadEntries = () => {
    API.get('/api/priority-queue')
      .then(d => setEntries(Array.isArray(d) ? d : []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEntries(); }, []);

  // ─── Search filter ─────────────────────────────────────
  const filtered = entries.filter(e => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.name || '').toLowerCase().includes(q) ||
      (e.steamId || '').toLowerCase().includes(q) ||
      (e.role || '').toLowerCase().includes(q) ||
      (e.addedBy || '').toLowerCase().includes(q)
    );
  });

  // ─── Add entry ─────────────────────────────────────────
  const handleAdd = async (data) => {
    try {
      const entry = await API.post('/api/priority-queue', data);
      if (entry.error) { window.addToast?.(entry.error, 'error'); return; }
      setEntries(prev => {
        const idx = prev.findIndex(e => e.steamId === entry.steamId);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = entry; return copy; }
        return [...prev, entry];
      });
      setShowAdd(false);
      window.addToast?.(`${entry.name} added to priority queue`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to add entry', 'error');
    }
  };

  // ─── Update entry ──────────────────────────────────────
  const handleUpdate = async (id, data) => {
    try {
      const entry = await API.patch(`/api/priority-queue/${id}`, data);
      if (entry.error) { window.addToast?.(entry.error, 'error'); return; }
      setEntries(prev => prev.map(e => e.id === id ? entry : e));
      setEditEntry(null);
      window.addToast?.(`${entry.name} updated`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to update entry', 'error');
    }
  };

  // ─── Remove entry ──────────────────────────────────────
  const handleRemove = async (entry) => {
    const ok = await confirm({
      title: `Remove ${entry.name}?`,
      message: `This will remove ${entry.name} (${entry.steamId}) from the priority queue and all server priority.txt files. They will lose VIP access immediately.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await API.del(`/api/priority-queue/${entry.id}`);
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      window.addToast?.(`${entry.name} removed from priority queue`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to remove entry', 'error');
    }
  };

  // ─── Export ────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const data = await API.get('/api/priority-queue/export');
      if (data.error) { window.addToast?.(data.error, 'error'); return; }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `citadel-priority-queue-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      window.addToast?.(`Exported ${data.length} entry(ies)`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Export failed', 'error');
    }
  };

  // ─── Import ────────────────────────────────────────────
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error('File must contain a JSON array');
      const result = await API.post('/api/priority-queue/import', arr);
      if (result.error) { window.addToast?.(result.error, 'error'); return; }
      loadEntries();
      window.addToast?.(`Import complete: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ─── Cleanup expired ──────────────────────────────────
  const handleCleanup = async () => {
    try {
      const result = await API.post('/api/priority-queue/cleanup');
      if (result.error) { window.addToast?.(result.error, 'error'); return; }
      if (result.removed > 0) {
        loadEntries();
        window.addToast?.(`Cleaned ${result.removed} expired entry(ies), ${result.remaining} remaining`, 'success');
      } else {
        window.addToast?.('No expired entries found', 'info');
      }
    } catch (err) {
      window.addToast?.(err.message || 'Cleanup failed', 'error');
    }
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading priority queue...</div>;
  }

  const expiredCount = entries.filter(e => e.expiresAt && new Date(e.expiresAt) < new Date()).length;

  return (
    <div>
      {/* ─── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
            {expiredCount > 0 && <span style={{ color: '#ef4444', marginLeft: 8 }}>({expiredCount} expired)</span>}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {expiredCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={handleCleanup} title="Remove expired entries">
              <Clock size={14} /> Cleanup
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={entries.length === 0} title="Export as JSON">
            <Download size={14} /> Export
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={importing} title="Import from JSON file">
            <Upload size={14} /> {importing ? 'Importing...' : 'Import'}
          </button>
          <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add Entry
          </button>
        </div>
      </div>

      {/* ─── Search ──────────────────────────────────────────── */}
      {entries.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            className="input"
            placeholder="Search by name, Steam ID, or role..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 32 }}
          />
        </div>
      )}

      {/* ─── Content ─────────────────────────────────────────── */}
      {entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon empty-state-icon-large"><Crown size={48} /></div>
          <div className="empty-title">No Priority Queue Entries</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 400, lineHeight: 1.5 }}>
            VIP players added here will be synced to every server's priority.txt file, giving them priority position in the login queue. Add entries manually or import from a JSON file.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No entries match &ldquo;{search}&rdquo;
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Steam ID</th>
                <th>Role</th>
                <th>Added By</th>
                <th>Added</th>
                <th>Expires</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => {
                const expiry = formatExpiry(entry.expiresAt);
                return (
                  <tr key={entry.id} style={expiry.icon === 'expired' ? { opacity: 0.6 } : undefined}>
                    <td style={{ fontWeight: 600 }}>{entry.name || 'Unknown'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{entry.steamId}</td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: `${ROLE_COLORS[entry.role] || '#6b7280'}20`,
                        color: ROLE_COLORS[entry.role] || '#6b7280',
                        border: `1px solid ${ROLE_COLORS[entry.role] || '#6b7280'}40`,
                      }}>
                        {entry.role || 'VIP'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{entry.addedBy || 'system'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(entry.addedAt)}</td>
                    <td>
                      <span style={{ fontSize: 12, color: expiry.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {expiry.icon === 'infinity' && <Infinity size={12} />}
                        {expiry.text}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setEditEntry(entry)}
                          title="Edit entry"
                        >
                          <Edit size={13} />
                        </button>
                        <button
                          className="btn btn-sm btn-danger-ghost"
                          onClick={() => handleRemove(entry)}
                          title="Remove from priority queue"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Add Entry Modal ─────────────────────────────────── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Priority Queue Entry">
        <EntryForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      </Modal>

      {/* ─── Edit Entry Modal ────────────────────────────────── */}
      <Modal open={!!editEntry} onClose={() => setEditEntry(null)} title="Edit Priority Queue Entry">
        {editEntry && (
          <EntryForm
            initial={editEntry}
            onSubmit={(data) => handleUpdate(editEntry.id, data)}
            onCancel={() => setEditEntry(null)}
            isEdit
          />
        )}
      </Modal>

      {DialogComponent}
    </div>
  );
}

// ─── Add / Edit Entry Form ──────────────────────────────
function EntryForm({ initial, onSubmit, onCancel, isEdit = false }) {
  const [steamId, setSteamId] = useState(initial?.steamId || '');
  const [name, setName] = useState(initial?.name || '');
  const [role, setRole] = useState(initial?.role || 'VIP');
  const [durationPreset, setDurationPreset] = useState(
    initial?.expiresAt ? (initial.expiresAt === null ? 'Permanent' : 'Custom') : 'Permanent'
  );
  const [customDate, setCustomDate] = useState(
    initial?.expiresAt ? initial.expiresAt.slice(0, 10) : ''
  );
  const [submitting, setSubmitting] = useState(false);

  // Initialize duration preset from existing entry
  useEffect(() => {
    if (initial?.expiresAt) {
      setDurationPreset('Custom');
      setCustomDate(initial.expiresAt.slice(0, 10));
    } else {
      setDurationPreset('Permanent');
    }
  }, [initial]);

  const computeExpiresAt = () => {
    const preset = DURATION_PRESETS.find(p => p.label === durationPreset);
    if (!preset || preset.days === null) return null; // Permanent
    if (preset.days === -1) {
      // Custom
      if (!customDate) return null;
      return new Date(customDate + 'T23:59:59.999Z').toISOString();
    }
    const d = new Date();
    d.setDate(d.getDate() + preset.days);
    return d.toISOString();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!isEdit && !steamId.trim()) return;
    setSubmitting(true);
    const payload = {
      name: name.trim() || 'Unknown',
      role,
      expiresAt: computeExpiresAt(),
    };
    if (!isEdit) payload.steamId = steamId.trim();
    await onSubmit(payload);
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit}>
      {!isEdit && (
        <div className="input-group">
          <label className="input-label">SteamID64 *</label>
          <input
            className="input"
            placeholder="76561198012345678"
            value={steamId}
            onChange={e => setSteamId(e.target.value)}
            autoFocus
            required
          />
        </div>
      )}
      <div className="input-group">
        <label className="input-label">Player Name</label>
        <input
          className="input"
          placeholder="Player name (optional)"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus={isEdit}
        />
      </div>
      <div className="input-group">
        <label className="input-label">Role</label>
        <select className="input" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="input-group">
        <label className="input-label">Duration</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: durationPreset === 'Custom' ? 8 : 0 }}>
          {DURATION_PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              className={`btn btn-sm ${durationPreset === p.label ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setDurationPreset(p.label)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {durationPreset === 'Custom' && (
          <input
            type="date"
            className="input"
            value={customDate}
            onChange={e => setCustomDate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            style={{ marginTop: 8 }}
          />
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={(!isEdit && !steamId.trim()) || submitting}>
          {submitting ? (isEdit ? 'Saving...' : 'Adding...') : (isEdit ? 'Save Changes' : 'Add Entry')}
        </button>
      </div>
    </form>
  );
}
