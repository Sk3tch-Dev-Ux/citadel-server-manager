import { useState, useEffect, useRef } from 'react';
import API from '../api';
import { timeAgo } from '../utils';
import { useConfirmDialog } from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { ShieldBan, Plus, Search, Download, Upload, Copy, Check, Trash2, Sparkles, ExternalLink } from '../components/Icon';
import useLicenseStatus from '../hooks/useLicenseStatus';
import CFToolsImportModal from '../components/CFToolsImportModal';

// Phase 3 — community ban categories. Mirrors the allowlist on both
// backend/routes/bans.routes.js and the citadels.cc cloud-bans.routes.ts.
const COMMUNITY_REASON_CATEGORIES = [
  { value: 'cheating',   label: 'Cheating',   hint: 'Aimbot, ESP, exploits in code or executables' },
  { value: 'griefing',   label: 'Griefing',   hint: 'Spawn-killing, base-killing, intentional toxicity' },
  { value: 'exploiting', label: 'Exploiting', hint: 'Dupe glitches, map exploits, unintended mechanics' },
  { value: 'other',      label: 'Other',      hint: 'Anything else worth network-banning' },
];

// ─── Ban File Parsers ────────────────────────────────────

const STEAM_ID_RE = /^7656\d{13,}$/;

const STEAM_ID_HEADERS = ['steamid', 'steam_id', 'steamid64', 'identifier', 'steam', 'guid', 'id'];
const NAME_HEADERS = ['playername', 'player_name', 'name', 'player', 'username'];
const REASON_HEADERS = ['reason', 'ban_reason', 'banreason', 'note', 'notes'];

/** Parse a CSV row respecting quoted fields */
function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

/** Find the index of a column by checking against known header names */
function findColumn(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate.replace(/[^a-z0-9]/g, ''));
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Parse a ban file into a standard array of { steamId, playerName, reason }.
 * Supports JSON, CSV, and TXT (plain Steam ID list).
 */
function parseBanFile(text, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();

  // ─── JSON ─────────────────────────────────────────────
  if (ext === 'json') {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('JSON file must contain an array');
    return { format: 'JSON', entries: data.filter(e => e.steamId) };
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('File is empty');

  // ─── CSV ──────────────────────────────────────────────
  if (ext === 'csv') {
    const headers = parseCSVRow(lines[0]);
    const steamCol = findColumn(headers, STEAM_ID_HEADERS);
    if (steamCol < 0) {
      // Fallback: check if first column values look like Steam IDs
      if (lines.length > 1 && STEAM_ID_RE.test(parseCSVRow(lines[1])[0])) {
        // No header match but first col is Steam IDs — treat col 0 as steamId
        const entries = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVRow(lines[i]);
          const steamId = cols[0]?.trim();
          if (steamId && STEAM_ID_RE.test(steamId)) {
            entries.push({ steamId, playerName: cols[1]?.trim() || 'Unknown', reason: cols[2]?.trim() || 'Imported' });
          }
        }
        return { format: 'CSV', entries };
      }
      throw new Error('Could not find a Steam ID column in CSV headers');
    }
    const nameCol = findColumn(headers, NAME_HEADERS);
    const reasonCol = findColumn(headers, REASON_HEADERS);
    const entries = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      const steamId = cols[steamCol]?.trim();
      if (!steamId || !STEAM_ID_RE.test(steamId)) continue;
      entries.push({
        steamId,
        playerName: (nameCol >= 0 ? cols[nameCol]?.trim() : '') || 'Unknown',
        reason: (reasonCol >= 0 ? cols[reasonCol]?.trim() : '') || 'Imported',
      });
    }
    return { format: 'CSV', entries };
  }

  // ─── TXT (Steam ID list) ─────────────────────────────
  const steamIds = lines.filter(l => STEAM_ID_RE.test(l));
  if (steamIds.length > 0) {
    return {
      format: 'TXT',
      entries: steamIds.map(id => ({ steamId: id, playerName: 'Unknown', reason: 'Imported' })),
    };
  }

  // ─── Fallback: try JSON parse ─────────────────────────
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return { format: 'JSON', entries: data.filter(e => e.steamId) };
  } catch { /* not JSON */ }

  throw new Error('Could not detect file format. Supported: JSON, CSV, or TXT (one Steam ID per line)');
}

