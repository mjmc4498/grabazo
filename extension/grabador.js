// Grabazo — grabador.
// Pestaña propia (fijada a la izquierda mientras se graba) que captura lo que se graba
// (pestaña, área, ventana, pantalla o solo la cámara), mezcla el audio (micrófono,
// sonido del sistema y micrófono del celular, con pulsar para hablar), compone el video
// (área, zoom dinámico, espejo y, en los modos ventana y pantalla, la cámara encima) y lo
// guarda por partes en la computadora. Al terminar abre el estudio para recortar y exportar.

/* global GrabazoRelay */

import { QUALITIES, PHONE, CAM_OVERLAY, CAM_CORNERS, clock, elapsedOf, normalizeSettings, normalizePlace, saveSettings } from './config.js';
import { saveChunk, clearChunks, chunksOf, putVideo, defaultTitle } from './lib/db.js';
import { createCompositor } from './lib/compositor.js';
import { t, applyI18n } from './lib/i18n.js';

const $ = (sel) => document.querySelector(sel);
const jobId = decodeURIComponent(location.hash.slice(1));
const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);

let job = null;
let settings = {};
let ui = {};
let rec = { status: 'starting' };
let capture = null; // pantalla, ventana o pestaña
let relay = null; // cámara (modo cámara) y micrófono del celular
let relayState = null;
let micStream = null;
let mixer = null;
let comp = null;
let recorder = null;
let mime = '';
let chunkIndex = 0;
let saveQueue = Promise.resolve();
let phase = 'preparing';
let surface = '';
let discardOnStop = false;
let thumb = null;
let activeMs = 0;
let activeSince = 0;
let warned = false;
let autoZoomTimer = 0;
let finished = false;
// Cámara dentro del video (modos ventana y pantalla): dónde va y si se está arrastrando.
let overlayCam = false;
let place = { x: 0, y: 1 };
let dragging = null;

applyI18n();
document.title = t('recTitlePreparing');

// ================================================================ fuentes

function pickDesktop(sources) {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, options) => {
      resolve({ streamId, audio: !!options?.canRequestAudioTrack });
    });
  });
}

async function openCapture() {
  const q = QUALITIES[settings.quality] || QUALITIES[1080];
  const fps = settings.fps || 30;
  if (job.mode === 'tab' || job.mode === 'area') {
    // En el modo área se captura con más detalle y luego se recorta. Nunca por encima de
    // los píxeles reales de la pestaña: para dar más, Chrome la vuelve a dibujar ampliada
    // y la burbuja de la cámara (un iframe) sale agrandada y recortada en el video.
    const top = job.mode === 'area' ? QUALITIES[2160] : q;
    const v = job.view;
    const max = v ? { w: Math.min(top.w, Math.round(v.w * v.dpr)), h: Math.min(top.h, Math.round(v.h * v.dpr)) } : top;
    const constraints = {
      audio: settings.systemAudio ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: job.streamId } } : false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: job.streamId,
          // Mínimo distinto en proporción al máximo: el tamaño sigue al de la pestaña.
          minWidth: 2,
          minHeight: 2,
          maxWidth: max.w,
          maxHeight: max.h,
          maxFrameRate: fps,
        },
      },
    };
    surface = 'browser';
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  setPhase('picking');
  const sources = [job.mode === 'screen' ? 'screen' : 'window'];
  if (settings.systemAudio) sources.push('audio');
  const pick = await pickDesktop(sources);
  if (!pick.streamId) throw Object.assign(new Error('canceled'), { reason: 'canceled' });
  setPhase('preparing');
  const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: pick.streamId, maxWidth: q.w, maxHeight: q.h, maxFrameRate: fps } };
  const audio = pick.audio ? { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: pick.streamId } } : false;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio, video });
  } catch (err) {
    if (!audio) throw err;
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  }
  surface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface || (job.mode === 'screen' ? 'monitor' : 'window');
  return stream;
}

