/**
 * ItemPicker — catalog-backed classname input with free-text fallback.
 *
 * Shared by the loadout builder and the market/trader editor. Autocompletes
 * against the server's real item classnames (`/api/servers/:id/items`) but never
 * restricts input — loadouts and markets can reference classes not present in
 * the economy, so any typed value is accepted.
 */
import { useState, useMemo, useEffect } from 'react';

export default function ItemPicker({ value, onChange, catalog, placeholder, options, style, inputStyle }) {
  const [q, setQ] = useState(value || '');
  const [open, setOpen] = useState(false);
  useEffect(() => { setQ(value || ''); }, [value]);

  const matches = useMemo(() => {
    if (options) return options;
    if (!q || !catalog?.length) return [];
    const ql = q.toLowerCase();
    return catalog.filter((c) => (c.className || c).toLowerCase().includes(ql)).slice(0, 40);
  }, [q, catalog, options]);

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 120, ...style }}>
      <input
        className="input"
        value={q}
        placeholder={placeholder || 'ClassName…'}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ width: '100%', fontSize: 12, padding: '4px 8px', fontFamily: 'var(--font-mono, monospace)', ...inputStyle }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          maxHeight: 240, overflowY: 'auto', background: 'var(--bg-elevated, var(--bg-deep))',
          border: '1px solid var(--border)', borderRadius: 4, marginTop: 2,
          boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
        }}>
          {matches.map((m) => {
            const cn = typeof m === 'string' ? m : m.className;
            const cat = typeof m === 'string' ? '' : m.category;
            return (
              <div
                key={cn}
                onMouseDown={() => { onChange(cn); setQ(cn); setOpen(false); }}
                style={{ padding: '5px 8px', cursor: 'pointer', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8, borderBottom: '1px solid var(--border)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-deep)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
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
