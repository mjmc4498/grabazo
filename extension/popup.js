// Grabazo — popup.
// Antes de grabar: qué grabar, cámara (de la computadora o del celular, con forma,
// tamaño, efecto y filtro), micrófono, sonido del sistema, pulsar para hablar, cuenta
// regresiva y límite de tiempo. Mientras se graba: tiempo, pausa, detener, reiniciar,
// descartar y las herramientas. Abajo, el QR para conectar el celular.

import { CAM_EFFECTS, CAM_FILTERS, LIMITS, PHONE, REMOTE_URL, buildRemoteUrl, clock, elapsedOf, getSettings, saveSettings } from './config.js';
import { qrSvg } from './lib/qr.js';
import { t, applyI18n } from './lib/i18n.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);

applyI18n();

let settings = await getSettings();
let rec = { status: 'idle' };
let ui = {};
let link = {};
let tab = null;
let identity = null;
let port = null;
let toastTimer = 0;

// ================================================================ pestaña actual

// popup.html?tab=<id> abre el popup como si estuviera sobre esa pestaña (capturas y pruebas).
const forcedTab = Number(new URLSearchParams(location.search).get('tab'));
tab = forcedTab ? await chrome.tabs.get(forcedTab).catch(() => null) : null;
if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const url = tab?.url || '';
const isStore = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url);
const canTab = !!tab && !isStore && !/^(chrome|edge|about|devtools|view-source|chrome-search|chrome-untrusted):/.test(url) && !(url.startsWith('chrome-extension:') && !url.startsWith(chrome.runtime.getURL('')));
const canOverlay = /^https?:/.test(url) && !isStore;

// Con el popup abierto se ve la burbuja de la cámara en la página para acomodarla.
function prepare() {
  if (!tab?.id || !canOverlay) return;
  try {
    port ||= chrome.runtime.connect({ name: 'grabazo-popup' });
    port.postMessage({ t: 'prepare', tabId: tab.id });
  } catch {}
}

// ================================================================ dispositivos

async function devices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    return {
      cams: list.filter((d) => d.kind === 'videoinput' && d.deviceId),
      mics: list.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications'),
    };
  } catch {
    return { cams: [], mics: [] };
  }
}

async function permissions() {
  const state = async (name) => {
    try { return (await navigator.permissions.query({ name })).state; } catch { return 'prompt'; }
  };
  return { camera: await state('camera'), microphone: await state('microphone') };
}

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

async function renderDevices() {
  const [{ cams, mics }, perms] = await Promise.all([devices(), permissions()]);
  const camSel = $('#cam-select');
  // Sin permiso, Chrome no da la lista: se ofrece «Cámara de la computadora» (la predeterminada).
  const camList = cams.length ? cams.map((d, i) => option(d.deviceId, d.label || t('cameraN', [String(i + 1)]))) : [option('', t('pcCamera'))];
  camSel.replaceChildren(option('off', t('noCamera')), ...camList, option(PHONE, t('phoneCamera')));
  camSel.value = !settings.camera ? 'off' : settings.camId === PHONE ? PHONE : cams.some((d) => d.deviceId === settings.camId) ? settings.camId : cams[0]?.deviceId ?? '';

  const micSel = $('#mic-select');
  const micList = mics.length ? mics.map((d, i) => option(d.deviceId, d.label || t('micN', [String(i + 1)]))) : [option('', t('pcMic'))];
  micSel.replaceChildren(option('off', t('noMic')), ...micList, option(PHONE, t('phoneMic')));
  micSel.value = !settings.mic ? 'off' : settings.micId === PHONE ? PHONE : mics.some((d) => d.deviceId === settings.micId) ? settings.micId : mics.find((d) => d.deviceId === 'default')?.deviceId ?? mics[0]?.deviceId ?? '';

  const needs = (settings.camera && settings.camId !== PHONE && perms.camera !== 'granted') || (settings.mic && settings.micId !== PHONE && perms.microphone !== 'granted');
  $('#perm-banner').hidden = !needs;
}

