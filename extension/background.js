// Grabazo — service worker.
// Coordina la grabación (pestaña del grabador), la capa sobre la página (barra, dibujo,
// efectos y burbuja de la cámara), el enlace con el celular (documento offscreen) y los
// atajos de teclado. El estado vive en chrome.storage.session: si Chrome detiene el
// service worker a mitad de una grabación, al despertar sigue donde estaba.

import { DEFAULT_SETTINGS, MODES, PHONE, getSettings, initialUi, normalizeSettings, elapsedOf, originPattern } from './config.js';

const OFFSCREEN_PATH = 'offscreen.html';
const RECORDER_PATH = 'grabador.html';
const STUDIO_PATH = 'estudio.html';
const OVERLAY_FILES = ['content/dibujo.js', 'content/efectos.js', 'content/camara.js', 'content/capa.js'];
const SELF = new URL(chrome.runtime.getURL('')).origin;
const IDLE = { status: 'idle' };
const LINK_IDLE = { active: false, status: 'idle', error: null, phones: [], camLive: false };
const ACTIVE = new Set(['countdown', 'recording', 'paused']);

// ---------------------------------------------------------------- ajustes

let settings = { ...DEFAULT_SETTINGS };
const settingsReady = getSettings().then((s) => { settings = s; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    toOffscreen({ type: 'settings', settings });
  }
  if (area === 'local' && changes.script) toOffscreen({ type: 'script', script: changes.script.newValue || null });
});

// ---------------------------------------------------------------- estado

let rec = null; // la grabación: estado, modo, pestañas, tiempos
let ui = null; // herramientas: dibujo, foco, zoom, cámara, micrófono…
let link = null; // el enlace con el celular
let loading = null;

function ready() {
  loading ??= (async () => {
    await settingsReady;
    const s = await chrome.storage.session.get(['rec', 'ui', 'link']);
    rec = s.rec || { ...IDLE };
    ui = { ...initialUi(settings), ...(s.ui || {}) };
    link = { ...LINK_IDLE, ...(s.link || {}) };
  })();
  return loading;
}

let broadcastTimer = 0;
async function commit(patch = {}) {
  await ready();
  if (patch.rec) rec = patch.rec;
  if (patch.ui) ui = patch.ui;
  if (patch.link) link = patch.link;
  await chrome.storage.session.set({ rec, ui, link });
  // Varios cambios seguidos salen en un solo aviso.
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(broadcast, 0);
  return snapshot();
}

async function setRec(patch) { await ready(); return commit({ rec: { ...rec, ...patch } }); }
async function setUi(patch) { await ready(); return commit({ ui: { ...ui, ...patch } }); }
async function setLink(patch) { await ready(); return commit({ link: { ...link, ...patch } }); }

function snapshot() {
  return { rec, ui, link, settings, now: Date.now() };
}

async function broadcast() {
  const payload = { rec, ui, link, now: Date.now() };
  chrome.runtime.sendMessage({ ...payload, type: 'state', to: 'all' }).catch(() => {});
  const { prepTab } = await chrome.storage.session.get('prepTab');
  for (const tabId of await overlayTabs()) {
    chrome.tabs.sendMessage(tabId, { ...payload, type: 'grabazo:state', role: roleFor(tabId, prepTab) }).catch(() => {});
  }
  updateBadge();
}

function updateBadge() {
  const s = rec?.status || 'idle';
  const text = s === 'recording' ? 'REC' : s === 'paused' ? '❚❚' : s === 'countdown' ? '…' : s === 'saving' ? '…' : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: s === 'paused' ? '#FF9F0A' : '#FF3B30' });
  chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
}

// Qué muestra la capa en cada pestaña.
function roleFor(tabId, prepTab) {
  if (!rec || rec.status === 'idle') return tabId === prepTab ? 'prepare' : 'none';
  if (rec.mode === 'camera') return 'none';
  if (rec.status === 'area') return tabId === rec.tabId ? 'area' : 'none';
  if (rec.mode === 'tab' || rec.mode === 'area') return tabId === rec.tabId ? 'live' : 'none';
  return 'live';
}

// ---------------------------------------------------------------- capa sobre la página

async function overlayTabs() {
  const { overlays = [] } = await chrome.storage.session.get('overlays');
  return overlays;
}

async function addOverlayTab(tabId) {
  const list = new Set(await overlayTabs());
  if (list.has(tabId)) return;
  list.add(tabId);
  await chrome.storage.session.set({ overlays: [...list] });
}

