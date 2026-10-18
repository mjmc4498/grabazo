// Grabazo — documento offscreen.
// · Enlace con el celular (PeerJS, anfitrión): control remoto de la grabación, guion del
//   teleprompter y cámara/micrófono del celular. Valida cada mensaje.
// · Fuente de la cámara: la de la computadora (getUserMedia) o la del celular, con los
//   efectos de fondo y de color (lib/efectos.js).
// · Reparto local de esa cámara (WebRTC dentro de Chrome, sin servidores) a la burbuja
//   en la página y al grabador.

/* global Peer */

import { ICE_ENDPOINT, FALLBACK_ICE, PHONE } from './config.js';
import { createEffects, isPassThrough } from './lib/efectos.js';

const ICE_REFRESH_MS = 3 * 60 * 60 * 1000; // las credenciales duran 4 h
const RELAY_PORT = 'grabazo-relay';

const phones = new Map();
const consumers = new Map();
let iceConfig = FALLBACK_ICE;
let identity = null;
let settings = {};
let ui = {};
let rec = { status: 'idle' };
let script = { text: '', updated: 0 };
let peer = null;
let linkOn = false;
let stopped = false;
let retryTimer = 0;
let retryDelay = 1000;

const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);

function setStatus(status, error = null) {
  toSW({ type: 'link:status', status, error });
}

// ================================================================ enlace con el celular

function startLink() {
  linkOn = true;
  stopped = false;
  if (peer && !peer.destroyed) {
    if (peer.open) setStatus('ready');
    return;
  }
  connect();
}

function stopLink(reason = 'stopped') {
  linkOn = false;
  clearTimeout(retryTimer);
  for (const p of phones.values()) send(p.conn, { t: 'bye', reason });
  const current = peer;
  peer = null;
  setTimeout(() => {
    try { current?.destroy(); } catch {}
    for (const p of [...phones.values()]) dropPhone(p);
    maybeIdle();
  }, 250);
}

function connect() {
  if (!linkOn || !identity) return;
  clearTimeout(retryTimer);
  setStatus('connecting');
  // debug: 0 — los avisos internos de PeerJS se manejan abajo; si se imprimieran,
  // Chrome los mostraría como errores en la página de Extensiones.
  peer = new Peer(identity.peerId, { debug: 0, config: iceConfig });
  const current = peer;

  current.on('open', () => {
    retryDelay = 1000;
    setStatus('ready');
  });
  current.on('connection', onConnection);
  current.on('call', onCall);
  current.on('disconnected', () => {
    if (!linkOn || current.destroyed || current !== peer) return;
    scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
  });
  current.on('error', (err) => {
    if (!linkOn || current !== peer) return;
    switch (err.type) {
      case 'unavailable-id':
        // El servidor aún no liberó el identificador: si ya estuvo abierto solo se
        // reintenta la reconexión (destruir el peer cortaría a los celulares).
        setStatus('connecting');
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      case 'browser-incompatible':
      case 'invalid-id':
      case 'invalid-key':
      case 'ssl-unavailable':
        setStatus('error', err.type);
        break;
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        setTimeout(() => setStatus('error', 'network'), 0);
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      default:
        console.debug('[Grabazo]', err.type, err.message);
    }
  });
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(fn, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}

function send(conn, msg) {
  try {
    if (conn?.open) conn.send(msg);
  } catch {}
}

function broadcastPhones(msg) {
  for (const p of phones.values()) send(p.conn, msg);
}

function str(v, max = 80) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '';
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// Lo que el celular necesita para mostrar el control remoto.
function phoneState() {
  return {
    rec: {
      status: rec.status,
      mode: rec.mode || null,
      elapsed: Number(rec.elapsed) || 0,
      resumedAt: Number(rec.resumedAt) || 0,
      limit: Number(rec.limit) || 0,
      countdownEnd: Number(rec.countdownEnd) || 0,
      error: rec.error || null,
    },
    ui: {
      tool: ui.tool ?? null,
      color: ui.color,
      width: ui.width,
      spotlight: !!ui.spotlight,
      zoom: !!ui.zoom,
      clicks: !!ui.clicks,
      blur: !!ui.blur,
      toolbar: ui.toolbar !== false,
      camera: !!ui.camera,
      mic: !!ui.mic,
      talking: !!ui.talking,
    },
    prefs: {
      mode: settings.mode,
      ptt: !!settings.pushToTalk,
      camPhone: settings.camId === PHONE,
      micPhone: settings.micId === PHONE,
      zoomLevel: settings.zoomLevel,
    },
    camWant: wantsPhoneCam(),
    micWant: wantsPhoneMic(),
    now: Date.now(),
  };
}

let stateTimer = 0;
function pushState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => broadcastPhones({ t: 'state', ...phoneState() }), 30);
}

