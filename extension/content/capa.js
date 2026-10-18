// Grabazo — capa sobre la página (mundo aislado).
// Un elemento `popover` con un shadow root cerrado: al mostrarse entra en la «top layer»
// (por encima incluso de un elemento en pantalla completa) y no se mezcla con los
// estilos de la página. Contiene la barra de grabación, la paleta de dibujo, la cuenta
// regresiva, la elección del área y las piezas de content/dibujo.js, content/efectos.js
// y content/camara.js. Todo lo que se ve aquí (salvo lo que queda fuera del área
// elegida) aparece en la grabación.

(() => {
  'use strict';
  if (globalThis.__grabazo) {
    globalThis.__grabazo.hello();
    return;
  }
  const parts = globalThis.__grabazoParts || {};
  const t = (key, subs) => {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch { return key; }
  };
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const send = (msg) => {
    if (!alive()) return Promise.resolve(null);
    try { return chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null); } catch { return Promise.resolve(null); }
  };
  const op = (name, extra = {}) => send({ type: 'overlay:op', op: name, ...extra });

  const COLORS = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#0A84FF', '#BF5AF2', '#FFFFFF', '#1C1C1E'];
  const WIDTHS = [3, 6, 11];
  const TOOLS = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'text', 'eraser'];

  const I = {
    grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24" class="fill"><path d="M7 4.5v15l12-7.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" class="fill"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    discard: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/></svg>',
    pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    highlighter: '<svg viewBox="0 0 24 24"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 19 19 5M9 5h10v10"/></svg>',
    rect: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/><path d="M22 21H7M5 11l9 9"/></svg>',
    caret: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    mirror: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7 3 12l5 5V7zM16 7l5 5-5 5V7z"/></svg>',
    circle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/></svg>',
    rectShape: '<svg viewBox="0 0 24 24"><rect x="3" y="6.5" width="18" height="11" rx="2.5"/></svg>',
    zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>',
    spotlight: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    clicks: '<svg viewBox="0 0 24 24"><path d="m9 9 5 12 1.8-5.2L21 14z"/><path d="M7.2 2.2 8 5.1M5.1 8l-2.9-.8M14 4.1 12 6.2M6.2 12l-2.1 2"/></svg>',
    blur: '<svg viewBox="0 0 24 24"><path d="M12 2.7s7 7.4 7 12.1a7 7 0 0 1-14 0c0-4.7 7-12.1 7-12.1z"/><path d="M9 15h.01M12 12h.01M15 15h.01M12 18h.01"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 10 6-3.5v11L16 14"/></svg>',
    cameraOff: '<svg viewBox="0 0 24 24"><path d="M10.7 6H14a2 2 0 0 1 2 2v3.3l6-4.8v11"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2"/><path d="m2 2 20 20"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
    micOff: '<svg viewBox="0 0 24 24"><path d="m2 2 20 20"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1"/><path d="M19 10a7 7 0 0 1-1.1 3.8M5 10a7 7 0 0 0 11.1 5.7M12 17v5"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
    hide: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c7 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    clear: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    fade: '<svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3"/><circle cx="12" cy="12" r="3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>',
  };

  const CSS = `
    :host { all: initial; --accent: #ff7a1a; }
    * { box-sizing: border-box; }
    svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.85; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    svg.fill { fill: currentColor; stroke: none; }
    .ui { font: 500 13px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; letter-spacing: -.01em; color: #f5f5f7; -webkit-font-smoothing: antialiased; }
    button { font: inherit; }
    [hidden] { display: none !important; }

    /* ---------- barra de grabación */
    .tb {
      position: fixed; left: 0; top: 0; display: flex; align-items: center; gap: 2px; height: 50px; padding: 0 7px 0 4px;
      border-radius: 16px; background: rgba(24, 24, 27, .95); box-shadow: 0 0 0 1px rgba(255,255,255,.09), 0 18px 44px -14px rgba(0,0,0,.6);
      pointer-events: auto; user-select: none; -webkit-user-select: none; transition: opacity .25s ease;
    }
    .tb.faded { opacity: 0; }
    .tb button {
      position: relative; display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 10px;
      background: transparent; color: inherit; cursor: pointer; transition: background .12s ease, color .12s ease, transform .08s ease;
    }
    .tb button:hover { background: rgba(255,255,255,.11); }
    .tb button:active { transform: scale(.94); }
    .tb button.on { background: rgba(255,122,26,.24); color: #ffa45c; }
    .tb button.stop { width: 38px; background: #ff3b30; color: #fff; margin: 0 2px; }
    .tb button.stop:hover { background: #ff5146; }
    .tb button.caret { width: 18px; margin-left: -3px; border-radius: 6px; }
    .tb button.caret svg { width: 14px; height: 14px; }
    .tb button.off { color: #ff6961; }
    .tb button.talking { background: rgba(48,209,88,.25); color: #4cd964; }
    .tb button:disabled { opacity: .35; pointer-events: none; }
    .grip { display: grid; place-items: center; width: 22px; height: 36px; color: rgba(255,255,255,.4); cursor: grab; }
    .grip:active { cursor: grabbing; }
    .grip svg { width: 16px; height: 16px; fill: currentColor; stroke: none; }
    .time { display: flex; align-items: center; gap: 8px; min-width: 76px; padding: 0 10px 0 4px; font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: 0; }
    .time i { width: 10px; height: 10px; border-radius: 50%; background: #ff3b30; box-shadow: 0 0 0 3px rgba(255,59,48,.28); animation: pulse 1.4s ease-in-out infinite; }
    .tb.paused .time i { background: #ff9f0a; box-shadow: 0 0 0 3px rgba(255,159,10,.28); animation: none; }
    .tb.paused .time b { color: #ffb340; }
    .tb.ending .time b { color: #ff6961; animation: pulse .9s ease-in-out infinite; }
    .tb.saving .time i { animation: spin .8s linear infinite; background: none; box-shadow: none; border: 2px solid rgba(255,255,255,.25); border-top-color: #fff; }
    .sep { width: 1px; height: 22px; margin: 0 5px; background: rgba(255,255,255,.13); }
    .phone { display: flex; align-items: center; gap: 2px; padding: 0 6px; height: 36px; border-radius: 10px; color: rgba(255,255,255,.38); font-size: 12px; font-weight: 650; }
    .phone.on { color: #4cd964; }
    .phone svg { width: 17px; height: 17px; }
    @keyframes pulse { 50% { opacity: .35; } }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ---------- paleta de dibujo y menú de efectos */
    .pop {
      position: fixed; left: 0; top: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px;
      border-radius: 16px; background: rgba(24, 24, 27, .97); box-shadow: 0 0 0 1px rgba(255,255,255,.09), 0 18px 44px -14px rgba(0,0,0,.6);
      pointer-events: auto; user-select: none;
    }
    .row { display: flex; align-items: center; gap: 3px; }
    .pop button {
      display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: inherit; cursor: pointer;
    }
    .pop button:hover { background: rgba(255,255,255,.11); }
    .pop button.on { background: rgba(255,122,26,.26); color: #ffa45c; }
    .swatch { width: 26px !important; height: 26px !important; border-radius: 50% !important; box-shadow: inset 0 0 0 2px rgba(255,255,255,.18); }
    .swatch.on { box-shadow: 0 0 0 2px #18181b, 0 0 0 4px #fff !important; }
    .wdot { border-radius: 50%; background: #f5f5f7; }
    .pop .label { padding: 2px 4px 0; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: rgba(255,255,255,.45); }
    .menu-item { display: flex !important; align-items: center; justify-content: flex-start !important; gap: 10px; width: 100% !important; height: 36px; padding: 0 10px !important; text-align: left; white-space: nowrap; }
    .menu-item .sw { margin-left: auto; width: 30px; height: 18px; border-radius: 99px; background: rgba(255,255,255,.18); position: relative; flex: none; transition: background .15s ease; }
    .menu-item .sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform .15s ease; }
    .menu-item.on { background: transparent !important; color: inherit !important; }
    .menu-item.on .sw { background: #30d158; }
    .menu-item.on .sw::after { transform: translateX(12px); }
    .menu-item.action { color: #ffa45c; }
    .pop .txt { font: 700 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }

    /* ---------- cuenta regresiva */
    .cd {
      position: fixed; inset: 0; display: grid; place-items: center; pointer-events: auto; cursor: pointer;
      background: rgba(0,0,0,.38); animation: fadein .2s ease;
    }
    .cd-box { display: flex; flex-direction: column; align-items: center; gap: 18px; }
    .cd-n {
      display: grid; place-items: center; width: 168px; height: 168px; border-radius: 50%;
      background: rgba(24,24,27,.88); box-shadow: 0 0 0 6px rgba(255,122,26,.85), 0 30px 80px rgba(0,0,0,.5);
      font: 800 92px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: #fff; letter-spacing: -.04em; font-variant-numeric: tabular-nums;
    }
    .cd-n.tick { animation: tick .9s ease-out; }
    .cd-hint { padding: 7px 14px; border-radius: 99px; background: rgba(24,24,27,.85); color: rgba(255,255,255,.85); font-size: 13px; }
    @keyframes tick { from { transform: scale(1.18); } to { transform: scale(1); } }
    @keyframes fadein { from { opacity: 0; } }

    /* ---------- área */
    .area { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; }
    .area-rect { position: fixed; box-shadow: 0 0 0 100vmax rgba(0,0,0,.5); outline: 2px solid #ff7a1a; border-radius: 2px; cursor: move; }
    .area-rect.live { outline: 2px dashed rgba(255,122,26,.95); outline-offset: 3px; box-shadow: 0 0 0 100vmax rgba(0,0,0,.28); cursor: default; pointer-events: none; }
    .area-size { position: absolute; left: 0; top: -30px; padding: 4px 8px; border-radius: 7px; background: #ff7a1a; color: #fff; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .h { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 2px #ff7a1a, 0 2px 6px rgba(0,0,0,.4); }
    .h[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; } .h[data-h="n"] { left: 50%; top: 0; cursor: ns-resize; }
    .h[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; } .h[data-h="e"] { left: 100%; top: 50%; cursor: ew-resize; }
    .h[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; } .h[data-h="s"] { left: 50%; top: 100%; cursor: ns-resize; }
    .h[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; } .h[data-h="w"] { left: 0; top: 50%; cursor: ew-resize; }
    .area-bar {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 7px;
      border-radius: 16px; background: rgba(24,24,27,.96); box-shadow: 0 0 0 1px rgba(255,255,255,.09), 0 18px 44px -14px rgba(0,0,0,.6); cursor: default;
    }
    .area-bar .seg { display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: rgba(255,255,255,.08); }
    .area-bar .seg button { height: 30px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,.7); cursor: pointer; font-size: 12.5px; }
    .area-bar .seg button.on { background: rgba(255,255,255,.18); color: #fff; }
    .area-bar .btn { height: 36px; padding: 0 14px; border: 0; border-radius: 10px; background: rgba(255,255,255,.1); color: #fff; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .area-bar .btn.go { background: linear-gradient(135deg, #ffb347, #ff5e1a); }
    .area-bar .btn svg { width: 17px; height: 17px; }
    .area-hint { position: fixed; left: 50%; top: 26px; transform: translateX(-50%); padding: 9px 16px; border-radius: 99px; background: rgba(24,24,27,.92); font-size: 13.5px; pointer-events: none; }

    /* ---------- aviso */
    .toast {
      position: fixed; left: 50%; top: 22px; transform: translate(-50%, -12px); padding: 9px 16px; border-radius: 99px;
      background: rgba(24,24,27,.95); box-shadow: 0 10px 30px rgba(0,0,0,.35); font-size: 13px; opacity: 0; pointer-events: none;
      transition: opacity .2s ease, transform .2s ease; white-space: nowrap;
    }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    :host(.sin-cursor) .tb, :host(.sin-cursor) .bubble { cursor: none; }
  `;

  // ================================================================ elemento anfitrión

  const host = document.createElement('grabazo-capa');
  host.setAttribute('popover', 'manual');
  host.style.cssText = [
    'all: initial', 'position: fixed', 'inset: 0', 'width: 100vw', 'height: 100vh', 'max-width: none', 'max-height: none',
    'margin: 0', 'padding: 0', 'border: 0', 'background: transparent', 'overflow: visible', 'pointer-events: none',
    'z-index: 2147483647', 'display: block', 'color-scheme: normal',
  ].map((d) => `${d} !important`).join(';');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS + (parts.dibujo?.css || '') + (parts.efectos?.css || '') + (parts.camara?.css || ''));
  root.adoptedStyleSheets = [sheet];
  const ui = document.createElement('div');
  ui.className = 'ui';
  root.append(ui);

  // Los eventos de la capa no llegan a la página (que podría reaccionar a los clics).
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart']) {
    ui.addEventListener(type, (e) => e.stopPropagation(), { passive: type !== 'contextmenu' && type !== 'click' });
  }

  let shown = false;
  function show() {
    if (!host.isConnected) document.documentElement.append(host);
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch {}
    shown = true;
  }
  function hide() {
    try { host.hidePopover(); } catch {}
    host.remove();
    shown = false;
  }
  // Vigilante: si la página quita la capa del documento o cierra su popover (algunos sitios
  // rehacen el DOM o cierran los popovers ajenos), vuelve a ponerla encima.
  setInterval(() => {
    if (!shown || !alive()) return;
    if (!host.isConnected) document.documentElement.append(host);
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch {}
  }, 1000);

  // Al entrar en pantalla completa, la capa vuelve arriba de todo.
  document.addEventListener('fullscreenchange', () => {
    if (!shown) return;
    try { host.hidePopover(); host.showPopover(); } catch {}
  }, true);

  // ================================================================ estado

  let role = 'none';
  let rec = { status: 'idle' };
  let st = {}; // herramientas (ui)
  let link = {};
  let settings = {};
  let saved = { toolbarPos: null, camPos: null };

  let drawing = null;
  let effects = null;
  let bubble = null;

  // Un repintado mínimo al empezar: la captura de una pestaña quieta manda imagen solo
  // cuando algo cambia en pantalla.
  let kickEl = null;
  function kick() {
    if (!kickEl) {
      kickEl = document.createElement('div');
      kickEl.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;pointer-events:none;opacity:.01;background:#000';
      ui.append(kickEl);
    }
    const el = kickEl;
    let n = 0;
    const step = () => {
      // La capa pudo cerrarse entre un cuadro y otro.
      if (!el.isConnected) return;
      el.style.background = n % 2 ? '#000' : '#010101';
      if (++n < 6) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function apply(msg) {
    if (!msg) return;
    if (msg.rec && msg.rec.status !== rec.status && ['starting', 'countdown', 'recording'].includes(msg.rec.status)) setTimeout(kick, 0);
    if (msg.rec) rec = msg.rec;
    if (msg.ui) st = msg.ui;
    if (msg.link) link = msg.link;
    if (msg.settings) settings = msg.settings;
    if (msg.role) role = msg.role;
    if (msg.toolbarPos !== undefined) saved.toolbarPos = msg.toolbarPos;
    if (msg.camPos !== undefined) saved.camPos = msg.camPos;
    render();
  }

  const live = () => role === 'live' && ['starting', 'picking', 'countdown', 'recording', 'paused', 'saving'].includes(rec.status);

  function render() {
    if (!alive()) { teardown(); return; }
    if (role === 'none' || (role === 'live' && !live())) {
      if (shown || drawing || bubble) teardown();
      return;
    }
    show();
    ensureParts();

    // Burbuja de la cámara: solo al grabar una pestaña o un área. En ventana y pantalla la
    // cámara va dentro del video (la compone el grabador) y aquí se vería dos veces.
    const mode = role === 'prepare' ? settings.mode : rec.mode;
    const camOn = (mode === 'tab' || mode === 'area') && (role === 'prepare' ? !!settings.camera : !!st.camera);
    if (camOn) bubble.show({ shape: settings.camShape, size: settings.camSize, mirror: settings.camMirror }, saved.camPos);
    else bubble.hide();

    // Dibujo y efectos
    const recording = role === 'live' && (rec.status === 'recording' || rec.status === 'paused');
    drawing.set({ tool: recording ? st.tool || null : null, color: st.color, width: st.width, fade: !!settings.drawFade });
    effects.set({
      clicks: recording && !!st.clicks,
      spotlight: recording && !!st.spotlight,
      spotlightSize: settings.spotlightSize,
      hideIdle: recording && rec.status === 'recording' && !!settings.hideIdleCursor,
      blur: recording && !!st.blur,
      reporting: role === 'live' && rec.status !== 'saving',
      fast: !!st.zoom || !!settings.zoomOnClick,
    });

    renderArea();
    renderCountdown();
    renderToolbar();
    expose();
  }

  // Estado visible desde fuera del shadow root cerrado (lo usan las pruebas).
  function expose() {
    const d = host.dataset;
    d.role = role;
    d.status = rec.status || 'idle';
    d.toolbar = String(!!toolbar);
    d.bubble = String(!!bubble?.visible);
    d.tool = st.tool || '';
    d.spotlight = String(role === 'live' && !!st.spotlight);
    d.blur = String(role === 'live' && !!st.blur);
    d.countdown = String(!!cdEl);
    d.area = String(!!areaUi || !!areaFrame);
    d.shapes = String(drawing?.count || 0);
  }

  function ensureParts() {
    drawing ||= parts.dibujo.create(ui, { onEscape: () => op('ui:set', { patch: { tool: null } }), onChange: () => { host.dataset.shapes = String(drawing?.count || 0); } });
    effects ||= parts.efectos.create(ui, host, { onEscape: () => op('ui:set', { patch: { blur: false } }) });
    bubble ||= parts.camara.create(ui, {
      t,
      onSave: (pos) => { saved.camPos = pos; send({ type: 'overlay:save', camPos: pos }); },
      onSettings: (patch) => send({ type: 'overlay:settings', patch }),
      onHide: () => (role === 'prepare' ? send({ type: 'overlay:settings', patch: { camera: false } }) : op('ui:set', { patch: { camera: false } })),
    });
  }

  function teardown() {
    drawing?.destroy();
    effects?.destroy();
    bubble?.destroy();
    drawing = effects = bubble = null;
    toolbar?.remove();
    toolbar = null;
    closePops();
    areaUi?.remove();
    areaUi = null;
    areaFrame?.remove();
    areaFrame = null;
    cdEl?.remove();
    cdEl = null;
    kickEl?.remove();
    kickEl = null;
    clearInterval(clockTimer);
    clockTimer = 0;
    hide();
  }

  // ================================================================ barra de grabación

  let toolbar = null;
  let tbPos = null;
  let clockTimer = 0;
  let palette = null;
  let menu = null;
  let camPop = null;
  const els = {};

  function button(act, icon, titleKey, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    b.className = cls;
    b.innerHTML = I[icon];
    b.title = t(titleKey);
    b.setAttribute('aria-label', t(titleKey));
    return b;
  }

  function sep() {
    const s = document.createElement('span');
    s.className = 'sep';
    return s;
  }

  function buildToolbar() {
    const tb = document.createElement('div');
    tb.className = 'tb';
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', 'Grabazo');
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.innerHTML = I.grip;
    grip.title = t('tbMove');
    const time = document.createElement('span');
    time.className = 'time';
    time.innerHTML = '<i></i><b>0:00</b>';
    els.time = time.querySelector('b');
    els.pause = button('pause', 'pause', 'pause');
    els.stop = button('stop', 'stop', 'tbStop', 'stop');
    els.restart = button('restart', 'restart', 'restart');
    els.discard = button('discard', 'discard', 'discard');
    els.draw = button('draw', 'pen', 'tbDraw');
    els.palette = button('palette', 'caret', 'tbPalette', 'caret');
    els.zoom = button('zoom', 'zoom', 'tbZoom');
    els.spotlight = button('spotlight', 'spotlight', 'tbSpotlight');
    els.effects = button('effects', 'caret', 'tbEffects', 'caret');
    els.camera = button('camera', 'camera', 'tbCamera');
    els.camMenu = button('camMenu', 'caret', 'tbCamPlace', 'caret');
    els.mic = button('mic', 'mic', 'tbMic');
    els.phone = document.createElement('span');
    els.phone.className = 'phone';
    els.phone.innerHTML = `${I.phone}<b></b>`;
    els.hide = button('hide', 'hide', 'tbHide');
    tb.append(grip, time, sep(), els.pause, els.stop, els.restart, els.discard, sep(), els.draw, els.palette, els.zoom, els.spotlight, els.effects, sep(), els.camera, els.camMenu, els.mic, els.phone, els.hide);
    ui.append(tb);

    tb.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      switch (act) {
        case 'pause': op('rec:togglePause'); break;
        case 'stop': op('rec:stop'); break;
        case 'restart': op('rec:restart'); break;
        case 'discard':
          if (confirm(t('confirmDiscard'))) op('rec:discard');
          break;
        case 'draw': op('ui:set', { patch: { tool: st.tool ? null : lastTool } }); break;
        case 'palette': togglePop('palette'); break;
        case 'effects': togglePop('menu'); break;
        case 'zoom': op('ui:toggle', { key: 'zoom' }); break;
        case 'spotlight': op('ui:toggle', { key: 'spotlight' }); break;
        case 'camera': op('ui:toggle', { key: 'camera' }); break;
        case 'camMenu': togglePop('cam'); break;
        case 'mic': if (!settings.pushToTalk) op('ui:toggle', { key: 'mic' }); break;
        case 'hide': op('ui:set', { patch: { toolbar: false } }); break;
      }
    });

    // Con pulsar para hablar, el botón del micrófono se mantiene pulsado.
    els.mic.addEventListener('pointerdown', (e) => {
      if (!settings.pushToTalk || e.button !== 0) return;
      els.mic.setPointerCapture(e.pointerId);
      ptt(true);
    });
    const release = () => { if (settings.pushToTalk) ptt(false); };
    els.mic.addEventListener('pointerup', release);
    els.mic.addEventListener('pointercancel', release);

    // Arrastrar desde el asa.
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      grip.setPointerCapture(e.pointerId);
      drag = { dx: e.clientX - tbPos.x, dy: e.clientY - tbPos.y };
      closePops();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      tbPos = clampTb({ x: e.clientX - drag.dx, y: e.clientY - drag.dy });
      placeToolbar();
    });
    const drop = () => {
      if (!drag) return;
      drag = null;
      saved.toolbarPos = tbPos;
      send({ type: 'overlay:save', toolbarPos: tbPos });
    };
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);
    return tb;
  }

  function clampTb(p) {
    const w = toolbar?.offsetWidth || 640;
    const h = toolbar?.offsetHeight || 50;
    return { x: Math.min(Math.max(8, p.x), Math.max(8, innerWidth - w - 8)), y: Math.min(Math.max(8, p.y), Math.max(8, innerHeight - h - 8)) };
  }

  function defaultTbPos() {
    const w = toolbar?.offsetWidth || 640;
    // En el modo área, la barra va debajo del área (fuera de lo que se graba) si cabe.
    if (rec.mode === 'area' && rec.area) {
      const a = areaRect();
      if (a.y + a.h + 70 < innerHeight) return { x: a.x + a.w / 2 - w / 2, y: a.y + a.h + 14 };
      if (a.y > 70) return { x: a.x + a.w / 2 - w / 2, y: a.y - 64 };
    }
    return { x: innerWidth / 2 - w / 2, y: innerHeight - 50 - 26 };
  }

  function placeToolbar() {
    toolbar.style.transform = `translate(${Math.round(tbPos.x)}px, ${Math.round(tbPos.y)}px)`;
    placePops();
  }

  function renderToolbar() {
    const want = role === 'live' && ['recording', 'paused', 'saving'].includes(rec.status) && st.toolbar !== false;
    if (!want) {
      toolbar?.remove();
      toolbar = null;
      closePops();
      clearInterval(clockTimer);
      clockTimer = 0;
      return;
    }
    if (!toolbar) {
      toolbar = buildToolbar();
      tbPos = clampTb(saved.toolbarPos || defaultTbPos());
      placeToolbar();
    }
    const saving = rec.status === 'saving';
    toolbar.classList.toggle('paused', rec.status === 'paused');
    toolbar.classList.toggle('saving', saving);
    els.pause.innerHTML = rec.status === 'paused' ? I.play : I.pause;
    els.pause.title = t(rec.status === 'paused' ? 'resume' : 'pause');
    for (const b of [els.pause, els.stop, els.restart, els.discard, els.draw, els.palette, els.zoom, els.spotlight, els.effects, els.camera, els.camMenu, els.mic]) b.disabled = saving;
    if (st.tool && st.tool !== 'eraser') lastTool = st.tool;
    els.draw.innerHTML = I[st.tool && st.tool !== 'eraser' ? st.tool : lastTool];
    els.draw.classList.toggle('on', !!st.tool);
    els.zoom.classList.toggle('on', !!st.zoom);
    els.spotlight.classList.toggle('on', !!st.spotlight);
    els.effects.classList.toggle('on', !!st.clicks || !!st.blur);
    const camOn = st.camera !== false;
    els.camera.innerHTML = camOn ? I.camera : I.cameraOff;
    els.camera.classList.toggle('off', !camOn);
    const ptt = !!settings.pushToTalk;
    const micOn = ptt ? !!st.talking : st.mic !== false;
    els.mic.innerHTML = micOn ? I.mic : I.micOff;
    els.mic.classList.toggle('off', !micOn && !ptt);
    els.mic.classList.toggle('talking', ptt && !!st.talking);
    els.mic.title = t(ptt ? 'tbPtt' : 'tbMic');
    const phones = Array.isArray(link.phones) ? link.phones.length : 0;
    els.phone.classList.toggle('on', phones > 0);
    els.phone.hidden = !link.active;
    els.phone.title = phones ? t('tbPhoneOn', [String(phones)]) : t('tbPhoneOff');
    els.phone.querySelector('b').textContent = phones > 1 ? String(phones) : '';
    renderPops();
    tickClock();
    if (!clockTimer) clockTimer = setInterval(tickClock, 250);
    autoFade();
  }

  function elapsed() {
    const base = Number(rec.elapsed) || 0;
    return rec.status === 'recording' && rec.resumedAt ? base + Math.max(0, Date.now() - rec.resumedAt) : base;
  }

  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function tickClock() {
    if (!toolbar) return;
    if (rec.status === 'saving') {
      els.time.textContent = t('tbSaving');
      return;
    }
    const ms = elapsed();
    const limit = Number(rec.limit) || 0;
    els.time.textContent = limit ? `−${clock(limit - ms)}` : clock(ms);
    toolbar.classList.toggle('ending', !!limit && limit - ms <= 10_000);
  }

  // Ocultar sola: la barra se desvanece si el cursor está lejos (y no sale en el video).
  let fadeTimer = 0;
  function autoFade() {
    if (!toolbar) return;
    if (!settings.toolbarAutoHide || palette || menu || camPop) {
      toolbar.classList.remove('faded');
      return;
    }
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => toolbar?.classList.add('faded'), 2500);
  }
  addEventListener('pointermove', (e) => {
    if (!toolbar || !settings.toolbarAutoHide) return;
    const r = toolbar.getBoundingClientRect();
    const near = e.clientX > r.left - 60 && e.clientX < r.right + 60 && e.clientY > r.top - 60 && e.clientY < r.bottom + 60;
    if (near) {
      toolbar.classList.remove('faded');
      clearTimeout(fadeTimer);
    } else if (!toolbar.classList.contains('faded')) {
      autoFade();
    }
  }, { passive: true, capture: true });

  // ================================================================ paleta y menú

  let lastTool = 'pen';
  let openPop = null;

  function togglePop(which) {
    openPop = openPop === which ? null : which;
    renderPops();
  }

  function closePops() {
    openPop = null;
    palette?.remove();
    menu?.remove();
    camPop?.remove();
    palette = menu = camPop = null;
  }

  function popButton(act, inner, title, cls = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.act = act;
    b.className = cls;
    b.innerHTML = inner;
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
    return b;
  }

  function buildPalette() {
    const p = document.createElement('div');
    p.className = 'pop';
    const tools = document.createElement('div');
    tools.className = 'row';
    for (const tool of TOOLS) tools.append(popButton(`tool:${tool}`, I[tool], t(`tool_${tool}`)));
    const colors = document.createElement('div');
    colors.className = 'row';
    for (const c of COLORS) {
      const b = popButton(`color:${c}`, '', t('tbColor'), 'swatch');
      b.style.background = c;
      colors.append(b);
    }
    const extra = document.createElement('div');
    extra.className = 'row';
    for (const w of WIDTHS) {
      const dot = `<span class="wdot" style="width:${w + 3}px;height:${w + 3}px"></span>`;
      extra.append(popButton(`width:${w}`, dot, t('tbWidth')));
    }
    const s1 = document.createElement('span');
    s1.className = 'sep';
    extra.append(s1, popButton('undo', I.undo, t('tbUndo')), popButton('redo', I.redo, t('tbRedo')), popButton('clear', I.clear, t('tbClear')), popButton('fade', I.fade, t('tbFade')));
    p.append(tools, colors, extra);
    p.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const [act, val] = b.dataset.act.split(':');
      if (act === 'tool') {
        lastTool = val;
        op('ui:set', { patch: { tool: st.tool === val ? null : val } });
      } else if (act === 'color') {
        op('ui:set', { patch: { color: val, ...(st.tool && st.tool !== 'eraser' ? {} : { tool: lastTool === 'eraser' ? 'pen' : lastTool }) } });
      } else if (act === 'width') {
        op('ui:set', { patch: { width: Number(val) } });
      } else if (act === 'undo') drawing?.undo();
      else if (act === 'redo') drawing?.redo();
      else if (act === 'clear') drawing?.clear();
      else if (act === 'fade') send({ type: 'overlay:settings', patch: { drawFade: !settings.drawFade } });
    });
    ui.append(p);
    return p;
  }

  function buildMenu() {
    const m = document.createElement('div');
    m.className = 'pop';
    m.style.gap = '2px';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = t('tbEffects');
    m.append(label);
    const item = (act, icon, key, toggle = true) => {
      const b = popButton(act, `${I[icon]}<span>${t(key)}</span>${toggle ? '<i class="sw"></i>' : ''}`, '', `menu-item${toggle ? '' : ' action'}`);
      m.append(b);
      return b;
    };
    item('clicks', 'clicks', 'tbClicks');
    item('spotlight', 'spotlight', 'tbSpotlight');
    item('zoom', 'zoom', 'tbZoom');
    item('zoomClick', 'zoom', 'tbZoomClick');
    item('hideIdle', 'hide', 'tbHideIdle');
    item('blur', 'blur', 'tbBlur');
    item('unblur', 'clear', 'tbUnblur', false);
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      switch (b.dataset.act) {
        case 'clicks': op('ui:toggle', { key: 'clicks' }); break;
        case 'spotlight': op('ui:toggle', { key: 'spotlight' }); break;
        case 'zoom': op('ui:toggle', { key: 'zoom' }); break;
        case 'blur': op('ui:toggle', { key: 'blur' }); break;
        case 'unblur': effects?.clearBlur(); break;
        case 'zoomClick': send({ type: 'overlay:settings', patch: { zoomOnClick: !settings.zoomOnClick } }); break;
        case 'hideIdle': send({ type: 'overlay:settings', patch: { hideIdleCursor: !settings.hideIdleCursor } }); break;
      }
    });
    ui.append(m);
    return m;
  }

  // Cámara: esquina, tamaño, forma y espejo (en ventana y pantalla se mueve dentro del
  // video; en pestaña y área, la burbuja de la página).
  const CORNERS = { tl: [7, 9.5], tr: [17, 9.5], bl: [7, 14.5], br: [17, 14.5] };
  const PLACES = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, bl: { x: 0, y: 1 }, br: { x: 1, y: 1 } };

  function buildCamPop() {
    const m = document.createElement('div');
    m.className = 'pop';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = t('tbCamPlace');
    const corners = document.createElement('div');
    corners.className = 'row';
    for (const [c, [cx, cy]] of Object.entries(CORNERS)) {
      const icon = `<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="${cx}" cy="${cy}" r="2.6" fill="currentColor" stroke="none"/></svg>`;
      corners.append(popButton(`corner:${c}`, icon, t(`corner${c.toUpperCase()}`)));
    }
    const sizes = document.createElement('div');
    sizes.className = 'row';
    for (const [k, txt] of [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']]) sizes.append(popButton(`size:${k}`, `<b class="txt">${txt}</b>`, t(`size${k.toUpperCase()}`)));
    const shapes = document.createElement('div');
    shapes.className = 'row';
    shapes.append(popButton('shape:circle', I.circle, t('shapeCircle')), popButton('shape:rect', I.rectShape, t('shapeRect')), popButton('mirror', I.mirror, t('camMirror')));
    m.append(label, corners, sizes, shapes);
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const [act, val] = b.dataset.act.split(':');
      if (act === 'corner') op('cam:set', { patch: { corner: val } });
      else if (act === 'size') op('cam:set', { patch: { size: val } });
      else if (act === 'shape') op('cam:set', { patch: { shape: val } });
      else if (act === 'mirror') op('cam:set', { patch: { mirror: settings.camMirror === false } });
    });
    ui.append(m);
    return m;
  }

  function renderPops() {
    if (!toolbar || rec.status === 'saving') { closePops(); return; }
    if (openPop !== 'cam' && camPop) {
      camPop.remove();
      camPop = null;
    }
    if (openPop === 'cam') {
      camPop ||= buildCamPop();
      palette?.remove();
      menu?.remove();
      palette = menu = null;
      const place = settings.camPlace || {};
      for (const b of camPop.querySelectorAll('button[data-act]')) {
        const [act, val] = b.dataset.act.split(':');
        const on = (act === 'corner' && PLACES[val].x === place.x && PLACES[val].y === place.y) || (act === 'size' && settings.camSize === val) || (act === 'shape' && settings.camShape === val) || (act === 'mirror' && settings.camMirror !== false);
        b.classList.toggle('on', on);
      }
    } else if (openPop === 'palette') {
      palette ||= buildPalette();
      menu?.remove();
      menu = null;
      for (const b of palette.querySelectorAll('button[data-act]')) {
        const [act, val] = b.dataset.act.split(':');
        const on = (act === 'tool' && st.tool === val) || (act === 'color' && st.color?.toLowerCase() === val.toLowerCase()) || (act === 'width' && Number(val) === st.width) || (act === 'fade' && !!settings.drawFade);
        b.classList.toggle('on', on);
      }
    } else if (openPop === 'menu') {
      menu ||= buildMenu();
      palette?.remove();
      palette = null;
      const state = { clicks: st.clicks, spotlight: st.spotlight, zoom: st.zoom, blur: st.blur, zoomClick: settings.zoomOnClick, hideIdle: settings.hideIdleCursor };
      for (const b of menu.querySelectorAll('button[data-act]')) b.classList.toggle('on', !!state[b.dataset.act]);
    } else {
      closePops();
    }
    placePops();
  }

  function placePops() {
    const pop = palette || menu || camPop;
    if (!pop || !toolbar) return;
    const anchor = (palette ? els.palette : menu ? els.effects : els.camMenu).getBoundingClientRect();
    const tb = toolbar.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let x = Math.min(Math.max(8, anchor.left + anchor.width / 2 - w / 2), innerWidth - w - 8);
    let y = tb.top - h - 10;
    if (y < 8) y = tb.bottom + 10;
    pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  // ================================================================ cuenta regresiva

  let cdEl = null;
  let cdTimer = 0;
  let cdLast = -1;

  function renderCountdown() {
    const want = role === 'live' && rec.status === 'countdown' && rec.countdownEnd > Date.now() + 200;
    if (!want) {
      cdEl?.remove();
      cdEl = null;
      clearInterval(cdTimer);
      cdTimer = 0;
      return;
    }
    if (!cdEl) {
      cdEl = document.createElement('div');
      cdEl.className = 'cd';
      cdEl.innerHTML = `<div class="cd-box"><div class="cd-n"></div><span class="cd-hint"></span></div>`;
      cdEl.querySelector('.cd-hint').textContent = t('cdHint');
      cdEl.addEventListener('click', () => op('rec:discard'));
      ui.append(cdEl);
      cdLast = -1;
    }
    const tick = () => {
      const left = rec.countdownEnd - Date.now();
      // Desaparece justo antes de que empiece la grabación: no sale en el video.
      if (left <= 200 || rec.status !== 'countdown') { renderCountdown(); return; }
      const n = Math.ceil(left / 1000);
      if (n !== cdLast) {
        cdLast = n;
        const el = cdEl.querySelector('.cd-n');
        el.textContent = String(n);
        el.classList.remove('tick');
        void el.offsetWidth;
        el.classList.add('tick');
      }
    };
    tick();
    if (!cdTimer) cdTimer = setInterval(tick, 100);
  }

  // ================================================================ área

  let areaUi = null;
  let areaFrame = null;
  let sel = null;
  let ratio = 0;

  function areaRect() {
    const a = rec.area;
    if (!a) return { x: 0, y: 0, w: innerWidth, h: innerHeight };
    const kx = innerWidth / (a.vw || innerWidth);
    const ky = innerHeight / (a.vh || innerHeight);
    return { x: a.x * kx, y: a.y * ky, w: a.w * kx, h: a.h * ky };
  }

  function renderArea() {
    // Marco del área mientras se graba (fuera de lo que se graba).
    const frame = role === 'live' && rec.mode === 'area' && rec.area;
    if (frame) {
      if (!areaFrame) {
        areaFrame = document.createElement('div');
        areaFrame.className = 'area-rect live';
        ui.prepend(areaFrame);
      }
      const r = areaRect();
      Object.assign(areaFrame.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    } else {
      areaFrame?.remove();
      areaFrame = null;
    }

    if (role !== 'area') {
      areaUi?.remove();
      areaUi = null;
      return;
    }
    if (areaUi) return;
    sel = { x: innerWidth * 0.2, y: innerHeight * 0.18, w: innerWidth * 0.6, h: innerHeight * 0.6 };
    ratio = 0;
    areaUi = document.createElement('div');
    areaUi.className = 'area';
    areaUi.innerHTML = `
      <div class="area-rect"><span class="area-size"></span>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="h" data-h="${h}"></i>`).join('')}</div>
      <div class="area-hint"></div>
      <div class="area-bar">
        <div class="seg">${[['0', 'areaFree'], ['16/9', '16:9'], ['9/16', '9:16'], ['1', '1:1'], ['4/3', '4:3']].map(([v, k]) => `<button type="button" data-r="${v}">${k.includes(':') ? k : t(k)}</button>`).join('')}</div>
        <button type="button" class="btn" data-act="cancel"></button>
        <button type="button" class="btn go" data-act="go">${I.check}<span></span></button>
      </div>`;
    areaUi.querySelector('.area-hint').textContent = t('areaHint');
    areaUi.querySelector('[data-act="cancel"]').textContent = t('countdownCancel');
    areaUi.querySelector('[data-act="go"] span').textContent = t('areaGo');
    ui.append(areaUi);
    const rectEl = areaUi.querySelector('.area-rect');
    const sizeEl = areaUi.querySelector('.area-size');

    const paint = () => {
      Object.assign(rectEl.style, { left: `${sel.x}px`, top: `${sel.y}px`, width: `${sel.w}px`, height: `${sel.h}px` });
      const dpr = window.devicePixelRatio || 1;
      sizeEl.textContent = `${Math.round(sel.w * dpr)} × ${Math.round(sel.h * dpr)}`;
      for (const b of areaUi.querySelectorAll('[data-r]')) b.classList.toggle('on', ratioOf(b.dataset.r) === ratio);
    };
    const ratioOf = (v) => (v.includes('/') ? Number(v.split('/')[0]) / Number(v.split('/')[1]) : Number(v));
    const fit = (r) => {
      // Ajusta el rectángulo a la proporción, centrado y dentro de la ventana.
      if (!r) return;
      let w = sel.w;
      let h = w / r;
      if (h > innerHeight - 20) { h = innerHeight - 20; w = h * r; }
      if (w > innerWidth - 20) { w = innerWidth - 20; h = w / r; }
      const cx = sel.x + sel.w / 2;
      const cy = sel.y + sel.h / 2;
      sel = clampSel({ x: cx - w / 2, y: cy - h / 2, w, h });
    };
    const clampSel = (s) => {
      const w = Math.min(Math.max(40, s.w), innerWidth);
      const h = Math.min(Math.max(40, s.h), innerHeight);
      return { x: Math.min(Math.max(0, s.x), innerWidth - w), y: Math.min(Math.max(0, s.y), innerHeight - h), w, h };
    };

    let drag = null;
    areaUi.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.area-bar')) return;
      e.preventDefault();
      areaUi.setPointerCapture(e.pointerId);
      const handle = e.target.dataset?.h;
      if (handle) drag = { mode: handle, start: { ...sel }, x: e.clientX, y: e.clientY };
      else if (e.target === rectEl || e.target === sizeEl) drag = { mode: 'move', start: { ...sel }, x: e.clientX, y: e.clientY };
      else drag = { mode: 'new', x: e.clientX, y: e.clientY };
    });
    areaUi.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (drag.mode === 'new') {
        let w = Math.abs(dx);
        let h = ratio ? w / ratio : Math.abs(dy);
        const x = dx < 0 ? drag.x - w : drag.x;
        const y = (ratio ? (dy < 0 ? -1 : 1) : Math.sign(dy) || 1) < 0 ? drag.y - h : drag.y;
        if (w < 4 && h < 4) return;
        sel = { x, y, w: Math.max(4, w), h: Math.max(4, h) };
      } else if (drag.mode === 'move') {
        sel = clampSel({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy });
      } else {
        const s = { ...drag.start };
        if (drag.mode.includes('e')) s.w = drag.start.w + dx;
        if (drag.mode.includes('s')) s.h = drag.start.h + dy;
        if (drag.mode.includes('w')) { s.x = drag.start.x + dx; s.w = drag.start.w - dx; }
        if (drag.mode.includes('n')) { s.y = drag.start.y + dy; s.h = drag.start.h - dy; }
        if (ratio) {
          if (drag.mode === 'n' || drag.mode === 's') s.w = s.h * ratio;
          else s.h = s.w / ratio;
          if (drag.mode.includes('n')) s.y = drag.start.y + drag.start.h - s.h;
        }
        sel = { x: s.x, y: s.y, w: Math.max(40, s.w), h: Math.max(40, s.h) };
      }
      paint();
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      sel = clampSel(sel);
      paint();
    };
    areaUi.addEventListener('pointerup', end);
    areaUi.addEventListener('pointercancel', end);
    areaUi.querySelector('.area-bar').addEventListener('click', (e) => {
      const r = e.target.closest('[data-r]');
      if (r) {
        ratio = ratioOf(r.dataset.r);
        fit(ratio);
        paint();
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') send({ type: 'area:cancel' });
      if (act === 'go') confirmArea();
    });
    paint();
  }

  function confirmArea() {
    if (!sel) return;
    const s = { x: Math.round(sel.x), y: Math.round(sel.y), w: Math.round(sel.w), h: Math.round(sel.h), vw: innerWidth, vh: innerHeight };
    send({ type: 'area:chosen', area: s });
  }

  // ================================================================ teclado

  let pttDown = false;

  function ptt(down) {
    if (pttDown === down) return;
    pttDown = down;
    op('ptt', { down });
  }

  const editable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  addEventListener('keydown', (e) => {
    if (role === 'area') {
      if (e.key === 'Enter') { e.preventDefault(); confirmArea(); }
      else if (e.key === 'Escape') { e.preventDefault(); send({ type: 'area:cancel' }); }
      return;
    }
    if (role !== 'live' || !settings.pushToTalk || e.code !== settings.pttKey) return;
    if (editable(document.activeElement)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) ptt(true);
  }, true);
  addEventListener('keyup', (e) => {
    if (role !== 'live' || !settings.pushToTalk || e.code !== settings.pttKey || !pttDown) return;
    e.preventDefault();
    e.stopPropagation();
    ptt(false);
  }, true);
  addEventListener('blur', () => { if (pttDown) ptt(false); });

  addEventListener('resize', () => {
    if (toolbar) {
      tbPos = clampTb(tbPos);
      placeToolbar();
    }
    if (role === 'live' && rec.mode === 'area') renderArea();
  });

  // ================================================================ mensajes

  function onMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'grabazo:state') apply(msg);
    else if (msg.type === 'grabazo:cmd') {
      if (msg.cmd === 'clear') drawing?.clear();
      else if (msg.cmd === 'undo') drawing?.undo();
      else if (msg.cmd === 'unblur') effects?.clearBlur();
      else if (msg.cmd === 'camPlace') bubble?.place(msg.place);
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  // Los ajustes guardados pueden no tener todos los valores: el service worker los
  // devuelve completos (con los valores por defecto).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings && alive()) hello();
  });

  async function hello() {
    const res = await send({ type: 'overlay:hello' });
    if (res) apply(res);
  }

  globalThis.__grabazo = { hello };
  hello();
})();
