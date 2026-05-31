/**
 * ItemPicker — catalog-backed classname input with free-text fallback.
 *
 * Shared by the loadout builder and the market/trader editor. Autocompletes
 * against the server's real item classnames (`/api/servers/:id/items`) but never
 * restricts input — loadouts and markets can reference classes not present in
 * the economy, so any typed value is accepted.
 *
 * Keyboard: ↑/↓ move the highlight, Enter selects it, Esc closes. Exposes
 * combobox/listbox aria roles so it's usable without a mouse and to assistive
 * tech.
 */
import { useState, useMemo, useEffect, useRef, useId } from 'react';

export default function ItemPicker({ value, onChange, catalog, placeholder, options, style, inputStyle }) {
  const [q, setQ] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const listRef = useRef(null);
  useEffect(() => { setQ(value || ''); }, [value]);

  const matches = useMemo(() => {
    if (options) return options;
    if (!q || !catalog?.length) return [];
    const ql = q.toLowerCase();
    return catalog.filter((c) => (c.className || c).toLowerCase().includes(ql)).slice(0, 40);
  }, [q, catalog, options]);

  // Reset the highlight whenever the candidate list changes.
  useEffect(() => { setActive(-1); }, [q, open]);

  const nameOf = (m) => (typeof m === 'string' ? m : m.className);
  const commit = (m) => { const cn = nameOf(m); onChange(cn); setQ(cn); setOpen(false); setActive(-1); };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (!matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { if (active >= 0) { e.preventDefault(); commit(matches[active]); } else { setOpen(false); } }
    else if (e.key === 'Escape') { setOpen(false); setActive(-1); }
  };

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.children[active];
    if (el?.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 120, ...style }}>
      <input
        className="input"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={q}
        placeholder={placeholder || 'ClassName…'}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        style={{ width: '100%', fontSize: 12, padding: '4px 8px', fontFamily: 'var(--font-mono, monospace)', ...inputStyle }}
      />
      {open && matches.length > 0 && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
            maxHeight: 240, overflowY: 'auto', background: 'var(--bg-elevated, var(--bg-deep))',
            border: '1px solid var(--border)', borderRadius: 4, marginTop: 2,
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
          }}>
          {matches.map((m, i) => {
            const cn = nameOf(m);
            const cat = typeof m === 'string' ? '' : m.category;
            const isActive = i === active;
            return (
              <div
                key={cn}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isActive}
                onMouseDown={() => commit(m)}
                onMouseEnter={() => setActive(i)}
                style={{
                  padding: '5px 8px', cursor: 'pointer', fontSize: 12,
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  borderBottom: '1px solid var(--border)',
                  background: isActive ? 'var(--bg-deep)' : 'transparent',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{cn}</span>
                {cat && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{cat}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