async function dropOverlayTab(tabId) {
  const list = new Set(await overlayTabs());
  if (!list.delete(tabId)) return;
  await chrome.storage.session.set({ overlays: [...list] });
}

// Inserta la capa en una pestaña. Funciona con activeTab (popup abierto o atajo) o con
// acceso al sitio; en las páginas de Chrome y de la tienda no se puede.
async function inject(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: OVERLAY_FILES, injectImmediately: true });
    await addOverlayTab(tabId);
    return true;
  } catch {
    return false;
  }
}

async function sendOverlay(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, { ...msg, type: `grabazo:${msg.type}` }).catch(() => null);
}

async function overlayCmd(cmd, extra = {}) {
  for (const tabId of await overlayTabs()) sendOverlay(tabId, { type: 'cmd', cmd, ...extra });
}

// Al cambiar de página o de pestaña mientras se graba, la capa vuelve a aparecer si
// el usuario dio acceso a los sitios.
async function canReach(url) {
  const pattern = originPattern(url);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete') return;
  await ready();
  if (!ACTIVE.has(rec.status) || rec.mode === 'camera') return;
  const follows = rec.mode === 'tab' || rec.mode === 'area' ? tabId === rec.tabId : tab.active;
  if (!follows) return;
  if (await canReach(tab.url)) inject(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ready();
  if (!ACTIVE.has(rec.status) || !['window', 'screen'].includes(rec.mode)) return;
  if (tabId === rec.recorderTabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if ((await overlayTabs()).includes(tabId)) return;
  if (tab && (await canReach(tab.url))) inject(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready();
  dropOverlayTab(tabId);
  if (tabId === rec.recorderTabId && rec.status !== 'idle') {
    // Se cerró la pestaña del grabador: lo grabado hasta ahí queda en las partes
    // guardadas y se puede recuperar desde el estudio.
    const id = rec.id;
    const wasRecording = ACTIVE.has(rec.status) || rec.status === 'saving';
    await endSession();
    if (wasRecording) openStudio(`#recuperar=${encodeURIComponent(id)}`);
  } else if (tabId === rec.tabId && ['tab', 'area'].includes(rec.mode) && rec.status !== 'idle') {
    if (ACTIVE.has(rec.status)) stopRecording();
    else discardRecording();
  }
});

// ---------------------------------------------------------------- documento offscreen (celular y cámara)

let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WEB_RTC', 'USER_MEDIA'],
      justification: 'Conectar el celular como control remoto y cámara, y entregar la cámara a la burbuja de la grabación.',
    })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function closeOffscreen(reason) {
  if (!(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ to: 'offscreen', type: 'stop', reason }).catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function toOffscreen(msg) {
  if (!(await hasOffscreen())) return null;
  return chrome.runtime.sendMessage({ ...msg, to: 'offscreen' }).catch(() => null);
}

// Identificador PeerJS y clave del enlace. No cambian entre sesiones (el celular se
// reconecta solo) salvo que se pida un código nuevo.
let identityPromise = null;

function randomToken(length) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function getIdentity(regenerate = false) {
  if (regenerate || !identityPromise) {
    identityPromise = (async () => {
      let identity = regenerate ? null : (await chrome.storage.local.get('identity')).identity;
      if (!identity?.peerId || !identity?.token) {
        identity = { peerId: `grabazo-${randomToken(12)}`, token: randomToken(20), since: Date.now() };
        await chrome.storage.local.set({ identity });
      }
      return identity;
    })();
  }
  return identityPromise;
}

async function startLink() {
  await ready();
  if (!link.active) await setLink({ ...LINK_IDLE, active: true, status: 'starting' });
  await ensureOffscreen();
  await toOffscreen({ type: 'link:start' });
  return snapshot();
}

async function stopLink() {
  await setLink({ ...LINK_IDLE });
  await toOffscreen({ type: 'link:stop', reason: 'stopped' });
  return snapshot();
}

async function resetLink() {
  await toOffscreen({ type: 'link:stop', reason: 'revoked' });
  await getIdentity(true);
  if (link.active) {
    await setLink({ status: 'starting', phones: [], camLive: false });
    await toOffscreen({ type: 'link:start' });
  }
  return { ...snapshot(), identity: await getIdentity() };
}

// ---------------------------------------------------------------- grabación

let countdownTimer = 0;

function needsTab(mode) {
  return mode === 'tab' || mode === 'area';
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function startRecording(opts = {}) {
  await ready();
  if (rec.status !== 'idle') return { ok: false, error: 'busy', ...snapshot() };
  settings = await getSettings();
  const mode = MODES.includes(opts.mode) ? opts.mode : settings.mode;
  let tab = Number.isInteger(opts.tabId) ? await chrome.tabs.get(opts.tabId).catch(() => null) : null;
  if (!tab) {
    const { prepTab } = await chrome.storage.session.get('prepTab');
    tab = Number.isInteger(prepTab) ? await chrome.tabs.get(prepTab).catch(() => null) : null;
  }
  tab ||= await activeTab();
  if (needsTab(mode) && !tab?.id) return { ok: false, error: 'no-tab', ...snapshot() };

  const id = `${Date.now().toString(36)}-${randomToken(5)}`;
  await commit({
    rec: {
      status: mode === 'area' ? 'area' : 'starting',
      id,
      mode,
      tabId: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
      title: (tab?.title || '').slice(0, 120),
      recorderTabId: null,
      countdown: settings.countdown,
      limit: settings.timeLimit * 60_000,
      elapsed: 0,
      resumedAt: 0,
      startedAt: 0,
      countdownEnd: 0,
      area: null,
      error: null,
    },
    ui: { ...initialUi(settings), toolbar: true },
  });

  if (mode !== 'camera' && tab?.id != null) {
    const injected = await inject(tab.id);
    if (!injected && needsTab(mode)) {
      await endSession('restricted');
      return { ok: false, error: 'restricted', ...snapshot() };
    }
  }
  if (settings.camera && mode !== 'camera') ensureOffscreen();
  if (mode === 'camera') await ensureOffscreen();
  if (mode === 'area') return { ok: true, ...snapshot() }; // la capa pide el área y luego llama a «area:chosen»
  return openRecorder();
}

async function openRecorder() {
  const visible = rec.mode === 'window' || rec.mode === 'screen' || rec.mode === 'camera';
  const create = { url: `${RECORDER_PATH}#${rec.id}`, active: visible, pinned: !visible };
  if (Number.isInteger(rec.windowId)) create.windowId = rec.windowId;
  if (!visible) create.index = 0;
  let tab;
  try {
    tab = await chrome.tabs.create(create);
  } catch {
    tab = await chrome.tabs.create({ url: create.url, active: visible, pinned: !visible });
  }
  await setRec({ recorderTabId: tab.id, status: visible && rec.mode !== 'camera' ? 'picking' : 'starting' });
  return { ok: true, ...snapshot() };
}

// El grabador pide su tarea al cargar.
async function recorderJob(sender) {
  await ready();
  if (rec.status === 'idle' || sender.tab?.id !== rec.recorderTabId) return { ok: false, error: 'stale' };
  const job = { ok: true, id: rec.id, mode: rec.mode, area: rec.area, tabId: rec.tabId, settings, ui, title: rec.title };
  if (needsTab(rec.mode)) {
    try {
      job.streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: rec.tabId, consumerTabId: sender.tab.id });
    } catch (err) {
      return { ok: false, error: /invoked|activeTab|permission/i.test(String(err?.message)) ? 'tab-permission' : /active stream/i.test(String(err?.message)) ? 'tab-busy' : 'tab-capture' };
    }
    const tab = await chrome.tabs.get(rec.tabId).catch(() => null);
    job.tabTitle = tab?.title || '';
  }
  return job;
}