// La cámara (de la computadora o del celular, con sus efectos) y el micrófono del
// celular llegan del documento offscreen por una conexión local.
function openRelay(kind) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    relay = GrabazoRelay.connect({
      kind,
      onStream: (stream, track) => {
        // En el modo cámara la imagen es la del video; en ventana y pantalla va encima de la
        // captura. Con el micrófono del celular también llega una pista de video vacía que
        // no debe reemplazar a la captura.
        if (kind === 'recorder' && track.kind === 'video' && comp) {
          if (overlayCam) comp.setCamera(track);
          else comp.setInput(track);
        }
        if (track.kind === 'audio') mixer?.addPhone(stream);
        if (kind === 'recorder' ? track.kind === 'video' : track.kind === 'audio') finish();
        renderCamWait();
      },
      onState: (state) => {
        relayState = state;
        renderCamWait();
        renderHandle();
      },
      onIdle: () => toSW({ type: 'cam:wake' }),
    });
    setTimeout(finish, kind === 'recorder' ? 20000 : 4000);
  });
}

async function openMic() {
  if (!settings.mic || settings.micId === PHONE) return null;
  const audio = { echoCancellation: true, noiseSuppression: settings.noiseSuppression, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: settings.micId ? { ...audio, deviceId: { exact: settings.micId } } : audio });
  } catch (err) {
    if (settings.micId && ['OverconstrainedError', 'NotFoundError'].includes(err.name)) {
      try { return await navigator.mediaDevices.getUserMedia({ audio }); } catch {}
    }
    showWarn(err.name === 'NotAllowedError' ? t('recWarnMicDenied') : t('recWarnMicFailed'));
    return null;
  }
}

// ================================================================ audio

// Mezcla el micrófono (con su volumen para silenciar y pulsar para hablar), el sonido
// del sistema o de la pestaña y el micrófono del celular en una sola pista.
function createMixer({ mic, system, playSystem }) {
  let ctx;
  try {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  } catch {
    ctx = null;
  }
  const dest = ctx?.createMediaStreamDestination();
  const micGain = ctx?.createGain();
  if (micGain) {
    micGain.gain.value = 0;
    micGain.connect(dest);
  }
  const sinks = [];
  const nodes = [];

  // Chrome solo entrega el audio de una conexión WebRTC si algo lo reproduce.
  function keepAlive(stream) {
    const el = Object.assign(new Audio(), { muted: true });
    el.srcObject = stream;
    el.play().catch(() => {});
    sinks.push(el);
  }

  function connect(stream, gainNode) {
    if (!ctx || !stream?.getAudioTracks().length) return;
    const src = ctx.createMediaStreamSource(stream);
    src.connect(gainNode || dest);
    nodes.push(src);
    return src;
  }

  if (mic) connect(mic, micGain);
  if (system?.getAudioTracks().length) {
    const src = connect(system);
    // Al capturar una pestaña Chrome la silencia: se vuelve a escuchar por los parlantes.
    if (src && playSystem) src.connect(ctx.destination);
  }
  ctx?.resume().catch(() => {});

  let phoneSrc = null;
  const api = {
    get running() { return ctx?.state === 'running'; },
    get track() { return dest?.stream.getAudioTracks()[0] || null; },
    addPhone(stream) {
      if (!ctx || !settings.mic || settings.micId !== PHONE) return;
      const track = stream.getAudioTracks()[0];
      if (!track || phoneSrc?.track === track) return;
      try { phoneSrc?.node.disconnect(); } catch {}
      keepAlive(stream);
      const node = ctx.createMediaStreamSource(new MediaStream([track]));
      node.connect(micGain);
      phoneSrc = { track, node };
    },
    setMic(on) {
      if (micGain) micGain.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.012);
      // Sin mezcla (Chrome no dejó iniciar el audio): se silencia la pista directamente.
      for (const tr of mic?.getAudioTracks() || []) if (!api.running) tr.enabled = on;
    },
    beep() {
      if (ctx?.state !== 'running') return;
      // Aviso de límite de tiempo: solo por los parlantes, no entra en la grabación.
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    },
    close() {
      for (const el of sinks) el.srcObject = null;
      for (const n of nodes) try { n.disconnect(); } catch {}
      ctx?.close().catch(() => {});
    },
  };
  return api;
}

// Si Chrome no deja iniciar la mezcla, se graba la pista disponible tal cual.
function audioTracks() {
  if (mixer?.running && mixer.track) {
    const hasInput = micStream || capture?.getAudioTracks().length || (settings.micId === PHONE && settings.mic);
    return hasInput ? [mixer.track] : [];
  }
  const fallback = micStream?.getAudioTracks()[0] || capture?.getAudioTracks()[0] || relay?.stream.getAudioTracks()[0];
  if (fallback) showWarn(t('recWarnMixer'));
  return fallback ? [fallback] : [];
}

