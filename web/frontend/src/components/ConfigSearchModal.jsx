import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api';

/**
 * Global Cmd/Ctrl+K Config Search modal — audit N9.
 *
 * What it does
 * ------------
 * Indexes every top-level (and one-deep) field across all DayZ Expansion
 * settings/template JSONs (see GET /api/expansion-docs/field-index, built
 * server-side from backend/schemas/expansion-templates/). The admin hits
 * Cmd/Ctrl+K, types a few characters of a field name they're looking for
 * — e.g. "spawn rate", "raid", "humanity" — and gets a ranked list of
 * matches with file context. Selecting a result navigates to the
 * Expansion editor for the active server and pre-selects the right
 * settings file (and, post N9.4, scrolls/highlights the field).
 *
 * Why
 * ---
 * The Expansion editor sidebar lists 20+ category names; admins waste
 * time clicking through tabs to find which file contains the toggle they
 * need to change. The audit (§5.2) flagged this as the single biggest
 * onboarding-friction lever — "how do I disable raiding" should resolve
 * in seconds, not minutes.
 *
 * Data flow
 * ---------
 * 1. Modal mounts (idle).
 * 2. First Cmd+K opens it and triggers a fetch of /api/expansion-docs/
 *    field-index (~2400 entries on a fresh repo, ~150 KB JSON).
 * 3. Subsequent opens use the cached in-flight/resolved promise.
 * 4. Search is fully client-side: case-insensitive substring with a
 *    light ranking pass (exact match > prefix > contains).
 * 5. Selection navigates: /servers/<id>/expansion?file=<File>&field=<F>.
 *    ExpansionEditorPage reads those params and switches to the right
 *    category.
 *
 * If no server is selected when the modal opens, the first server is
 * used. If no servers exist, the result list is disabled with a hint.
 */

let _indexPromise = null;
function getFieldIndex() {
  if (!_indexPromise) {
    _indexPromise = API.get('/api/expansion-docs/field-index').catch(err => {
      _indexPromise = null;
      throw err;
    });
  }
  return _indexPromise;
}

// Rank a single entry against a normalized query token. Higher = better.
function scoreEntry(entry, q) {
  const f = entry.field.toLowerCase();
  if (f === q) return 1000;
  if (f.startsWith(q)) return 500 - f.length;
  if (f.includes(q)) return 200 - f.length;
  // Fall back to checking parent / file
  if (entry.parent && entry.parent.toLowerCase().includes(q)) return 50;
  if (entry.file.toLowerCase().includes(q)) return 25;
  return 0;
}

function rankResults(index, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const e of index) {
    let total = 0;
    for (const t of tokens) {
      const s = scoreEntry(e, t);
      if (s === 0) { total = 0; break; }
      total += s;
    }
    if (total > 0) scored.push({ entry: e, score: total });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 40).map(s => s.entry);
}

export default function ConfigSearchModal({ open, onClose, serverId }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const navigate = useNavigate();

  // Lazy-load the index on first open
  useEffect(() => {
    if (!open || index) return;
    setLoading(true);
    setError(null);
    getFieldIndex()
      .then(data => { setIndex(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(err => { setError(err.message || 'Failed to load field index'); setLoading(false); });
  }, [open, index]);

  // Reset query + active row each time we re-open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!index) return [];
    return rankResults(index, query);
  }, [index, query]);

  // Clamp active index to results length
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  const selectResult = useCallback((entry) => {
    if (!entry) return;
    if (!serverId) {
      window.addToast?.('No server selected — pick one from the sidebar first.', 'error');
      return;
    }
    onClose();
    const qs = `file=${encodeURIComponent(entry.file)}&field=${encodeURIComponent(entry.field)}`;
    navigate(`/servers/${serverId}/expansion?${qs}`);
  }, [serverId, navigate, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(results[activeIdx]);
      return;
    }
  };

  // Keep active row scrolled into view as the user arrows down
  useEffect(() => {
    if (!listRef.current) return;
    const row = listRef.current.querySelector(`[data-row-idx="${activeIdx}"]`);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '10vh', zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card"
        style={{
          width: 'min(640px, 92vw)', maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', padding: 0,
        }}
        role="dialog"
        aria-label="Config search"
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            className="input"
            placeholder="Search Expansion settings — e.g. 'spawn rate', 'raid', 'humanity'…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            style={{ width: '100%', fontSize: 14 }}
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        <div ref={listRef} style={{ flex: 1, overflow: 'auto', padding: 4 }}>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Loading field index…
            </div>
          )}
          {error && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--accent-red, #e5484d)', fontSize: 12 }}>
              {error}
            </div>
          )}
          {!loading && !error && query.trim().length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Start typing a field name. The index covers every Expansion settings file
              ({index?.length || 0} fields).
            </div>
          )}
          {!loading && !error && query.trim().length > 0 && results.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              No fields match &ldquo;{query}&rdquo;.
            </div>
          )}
          {results.map((r, i) => {
            const breadcrumb = r.parent ? `${r.file} › ${r.parent}` : r.file;
            const isActive = i === activeIdx;
            return (
              <div
                key={`${r.file}|${r.parent || ''}|${r.field}|${i}`}
                data-row-idx={i}
                onMouseDown={(e) => { e.preventDefault(); selectResult(r); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  padding: '8px 12px', cursor: 'pointer', borderRadius: 4,
                  background: isActive ? 'var(--bg-elevated, var(--bg-card))' : 'transparent',
                  borderLeft: isActive ? '2px solid var(--accent-blue)' : '2px solid transparent',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {r.field}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {breadcrumb}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: '8px 16px', borderTop: '1px solid var(--border)',
          fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 16,
        }}>
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
          {!serverId && <span style={{ marginLeft: 'auto', color: 'var(--accent-orange, #f59e0b)' }}>No active server — pick one first.</span>}
        </div>
      </div>
    </div>
  );
}
