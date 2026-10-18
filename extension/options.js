// Grabazo — bienvenida y ajustes.

/* global GrabazoRelay */

import { ALL_SITES, CAM_EFFECTS, CAM_FILTERS, LIMITS, PHONE, REMOTE_URL, buildRemoteUrl, getSettings, grantedOrigins, hasAllSites, removeOrigins, requestOrigins, saveSettings } from './config.js';
import { qrSvg } from './lib/qr.js';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra }).catch(() => null);
$('version').textContent = chrome.runtime.getManifest().version;

let settings = await getSettings();
let link = {};
let identity = null;

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
}

async function save(patch, quiet = false) {
  settings = await saveSettings(patch);
  render();
  if (!quiet) toast(t('saved'));
}

const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });

// ---------------------------------------------------------------- ajustes genéricos (data-setting)

for (const v of LIMITS) $('limit').append(option(String(v), v ? t('minutes', [String(v)]) : t('noLimit')));
for (const v of CAM_EFFECTS) $('cam-effect').append(option(v, t(`fx_${v.replace('-', '_')}`)));
for (const v of CAM_FILTERS) $('cam-filter').append(option(v, t(`filter_${v}`)));

function render() {
  for (const el of document.querySelectorAll('[data-setting]')) {
    const key = el.dataset.setting;
    const value = settings[key];
    if (el.classList.contains('seg')) {
      for (const b of el.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
    } else if (el.type === 'checkbox') {
      el.checked = !!value;
    } else if (el.tagName === 'SELECT') {
      el.value = String(value);
    }
  }
  $('ptt-key').textContent = keyName(settings.pttKey);
  $('remote-url').value = settings.remoteUrl || '';
  $('remote-url').placeholder = REMOTE_URL;
  $('cam-preview').classList.toggle('mirror', !!settings.camMirror);
}

const cast = (el, v) => (el.dataset.type === 'number' ? Number(v) : v);

for (const el of document.querySelectorAll('[data-setting]')) {
  const key = el.dataset.setting;
  if (el.classList.contains('seg')) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) save({ [key]: cast(el, b.dataset.v) });
    });
  } else if (el.type === 'checkbox') {
    el.addEventListener('change', () => save({ [key]: el.checked }));
  } else if (el.tagName === 'SELECT') {
    el.addEventListener('change', () => save({ [key]: cast(el, el.value) }));
  }
}

// ---------------------------------------------------------------- permisos

async function permState(name) {
  try { return (await navigator.permissions.query({ name })).state; } catch { return 'prompt'; }
}

async function renderPerms() {
  for (const [id, name, label] of [['perm-cam', 'camera', 'camera'], ['perm-mic', 'microphone', 'microphone']]) {
    const state = await permState(name);
    const el = $(id);
    el.dataset.state = state;
    el.querySelector('span').textContent = `${t(label === 'camera' ? 'permCam' : 'permMic')}: ${t(`perm_${state}`)}`;
  }
}

// La cámara y el micrófono se permiten una vez para toda la extensión (el grabador, la
// burbuja y el documento offscreen usan el mismo permiso).
async function allowMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach((tr) => tr.stop());
    toast(t('mediaAllowed'));
  } catch (err) {
    // Sin cámara conectada: al menos el micrófono.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((tr) => tr.stop());
      toast(t('micAllowed'));
    } catch {
      toast(err.name === 'NotAllowedError' ? t('mediaDenied') : t('mediaFailed'));
    }
  }
  renderPerms();
  renderDevices();
}
$('allow-media').addEventListener('click', allowMedia);
$('allow-media-2').addEventListener('click', allowMedia);
$('open-studio').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('estudio.html') }));

async function renderSites() {
  const all = await hasAllSites();
  $('all-sites').checked = all;
  const list = $('sites');
  list.replaceChildren();
  if (all) return;
  for (const origin of await grantedOrigins()) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dot"></span><span class="host"></span><button class="btn small ghost" type="button"></button>';
    li.querySelector('.host').textContent = origin.replace(/^https?:\/\//, '').replace(/\/\*$/, '');
    const b = li.querySelector('button');
    b.textContent = t('remove');
    b.addEventListener('click', async () => {
      await removeOrigins([origin]);
      renderSites();
    });
    list.append(li);
  }
}