// ================================================================ ajustes de la grabación

function setSeg(id, value) {
  for (const b of $$(`#${id} button`)) b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
}

function renderSettings() {
  for (const b of $$('#modes button')) {
    const m = b.dataset.mode;
    b.setAttribute('aria-checked', String(m === settings.mode));
    b.disabled = (m === 'tab' && !canTab) || (m === 'area' && !canOverlay);
  }
  const subs = { tab: 'modeTabSub', area: 'modeAreaSub', window: 'modeWindowSub', screen: 'modeScreenSub', camera: 'modeCameraSub' };
  const blocked = (settings.mode === 'tab' && !canTab) || (settings.mode === 'area' && !canOverlay);
  $('#mode-sub').textContent = blocked ? t('modeBlocked') : t(subs[settings.mode]);
  $('#cam-opts').hidden = !settings.camera;
  renderPreview();
  setSeg('cam-shape', settings.camShape);
  setSeg('cam-size', settings.camSize);
  $('#cam-effect').value = settings.camEffect;
  $('#cam-filter').value = settings.camFilter;
  $('#system-audio').checked = !!settings.systemAudio;
  $('#system-sub').textContent = settings.mode === 'tab' || settings.mode === 'area' ? t('systemAudioTab') : settings.mode === 'camera' ? t('systemAudioNone') : t('systemAudioScreen');
  $('#system-audio').disabled = settings.mode === 'camera';
  $('#ptt').checked = !!settings.pushToTalk;
  setSeg('countdown', settings.countdown);
  $('#limit').value = String(settings.timeLimit);
  $('#record').disabled = blocked;
}

async function save(patch) {
  settings = await saveSettings(patch);
  renderSettings();
}

for (const v of CAM_EFFECTS) $('#cam-effect').append(option(v, t(`fx_${v.replace('-', '_')}`)));
for (const v of CAM_FILTERS) $('#cam-filter').append(option(v, t(`filter_${v}`)));
for (const v of LIMITS) $('#limit').append(option(String(v), v ? t('minutes', [String(v)]) : t('noLimit')));

$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b && !b.disabled) save({ mode: b.dataset.mode }).then(prepare);
});
$('#cam-select').addEventListener('change', async (e) => {
  const v = e.target.value;
  await save(v === 'off' ? { camera: false } : { camera: true, camId: v });
  renderDevices();
  prepare();
});
$('#mic-select').addEventListener('change', async (e) => {
  const v = e.target.value;
  await save(v === 'off' ? { mic: false } : { mic: true, micId: v });
  renderDevices();
});
$('#cam-shape').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) save({ camShape: b.dataset.v }); });
$('#cam-size').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) save({ camSize: b.dataset.v }); });
$('#cam-effect').addEventListener('change', (e) => save({ camEffect: e.target.value }));
$('#cam-filter').addEventListener('change', (e) => save({ camFilter: e.target.value }));
$('#system-audio').addEventListener('change', (e) => save({ systemAudio: e.target.checked }));
$('#ptt').addEventListener('change', (e) => save({ pushToTalk: e.target.checked }));
$('#countdown').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) save({ countdown: Number(b.dataset.v) }); });
$('#limit').addEventListener('change', (e) => save({ timeLimit: Number(e.target.value) }));
$('#perm-banner').addEventListener('click', () => openPage('options.html#permisos'));

// ================================================================ grabar

$('#record').addEventListener('click', async () => {
  $('#record').disabled = true;
  $('#alert').hidden = true;
  const res = await toSW({ type: 'op', op: 'rec:start', mode: settings.mode, tabId: tab?.id });
  if (res?.ok) {
    window.close();
    return;
  }
  $('#record').disabled = false;
  const errors = { restricted: 'errRestricted', 'no-tab': 'errRestricted', busy: 'errBusy' };
  $('#alert').textContent = t(errors[res?.error] || 'errCapture');
  $('#alert').hidden = false;
});

