// Grabazo — estudio: biblioteca de grabaciones («Mis grabaciones») y editor.
//
//   estudio.html                      biblioteca
//   estudio.html#<id>                 editor de esa grabación
//   estudio.html#recuperar=<recId>    biblioteca con el aviso para recuperar una grabación
//                                     interrumpida (Chrome o el grabador se cerraron a mitad)
//
// El editor recorta el inicio y el final, quita partes (cortes), silencia el audio y
// exporta a MP4, WebM o GIF (lib/exportar.js). Sin cambios, la exportación es
// instantánea: se copia el video tal cual, sin volver a codificarlo.

import { clock } from './config.js';
import { listVideos, getVideo, putVideo, updateVideo, deleteVideo, chunksOf, clearChunks, pendingRecordings, defaultTitle } from './lib/db.js';
import { keptRanges, mergeCuts, totalOf, probe, canCopy, remux, exportVideo, exportGif, filmstrip, poster, isAbort } from './lib/exportar.js';
import { t, applyI18n } from './lib/i18n.js';

applyI18n();

const $ = (sel) => document.querySelector(sel);
const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);
const nf1 = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('es', { maximumFractionDigits: 0 });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const span = (seconds) => clock(Math.round(seconds) * 1000); // duraciones: 3,98 s → «0:04»
const fine = (seconds) => (seconds < 60 ? t('stSeconds', [nf1.format(seconds)]) : span(seconds)); // «2,4 s»
const EPS = 0.05; // s: diferencia que no cuenta como recorte
const STRIP_COUNT = 16;

let view = '';

// ================================================================ utilidades

let toastTimer = 0;
function toast(text, error = false) {
  const box = $('#toast');
  box.textContent = text;
  box.classList.toggle('error', error);
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), error ? 4200 : 2600);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const ICONS = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 8v4l3 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;

function iconBtn(act, icon, title, extra = '') {
  const b = el('button', `btn icon ${extra}`.trim());
  b.type = 'button';
  b.dataset.act = act;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = svg(icon);
  return b;
}

// «17 oct 2026, 21:05»
function fmtDate(ms) {
  const d = new Date(ms || Date.now());
  const day = d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

function fmtSize(bytes = 0) {
  if (bytes >= 1e9) return t('stGb', [nf1.format(bytes / 1e9)]);
  if (bytes >= 1e6) return t('stMb', [nf1.format(bytes / 1e6)]);
  return t('stKb', [nf0.format(Math.max(1, bytes / 1e3))]);
}

const MODE_KEYS = { tab: 'stModeTab', area: 'stModeArea', window: 'stModeWindow', screen: 'stModeScreen', camera: 'stModeCamera' };
const modeLabel = (mode) => (MODE_KEYS[mode] ? t(MODE_KEYS[mode]) : '');

// Nombre de archivo seguro: «Grabación 17 oct 2026, 21-05».
function safeName(title) {
  const name = String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
  return name || 'Grabazo';
}

const extOf = (mime = '') => (/mp4/.test(mime) ? 'mp4' : /gif/.test(mime) ? 'gif' : /x-matroska/.test(mime) ? 'mkv' : 'webm');

// Descarga con chrome.downloads (carpeta «Grabazo» dentro de Descargas) o, si no se
// puede, con un enlace.
async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    const done = (delta) => {
      if (delta.id !== id || !delta.state || delta.state.current === 'in_progress') return;
      chrome.downloads.onChanged.removeListener(done);
      URL.revokeObjectURL(url);
    };
    chrome.downloads.onChanged.addListener(done);
    return id;
  } catch (err) {
    console.debug('[Grabazo] chrome.downloads', err);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
    return null;
  }
}

async function downloadOriginal(meta, blob) {
  if (!blob) return toast(t('stDownloadFailed'), true);
  const name = `${safeName(meta.title)}.${extOf(blob.type || meta.mime)}`;
  await download(blob, `Grabazo/${name}`);
  toast(t('stDownloading', [name]));
}

async function showStorage() {
  try {
    const { usage } = await navigator.storage.estimate();
    $('#storage').textContent = usage ? t('stStorage', [fmtSize(usage)]) : '';
  } catch {
    $('#storage').textContent = '';
  }
}

function setView(name) {
  view = name;
  document.body.dataset.view = name;
  $('#library').hidden = name !== 'library';
  $('#editor').hidden = name !== 'editor';
}

// ================================================================ rutas

async function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith('recuperar=')) return showLibrary(hash.slice('recuperar='.length));
  if (hash) return openEditor(hash);
  return showLibrary();
}

window.addEventListener('hashchange', route);

$('#home').addEventListener('click', (e) => {
  e.preventDefault();
  goLibrary();
});

function goLibrary() {
  if (exporting && !confirm(t('stConfirmLeave'))) return;
  if (location.hash && location.hash !== '#') location.hash = '';
  else route();
}

$('#new-rec').addEventListener('click', async () => {
  try {
    await chrome.action.openPopup();
  } catch (err) {
    console.debug('[Grabazo] openPopup', err);
    toast(t('stNewHint'));
  }
});

// ================================================================ biblioteca

let recoverId = '';
let thumbUrls = [];
let liveRec = null;
let libraryBusy = null;

async function showLibrary(recId = '') {
  closeEditor();
  setView('library');
  document.title = t('stPageTitle');
  recoverId = recId;
  await renderLibrary();
}