$('all-sites').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const ok = await requestOrigins(ALL_SITES.origins);
    if (!ok) e.target.checked = false;
  } else {
    await removeOrigins(ALL_SITES.origins);
  }
  renderSites();
});

// ---------------------------------------------------------------- dispositivos y vista previa de la cámara

async function renderDevices() {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch {}
  const cams = list.filter((d) => d.kind === 'videoinput' && d.deviceId);
  const mics = list.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
  const camSel = $('cam-select');
  // Sin permiso, Chrome no da la lista: se ofrece la cámara predeterminada de la computadora.
  const camList = cams.length ? cams.map((d, i) => option(d.deviceId, d.label || t('cameraN', [String(i + 1)]))) : [option('', t('pcCamera'))];
  camSel.replaceChildren(option('off', t('noCamera')), ...camList, option(PHONE, t('phoneCamera')));
  camSel.value = !settings.camera ? 'off' : settings.camId === PHONE ? PHONE : cams.some((d) => d.deviceId === settings.camId) ? settings.camId : cams[0]?.deviceId ?? '';
  const micSel = $('mic-select');
  const micList = mics.length ? mics.map((d, i) => option(d.deviceId, d.label || t('micN', [String(i + 1)]))) : [option('', t('pcMic'))];
  micSel.replaceChildren(option('off', t('noMic')), ...micList, option(PHONE, t('phoneMic')));
  micSel.value = !settings.mic ? 'off' : settings.micId === PHONE ? PHONE : mics.some((d) => d.deviceId === settings.micId) ? settings.micId : mics[0]?.deviceId ?? '';
}

$('cam-select').addEventListener('change', (e) => save(e.target.value === 'off' ? { camera: false } : { camera: true, camId: e.target.value }).then(renderDevices));
$('mic-select').addEventListener('change', (e) => save(e.target.value === 'off' ? { mic: false } : { mic: true, micId: e.target.value }).then(renderDevices));

// Vista previa con los efectos: la misma imagen que verá la burbuja.
let preview = null;
let previewState = null;
function renderPreview() {
  const live = !!previewState?.live && !!preview?.stream.getVideoTracks().some((tr) => tr.readyState === 'live');
  const s = previewState || {};
  $('cam-msg').textContent = live ? '' : !settings.camera ? t('noCamera') : s.source === 'phone' ? t('camWaitPhone') : s.error === 'denied' ? t('camDenied') : s.error ? t('camFailed') : t('camStarting');
}
function startPreview() {
  if (preview || !settings.camera) return;
  preview = GrabazoRelay.connect({
    kind: 'preview',
    onStream: (stream) => {
      $('cam-video').srcObject = stream;
      $('cam-video').play().catch(() => {});
      renderPreview();
    },
    onState: (s) => { previewState = s; renderPreview(); },
    onIdle: () => sw('cam:wake'),
  });
}
function stopPreview() {
  preview?.close();
  preview = null;
  previewState = null;
  $('cam-video').srcObject = null;
  renderPreview();
}
// Solo mientras la tarjeta de la cámara está a la vista (la luz de la cámara se enciende).
new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting && settings.camera) startPreview();
  else stopPreview();
}, { threshold: 0.3 }).observe($('cam-preview'));

// ---------------------------------------------------------------- tecla para hablar

function keyName(code = '') {
  const names = { Backquote: t('keyBackquote'), Space: t('keySpace'), AltLeft: 'Alt ⌥', AltRight: 'Alt ⌥ (der.)', ControlRight: 'Ctrl (der.)', ShiftRight: 'Shift (der.)' };
  if (names[code]) return names[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

let listening = false;
$('ptt-key').addEventListener('click', () => {
  listening = true;
  $('ptt-key').classList.add('listening');
  $('ptt-key').textContent = t('pressKey');
});
addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault();
  listening = false;
  $('ptt-key').classList.remove('listening');
  if (e.code === 'Escape') { render(); return; }
  save({ pttKey: e.code });
}, true);

// ---------------------------------------------------------------- guion (teleprompter)

