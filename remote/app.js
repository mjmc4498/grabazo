// Grabazo — página del celular.
// Se conecta por WebRTC (PeerJS) con la extensión de Chrome y ofrece tres pestañas:
// · Control: grabar, pausar, reiniciar y descartar; herramientas de dibujo, colores y
//   grosor; zoom, foco de luz, clics, difuminar, cámara, micrófono y barra; y un botón
//   grande para pulsar y hablar.
// · Guion: teleprompter con desplazamiento automático que arranca solo al grabar.
// · Cámara: envía la cámara y el micrófono del celular para usarlos como burbuja.

/* global Peer */
(() => {
  'use strict';

  const VERSION = '1.0.0';

  // Worker de Cloudflare que entrega credenciales temporales de retransmisión (TURN)
  // para redes que bloquean la conexión directa.
  const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';
  const FALLBACK_ICE = {
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
  };
  const ICE_REFRESH_MS = 3 * 60 * 60 * 1000;
  const COLORS = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#0A84FF', '#BF5AF2', '#FFFFFF', '#1C1C1E'];
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');

  // ================================================================ textos

  const TEXT = {
    settings: 'Ajustes', retry: 'Reintentar', done: 'Listo', privacy: 'Privacidad', madeBy: 'Creado por Miguel Mogrovejo',
    haptics: 'Vibración', keepAwake: 'Mantener la pantalla encendida', latency: 'Latencia', forget: 'Olvidar esta computadora', cancel: 'Cancelar',
    connected: 'Conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…', offline: 'Sin conexión',
    tabControl: 'Control', tabScript: 'Guion', tabCamera: 'Cámara',
    gateIdleTitle: 'Escanea el código', gateIdleBody: 'En Chrome, abre Grabazo, toca «Tu celular» y escanea el código QR con la cámara de tu celular.',
    gateConnectingTitle: 'Conectando…', gateConnectingBody: 'Buscando tu computadora.',
    gateWaitingTitle: 'Esperando a la computadora', gateWaitingBody: 'Abre Grabazo en Chrome y toca «Tu celular». Si muestra un código nuevo, escanéalo otra vez.',
    gateOfflineTitle: 'Sin conexión', gateOfflineBody: 'Revisa la conexión a internet de tu celular.',
    gateDeniedTitle: 'Código no válido', gateDeniedBody: 'Este código fue renovado. Escanea el código nuevo desde Grabazo.',
    gateEndedTitle: 'Conexión cerrada', gateEndedBody: 'Se desconectó el celular desde la computadora. Para volver, toca «Tu celular» en Grabazo.',
    gateKickedTitle: 'Desconectado', gateKickedBody: 'La computadora cerró la conexión con este celular.',
    gateFullTitle: 'Demasiados celulares', gateFullBody: 'Ya hay seis celulares conectados a esta computadora.',
    gateUnsupportedTitle: 'Navegador no compatible', gateUnsupportedBody: 'Abre este enlace en Chrome o Safari actualizados.',
    stIdle: 'Lista para grabar', stStarting: 'Preparando…', stPicking: 'Elige qué grabar en la computadora', stArea: 'Elige el área en la computadora',
    stCountdown: 'Cuenta regresiva', stRecording: 'Grabando', stPaused: 'En pausa', stSaving: 'Guardando…',
    modeTab: 'Pestaña', modeArea: 'Área', modeWindow: 'Ventana', modeScreen: 'Pantalla', modeCamera: 'Solo cámara',
    hintIdle: 'Toca el botón para empezar', hintRec: 'Toca para detener y guardar', hintCountdown: 'Toca para cancelar', hintSaving: 'Abriendo el estudio en la computadora',
    limitLeft: 'Quedan {t}', stop: 'Detener', restart: 'Reiniciar', pause: 'Pausar', resume: 'Reanudar', discard: 'Descartar', record: 'Grabar',
    confirmRestart: '¿Reiniciar? Se borra lo grabado hasta ahora y empieza otra vez.', confirmDiscard: '¿Descartar la grabación? Se perderá lo grabado.',
    talkHold: 'Mantén pulsado para hablar', talking: 'Hablando…',
    drawTitle: 'Dibujar en la pantalla', toolPen: 'Lápiz', toolHighlighter: 'Resaltador', toolArrow: 'Flecha', toolRect: 'Rectángulo',
    toolEllipse: 'Círculo', toolText: 'Texto', toolEraser: 'Borrador', toolMouse: 'Mouse', undo: 'Deshacer', clearAll: 'Borrar todo',
    fxTitle: 'Cursor y pantalla', zoom: 'Zoom', spotlight: 'Foco', clicks: 'Clics', blur: 'Difuminar', bubble: 'Burbuja', mic: 'Micrófono',
    toolbar: 'Barra', unblur: 'Quitar difuminado',
    onlyWhileRec: 'Se aplica mientras grabas',
    scriptEmptyTitle: 'Tu guion aparece aquí', scriptEmptyBody: 'Escríbelo en Grabazo (Ajustes › Guion) o toca ··· › Editar guion.',
    speed: 'Velocidad', toTop: 'Volver al inicio', play: 'Reproducir', prompterOptions: 'Opciones del guion', fontSize: 'Tamaño de la letra',
    mirrorText: 'Texto en espejo (para teleprompter con vidrio)', autoStart: 'Empezar al grabar', autoStartSub: 'El texto avanza solo cuando empieza la grabación y se detiene en pausa.',
    editScript: 'Editar guion', saveScript: 'Guardar', scriptPlaceholder: 'Escribe aquí lo que vas a decir…', scriptSaved: 'Guion guardado en la computadora',
    camOffTitle: 'Tu celular como cámara', camOffBody: 'Su cámara y su micrófono aparecen en la burbuja de la grabación, con los efectos de fondo de Grabazo.',
    camStart: 'Usar mi cámara', camStop: 'Apagar', camFlip: 'Girar', camLive: 'En la grabación', camWanted: 'Grabazo espera la cámara de tu celular: toca «Usar mi cámara».',
    camDenied: 'El navegador no dio acceso a la cámara. Permítelo en los ajustes del sitio.', camFailed: 'No se pudo abrir la cámara',
    camInsecure: 'La cámara solo funciona en una dirección segura (https).',
    usePhoneCam: 'Usar como cámara de la grabación', usePhoneCamSub: 'La burbuja muestra este celular en vez de la cámara de la computadora.',
    usePhoneMic: 'Usar como micrófono', usePhoneMicSub: 'Tu voz se graba con el micrófono del celular.',
    notConnected: 'Sin conexión con la computadora', failed: 'No se pudo: {e}',
    errRestricted: 'Abre Grabazo en la pestaña que quieres grabar', errTabPermission: 'Abre Grabazo con un clic en la pestaña que quieres grabar', errBusy: 'Ya hay una grabación en curso',
    errNoTab: 'Abre Grabazo en Chrome primero',
  };
  const t = (key, subs) => {
    let s = TEXT[key] ?? key;
    if (subs) for (const [k, v] of Object.entries(subs)) s = s.replace(`{${k}}`, v);
    return s;
  };

  document.documentElement.lang = 'es';
  for (const el of $$('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of $$('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  for (const el of $$('[data-t-ph]')) el.placeholder = t(el.dataset.tPh);
  $('#version').textContent = VERSION;

  // ================================================================ preferencias

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`grabazo.${key}`);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(`grabazo.${key}`);
        else localStorage.setItem(`grabazo.${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  const prefs = { haptics: true, wake: true, pSize: 34, pSpeed: 4, pMirror: false, pAuto: true, facing: 'user', ...store.get('prefs', {}) };
  const savePrefs = () => store.set('prefs', prefs);

  function buzz(pattern = 10) {
    if (prefs.haptics && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch {}
    }
  }

  let toastTimer = 0;
  function toast(text, { error = false } = {}) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('error', error);
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
  }

  function deviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    const m = ua.match(/Android [\d.]+; ([^;)]+)/);
    if (m && !/^K$/i.test(m[1].trim())) return m[1].trim().slice(0, 40);
    if (/Android/.test(ua)) return 'Android';
    return 'Celular';
  }

  // ================================================================ estado

  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');
  let session = null;
  let peer = null;
  let conn = null;
  let call = null;
  let connState = 'connecting';
  let everConnected = false;
  let retryTimer = 0;
  let retryDelay = 1200;
  let pingTimer = 0;
  let lastPong = 0;
  let clockOffset = 0; // Date.now() del celular − Date.now() de la computadora
  let rid = 0;
  const acks = new Map();

  let rec = { status: 'idle' };
  let ui = {};
  let hostPrefs = {};
  let camWant = false;
  let script = { text: '', updated: 0 };

  // ================================================================ sesión (QR)

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const id = h.get('id');
    const k = h.get('k');
    if (id && k && /^grabazo-[a-z0-9]{6,40}$/.test(id) && /^[a-z0-9]{8,64}$/.test(k)) {
      session = { id, k };
      store.set('session', session);
      // La clave no queda a la vista en la barra de direcciones.
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      session = store.get('session', null);
    }
  }

  // ================================================================ vista

  function renderStatus() {
    const s = rec.status || 'idle';
    app.dataset.rec = s;
    const names = { idle: 'stIdle', starting: 'stStarting', picking: 'stPicking', area: 'stArea', countdown: 'stCountdown', recording: 'stRecording', paused: 'stPaused', saving: 'stSaving' };
    $('#state-text').textContent = t(names[s] || 'stIdle');
    const modes = { tab: 'modeTab', area: 'modeArea', window: 'modeWindow', screen: 'modeScreen', camera: 'modeCamera' };
    const mode = s === 'idle' ? hostPrefs.mode : rec.mode;
    $('#mode-text').textContent = mode ? t(modes[mode] || 'modeTab') : '';
    const active = s === 'recording' || s === 'paused';
    $('#rec-chip').hidden = !active;
    $('#pause').disabled = !active;
    $('#restart').disabled = !active;
    $('#discard').hidden = !(active || s === 'countdown');
    $('#pause').setAttribute('aria-pressed', String(s === 'paused'));
    $('#pause-label').textContent = t(s === 'paused' ? 'resume' : 'pause');
    $('#rec-hint').textContent = s === 'idle' ? t('hintIdle') : active ? t('hintRec') : s === 'countdown' ? t('hintCountdown') : s === 'saving' ? t('hintSaving') : '';
    $('#rec').setAttribute('aria-label', active ? t('stop') : t('record'));

    // Herramientas y efectos
    for (const b of $$('#tools button')) {
      const tool = b.dataset.tool;
      b.setAttribute('aria-pressed', String(tool === 'none' ? !ui.tool : ui.tool === tool));
    }
    for (const b of $$('#colors button')) b.setAttribute('aria-pressed', String((ui.color || '').toLowerCase() === b.dataset.color.toLowerCase()));
    for (const b of $$('#widths button')) b.setAttribute('aria-checked', String(Number(b.dataset.v) === ui.width));
    for (const b of $$('#toggles button[data-key]')) {
      const k = b.dataset.key;
      if (k === 'unblur') continue;
      const on = k === 'toolbar' ? ui.toolbar !== false : k === 'mic' ? ui.mic !== false : !!ui[k];
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('off', (k === 'mic' && ui.mic === false) || (k === 'camera' && !ui.camera));
    }
    // Pulsar para hablar
    $('#talk').hidden = !hostPrefs.ptt;
    $('#talk').classList.toggle('on', !!ui.talking);
    $('#talk span').textContent = ui.talking ? t('talking') : t('talkHold');
    $('#toggles [data-key="mic"]').hidden = !!hostPrefs.ptt;

    // Cámara del celular
    $('#use-cam').checked = !!hostPrefs.camPhone;
    $('#use-mic').checked = !!hostPrefs.micPhone;
    const wants = !!camWant && !camTrack;
    $('#cam-want').hidden = !wants;
    $('#cam-badge').hidden = !wants;
    if (wants && !camAsked && app.dataset.view !== 'camera') {
      camAsked = true;
      toast(t('camWanted'));
      buzz([20, 60, 20]);
    }
    if (!camWant) camAsked = false;

    tickClock();
    autoPrompter();
  }
  let camAsked = false;

  function elapsed() {
    const now = Date.now() - clockOffset;
    const base = Number(rec.elapsed) || 0;
    return rec.status === 'recording' && rec.resumedAt ? base + Math.max(0, now - rec.resumedAt) : base;
  }

  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function tickClock() {
    const ms = elapsed();
    const limit = Number(rec.limit) || 0;
    const active = rec.status === 'recording' || rec.status === 'paused';
    $('#big-time').textContent = clock(active ? ms : 0);
    $('#chip-time').textContent = clock(ms);
    $('#limit-text').textContent = limit && active ? t('limitLeft', { t: clock(limit - ms) }) : '';
    app.classList.toggle('ending', !!limit && active && limit - ms <= 10_000);
    // Cuenta regresiva
    const left = rec.status === 'countdown' ? (rec.countdownEnd - (Date.now() - clockOffset)) : 0;
    const n = left > 150 ? Math.ceil(left / 1000) : 0;
    $('#countdown').hidden = !n;
    $('#prompter-count').hidden = !n;
    if (n && $('#countdown-n').textContent !== String(n)) {
      $('#countdown-n').textContent = String(n);
      $('#prompter-count').textContent = String(n);
      buzz(15);
    }
  }
  setInterval(tickClock, 200);

  // ================================================================ pestañas

  function setView(view) {
    app.dataset.view = view;
    for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === view));
    $('#view-control').hidden = view !== 'control';
    $('#view-script').hidden = view !== 'script';
    $('#view-camera').hidden = view !== 'camera';
    if (view === 'script') layoutPrompter();
    if (view === 'script' || camTrack) keepAwake();
    store.set('view', view);
  }
  for (const b of $$('.tabs button')) b.addEventListener('click', () => { buzz(6); setView(b.dataset.view); });

  // ================================================================ control remoto

  function op(name, data = {}) {
    if (demo) return Promise.resolve({ ok: true });
    if (!conn?.open || connState !== 'connected') {
      toast(t('notConnected'), { error: true });
      return Promise.resolve({ ok: false, error: 'offline' });
    }
    const id = ++rid;
    return new Promise((resolve) => {
      acks.set(id, resolve);
      send({ t: 'op', op: name, rid: id, ...data });
      setTimeout(() => {
        if (acks.has(id)) {
          acks.delete(id);
          resolve({ ok: false, error: 'timeout' });
        }
      }, 8000);
    });
  }

  const ERRORS = { restricted: 'errRestricted', 'no-tab': 'errNoTab', 'tab-permission': 'errTabPermission', busy: 'errBusy' };

  async function run(name, data) {
    buzz(12);
    const res = await op(name, data);
    if (res && res.ok === false && res.error && res.error !== 'offline') toast(t(ERRORS[res.error] || 'failed', { e: res.error }), { error: true });
    return res;
  }

  $('#rec').addEventListener('click', () => {
    const s = rec.status;
    if (s === 'idle') run('rec:start');
    else if (s === 'recording' || s === 'paused') run('rec:stop');
    else if (s === 'countdown' || s === 'area' || s === 'picking' || s === 'starting') run('rec:discard');
  });
  $('#pause').addEventListener('click', () => run('rec:togglePause'));
  $('#restart').addEventListener('click', () => { if (confirm(t('confirmRestart'))) run('rec:restart'); });
  $('#discard').addEventListener('click', () => { if (confirm(t('confirmDiscard'))) run('rec:discard'); });

  // Pulsar para hablar: mientras el dedo está sobre el botón.
  let talking = false;
  function talk(down) {
    if (talking === down) return;
    talking = down;
    $('#talk').classList.toggle('on', down);
    $('#talk span').textContent = down ? t('talking') : t('talkHold');
    buzz(down ? 18 : 8);
    op('ptt', { down });
  }
  const talkBtn = $('#talk');
  talkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); talkBtn.setPointerCapture(e.pointerId); talk(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) talkBtn.addEventListener(ev, () => talk(false));
  talkBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden) talk(false); });

  for (const c of COLORS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.color = c;
    b.style.background = c;
    b.setAttribute('aria-label', c);
    $('#colors').append(b);
  }
  $('#colors').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-color]');
    if (!b) return;
    const patch = { color: b.dataset.color };
    if (!ui.tool || ui.tool === 'eraser') patch.tool = 'pen';
    ui = { ...ui, ...patch };
    renderStatus();
    run('ui:set', { patch });
  });
  $('#tools').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tool]');
    if (!b) return;
    const tool = b.dataset.tool === 'none' ? null : b.dataset.tool;
    ui = { ...ui, tool };
    renderStatus();
    run('ui:set', { patch: { tool } });
  });
  $('#widths').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    ui = { ...ui, width: Number(b.dataset.v) };
    renderStatus();
    run('ui:set', { patch: { width: Number(b.dataset.v) } });
  });
  $('#undo').addEventListener('click', () => run('ui:undo'));
  $('#clear').addEventListener('click', () => run('ui:clear'));
  $('#toggles').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    if (b.dataset.key === 'unblur') run('ui:unblur');
    else run('ui:toggle', { key: b.dataset.key });
  });

  // ================================================================ guion (teleprompter)

  const ptext = $('#prompter-text');
  let playing = false;
  let lastFrame = 0;
  let raf = 0;
  let held = false;
  let lastRecStatus = 'idle';

  function renderScript() {
    const text = (script.text || '').trim();
    ptext.textContent = text;
    $('#prompter-empty').hidden = !!text;
    if (!text) setPlaying(false);
  }

  function layoutPrompter() {
    $('#prompter').style.setProperty('--p-size', `${prefs.pSize}px`);
    $('#prompter').classList.toggle('mirror', !!prefs.pMirror);
    $('#p-speed').value = String(prefs.pSpeed);
  }

  // Píxeles por segundo: crece con la velocidad y con el tamaño de la letra.
  const pxPerSecond = () => (8 + prefs.pSpeed * 9) * (prefs.pSize / 34);

  function frame(now) {
    raf = 0;
    if (!playing) return;
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    // Oculto (otra pestaña de la página): sigue «reproduciendo» sin avanzar.
    if (!held && ptext.clientHeight > 0) {
      ptext.scrollTop += pxPerSecond() * dt;
      if (ptext.scrollTop + ptext.clientHeight >= ptext.scrollHeight - 2) {
        setPlaying(false);
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    if (on && !(script.text || '').trim()) return;
    playing = on;
    $('#p-play').setAttribute('aria-pressed', String(on));
    lastFrame = 0;
    cancelAnimationFrame(raf);
    if (on) {
      keepAwake();
      raf = requestAnimationFrame(frame);
    }
  }

  // Arranca y se detiene con la grabación.
  function autoPrompter() {
    const s = rec.status;
    if (s === lastRecStatus) return;
    const before = lastRecStatus;
    lastRecStatus = s;
    if (!prefs.pAuto) return;
    if (s === 'recording' && (before === 'countdown' || before === 'paused' || before === 'idle' || before === 'starting')) {
      if (before !== 'paused' && ptext.scrollTop + ptext.clientHeight >= ptext.scrollHeight - 4) ptext.scrollTop = 0;
      if (before === 'countdown' || before === 'starting') ptext.scrollTop = 0;
      setPlaying(true);
    } else if (s === 'paused' || s === 'saving' || s === 'idle') {
      setPlaying(false);
    }
  }

  $('#p-play').addEventListener('click', () => { buzz(8); setPlaying(!playing); });
  $('#p-top').addEventListener('click', () => { ptext.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#p-speed').addEventListener('input', (e) => { prefs.pSpeed = Number(e.target.value); savePrefs(); });
  ptext.addEventListener('pointerdown', () => { held = true; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) ptext.addEventListener(ev, () => { held = false; lastFrame = 0; });
  ptext.addEventListener('click', () => { if (!$('#prompter-empty').hidden) return; setPlaying(!playing); });

  const pSheet = $('#p-sheet');
  $('#p-more').addEventListener('click', () => {
    $('#p-size').value = String(prefs.pSize);
    $('#p-mirror').checked = !!prefs.pMirror;
    $('#p-auto').checked = !!prefs.pAuto;
    pSheet.showModal();
  });
  $('#p-size').addEventListener('input', (e) => { prefs.pSize = Number(e.target.value); savePrefs(); layoutPrompter(); });
  $('#p-mirror').addEventListener('change', (e) => { prefs.pMirror = e.target.checked; savePrefs(); layoutPrompter(); });
  $('#p-auto').addEventListener('change', (e) => { prefs.pAuto = e.target.checked; savePrefs(); });

  const editor = $('#p-editor');
  $('#p-edit').addEventListener('click', () => {
    pSheet.close();
    $('#p-input').value = script.text || '';
    editor.showModal();
  });
  $('#p-cancel').addEventListener('click', () => editor.close('cancel'));
  editor.addEventListener('close', () => {
    if (editor.returnValue !== 'save') return;
    script = { text: $('#p-input').value.slice(0, 50_000), updated: Date.now() };
    renderScript();
    if (send({ t: 'script', text: script.text })) toast(t('scriptSaved'));
  });

  // ================================================================ cámara del celular

  const camVideo = $('#cam-video');
  let camTrack = null;
  let micTrack = null;
  let camStarting = false;

  function videoConstraints(facing) {
    return { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  }

  async function startCamera() {
    if (camStarting || camTrack) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { toast(t('camInsecure'), { error: true }); return; }
    camStarting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(prefs.facing),
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }).catch(async (err) => {
        // Sin micrófono disponible: al menos la cámara.
        if (err.name === 'NotAllowedError') throw err;
        return navigator.mediaDevices.getUserMedia({ video: videoConstraints(prefs.facing) });
      });
      camTrack = stream.getVideoTracks()[0] || null;
      micTrack = stream.getAudioTracks()[0] || null;
      camTrack?.addEventListener('ended', () => stopCamera());
      camVideo.srcObject = new MediaStream(camTrack ? [camTrack] : []);
      camVideo.play().catch(() => {});
      callHost();
      keepAwake();
      buzz(20);
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? t('camDenied') : t('camFailed'), { error: true });
    } finally {
      camStarting = false;
      renderCamera();
    }
  }

  function stopCamera() {
    try { call?.close(); } catch {}
    call = null;
    camTrack?.stop();
    micTrack?.stop();
    camTrack = micTrack = null;
    camVideo.srcObject = null;
    sendMedia();
    renderCamera();
  }

  async function flipCamera() {
    if (!camTrack) return;
    prefs.facing = prefs.facing === 'user' ? 'environment' : 'user';
    savePrefs();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(prefs.facing) });
      const next = stream.getVideoTracks()[0];
      camTrack.stop();
      camTrack = next;
      next.addEventListener('ended', () => stopCamera());
      camVideo.srcObject = new MediaStream([next]);
      replace('video', next);
      sendMedia();
    } catch {
      toast(t('camFailed'), { error: true });
    }
    renderCamera();
  }

  function toggleMic() {
    if (!micTrack) return;
    micTrack.enabled = !micTrack.enabled;
    sendMedia();
    renderCamera();
  }

  function senders() {
    const pc = call?.peerConnection;
    if (!pc) return {};
    const out = {};
    for (const s of pc.getSenders()) {
      const kind = s.track?.kind || pc.getTransceivers().find((tr) => tr.sender === s)?.receiver.track?.kind;
      if (kind) out[kind] = s;
    }
    return out;
  }

  function replace(kind, track) {
    const sender = senders()[kind];
    if (sender) sender.replaceTrack(track).catch(() => {});
  }

  function callHost() {
    if (demo || !camTrack || !peer || peer.destroyed || !peer.open || !session || connState !== 'connected') return;
    try { call?.close(); } catch {}
    const c = peer.call(session.id, new MediaStream([camTrack, micTrack].filter(Boolean)), { metadata: { kind: 'cam' } });
    if (!c) return;
    call = c;
    const pc = c.peerConnection;
    pc?.addEventListener('connectionstatechange', () => {
      if (call !== c || pc.connectionState !== 'connected') return;
      const sender = senders().video;
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      params.encodings[0].maxBitrate = 3_000_000;
      params.degradationPreference = 'maintain-framerate';
      sender.setParameters(params).catch(() => {});
    });
    c.on('close', () => {
      if (call !== c) return;
      call = null;
      if (camTrack && conn?.open && connState === 'connected') setTimeout(() => { if (!call) callHost(); }, 1500);
    });
    c.on('error', () => {});
    sendMedia();
  }

  function sendMedia() {
    send({
      t: 'media',
      cam: { on: !!camTrack, facing: prefs.facing, label: camTrack?.label?.slice(0, 60) || '' },
      mic: { on: !!micTrack && micTrack.enabled },
    });
  }

  function renderCamera() {
    const on = !!camTrack;
    $('#cam-off').hidden = on;
    $('#cam-start').hidden = on;
    $('#cam-controls').hidden = !on;
    $('#cam-live').hidden = !on || !call;
    $('#cam-preview').classList.toggle('back', prefs.facing === 'environment');
    $('#cam-mic').querySelector('span').textContent = micTrack?.enabled === false ? `${t('mic')} ✕` : t('mic');
    $('#cam-mic').style.opacity = micTrack ? '' : '.35';
    renderStatus();
  }

  $('#cam-start').addEventListener('click', startCamera);
  $('#cam-stop').addEventListener('click', stopCamera);
  $('#cam-flip').addEventListener('click', flipCamera);
  $('#cam-mic').addEventListener('click', toggleMic);
  $('#use-cam').addEventListener('change', async (e) => {
    const on = e.target.checked;
    hostPrefs = { ...hostPrefs, camPhone: on };
    await run('prefs:set', { patch: { camPhone: on } });
    if (on && !camTrack) startCamera();
  });
  $('#use-mic').addEventListener('change', async (e) => {
    const on = e.target.checked;
    hostPrefs = { ...hostPrefs, micPhone: on };
    await run('prefs:set', { patch: { micPhone: on } });
    if (on && !camTrack) startCamera();
  });

  // ================================================================ conexión

  const GATE = {
    // estado: [título, texto, spinner, reintentar]
    idle: ['gateIdleTitle', 'gateIdleBody', false, false],
    connecting: ['gateConnectingTitle', 'gateConnectingBody', true, false],
    waiting: ['gateWaitingTitle', 'gateWaitingBody', true, false],
    offline: ['gateOfflineTitle', 'gateOfflineBody', true, true],
    denied: ['gateDeniedTitle', 'gateDeniedBody', false, false],
    ended: ['gateEndedTitle', 'gateEndedBody', false, true],
    kicked: ['gateKickedTitle', 'gateKickedBody', false, true],
    full: ['gateFullTitle', 'gateFullBody', false, true],
    unsupported: ['gateUnsupportedTitle', 'gateUnsupportedBody', false, false],
  };
  const BLOCKING = new Set(['idle', 'denied', 'kicked', 'unsupported', 'ended', 'full']);

  function setConn(state) {
    connState = state;
    const shown = state === 'connecting' && everConnected ? 'reconnecting' : state;
    app.dataset.conn = shown;
    const labels = { connected: 'connected', connecting: 'connecting', reconnecting: 'reconnecting', waiting: 'reconnecting', offline: 'offline' };
    $('#status-text').textContent = t(labels[shown] || 'offline');
    const ready = state === 'connected' || (everConnected && !BLOCKING.has(state));
    app.classList.toggle('ready', ready);
    const [title, body, spinner, retry] = GATE[state] || GATE.connecting;
    $('#gate-title').textContent = t(title);
    $('#gate-body').textContent = t(body);
    $('#gate-spinner').hidden = !spinner;
    $('#gate-retry').hidden = !retry;
    if (BLOCKING.has(state) && camTrack) stopCamera();
  }

  function scheduleRetry(fn, delay = retryDelay) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(fn, delay);
    retryDelay = Math.min(retryDelay * 1.5, 6000);
  }

  // Credenciales de retransmisión: si el Worker no responde, se usa la conexión directa.
  let icePromise = null;
  function getIce() {
    if (!icePromise) {
      icePromise = (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
          setTimeout(() => { icePromise = null; }, ICE_REFRESH_MS);
          return { iceServers: data.iceServers };
        } catch {
          icePromise = null;
          return FALLBACK_ICE;
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    return icePromise;
  }

  let startingPeer = false;
  async function startPeer() {
    if (!session) { setConn('idle'); return; }
    if (typeof Peer === 'undefined' || !window.RTCPeerConnection) { setConn('unsupported'); return; }
    if (peer && !peer.destroyed) {
      if (peer.disconnected) peer.reconnect();
      else if (peer.open) openConn();
      return;
    }
    if (startingPeer) return;
    if (!everConnected) setConn('connecting');
    startingPeer = true;
    const config = await getIce();
    startingPeer = false;
    if (peer && !peer.destroyed) return;
    peer = new Peer({ debug: 0, config });
    const current = peer;
    current.on('open', () => { if (current === peer) openConn(); });
    // La computadora nunca llama al celular: solo recibe.
    current.on('call', (c) => { try { c.close(); } catch {} });
    current.on('disconnected', () => {
      if (current !== peer || current.destroyed) return;
      scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
    });
    current.on('error', (err) => {
      if (current !== peer) return;
      switch (err.type) {
        case 'peer-unavailable':
          if (!BLOCKING.has(connState)) setConn('waiting');
          scheduleRetry(openConn);
          break;
        case 'browser-incompatible':
          setConn('unsupported');
          break;
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
          if (!conn?.open) setConn('offline');
          scheduleRetry(restartPeer);
          break;
        default:
          scheduleRetry(restartPeer);
      }
    });
  }

  function restartPeer() {
    try { peer?.destroy(); } catch {}
    peer = null;
    call = null;
    startPeer();
  }

  function openConn() {
    clearTimeout(retryTimer);
    if (!session || !peer || peer.destroyed || peer.disconnected || !peer.open) return;
    if (conn) {
      try { conn.removeAllListeners(); conn.close(); } catch {}
    }
    const c = peer.connect(session.id, { serialization: 'json', reliable: true });
    conn = c;
    if (!BLOCKING.has(connState)) setConn(everConnected ? 'reconnecting' : 'connecting');
    const timeout = setTimeout(() => {
      if (c === conn && !c.open) {
        try { c.close(); } catch {}
        if (!BLOCKING.has(connState)) setConn('waiting');
        scheduleRetry(openConn);
      }
    }, 12000);
    c.on('open', () => {
      clearTimeout(timeout);
      c.send({ t: 'hello', k: session.k, name: deviceName(), v: 1 });
    });
    c.on('data', (msg) => { if (c === conn) onData(msg); });
    c.on('close', () => {
      clearTimeout(timeout);
      if (c !== conn) return;
      conn = null;
      stopPing();
      talk(false);
      if (['denied', 'kicked', 'unsupported', 'idle', 'full'].includes(connState)) return;
      if (connState !== 'ended') setConn('waiting');
      scheduleRetry(openConn, connState === 'ended' ? 4000 : retryDelay);
    });
    c.on('error', () => {});
  }

  function applyState(m) {
    if (typeof m.now === 'number') clockOffset = Date.now() - m.now;
    if (m.rec && typeof m.rec === 'object') rec = m.rec;
    if (m.ui && typeof m.ui === 'object') ui = m.ui;
    if (m.prefs && typeof m.prefs === 'object') hostPrefs = m.prefs;
    camWant = m.camWant === true;
    renderStatus();
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome':
        everConnected = true;
        retryDelay = 1200;
        lastPong = Date.now();
        applyState(msg);
        if (typeof msg.script?.text === 'string') {
          script = { text: msg.script.text, updated: Number(msg.script.updated) || 0 };
          renderScript();
        }
        setConn('connected');
        startPing();
        if (camTrack) callHost();
        sendMedia();
        buzz(20);
        break;
      case 'state':
        applyState(msg);
        break;
      case 'script':
        if (typeof msg.text === 'string' && msg.text !== script.text) {
          script = { text: msg.text, updated: Number(msg.updated) || 0 };
          renderScript();
        }
        break;
      case 'ack': {
        const resolve = acks.get(msg.rid);
        if (resolve) {
          acks.delete(msg.rid);
          resolve({ ok: msg.ok !== false, error: msg.error || null });
        }
        break;
      }
      case 'pong':
        lastPong = Date.now();
        if (typeof msg.now === 'number') clockOffset = Date.now() - msg.now - Math.round((Date.now() - msg.ts) / 2);
        $('#latency').textContent = `${Math.max(1, Math.round((Date.now() - msg.ts) / 2))} ms`;
        break;
      case 'denied':
        session = null;
        store.set('session', null);
        setConn('denied');
        closeConn();
        break;
      case 'bye':
        if (msg.reason === 'revoked') {
          session = null;
          store.set('session', null);
          setConn('denied');
          closeConn();
        } else if (msg.reason === 'kicked' || msg.reason === 'full') {
          setConn(msg.reason);
          closeConn();
        } else {
          setConn('ended');
        }
        break;
    }
  }

  function closeConn() {
    clearTimeout(retryTimer);
    stopPing();
    const c = conn;
    conn = null;
    try { c?.removeAllListeners(); c?.close(); } catch {}
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (!conn?.open) return;
      if (Date.now() - lastPong > 15000) {
        // Conexión colgada: forzar reconexión.
        const c = conn;
        conn = null;
        try { c.close(); } catch {}
        setConn('waiting');
        restartPeer();
        return;
      }
      send({ t: 'ping', ts: Date.now() });
    }, 4000);
  }

  function stopPing() {
    clearInterval(pingTimer);
  }

  function send(msg) {
    if (demo) return true;
    if (conn?.open && connState === 'connected') {
      try { conn.send(msg); return true; } catch {}
    }
    return false;
  }

  $('#gate-retry').addEventListener('click', () => {
    retryDelay = 1200;
    if (connState === 'ended' || connState === 'kicked' || connState === 'full') setConn('connecting');
    if (!session) readHash();
    restartPeer();
  });

  // ================================================================ pantalla encendida

  let wakeLock = null;

  async function keepAwake() {
    if (!prefs.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible' || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch {}
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (app.dataset.view === 'script' || camTrack || rec.status === 'recording') keepAwake();
    // Al volver a la página se revisa la conexión enseguida.
    if (!demo && session && (!conn?.open || peer?.disconnected)) {
      retryDelay = 1200;
      startPeer();
    }
  });

  // ================================================================ ajustes

  const sheet = $('#settings');
  $('#open-settings').addEventListener('click', () => {
    $('#haptics').checked = !!prefs.haptics;
    $('#wake').checked = !!prefs.wake;
    sheet.showModal();
  });
  $('#haptics').addEventListener('change', (e) => { prefs.haptics = e.target.checked; savePrefs(); });
  $('#wake').addEventListener('change', (e) => {
    prefs.wake = e.target.checked;
    savePrefs();
    if (!prefs.wake) { try { wakeLock?.release(); } catch {} wakeLock = null; } else keepAwake();
  });
  $('#forget').addEventListener('click', () => {
    store.set('session', null);
    session = null;
    stopCamera();
    closeConn();
    try { peer?.destroy(); } catch {}
    peer = null;
    sheet.close();
    setConn('idle');
  });
  for (const d of $$('dialog.sheet')) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  }

  // ================================================================ demostración (?demo)

  function startDemo() {
    everConnected = true;
    const view = params.get('view') || 'control';
    const status = params.get('rec') || 'recording';
    rec = { status, mode: params.get('mode') || 'tab', elapsed: 83_000, resumedAt: status === 'recording' ? Date.now() : 0, limit: params.has('limit') ? 300_000 : 0, countdownEnd: status === 'countdown' ? Date.now() + 3000 : 0 };
    ui = { tool: params.get('tool') || 'pen', color: '#FF9F0A', width: 6, spotlight: true, zoom: false, clicks: true, blur: false, toolbar: true, camera: true, mic: true, talking: false };
    hostPrefs = { mode: 'tab', ptt: params.has('ptt'), camPhone: params.has('camphone'), micPhone: false };
    camWant = params.has('want');
    script = {
      text: 'Hola, soy Miguel y hoy te muestro cómo grabar un tutorial en un minuto.\n\nPrimero, abre la página que quieres explicar y haz clic en el ícono de Grabazo.\n\nElige Pestaña, enciende tu cámara y pulsa Grabar. Mientras hablas, usa el lápiz para señalar lo importante y el zoom para acercarte a los detalles.\n\nCuando termines, recorta el inicio y el final en el estudio y exporta a MP4. ¡Listo para compartir!',
      updated: Date.now(),
    };
    renderScript();
    setConn('connected');
    renderStatus();
    renderCamera();
    if (params.has('playing') && view === 'script') setTimeout(() => { ptext.scrollTop = 120; }, 50);
    setView(view);
  }

  // ================================================================ inicio

  layoutPrompter();
  renderScript();
  renderCamera();
  setView(store.get('view', 'control'));
  addEventListener('hashchange', () => { readHash(); restartPeer(); });

  if (demo) {
    startDemo();
  } else {
    readHash();
    setConn(session ? 'connecting' : 'idle');
    startPeer();
  }
})();