// Si se pide otra vez mientras se dibuja, se vuelve a dibujar al terminar.
let libraryAgain = false;
async function renderLibrary() {
  if (libraryBusy) {
    libraryAgain = true;
    return libraryBusy;
  }
  libraryAgain = false;
  libraryBusy = (async () => {
    const [videos, pending, state] = await Promise.all([
      listVideos().catch((err) => { console.debug('[Grabazo] listVideos', err); return []; }),
      pendingRecordings().catch(() => []),
      toSW({ type: 'state:get' }),
    ]);
    if (view !== 'library') return;
    // La grabación en curso también tiene partes guardadas: esa no está interrumpida.
    liveRec = state?.rec && state.rec.status && state.rec.status !== 'idle' ? state.rec.id : null;
    const interrupted = pending.filter((id) => id !== liveRec);

    // #recuperar=<id> de una grabación que ya se guardó: se abre directamente.
    if (recoverId && !interrupted.includes(recoverId)) {
      const saved = videos.find((v) => v.id === recoverId);
      const id = recoverId;
      recoverId = '';
      if (saved) {
        location.replace(`#${encodeURIComponent(id)}`);
        return;
      }
      history.replaceState(null, '', location.pathname);
      if (id !== liveRec) toast(t('stRecoverMissing'));
    }

    for (const u of thumbUrls) URL.revokeObjectURL(u);
    thumbUrls = [];

    $('#recover-banner').hidden = !recoverId;
    const cards = [];
    for (const id of interrupted) {
      if (id === recoverId) continue;
      cards.push(await pendingCard(id));
    }
    for (const meta of videos) cards.push(videoCard(meta));
    $('#grid').replaceChildren(...cards.filter(Boolean));

    const n = videos.length;
    $('#lib-count').textContent = n ? (n === 1 ? t('stCountOne') : t('stCountMany', [nf0.format(n)])) : '';
    $('#empty').hidden = n > 0 || interrupted.length > 0;
    showStorage();
    fillMissingThumbs(videos);
  })()
    .catch((err) => console.debug('[Grabazo] biblioteca', err))
    .finally(() => {
      libraryBusy = null;
      if (libraryAgain && view === 'library') renderLibrary();
    });
  return libraryBusy;
}

function thumbBox(blob, label) {
  const thumb = el('button', 'thumb');
  thumb.type = 'button';
  thumb.dataset.act = 'open';
  thumb.setAttribute('aria-label', label);
  if (blob) {
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    const url = URL.createObjectURL(blob);
    thumbUrls.push(url);
    img.src = url;
    thumb.append(img);
  } else {
    const ph = el('span', 'ph');
    ph.innerHTML = svg('film');
    thumb.append(ph);
  }
  return thumb;
}

function hasEdits(edits, duration) {
  if (!edits) return false;
  return (edits.cuts?.length > 0) || edits.mute || edits.trimStart > EPS || (duration > 0 && edits.trimEnd < duration - EPS);
}

function videoCard(meta) {
  const card = el('article', 'vcard');
  card.dataset.id = meta.id;
  const thumb = thumbBox(meta.thumb, `${t('stOpenTitle')}: ${meta.title}`);
  const hover = el('span', 'hover-play');
  hover.innerHTML = `<span>${svg('play')}</span>`;
  thumb.append(hover, el('span', 'badge', span((meta.duration || 0) / 1000)));
  if (hasEdits(meta.edits, (meta.duration || 0) / 1000)) thumb.append(el('span', 'badge left', t('stEdited')));

  const body = el('div', 'vbody');
  const title = el('div', 'vtitle', meta.title || defaultTitle(new Date(meta.created)));
  title.title = title.textContent;
  const bits = [fmtDate(meta.created), fmtSize(meta.size), modeLabel(meta.mode)].filter(Boolean);
  const actions = el('div', 'vactions');
  const open = el('button', 'btn small');
  open.type = 'button';
  open.dataset.act = 'open';
  open.innerHTML = `${svg('edit')}<span></span>`;
  open.lastChild.textContent = t('stOpen');
  actions.append(open, el('span', 'spacer'), iconBtn('download', 'download', t('stDownloadOriginal')), iconBtn('delete', 'trash', t('stDelete'), 'danger'));
  body.append(title, el('div', 'vmeta', bits.join(' · ')), actions);
  card.append(thumb, body);
  return card;
}

async function pendingCard(id) {
  const rows = await chunksOf(id).catch(() => []);
  if (!rows.length) return null;
  const head = rows.find((r) => r.meta)?.meta || {};
  const size = rows.reduce((sum, r) => sum + (r.blob?.size || 0), 0);
  const card = el('article', 'vcard pending');
  card.dataset.rec = id;
  const thumb = thumbBox(null, t('stRecover'));
  thumb.dataset.act = 'recover';
  thumb.append(el('span', 'badge warn', t('stInterrupted')), el('span', 'badge', clock(rows.length * 1000)));
  const body = el('div', 'vbody');
  body.append(
    el('div', 'vtitle', head.created ? defaultTitle(new Date(head.created)) : t('stInterrupted')),
    el('div', 'vmeta', [head.created ? fmtDate(head.created) : '', modeLabel(head.mode)].filter(Boolean).join(' · ')),
    el('div', 'vmeta wrap', t('stInterruptedBody', [fmtSize(size)])),
  );
  const actions = el('div', 'vactions');
  const go = el('button', 'btn small accent');
  go.type = 'button';
  go.dataset.act = 'recover';
  go.innerHTML = `${svg('restore')}<span></span>`;
  go.lastChild.textContent = t('stRecover');
  actions.append(go, el('span', 'spacer'), iconBtn('discard', 'trash', t('stDiscard'), 'danger'));
  body.append(actions);
  card.append(thumb, body);
  return card;
}

