// Grabazo — efectos de cursor y pantalla sobre la página (mundo aislado).
// · Resaltado de clics (una onda en cada clic).
// · Foco de luz: oscurece todo menos un círculo alrededor del cursor.
// · Oculta el cursor cuando no se mueve.
// · Difuminar información sensible: clic sobre un elemento o arrastrar una zona.
// · Avisa al grabador dónde está el cursor (para el zoom dinámico).
// Lo usa content/capa.js.

(() => {
  'use strict';
  const parts = (globalThis.__grabazoParts ||= {});
  if (parts.efectos) return;

  const CSS = `
    .fx-spot {
      position: fixed; inset: 0; pointer-events: none; opacity: 0; transition: opacity .25s ease;
      background: radial-gradient(circle at var(--x, 50%) var(--y, 50%), transparent 0, transparent var(--r, 140px), rgba(0,0,0,.66) calc(var(--r, 140px) + 46px));
    }
    .fx-spot.on { opacity: 1; }
    .fx-ripple {
      position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none;
      border: 3px solid var(--accent, #ff7a1a); background: color-mix(in srgb, var(--accent, #ff7a1a) 22%, transparent);
      animation: fx-ripple .55s cubic-bezier(.2,.7,.3,1) forwards;
    }
    @keyframes fx-ripple { from { transform: scale(.35); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }
    .fx-picker { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; }
    .fx-hover {
      position: fixed; pointer-events: none; border: 2px dashed #ff7a1a; border-radius: 6px;
      background: rgba(255,122,26,.10); transition: all .08s ease; display: none;
    }
    .fx-zone {
      position: fixed; border-radius: 10px; pointer-events: none;
      backdrop-filter: blur(14px) saturate(.9); -webkit-backdrop-filter: blur(14px) saturate(.9);
      background: rgba(127,127,127,.12);
    }
    .fx-zone.draft { border: 2px dashed #ff7a1a; }
    .fx-zone .fx-x {
      position: absolute; top: -10px; right: -10px; width: 22px; height: 22px; border: 0; border-radius: 50%;
      background: #1c1c1e; color: #fff; font: 600 14px/22px system-ui, sans-serif; cursor: pointer; display: none; pointer-events: auto;
      box-shadow: 0 2px 8px rgba(0,0,0,.4);
    }
    .blurring .fx-zone { outline: 2px dashed rgba(255,122,26,.8); outline-offset: 2px; }
    .blurring .fx-zone .fx-x { display: block; }
  `;

  // Estilos que van en la página (no en la capa): elementos difuminados y cursor oculto.
  const PAGE_CSS = `
    [data-grabazo-difuminar] { filter: blur(8px) !important; transition: filter .15s ease; }
    html.grabazo-sin-cursor, html.grabazo-sin-cursor * { cursor: none !important; }
  `;
  const SPOT = { s: 100, m: 150, l: 220 };

  function create(root, host, { report, onEscape } = {}) {
    const spot = document.createElement('div');
    spot.className = 'fx-spot';
    const hover = document.createElement('div');
    hover.className = 'fx-hover';
    const zones = document.createElement('div');
    root.prepend(spot);
    root.prepend(zones);
    root.append(hover);

    const pageStyle = document.createElement('style');
    pageStyle.dataset.grabazo = '';
    pageStyle.textContent = PAGE_CSS;
    (document.head || document.documentElement).append(pageStyle);

    let opts = { clicks: false, spotlight: false, spotlightSize: 'm', hideIdle: false, blur: false, reporting: false, fast: false };
    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let rafPending = false;
    let idleTimer = 0;
    let lastReport = 0;
    let picker = null;
    let drag = null;
    const blurred = new Set();

    function paintSpot() {
      rafPending = false;
      spot.style.setProperty('--x', `${x}px`);
      spot.style.setProperty('--y', `${y}px`);
    }

    function schedule() {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(paintSpot);
      }
    }

    // La posición del cursor va al grabador por un canal propio (un mensaje general
    // despertaría a todas las partes de la extensión decenas de veces por segundo). Se
    // manda a lo sumo una vez por intervalo, y la última posición siempre llega.
    let port = null;
    let pending = null;
    let trailTimer = 0;
    let retryAt = 0;

    function channel() {
      if (port) return port;
      // Sin grabador que escuche, el canal se cierra enseguida: se espera antes de reabrirlo.
      if (performance.now() < retryAt) return null;
      try {
        const p = chrome.runtime.connect({ name: 'grabazo-cursor' });
        p.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (port === p) port = null;
          retryAt = performance.now() + 1000;
        });
        port = p;
      } catch {
        port = null;
      }
      return port;
    }

    function post(msg) {
      try { channel()?.postMessage(msg); } catch { port = null; }
    }

    function snapshot(e, click) {
      return {
        type: 'cursor',
        click,
        x: e.clientX / innerWidth,
        y: e.clientY / innerHeight,
        sx: e.screenX,
        sy: e.screenY,
        sw: screen.width,
        sh: screen.height,
        wx: window.screenX,
        wy: window.screenY,
        ow: outerWidth,
        oh: outerHeight,
      };
    }

    function send(e, click = false) {
      if (!opts.reporting) return;
      const gap = opts.fast ? 33 : 180;
      const now = performance.now();
      pending = snapshot(e, click);
      if (!click && now - lastReport < gap) {
        // La última posición sale al terminar el intervalo.
        if (!trailTimer) trailTimer = setTimeout(() => { trailTimer = 0; if (pending) flush(); }, gap - (now - lastReport));
        return;
      }
      flush();
    }

    function flush() {
      clearTimeout(trailTimer);
      trailTimer = 0;
      lastReport = performance.now();
      const msg = pending;
      pending = null;
      if (msg) post(msg);
    }

    function wake() {
      document.documentElement.classList.remove('grabazo-sin-cursor');
      host.classList.remove('sin-cursor');
      clearTimeout(idleTimer);
      if (opts.hideIdle) {
        idleTimer = setTimeout(() => {
          document.documentElement.classList.add('grabazo-sin-cursor');
          host.classList.add('sin-cursor');
        }, 2500);
      }
    }

    function onMove(e) {
      x = e.clientX;
      y = e.clientY;
      if (opts.spotlight) schedule();
      wake();
      send(e);
    }

    function ripple(cx, cy) {
      const el = document.createElement('div');
      el.className = 'fx-ripple';
      el.style.left = `${cx}px`;
      el.style.top = `${cy}px`;
      root.append(el);
      setTimeout(() => el.remove(), 650);
    }

    function onDown(e) {
      wake();
      // Los clics en la barra o la burbuja de Grabazo no se resaltan.
      if (e.button === 0 && opts.clicks && e.target !== host) ripple(e.clientX, e.clientY);
      send(e, true);
    }

    addEventListener('pointermove', onMove, { capture: true, passive: true });
    addEventListener('pointerdown', onDown, { capture: true, passive: true });

    // ---------------------------------------------------------------- difuminar

    function pageElementAt(px, py) {
      for (const el of document.elementsFromPoint(px, py)) {
        if (el === host || host.contains(el)) continue;
        if (el === document.documentElement || el === document.body) return null;
        return el;
      }
      return null;
    }

    function showHover(el) {
      if (!el) { hover.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(hover.style, { display: 'block', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    }

    function toggleElement(el) {
      if (!el) return;
      if (el.hasAttribute('data-grabazo-difuminar')) {
        el.removeAttribute('data-grabazo-difuminar');
        blurred.delete(el);
      } else {
        el.setAttribute('data-grabazo-difuminar', '');
        blurred.add(el);
      }
    }

    function addZone(r) {
      const zone = document.createElement('div');
      zone.className = 'fx-zone';
      Object.assign(zone.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      const x = document.createElement('button');
      x.className = 'fx-x';
      x.type = 'button';
      x.textContent = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); zone.remove(); });
      zone.append(x);
      zones.append(zone);
      return zone;
    }

    function openPicker() {
      if (picker) return;
      picker = document.createElement('div');
      picker.className = 'fx-picker';
      root.append(picker);
      host.classList.add('blurring');
      picker.addEventListener('pointermove', (e) => {
        if (drag) {
          const r = rectOf(drag.x, drag.y, e.clientX, e.clientY);
          if (!drag.zone && (r.w > 6 || r.h > 6)) {
            drag.zone = addZone(r);
            drag.zone.classList.add('draft');
            showHover(null);
          }
          if (drag.zone) Object.assign(drag.zone.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
          return;
        }
        showHover(pageElementAt(e.clientX, e.clientY));
      });
      picker.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        picker.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, zone: null };
      });
      picker.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.zone) {
          d.zone.classList.remove('draft');
          const r = d.zone.getBoundingClientRect();
          if (r.width < 12 || r.height < 12) d.zone.remove();
        } else {
          toggleElement(pageElementAt(e.clientX, e.clientY));
        }
      });
    }

    function closePicker() {
      picker?.remove();
      picker = null;
      drag = null;
      host.classList.remove('blurring');
      showHover(null);
    }

    function rectOf(x0, y0, x1, y1) {
      return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    }

    function clearBlur() {
      for (const el of blurred) el.removeAttribute('data-grabazo-difuminar');
      blurred.clear();
      zones.replaceChildren();
    }

    function onKey(e) {
      if (e.key === 'Escape' && picker) {
        e.preventDefault();
        onEscape?.();
      }
    }
    addEventListener('keydown', onKey, true);

    return {
      set(next) {
        opts = { ...opts, ...next };
        spot.classList.toggle('on', !!opts.spotlight);
        spot.style.setProperty('--r', `${SPOT[opts.spotlightSize] || SPOT.m}px`);
        if (opts.spotlight) paintSpot();
        if (opts.blur) openPicker();
        else closePicker();
        if (!opts.hideIdle) wake();
      },
      clearBlur,
      destroy() {
        removeEventListener('pointermove', onMove, true);
        removeEventListener('pointerdown', onDown, true);
        removeEventListener('keydown', onKey, true);
        clearTimeout(idleTimer);
        closePicker();
        clearBlur();
        document.documentElement.classList.remove('grabazo-sin-cursor');
        pageStyle.remove();
        spot.remove();
        zones.remove();
        hover.remove();
      },
    };
  }

  parts.efectos = { create, css: CSS };
})();