function onConnection(conn) {
  const phone = { id: conn.connectionId, name: 'Celular', since: Date.now(), conn, peerId: conn.peer, authed: false, call: null, stream: null, sink: null, media: null, opTimes: [] };
  const authTimer = setTimeout(() => { if (!phone.authed) conn.close(); }, 10000);

  conn.on('data', (raw) => {
    const msg = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;

    if (!phone.authed) {
      if (msg.t === 'hello' && typeof msg.k === 'string' && msg.k === identity.token) {
        clearTimeout(authTimer);
        if (phones.size >= 6) {
          send(conn, { t: 'bye', reason: 'full' });
          setTimeout(() => conn.close(), 300);
          return;
        }
        phone.authed = true;
        phone.name = str(msg.name, 40) || 'Celular';
        phones.set(phone.id, phone);
        send(conn, { t: 'welcome', v: 1, ...phoneState(), script });
        syncPhones();
      } else {
        send(conn, { t: 'denied' });
        setTimeout(() => conn.close(), 300);
      }
      return;
    }
    onPhoneMessage(phone, msg);
  });

  conn.on('close', () => {
    clearTimeout(authTimer);
    dropPhone(phone);
  });
  conn.on('error', () => {});
}

const PHONE_OPS = new Set(['rec:start', 'rec:toggle', 'rec:stop', 'rec:pause', 'rec:resume', 'rec:togglePause', 'rec:restart', 'rec:discard', 'ui:set', 'ui:toggle', 'ui:clear', 'ui:undo', 'ui:unblur', 'ptt', 'prefs:set']);
const UI_TOGGLES = new Set(['spotlight', 'zoom', 'clicks', 'blur', 'toolbar', 'camera', 'mic', 'tool']);

function cleanPatch(p) {
  if (!p || typeof p !== 'object') return {};
  const out = {};
  if (p.tool === null || typeof p.tool === 'string') out.tool = p.tool === null ? null : str(p.tool, 16);
  if (typeof p.color === 'string') out.color = str(p.color, 7);
  if (Number.isFinite(p.width)) out.width = p.width;
  for (const k of ['spotlight', 'zoom', 'clicks', 'blur', 'toolbar', 'camera', 'mic']) if (typeof p[k] === 'boolean') out[k] = p[k];
  return out;
}