$('#grid').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  const card = e.target.closest('.vcard');
  if (!btn || !card) return;
  const { id, rec } = card.dataset;
  const act = btn.dataset.act;
  if (act === 'open') location.hash = `#${encodeURIComponent(id)}`;
  else if (act === 'download') {
    const found = await getVideo(id).catch(() => null);
    if (found) downloadOriginal(found.meta, found.blob);
    else toast(t('stDownloadFailed'), true);
  } else if (act === 'delete') {
    const title = card.querySelector('.vtitle')?.textContent || '';
    if (!confirm(t('stConfirmDelete', [title]))) return;
    try {
      await deleteVideo(id);
      toast(t('stDeleted'));
    } catch (err) {
      console.debug('[Grabazo] eliminar', err);
      toast(t('stDeleteFailed'), true);
    }
    renderLibrary();
  } else if (act === 'recover') {
    card.classList.add('busy');
    await recover(rec);
    card.classList.remove('busy');
  } else if (act === 'discard') discard(rec);
});

$('#recover-go').addEventListener('click', async () => {
  const btn = $('#recover-go');
  btn.disabled = true;
  btn.querySelector('.spinner').hidden = false;
  $('#recover-body').textContent = t('stRecovering');
  await recover(recoverId);
  btn.disabled = false;
  btn.querySelector('.spinner').hidden = true;
  $('#recover-body').textContent = t('stRecoverBannerBody');
});

$('#recover-discard').addEventListener('click', () => discard(recoverId));

// Une las partes guardadas de una grabación interrumpida y la deja en la biblioteca.
async function recover(recId) {
  if (!recId) return;
  try {
    const existing = await getVideo(recId).catch(() => null);
    if (existing?.blob) {
      await clearChunks(recId);
      location.hash = `#${encodeURIComponent(recId)}`;
      return;
    }
    const rows = await chunksOf(recId);
    if (!rows.length) {
      toast(t('stRecoverMissing'), true);
      recoverId = '';
      history.replaceState(null, '', location.pathname);
      return renderLibrary();
    }
    const head = rows.find((r) => r.meta)?.meta || {};
    const type = head.mime || 'video/webm';
    const blob = new Blob(rows.map((r) => r.blob), { type });
    const [info, thumb] = await Promise.all([
      probe(blob, { duration: true }).catch((err) => { console.debug('[Grabazo] recuperar: duración', err); return null; }),
      poster(blob).catch(() => null),
    ]);
    const created = Number(head.created) || Date.now();
    const meta = {
      id: recId,
      title: defaultTitle(new Date(created)),
      created,
      duration: Math.round((info?.duration > 0 ? info.duration : rows.length) * 1000),
      width: info?.width || 0,
      height: info?.height || 0,
      mime: type,
      size: blob.size,
      mode: head.mode || 'tab',
      thumb,
    };
    await putVideo(meta, blob);
    await clearChunks(recId);
    recoverId = '';
    toast(t('stRecovered'));
    location.hash = `#${encodeURIComponent(recId)}`;
  } catch (err) {
    console.debug('[Grabazo] recuperar', err);
    toast(t('stRecoverFailed'), true);
  }
}

async function discard(recId) {
  if (!recId || !confirm(t('stConfirmDiscard'))) return;
  await clearChunks(recId).catch((err) => console.debug('[Grabazo] descartar', err));
  if (recId === recoverId) {
    recoverId = '';
    history.replaceState(null, '', location.pathname);
  }
  toast(t('stDiscarded'));
  renderLibrary();
}

// Grabaciones sin miniatura (p. ej. si Chrome no alcanzó a tomarla): se crea una.
let fillingThumbs = false;
async function fillMissingThumbs(videos) {
  if (fillingThumbs) return;
  const missing = videos.filter((v) => !v.thumb).slice(0, 12);
  if (!missing.length) return;
  fillingThumbs = true;
  let changed = false;
  try {
    for (const meta of missing) {
      if (view !== 'library') break;
      const found = await getVideo(meta.id).catch(() => null);
      if (!found?.blob) continue;
      const thumb = await poster(found.blob).catch(() => null);
      if (thumb) {
        await updateVideo(meta.id, { thumb });
        changed = true;
      }
    }
  } finally {
    fillingThumbs = false;
  }
  if (changed && view === 'library') renderLibrary();
}

// La biblioteca se actualiza cuando termina una grabación o al volver a la pestaña.
let refreshTimer = 0;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (view === 'library') renderLibrary(); }, 500);
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'state' || msg.to !== 'all' || view !== 'library') return;
  const status = msg.rec?.status || 'idle';
  if ((status === 'idle') !== (liveRec === null)) refreshSoon();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'library') refreshSoon(); });

// ================================================================ editor

const video = $('#video');
const track = $('#track');
const tl = $('#tl');

const ed = {
  token: 0,
  id: '',
  meta: null,
  blob: null,
  url: '',
  info: null,
  duration: 0,
  edit: { trimStart: 0, trimEnd: 0, cuts: [], mute: false },
  sel: null, // { start, end } (uno de los dos puede ser null mientras se marca)
  picked: -1, // corte elegido
  undo: [],
  redo: [],
  seekTo: null,
};

const kept = () => keptRanges(ed.edit);
const minLen = () => Math.min(0.5, ed.duration / 4);
const now = () => (ed.seekTo ?? video.currentTime) || 0;
const pct = (s) => `${ed.duration ? (clamp(s, 0, ed.duration) / ed.duration) * 100 : 0}%`;
const trimmed = () => ed.edit.trimStart > EPS || ed.edit.trimEnd < ed.duration - EPS;
const edited = () => trimmed() || ed.edit.cuts.length > 0;

function closeEditor() {
  ed.token++;
  if (exporting) exporting.ctrl.abort();
  flushSave();
  video.pause();
  video.removeAttribute('src');
  video.load();
  if (ed.url) URL.revokeObjectURL(ed.url);
  Object.assign(ed, { id: '', meta: null, blob: null, url: '', info: null, duration: 0, sel: null, picked: -1, undo: [], redo: [], seekTo: null });
  ed.edit = { trimStart: 0, trimEnd: 0, cuts: [], mute: false };
  document.body.classList.remove('playing');
}

