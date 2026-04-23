/**
 * Watchlist — global list of flagged players (cheaters, griefers, staff-watch).
 *
 * When a watched player connects to any server, an in-app notification fires
 * (and webhooks go out to Discord etc). Each entry shows lifetime hit count
 * and last-seen time so admins can tell who's still active vs. stale.
 *
 * Layout:
 *   - Top toolbar: search, tag filter chips, Add + Bulk Delete buttons
 *   - Main table: Name, SteamID, Tags, Reason, Note, Hits, Last Seen, Added, Actions
 *   - Add/Edit modal (shared component)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import API from '../api';
import EmptyState from '../components/ui/EmptyState';
import PageLoader from '../components/PageLoader';
import { useDebouncedValue, timeAgo } from '../utils';
import {
  Eye, Search, Plus, Trash2, X, Edit, AlertTriangle, Tag, RefreshCw, CheckCircle,
} from '../components/Icon';

const TAG_COLORS = {
  cheater: '#ef4444',
  griefer: '#f59e0b',
  staff: '#3b82f6',
  vip: '#a78bfa',
  banned: '#6b7280',
};
function tagColor(t) { return TAG_COLORS[(t || '').toLowerCase()] || '#94a3b8'; }

export default function WatchlistPage() {
  const [entries, setEntries] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [searchText, setSearchText] = useState('');
  const [tagFilter, setTagFilter] = useState(''); // empty = all
  const debouncedSearch = useDebouncedValue(searchText, 200);

  const [selected, setSelected] = useState(new Set());
  const [editorTarget, setEditorTarget] = useState(null); // null = closed, 'new' = create, object = edit

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (tagFilter) params.set('tag', tagFilter);
      const qs = params.toString();
      const data = await API.get(`/api/watchlist${qs ? '?' + qs : ''}`);
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
      setTags(Array.isArray(data?.tags) ? data.tags : []);
    } catch (err) {
      setError(err.message || 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, tagFilter]);

  useEffect(() => { load(); }, [load]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = entries.every((e) => next.has(e.id));
      if (allSelected) entries.forEach((e) => next.delete(e.id));
      else entries.forEach((e) => next.add(e.id));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Remove ${ids.length} watchlist entr${ids.length === 1 ? 'y' : 'ies'}?`)) return;
    try {
      await API.post('/api/watchlist/bulk-delete', { ids });
      window.addToast?.(`Removed ${ids.length} entries`, 'success');
      setSelected(new Set());
      load();
    } catch (err) {
      window.addToast?.(`Bulk delete failed: ${err.message}`, 'error');
    }
  };

  const handleDeleteOne = async (entry) => {
    if (!window.confirm(`Remove ${entry.name} from watchlist?`)) return;
    try {
      await API.del(`/api/watchlist/${entry.id}`);
      window.addToast?.(`Removed ${entry.name}`, 'success');
      load();
    } catch (err) {
      window.addToast?.(`Delete failed: ${err.message}`, 'error');
    }
  };

  const handleSaveEntry = async (data) => {
    try {
      if (editorTarget === 'new') {
        await API.post('/api/watchlist', data);
        window.addToast?.(`Added ${data.name}`, 'success');
      } else {
        await API.patch(`/api/watchlist/${editorTarget.id}`, data);
        window.addToast?.(`Updated ${data.name}`, 'success');
      }
      setEditorTarget(null);
      load();
    } catch (err) {
      window.addToast?.(`Save failed: ${err.message}`, 'error');
    }
  };

  const totalHitCount = useMemo(
    () => entries.reduce((a, e) => a + (e.hitCount || 0), 0),
    [entries]
  );

  if (loading && entries.length === 0) return <PageLoader />;

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Eye size={22} style={{ color: 'var(--accent)' }} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Watchlist</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          {totalHitCount > 0 && <> · <strong style={{ color: '#f59e0b' }}>{totalHitCount} lifetime hits</strong></>}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-secondary" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => setEditorTarget('new')}>
          <Plus size={13} /> Add to Watchlist
        </button>
      </div>

      <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13, maxWidth: 720 }}>
        Flagged players who trigger real-time alerts when they join any of your servers.
        Matches by SteamID (preferred) or name fallback. Entries sync to Discord via webhooks.
      </p>

      {/* Filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            className="input"
            placeholder="Search name, SteamID, reason, note…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ paddingLeft: 30, minWidth: 280 }}
          />
        </div>

        {tags.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              className={`btn btn-xs ${tagFilter === '' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTagFilter('')}
            >
              All
            </button>
            {tags.map((t) => (
              <button
                key={t.name}
                className={`btn btn-xs ${tagFilter === t.name ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTagFilter(tagFilter === t.name ? '' : t.name)}
                style={{
                  borderColor: tagFilter === t.name ? tagColor(t.name) : undefined,
                  color: tagFilter === t.name ? 'white' : tagColor(t.name),
                  background: tagFilter === t.name ? tagColor(t.name) : undefined,
                }}
              >
                <Tag size={10} /> {t.name} ({t.count})
              </button>
            ))}
          </div>
        )}

        {selected.size > 0 && (
          <>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {selected.size} selected
            </span>
            <button className="btn btn-xs btn-danger" onClick={handleBulkDelete}>
              <Trash2 size={12} /> Remove selected
            </button>
            <button className="btn btn-xs btn-ghost" onClick={() => setSelected(new Set())}>
              <X size={12} /> Clear selection
            </button>
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: 12, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 8, color: 'var(--danger)', fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<Eye size={36} />}
          title={debouncedSearch || tagFilter ? 'No matching entries' : 'Watchlist is empty'}
          description={
            debouncedSearch || tagFilter
              ? 'Try clearing filters.'
              : 'Add a flagged player with Add to Watchlist. They\'ll trigger notifications when they join any of your servers.'
          }
          action={
            (debouncedSearch || tagFilter) ? (
              <button className="btn btn-sm btn-ghost" onClick={() => { setSearchText(''); setTagFilter(''); }}>
                <X size={14} /> Clear filters
              </button>
            ) : (
              <button className="btn btn-sm btn-primary" onClick={() => setEditorTarget('new')}>
                <Plus size={14} /> Add first entry
              </button>
            )
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    checked={entries.length > 0 && entries.every((e) => selected.has(e.id))}
                    onChange={selectAllVisible}
                  />
                </th>
                <th>Name</th>
                <th style={{ width: 160 }}>SteamID</th>
                <th style={{ width: 180 }}>Tags</th>
                <th>Reason</th>
                <th style={{ width: 60 }}>Hits</th>
                <th style={{ width: 110 }}>Last seen</th>
                <th style={{ width: 110 }}>Added</th>
                <th style={{ width: 90 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ background: selected.has(e.id) ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined }}>
                  <td>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{e.name}</div>
                    {e.note && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.note}>
                        {e.note}
                      </div>
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>
                    {e.steamId || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                      {(e.tags || []).map((t) => (
                        <span key={t} style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 6px',
                          background: `color-mix(in srgb, ${tagColor(t)} 15%, transparent)`,
                          color: tagColor(t), borderRadius: 3,
                        }}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ fontSize: 12, maxWidth: 240 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.reason}>
                      {e.reason || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </div>
                  </td>
                  <td>
                    {(e.hitCount || 0) > 0 ? (
                      <span style={{ fontWeight: 700, color: '#f59e0b' }}>{e.hitCount}</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>0</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {e.lastSeenAt ? timeAgo(e.lastSeenAt) : <em>never</em>}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {timeAgo(e.addedAt)}
                    {e.addedBy && <div style={{ fontSize: 10 }}>by {e.addedBy}</div>}
                  </td>
                  <td>
                    <button className="btn btn-xs btn-ghost" onClick={() => setEditorTarget(e)} title="Edit">
                      <Edit size={12} />
                    </button>
                    <button className="btn btn-xs btn-ghost" onClick={() => handleDeleteOne(e)} title="Remove" style={{ color: 'var(--danger)' }}>
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editorTarget && (
        <WatchlistEditor
          entry={editorTarget === 'new' ? null : editorTarget}
          existingTags={tags.map((t) => t.name)}
          onCancel={() => setEditorTarget(null)}
          onSave={handleSaveEntry}
        />
      )}
    </div>
  );
}

// ─── Editor modal ──────────────────────────────────────────

function WatchlistEditor({ entry, existingTags, onCancel, onSave }) {
  const [name, setName] = useState(entry?.name || '');
  const [steamId, setSteamId] = useState(entry?.steamId || '');
  const [reason, setReason] = useState(entry?.reason || '');
  const [note, setNote] = useState(entry?.note || '');
  const [tags, setTagsList] = useState(Array.isArray(entry?.tags) ? entry.tags : []);
  const [tagInput, setTagInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const addTag = (t) => {
    const trimmed = (t || '').trim().toLowerCase();
    if (!trimmed) return;
    if (tags.includes(trimmed)) return;
    if (tags.length >= 10) return;
    setTagsList([...tags, trimmed]);
    setTagInput('');
  };

  const removeTag = (t) => setTagsList(tags.filter((x) => x !== t));

  const submit = async () => {
    if (!name.trim()) return window.addToast?.('Name is required', 'error');
    setSubmitting(true);
    await onSave({ name: name.trim(), steamId: steamId.trim(), reason: reason.trim(), note: note.trim(), tags });
    setSubmitting(false);
  };

  return (
    <div role="dialog" onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 20,
        width: '100%', maxWidth: 540, maxHeight: '90vh', overflow: 'auto',
      }}>
        <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Eye size={16} style={{ color: 'var(--accent)' }} />
          {entry ? `Edit watchlist: ${entry.name}` : 'Add to watchlist'}
        </h3>

        <Field label="Name (display)" required>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. StreamSniperDude" style={{ width: '100%' }} />
        </Field>

        <Field label="SteamID (64-bit, recommended for reliable matching)">
          <input className="input" value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="76561198…" style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            Leave blank to match by name only (less reliable — players can rename).
          </div>
        </Field>

        <Field label="Reason (short)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Multi-wipe cheater (report #422)" style={{ width: '100%' }} />
        </Field>

        <Field label="Tags (max 10)">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {tags.map((t) => (
              <span key={t} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 11, fontWeight: 700, padding: '3px 8px',
                background: `color-mix(in srgb, ${tagColor(t)} 15%, transparent)`,
                color: tagColor(t), borderRadius: 4,
              }}>
                {t}
                <button onClick={() => removeTag(t)} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}>
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <input
            className="input"
            list="watchlist-tag-suggestions"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
            placeholder="Type + Enter (cheater, griefer, staff, vip…)"
            style={{ width: '100%' }}
          />
          <datalist id="watchlist-tag-suggestions">
            {['cheater', 'griefer', 'staff', 'vip', 'banned', 'new-player', 'report'].concat(existingTags).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>

        <Field label="Note (private, longer context)">
          <textarea
            className="input"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Detailed context, links to reports, etc. Visible to all admins."
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={submitting || !name.trim()}>
            <CheckCircle size={13} /> {submitting ? 'Saving…' : (entry ? 'Save changes' : 'Add to watchlist')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </label>
      {children}
    </div>
  );
}
