// Capturas reales de Grabazo para la ficha de la tienda y la presentación.
//
//   npm run serve            (otra terminal)
//   python3 scripts/demo-media.py   (una vez: la escena de demostración de la cámara)
//   npm run store:capture    → design/store/captures/*.png y presentacion/img/*.png
//
// Usa la extensión real, la página de ejemplo (design/demo/tutorial.html servida como
// https://demo.example.com, dominio reservado para ejemplos) y el celular real (página
// remote/) conectado por PeerJS, con la escena de design/demo/escena.html como cámara.
// Como en test/e2e.mjs, la copia de la extensión lleva una clave fija y se lanza
// autorizada para poder grabar una pestaña sin pulsar el ícono. Sigue el mismo orden que
// la prueba: primero se graba y al final se capturan los ajustes y el popup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8769';
const SHOTS = path.join(ROOT, 'design', 'store', 'captures');
const PRES = path.join(ROOT, 'presentacion', 'img');
const MEDIA = path.join(ROOT, 'test', 'out', 'media');
const DEMO_HTML = fs.readFileSync(path.join(ROOT, 'design', 'demo', 'tutorial.html'), 'utf8');
const SCRIPT = 'Hola, soy Ana y en este video te muestro el resumen de ventas del trimestre.\n\nPrimero, mira los ingresos: subieron un 12 % frente al trimestre anterior.\n\nAhora fíjate en septiembre: es nuestro mejor mes del año.\n\nPor último, los pedidos: los datos de las tarjetas quedan ocultos.';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PRES, { recursive: true });
if (!fs.existsSync(path.join(MEDIA, 'camara.jpg'))) {
  console.error('Falta la escena de demostración: ejecuta «python3 scripts/demo-media.py».');
  process.exit(1);
}