// Las fuentes están listas: se vuelve a la pestaña de trabajo y empieza la cuenta regresiva.
async function recorderReady(msg, sender) {
  await ready();
  if (sender.tab?.id !== rec.recorderTabId) return { ok: false };
  if (!msg.ok) {
    const error = msg.error || 'capture';
    await endSession(error === 'canceled' ? null : error, typeof msg.detail === 'string' ? msg.detail.slice(0, 200) : '');
    return { ok: true };
  }
  if (rec.mode === 'window' || rec.mode === 'screen') {
    // La pestaña del grabador se fija a la izquierda y se vuelve a la página.
    chrome.tabs.update(rec.recorderTabId, { pinned: true }).catch(() => {});
    if (Number.isInteger(rec.tabId)) {
      await chrome.tabs.update(rec.tabId, { active: true }).catch(() => {});
      if (Number.isInteger(rec.windowId)) chrome.windows.update(rec.windowId, { focused: true }).catch(() => {});
    }
  }
  return beginCountdown();
}

async function beginCountdown() {
  clearTimeout(countdownTimer);
  const seconds = Number(rec.countdown) || 0;
  if (!seconds) {
    await setRec({ status: 'countdown', countdownEnd: Date.now() });
    go();
    return { ok: true };
  }
  await setRec({ status: 'countdown', countdownEnd: Date.now() + seconds * 1000 });
  countdownTimer = setTimeout(go, seconds * 1000);
  return { ok: true };
}