function waitEvent(target, ok, bad, ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(reject, new Error('timeout')), ms);
    const onOk = () => finish(resolve);
    const onBad = () => finish(reject, new Error(bad));
    function finish(fn, arg) {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      if (bad) target.removeEventListener(bad, onBad);
      fn(arg);
    }
    target.addEventListener(ok, onOk);
    if (bad) target.addEventListener(bad, onBad);
  });
}

// Los archivos de MediaRecorder no traen la duración (Infinity): se pide ir al final y
// Chrome la calcula.
async function loadDuration() {
  // Chrome no carga videos en pestañas que aún no se han mostrado: se espera a que se vea.
  if (document.hidden && video.readyState < 1) await new Promise((resolve) => document.addEventListener('visibilitychange', resolve, { once: true }));
  if (!(video.readyState >= 1)) await waitEvent(video, 'loadedmetadata', 'error');
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  await new Promise((resolve) => {
    const timer = setTimeout(done, 5000);
    function done() {
      clearTimeout(timer);
      video.removeEventListener('durationchange', check);
      resolve();
    }
    function check() { if (Number.isFinite(video.duration)) done(); }
    video.addEventListener('durationchange', check);
    video.currentTime = 1e101;
  });
  const d = video.duration;
  video.currentTime = 0;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

async function openEditor(id) {
  if (exporting) exporting.ctrl.abort();
  closeEditor();
  const token = ed.token;
  setView('editor');
  document.body.classList.add('loading-video');
  $('#strip').replaceChildren();
  $('#cuts').replaceChildren();
  $('#title').value = '';
  $('#details').replaceChildren();
  renderExportUi();

  const found = await getVideo(id).catch((err) => { console.debug('[Grabazo] getVideo', err); return null; });
  if (token !== ed.token) return;
  if (!found?.blob) {
    toast(t('stNotFound'), true);
    location.replace('#');
    return;
  }
  ed.id = id;
  ed.meta = found.meta;
  ed.blob = found.blob;
  $('#title').value = ed.meta.title || '';
  document.title = t('stEditorPageTitle', [ed.meta.title || '']);
  ed.url = URL.createObjectURL(ed.blob);
  video.src = ed.url;

  const infoReady = probe(ed.blob).catch((err) => { console.debug('[Grabazo] probe', err); return null; });
  infoReady.then((info) => {
    if (token !== ed.token) return;
    ed.info = info;
    renderDetails();
    renderExportUi();
  });

  let duration = await loadDuration().catch((err) => { console.debug('[Grabazo] video', err); return 0; });
  if (token !== ed.token) return;
  if (!(duration > 0)) {
    // Chrome no pudo abrir el video: se usa la duración que dice el archivo.
    const exact = await probe(ed.blob, { duration: true }).catch(() => null);
    if (token !== ed.token) return;
    duration = exact?.duration || (ed.meta.duration || 0) / 1000;
    toast(t('stLoadFailed'), true);
  }
  ed.duration = duration;
  restoreEdits();
  video.muted = ed.edit.mute;
  document.body.classList.remove('loading-video');
  seek(ed.edit.trimStart);
  renderDetails();
  renderRuler();
  render();
  loadStrip(token);
  if (!ed.meta.thumb) {
    poster(ed.blob).then((thumb) => thumb && updateVideo(id, { thumb })).catch(() => {});
  }
}

function restoreEdits() {
  const saved = ed.meta.edits || {};
  const d = ed.duration;
  const trimStart = clamp(Number(saved.trimStart) || 0, 0, d);
  let trimEnd = Number(saved.trimEnd);
  trimEnd = trimEnd > trimStart ? clamp(trimEnd, trimStart, d) : d;
  const cuts = mergeCuts(
    (Array.isArray(saved.cuts) ? saved.cuts : [])
      .map((c) => ({ start: clamp(Number(c.start) || 0, 0, d), end: clamp(Number(c.end) || 0, 0, d) }))
      .filter((c) => c.end - c.start > 0.01),
  );
  ed.edit = { trimStart, trimEnd: trimEnd - trimStart < 0.1 ? d : trimEnd, cuts, mute: saved.mute === true };
  if (!kept().length) ed.edit = { trimStart: 0, trimEnd: d, cuts: [], mute: ed.edit.mute };
}

// ---------------------------------------------------------------- cambios (deshacer)

// Los cambios se guardan con la grabación (se conservan al volver a abrirla).
let persistTimer = 0;
let pendingSave = null;
function persist() {
  clearTimeout(persistTimer);
  const edits = structuredClone(ed.edit);
  ed.meta.edits = edits;
  pendingSave = { id: ed.id, edits };
  persistTimer = setTimeout(flushSave, 400);
}

function flushSave() {
  clearTimeout(persistTimer);
  const job = pendingSave;
  pendingSave = null;
  if (job) updateVideo(job.id, { edits: job.edits }).catch((err) => console.debug('[Grabazo] guardar cambios', err));
}

const snap = () => JSON.stringify(ed.edit);

function commit(before) {
  if (snap() === before) return render();
  ed.undo.push(before);
  if (ed.undo.length > 200) ed.undo.shift();
  ed.redo = [];
  persist();
  render();
}

function change(fn) {
  const before = snap();
  fn();
  commit(before);
}

function undo() {
  if (!ed.undo.length) return;
  ed.redo.push(snap());
  ed.edit = JSON.parse(ed.undo.pop());
  afterHistory();
}

function redo() {
  if (!ed.redo.length) return;
  ed.undo.push(snap());
  ed.edit = JSON.parse(ed.redo.pop());
  afterHistory();
}

function afterHistory() {
  ed.picked = -1;
  video.muted = ed.edit.mute;
  persist();
  render();
}

// ---------------------------------------------------------------- reproducción

let raf = 0;

function seek(s) {
  if (!ed.duration) return;
  const target = clamp(s, 0, ed.duration);
  ed.seekTo = target;
  video.currentTime = target;
  renderPlayhead();
}

video.addEventListener('seeked', () => {
  ed.seekTo = null;
  renderPlayhead();
});

// Mientras se reproduce, se saltan las partes cortadas y se para en el final.
function enforce() {
  const ranges = kept();
  const s = video.currentTime;
  if (!ranges.length) return video.pause();
  if (ranges.some((r) => s >= r.start - 0.02 && s < r.end - 0.03)) return;
  const next = ranges.find((r) => r.start > s - 0.02);
  if (next) {
    video.currentTime = next.start;
  } else {
    video.pause();
    video.currentTime = ranges[ranges.length - 1].end;
  }
}

function frame() {
  raf = 0;
  if (video.paused || ed.seekTo != null) {
    renderPlayhead();
    if (!video.paused) raf = requestAnimationFrame(frame);
    return;
  }
  enforce();
  renderPlayhead();
  raf = requestAnimationFrame(frame);
}

function togglePlay() {
  if (!ed.duration || view !== 'editor') return;
  if (!video.paused) return video.pause();
  const ranges = kept();
  if (!ranges.length) return;
  const s = now();
  const end = ranges[ranges.length - 1].end;
  if (s >= end - 0.05 || s < ranges[0].start - 0.02) seek(ranges[0].start);
  video.play().catch((err) => console.debug('[Grabazo] play', err));
}

video.addEventListener('play', () => {
  document.body.classList.add('playing');
  renderTransport();
  if (!raf) raf = requestAnimationFrame(frame);
});
video.addEventListener('pause', () => {
  document.body.classList.remove('playing');
  renderTransport();
});
video.addEventListener('timeupdate', () => {
  if (!video.paused) enforce();
  renderPlayhead();
});
video.addEventListener('click', togglePlay);
$('#big-play').addEventListener('click', togglePlay);
$('#play').addEventListener('click', togglePlay);

// ---------------------------------------------------------------- edición

function setTrim(which, s) {
  const m = minLen();
  if (which === 'start') ed.edit.trimStart = clamp(s, 0, ed.edit.trimEnd - m);
  else ed.edit.trimEnd = clamp(s, ed.edit.trimStart + m, ed.duration);
}

function trimHere(which) {
  if (!ed.duration) return;
  change(() => setTrim(which, now()));
  if (which === 'start') seek(ed.edit.trimStart);
}

function markIn() {
  if (!ed.duration) return;
  const s = now();
  const end = ed.sel?.end != null && ed.sel.end > s + 0.05 ? ed.sel.end : null;
  ed.sel = { start: s, end };
  ed.picked = -1;
  render();
}

function markOut() {
  if (!ed.duration) return;
  const s = now();
  const start = ed.sel?.start != null && ed.sel.start < s - 0.05 ? ed.sel.start : null;
  ed.sel = { start, end: s };
  ed.picked = -1;
  render();
}

const selReady = () => ed.sel && ed.sel.start != null && ed.sel.end != null && ed.sel.end - ed.sel.start >= 0.05;

function cutSelection() {
  if (!ed.duration) return;
  if (!selReady()) return toast(t('stSelectFirst'));
  const start = clamp(ed.sel.start, 0, ed.duration);
  const end = clamp(ed.sel.end, 0, ed.duration);
  const cuts = mergeCuts([...ed.edit.cuts, { start, end }]);
  if (!keptRanges({ ...ed.edit, cuts }).length) return toast(t('stCutAll'), true);
  ed.sel = null;
  ed.picked = -1;
  change(() => { ed.edit.cuts = cuts; });
  const s = now();
  if (s >= start && s < end) seek(end);
  toast(t('stCutAdded'));
}

function removeCut(i) {
  if (!ed.edit.cuts[i]) return;
  ed.picked = -1;
  change(() => { ed.edit.cuts.splice(i, 1); });
  toast(t('stCutRemoved'));
}

function toggleMute(on = !ed.edit.mute) {
  change(() => { ed.edit.mute = on; });
  video.muted = ed.edit.mute;
}

function resetEdits() {
  ed.sel = null;
  ed.picked = -1;
  change(() => {
    ed.edit.trimStart = 0;
    ed.edit.trimEnd = ed.duration;
    ed.edit.cuts = [];
  });
}

$('#mark-in').addEventListener('click', markIn);
$('#mark-out').addEventListener('click', markOut);
$('#cut').addEventListener('click', cutSelection);
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#trim-in').addEventListener('click', () => trimHere('start'));
$('#trim-out').addEventListener('click', () => trimHere('end'));
$('#reset').addEventListener('click', resetEdits);
$('#mute').addEventListener('change', (e) => toggleMute(e.target.checked));

// ---------------------------------------------------------------- línea de tiempo (ratón)

const timeAt = (clientX) => {
  const r = track.getBoundingClientRect();
  return r.width ? clamp((clientX - r.left) / r.width, 0, 1) * ed.duration : 0;
};

let drag = null;

tl.addEventListener('pointerdown', (e) => {
  if (!ed.duration || e.button !== 0 || e.target.closest('.cut-x')) return;
  e.preventDefault();
  tl.setPointerCapture(e.pointerId);
  const handle = e.target.closest('.handle');
  const cut = e.target.closest('.cut');
  if (handle) {
    handle.focus({ preventScroll: true });
    video.pause();
    drag = { kind: 'trim', which: handle.dataset.which, before: snap() };
  } else if (e.target.closest('.ruler, .playhead')) {
    drag = { kind: 'seek' };
    seek(timeAt(e.clientX));
  } else {
    drag = { kind: 'track', x0: e.clientX, t0: timeAt(e.clientX), cut: cut ? Number(cut.dataset.i) : -1, moved: false };
  }
});

tl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const s = timeAt(e.clientX);
  if (drag.kind === 'trim') {
    setTrim(drag.which, s);
    seek(drag.which === 'start' ? ed.edit.trimStart : ed.edit.trimEnd);
    renderTimeline();
    renderSummary();
  } else if (drag.kind === 'seek') {
    seek(s);
  } else if (drag.kind === 'track') {
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 4) return;
    drag.moved = true;
    ed.sel = { start: Math.min(drag.t0, s), end: Math.max(drag.t0, s) };
    ed.picked = -1;
    renderTimeline();
    renderTransport();
  }
});

