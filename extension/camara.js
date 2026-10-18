// Grabazo — burbuja de la cámara (página de la extensión dentro de la página grabada).
// Recibe la cámara ya lista (de la computadora o del celular, con sus efectos) desde el
// documento offscreen por una conexión local y la muestra. Mientras no hay imagen
// explica qué falta: permiso, cámara ocupada o el celular sin conectar.

/* global GrabazoRelay */

import { t } from './lib/i18n.js';

const $ = (sel) => document.querySelector(sel);
const video = $('#video');
let state = null;

function render() {
  const live = !!state?.live && !!video.srcObject?.getVideoTracks().some((tr) => tr.readyState === 'live');
  document.body.classList.toggle('live', live);
  if (live) return;
  const s = state || {};
  let msg = t('camStarting');
  let fix = '';
  let phone = false;
  if (s.source === 'phone') {
    phone = true;
    msg = s.linked && s.phones ? t('bubblePhoneWait') : t('bubblePhoneLink');
  } else if (s.error === 'denied') {
    msg = t('bubbleDenied');
    fix = t('bubbleAllow');
  } else if (s.error === 'busy') {
    msg = t('bubbleBusy');
  } else if (s.error) {
    msg = t('bubbleFailed');
  }
  $('#msg').textContent = msg;
  $('#spin').hidden = !!s.error || phone;
  $('#icon').hidden = !phone;
  $('#fix').hidden = !fix;
  $('#fix').textContent = fix;
}

$('#fix').addEventListener('click', () => {
  chrome.runtime.sendMessage({ to: 'sw', type: 'open:permissions' }).catch(() => {});
});

GrabazoRelay.connect({
  kind: 'bubble',
  onStream: (stream) => {
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
    render();
  },
  onState: (s) => {
    state = s;
    render();
  },
  // Sin documento offscreen todavía: se pide que lo abra.
  onIdle: () => chrome.runtime.sendMessage({ to: 'sw', type: 'cam:wake' }).catch(() => {}),
});

// Modo espejo según los ajustes (cambia al instante si se cambia en la burbuja o el popup).
async function applyMirror() {
  try {
    const { settings } = await chrome.storage.sync.get('settings');
    document.body.classList.toggle('mirror', settings?.camMirror !== false);
  } catch {}
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) applyMirror();
});
applyMirror();

video.addEventListener('playing', render);
video.addEventListener('emptied', render);
render();
