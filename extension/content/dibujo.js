// Grabazo — dibujo y anotación sobre la página (mundo aislado).
// Lienzo del tamaño de la ventana con lápiz, resaltador, flechas, rectángulos, elipses,
// texto y borrador. Cada trazo es un objeto (se puede borrar, deshacer y rehacer) y se
// dibuja nítido en pantallas de alta densidad. Lo usa content/capa.js.

(() => {
  'use strict';
  const parts = (globalThis.__grabazoParts ||= {});
  if (parts.dibujo) return;

  const CSS = `
    .draw { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; touch-action: none; }
    .draw.on { pointer-events: auto; cursor: crosshair; }
    .draw.on.pen { cursor: var(--pen-cursor, crosshair); }
    .draw.on.eraser { cursor: var(--eraser-cursor, cell); }
    .draw.on.text { cursor: text; }
    .draw-text {
      position: fixed; z-index: 3; min-width: 40px; margin: 0; padding: 2px 4px; border: 1.5px dashed currentColor;
      border-radius: 6px; background: rgba(0,0,0,.08); outline: none; resize: none; overflow: hidden;
      font: 650 var(--size, 24px)/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      letter-spacing: -.01em; white-space: pre; pointer-events: auto; field-sizing: content;
      text-shadow: 0 1px 2px rgba(0,0,0,.25);
    }
  `;

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const textSize = (width) => Math.round(14 + width * 2.6);

  function create(root, { onEscape, onChange } = {}) {
    const canvas = document.createElement('canvas');
    canvas.className = 'draw';
    root.append(canvas);
    const ctx = canvas.getContext('2d');

    let shapes = [];
    let undoStack = [];
    let redoStack = [];
    let current = null;
    let tool = null;
    let color = '#FF453A';
    let width = 6;
    let fade = false;
    let dpr = 1;
    let raf = 0;
    let editor = null;
    let lastCount = 0;

    // ---------------------------------------------------------------- tamaño

    function resize() {
      dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.round(innerWidth * dpr);
      const h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      render();
    }
    addEventListener('resize', resize);
    resize();

    // ---------------------------------------------------------------- dibujo de cada forma

    function alphaOf(s, now) {
      if (!fade || s === current) return 1;
      const age = now - s.at;
      if (age < 2200) return 1;
      return Math.max(0, 1 - (age - 2200) / 900);
    }

    function strokePath(points) {
      ctx.beginPath();
      if (points.length === 1) {
        const [x, y] = points[0];
        ctx.moveTo(x, y);
        ctx.lineTo(x + 0.01, y);
        return;
      }
      ctx.moveTo(points[0][0], points[0][1]);
      // Curvas por los puntos medios: el trazo se ve suave aunque el mouse sea rápido.
      for (let i = 1; i < points.length - 1; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[i + 1];
        ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last[0], last[1]);
    }

    function drawArrow(s) {
      const [x0, y0] = s.points[0];
      const [x1, y1] = s.points[s.points.length - 1];
      const angle = Math.atan2(y1 - y0, x1 - x0);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const head = Math.min(len * 0.6, 10 + s.width * 3.2);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1 - Math.cos(angle) * head * 0.6, y1 - Math.sin(angle) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(angle - 0.45), y1 - head * Math.sin(angle - 0.45));
      ctx.lineTo(x1 - head * Math.cos(angle + 0.45), y1 - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    }

    function box(s) {
      const [x0, y0] = s.points[0];
      let [x1, y1] = s.points[s.points.length - 1];
      if (s.square) {
        const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        x1 = x0 + Math.sign(x1 - x0 || 1) * d;
        y1 = y0 + Math.sign(y1 - y0 || 1) * d;
      }
      return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    }

    function drawShape(s, now) {
      const a = alphaOf(s, now);
      if (a <= 0) return;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Sombra suave: el trazo se lee sobre fondos claros y oscuros.
      ctx.shadowColor = 'rgba(0,0,0,.22)';
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
      switch (s.type) {
        case 'pen':
          strokePath(s.points);
          ctx.stroke();
          break;
        case 'highlighter':
          ctx.shadowColor = 'transparent';
          ctx.globalAlpha = a * 0.36;
          ctx.lineCap = 'butt';
          ctx.lineWidth = s.width * 3.4;
          strokePath(s.points);
          ctx.stroke();
          break;
        case 'arrow':
          drawArrow(s);
          break;
        case 'rect': {
          const b = box(s);
          ctx.beginPath();
          ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(10, b.w / 4, b.h / 4));
          ctx.stroke();
          break;
        }
        case 'ellipse': {
          const b = box(s);
          ctx.beginPath();
          ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(1, b.w / 2), Math.max(1, b.h / 2), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'text': {
          ctx.font = `650 ${s.size}px ${FONT}`;
          ctx.textBaseline = 'top';
          ctx.shadowColor = 'rgba(0,0,0,.35)';
          ctx.shadowBlur = 4;
          s.text.split('\n').forEach((line, i) => ctx.fillText(line, s.x, s.y + i * s.size * 1.2));
          break;
        }
      }
      ctx.restore();
    }

    function render() {
      if (shapes.length !== lastCount) {
        lastCount = shapes.length;
        onChange?.(shapes.length);
      }
      cancelAnimationFrame(raf);
      raf = 0;
      const now = performance.now();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      let fading = false;
      if (fade) {
        const before = shapes.length;
        shapes = shapes.filter((s) => alphaOf(s, now) > 0);
        if (shapes.length !== before) undoStack = [];
        fading = shapes.length > 0;
      }
      for (const s of shapes) drawShape(s, now);
      if (current && current.type !== 'eraser') drawShape(current, now);
      if (fading) raf = requestAnimationFrame(render);
    }

    // ---------------------------------------------------------------- borrador

    function distToSegment(px, py, [x0, y0], [x1, y1]) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = dx * dx + dy * dy;
      const k = len ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len)) : 0;
      return Math.hypot(px - (x0 + k * dx), py - (y0 + k * dy));
    }

    function hits(s, x, y, r) {
      const pad = r + s.width / 2 + (s.type === 'highlighter' ? s.width * 1.2 : 0);
      if (s.type === 'text') {
        const lines = s.text.split('\n');
        ctx.font = `650 ${s.size}px ${FONT}`;
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
        return x >= s.x - r && x <= s.x + w + r && y >= s.y - r && y <= s.y + lines.length * s.size * 1.2 + r;
      }
      if (s.type === 'rect' || s.type === 'ellipse') {
        const b = box(s);
        if (s.type === 'rect') {
          const inside = x > b.x + pad && x < b.x + b.w - pad && y > b.y + pad && y < b.y + b.h - pad;
          const near = x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad;
          return near && !inside;
        }
        const rx = Math.max(1, b.w / 2);
        const ry = Math.max(1, b.h / 2);
        const nx = (x - (b.x + rx)) / rx;
        const ny = (y - (b.y + ry)) / ry;
        const d = Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
        return d <= pad;
      }
      const pts = s.type === 'arrow' ? [s.points[0], s.points[s.points.length - 1]] : s.points;
      if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= pad;
      for (let i = 0; i < pts.length - 1; i++) if (distToSegment(x, y, pts[i], pts[i + 1]) <= pad) return true;
      return false;
    }

    function eraseAt(x, y) {
      const r = Math.max(8, width * 1.5);
      const gone = shapes.filter((s) => hits(s, x, y, r));
      if (!gone.length) return;
      shapes = shapes.filter((s) => !gone.includes(s));
      current.erased.push(...gone);
      render();
    }

    // ---------------------------------------------------------------- texto

    function openText(x, y) {
      closeText(true);
      const size = textSize(width);
      const el = document.createElement('textarea');
      el.className = 'draw-text';
      el.rows = 1;
      el.spellcheck = false;
      el.style.left = `${x}px`;
      el.style.top = `${y - 4}px`;
      el.style.color = color;
      el.style.setProperty('--size', `${size}px`);
      root.append(el);
      editor = { el, x: x + 5, y: y - 1, size, color };
      setTimeout(() => el.focus(), 0);
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') closeText(false);
        else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          closeText(true);
        }
      });
      el.addEventListener('keyup', (e) => e.stopPropagation());
      el.addEventListener('blur', () => closeText(true));
    }

    function closeText(commit) {
      if (!editor) return;
      const { el, x, y, size, color: c } = editor;
      editor = null;
      const text = el.value.replace(/\s+$/, '');
      el.remove();
      if (commit && text) add({ type: 'text', x, y, size, color: c, text, width: 2, at: performance.now() });
    }

    // ---------------------------------------------------------------- historial

    function add(shape) {
      shapes.push(shape);
      undoStack.push({ add: shape });
      redoStack = [];
      render();
    }

    function undo() {
      closeText(true);
      const step = undoStack.pop();
      if (!step) return;
      if (step.add) shapes = shapes.filter((s) => s !== step.add);
      if (step.remove) shapes.push(...step.remove);
      redoStack.push(step);
      render();
    }

    function redo() {
      const step = redoStack.pop();
      if (!step) return;
      if (step.add) shapes.push(step.add);
      if (step.remove) shapes = shapes.filter((s) => !step.remove.includes(s));
      undoStack.push(step);
      render();
    }

    function clear() {
      closeText(false);
      if (!shapes.length) return;
      undoStack.push({ remove: shapes });
      redoStack = [];
      shapes = [];
      render();
    }

    // ---------------------------------------------------------------- puntero

    const pos = (e) => [e.clientX, e.clientY];

    canvas.addEventListener('pointerdown', (e) => {
      if (!tool || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      if (tool === 'text') {
        if (editor) { closeText(true); return; }
        openText(e.clientX, e.clientY);
        return;
      }
      canvas.setPointerCapture(e.pointerId);
      const at = performance.now();
      current = tool === 'eraser'
        ? { type: 'eraser', erased: [] }
        : { type: tool, color, width, points: [pos(e)], at, square: e.shiftKey };
      if (tool === 'eraser') eraseAt(...pos(e));
      render();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      e.preventDefault();
      if (current.type === 'eraser') {
        for (const ev of e.getCoalescedEvents?.() || [e]) eraseAt(ev.clientX, ev.clientY);
        return;
      }
      current.square = e.shiftKey;
      if (current.type === 'pen' || current.type === 'highlighter') {
        for (const ev of e.getCoalescedEvents?.() || [e]) {
          const p = pos(ev);
          const last = current.points[current.points.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5) current.points.push(p);
        }
      } else {
        current.points[1] = pos(e);
      }
      render();
    });

    function finish(e) {
      if (!current) return;
      const shape = current;
      current = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      if (shape.type === 'eraser') {
        if (shape.erased.length) {
          undoStack.push({ remove: shape.erased });
          redoStack = [];
        }
        return;
      }
      // Un clic sin arrastrar con flecha, rectángulo o elipse no deja nada.
      if (['arrow', 'rect', 'ellipse'].includes(shape.type)) {
        const [a, b] = [shape.points[0], shape.points[1] || shape.points[0]];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 6) { render(); return; }
      }
      shape.at = performance.now();
      add(shape);
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    // Atajos mientras se dibuja.
    function onKey(e) {
      if (!tool || editor) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape?.();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      }
    }
    addEventListener('keydown', onKey, true);

    // Cursor del lápiz: un punto del color y el grosor elegidos.
    function cursorFor() {
      const r = Math.max(3, Math.min(20, (tool === 'highlighter' ? width * 3.4 : width) / 2));
      const size = Math.ceil(r * 2 + 4);
      const fill = tool === 'highlighter' ? `${color}66` : color;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${fill}" stroke="white" stroke-width="1.5"/></svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${size / 2} ${size / 2}, crosshair`;
    }

    function eraserCursor() {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="9" fill="rgba(255,255,255,.55)" stroke="#1c1c1e" stroke-width="1.5"/></svg>';
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 11 11, cell`;
    }

    return {
      set({ tool: t, color: c, width: w, fade: f } = {}) {
        if (t !== undefined && t !== tool) closeText(true);
        if (t !== undefined) tool = t;
        if (c) color = c;
        if (w) width = w;
        if (f !== undefined && f !== fade) {
          fade = f;
          const now = performance.now();
          for (const s of shapes) s.at = now;
        }
        canvas.className = `draw${tool ? ` on ${tool === 'highlighter' ? 'pen' : tool}` : ''}`;
        canvas.style.setProperty('--pen-cursor', cursorFor());
        canvas.style.setProperty('--eraser-cursor', eraserCursor());
        render();
      },
      undo,
      redo,
      clear,
      get count() { return shapes.length; },
      destroy() {
        closeText(false);
        removeEventListener('resize', resize);
        removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(raf);
        canvas.remove();
      },
    };
  }

  parts.dibujo = { create, css: CSS };
})();