// ================================================================ grabando

const STATES = { starting: 'statusStarting', picking: 'statusPicking', area: 'statusArea', placing: 'statusPlacing', countdown: 'statusCountdown', recording: 'statusRecording', paused: 'statusPaused', saving: 'statusSaving' };

function renderLive() {
  const live = rec.status !== 'idle';
  document.body.dataset.view = live ? 'live' : 'idle';
  document.body.dataset.status = rec.status;
  $('#live').hidden = !live;
  const pill = $('#status');
  pill.dataset.tone = rec.status === 'recording' ? 'rec' : live ? 'warn' : 'ok';
  $('#status-text').textContent = t(STATES[rec.status] || 'statusReady');
  if (!live) return;
  $('#live-state').textContent = t(STATES[rec.status] || 'statusRecording');
  const paused = rec.status === 'paused';
  $('#pause').setAttribute('aria-pressed', String(paused));
  $('#pause-label').textContent = t(paused ? 'resume' : 'pause');
  for (const b of $$('#toggles button')) {
    const k = b.dataset.key;
    const on = k === 'tool' ? !!ui.tool : k === 'toolbar' ? ui.toolbar !== false : k === 'mic' ? (settings.pushToTalk ? !!ui.talking : ui.mic !== false) : !!ui[k];
    b.setAttribute('aria-pressed', String(on));
    b.disabled = rec.mode === 'camera' && ['tool', 'zoom', 'spotlight', 'clicks', 'blur', 'camera', 'toolbar'].includes(k);
  }
  tick();
}

function tick() {
  if (rec.status === 'idle') return;
  const ms = elapsedOf(rec);
  const limit = Number(rec.limit) || 0;
  $('#live-time').textContent = rec.status === 'countdown' ? `${Math.max(0, Math.ceil((rec.countdownEnd - Date.now()) / 1000))}` : limit ? `−${clock(limit - ms)}` : clock(ms);
  document.body.classList.toggle('ending', !!limit && limit - ms <= 10_000 && rec.status === 'recording');
}
setInterval(tick, 250);

$('#placed').addEventListener('click', () => toSW({ type: 'op', op: 'rec:placed' }).then(() => window.close()));
$('#pause').addEventListener('click', () => toSW({ type: 'op', op: 'rec:togglePause' }));
$('#stop').addEventListener('click', () => toSW({ type: 'op', op: 'rec:stop' }));
$('#restart').addEventListener('click', () => toSW({ type: 'op', op: 'rec:restart' }));
$('#discard').addEventListener('click', () => {
  if (confirm(t('confirmDiscard'))) toSW({ type: 'op', op: 'rec:discard' });
});
$('#toggles').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-key]');
  if (!b) return;
  toSW({ type: 'op', op: 'ui:toggle', key: b.dataset.key });
});

// ================================================================ celular

async function renderPhone() {
  const phones = Array.isArray(link.phones) ? link.phones : [];
  const sec = $('#phone');
  sec.classList.toggle('linked', phones.length > 0);
  let sub;
  if (phones.length === 1) sub = t('phoneOne', [phones[0].name]);
  else if (phones.length > 1) sub = t('phoneMany', [String(phones.length)]);
  else if (link.active && link.status === 'error') sub = t('phoneError');
  else if (link.active) sub = t('phoneScan');
  else sub = t('phoneOff');
  $('#phone-sub').textContent = sub;
  $('#unlink').hidden = !link.active;
  const open = $('#phone-toggle').getAttribute('aria-expanded') === 'true';
  $('#phone-body').hidden = !open;
  if (!open) return;
  const ready = link.active && link.status === 'ready';
  $('#qr-card').classList.toggle('loading', !ready);
  if (link.active && !identity) {
    const info = await toSW({ type: 'link:info' });
    identity = info?.identity || null;
  }
  if (identity && !$('#qr').dataset.for) {
    const target = buildRemoteUrl(settings.remoteUrl || REMOTE_URL, identity.peerId, identity.token);
    $('#qr').innerHTML = qrSvg(target);
    $('#qr').dataset.for = target;
  }
}

