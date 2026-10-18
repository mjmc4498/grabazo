// Grabazo — configuración compartida por el service worker, el documento offscreen, el
// grabador, el popup, el estudio, la burbuja de la cámara y los ajustes.

// Página que se abre en el celular (carpeta /remote publicada en GitHub Pages): control
// remoto, guion (teleprompter) y cámara. Si la publicas en otra dirección, cámbiala aquí
// o en Ajustes › Avanzado.
export const REMOTE_URL = 'https://mjmc4498.github.io/grabazo/';

// Prefijo de los identificadores de sesión en el servidor de señalización PeerJS.
export const ID_PREFIX = 'grabazo-';

// Worker de Cloudflare que entrega credenciales temporales del servidor de
// retransmisión (TURN) para redes que bloquean la conexión directa. Grabazo comparte el
// Worker de Presentazo; la carpeta /cloudflare tiene una copia por si prefieres uno propio.
// Vacío = solo conexión directa.
export const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';

// Servidores públicos para la conexión directa cuando el Worker no responde.
export const FALLBACK_ICE = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
};

// Acceso a los sitios: permiso opcional. Con él, la barra, la cámara y los dibujos siguen
// en pantalla al cambiar de página o de pestaña mientras grabas.
export const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] };

// Qué se graba.
export const MODES = ['tab', 'area', 'window', 'screen', 'camera'];

// Herramientas de dibujo y anotación.
export const TOOLS = ['pen', 'highlighter', 'arrow', 'rect', 'ellipse', 'text', 'eraser'];
export const COLORS = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#0A84FF', '#BF5AF2', '#FFFFFF', '#1C1C1E'];
export const WIDTHS = [3, 6, 11];

// Calidad de la grabación: tamaño máximo y bits por segundo del video.
export const QUALITIES = {
  720: { w: 1280, h: 720, bitrate: 5_000_000 },
  1080: { w: 1920, h: 1080, bitrate: 8_000_000 },
  1440: { w: 2560, h: 1440, bitrate: 14_000_000 },
  2160: { w: 3840, h: 2160, bitrate: 25_000_000 },
};
export const COUNTDOWNS = [0, 3, 5, 10];
export const LIMITS = [0, 1, 3, 5, 10, 15, 30, 60]; // minutos (0 = sin límite)

// Burbuja de la cámara (diámetro o ancho en px).
export const CAM_SIZES = { s: 150, m: 210, l: 290, xl: 400 };
export const CAM_EFFECTS = ['none', 'blur', 'blur-strong', 'bg-grabazo', 'bg-atardecer', 'bg-oceano', 'bg-bosque', 'bg-grafito', 'bg-estudio'];
export const CAM_FILTERS = ['none', 'bw', 'warm', 'cool', 'vivid', 'retro'];

// La cámara o el micrófono del celular se eligen con este identificador.
export const PHONE = 'phone';

export const DEFAULT_SETTINGS = {
  remoteUrl: '',
  mode: 'tab',
  // Audio
  mic: true,
  micId: '',
  systemAudio: true,
  pushToTalk: false,
  pttKey: 'Backquote',
  noiseSuppression: true,
  // Cámara
  camera: true,
  camId: '',
  camShape: 'circle',
  camSize: 'm',
  camMirror: true,
  camEffect: 'none',
  camFilter: 'none',
  // Grabación
  countdown: 3,
  timeLimit: 0,
  quality: '1080',
  fps: 30,
  format: 'auto',
  openStudio: true,
  // Cursor y pantalla
  clickHighlight: true,
  spotlightSize: 'm',
  hideIdleCursor: true,
  zoomLevel: 2,
  zoomOnClick: false,
  // Barra y dibujo
  toolbarAutoHide: false,
  drawFade: false,
};

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return normalizeSettings(settings);
}

export async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await chrome.storage.sync.set({ settings: next });
  return next;
}

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.mode = pick(s.mode, MODES, 'tab');
  s.camShape = pick(s.camShape, ['circle', 'rect'], 'circle');
  s.camSize = pick(s.camSize, Object.keys(CAM_SIZES), 'm');
  s.camEffect = pick(s.camEffect, CAM_EFFECTS, 'none');
  s.camFilter = pick(s.camFilter, CAM_FILTERS, 'none');
  s.countdown = pick(Number(s.countdown), COUNTDOWNS, 3);
  s.timeLimit = pick(Number(s.timeLimit), LIMITS, 0);
  s.quality = pick(String(s.quality), Object.keys(QUALITIES), '1080');
  s.fps = pick(Number(s.fps), [24, 30, 60], 30);
  s.format = pick(s.format, ['auto', 'webm'], 'auto');
  s.spotlightSize = pick(s.spotlightSize, ['s', 'm', 'l'], 'm');
  s.zoomLevel = pick(Number(s.zoomLevel), [1.5, 2, 2.5, 3], 2);
  s.pttKey = typeof s.pttKey === 'string' && /^[A-Za-z0-9]{1,24}$/.test(s.pttKey) ? s.pttKey : 'Backquote';
  for (const k of ['micId', 'camId']) s[k] = typeof s[k] === 'string' ? s[k].slice(0, 200) : '';
  return s;
}

// Estado de las herramientas durante la sesión (dibujo, efectos, cámara, micrófono).
export function initialUi(settings = DEFAULT_SETTINGS) {
  return {
    tool: null,
    color: COLORS[0],
    width: WIDTHS[1],
    spotlight: false,
    zoom: false,
    clicks: settings.clickHighlight,
    blur: false,
    toolbar: true,
    camera: settings.camera,
    mic: settings.mic,
    talking: false,
  };
}

// Tiempo grabado (ms) según el estado de la grabación. `now` permite corregir el reloj
// del celular.
export function elapsedOf(rec, now = Date.now()) {
  if (!rec) return 0;
  const base = Number(rec.elapsed) || 0;
  return rec.status === 'recording' && rec.resumedAt ? base + Math.max(0, now - rec.resumedAt) : base;
}

// «125000» → «2:05» (con horas si hace falta).
export function clock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function buildRemoteUrl(base, peerId, token) {
  const url = new URL(base || REMOTE_URL);
  url.hash = new URLSearchParams({ id: peerId, k: token }).toString();
  return url.toString();
}

// Patrón de permiso de un sitio («https://docs.google.com/*»), o null si Chrome no
// permite extensiones ahí.
export function originPattern(url = '') {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export const hasAllSites = () => chrome.permissions.contains(ALL_SITES);

export async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => /^https?:\/\//.test(o));
}

// Chrome solo muestra su diálogo si se llama directamente desde un clic del usuario.
export const requestOrigins = (origins) => chrome.permissions.request({ origins }).catch(() => false);
export const removeOrigins = (origins) => chrome.permissions.remove({ origins }).catch(() => false);