function go() {
  clearTimeout(countdownTimer);
  if (rec?.status !== 'countdown') return;
  toRecorder({ type: 'go' });
}

function toRecorder(msg) {
  return chrome.runtime.sendMessage({ ...msg, to: 'rec', id: rec?.id }).catch(() => null);
}

async function pauseRecording() {
  await ready();
  if (rec.status !== 'recording') return snapshot();
  await setRec({ status: 'paused', elapsed: elapsedOf(rec), resumedAt: 0 });
  toRecorder({ type: 'pause' });
  return snapshot();
}

async function resumeRecording() {
  await ready();
  if (rec.status !== 'paused') return snapshot();
  await setRec({ status: 'recording', resumedAt: Date.now() });
  toRecorder({ type: 'resume' });
  return snapshot();
}

async function togglePause() {
  await ready();
  return rec.status === 'paused' ? resumeRecording() : pauseRecording();
}

async function stopRecording() {
  await ready();
  if (rec.status === 'countdown') return discardRecording();
  if (rec.status === 'area' || rec.status === 'starting' || rec.status === 'picking') return discardRecording();
  if (!ACTIVE.has(rec.status)) return snapshot();
  await setRec({ status: 'saving', elapsed: elapsedOf(rec), resumedAt: 0 });
  await setUi({ tool: null, zoom: false, spotlight: false, blur: false, talking: false });
  toRecorder({ type: 'stop' });
  return snapshot();
}

async function restartRecording() {
  await ready();
  if (!ACTIVE.has(rec.status)) return snapshot();
  clearTimeout(countdownTimer);
  await setRec({ elapsed: 0, resumedAt: 0, startedAt: 0 });
  overlayCmd('clear');
  await setRec({ status: 'starting', countdownEnd: 0 });
  await toRecorder({ type: 'restart' });
  await beginCountdown();
  return snapshot();
}

async function discardRecording() {
  await ready();
  if (rec.status === 'idle') return snapshot();
  clearTimeout(countdownTimer);
  const recorderTabId = rec.recorderTabId;
  if (recorderTabId != null) {
    const res = await toRecorder({ type: 'discard' });
    if (!res) chrome.tabs.remove(recorderTabId).catch(() => {});
  }
  await endSession();
  return snapshot();
}

async function toggleRecording(opts) {
  await ready();
  if (rec.status === 'idle') return startRecording(opts);
  return stopRecording();
}

async function endSession(error = null, detail = '') {
  clearTimeout(countdownTimer);
  const recorderTabId = rec?.recorderTabId;
  await commit({ rec: { ...IDLE, error, ...(detail ? { detail } : {}), lastId: rec?.id || null }, ui: { ...initialUi(settings) } });
  await chrome.storage.session.remove('prepTab');
  if (recorderTabId != null) setTimeout(() => chrome.tabs.remove(recorderTabId).catch(() => {}), 400);
  // La capa se oculta sola al recibir el estado; la cámara se apaga si nadie la usa.
}

async function recorderSaved(msg, sender) {
  await ready();
  if (sender.tab?.id !== rec.recorderTabId) return { ok: false };
  const tabId = rec.tabId;
  const windowId = rec.windowId;
  await endSession();
  if (settings.openStudio && msg.id) openStudio(`#${encodeURIComponent(msg.id)}`, { tabId, windowId });
  return { ok: true };
}

async function openStudio(hash = '', near = {}) {
  const url = chrome.runtime.getURL(`${STUDIO_PATH}${hash}`);
  const create = { url, active: true };
  if (Number.isInteger(near.windowId)) create.windowId = near.windowId;
  if (Number.isInteger(near.tabId)) {
    const tab = await chrome.tabs.get(near.tabId).catch(() => null);
    if (tab) create.index = tab.index + 1;
  }
  return chrome.tabs.create(create).catch(() => chrome.tabs.create({ url, active: true }));
}

