// Prueba de punta a punta de Grabazo: la extensión real, una página de ejemplo con la
// capa encima (barra, burbuja, dibujo y efectos) y un «celular» (la página real del
// celular en otro contexto del navegador) conectado por PeerJS como control remoto,
// teleprompter y cámara. Graba de verdad (cámara y micrófono simulados por Chrome) y
// revisa que los videos queden guardados y que se abra el estudio. Requiere un servidor
// local:
//   npm run serve        (otra terminal)
//   npm run test:e2e
//
// Son dos sesiones de Chrome:
// · Normal: permisos, celular, guion, burbuja de la cámara, cámara del celular y
//   grabación de «solo cámara» con fondo desenfocado.
// · Autorizada: sin ventana no se puede pulsar el ícono de la extensión (activeTab, que
//   Chrome exige para grabar una pestaña), así que la copia de prueba lleva una clave fija
//   y se lanza con --allowlisted-extension-id. Chrome trata entonces a la extensión como
//   «de sistema» y no le da cámara ni micrófono normales: esta sesión prueba la pestaña,
//   el área, la barra, el dibujo, los efectos y el control remoto.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8769';
const DEMO_URL = 'https://demo.example.com/ventas';
const DEMO_HTML = fs.readFileSync(path.join(ROOT, 'design', 'demo', 'tutorial.html'), 'utf8');
const HOST = 'grabazo-capa';
const IPHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}
const errors = [];
const watch = (page, label) => {
  // pageerror incluye las promesas rechazadas sin atender («Uncaught (in promise)»).
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_|net::|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
};

// ---------------------------------------------------------------- sesión de Chrome

// La extensión de prueba y el perfil van a la carpeta temporal del sistema: si el
// proyecto está en un Escritorio sincronizado con iCloud, ahí aparecen copias de
// conflicto («_locales 2») que Chrome no acepta. El acceso a la página de ejemplo se
// concede desde el manifiesto (el diálogo de Chrome no se puede pulsar sin ventana).
async function open({ allowlisted, noGrant = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grabazo-e2e-'));
  const dir = path.join(tmp, 'extension');
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['https://demo.example.com/*'];
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  manifest.key = der.toString('base64');
  const id = [...crypto.createHash('sha256').update(der).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Cámara y micrófono simulados. No se usa --use-fake-ui-for-media-stream: rompe la
  // captura de pestañas; los permisos se conceden por CDP.
  const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    userDataDir: path.join(tmp, 'perfil'),
    enableExtensions: [dir],
    args: ['--window-size=1400,900', '--hide-scrollbars', '--use-fake-device-for-media-stream', ...(allowlisted ? [`--allowlisted-extension-id=${id}`] : [])],
    defaultViewport: null,
  });
  browser.on('targetcreated', async (target) => {
    if (target.type() !== 'page') return;
    const p = await target.page().catch(() => null);
    if (p) watch(p, (target.url().split('/').pop() || 'página').slice(0, 40));
  });
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const cdp = await browser.target().createCDPSession();
  const grant = (origin, browserContextId) => Promise.all(['camera', 'microphone'].map((name) =>
    cdp.send('Browser.setPermission', { permission: { name }, setting: 'granted', origin, ...(browserContextId ? { browserContextId } : {}) })));
  // Cámara y micrófono permitidos (como si el usuario los hubiera aceptado en la bienvenida).
  if (!noGrant) await grant(`chrome-extension://${extId}`);

  const welcome = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 8000 });
  // Los permisos rigen para las páginas que se abren después: se abre otra vez.
  await welcome?.close();
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const sw = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = () => sw({ type: 'state:get' });
  const setSettings = (patch) => ext.evaluate(async (p) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), ...p } });
  }, patch);
  await setSettings({ remoteUrl: `${BASE}/remote/` });

  async function connectPhone() {
    await ext.click('#link-start');
    const ready = await waitFor(async () => (await state()).link.status === 'ready', { timeout: 25000 });
    const info = await sw({ type: 'link:info' });
    const phoneCtx = await browser.createBrowserContext();
    await grant(new URL(BASE).origin, phoneCtx.id);
    const phone = await phoneCtx.newPage();
    phone.on('dialog', (d) => d.accept());
    watch(phone, 'celular');
    await phone.setUserAgent({ userAgent: IPHONE_UA });
    await phone.setViewport(IPHONE);
    await phone.goto(`${BASE}/remote/#id=${info.identity.peerId}&k=${info.identity.token}`);
    const connected = await waitFor(() => phone.$eval('#app', (a) => a.dataset.conn === 'connected' && a.classList.contains('ready')), { timeout: 30000 });
    return { phone, ready, connected };
  }

  async function openDemo() {
    const demo = await browser.newPage();
    watch(demo, 'demo');
    await demo.setRequestInterception(true);
    demo.on('request', (req) => {
      if (req.url().startsWith('https://demo.example.com/')) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: DEMO_HTML });
      else req.continue();
    });
    await demo.setViewport({ width: 1280, height: 760 });
    await demo.goto(DEMO_URL);
    await demo.bringToFront();
    const tabId = await ext.evaluate(async () => (await chrome.tabs.query({ url: 'https://demo.example.com/*' }))[0]?.id);
    return { demo, tabId };
  }

  async function savedVideo(vid) {
    return ext.evaluate(async (v) => {
      const db = await import('./lib/db.js');
      const rec = await db.getVideo(v);
      return rec ? { duration: rec.meta.duration, size: rec.blob?.size || 0, width: rec.meta.width, height: rec.meta.height, mime: rec.meta.mime, thumb: !!rec.meta.thumb } : null;
    }, vid);
  }

  const close = async () => {
    await browser.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  const grantExtension = () => grant(`chrome-extension://${extId}`);
  return { browser, extId, expectedId: id, ext, sw, state, setSettings, connectPhone, openDemo, savedVideo, grantExtension, close };
}