function micOpen() {
  return settings.pushToTalk ? !!ui.talking : ui.mic !== false;
}

// ================================================================ preparación

async function prepare() {
  job = await toSW({ type: 'rec:job' });
  if (!job?.ok) return fail(job?.error || 'stale');
  settings = job.settings || {};
  ui = job.ui || {};
  document.body.dataset.mode = job.mode;
  overlayCam = (job.mode === 'window' || job.mode === 'screen') && !!settings.camera;
  place = normalizePlace(settings.camPlace) || place;
  renderInfo();

  let videoTrack = null;
  try {
    if (job.mode === 'camera') {
      await openRelay('recorder');
      videoTrack = relay.stream.getVideoTracks()[0] || null;
      if (!videoTrack) throw Object.assign(new Error('camera'), { reason: relayState?.error === 'denied' ? 'camera-denied' : 'camera' });
    } else {
      capture = await openCapture();
      videoTrack = capture.getVideoTracks()[0];
      // La cámara (y el micrófono del celular, si se usa) llegan por la misma conexión.
      if (overlayCam) openRelay('recorder');
      else if (settings.micId === PHONE && settings.mic) openRelay('recorder-mic');
    }
  } catch (err) {
    console.warn('[Grabazo] captura', err?.name, err?.message);
    return fail(err.reason || (err.name === 'NotAllowedError' && job.mode !== 'tab' && job.mode !== 'area' ? 'canceled' : 'capture'), `${err?.name}: ${err?.message}`);
  }

  videoTrack.addEventListener('ended', () => {
    // Se cerró la pestaña grabada o se pulsó «Dejar de compartir».
    if (job.mode !== 'camera' && !finished) toSW({ type: 'rec:ended' });
  });

  micStream = await openMic();
  mixer = createMixer({ mic: micStream, system: capture, playSystem: job.mode === 'tab' || job.mode === 'area' });
  if (relay?.stream.getAudioTracks().length) mixer.addPhone(relay.stream);
  mixer.setMic(micOpen());

  const q = QUALITIES[settings.quality] || QUALITIES[1080];
  const crop = job.mode === 'area' && job.area ? normalizeArea(job.area) : null;
  comp = createCompositor(videoTrack, {
    crop,
    mirror: job.mode === 'camera' && settings.camMirror,
    maxW: job.mode === 'area' ? q.w : undefined,
    maxH: job.mode === 'area' ? q.h : undefined,
    fps: settings.fps || 30,
  });
  if (overlayCam) {
    const camTrack = relay?.stream.getVideoTracks()[0];
    if (camTrack) comp.setCamera(camTrack);
    applyCam(true);
  }
  const preview = $('#preview');
  preview.srcObject = new MediaStream([comp.track]);
  preview.play().catch(() => {});

  // Se espera el primer cuadro un momento; si la página está quieta, se usa el tamaño de
  // la pista y la imagen llega con el primer cambio en pantalla.
  let size = await Promise.race([comp.ready, new Promise((r) => setTimeout(() => r(null), 2500))]);
  if (!size) {
    const { width, height } = videoTrack.getSettings?.() || {};
    comp.prime(width, height);
    size = comp.size.width ? comp.size : await Promise.race([comp.ready, new Promise((r) => setTimeout(() => r(null), 6000))]);
  }
  if (!size) return fail('capture', 'sin imagen de la captura');
  // Con la cámara dentro del video, antes de grabar se elige dónde va (si no se pidió
  // saltar este paso).
  const ask = overlayCam && settings.camAsk !== false;
  setPhase(ask ? 'placing' : 'ready');
  toSW({ type: 'rec:ready', ok: true, width: size.width, height: size.height, place: ask });
}

function normalizeArea(a) {
  const x = Math.max(0, Math.min(1, a.x / a.vw));
  const y = Math.max(0, Math.min(1, a.y / a.vh));
  return { x, y, w: Math.max(0.02, Math.min(1 - x, a.w / a.vw)), h: Math.max(0.02, Math.min(1 - y, a.h / a.vh)) };
}

// ================================================================ grabación