function endDrag() {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === 'trim') commit(d.before);
  else if (d.kind === 'track' && !d.moved) {
    ed.sel = null;
    if (d.cut >= 0) ed.picked = d.cut === ed.picked ? -1 : d.cut;
    else {
      ed.picked = -1;
      seek(d.t0);
    }
    render();
  } else if (d.kind === 'track') {
    render();
  }
}
tl.addEventListener('pointerup', endDrag);
tl.addEventListener('pointercancel', endDrag);

$('#cuts').addEventListener('click', (e) => {
  const x = e.target.closest('.cut-x');
  if (x) removeCut(Number(x.closest('.cut').dataset.i));
});

new ResizeObserver(() => { if (view === 'editor') renderRuler(); }).observe(track);

// ---------------------------------------------------------------- miniaturas

async function loadStrip(token) {
  const strip = $('#strip');
  const cells = Array.from({ length: STRIP_COUNT }, () => {
    const c = el('canvas');
    c.width = 160;
    c.height = 90;
    return c;
  });
  strip.replaceChildren(...cells);
  const painted = new Set();
  const paint = (i, src) => {
    if (token !== ed.token || !src || !cells[i]) return;
    const c = cells[i];
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    c.classList.add('on');
    painted.add(i);
  };
  try {
    await filmstrip(ed.blob, { count: STRIP_COUNT, duration: ed.duration, height: 90, onFrame: paint, stale: () => token !== ed.token });
  } catch (err) {
    console.debug('[Grabazo] miniaturas (WebCodecs)', err);
  }
  const missing = cells.map((_, i) => i).filter((i) => !painted.has(i));
  if (missing.length && token === ed.token) await stripFromVideo(token, paint, missing);
}

