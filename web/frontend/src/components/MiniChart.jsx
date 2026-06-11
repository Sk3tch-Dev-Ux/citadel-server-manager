/* global getComputedStyle */
import { useRef, useEffect } from 'react';

/**
 * Resolve a CSS color value (including CSS variables) to a hex string
 * that can be used with the Canvas API.
 */
function resolveColor(cssColor) {
  if (!cssColor || !cssColor.startsWith('var(')) return cssColor;
  const el = document.createElement('div');
  el.style.color = cssColor;
  document.body.appendChild(el);
  const resolved = getComputedStyle(el).color;
  document.body.removeChild(el);
  // Convert rgb(r,g,b) to hex
  const match = resolved.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const hex = '#' + [match[1], match[2], match[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    return hex;
  }
  return cssColor;
}

export default function MiniChart({ data, color = '#6cb4f0', height = 200, label, unit = '%', bandMin, bandMax }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.length === 0) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const cw = canvas.offsetWidth, ch = canvas.offsetHeight;
    ctx.clearRect(0, 0, cw, ch);

    // Resolve CSS variables to hex for canvas compatibility
    const resolvedColor = resolveColor(color);

    // Band series (e.g. FPS min/max within each sample interval) share the
    // main series' scale so the envelope renders around the line.
    const hasBand = bandMin?.length === data.length && bandMax?.length === data.length
      && bandMax.some((v) => v > 0);
    const max = Math.max(...data, ...(hasBand ? bandMax : []), 1);
    const toPoint = (v, i, len) => ({
      x: (i / (len - 1 || 1)) * cw,
      y: ch - (v / max) * (ch - 20) - 10,
    });
    const points = data.map((v, i) => toPoint(v, i, data.length));

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = (ch / 4) * i + 10;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    // Min/max envelope behind the main line
    if (hasBand) {
      const top = bandMax.map((v, i) => toPoint(v, i, bandMax.length));
      const bottom = bandMin.map((v, i) => toPoint(v, i, bandMin.length));
      ctx.beginPath();
      top.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i].x, bottom[i].y);
      ctx.closePath();
      ctx.fillStyle = resolvedColor + '22';
      ctx.fill();
    }

    // Fill
    ctx.beginPath();
    ctx.moveTo(points[0]?.x || 0, ch);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(points[points.length - 1]?.x || cw, ch);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, resolvedColor + '30');
    grad.addColorStop(1, resolvedColor + '05');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = resolvedColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current value
    if (data.length > 0) {
      const last = data[data.length - 1];
      ctx.fillStyle = resolvedColor;
      ctx.font = 'bold 14px Outfit';
      ctx.fillText(`${typeof last === 'number' ? last.toFixed(1) : last}${unit}`, 8, 18);
      if (label) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px Outfit'; ctx.fillText(label, 8, 34); }
    }
  }, [data, color, label, unit, bandMin, bandMax]);

  return (
    <div className="chart-container" style={{ height }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