// ---------------------------------------------------------------- herramientas

const UI_KEYS = {
  tool: (v) => v === null || ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'text', 'eraser'].includes(v),
  color: (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v),
  width: (v) => Number.isFinite(v) && v >= 1 && v <= 40,
  spotlight: (v) => typeof v === 'boolean',
  zoom: (v) => typeof v === 'boolean',
  clicks: (v) => typeof v === 'boolean',
  blur: (v) => typeof v === 'boolean',
  toolbar: (v) => typeof v === 'boolean',
  camera: (v) => typeof v === 'boolean',
  mic: (v) => typeof v === 'boolean',
  talking: (v) => typeof v === 'boolean',
};

async function patchUi(raw = {}) {
  await ready();
  const patch = {};
  for (const [k, ok] of Object.entries(UI_KEYS)) if (k in raw && ok(raw[k])) patch[k] = raw[k];
  // Un modo de puntero a la vez: dibujar o difuminar.
  if (patch.tool) patch.blur = false;
  if (patch.blur) patch.tool = null;
  if (!Object.keys(patch).length) return snapshot();
  await setUi(patch);
  if ('camera' in patch && rec.status === 'idle') await chrome.storage.sync.set({ settings: { ...settings, camera: patch.camera } });
  return snapshot();
}

async function toggleUi(key) {
  await ready();
  if (key === 'tool') return patchUi({ tool: ui.tool ? null : 'pen' });
  return patchUi({ [key]: !ui[key] });
}

// ---------------------------------------------------------------- guion (teleprompter)

async function getScript() {
  const { script } = await chrome.storage.local.get('script');
  return script || { text: '', updated: 0 };
}

async function setScript(text) {
  const script = { text: String(text ?? '').replace(/\u0000/g, '').slice(0, 50_000), updated: Date.now() };
  await chrome.storage.local.set({ script });
  return script;
}

// ---------------------------------------------------------------- vista previa al abrir el popup

// Mientras el popup está abierto se muestra la burbuja de la cámara en la página, para
// acomodarla antes de grabar. Al cerrarlo sin grabar, desaparece.
chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return;
  // La burbuja o el grabador buscan la cámara y el documento offscreen todavía no existe:
  // el puerto llegó aquí. Se crea el documento y se suelta el puerto para que reintenten.
  if (port.name === 'grabazo-relay') {
    hasOffscreen().then((has) => {
      if (!has) ensureOffscreen().catch(() => {}).finally(() => port.disconnect());
    });
    return;
  }
  if (port.name !== 'grabazo-popup') return;
  let tabId = null;
  port.onMessage.addListener(async (msg) => {
    if (msg?.t !== 'prepare' || !Number.isInteger(msg.tabId)) return;
    tabId = msg.tabId;
    await ready();
    if (rec.status !== 'idle') return;
    await chrome.storage.session.set({ prepTab: tabId });
    const ok = settings.camera && settings.mode !== 'camera' ? await inject(tabId) : false;
    if (ok) ensureOffscreen();
    port.postMessage({ t: 'prepared', ok });
    broadcast();
  });
  port.onDisconnect.addListener(async () => {
    await ready();
    if (rec.status !== 'idle') return;
    const { prepTab } = await chrome.storage.session.get('prepTab');
    if (prepTab === tabId) await chrome.storage.session.remove('prepTab');
    broadcast();
  });
});

// ---------------------------------------------------------------- atajos de teclado

chrome.commands.onCommand.addListener(async (command, tab) => {
  await ready();
  switch (command) {
    case 'toggle-recording':
      return toggleRecording({ tabId: tab?.id });
    case 'toggle-pause':
      return togglePause();
    case 'toggle-draw':
      return toggleUi('tool');
    case 'toggle-zoom':
      return toggleUi('zoom');
    case 'toggle-spotlight':
      return toggleUi('spotlight');
    case 'toggle-mic':
      return toggleUi('mic');
    case 'toggle-camera':
      return toggleUi('camera');
    case 'toggle-toolbar':
      return toggleUi('toolbar');
  }
});

// ---------------------------------------------------------------- mensajes