function pickMime(format) {
  const mp4 = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.4d0033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const order = format === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  return order.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

// Estado interno para diagnóstico (lo leen las pruebas).
const debug = {
  chunks: 0,
  bytes: 0,
  audio: '',
  mixer: '',
  log: [],
  get cam() { return { overlay: overlayCam, live: !!comp?.cameraLive, rect: comp?.cameraRect || null, size: comp?.size || null, place, visible: camVisible() }; },
  thumbnail: (w) => comp?.thumbnail(w),
};
globalThis.__grabador = debug;

function go() {
  if ((phase !== 'ready' && phase !== 'placing') || !comp) return;
  const audio = audioTracks();
  debug.mixer = mixer?.running ? 'running' : 'suspended';
  debug.audio = audio.map((tr) => `${tr.label || tr.kind}:${tr.readyState}`).join(',');
  const tracks = [comp.track, ...audio];
  const q = QUALITIES[settings.quality] || QUALITIES[1080];
  mime = pickMime(settings.format);
  try {
    recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime,
      videoBitsPerSecond: Math.round(q.bitrate * (settings.fps === 60 ? 1.5 : 1)),
      audioBitsPerSecond: 160_000,
      // Un cuadro clave cada 2 s: el MP4 sale por partes durante la grabación (y no
      // todo al final), así lo grabado se guarda en el disco sobre la marcha.
      videoKeyFrameIntervalDuration: 2000,
    });
  } catch {
    try {
      mime = '';
      recorder = new MediaRecorder(new MediaStream(tracks));
    } catch {
      return fail('recorder');
    }
  }
  const current = recorder;
  mime = current.mimeType || mime || 'video/webm';
  chunkIndex = 0;
  current.ondataavailable = (e) => {
    debug.chunks++;
    debug.bytes += e.data?.size || 0;
    if (e.data?.size && !discardOnStop && current === recorder) {
      const i = chunkIndex++;
      const blob = e.data;
      saveQueue = saveQueue.then(() => saveChunk(jobId, i, blob, i === 0 ? { mime, mode: job.mode, created: Date.now() } : null)).catch((err) => {
        console.debug('[Grabazo] guardado', err);
        showWarn(t('recWarnDisk'));
      });
    }
    if (current.state === 'recording') toSW({ type: 'rec:tick' });
  };
  current.onstop = () => onRecorderStop(current);
  current.onerror = () => {
    if (current === recorder && !finished) finalize(true);
  };
  current.start(1000);
  activeMs = 0;
  activeSince = performance.now();
  thumb = null;
  setPhase('recording');
  toSW({ type: 'rec:started', at: Date.now() });
  setTimeout(async () => { if (comp && !thumb) thumb = await comp.thumbnail(); }, 1500);
}

function pause() {
  if (recorder?.state !== 'recording') return;
  recorder.pause();
  activeMs += performance.now() - activeSince;
  activeSince = 0;
  setPhase('paused');
}

function resume() {
  if (recorder?.state !== 'paused') return;
  recorder.resume();
  activeSince = performance.now();
  setPhase('recording');
}

function stop() {
  if (!recorder || recorder.state === 'inactive') return finalize();
  if (activeSince) activeMs += performance.now() - activeSince;
  activeSince = 0;
  setPhase('saving');
  recorder.requestData?.();
  recorder.stop();
}

async function restart() {
  discardOnStop = true;
  const old = recorder;
  recorder = null;
  if (old && old.state !== 'inactive') old.stop();
  await saveQueue;
  await clearChunks(jobId).catch(() => {});
  discardOnStop = false;
  activeMs = 0;
  activeSince = 0;
  setPhase('ready');
}

async function discard() {
  finished = true;
  discardOnStop = true;
  // Descartada: la pestaña se cierra sin pedir confirmación.
  setPhase('done');
  const old = recorder;
  recorder = null;
  if (old && old.state !== 'inactive') old.stop();
  await saveQueue;
  await clearChunks(jobId).catch(() => {});
  stopAll();
}

function onRecorderStop(current) {
  if (current !== recorder || discardOnStop) return;
  finalize();
}