async function onPhoneMessage(phone, msg) {
  switch (msg.t) {
    case 'ping':
      send(phone.conn, { t: 'pong', ts: Number(msg.ts) || 0, now: Date.now() });
      return;
    case 'op': {
      if (!PHONE_OPS.has(msg.op)) return;
      // Límite: 20 órdenes por segundo por celular (las de pulsar para hablar cuentan).
      const now = Date.now();
      phone.opTimes = phone.opTimes.filter((t) => now - t < 1000);
      if (phone.opTimes.length >= 20) return;
      phone.opTimes.push(now);
      const op = { type: 'op', op: msg.op };
      if (msg.op === 'ui:set') op.patch = cleanPatch(msg.patch);
      if (msg.op === 'ui:toggle') {
        if (!UI_TOGGLES.has(msg.key)) return;
        op.key = msg.key;
      }
      if (msg.op === 'ptt') op.down = msg.down === true;
      if (msg.op === 'rec:start' && typeof msg.mode === 'string') op.mode = str(msg.mode, 10);
      if (msg.op === 'prefs:set' && msg.patch && typeof msg.patch === 'object') {
        op.patch = {};
        for (const k of ['camPhone', 'micPhone']) if (typeof msg.patch[k] === 'boolean') op.patch[k] = msg.patch[k];
      }
      const res = await toSW(op);
      if (Number.isInteger(msg.rid)) send(phone.conn, { t: 'ack', rid: msg.rid, ok: res?.ok !== false, error: res?.error || null });
      return;
    }
    case 'script':
      if (typeof msg.text === 'string') toSW({ type: 'phone:script', text: msg.text.slice(0, 50_000) });
      return;
    case 'media':
      phone.media = {
        cam: msg.cam && typeof msg.cam === 'object' ? { on: msg.cam.on === true, facing: ['user', 'environment'].includes(msg.cam.facing) ? msg.cam.facing : '', label: str(msg.cam.label, 60) } : null,
        mic: msg.mic && typeof msg.mic === 'object' ? { on: msg.mic.on === true } : null,
      };
      syncPhones();
      refreshCamera();
      return;
  }
}

function dropPhone(phone) {
  if (!phones.delete(phone.id)) return;
  try { phone.call?.close(); } catch {}
  phone.stream = null;
  if (phone.sink) phone.sink.srcObject = null;
  syncPhones();
  refreshCamera();
}

function syncPhones() {
  const list = [...phones.values()].map(({ id, name, since, stream, media }) => ({
    id,
    name,
    since,
    cam: !!stream?.getVideoTracks().some((t) => t.readyState === 'live') && media?.cam?.on !== false,
    mic: !!stream?.getAudioTracks().some((t) => t.readyState === 'live') && media?.mic?.on !== false,
  }));
  toSW({ type: 'link:phones', phones: list, camLive: !!phoneVideo() });
}

// ---------------------------------------------------------------- video y audio del celular

function onCall(call) {
  const phone = [...phones.values()].find((p) => p.authed && p.peerId === call.peer);
  if (!phone) {
    try { call.close(); } catch {}
    return;
  }
  if (phone.call && phone.call !== call) {
    try { phone.call.close(); } catch {}
  }
  phone.call = call;
  call.on('stream', () => {
    if (phone.call !== call || !call.peerConnection) return;
    // Las pistas se toman de los receptores: el audio llega en su propio «stream» (ver
    // phoneOffer) y PeerJS avisa una vez por cada uno.
    const receivers = call.peerConnection.getReceivers();
    receivers.forEach(lowLatency);
    const tracks = receivers.map((r) => r.track).filter((t) => t && t.readyState === 'live');
    if (!tracks.length) return;
    if (phone.streamCall !== call || !phone.stream) {
      phone.stream = new MediaStream(tracks);
      phone.streamCall = call;
    } else {
      for (const t of tracks) if (!phone.stream.getTracks().includes(t)) phone.stream.addTrack(t);
    }
    // Chrome solo entrega el audio de una conexión remota si algo lo reproduce: un
    // elemento silenciado basta para que el reparto lo reciba.
    phone.sink ||= Object.assign(new Audio(), { muted: true });
    phone.sink.srcObject = phone.stream;
    phone.sink.play().catch(() => {});
    syncPhones();
    refreshCamera();
  });
  call.on('close', () => {
    if (phone.call !== call) return;
    phone.call = null;
    phone.stream = null;
    phone.streamCall = null;
    syncPhones();
    refreshCamera();
  });
  call.on('error', () => {});
  // La oferta del celular llega dentro de la llamada: se ajusta antes de responder.
  const offer = call.options?._payload?.sdp;
  if (typeof offer?.sdp === 'string') offer.sdp = phoneOffer(offer.sdp);
  call.answer(undefined, { sdpTransform: phoneAnswer });
}