const bubbleLive = (demo) => waitFor(async () => {
  const frame = demo.frames().find((f) => f.url().includes('/camara.html'));
  return frame && frame.$eval('body', (b) => b.classList.contains('live'));
}, { timeout: 15000 });

// ================================================================ sesión normal

let s = null;
try {
  s = await open({ allowlisted: false });
  const { ext, state, setSettings } = s;
  check('la extensión carga y su service worker arranca', s.extId === s.expectedId, s.extId);
  check('la bienvenida muestra los atajos', await waitFor(() => ext.$$eval('#shortcuts li', (l) => l.length >= 4)));
  const perms = await ext.evaluate(async () => {
    const st = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    st.getTracks().forEach((tr) => tr.stop());
    return (await navigator.permissions.query({ name: 'camera' })).state;
  });
  check('la cámara y el micrófono se permiten para la extensión', perms === 'granted', perms);
  check('la bienvenida muestra el estado de los permisos', await waitFor(() => ext.$eval('#perm-cam', (e) => e.dataset.state === 'granted')));

  // ---------- celular
  const { phone, ready, connected } = await s.connectPhone();
  check('el enlace con el celular abre su sesión PeerJS', !!ready);
  check('el celular se conecta y muestra el control remoto', !!connected);
  check('la clave desaparece de la barra de direcciones del celular', !phone.url().includes('k='));
  check('la computadora ve al celular conectado', await waitFor(async () => (await state()).link.phones.length === 1));

  // ---------- guion
  await ext.$eval('#script', (el) => { el.value = 'Hola, este es mi guion de prueba.\n\nSegunda parte del guion.'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  check('el guion escrito en los ajustes llega al teleprompter del celular', await waitFor(() => phone.$eval('#prompter-text', (e) => e.textContent.includes('guion de prueba')), { timeout: 8000 }));
  await phone.click('.tabs [data-view="script"]');
  await phone.click('#p-more');
  await phone.click('#p-edit');
  await phone.$eval('#p-input', (el) => { el.value = 'Guion editado desde el celular.'; });
  await phone.$eval('#p-editor-form', (f) => f.requestSubmit(f.querySelector('[value="save"]')));
  check('el guion editado en el celular llega a la computadora', await waitFor(async () => (await s.sw({ type: 'script:get' })).text === 'Guion editado desde el celular.', { timeout: 8000 }));

  // ---------- burbuja de la cámara con el popup abierto
  const { demo, tabId } = await s.openDemo();
  await ext.evaluate((id) => {
    globalThis.__popupPort = chrome.runtime.connect({ name: 'grabazo-popup' });
    globalThis.__popupPort.postMessage({ t: 'prepare', tabId: id });
  }, tabId);
  check('con el popup abierto aparece la burbuja de la cámara en la página', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'prepare' && h.dataset.bubble === 'true'), { timeout: 8000 }));
  check('la burbuja recibe la imagen de la cámara de la computadora', await bubbleLive(demo));
  await setSettings({ camEffect: 'bg-grabazo', camFilter: 'vivid' });
  await sleep(2500);
  check('la burbuja sigue con imagen al activar un fondo virtual', await bubbleLive(demo), await (async () => {
    const frame = demo.frames().find((f) => f.url().includes('/camara.html'));
    return frame ? frame.$eval('body', (b) => `${b.className} · ${b.querySelector('#msg').textContent}`).catch((e) => e.message) : 'sin iframe';
  })());
  await setSettings({ camEffect: 'none', camFilter: 'none' });

  // ---------- cámara del celular como burbuja
  await phone.click('.tabs [data-view="camera"]');
  await phone.click('#cam-start');
  check('el celular envía su cámara a la computadora', await waitFor(async () => (await state()).link.camLive === true, { timeout: 15000 }));
  await phone.click('#use-cam');
  check('la computadora pasa a usar la cámara del celular', await waitFor(async () => (await state()).settings.camId === 'phone', { timeout: 5000 }));
  await sleep(1500);
  check('la burbuja muestra la cámara del celular', await bubbleLive(demo));
  await phone.click('#use-cam');
  check('y vuelve a la cámara de la computadora', await waitFor(async () => (await state()).settings.camId !== 'phone', { timeout: 5000 }));
  await phone.click('#cam-stop');
  await ext.evaluate(() => globalThis.__popupPort.disconnect());
  check('al cerrar el popup sin grabar, la burbuja se va', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'none').catch(() => true), { timeout: 5000 }));

  // ---------- solo cámara, con fondo desenfocado, desde el celular
  await setSettings({ mode: 'camera', countdown: 3, camId: '', camEffect: 'blur', camFilter: 'warm', timeLimit: 0 });
  await phone.click('.tabs [data-view="control"]');
  await phone.click('#rec');
  check('el celular inicia una grabación de solo cámara', await waitFor(async () => ['countdown', 'recording'].includes((await state()).rec.status), { timeout: 20000 }), (await state()).rec.status);
  check('la cuenta regresiva se ve en el celular', await waitFor(() => phone.$eval('#countdown', (e) => !e.hidden), { timeout: 5000 }));
  check('empieza a grabar al terminar la cuenta regresiva', await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 15000 }));
  const recStart = Date.now();
  check('el teleprompter arranca solo al grabar', await waitFor(() => phone.$eval('#p-play', (b) => b.getAttribute('aria-pressed') === 'true'), { timeout: 4000 }));
  check('el celular muestra el tiempo de grabación', await waitFor(() => phone.$eval('#app', (a) => a.dataset.rec === 'recording')));
  await sleep(2500);
  await phone.click('#pause');
  check('pausa desde el celular', await waitFor(async () => (await state()).rec.status === 'paused', { timeout: 3000 }));
  const pauseStart = Date.now();
  await sleep(1500);
  await phone.click('#pause');
  const paused = Date.now() - pauseStart;
  check('reanudar desde el celular', await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 3000 }));
  await sleep(2500);
  await phone.click('#rec');
  const wall = Date.now() - recStart;
  check('detener desde el celular guarda la grabación', await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 20000 }));
  const camVid = (await state()).rec.lastId;
  check('al terminar se abre el estudio con la grabación', await waitFor(async () => (await s.browser.pages()).find((p) => p.url().includes(`estudio.html#${camVid}`)), { timeout: 8000 }));
  const cam = await s.savedVideo(camVid);
  check('el video de cámara quedó guardado (con miniatura)', cam && cam.size > 20_000 && cam.duration > 4000 && cam.thumb, JSON.stringify(cam));
  check('la duración no cuenta la pausa', cam && cam.duration < wall - paused + 600 && cam.duration > wall - paused - 2500, `${cam?.duration} ms de ${wall} ms con ${paused} ms en pausa`);

  // ---------- desconectar el celular
  await s.sw({ type: 'link:stop' });
  check('al desconectar, el celular deja de mostrar el control', await waitFor(() => phone.$eval('#app', (a) => !a.classList.contains('ready') || a.dataset.conn !== 'connected'), { timeout: 8000 }));
} catch (err) {
  check('la sesión normal terminó sin excepciones', false, err.stack || String(err));
} finally {
  await s?.close();
}