// Une las partes guardadas en un solo archivo y lo deja en «Mis grabaciones».
async function finalize(failed = false) {
  if (finished) return;
  finished = true;
  setPhase('saving');
  try {
    await saveQueue;
    if (!thumb && comp) thumb = await comp.thumbnail();
    const rows = await chunksOf(jobId);
    if (!rows.length) throw new Error('empty');
    const type = rows[0]?.meta?.mime || mime || 'video/webm';
    const blob = new Blob(rows.map((r) => r.blob), { type });
    const size = comp?.size || {};
    const meta = {
      id: jobId,
      title: defaultTitle(new Date()),
      created: Date.now(),
      duration: Math.round(activeMs),
      width: size.width || 0,
      height: size.height || 0,
      mime: type,
      size: blob.size,
      mode: job.mode,
      thumb,
    };
    await putVideo(meta, blob);
    await clearChunks(jobId);
    stopAll();
    // Ya está guardado: la pestaña se puede cerrar sin pedir confirmación.
    setPhase('done');
    toSW({ type: 'rec:saved', id: jobId });
  } catch (err) {
    console.debug('[Grabazo] al guardar', err);
    stopAll();
    setPhase('error');
    toSW({ type: 'rec:failed', error: failed ? 'recorder' : 'save', recover: true });
  }
}

function stopAll() {
  clearTimeout(autoZoomTimer);
  for (const tr of capture?.getTracks() || []) tr.stop();
  for (const tr of micStream?.getTracks() || []) tr.stop();
  relay?.close();
  relay = null;
  mixer?.close();
  comp?.stop();
  $('#preview').srcObject = null;
}

// `detail` queda en el estado (rec.detail) para entender qué pasó.
function fail(code, detail = '') {
  finished = true;
  stopAll();
  setPhase(code === 'canceled' ? 'canceled' : 'error');
  showError(code);
  toSW({ type: 'rec:ready', ok: false, error: code, detail: String(detail).slice(0, 200) });
}

// ================================================================ cursor y zoom

function onCursor(m, sender) {
  if (!comp || job?.mode === 'camera' || typeof m.x !== 'number') return;
  if ((job.mode === 'tab' || job.mode === 'area') && sender.tab?.id !== job.tabId) return;
  let nx;
  let ny;
  if (job.mode === 'tab') {
    nx = m.x;
    ny = m.y;
  } else if (job.mode === 'area' && job.area) {
    const a = job.area;
    nx = (m.x * a.vw - a.x) / a.w;
    ny = (m.y * a.vh - a.y) / a.h;
  } else if (surface === 'window' || surface === 'browser') {
    nx = (m.sx - m.wx) / (m.ow || 1);
    ny = (m.sy - m.wy) / (m.oh || 1);
  } else {
    // Pantalla completa: posición sobre la pantalla donde está la ventana de Chrome.
    nx = (((m.sx % m.sw) + m.sw) % m.sw) / m.sw;
    ny = (((m.sy % m.sh) + m.sh) % m.sh) / m.sh;
  }
  comp.pointer(nx, ny);
  if (m.click && settings.zoomOnClick && !ui.zoom && phase === 'recording') {
    comp.zoomTo(settings.zoomLevel || 2);
    clearTimeout(autoZoomTimer);
    autoZoomTimer = setTimeout(() => { if (!ui.zoom) comp?.zoomTo(1); }, 3000);
  }
}

function applyUi(next) {
  const before = ui;
  ui = next || ui;
  mixer?.setMic(micOpen());
  if (comp && before.zoom !== ui.zoom) comp.zoomTo(ui.zoom ? settings.zoomLevel || 2 : 1);
  if (before.camera !== ui.camera) applyCam();
}

// ================================================================ cámara dentro del video

const camVisible = () => overlayCam && ui.camera !== false;

function applyCam(instant = false) {
  if (!comp || !overlayCam) return;
  comp.camera({
    visible: camVisible(),
    shape: settings.camShape,
    mirror: settings.camMirror !== false,
    size: CAM_OVERLAY[settings.camSize] || CAM_OVERLAY.m,
    x: place.x,
    y: place.y,
    instant,
  });
  renderCamPanel();
  renderHandle();
}

// Dónde se ve el video dentro de la vista previa (escala y márgenes de «contain»).
function videoBox() {
  const wrap = $('.preview-wrap');
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const { width: vw, height: vh } = comp?.size || {};
  if (!vw || !vh || !W || !H) return null;
  const k = Math.min(W / vw, H / vh);
  return { k, ox: (W - vw * k) / 2, oy: (H - vh * k) / 2, vw, vh };
}

