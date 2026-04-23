/* global getComputedStyle */
import { useRef, useEffect } from 'react';

/**
 * Lightweight horizontal bar chart rendered to canvas — matches MiniChart's
 * visual style (no chart-lib dependency). Each datum is `{ label, value }`.
 * Values are normalized to the largest bar; labels sit on the left, counts
 * on the right.
 *
 *   <BarChart data={[{ label: 'M4A1', value: 42 }, ...]} />
 */
function resolveColor(cssColor) {
  if (!cssColor || !cssColor.startsWith('var(')) return cssColor;
  const el = document.createElement('div');
  el.style.color = cssColor;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.body.removeChild(el);
  const match = resolved.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return '#' + [match[1], match[2], match[3]].map((n) => parseInt(n).toString(16).padStart(2, '0')).join('');
  }
  return cssColor;
}

export default function BarChart({ data, color = 'var(--accent)', height, formatValue }) {
  const canvasRef = useRef(null);
  const rows = Array.isArray(data) ? data.slice(0, 20) : [];
  const computedHeight = height || Math.max(60, rows.length * 28 + 16);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    if (rows.length === 0) return;

    const resolvedColor = resolveColor(color);
    const max = Math.max(...rows.map((r) => r.value), 1);
    const rowH = ch / rows.length;
    const labelW = Math.min(140, cw * 0.35);
    const valueW = 60;
    const barStartX = labelW + 8;
    const barMaxW = cw - barStartX - valueW - 8;

    ctx.font = '12px Outfit, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    rows.forEach((row, i) => {
      const y = i * rowH + rowH / 2;
      const barW = (row.value / max) * barMaxW;

      // Label (truncate with ellipsis)
      ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.textAlign = 'right';
      const labelText = row.label || '—';
      ctx.fillText(labelText.length > 18 ? labelText.slice(0, 17) + '…' : labelText, labelW, y);

      // Bar background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(barStartX, y - rowH / 2 + 8, barMaxW, rowH - 16);

      // Bar fill (with subtle gradient)
      const grad = ctx.createLinearGradient(barStartX, 0, barStartX + barW, 0);
      grad.addColorStop(0, resolvedColor + 'cc');
      grad.addColorStop(1, resolvedColor + '88');
      ctx.fillStyle = grad;
      ctx.fillRect(barStartX, y - rowH / 2 + 8, Math.max(2, barW), rowH - 16);

      // Value
      ctx.fillStyle = 'rgba(226, 232, 240, 0.9)';
      ctx.textAlign = 'left';
      ctx.fillText(formatValue ? formatValue(row.value) : String(row.value), barStartX + barW + 6, y);
    });
  }, [rows, color, formatValue]);

  if (rows.length === 0) {
    return (
      <div style={{
        height: computedHeight, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)', fontSize: 12, fontStyle: 'italic',
      }}>No data yet</div>
    );
  }

  return (
    <div style={{ height: computedHeight }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