// Órdenes que llegan de cualquier lado (popup, barra en la página, celular, atajos).
const OPS = {
  'rec:start': (m) => startRecording(m),
  'rec:toggle': (m) => toggleRecording(m),
  'rec:stop': () => stopRecording(),
  'rec:pause': () => pauseRecording(),
  'rec:resume': () => resumeRecording(),
  'rec:togglePause': () => togglePause(),
  'rec:restart': () => restartRecording(),
  'rec:discard': () => discardRecording(),
  'ui:set': (m) => patchUi(m.patch),
  'ui:toggle': (m) => (m.key in UI_KEYS ? toggleUi(m.key) : snapshot()),
  'ui:clear': () => { overlayCmd('clear'); return snapshot(); },
  'ui:undo': () => { overlayCmd('undo'); return snapshot(); },
  'ui:unblur': () => { overlayCmd('unblur'); return snapshot(); },
  ptt: (m) => patchUi({ talking: m.down === true }),
  'prefs:set': (m) => setSourcePrefs(m.patch),
};

// El celular puede pasar a ser la cámara o el micrófono de la grabación (y volver a los
// de la computadora).
async function setSourcePrefs(raw = {}) {
  await ready();
  const patch = {};
  if (typeof raw.camPhone === 'boolean') Object.assign(patch, raw.camPhone ? { camera: true, camId: PHONE } : { camId: settings.camId === PHONE ? '' : settings.camId });
  if (typeof raw.micPhone === 'boolean') Object.assign(patch, raw.micPhone ? { mic: true, micId: PHONE } : { micId: settings.micId === PHONE ? '' : settings.micId });
  if (Object.keys(patch).length) {
    settings = normalizeSettings({ ...settings, ...patch });
    await chrome.storage.sync.set({ settings });
    if ('camera' in patch && rec.status === 'idle') await setUi({ camera: settings.camera });
  }
  return snapshot();
}

// Páginas de la extensión (popup, grabador, estudio, ajustes, burbuja) y documento offscreen.
const handlers = {
  'state:get': async () => { await ready(); return snapshot(); },
  op: (msg) => (OPS[msg.op] ? OPS[msg.op](msg) : { ok: false, error: 'op' }),
  'studio:open': (msg) => openStudio(typeof msg.hash === 'string' ? msg.hash : ''),

  // Enlace con el celular
  'link:start': () => startLink(),
  'link:stop': () => stopLink(),
  'link:reset': () => resetLink(),
  'link:info': async () => ({ ...snapshot(), identity: await getIdentity() }),
  'link:kick': (msg) => toOffscreen({ type: 'kick', id: msg.id }),
  'script:get': () => getScript(),
  'script:set': (msg) => setScript(msg.text),

  // Grabador
  'rec:job': (msg, sender) => recorderJob(sender),
  'rec:ready': (msg, sender) => recorderReady(msg, sender),
  'rec:started': async (msg, sender) => {
    await ready();
    if (sender.tab?.id !== rec.recorderTabId || rec.status !== 'countdown') return { ok: false };
    const at = Number(msg.at) || Date.now();
    await setRec({ status: 'recording', resumedAt: at, startedAt: rec.startedAt || at, elapsed: 0 });
    return { ok: true };
  },
  'rec:tick': async (msg, sender) => {
    // Cada segundo de grabación (mantiene despierto al service worker y vigila el límite).
    await ready();
    if (sender.tab?.id !== rec.recorderTabId) return { ok: false };
    if (rec.limit && rec.status === 'recording' && elapsedOf(rec) >= rec.limit) stopRecording();
    return { ok: true, status: rec.status };
  },
  'rec:ended': async (msg, sender) => {
    // La fuente terminó sola (se cerró la pestaña o se dejó de compartir la pantalla).
    await ready();
    if (sender.tab?.id !== rec.recorderTabId) return { ok: false };
    if (ACTIVE.has(rec.status)) return stopRecording();
    if (rec.status !== 'saving') return discardRecording();
    return { ok: true };
  },
  'rec:saved': (msg, sender) => recorderSaved(msg, sender),
  'rec:failed': async (msg, sender) => {
    await ready();
    if (sender.tab?.id !== rec.recorderTabId) return { ok: false };
    const id = rec.id;
    await endSession(msg.error || 'failed');
    if (msg.recover) openStudio(`#recuperar=${encodeURIComponent(id)}`);
    return { ok: true };
  },

  // Documento offscreen
  identity: () => getIdentity(),
  'offscreen:ready': async () => { await ready(); return { settings, ui, rec, link, script: await getScript() }; },
  'link:status': (msg) => setLink({ status: msg.status, error: msg.error || null }),
  'link:phones': (msg) => setLink({ phones: Array.isArray(msg.phones) ? msg.phones.slice(0, 8) : [], camLive: msg.camLive === true }),
  'phone:script': (msg) => setScript(msg.text),
  'offscreen:idle': async () => {
    // Nadie usa la cámara y el celular no está enlazado: se cierra el documento.
    await ready();
    if (!link.active && rec.status === 'idle') await closeOffscreen('idle');
    return { ok: true };
  },
  'cam:wake': () => ensureOffscreen(),
};

