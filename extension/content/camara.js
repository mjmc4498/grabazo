// Grabazo — burbuja de la cámara sobre la página (mundo aislado).
// Un marco arrastrable (círculo o rectángulo, cuatro tamaños, espejo) con la cámara
// adentro: camara.html, una página de la extensión que recibe la imagen (de la cámara
// de la computadora o del celular, con sus efectos) desde el documento offscreen. Como
// está en la página, se ve en la grabación. También puede salir a una ventana flotante
// sobre todas las apps (Picture-in-Picture).

(() => {
  'use strict';
  const parts = (globalThis.__grabazoParts ||= {});
  if (parts.camara) return;

  const SIZES = { s: 150, m: 210, l: 290, xl: 400 };
  const ORDER = ['s', 'm', 'l', 'xl'];

  const CSS = `
    .bubble {
      position: fixed; left: 0; top: 0; pointer-events: auto; touch-action: none; cursor: grab;
      border-radius: 50%; overflow: visible; transition: width .25s cubic-bezier(.3,.7,.4,1), height .25s cubic-bezier(.3,.7,.4,1), border-radius .25s ease, opacity .2s ease;
      filter: drop-shadow(0 12px 28px rgba(0,0,0,.35));
    }
    .bubble.rect { border-radius: 20px; }
    .bubble.dragging { cursor: grabbing; transition: none; }
    .bubble[hidden] { display: none; }
    .bubble .frame {
      position: absolute; inset: 0; border-radius: inherit; overflow: hidden; background: #111113;
      box-shadow: 0 0 0 3px rgba(255,255,255,.92);
    }
    .bubble iframe { width: 100%; height: 100%; border: 0; display: block; pointer-events: none; background: #111113; color-scheme: normal; }
    .bubble.mirror iframe { transform: scaleX(-1); }
    .bubble.popped .frame { display: none; }
    .bubble.popped { width: 120px !important; height: 44px !important; border-radius: 22px; }
    .bubble .pip-note {
      display: none; position: absolute; inset: 0; align-items: center; justify-content: center; border-radius: 22px;
      background: rgba(17,17,19,.92); color: #fff; font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .bubble.popped .pip-note { display: flex; }
    .bubble .cam-tools {
      position: absolute; left: 50%; bottom: -16px; transform: translateX(-50%); display: flex; gap: 2px; padding: 3px;
      border-radius: 999px; background: rgba(17,17,19,.92); box-shadow: 0 6px 18px rgba(0,0,0,.35);
      opacity: 0; transition: opacity .15s ease; pointer-events: none; white-space: nowrap;
    }
    .bubble:hover .cam-tools, .bubble.tools .cam-tools { opacity: 1; pointer-events: auto; }
    .bubble.dragging .cam-tools { opacity: 0; }
    .cam-tools button {
      display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 50%;
      background: transparent; color: #fff; cursor: pointer; padding: 0;
    }
    .cam-tools button:hover { background: rgba(255,255,255,.14); }
    .cam-tools svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  `;

  const ICONS = {
    shape: '<svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="5"/><rect x="14" y="7" width="8" height="10" rx="2"/></svg>',
    size: '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    mirror: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7 3 12l5 5V7zM16 7l5 5-5 5V7z"/></svg>',
    pip: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="15" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1"/></svg>',
    hide: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };

  function create(root, { t, onSave, onSettings, onHide } = {}) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.hidden = true;
    const frame = document.createElement('div');
    frame.className = 'frame';
    const note = document.createElement('div');
    note.className = 'pip-note';
    note.textContent = t('camInPip');
    const tools = document.createElement('div');
    tools.className = 'cam-tools';
    const btn = (key, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.innerHTML = ICONS[key];
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      tools.append(b);
      return b;
    };
    bubble.append(frame, note, tools);
    root.append(bubble);

    let iframe = null;
    let opts = { shape: 'circle', size: 'm', mirror: true };
    let pos = null; // { x, y } esquina superior izquierda
    let pip = null;

    function dims() {
      const d = SIZES[opts.size] || SIZES.m;
      return opts.shape === 'rect' ? { w: Math.round(d * 1.42), h: d } : { w: d, h: d };
    }

    function clampPos(p) {
      const { w, h } = dims();
      const m = 12;
      return {
        x: Math.min(Math.max(m, p.x), Math.max(m, innerWidth - w - m)),
        y: Math.min(Math.max(m, p.y), Math.max(m, innerHeight - h - m - 18)),
      };
    }

    function layout() {
      const { w, h } = dims();
      if (!pos) pos = { x: 28, y: innerHeight - h - 96 };
      pos = clampPos(pos);
      bubble.style.width = `${w}px`;
      bubble.style.height = `${h}px`;
      bubble.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      bubble.classList.toggle('rect', opts.shape === 'rect');
      bubble.classList.toggle('mirror', !!opts.mirror);
    }

    function ensureFrame() {
      if (iframe) return;
      iframe = document.createElement('iframe');
      iframe.src = chrome.runtime.getURL('camara.html');
      iframe.allow = 'autoplay';
      iframe.title = 'Grabazo';
      iframe.setAttribute('aria-hidden', 'true');
      frame.append(iframe);
    }

    // ---------------------------------------------------------------- arrastrar

    let drag = null;
    bubble.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      bubble.setPointerCapture(e.pointerId);
      drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
    });
    bubble.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const next = clampPos({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
      if (!drag.moved && Math.hypot(next.x - pos.x, next.y - pos.y) < 3) return;
      drag.moved = true;
      bubble.classList.add('dragging');
      pos = next;
      bubble.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    });
    const endDrag = (e) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      bubble.classList.remove('dragging');
      try { bubble.releasePointerCapture(e.pointerId); } catch {}
      if (moved) onSave?.(pos);
      else bubble.classList.toggle('tools');
    };
    bubble.addEventListener('pointerup', endDrag);
    bubble.addEventListener('pointercancel', endDrag);
    addEventListener('resize', layout);

    // ---------------------------------------------------------------- controles

    btn('shape', t('camShape'), () => onSettings?.({ camShape: opts.shape === 'circle' ? 'rect' : 'circle' }));
    btn('size', t('camSize'), () => onSettings?.({ camSize: ORDER[(ORDER.indexOf(opts.size) + 1) % ORDER.length] }));
    btn('mirror', t('camMirror'), () => onSettings?.({ camMirror: !opts.mirror }));
    const pipBtn = btn('pip', t('camPip'), () => togglePip());
    btn('hide', t('camHide'), () => onHide?.());
    if (!('documentPictureInPicture' in window)) pipBtn.remove();

    // Ventana flotante sobre todas las apps: útil al grabar la pantalla completa.
    async function togglePip() {
      if (pip) { pip.close(); return; }
      try {
        const { w, h } = dims();
        const win = await window.documentPictureInPicture.requestWindow({ width: Math.max(w, 200), height: Math.max(h, 200) });
        pip = win;
        const style = win.document.createElement('style');
        style.textContent = `html,body{margin:0;height:100%;background:#111113;overflow:hidden}iframe{width:100%;height:100%;border:0;display:block}${opts.mirror ? 'iframe{transform:scaleX(-1)}' : ''}`;
        win.document.head.append(style);
        const inner = win.document.createElement('iframe');
        inner.src = chrome.runtime.getURL('camara.html');
        win.document.body.append(inner);
        bubble.classList.add('popped');
        iframe?.remove();
        iframe = null;
        win.addEventListener('pagehide', () => {
          pip = null;
          bubble.classList.remove('popped');
          if (!bubble.hidden) ensureFrame();
        });
      } catch {
        pip = null;
      }
    }

    return {
      show(next, savedPos) {
        if (savedPos && !pos) pos = { x: savedPos.x, y: savedPos.y };
        opts = { ...opts, ...next };
        bubble.hidden = false;
        if (!pip) ensureFrame();
        layout();
      },
      set(next) {
        opts = { ...opts, ...next };
        layout();
      },
      hide() {
        bubble.hidden = true;
        bubble.classList.remove('tools');
        pip?.close();
        // Sin la burbuja no hace falta la cámara: el iframe se quita y la luz se apaga.
        iframe?.remove();
        iframe = null;
      },
      get visible() { return !bubble.hidden; },
      destroy() {
        removeEventListener('resize', layout);
        pip?.close();
        bubble.remove();
      },
    };
  }

  parts.camara = { create, css: CSS };
})();