$('#phone-toggle').addEventListener('click', async () => {
  const b = $('#phone-toggle');
  const open = b.getAttribute('aria-expanded') !== 'true';
  b.setAttribute('aria-expanded', String(open));
  try { localStorage.setItem('grabazo.phoneOpen', open ? '1' : ''); } catch {}
  if (open && !link.active) {
    const res = await toSW({ type: 'link:start' });
    if (res?.link) link = res.link;
  }
  renderPhone();
});
$('#unlink').addEventListener('click', async () => {
  const res = await toSW({ type: 'link:stop' });
  if (res?.link) link = res.link;
  $('#phone-toggle').setAttribute('aria-expanded', 'false');
  renderPhone();
});
$('#copy-link').addEventListener('click', async () => {
  const target = $('#qr').dataset.for;
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target);
    toast(t('linkCopied'));
  } catch {}
});

// ================================================================ pie

function openPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}
$('#library').addEventListener('click', () => openPage('estudio.html'));
$('#options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ================================================================ vista previa de la cámara

// Antes de grabar se ve la cámara (con sus efectos) en un círculo pequeño, también en los
// modos ventana y pantalla, donde la burbuja no está en la página.
let preview = null;
let previewState = null;

function renderPreview() {
  const want = !!settings.camera && settings.mode !== 'camera' && rec.status === 'idle';
  if (want && !preview && globalThis.GrabazoRelay) {
    preview = GrabazoRelay.connect({
      kind: 'preview',
      onStream: (stream) => {
        const v = $('#cam-video');
        if (v.srcObject !== stream) v.srcObject = stream;
        v.play().catch(() => {});
        paintPreview();
      },
      onState: (s) => {
        previewState = s;
        paintPreview();
      },
      onIdle: () => toSW({ type: 'cam:wake' }),
    });
  } else if (!want && preview) {
    preview.close();
    preview = null;
    $('#cam-video').srcObject = null;
  }
  paintPreview();
}

function paintPreview() {
  const el = $('#cam-preview');
  const s = previewState || {};
  const live = !!s.live && !!preview?.stream.getVideoTracks().some((tr) => tr.readyState === 'live');
  el.classList.toggle('live', live);
  el.classList.toggle('rect', settings.camShape === 'rect');
  el.classList.toggle('mirror', settings.camMirror !== false);
  el.classList.toggle('error', !live && !!s.error && s.source !== 'phone');
  el.classList.toggle('phone', !live && s.source === 'phone');
  el.title = live ? t('camPreview') : s.source === 'phone' ? t('bubblePhoneLink') : s.error === 'denied' ? t('bubbleDenied') : s.error ? t('bubbleFailed') : t('camStarting');
}
$('#cam-video').addEventListener('playing', paintPreview);
$('#cam-preview').addEventListener('click', () => {
  if (previewState?.error === 'denied') toSW({ type: 'open:permissions' });
});

// ================================================================ estado

function apply(s) {
  if (!s) return;
  if (s.rec) rec = s.rec;
  if (s.ui) ui = s.ui;
  if (s.link) link = s.link;
  if (s.settings) settings = s.settings;
  renderLive();
  renderPhone();
  renderPreview();
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg?.to !== 'all' || msg.type !== 'state') return;
  apply(msg);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    getSettings().then((s) => {
      settings = s;
      renderSettings();
      renderDevices();
    });
  }
});

renderSettings();
renderDevices();
apply(await toSW({ type: 'state:get' }));
try {
  if (localStorage.getItem('grabazo.phoneOpen')) {
    $('#phone-toggle').setAttribute('aria-expanded', 'true');
    if (!link.active) apply(await toSW({ type: 'link:start' }));
    renderPhone();
  }
} catch {}
if (rec.status === 'idle') prepare();