// Plan B: un video oculto que salta por la grabación.
async function stripFromVideo(token, paint, indexes) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = ed.url;
  try {
    await waitEvent(v, 'loadeddata', 'error');
    const canvas = el('canvas');
    for (const i of indexes) {
      if (token !== ed.token) break;
      v.currentTime = ((i + 0.5) * ed.duration) / STRIP_COUNT;
      await waitEvent(v, 'seeked', 'error', 5000);
      canvas.height = 90;
      canvas.width = Math.round((90 * (v.videoWidth || 16)) / (v.videoHeight || 9));
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      paint(i, canvas);
    }
  } catch (err) {
    console.debug('[Grabazo] miniaturas (video)', err);
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

// ---------------------------------------------------------------- dibujo

function render() {
  if (view !== 'editor') return;
  renderTimeline();
  renderTransport();
  renderSummary();
  renderExportUi();
}

function renderTimeline() {
  const { trimStart, trimEnd, cuts } = ed.edit;
  $('#dim-start').style.width = pct(trimStart);
  $('#dim-end').style.width = `calc(100% - ${pct(trimEnd)})`;
  const box = $('#trim-box');
  box.style.left = pct(trimStart);
  box.style.width = `calc(${pct(trimEnd)} - ${pct(trimStart)})`;
  const hs = $('#h-start');
  const he = $('#h-end');
  hs.style.left = pct(trimStart);
  he.style.left = pct(trimEnd);
  hs.setAttribute('aria-valuenow', trimStart.toFixed(2));
  hs.setAttribute('aria-valuetext', clock(trimStart * 1000));
  he.setAttribute('aria-valuenow', trimEnd.toFixed(2));
  he.setAttribute('aria-valuetext', clock(trimEnd * 1000));
  for (const h of [hs, he]) {
    h.setAttribute('aria-valuemin', '0');
    h.setAttribute('aria-valuemax', ed.duration.toFixed(2));
  }

  $('#cuts').replaceChildren(...cuts.map((c, i) => {
    const box = el('div', `cut${i === ed.picked ? ' on' : ''}`);
    box.dataset.i = i;
    box.style.left = pct(c.start);
    box.style.width = `calc(${pct(c.end)} - ${pct(c.start)})`;
    box.title = `${clock(c.start * 1000)} – ${clock(c.end * 1000)}`;
    const x = el('button', 'cut-x');
    x.type = 'button';
    x.title = t('stRemoveCut');
    x.setAttribute('aria-label', t('stRemoveCut'));
    x.innerHTML = svg('x');
    box.append(x);
    return box;
  }));

  const sel = $('#sel');
  const s = ed.sel;
  sel.hidden = !s || (s.start == null && s.end == null);
  if (!sel.hidden) {
    const point = s.start == null || s.end == null;
    sel.classList.toggle('point', point);
    sel.style.left = pct(point ? (s.start ?? s.end) : s.start);
    sel.style.width = point ? '' : `calc(${pct(s.end)} - ${pct(s.start)})`;
  }
  renderPlayhead();
}

function renderPlayhead() {
  if (view !== 'editor') return;
  const s = now();
  $('#playhead').style.left = pct(s);
  $('#time').textContent = `${clock(s * 1000)} / ${span(ed.duration)}`;
}

function renderTransport() {
  const playing = !video.paused;
  const play = $('#play');
  play.setAttribute('aria-pressed', String(playing));
  play.title = t(playing ? 'stPause' : 'stPlay');
  play.setAttribute('aria-label', play.title);
  $('#cut').disabled = !selReady();
  $('#undo').disabled = !ed.undo.length;
  $('#redo').disabled = !ed.redo.length;
  $('#reset').disabled = !edited();
  $('#mute').checked = ed.edit.mute;
}

function renderSummary() {
  const total = totalOf(kept());
  const result = $('#result');
  result.textContent = edited()
    ? t('stResultOf', [fine(total), fine(ed.duration)])
    : t('stResult', [fine(total)]);
  result.classList.toggle('changed', edited());
}

function renderRuler() {
  const ruler = $('#ruler');
  const w = track.clientWidth;
  if (!ed.duration || !w) return ruler.replaceChildren();
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  const step = steps.find((s) => (s / ed.duration) * w >= 70) || 7200;
  const ticks = [];
  for (let s = 0; s <= ed.duration + 1e-6; s += step) {
    const tick = el('span', 'tick', (s / ed.duration) * w < w - 34 ? clock(s * 1000) : '');
    tick.style.left = pct(s);
    ticks.push(tick);
    const half = s + step / 2;
    if (step >= 2 && half < ed.duration) {
      const minor = el('span', 'tick minor');
      minor.style.left = pct(half);
      ticks.push(minor);
    }
  }
  ruler.replaceChildren(...ticks);
}

function renderDetails() {
  if (!ed.meta) return;
  const m = ed.meta;
  const info = ed.info;
  const w = m.width || info?.width;
  const h = m.height || info?.height;
  const codecs = info ? [info.container, info.video, info.audio].filter(Boolean).map((c) => c.toUpperCase()).join(' · ') : extOf(m.mime).toUpperCase();
  const rows = [
    ['stDetCreated', fmtDate(m.created)],
    ['stDetDuration', span(ed.duration || m.duration / 1000 || 0)],
    ['stDetSize', fmtSize(ed.blob?.size || m.size)],
    ['stDetResolution', w && h ? `${w} × ${h}` : ''],
    ['stDetFormat', codecs],
    ['stDetMode', modeLabel(m.mode)],
  ].filter(([, v]) => v);
  const items = [];
  for (const [key, value] of rows) items.push(el('dt', '', t(key)), el('dd', '', value));
  $('#details').replaceChildren(...items);
}

// ---------------------------------------------------------------- título y acciones

const titleInput = $('#title');
async function saveTitle() {
  if (!ed.meta) return;
  const value = titleInput.value.trim().slice(0, 120);
  if (!value) {
    titleInput.value = ed.meta.title;
    return;
  }
  if (value === ed.meta.title) return;
  ed.meta.title = value;
  document.title = t('stEditorPageTitle', [value]);
  try {
    await updateVideo(ed.id, { title: value });
    toast(t('stTitleSaved'));
  } catch (err) {
    console.debug('[Grabazo] título', err);
  }
}
titleInput.addEventListener('blur', saveTitle);
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') titleInput.blur();
  if (e.key === 'Escape') {
    titleInput.value = ed.meta?.title || '';
    titleInput.blur();
  }
});