// Capa sobre la página (script de contenido): solo órdenes de la interfaz.
const CONTENT_OPS = new Set(['rec:stop', 'rec:pause', 'rec:resume', 'rec:togglePause', 'rec:restart', 'rec:discard', 'ui:set', 'ui:toggle', 'ptt']);
const contentHandlers = {
  'overlay:hello': async (msg, sender) => {
    await ready();
    const tabId = sender.tab?.id;
    if (Number.isInteger(tabId)) await addOverlayTab(tabId);
    const { prepTab, toolbarPos, camPos } = { ...(await chrome.storage.session.get('prepTab')), ...(await chrome.storage.local.get(['toolbarPos', 'camPos'])) };
    return { ...snapshot(), role: roleFor(tabId, prepTab), toolbarPos: toolbarPos || null, camPos: camPos || null, ext: SELF };
  },
  'overlay:op': (msg) => (CONTENT_OPS.has(msg.op) ? OPS[msg.op](msg) : { ok: false }),
  'area:chosen': async (msg, sender) => {
    await ready();
    if (rec.status !== 'area' || sender.tab?.id !== rec.tabId) return { ok: false };
    const r = msg.area || {};
    const n = (v) => Math.max(0, Number(v) || 0);
    const area = { x: n(r.x), y: n(r.y), w: n(r.w), h: n(r.h), vw: n(r.vw), vh: n(r.vh) };
    if (area.w < 40 || area.h < 40 || !area.vw || !area.vh) return { ok: false };
    await setRec({ area, status: 'starting' });
    return openRecorder();
  },
  'area:cancel': async (msg, sender) => {
    await ready();
    if (rec.status !== 'area' || sender.tab?.id !== rec.tabId) return { ok: false };
    await endSession();
    return { ok: true };
  },
  'overlay:save': async (msg) => {
    const pos = (p) => (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Math.round(p.x), y: Math.round(p.y), w: Number.isFinite(p.w) ? Math.round(p.w) : undefined } : null);
    if (msg.toolbarPos) await chrome.storage.local.set({ toolbarPos: pos(msg.toolbarPos) });
    if (msg.camPos) await chrome.storage.local.set({ camPos: pos(msg.camPos) });
    return { ok: true };
  },
  'overlay:settings': async (msg) => {
    // Ajustes que se cambian desde la capa: forma, tamaño y espejo de la burbuja, tinta que
    // se desvanece, zoom al hacer clic y cursor oculto.
    const patch = {};
    if (['circle', 'rect'].includes(msg.patch?.camShape)) patch.camShape = msg.patch.camShape;
    if (['s', 'm', 'l', 'xl'].includes(msg.patch?.camSize)) patch.camSize = msg.patch.camSize;
    for (const k of ['camMirror', 'camera', 'drawFade', 'zoomOnClick', 'hideIdleCursor', 'toolbarAutoHide']) {
      if (typeof msg.patch?.[k] === 'boolean') patch[k] = msg.patch[k];
    }
    if (Object.keys(patch).length) await chrome.storage.sync.set({ settings: normalizeSettings({ ...settings, ...patch }) });
    return { ok: true };
  },
  'open:permissions': () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#permisos') }),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'sw' || sender.id !== chrome.runtime.id) return;
  const trusted = sender.origin === SELF || (sender.url || '').startsWith(`${SELF}/`);
  const handler = trusted ? handlers[msg.type] || contentHandlers[msg.type] : contentHandlers[msg.type];
  if (!handler) return;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((res) => sendResponse(res ?? null), (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// ---------------------------------------------------------------- ciclo de vida

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.session.set({ rec: { ...IDLE }, link: { ...LINK_IDLE }, overlays: [] });
  loading = null;
  await ready();
  updateBadge();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#bienvenida') });
});

ready().then(updateBadge);