function livePhone(kind) {
  for (const p of phones.values()) {
    const track = p.stream?.getTracks().find((t) => t.kind === kind && t.readyState === 'live');
    if (track && (kind === 'video' ? p.media?.cam?.on !== false : p.media?.mic?.on !== false)) return track;
  }
  return null;
}

const phoneVideo = () => livePhone('video');
const phoneAudio = () => livePhone('audio');

// ================================================================ fuente de la cámara

let pcStream = null;
let pcDevice = '';
let camError = null;
let fx = null;
let fxInput = null;
let outVideo = null;
let outAudio = null;
let idleTimer = 0;
let refreshing = Promise.resolve();
let releaseTimer = 0;

function wantsVideo() {
  return [...consumers.values()].some((c) => c.joined && c.video);
}

function wantsPhoneCam() {
  return settings.camId === PHONE && (wantsVideo() || rec.status !== 'idle' && rec.mode === 'camera');
}

function wantsPhoneMic() {
  return settings.micId === PHONE && settings.mic !== false && rec.status !== 'idle';
}

async function ensurePcCamera() {
  const want = settings.camId && settings.camId !== PHONE ? settings.camId : '';
  const live = pcStream?.getVideoTracks()[0];
  if (live && live.readyState === 'live' && pcDevice === want) return;
  stopPcCamera();
  const video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  try {
    try {
      pcStream = await navigator.mediaDevices.getUserMedia({ video: want ? { ...video, deviceId: { exact: want } } : video, audio: false });
    } catch (err) {
      // La cámara elegida ya no está conectada: se usa la predeterminada.
      if (!want || !['OverconstrainedError', 'NotFoundError'].includes(err.name)) throw err;
      pcStream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    }
    pcDevice = want;
    camError = null;
    pcStream.getVideoTracks()[0].addEventListener('ended', () => {
      camError = 'ended';
      pcStream = null;
      refreshCamera();
    });
  } catch (err) {
    pcStream = null;
    camError = err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'denied' : err.name === 'NotFoundError' ? 'notfound' : err.name === 'NotReadableError' ? 'busy' : 'camera';
  }
}

function stopPcCamera() {
  for (const t of pcStream?.getTracks() || []) t.stop();
  pcStream = null;
  pcDevice = '';
}

function stopFx() {
  fx?.stop();
  fx = null;
  fxInput = null;
}

// Decide qué cámara se reparte (y la enciende o la apaga). Se ejecuta en orden.
function refreshCamera() {
  refreshing = refreshing.then(applyCamera, applyCamera);
  return refreshing;
}

async function applyCamera() {
  const want = wantsVideo();
  let source = null;
  if (want) {
    clearTimeout(releaseTimer);
    if (settings.camId === PHONE) {
      stopPcCamera();
      camError = null;
      source = phoneVideo();
    } else {
      await ensurePcCamera();
      source = pcStream?.getVideoTracks()[0] || null;
    }
  } else if (pcStream) {
    // Nadie la usa: se apaga a los pocos segundos (al cambiar de página la burbuja
    // vuelve enseguida y no conviene que la luz parpadee).
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      if (wantsVideo()) return;
      stopFx();
      stopPcCamera();
      setOutputs(null, phoneAudio());
      maybeIdle();
    }, 4000);
    source = pcStream.getVideoTracks()[0] || null;
  }

  let video = null;
  if (source) {
    const fxOpts = { effect: settings.camEffect || 'none', filter: settings.camFilter || 'none' };
    if (isPassThrough(fxOpts)) {
      stopFx();
      video = source;
    } else {
      if (!fx || fxInput !== source) {
        stopFx();
        try {
          fx = createEffects(source, fxOpts);
          fxInput = source;
          fx.onerror = () => sync();
        } catch {
          fx = null;
        }
      } else {
        fx.set(fxOpts);
      }
      video = fx?.track || source;
    }
  } else {
    stopFx();
  }
  setOutputs(video, phoneAudio());
  pushState();
  if (!want) maybeIdle();
  // Sin cámara por un error pasajero (permiso aún no dado, cámara ocupada por otra app):
  // se vuelve a intentar sola mientras alguien la espera.
  clearTimeout(cameraRetryTimer);
  if (want && !video && camError && camError !== 'notfound' && settings.camId !== PHONE) {
    cameraRetryTimer = setTimeout(refreshCamera, 3000);
  }
}