// Fuera del proyecto: un Escritorio sincronizado con iCloud deja copias de conflicto.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'grabazo-capturas-'));
const EXT = path.join(TMP, 'extension');
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['https://demo.example.com/*'];
const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
manifest.key = der.toString('base64');
const EXT_ID = [...crypto.createHash('sha256').update(der).digest().subarray(0, 16)]
  .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const DEMO_VIEW = { width: 1280, height: 760 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

async function save(page, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  // Las pestañas en segundo plano no dibujan: se trae al frente antes de capturar.
  await page.bringToFront();
  // Al volver al frente, Chrome sin ventana puede perder la emulación de tamaño, quedar con
  // un zoom pasajero o pintar el video de la burbuja (un iframe de la extensión) ampliado
  // hacia una esquina. Un cambio mínimo de tamaño obliga a repintar todo bien.
  if (opts.viewport) {
    await page.setViewport({ ...opts.viewport, width: opts.viewport.width + 2 });
    await sleep(250);
    await page.setViewport(opts.viewport);
    for (let i = 0; i < 10; i++) {
      const v = await page.evaluate(() => ({ scale: visualViewport.scale, w: innerWidth, x: visualViewport.offsetLeft, y: visualViewport.offsetTop }));
      if (v.scale === 1 && v.w === opts.viewport.width && !v.x && !v.y) break;
      await sleep(300);
    }
    // El primer cuadro tras el cambio puede ser el anterior estirado: se descarta.
    await sleep(500);
    await page.screenshot();
  }
  await sleep(opts.wait ?? 400);
  // Si Chrome entregó la página ampliada (artefacto de Chrome sin ventana), se repite y
  // se guarda la toma ya comprobada.
  if (opts.verify) {
    let shot = null;
    for (let i = 0; i < 8; i++) {
      shot = await page.screenshot({ encoding: 'base64' });
      if (await opts.verify(shot)) break;
      console.log(`   (${name}: imagen ampliada o burbuja mal pintada, se repite)`);
      await page.setViewport({ ...opts.viewport, width: opts.viewport.width + 2 });
      await sleep(300);
      await page.setViewport(opts.viewport);
      await opts.repair?.();
      await sleep(900);
    }
    fs.writeFileSync(file, Buffer.from(shot, 'base64'));
  } else if (opts.element) await (await page.$(opts.element)).screenshot({ path: file });
  else await page.screenshot({ path: file, clip: opts.clip });
  fs.copyFileSync(file, path.join(PRES, `${name}.png`));
  console.log('  ', path.relative(ROOT, file));
}

// No se usan --use-fake-ui-for-media-stream ni --use-file-for-fake-video-capture: los dos
// dejan sin imagen a la captura de la pestaña. La cámara del celular se simula abajo.
const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: path.join(TMP, 'perfil'),
  enableExtensions: [EXT],
  args: ['--window-size=1400,900', '--hide-scrollbars', '--use-fake-device-for-media-stream', `--allowlisted-extension-id=${EXT_ID}`],
  defaultViewport: null,
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const cdp = await browser.target().createCDPSession();
  const welcome = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 8000 });
  await welcome?.close();
  const ext = await browser.newPage();
  await ext.goto(`chrome-extension://${extId}/options.html`);
  const sw = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  // Comprueba una captura de la página de ejemplo. Bien capturada, la barra de navegación
  // blanca llega hasta y≈66 (en y=80 ya se ve el fondo) y en el centro de la burbuja de la
  // cámara (tamaño L, 290 px) se ve la cara de la persona, no la pared de atrás.
  // El iframe de la burbuja puede quedarse con el tamaño de un zoom pasajero (se ve
  // ampliado hacia una esquina): ocultar y mostrar la cámara lo crea de nuevo.
  const repairBubble = async () => {
    await sw({ type: 'op', op: 'ui:set', patch: { camera: false } });
    await sleep(600);
    await sw({ type: 'op', op: 'ui:set', patch: { camera: true } });
    await waitFor(() => demo.frames().find((f) => f.url().includes('/camara.html'))?.$eval('body', (b) => b.classList.contains('live')), { timeout: 8000 });
    await sleep(800);
  };
  const notZoomed = async (b64) => {
    const { camPos } = await ext.evaluate(() => chrome.storage.local.get('camPos'));
    const center = camPos ? [camPos.x + 145, camPos.y + 145] : [28 + 145, DEMO_VIEW.height - 290 - 96 + 145];
    return ext.evaluate(async (data, [cx, cy]) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const px = (a, b) => [...x.getImageData(a, b, 1, 1).data].slice(0, 3);
      const [n, g] = [px(1000, 40), px(1000, 80)];
      const page = n.reduce((sum, v, i) => sum + Math.abs(v - g[i]), 0) > 4;
      const d = x.getImageData(Math.round(cx) - 4, Math.round(cy) - 4, 9, 9).data;
      let r = 0, gg = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const k = d.length / 4;
      [r, gg, b] = [r / k, gg / k, b / k];
      const face = r - gg > 30 && r - b > 60;
      return page && face;
    }, b64, center);
  };
  const state = () => sw({ type: 'state:get' });
  const setSettings = (patch) => ext.evaluate(async (p) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), ...p } });
  }, patch);
  await setSettings({ remoteUrl: `${BASE}/remote/`, mode: 'tab', camera: true, camId: 'phone', camShape: 'circle', camSize: 'l', mic: true, micId: 'phone', countdown: 3, pushToTalk: true, camEffect: 'none', camFilter: 'none' });
  await sw({ type: 'script:set', text: SCRIPT });

  // ---------- celular conectado, con la escena como cámara
  await ext.click('#link-start');
  await waitFor(async () => (await state()).link.status === 'ready', { timeout: 25000 });
  const info = await sw({ type: 'link:info' });
  const phoneCtx = await browser.createBrowserContext();
  await Promise.all(['camera', 'microphone'].map((name) => cdp.send('Browser.setPermission', { permission: { name }, setting: 'granted', origin: new URL(BASE).origin, browserContextId: phoneCtx.id })));
  const phone = await phoneCtx.newPage();
  await phone.setUserAgent({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1' });
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.evaluateOnNewDocument((src) => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (!c?.video) return real(c);
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
      const ctx = canvas.getContext('2d');
      const t0 = performance.now();
      setInterval(() => {
        const k = 1.02 + Math.sin((performance.now() - t0) / 900) * 0.015;
        ctx.drawImage(img, (1280 - 1280 * k) / 2, (720 - 720 * k) / 2, 1280 * k, 720 * k);
      }, 33);
      const stream = canvas.captureStream(30);
      if (c.audio) {
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        gain.gain.value = 0.02;
        osc.connect(gain).connect(dest);
        osc.start();
        stream.addTrack(dest.stream.getAudioTracks()[0]);
      }
      return stream;
    };
  }, `${BASE}/test/out/media/camara.jpg`);
  await phone.goto(`${BASE}/remote/#id=${info.identity.peerId}&k=${info.identity.token}`);
  await waitFor(() => phone.$eval('#app', (a) => a.dataset.conn === 'connected' && a.classList.contains('ready')), { timeout: 30000 });
  await phone.evaluate(() => { const o = JSON.parse(localStorage.getItem('grabazo.prefs') || '{}'); localStorage.setItem('grabazo.prefs', JSON.stringify({ ...o, haptics: false })); });
  await phone.click('.tabs [data-view="camera"]');
  await phone.click('#cam-start');
  await waitFor(async () => (await state()).link.camLive === true, { timeout: 15000 });
  await phone.click('.tabs [data-view="control"]');

  // ---------- página de ejemplo
  const demo = await browser.newPage();
  await demo.setRequestInterception(true);
  demo.on('request', (req) => {
    if (req.url().startsWith('https://demo.example.com/')) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: DEMO_HTML });
    else req.continue();
  });
  await demo.setViewport(DEMO_VIEW);
  await demo.goto('https://demo.example.com/ventas');
  await demo.bringToFront();
  const tabId = await ext.evaluate(async () => (await chrome.tabs.query({ url: 'https://demo.example.com/*' }))[0]?.id);

  // ---------- grabando la pestaña desde el celular
  // Como si el popup se hubiera abierto en esta pestaña (es la que se graba).
  await ext.evaluate((id) => chrome.storage.session.set({ prepTab: id }), tabId);
  await demo.bringToFront();
  await phone.click('#rec');
  const started = await waitFor(async () => (await state()).rec.status === 'recording', { timeout: 20000 });
  if (!started) throw new Error(`no empezó a grabar: ${JSON.stringify((await state()).rec)}`);
  await waitFor(() => demo.$eval('grabazo-capa', (h) => h.dataset.toolbar === 'true'), { timeout: 8000 });
  await sleep(1200);

  const pick = async (tool, color) => {
    if (color) await sw({ type: 'op', op: 'ui:set', patch: { color } });
    await sw({ type: 'op', op: 'ui:set', patch: { tool } });
    await waitFor(() => demo.$eval('grabazo-capa', (h, t) => h.dataset.tool === t, tool), { timeout: 3000 });
  };
  const stroke = async (points) => {
    await demo.mouse.move(...points[0]);
    await demo.mouse.down();
    for (const p of points.slice(1)) await demo.mouse.move(...p, { steps: 3 });
    await demo.mouse.up();
  };
  // Un círculo alrededor de septiembre, una flecha y un texto; los ingresos resaltados.
  await pick('ellipse', '#FF453A');
  await stroke([[664, 388], [756, 470]]);
  await pick('arrow', '#FF9F0A');
  await stroke([[560, 452], [652, 428]]);
  await pick('text', '#FF453A');
  await demo.mouse.click(430, 452);
  await sleep(150);
  await demo.keyboard.type('¡Mejor mes!');
  await demo.keyboard.press('Enter');
  await pick('highlighter', '#FFD60A');
  await stroke([[98, 254], [170, 254], [238, 254]]);
  await pick('pen', '#30D158');
  await stroke([[948, 274], [980, 276], [1012, 273]]);
  await sw({ type: 'op', op: 'ui:set', patch: { tool: null, clicks: true } });
  await demo.mouse.move(700, 260);
  await sleep(600);
  // La primera captura tras escribir el texto puede salir con un zoom pasajero: se descarta.
  await demo.setViewport(DEMO_VIEW);
  await demo.screenshot();
  await sleep(500);
  await save(demo, 'grabando-dibujos', { wait: 900, viewport: DEMO_VIEW, verify: notZoomed, repair: repairBubble });

  // Foco de luz sobre los indicadores.
  await sw({ type: 'op', op: 'ui:set', patch: { spotlight: true } });
  await demo.mouse.move(260, 175, { steps: 6 });
  await sleep(700);
  await save(demo, 'grabando-foco', { wait: 500, viewport: DEMO_VIEW, verify: notZoomed, repair: repairBubble });
  await sw({ type: 'op', op: 'ui:set', patch: { spotlight: false } });

  // Difuminar los números de tarjeta.
  await sw({ type: 'op', op: 'ui:set', patch: { blur: true } });
  await sleep(300);
  for (const y of [447, 489, 531, 573]) await demo.mouse.click(985, y);
  await sw({ type: 'op', op: 'ui:set', patch: { blur: false } });
  await demo.mouse.move(820, 660);
  await save(demo, 'grabando-difuminar', { wait: 600, viewport: DEMO_VIEW, verify: notZoomed, repair: repairBubble });

  // El celular como control remoto, teleprompter y cámara durante la grabación.
  await sw({ type: 'op', op: 'ui:set', patch: { tool: 'pen', color: '#FF9F0A', spotlight: true } });
  await sleep(500);
  await save(phone, 'phone-control', { wait: 700 });
  await phone.click('.tabs [data-view="script"]');
  await phone.evaluate(() => { document.querySelector('#prompter-text').scrollTop = 140; });
  await save(phone, 'phone-guion', { wait: 700 });
  await phone.click('.tabs [data-view="camera"]');
  await save(phone, 'phone-camara', { wait: 900 });
  await phone.click('.tabs [data-view="control"]');
  await sw({ type: 'op', op: 'ui:set', patch: { tool: null, spotlight: false } });

  // El popup mientras se graba (la pestaña capturada sigue entregando imagen).
  const live = await browser.newPage();
  await live.setViewport({ width: 372, height: 760 });
  await live.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await sleep(900);
  const liveHeight = await live.evaluate(() => document.documentElement.scrollHeight);
  await save(live, 'popup-grabando', { clip: { x: 0, y: 0, width: 372, height: liveHeight } });
  await live.close();
  await demo.bringToFront();
  await demo.mouse.move(640, 400, { steps: 8 });
  await sleep(2000);

  // ---------- estudio
  await sw({ type: 'op', op: 'rec:stop' });
  await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 20000 });
  const id = (await state()).rec.lastId;
  const studio = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes(`estudio.html#${id}`)), { timeout: 10000 });
  if (!studio) throw new Error('no se abrió el estudio');
  await studio.setViewport({ width: 1280, height: 800 });
  // Un recorte al inicio y un corte en el medio, como si ya se hubiera editado.
  await ext.evaluate(async (vid) => {
    const db = await import('./lib/db.js');
    const { meta } = await db.getVideo(vid);
    const d = (meta.duration || 8000) / 1000;
    await db.updateVideo(vid, { title: 'Resumen de ventas del trimestre', edits: { trimStart: d * 0.06, trimEnd: d * 0.94, cuts: [{ start: d * 0.42, end: d * 0.55 }], mute: false } });
  }, id);
  await studio.bringToFront();
  await studio.reload();
  await waitFor(() => studio.evaluate(() => window.__estudio?.state?.view === 'editor' && window.__estudio.state.duration > 0), { timeout: 15000 });
  await studio.evaluate(() => window.__estudio.seek(1.2));
  await sleep(2500);
  await save(studio, 'estudio', { wait: 800 });
  await studio.goto(`chrome-extension://${extId}/estudio.html`);
  await sleep(1500);
  await save(studio, 'biblioteca', { wait: 600 });

  // ---------- Ventana: «Ubica tu cámara» (la cámara va dentro del video)
  // Chrome sin ventana no muestra su selector de ventanas: en la pestaña del grabador se
  // reemplaza por la página de ejemplo (una imagen de ella). La cámara es la del celular.
  await demo.bringToFront();
  await demo.setViewport(DEMO_VIEW);
  await sleep(600);
  const pageShot = await demo.screenshot({ encoding: 'base64' });
  await setSettings({ mode: 'window', camAsk: true, camShape: 'circle', camSize: 'm', camPlace: { x: 0, y: 1 }, systemAudio: false });
  await sw({ type: 'op', op: 'rec:start', tabId });
  const placeId = (await state()).rec.id;
  const placer = await (await browser.waitForTarget((t) => t.url().includes(`grabador.html#${placeId}`), { timeout: 15000 })).page();
  await placer.evaluateOnNewDocument((src) => {
    const pick = (sources, cb) => { setTimeout(() => cb('grabazo-captura', { canRequestAudioTrack: false }), 100); return 1; };
    try { chrome.desktopCapture.chooseDesktopMedia = pick; } catch {}
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (c?.video?.mandatory?.chromeMediaSource !== 'desktop') return real(c);
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
      const ctx = canvas.getContext('2d', { alpha: false });
      setInterval(() => ctx.drawImage(img, 0, 0), 33);
      ctx.drawImage(img, 0, 0);
      return canvas.captureStream(30);
    };
  }, `data:image/png;base64,${pageShot}`);
  await placer.setViewport({ width: 1280, height: 800 });
  await placer.reload();
  const placing = await waitFor(() => placer.evaluate(() => document.body.dataset.phase === 'placing' && globalThis.__grabador?.cam.live), { timeout: 25000 });
  if (!placing) throw new Error('no apareció «Ubica tu cámara»');
  await placer.evaluate(() => document.activeElement?.blur());
  await sleep(1500);
  await save(placer, 'ubicar-camara', { wait: 800, viewport: { width: 1280, height: 800 }, clip: { x: 50, y: 180, width: 1180, height: 460 } });
  await sw({ type: 'op', op: 'rec:discard' });
  await waitFor(async () => (await state()).rec.status === 'idle', { timeout: 10000 });
  await setSettings({ mode: 'tab', systemAudio: true });

  // ---------- bienvenida y popup antes de grabar
  await ext.setViewport({ width: 1280, height: 800 });
  await ext.goto(`chrome-extension://${extId}/options.html#bienvenida`);
  await sleep(800);
  await save(ext, 'options', { clip: { x: 0, y: 0, width: 1280, height: 800 } });

  const popup = await browser.newPage();
  await popup.setViewport({ width: 372, height: 760 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await popup.evaluate(() => { try { localStorage.setItem('grabazo.phoneOpen', ''); } catch {} });
  await popup.reload();
  await sleep(900);
  const popupHeight = await popup.evaluate(() => document.documentElement.scrollHeight);
  await save(popup, 'popup', { clip: { x: 0, y: 0, width: 372, height: popupHeight } });
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await save(popup, 'popup-oscuro', { clip: { x: 0, y: 0, width: 372, height: popupHeight }, wait: 500 });
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await popup.click('#phone-toggle');
  await sleep(1200);
  const qrHeight = await popup.evaluate(() => document.documentElement.scrollHeight);
  await save(popup, 'popup-qr', { clip: { x: 0, y: 0, width: 372, height: qrHeight } });
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
