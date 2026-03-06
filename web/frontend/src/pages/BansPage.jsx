import { useState, useEffect, useRef } from 'react';
import API from '../api';
import { timeAgo } from '../utils';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { ShieldBan, Plus, Search, Download, Upload, Copy, Check, Trash2 } from '../components/Icon';

export default function BansPage() {
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const fileRef = useRef(null);
  const { confirm, DialogComponent } = useConfirmDialog();

  // ─── Load global bans ──────────────────────────────────
  useEffect(() => {
    API.get('/api/bans')
      .then(d => setBans(Array.isArray(d) ? d : []))
      .catch(() => setBans([]))
      .finally(() => setLoading(false));
  }, []);

  // ─── Search filter ─────────────────────────────────────
  const filtered = bans.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (b.playerName || '').toLowerCase().includes(q) ||
      (b.steamId || '').toLowerCase().includes(q) ||
      (b.reason || '').toLowerCase().includes(q) ||
      (b.id || '').toLowerCase().includes(q)
    );
  });

  // ─── Add ban ───────────────────────────────────────────
  const handleAdd = async (data) => {
    try {
      const ban = await API.post('/api/bans', data);
      if (ban.error) { window.addToast?.(ban.error, 'error'); return; }
      setBans(prev => {
        // Update if already exists (deduplication)
        const idx = prev.findIndex(b => b.steamId === ban.steamId);
        if (idx >= 0) { const copy = [...prev]; copy[idx] = ban; return copy; }
        return [...prev, ban];
      });
      setShowAdd(false);
      window.addToast?.('Ban added to global database', 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to add ban', 'error');
    }
  };

  // ─── Remove ban ────────────────────────────────────────
  const unban = async (ban) => {
    const ok = await confirm({
      title: `Unban ${ban.playerName}?`,
      message: `This will remove the ban for ${ban.playerName} (${ban.steamId}) from the global database and all server ban.txt files.`,
      confirmLabel: 'Unban',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await API.del(`/api/bans/${ban.id}`);
      setBans(prev => prev.filter(b => b.id !== ban.id));
      window.addToast?.('Ban removed', 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Failed to remove ban', 'error');
    }
  };

  // ─── Export bans ───────────────────────────────────────
  const handleExport = async () => {
    try {
      const data = await API.get('/api/bans/export');
      if (data.error) { window.addToast?.(data.error, 'error'); return; }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `citadel-bans-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      window.addToast?.(`Exported ${data.length} ban(s)`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Export failed', 'error');
    }
  };

  // ─── Import bans ──────────────────────────────────────
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) throw new Error('File must contain a JSON array');
      const result = await API.post('/api/bans/import', arr);
      if (result.error) { window.addToast?.(result.error, 'error'); return; }
      // Reload the full list
      const refreshed = await API.get('/api/bans');
      setBans(Array.isArray(refreshed) ? refreshed : []);
      window.addToast?.(`Import complete: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors`, 'success');
    } catch (err) {
      window.addToast?.(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ─── Copy ban ID to clipboard ─────────────────────────
  const copyId = (id) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading bans...</div>;
  }

  return (
    <div>
      {/* ─── Header ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{bans.length} ban{bans.length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleExport} disabled={bans.length === 0} title="Export bans as JSON">
            <Download size={14} /> Export
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={importing} title="Import bans from JSON file">
            <Upload size={14} /> {importing ? 'Importing...' : 'Import'}
          </button>
          <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add Ban
          </button>
        </div>
      </div>

      {/* ─── Search ────────────────────────────────────────── */}
      {bans.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 16, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            className="input"
            placeholder="Search by name, Steam ID, reason, or ban ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 32 }}
          />
        </div>
      )}

      {/* ─── Content ───────────────────────────────────────── */}
      {bans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon empty-state-icon-large"><ShieldBan size={48} /></div>
          <div className="empty-title">No Active Bans</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>
            Banned players will appear here. Use the Players page to issue bans or add one manually with the button above.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          No bans match &ldquo;{search}&rdquo;
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Steam ID</th>
                <th>Ban ID</th>
                <th>Reason</th>
                <th>Banned By</th>
                <th>Date</th>
                <th style={{ width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 600 }}>{b.playerName || 'Unknown'}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{b.steamId}</td>
                  <td>
                    <span
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => copyId(b.id)}
                      title="Click to copy full ban ID"
                    >
                      {b.id.slice(0, 8)}...
                      {copiedId === b.id ? <Check size={12} style={{ color: 'var(--accent)' }} /> : <Copy size={12} />}
                    </span>
                  </td>
                  <td>{b.reason}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.bannedBy || 'system'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(b.bannedAt)}</td>
                  <td>
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => unban(b)} title="Remove ban">
                      <Trash2 size={13} /> Unban
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Add Ban Modal ─────────────────────────────────── */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Ban">
        <AddBanForm onSubmit={handleAdd} onCancel={() => setShowAdd(false)} />
      </Modal>

      {DialogComponent}
    </div>
  );
}

// ─── Add Ban Form ────────────────────────────────────────
function AddBanForm({ onSubmit, onCancel }) {
  const [steamId, setSteamId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!steamId.trim()) return;
    setSubmitting(true);
    await onSubmit({
      steamId: steamId.trim(),
      playerName: playerName.trim() || 'Unknown',
      reason: reason.trim() || 'Banned',
    });
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit}>
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
      <div className="input-group">
        <label className="input-label">Player Name</label>
        <input
          className="input"
          placeholder="Player name (optional)"
          value={playerName}
          onChange={e => setPlayerName(e.target.value)}
        />
      </div>
      <div className="input-group">
        <label className="input-label">Reason</label>
        <input
          className="input"
          placeholder="Reason for ban"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!steamId.trim() || submitting}>
          {submitting ? 'Adding...' : 'Add Ban'}
        </button>
      </div>
    </form>
  );
}