$('#back').addEventListener('click', goLibrary);
$('#download-original').addEventListener('click', () => ed.meta && downloadOriginal(ed.meta, ed.blob));
$('#delete').addEventListener('click', async () => {
  if (!ed.meta || !confirm(t('stConfirmDelete', [ed.meta.title]))) return;
  try {
    if (exporting) exporting.ctrl.abort();
    await deleteVideo(ed.id);
    toast(t('stDeleted'));
    location.hash = '';
  } catch (err) {
    console.debug('[Grabazo] eliminar', err);
    toast(t('stDeleteFailed'), true);
  }
});

// ---------------------------------------------------------------- exportar

const PREFS_KEY = 'grabazo.estudio';
const prefs = (() => {
  const base = { format: 'mp4', quality: 'high', gifWidth: '640', gifFps: '15' };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return base; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} };

function setSeg(seg, value) {
  for (const b of seg.querySelectorAll('button[data-v]')) b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
}

function bindSeg(seg, key) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || exporting) return;
    prefs[key] = b.dataset.v;
    savePrefs();
    renderExportUi();
  });
}
bindSeg($('#fmt'), 'format');
bindSeg($('#quality'), 'quality');
bindSeg($('#gif-width'), 'gifWidth');
bindSeg($('#gif-fps'), 'gifFps');

const instant = (format) => format !== 'gif' && !edited() && canCopy(ed.info, format);

function renderExportUi() {
  const format = prefs.format;
  setSeg($('#fmt'), format);
  setSeg($('#quality'), prefs.quality);
  setSeg($('#gif-width'), prefs.gifWidth);
  setSeg($('#gif-fps'), prefs.gifFps);
  const gif = format === 'gif';
  $('#gif-opts').hidden = !gif;
  $('#video-opts').hidden = gif || instant(format);
  const total = totalOf(kept());
  const warn = $('#gif-warn');
  warn.hidden = !gif || total <= 30;
  if (!warn.hidden) warn.textContent = t('stGifLong', [span(total)]);
  $('#export-hint').textContent = gif ? t('stHintGif') : t(instant(format) ? 'stHintInstant' : 'stHintEncode');
  $('#export').disabled = !!exporting || !ed.blob || !ed.duration;
}

let exporting = null;

function setProgress(p) {
  const value = Math.round(clamp(p, 0, 1) * 100);
  $('#bar').style.width = `${value}%`;
  $('#progress-text').textContent = t('stExporting', [String(value)]);
}