export default function BansPage() {
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { filename, format, entries, newCount, dupeCount }
  const [showCFToolsImport, setShowCFToolsImport] = useState(false);
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

  // ─── Import bans (multi-format: JSON, CSV, TXT) ──────
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { format, entries } = parseBanFile(text, file.name);
      if (entries.length === 0) { window.addToast?.('No valid Steam IDs found in file', 'error'); return; }
      // Count duplicates against existing bans
      const existingIds = new Set(bans.map(b => b.steamId));
      const newCount = entries.filter(e => !existingIds.has(e.steamId)).length;
      const dupeCount = entries.length - newCount;
      setImportPreview({ filename: file.name, format, entries, newCount, dupeCount });
    } catch (err) {
      window.addToast?.(err.message || 'Failed to read file', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const executeImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const result = await API.post('/api/bans/import', importPreview.entries);
      if (result.error) { window.addToast?.(result.error, 'error'); return; }
      const refreshed = await API.get('/api/bans');
      setBans(Array.isArray(refreshed) ? refreshed : []);
      window.addToast?.(`Import complete: ${result.added} added, ${result.skipped} skipped, ${result.errors} errors`, 'success');
      setImportPreview(null);
    } catch (err) {
      window.addToast?.(err.message || 'Import failed', 'error');
    } finally {
      setImporting(false);
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
          <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={importing} title="Import bans from JSON, CSV, or TXT file">
            <Upload size={14} /> {importing ? 'Importing...' : 'Import file'}
          </button>
          <input ref={fileRef} type="file" accept=".json,.csv,.txt" onChange={handleFileSelect} style={{ display: 'none' }} />
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowCFToolsImport(true)}
            title="Import an existing banlist from CFTools Cloud via their API"
          >
            <ExternalLink size={14} /> From CFTools
          </button>
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
          {/* Audit N8 — mobile-card-table converts to stacked cards below 600px. */}
          <table className="mobile-card-table">
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
                  <td data-label="Steam ID" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{b.steamId}</td>
                  <td data-label="Ban ID">
                    <span
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                      onClick={() => copyId(b.id)}
                      title="Click to copy full ban ID"
                    >
                      {b.id.slice(0, 8)}...
                      {copiedId === b.id ? <Check size={12} style={{ color: 'var(--accent)' }} /> : <Copy size={12} />}
                    </span>
                  </td>
                  <td data-label="Reason">{b.reason}</td>
                  <td data-label="Banned By" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.bannedBy || 'system'}</td>
                  <td data-label="Date" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeAgo(b.bannedAt)}</td>
                  <td data-label="Actions">
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

      {/* ─── Import Preview Modal ──────────────────────────── */}
      <Modal open={!!importPreview} onClose={() => setImportPreview(null)} title="Import Bans">
        {importPreview && (
          <div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>File</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{importPreview.filename}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Format</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{importPreview.format}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Total entries</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{importPreview.entries.length}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>New bans</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>{importPreview.newCount}</span>
              </div>
              {importPreview.dupeCount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-surface)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Already banned (will skip)</span>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{importPreview.dupeCount}</span>
                </div>
              )}
            </div>
            {importPreview.newCount === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 16 }}>
                All entries in this file are already in your ban database.
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setImportPreview(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={executeImport} disabled={importing || importPreview.newCount === 0}>
                {importing ? 'Importing...' : `Import ${importPreview.newCount} Ban${importPreview.newCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── CFTools Import Modal ───────────────────────────── */}
      <CFToolsImportModal
        open={showCFToolsImport}
        onClose={() => setShowCFToolsImport(false)}
        onImported={async () => {
          // Refresh the local ban list after a successful CFTools import.
          try {
            const refreshed = await API.get('/api/bans');
            setBans(Array.isArray(refreshed) ? refreshed : []);
          } catch {
            // The toast in the modal already reported the result; failure
            // to refresh is purely a UI-staleness issue.
          }
        }}
      />

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

  // Phase 3 — community-DB submission. Gated specifically on the Cloud
  // add-on entitlement (NOT just an active Citadel sub). A customer with
  // base Citadel but no Cloud doesn't see the toggle — they have nothing
  // to submit to.
  //
  // Defaults ON for active Cloud subscribers (every ban issued is
  // reasonable to share by default; unchecking is the explicit "this is
  // sensitive, don't share" affordance).
  const { hasCloud } = useLicenseStatus();
  const [submitToCommunity, setSubmitToCommunity] = useState(true);
  const [reasonCategory, setReasonCategory] = useState('cheating');

  const submit = async (e) => {
    e.preventDefault();
    if (!steamId.trim()) return;
    setSubmitting(true);
    const payload = {
      steamId: steamId.trim(),
      playerName: playerName.trim() || 'Unknown',
      reason: reason.trim() || 'Banned',
    };
    if (hasCloud && submitToCommunity) {
      payload.submitToCommunity = true;
      payload.reasonCategory = reasonCategory;
    }
    await onSubmit(payload);
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
          placeholder="Reason for ban (kept private to your account)"
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </div>

      {/* Phase 3 — Citadel Cloud submission section. Shown only to
          customers with the Cloud add-on entitlement. Citadel subscribers
          on the base plan don't see this toggle — they're not paying for
          the network membership and shouldn't be confused by it. */}
      {hasCloud && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            background: 'color-mix(in srgb, var(--accent) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
            borderRadius: 8,
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={submitToCommunity}
              onChange={(e) => setSubmitToCommunity(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <Sparkles size={14} style={{ color: 'var(--accent)' }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              Submit to Citadel Cloud community ban DB
            </span>
          </label>
          <p style={{ margin: '6px 0 0 28px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Your reason text above stays private to your account. Other Citadel Cloud
            servers will see only the SteamID and category below — and only after at
            least 3 customers independently ban this player.
          </p>

          {submitToCommunity && (
            <div style={{ marginTop: 12 }}>
              <label className="input-label" style={{ marginBottom: 6, display: 'block' }}>
                Category
              </label>
              <select
                className="input"
                value={reasonCategory}
                onChange={(e) => setReasonCategory(e.target.value)}
                style={{ width: '100%' }}
              >
                {COMMUNITY_REASON_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} — {c.hint}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!steamId.trim() || submitting}>
          {submitting ? 'Adding...' : 'Add Ban'}
        </button>
      </div>
    </form>
  );
}