let cameraRetryTimer = 0;

// Al dar permiso en los ajustes, la burbuja se enciende enseguida.
for (const name of ['camera', 'microphone']) {
  navigator.permissions?.query({ name }).then((status) => {
    status.addEventListener('change', () => {
      camError = null;
      refreshCamera();
    });
  }).catch(() => {});
}

function setOutputs(video, audio) {
  const changed = video !== outVideo || audio !== outAudio;
  outVideo = video;
  outAudio = audio;
  if (changed) for (const c of consumers.values()) applySource(c);
  sync();
}

// Estado que ven la burbuja y el grabador.
function relayState() {
  return {
    live: !!outVideo,
    source: settings.camId === PHONE ? 'phone' : 'pc',
    error: settings.camId === PHONE ? null : camError,
    linked: linkOn,
    phones: phones.size,
    phoneCam: !!phoneVideo(),
    phoneMic: !!phoneAudio(),
  };
}

let syncTimer = 0;
function sync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const state = relayState();
    for (const c of consumers.values()) if (c.joined) post(c, { t: 'state', state });
  }, 30);
}

function maybeIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!linkOn && !consumers.size && !pcStream) toSW({ type: 'offscreen:idle' });
  }, 6000);
}

// ================================================================ reparto local (burbuja y grabador)

let consumerSeq = 0;

function post(c, msg) {
  try { c.port.postMessage(msg); } catch {}
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== RELAY_PORT || port.sender?.id !== chrome.runtime.id) return;
  const c = { id: ++consumerSeq, port, pc: null, video: null, audio: null, joined: false, kind: 'bubble', wantsVideo: true };
  consumers.set(c.id, c);
  clearTimeout(idleTimer);
  port.onMessage.addListener((msg) => onConsumerMessage(c, msg));
  port.onDisconnect.addListener(() => dropConsumer(c));
});

function onConsumerMessage(c, msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'join':
      if (c.joined) return;
      c.joined = true;
      c.kind = ['bubble', 'recorder', 'recorder-mic', 'preview'].includes(msg.kind) ? msg.kind : 'bubble';
      c.video = c.kind !== 'recorder-mic';
      startRelay(c);
      refreshCamera();
      break;
    case 'answer':
      if (c.pc && msg.sdp?.type === 'answer' && typeof msg.sdp.sdp === 'string') {
        c.pc.setRemoteDescription({ type: 'answer', sdp: fastStart(msg.sdp.sdp) }).catch(() => restartRelay(c));
      }
      break;
    case 'ice':
      if (c.pc && msg.c) c.pc.addIceCandidate(msg.c).catch(() => {});
      break;
    case 'restart':
      restartRelay(c);
      break;
  }
}