// ================================================================ sesión autorizada (pestaña y área)

s = null;
try {
  s = await open({ allowlisted: true });
  const { ext, state, setSettings } = s;
  // El micrófono del celular: su conexión local no debe reemplazar la imagen de la pestaña.
  await setSettings({ camera: false, mic: true, micId: 'phone', countdown: 3, pushToTalk: true, mode: 'tab' });
  const { phone, connected } = await s.connectPhone();
  check('[pestaña] el celular se conecta', !!connected);
  const { demo, tabId } = await s.openDemo();

  // ---------- grabar la pestaña desde el celular
  // Como si el popup se hubiera abierto en esta pestaña (es la que se graba).
  await ext.evaluate((id) => chrome.storage.session.set({ prepTab: id }), tabId);
  await demo.bringToFront();
  await phone.click('#rec');
  check('el celular inicia la grabación de la pestaña', await waitFor(async () => ['countdown', 'recording'].includes((await state()).rec.status), { timeout: 20000 }), `${(await state()).rec.status} ${(await state()).rec.error || ''}`);
  check('la cuenta regresiva se ve sobre la página', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.countdown === 'true'), { timeout: 5000 }));
  check('empieza a grabar la pestaña', await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 15000 }));
  check('la barra de grabación aparece sobre la página', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'live' && h.dataset.toolbar === 'true'), { timeout: 6000 }));
  check('la pestaña del grabador queda fijada mientras se graba', await waitFor(async () => {
    const tabs = await ext.evaluate(() => chrome.tabs.query({ pinned: true }));
    return tabs.some((t) => (t.url || t.pendingUrl || '').includes('grabador.html'));
  }));

  // ---------- herramientas desde el celular
  await phone.click('#tools [data-tool="pen"]');
  check('el celular elige el lápiz y la página entra en modo dibujo', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.tool === 'pen'), { timeout: 5000 }));
  await demo.mouse.move(300, 300);
  await demo.mouse.down();
  for (let i = 0; i < 12; i++) await demo.mouse.move(300 + i * 20, 300 + Math.sin(i / 2) * 30);
  await demo.mouse.up();
  check('se puede dibujar sobre la página', await waitFor(() => demo.$eval(HOST, (h) => Number(h.dataset.shapes) >= 1), { timeout: 3000 }));
  await phone.click('#tools [data-tool="arrow"]');
  await waitFor(() => demo.$eval(HOST, (h) => h.dataset.tool === 'arrow'), { timeout: 3000 });
  await demo.mouse.move(700, 200);
  await demo.mouse.down();
  await demo.mouse.move(820, 320, { steps: 6 });
  await demo.mouse.up();
  check('se puede dibujar una flecha', await waitFor(() => demo.$eval(HOST, (h) => Number(h.dataset.shapes) >= 2), { timeout: 3000 }));
  await phone.click('#undo');
  check('deshacer desde el celular', await waitFor(() => demo.$eval(HOST, (h) => Number(h.dataset.shapes) === 1), { timeout: 3000 }));
  await phone.click('#clear');
  check('borrar todo desde el celular', await waitFor(() => demo.$eval(HOST, (h) => Number(h.dataset.shapes) === 0), { timeout: 3000 }));
  await phone.click('#tools [data-tool="none"]');
  check('el celular vuelve al mouse', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.tool === ''), { timeout: 3000 }));
  await phone.click('#toggles [data-key="spotlight"]');
  check('el celular enciende el foco de luz', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.spotlight === 'true'), { timeout: 3000 }));
  await phone.click('#toggles [data-key="spotlight"]');
  await phone.click('#toggles [data-key="zoom"]');
  check('el celular activa el zoom', await waitFor(async () => (await state()).ui.zoom === true, { timeout: 3000 }));
  await demo.mouse.move(900, 500, { steps: 5 });
  await sleep(800);
  await phone.click('#toggles [data-key="zoom"]');
  await phone.click('#toggles [data-key="blur"]');
  check('el celular activa el modo difuminar', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.blur === 'true'), { timeout: 3000 }));
  await demo.mouse.click(640, 120);
  check('un clic difumina el elemento de la página', await waitFor(() => demo.evaluate(() => document.querySelectorAll('[data-grabazo-difuminar]').length > 0), { timeout: 3000 }));
  await phone.click('#toggles [data-key="unblur"]');
  check('quitar el difuminado desde el celular', await waitFor(() => demo.evaluate(() => document.querySelectorAll('[data-grabazo-difuminar]').length === 0), { timeout: 3000 }));
  await phone.click('#toggles [data-key="blur"]');

  // Pulsar para hablar
  check('con pulsar para hablar, el celular muestra el botón «Hablar»', await phone.$eval('#talk', (e) => !e.hidden));
  const talkBox = await (await phone.$('#talk')).boundingBox();
  await phone.mouse.move(talkBox.x + talkBox.width / 2, talkBox.y + talkBox.height / 2);
  await phone.mouse.down();
  check('mantener «Hablar» abre el micrófono', await waitFor(async () => (await state()).ui.talking === true, { timeout: 3000 }));
  await phone.mouse.up();
  check('soltar «Hablar» lo cierra', await waitFor(async () => (await state()).ui.talking === false, { timeout: 3000 }));

  // Ocultar y mostrar la barra
  await phone.click('#toggles [data-key="toolbar"]');
  check('ocultar la barra desde el celular', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.toolbar === 'false'), { timeout: 3000 }));
  await phone.click('#toggles [data-key="toolbar"]');
  check('mostrarla otra vez', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.toolbar === 'true'), { timeout: 3000 }));

  await phone.click('#pause');
  check('pausar la pestaña desde el celular', await waitFor(async () => (await state()).rec.status === 'paused', { timeout: 3000 }));
  await phone.click('#pause');
  await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 3000 });

  await sleep(1500);
  await phone.click('#rec');
  check('detener la pestaña guarda la grabación', await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 20000 }));
  const tabVid = (await state()).rec.lastId;
  check('se abre el estudio con la grabación de la pestaña', await waitFor(async () => (await s.browser.pages()).find((p) => p.url().includes(`estudio.html#${tabVid}`)), { timeout: 8000 }));
  const tv = await s.savedVideo(tabVid);
  check('el video de la pestaña quedó guardado (con imagen)', tv && tv.size > 150_000 && tv.duration > 3000 && tv.width >= 600, JSON.stringify(tv));
  check('la capa desaparece de la página al terminar', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'none').catch(() => true), { timeout: 5000 }));
  check('el celular vuelve a «Lista para grabar»', await waitFor(() => phone.$eval('#app', (a) => a.dataset.rec === 'idle')));

  // ---------- área personalizada, reiniciar y descartar
  await setSettings({ mode: 'area', countdown: 0, pushToTalk: false, mic: false });
  await demo.bringToFront();
  await s.sw({ type: 'op', op: 'rec:start', mode: 'area', tabId });
  check('el modo área muestra el selector sobre la página', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'area' && h.dataset.area === 'true'), { timeout: 8000 }));
  await demo.keyboard.press('Enter');
  check('al confirmar el área empieza a grabar', await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 15000 }), `${(await state()).rec.status} ${(await state()).rec.error || ''}`);
  check('el área elegida queda marcada mientras se graba', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.area === 'true' && h.dataset.role === 'live'), { timeout: 4000 }));
  const area = (await state()).rec.area;
  check('el área guarda su tamaño en la página', area && area.w > 100 && area.h > 100, JSON.stringify(area));
  await sleep(1500);
  await phone.click('#restart');
  check('reiniciar desde el celular vuelve a empezar', await waitFor(async () => { const st = await state(); return st.rec.status === 'recording' && st.rec.elapsed === 0; }, { timeout: 8000 }));
  await sleep(1200);
  await phone.click('#rec');
  check('detener el área guarda el video recortado', await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 20000 }));
  const av = await s.savedVideo((await state()).rec.lastId);
  check('el video del área tiene la proporción del área elegida', av && area && Math.abs(av.width / av.height - area.w / area.h) < 0.05, JSON.stringify(av));

  await s.sw({ type: 'op', op: 'rec:start', mode: 'area', tabId });
  await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'area'), { timeout: 8000 });
  await demo.keyboard.press('Enter');
  await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 15000 });
  await waitFor(() => phone.$eval('#discard', (b) => !b.hidden), { timeout: 5000 });
  await phone.click('#discard');
  check('descartar desde el celular cierra todo sin guardar', await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 8000 }));
  check('la pestaña del grabador se cierra al descartar', await waitFor(async () => !(await s.browser.pages()).some((pg) => pg.url().includes('grabador.html')), { timeout: 5000 }));
} catch (err) {
  check('la sesión autorizada terminó sin excepciones', false, err.stack || String(err));
} finally {
  await s?.close();
}