async function doExport() {
  if (exporting || !ed.blob || !ed.duration) return;
  const ranges = kept();
  if (!ranges.length) return toast(t('stNothingLeft'), true);
  const token = ed.token;
  const format = prefs.format;
  const ctrl = new AbortController();
  const job = { ctrl };
  exporting = job;
  const card = $('#export-card');
  card.classList.add('busy');
  $('#export').hidden = true;
  $('#progress').hidden = false;
  $('#bar').style.width = '0%';
  $('#progress-text').textContent = t('stPreparing');
  renderExportUi();

  const title = ed.meta.title;
  const original = ed.blob;
  const wasEdited = edited();
  const started = performance.now();
  const onProgress = (p) => { if (exporting === job) setProgress(p); };
  try {
    let blob;
    let copied = false;
    let fellBack = false;
    if (format === 'gif') {
      blob = await exportGif(original, { ranges, width: Number(prefs.gifWidth), fps: Number(prefs.gifFps), onProgress, signal: ctrl.signal });
    } else if (instant(format)) {
      copied = true;
      try {
        blob = await remux(original, format, { mute: ed.edit.mute, onProgress, signal: ctrl.signal });
      } catch (err) {
        if (isAbort(err)) throw err;
        console.debug('[Grabazo] copia sin recodificar', err);
        blob = original;
        fellBack = true;
      }
    } else {
      try {
        blob = await exportVideo(original, { format, quality: prefs.quality, ranges, mute: ed.edit.mute, onProgress, signal: ctrl.signal });
      } catch (err) {
        // Sin cambios que aplicar, el original sirve igual.
        if (isAbort(err) || wasEdited || ed.edit.mute) throw err;
        console.debug('[Grabazo] exportar (se descarga el original)', err);
        blob = original;
        fellBack = true;
      }
    }
    const ext = fellBack ? extOf(original.type || ed.meta?.mime) : format;
    const name = `${safeName(title)}.${ext}`;
    const filename = `Grabazo/${name}`;
    // Para la prueba automática (test/estudio.mjs). El archivo solo se conserva si la
    // prueba lo pide: así no queda ocupando memoria después de descargarlo.
    window.__lastExport = { size: blob.size, type: blob.type, filename, format, copied, fellBack, ms: Math.round(performance.now() - started), kept: totalOf(ranges), ...(window.__estudioTest ? { blob } : {}) };
    setProgress(1);
    await download(blob, filename);
    toast(t(fellBack ? 'stExportedOriginal' : 'stExported', [name]));
  } catch (err) {
    if (isAbort(err)) toast(t('stExportCanceled'));
    else {
      console.debug('[Grabazo] exportar', err);
      toast(t('stExportFailed'), true);
    }
    window.__lastExport = { error: isAbort(err) ? 'canceled' : String(err?.message || err), format };
  } finally {
    if (exporting === job) exporting = null;
    card.classList.remove('busy');
    $('#export').hidden = false;
    $('#progress').hidden = true;
    if (token === ed.token) renderExportUi();
  }
}

$('#export').addEventListener('click', doExport);
$('#cancel').addEventListener('click', () => exporting?.ctrl.abort());

window.addEventListener('beforeunload', (e) => {
  flushSave();
  if (!exporting) return;
  e.preventDefault();
  e.returnValue = '';
});

// ---------------------------------------------------------------- teclado

document.addEventListener('keydown', (e) => {
  if (view !== 'editor' || !ed.duration) return;
  const target = e.target;
  if (target.closest?.('input:not([type=checkbox]), textarea, select, [contenteditable="true"]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;

  if (mod && key.toLowerCase() === 'z') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && key.toLowerCase() === 'y') {
    e.preventDefault();
    return redo();
  }
  if (mod || e.altKey) return;

  // Asas de recorte con el foco: las flechas las mueven.
  const handle = target.closest?.('.handle');
  if (handle && (key === 'ArrowLeft' || key === 'ArrowRight')) {
    e.preventDefault();
    const delta = (key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
    const which = handle.dataset.which;
    change(() => setTrim(which, (which === 'start' ? ed.edit.trimStart : ed.edit.trimEnd) + delta));
    seek(which === 'start' ? ed.edit.trimStart : ed.edit.trimEnd);
    return;
  }

  switch (key) {
    case ' ':
      // También con el foco en un botón: Espacio siempre reproduce o pausa.
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      seek(now() + (key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 5));
      break;
    case 'Home':
      e.preventDefault();
      seek(ed.edit.trimStart);
      break;
    case 'End':
      e.preventDefault();
      seek(ed.edit.trimEnd);
      break;
    case 'i':
    case 'I':
      markIn();
      break;
    case 'o':
    case 'O':
      markOut();
      break;
    case 'x':
    case 'X':
      cutSelection();
      break;
    case 'm':
    case 'M':
      toggleMute();
      break;
    case '[':
      trimHere('start');
      break;
    case ']':
      trimHere('end');
      break;
    case 'Delete':
    case 'Backspace':
      if (ed.picked >= 0) {
        e.preventDefault();
        removeCut(ed.picked);
      }
      break;
    case 'Escape':
      ed.sel = null;
      ed.picked = -1;
      render();
      break;
    default:
  }
});

// ---------------------------------------------------------------- ganchos de prueba

// Solo lectura y ayudas mínimas para test/estudio.mjs (no cambian el comportamiento).
window.__estudio = {
  get state() {
    return { view, id: ed.id, duration: ed.duration, edit: structuredClone(ed.edit), kept: kept(), sel: ed.sel, picked: ed.picked, info: ed.info, time: now(), exporting: !!exporting };
  },
  seek: (s) => seek(s),
};

route();