const CAM_PHASES = new Set(['placing', 'ready', 'recording', 'paused']);

// Asa transparente sobre la cámara de la vista previa para arrastrarla.
function renderHandle() {
  const el = $('#cam-handle');
  const r = camVisible() && CAM_PHASES.has(phase) ? comp?.cameraRect : null;
  const box = r && videoBox();
  el.hidden = !box;
  if (!box) return;
  el.dataset.shape = settings.camShape;
  if (!dragging) {
    el.style.left = `${box.ox + r.x * box.k}px`;
    el.style.top = `${box.oy + r.y * box.k}px`;
  }
  el.style.width = `${r.w * box.k}px`;
  el.style.height = `${r.h * box.k}px`;
  const live = !!comp.cameraLive;
  el.classList.toggle('waiting', !live);
  if (!live) {
    const s = relayState || {};
    $('#cam-handle-msg').textContent = s.source === 'phone' ? t(s.linked && s.phones ? 'bubblePhoneWait' : 'bubblePhoneLink') : s.error === 'denied' ? t('bubbleDenied') : s.error === 'busy' ? t('bubbleBusy') : s.error ? t('bubbleFailed') : t('camStarting');
  }
}

function renderCamPanel() {
  const panel = $('#cam-panel');
  panel.hidden = !overlayCam || !CAM_PHASES.has(phase);
  if (panel.hidden) return;
  const on = camVisible();
  panel.classList.toggle('off', !on);
  $('#cam-visible').checked = on;
  for (const b of panel.querySelectorAll('[data-size]')) b.setAttribute('aria-checked', String(b.dataset.size === settings.camSize));
  for (const b of panel.querySelectorAll('[data-shape]')) b.setAttribute('aria-checked', String(b.dataset.shape === settings.camShape));
  $('#cam-mirror').setAttribute('aria-pressed', String(settings.camMirror !== false));
  for (const b of panel.querySelectorAll('[data-corner]')) {
    const c = CAM_CORNERS[b.dataset.corner];
    b.setAttribute('aria-pressed', String(c.x === place.x && c.y === place.y));
  }
  $('#cam-ask').checked = settings.camAsk !== false;
  $('#cam-hint').textContent = phase === 'placing' ? '' : t('camHint');
  $('#cam-hint').hidden = phase === 'placing';
}

// Cambios de la cámara: se aplican al momento y se guardan para la próxima vez.
function setCam(patch) {
  if (patch.place) place = patch.place;
  for (const k of ['camShape', 'camSize', 'camMirror', 'camAsk']) if (k in patch) settings[k] = patch[k];
  applyCam();
  const save = { ...patch };
  if (save.place) {
    save.camPlace = save.place;
    delete save.place;
  }
  saveSettings(save).catch(() => {});
}

{
  const el = $('#cam-handle');
  el.tabIndex = 0;
  const wrap = $('.preview-wrap');
  // Posición dentro del espacio libre a partir de la esquina del asa (px de la vista previa).
  const toPlace = (left, top) => {
    const box = videoBox();
    const r = comp?.cameraRect;
    if (!box || !r) return place;
    const fx = (left - box.ox) / box.k - r.m;
    const fy = (top - box.oy) / box.k - r.m;
    const free = (v, full, size) => Math.min(1, Math.max(0, v / Math.max(1, full - size - r.m * 2)));
    return { x: free(fx, box.vw, r.w), y: free(fy, box.vh, r.h) };
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !comp?.cameraRect) return;
    const rect = el.getBoundingClientRect();
    dragging = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const wr = wrap.getBoundingClientRect();
    const box = videoBox();
    const r = comp?.cameraRect;
    if (!box || !r) return;
    // El asa no sale del video.
    const minL = box.ox + r.m * box.k;
    const minT = box.oy + r.m * box.k;
    const left = Math.min(Math.max(minL, e.clientX - wr.left - dragging.dx), box.ox + (box.vw - r.w - r.m) * box.k);
    const top = Math.min(Math.max(minT, e.clientY - wr.top - dragging.dy), box.oy + (box.vh - r.h - r.m) * box.k);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    place = toPlace(left, top);
    comp.camera({ x: place.x, y: place.y, instant: true });
  });
  const drop = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    dragging = null;
    el.classList.remove('dragging');
    // Cerca de un borde, se pega a él.
    const snap = (v) => (v < 0.06 ? 0 : v > 0.94 ? 1 : Math.round(v * 1000) / 1000);
    setCam({ place: { x: snap(place.x), y: snap(place.y) } });
  };
  el.addEventListener('pointerup', drop);
  el.addEventListener('pointercancel', drop);
  // Con el teclado: flechas para moverla (Mayúsculas = más rápido).
  el.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.25 : 0.05;
    const moves = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const clamp = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    setCam({ place: { x: clamp(place.x + m[0]), y: clamp(place.y + m[1]) } });
  });
  addEventListener('resize', renderHandle);
}