// ================================================================ flujo real: clic en el ícono

// Chrome permite simular el clic en el ícono por CDP (Extensions.triggerAction): abre el
// popup real y da activeTab, como un usuario. Se graba la pestaña con la burbuja de la
// cámara, primero sin permiso de cámara (debe pedirlo con claridad) y luego con permiso
// (debe encenderse sola, sin recargar).
s = null;
try {
  s = await open({ allowlisted: false, noGrant: true });
  const { browser, ext, state } = s;
  const { demo } = await s.openDemo();
  const cdp = await browser.target().createCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tab = targetInfos.find((t) => t.url.startsWith('https://demo.example.com/'));
  await cdp.send('Extensions.triggerAction', { id: s.extId, targetId: tab.targetId });
  const popupTarget = await browser.waitForTarget((t) => t.url().includes('popup.html'), { timeout: 8000 }).catch(() => null);
  const popup = popupTarget ? await popupTarget.asPage() : null;
  check('[clic] el ícono abre el popup sobre la página', !!popup);
  await waitFor(() => popup.$eval('#modes [data-mode="area"]', (b) => !b.disabled), { timeout: 5000 });
  check('[clic] sin permiso, el popup avisa y ofrece la cámara de la computadora', await popup.$eval('#perm-banner', (e) => !e.hidden) && await popup.$eval('#cam-select', (sel) => sel.selectedOptions[0]?.value === ''));
  check('[clic] con el popup abierto aparece la burbuja en la página', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'prepare' && h.dataset.bubble === 'true'), { timeout: 8000 }));
  await popup.click('#record');
  // Al cerrarse el popup, la página vuelve al frente (sin ventana, Chrome no lo hace solo).
  await demo.bringToFront();
  check('[clic] «Grabar» graba la pestaña', await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 20000 }), `${(await state()).rec.status} ${(await state()).rec.error || ''}`);
  check('[clic] la burbuja sigue en la página mientras se graba', await waitFor(() => demo.$eval(HOST, (h) => h.dataset.role === 'live' && h.dataset.bubble === 'true' && h.dataset.toolbar === 'true'), { timeout: 6000 }));
  const bubbleText = () => {
    const frame = demo.frames().find((f) => f.url().includes('/camara.html'));
    return frame ? frame.$eval('body', (b) => `${b.classList.contains('live') ? 'live' : ''}|${b.querySelector('#msg').textContent}`) : null;
  };
  check('[clic] sin permiso, la burbuja pide «Permitir» (no queda vacía)', await waitFor(async () => /Permit/.test((await bubbleText()) || ''), { timeout: 8000 }), await bubbleText());
  await s.grantExtension();
  check('[clic] al dar el permiso, la cámara aparece sola en la burbuja', await waitFor(async () => (await bubbleText())?.startsWith('live'), { timeout: 12000 }), await bubbleText());
  await sleep(5000);
  await s.sw({ type: 'op', op: 'rec:stop' });
  check('[clic] detener guarda la grabación', await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 20000 }));
  const vid = await s.savedVideo((await state()).rec.lastId);
  check('[clic] el video de la pestaña dura lo grabado y tiene imagen', vid && vid.size > 100_000 && vid.duration > 4000, JSON.stringify(vid));
} catch (err) {
  check('[clic] el flujo real terminó sin excepciones', false, err.stack || String(err));
} finally {
  await s?.close();
}

// En la sesión autorizada Chrome niega la cámara y el micrófono a propósito (ver arriba).
// El Worker de retransmisión no acepta el origen local de prueba: el celular usa la
// conexión directa (en GitHub Pages sí está permitido).
const real = errors.filter((e) => !/peer-unavailable|Could not connect|WebSocket|Permission denied|NotAllowedError|mando-turn/.test(e));
check('sin errores en las páginas (ni «Stream closed» en el grabador)', real.length === 0, real.slice(0, 5).join(' | '));
if (process.env.ERRORES) console.log(errors.join('\n'));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
fs.mkdirSync(path.join(ROOT, 'test', 'out'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'test', 'out', 'e2e.log'), results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`).join('\n') + '\n');
process.exit(failed.length ? 1 : 0);