async function startRelay(c) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  c.pc = pc;
  c.videoTx = pc.addTransceiver('video', { direction: 'sendonly' });
  c.audioTx = pc.addTransceiver('audio', { direction: 'sendonly' });
  pc.onicecandidate = (e) => { if (e.candidate && c.pc === pc) post(c, { t: 'ice', c: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => {
    if (c.pc === pc && pc.connectionState === 'failed') restartRelay(c);
  };
  applySource(c);
  try {
    await pc.setLocalDescription(await pc.createOffer());
    if (c.pc !== pc) return;
    // Conexión local: se permite mucha más calidad que por internet.
    for (const [t, max] of [[c.videoTx, 12_000_000], [c.audioTx, 256_000]]) {
      const params = t.sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = max;
      if (t === c.videoTx) params.degradationPreference = 'maintain-framerate';
      await t.sender.setParameters(params).catch(() => {});
    }
    post(c, { t: 'offer', sdp: pc.localDescription.toJSON() });
    post(c, { t: 'state', state: relayState() });
  } catch (err) {
    console.debug('[Grabazo] reparto local', err);
  }
}

function restartRelay(c) {
  if (!consumers.has(c.id)) return;
  try { c.pc?.close(); } catch {}
  c.pc = null;
  post(c, { t: 'reset' });
  startRelay(c);
}

function applySource(c) {
  if (!c.pc) return;
  c.videoTx.sender.replaceTrack(c.video ? outVideo : null).catch(() => {});
  c.audioTx.sender.replaceTrack(outAudio).catch(() => {});
}

function dropConsumer(c) {
  if (!consumers.delete(c.id)) return;
  try { c.pc?.close(); } catch {}
  c.pc = null;
  refreshCamera();
}

// ---------------------------------------------------------------- ajustes de SDP (baja latencia)

// Por defecto WebRTC empieza con poca calidad y la sube de a poco. Dentro de la misma
// computadora no hace falta: se arranca directamente con buena calidad.
const FAST_START = 'x-google-start-bitrate=6000;x-google-min-bitrate=2500;x-google-max-bitrate=12000';
// Celular → computadora: casi siempre es la misma red Wi-Fi; se empieza alto sin fijar un mínimo.
const PHONE_START = 'x-google-start-bitrate=2000';

function sdpLines(sdp) {
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  return { nl, lines: sdp.split(nl) };
}

function fastStart(sdp, params = FAST_START) {
  const { nl, lines } = sdpLines(sdp);
  const video = new Set();
  for (const l of lines) {
    const m = l.match(/^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/i);
    if (m) video.add(m[1]);
  }
  const withFmtp = new Set();
  const out = lines.map((l) => {
    const f = l.match(/^a=fmtp:(\d+) /);
    if (!f || !video.has(f[1])) return l;
    withFmtp.add(f[1]);
    return `${l};${params}`;
  });
  // Los códecs sin línea fmtp (VP8) la reciben justo después de su rtpmap.
  return out.flatMap((l) => {
    const m = l.match(/^a=rtpmap:(\d+) /);
    return m && video.has(m[1]) && !withFmtp.has(m[1]) ? [l, `a=fmtp:${m[1]} ${params}`] : [l];
  }).join(nl);
}

// Recepción sin búfer extra: cada cuadro se reenvía apenas se decodifica.
function lowLatency(receiver) {
  try { if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0; } catch {}
  try { if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0; } catch {}
}

// Oferta del celular: el audio pasa a su propio «stream». Si video y audio comparten
// uno, Chrome retrasa el video para sincronizarlo con el audio.
function phoneOffer(sdp) {
  const { nl, lines } = sdpLines(sdp);
  let kind = '';
  return lines.map((l) => {
    if (l.startsWith('m=')) kind = l.slice(2, l.indexOf(' '));
    if (kind !== 'audio') return l;
    let m = l.match(/^a=msid:(\S+)(.*)$/);
    if (m) return `a=msid:${m[1]}-audio${m[2]}`;
    m = l.match(/^(a=ssrc:\d+ msid:)(\S+)(.*)$/);
    return m ? `${m[1]}${m[2]}-audio${m[3]}` : l;
  }).join(nl);
}

// Respuesta al celular: empieza con buena calidad y prefiere H.264 (los celulares lo
// codifican por hardware: más rápido y sin calentarse).
function phoneAnswer(sdp) {
  return preferH264(fastStart(sdp, PHONE_START));
}

function preferH264(sdp) {
  const { nl, lines } = sdpLines(sdp);
  const codec = {};
  const fmtp = {};
  for (const l of lines) {
    let m = l.match(/^a=rtpmap:(\d+) ([^/]+)\//);
    if (m) codec[m[1]] = m[2].toUpperCase();
    m = l.match(/^a=fmtp:(\d+) (.*)$/);
    if (m) fmtp[m[1]] = m[2];
  }
  const score = (pt) => (/profile-level-id=42e0/i.test(fmtp[pt]) ? 2 : /profile-level-id=4200/i.test(fmtp[pt]) ? 1 : 0);
  return lines.map((l) => {
    if (!l.startsWith('m=video ')) return l;
    const parts = l.split(' ');
    const pts = parts.slice(3);
    const h264 = pts.filter((pt) => codec[pt] === 'H264' && /packetization-mode=1/.test(fmtp[pt] || '')).sort((a, b) => score(b) - score(a));
    if (!h264.length) return l;
    return [...parts.slice(0, 3), ...h264, ...pts.filter((pt) => !h264.includes(pt))].join(' ');
  }).join(nl);
}

// ================================================================ mensajes del service worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg?.to === 'all' && msg.type === 'state') {
    const before = rec.status;
    rec = msg.rec || rec;
    ui = msg.ui || ui;
    pushState();
    // Al empezar o terminar una grabación cambia si hace falta el micrófono del celular.
    if (before !== rec.status) refreshCamera();
    return;
  }
  if (msg?.to !== 'offscreen') return;
  switch (msg.type) {
    case 'settings': {
      const before = settings;
      settings = msg.settings || {};
      const camChanged = ['camId', 'camEffect', 'camFilter', 'micId', 'mic'].some((k) => before[k] !== settings[k]);
      if (camChanged) refreshCamera();
      pushState();
      sync();
      break;
    }
    case 'script':
      script = msg.script || { text: '', updated: 0 };
      broadcastPhones({ t: 'script', ...script });
      break;
    case 'link:start':
      startLink();
      sendResponse({ ok: true });
      break;
    case 'link:stop':
      stopLink(msg.reason);
      sendResponse({ ok: true });
      break;
    case 'kick': {
      const p = phones.get(msg.id);
      if (p) {
        send(p.conn, { t: 'bye', reason: 'kicked' });
        setTimeout(() => p.conn.close(), 200);
      }
      sendResponse({ ok: true });
      break;
    }
    case 'stop':
      stopped = true;
      stopLink(msg.reason || 'stopped');
      for (const c of consumers.values()) post(c, { t: 'bye' });
      stopFx();
      stopPcCamera();
      setTimeout(() => sendResponse({ ok: true }), 300);
      return true;
  }
});

// ---------------------------------------------------------------- retransmisión (TURN)

async function loadIce() {
  if (!ICE_ENDPOINT) return FALLBACK_ICE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
    return { iceServers: data.iceServers };
  } catch (err) {
    console.debug('[Grabazo] retransmisión no disponible:', err.message);
    return FALLBACK_ICE;
  } finally {
    clearTimeout(timer);
  }
}

setInterval(async () => {
  iceConfig = await loadIce();
  if (peer && !peer.destroyed) peer.options.config = iceConfig;
}, ICE_REFRESH_MS);

// ---------------------------------------------------------------- inicio

(async () => {
  identity = await toSW({ type: 'identity' });
  const boot = await toSW({ type: 'offscreen:ready' });
  settings = boot?.settings || {};
  ui = boot?.ui || {};
  rec = boot?.rec || { status: 'idle' };
  script = boot?.script || script;
  iceConfig = await loadIce();
  if (boot?.link?.active && identity?.peerId) startLink();
  maybeIdle();
})();