$('#corners').addEventListener('click', (e) => {
  const c = CAM_CORNERS[e.target.closest('[data-corner]')?.dataset.corner];
  if (c) setCam({ place: { ...c } });
});
$('#cam-size').addEventListener('click', (e) => {
  const size = e.target.closest('[data-size]')?.dataset.size;
  if (size) setCam({ camSize: size });
});
$('#cam-shape').addEventListener('click', (e) => {
  if (e.target.closest('#cam-mirror')) return setCam({ camMirror: settings.camMirror === false });
  const shape = e.target.closest('[data-shape]')?.dataset.shape;
  if (shape) setCam({ camShape: shape });
});
$('#cam-visible').addEventListener('change', (e) => {
  ui = { ...ui, camera: e.target.checked };
  applyCam();
  toSW({ type: 'op', op: 'ui:set', patch: { camera: e.target.checked } });
});
$('#cam-ask').addEventListener('change', (e) => setCam({ camAsk: e.target.checked }));
$('#place-go').addEventListener('click', placed);
$('#place-cancel').addEventListener('click', () => toSW({ type: 'op', op: 'rec:discard' }));
addEventListener('keydown', (e) => {
  if (phase !== 'placing' || e.key !== 'Enter' || e.target.closest?.('input, button, .cam-handle')) return;
  placed();
});

// Lista la ubicación: se vuelve a la página y empieza la cuenta regresiva.
function placed() {
  if (phase !== 'placing') return;
  setPhase('ready');
  toSW({ type: 'rec:placed' });
}

// Lo que se cambie desde la barra, el popup o el celular se aplica aquí al momento.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings || !job) return;
  const next = normalizeSettings(changes.settings.newValue);
  for (const k of ['camShape', 'camSize', 'camMirror', 'camAsk', 'zoomLevel', 'zoomOnClick']) settings[k] = next[k];
  if (!dragging) place = next.camPlace;
  applyCam();
});

// ================================================================ interfaz

const PHASES = {
  preparing: ['recTitlePreparing', 'recBodyPreparing'],
  picking: ['recTitlePicking', 'recBodyPicking'],
  placing: ['recTitlePlacing', 'recBodyPlacing'],
  ready: ['recTitleReady', 'recBodyReady'],
  recording: ['recTitleRecording', 'recBodyRecording'],
  paused: ['recTitlePaused', 'recBodyRecording'],
  saving: ['recTitleSaving', 'recBodySaving'],
  error: ['recTitleError', ''],
  canceled: ['recTitleCanceled', 'recBodyCanceled'],
  done: ['recTitleDone', 'recBodyDone'],
};

function setPhase(next) {
  debug.log?.push(`${Math.round(performance.now())} ${next}`);
  phase = next;
  document.body.dataset.phase = next;
  const [title, body] = PHASES[next] || PHASES.preparing;
  $('#title').textContent = t(title);
  if (body) $('#body').textContent = t(body);
  renderClock();
  renderCamPanel();
  renderHandle();
  if (next === 'placing') setTimeout(() => $('#place-go').focus(), 0);
}

function renderInfo() {
  const modes = { tab: 'modeTab', area: 'modeArea', window: 'modeWindow', screen: 'modeScreen', camera: 'modeCamera' };
  $('#mode').textContent = t(modes[job?.mode] || 'modeTab');
}

