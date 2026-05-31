/**
 * useDragReorder — lightweight native HTML5 drag-to-reorder for lists.
 *
 * No dependency. Returns:
 *   handleProps(i) — spread onto a small drag handle (the only draggable bit, so
 *                    inputs in the row stay usable);
 *   rowProps(i)    — spread onto the row container (the drop target);
 *   overIndex      — the row currently hovered during a drag (for a drop hint);
 *   dragging       — whether a drag is in progress.
 *
 * Pass an onReorder(fromIndex, toIndex) that produces the reordered list.
 */
import { useState, useRef } from 'react';

/** Pure helper: return a copy of `arr` with the item at `from` moved to `to`. */
export function move(arr, from, to) {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function useDragReorder(onReorder) {
  const fromRef = useRef(null);
  const [overIndex, setOverIndex] = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleProps = (i) => ({
    draggable: true,
    onDragStart: (e) => {
      fromRef.current = i;
      setDragging(true);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* some browsers */ }
    },
    onDragEnd: () => { fromRef.current = null; setDragging(false); setOverIndex(null); },
    style: { cursor: 'grab' },
    title: 'Drag to reorder',
  });

  const rowProps = (i) => ({
    onDragOver: (e) => {
      if (fromRef.current == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overIndex !== i) setOverIndex(i);
    },
    onDragLeave: () => { if (overIndex === i) setOverIndex(null); },
    onDrop: (e) => {
      e.preventDefault();
      const from = fromRef.current;
      if (from != null && from !== i) onReorder(from, i);
      fromRef.current = null;
      setOverIndex(null);
      setDragging(false);
    },
  });

  return { handleProps, rowProps, overIndex, dragging };
}

/** A tiny CSS drag-grip glyph (no icon dependency). Spread handleProps onto it. */
export function gripStyle(extra) {
  return {
    color: 'var(--text-muted)', fontSize: 13, lineHeight: 1, userSelect: 'none',
    padding: '0 2px', cursor: 'grab', ...extra,
  };
}