let scriptTimer = 0;
async function loadScript() {
  const script = await sw('script:get');
  if (document.activeElement !== $('script')) $('script').value = script?.text || '';
  countScript();
}
function countScript() {
  const text = $('script').value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  // Unas 140 palabras por minuto al leer en voz alta.
  $('script-count').textContent = t('scriptCount', [String(words), String(Math.max(1, Math.round(words / 140)))]);
}
$('script').addEventListener('input', () => {
  countScript();
  $('script-saved').textContent = '';
  clearTimeout(scriptTimer);
  scriptTimer = setTimeout(async () => {
    await sw('script:set', { text: $('script').value });
    $('script-saved').textContent = t('scriptSynced');
  }, 500);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.script) loadScript();
  if (area === 'sync' && changes.settings) {
    getSettings().then((s) => {
      settings = s;
      render();
      if (!settings.camera) stopPreview();
    });
  }
});

// ---------------------------------------------------------------- celular

async function renderLink() {
  const info = await sw('link:info');
  link = info?.link || {};
  identity = info?.identity || identity;
  const active = !!link.active;
  const phones = Array.isArray(link.phones) ? link.phones : [];
  const url = identity ? buildRemoteUrl(settings.remoteUrl || REMOTE_URL, identity.peerId, identity.token) : '';
  if (url && $('link-qr').dataset.for !== url) {
    $('link-qr').innerHTML = qrSvg(url);
    $('link-qr').dataset.for = url;
  }
  $('link-qr').classList.toggle('off', !active || link.status !== 'ready');
  $('link-title').textContent = !active ? t('phoneOff') : phones.length ? (phones.length === 1 ? t('phoneOne', [phones[0].name]) : t('phoneMany', [String(phones.length)])) : link.status === 'ready' ? t('phoneScan') : link.status === 'error' ? t('phoneError') : t('statusStarting');
  $('link-sub').textContent = t('phoneLinkSub');
  $('link-start').hidden = active;
  $('link-stop').hidden = !active;
  $('link-copy').hidden = !active;
  const list = $('phones');
  list.replaceChildren();
  for (const p of phones) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dot"></span><span class="name"></span><span class="tag"></span><button class="btn small ghost" type="button"></button>';
    li.querySelector('.name').textContent = p.name;
    li.querySelector('.tag').textContent = [p.cam ? t('tagCam') : '', p.mic ? t('tagMic') : ''].filter(Boolean).join(' · ');
    const b = li.querySelector('button');
    b.textContent = t('disconnect');
    b.addEventListener('click', () => sw('link:kick', { id: p.id }));
    list.append(li);
  }
}
$('link-start').addEventListener('click', async () => { await sw('link:start'); renderLink(); });
$('link-stop').addEventListener('click', async () => { await sw('link:stop'); renderLink(); });
$('link-reset').addEventListener('click', async () => {
  if (!confirm(t('confirmNewCode'))) return;
  const res = await sw('link:reset');
  identity = res?.identity || null;
  renderLink();
  toast(t('newCodeDone'));
});
$('link-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('link-qr').dataset.for || '').catch(() => {});
  toast(t('linkCopied'));
});
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id === chrome.runtime.id && msg?.to === 'all' && msg.type === 'state') renderLink();
});

// ---------------------------------------------------------------- atajos

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const list = $('shortcuts');
  list.replaceChildren();
  for (const c of commands) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = c.name === '_execute_action' ? t('cmdOpen') : c.description;
    const key = document.createElement('kbd');
    key.textContent = c.shortcut || t('noShortcut');
    li.append(name, key);
    list.append(li);
  }
}
$('edit-shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// ---------------------------------------------------------------- avanzado

$('remote-url').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  if (v && !/^https:\/\//.test(v)) {
    toast(t('invalidUrl'));
    e.target.value = settings.remoteUrl || '';
    return;
  }
  save({ remoteUrl: v });
});
$('remote-reset').addEventListener('click', () => save({ remoteUrl: '' }));

// ---------------------------------------------------------------- inicio

render();
renderPerms();
renderSites();
renderDevices();
renderShortcuts();
loadScript();
renderLink();
chrome.permissions.onAdded.addListener(renderSites);
chrome.permissions.onRemoved.addListener(renderSites);
if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'start' });
if (location.hash === '#permisos' && ((await permState('camera')) !== 'granted' || (await permState('microphone')) !== 'granted')) allowMedia();