function renderClock() {
  const ms = rec.status === 'recording' || rec.status === 'paused' ? elapsedOf(rec) : 0;
  const limit = Number(rec.limit) || 0;
  const shown = limit ? Math.max(0, limit - ms) : ms;
  $('#clock').textContent = (limit ? '−' : '') + clock(shown);
  const live = phase === 'recording' || phase === 'paused';
  document.title = live ? `${phase === 'paused' ? '❚❚' : '●'} ${clock(ms)} — Grabazo` : `${t(PHASES[phase]?.[0] || 'recTitlePreparing')} — Grabazo`;
  $('#pause').setAttribute('aria-pressed', String(phase === 'paused'));
  $('#pause-label').textContent = phase === 'paused' ? t('resume') : t('pause');
  // Aviso a los 10 segundos del límite.
  if (limit && live && limit - ms <= 10_000 && !warned) {
    warned = true;
    mixer?.beep();
    document.body.classList.add('ending');
  }
  // Cuenta regresiva en el modo cámara (la página está a la vista).
  const cd = $('#countdown');
  if (rec.status === 'countdown' && rec.countdownEnd > Date.now()) {
    cd.hidden = false;
    cd.textContent = String(Math.ceil((rec.countdownEnd - Date.now()) / 1000));
  } else {
    cd.hidden = true;
  }
}

function renderCamWait() {
  const box = $('#cam-wait');
  if (job?.mode !== 'camera') { box.hidden = true; return; }
  const live = relay?.stream.getVideoTracks().some((tr) => tr.readyState === 'live') && relayState?.live;
  box.hidden = !!live;
  if (live) return;
  const s = relayState || {};
  $('#cam-wait-text').textContent = s.source === 'phone' ? (s.linked ? t('camWaitPhone') : t('camWaitLink')) : s.error === 'denied' ? t('camDenied') : s.error ? t('camFailed') : t('camStarting');
}

function showWarn(text) {
  const el = $('#warn');
  el.textContent = text;
  el.hidden = false;
}

const ERRORS = {
  'tab-permission': 'errTabPermission',
  'tab-busy': 'errTabBusy',
  'tab-capture': 'errTabCapture',
  camera: 'errCamera',
  'camera-denied': 'camDenied',
  capture: 'errCapture',
  recorder: 'errRecorder',
  stale: 'errStale',
  canceled: 'recBodyCanceled',
};

function showError(code) {
  $('#body').textContent = t(ERRORS[code] || 'errCapture');
  $('#close').hidden = false;
}

$('#pause').addEventListener('click', () => toSW({ type: 'op', op: 'rec:togglePause' }));
$('#stop').addEventListener('click', () => toSW({ type: 'op', op: 'rec:stop' }));
$('#restart').addEventListener('click', () => toSW({ type: 'op', op: 'rec:restart' }));
$('#discard').addEventListener('click', () => {
  if (phase === 'recording' || phase === 'paused') {
    if (!confirm(t('confirmDiscard'))) return;
  }
  toSW({ type: 'op', op: 'rec:discard' });
});
$('#close').addEventListener('click', () => window.close());
$('#countdown').addEventListener('click', () => toSW({ type: 'op', op: 'rec:discard' }));

setInterval(() => {
  renderClock();
  renderHandle();
}, 500);

// Cerrar la pestaña a mitad de la grabación: Chrome pide confirmación.
addEventListener('beforeunload', (e) => {
  if (phase === 'recording' || phase === 'paused' || phase === 'saving') e.preventDefault();
});

// ================================================================ mensajes

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg) return;
  if (msg.to === 'all' && msg.type === 'state') {
    rec = msg.rec || rec;
    applyUi(msg.ui);
    // Se pulsó «Grabar» en el celular o en el popup mientras se ubicaba la cámara.
    if (phase === 'placing' && rec.status === 'countdown') setPhase('ready');
    renderClock();
    return;
  }
  if (msg.to !== 'rec') return;
  if (msg.type === 'cursor') {
    onCursor(msg, sender);
    return;
  }
  if (msg.id !== jobId) return;
  switch (msg.type) {
    case 'go': go(); break;
    case 'pause': pause(); break;
    case 'resume': resume(); break;
    case 'stop': stop(); break;
    case 'restart':
      // Responde al terminar: la cuenta regresiva empieza cuando el grabador está listo.
      restart().then(() => sendResponse({ ok: true }));
      return true;
    case 'discard':
      discard().then(() => sendResponse({ ok: true }));
      return true;
  }
  sendResponse({ ok: true });
});

toSW({ type: 'state:get' }).then((s) => {
  if (s?.rec) rec = s.rec;
  renderClock();
});
prepare();
