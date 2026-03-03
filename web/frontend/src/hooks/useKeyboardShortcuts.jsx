import { useEffect, useRef, useCallback } from 'react';

/**
 * Global keyboard shortcuts hook.
 *
 * Usage:
 *   useKeyboardShortcuts({
 *     'ctrl+s': (e) => handleSave(),
 *     'ctrl+shift+r': (e) => handleRestart(),
 *     'escape': (e) => handleClose(),
 *   });
 *
 * Returns: { register, unregister } for dynamic shortcut management.
 */
export default function useKeyboardShortcuts(shortcuts = {}) {
  const shortcutsRef = useRef(shortcuts);
  const dynamicRef = useRef({});

  // Keep ref in sync with latest shortcuts object
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function handler(e) {
      const allShortcuts = { ...shortcutsRef.current, ...dynamicRef.current };

      for (const [combo, callback] of Object.entries(allShortcuts)) {
        if (matchesCombo(e, combo)) {
          e.preventDefault();
          e.stopPropagation();
          callback(e);
          return;
        }
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const register = useCallback((combo, callback) => {
    dynamicRef.current[combo.toLowerCase()] = callback;
  }, []);

  const unregister = useCallback((combo) => {
    delete dynamicRef.current[combo.toLowerCase()];
  }, []);

  return { register, unregister };
}

/**
 * Parse a keyboard combo string like "ctrl+shift+s" and check if the event matches.
 */
function matchesCombo(event, combo) {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop();

  const requireCtrl = parts.includes('ctrl') || parts.includes('control');
  const requireShift = parts.includes('shift');
  const requireAlt = parts.includes('alt');
  const requireMeta = parts.includes('meta') || parts.includes('cmd');

  if (event.ctrlKey !== requireCtrl) return false;
  if (event.shiftKey !== requireShift) return false;
  if (event.altKey !== requireAlt) return false;
  if (event.metaKey !== requireMeta) return false;

  const eventKey = event.key.toLowerCase();

  // Handle special key names
  if (key === 'escape' && eventKey === 'escape') return true;
  if (key === 'enter' && eventKey === 'enter') return true;
  if (key === 'space' && eventKey === ' ') return true;
  if (key === 'delete' && eventKey === 'delete') return true;
  if (key === 'backspace' && eventKey === 'backspace') return true;

  return eventKey === key;
}

/**
 * Format a keyboard combo for display.
 * "ctrl+s" -> "Ctrl + S"
 */
export function formatShortcut(combo) {
  return combo.split('+').map(part => {
    const p = part.trim().toLowerCase();
    if (p === 'ctrl' || p === 'control') return 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt') return 'Alt';
    if (p === 'meta' || p === 'cmd') return 'Cmd';
    if (p === 'escape') return 'Esc';
    if (p === 'enter') return 'Enter';
    if (p === 'space') return 'Space';
    return p.toUpperCase();
  }).join(' + ');
}

/**
 * A small React component that renders a keyboard shortcut hint.
 * Usage: <ShortcutHint combo="ctrl+s" />
 */
export function ShortcutHint({ combo }) {
  const parts = combo.split('+').map(part => {
    const p = part.trim().toLowerCase();
    if (p === 'ctrl' || p === 'control') return 'Ctrl';
    if (p === 'shift') return 'Shift';
    if (p === 'alt') return 'Alt';
    if (p === 'meta' || p === 'cmd') return 'Cmd';
    if (p === 'escape') return 'Esc';
    return p.toUpperCase();
  });

  return (
    <span className="kbd-hint">
      {parts.map((p, i) => (
        <kbd key={i}>{p}</kbd>
      ))}
    </span>
  );
}
