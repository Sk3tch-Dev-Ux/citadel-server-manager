/**
 * Tiny inline hint that renders a keyboard shortcut like ⌘S / Ctrl+S.
 *
 * Use next to labels or buttons so users discover shortcuts without
 * memorizing a separate help page.
 *
 *   <button>Save <ShortcutHint combo="Ctrl+S" /></button>
 *   <span>Search <ShortcutHint combo="Ctrl+K" /></span>
 *
 * On macOS (detected via navigator), `Ctrl` is swapped for `⌘` and `Alt`
 * for `⌥` automatically. Pass `macCombo` to override.
 */
export default function ShortcutHint({ combo, macCombo, style }) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || '');
  const display = (isMac ? (macCombo || combo.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/\+/g, '')) : combo);
  return (
    <kbd
      aria-label={`keyboard shortcut ${combo}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 6px',
        marginLeft: 8,
        fontSize: 11,
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-muted)',
        background: 'var(--bg-surface, rgba(255,255,255,0.04))',
        border: '1px solid var(--border)',
        borderRadius: 4,
        lineHeight: 1.4,
        ...style,
      }}
    >
      {display}
    </kbd>
  );
}
