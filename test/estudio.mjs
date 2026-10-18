// Prueba del estudio de Grabazo con la extensión real en Chrome sin ventana: crea una
// grabación de 4 s (lienzo + tono de 440 Hz con MediaRecorder), la guarda como lo hace
// el grabador y revisa la biblioteca, el editor (recorte, cortes, deshacer, silencio),
// la exportación a MP4, WebM y GIF (duración de cada archivo con Mediabunny), la
// cancelación y la recuperación de una grabación interrumpida.
//   npm run test:estudio
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECS = 4;

// La extensión de prueba, el perfil y las descargas van a la carpeta temporal del
// sistema: si el proyecto está en un Escritorio sincronizado con iCloud, ahí aparecen
// copias de conflicto («_locales 2») que Chrome no acepta.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grabazo-estudio-')));
const EXT = path.join(TMP, 'extension');
const DL = path.join(TMP, 'descargas');
const PROFILE = path.join(TMP, 'perfil');
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
fs.mkdirSync(DL, { recursive: true });
fs.mkdirSync(path.join(PROFILE, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(PROFILE, 'Default', 'Preferences'),
  JSON.stringify({ download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true }, savefile: { default_directory: DL } }),
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));

async function waitFor(fn, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

// Identificador de una extensión sin empaquetar (por si el service worker no arranca).
function unpackedId(dir) {
  const hex = crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// Graba en la página un lienzo que cambia de color en cada cuadro (con su número) y un
// tono de 440 Hz, y lo guarda como lo hace el grabador. Con `chunks`, guarda además las
// mismas partes como una grabación interrumpida.
function record(page, { secs, mimes, title, chunks = false }) {
  return page.evaluate(async ({ secs, mimes, title, chunks }) => {
    const mime = mimes.find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return null;
    const W = 640;
    const H = 360;
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d');
    let frame = 0;
    const draw = () => {
      ctx.fillStyle = `hsl(${(frame * 9) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 140px sans-serif';
      ctx.fillText(String(frame), 40, 240);
      frame++;
    };
    draw();
    const stream = canvas.captureStream(30);
    const ac = new AudioContext();
    await ac.resume();
    const osc = ac.createOscillator();
    osc.frequency.value = 440;
    const dest = ac.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const timer = setInterval(draw, 1000 / 30);
    rec.start(500);
    await new Promise((r) => setTimeout(r, secs * 1000));
    await new Promise((r) => { rec.onstop = r; rec.stop(); });
    clearInterval(timer);
    osc.stop();
    ac.close();
    const blob = new Blob(parts, { type: rec.mimeType || mime });
    const thumb = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    const db = await import('./lib/db.js');
    const id = db.newId();
    await db.putVideo({ id, title, created: Date.now(), duration: secs * 1000, width: W, height: H, mime: blob.type, size: blob.size, mode: 'tab', thumb }, blob);
    const recId = chunks ? `${id}-cortada` : '';
    if (chunks) {
      for (let i = 0; i < parts.length; i++) await db.saveChunk(recId, i, parts[i], i === 0 ? { mime: blob.type, mode: 'screen', created: Date.now() - 60_000 } : null);
    }
    return { id, recId, size: blob.size, mime: blob.type, parts: parts.length };
  }, { secs, mimes, title, chunks });
}

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: PROFILE,
  enableExtensions: [EXT],
  args: ['--window-size=1400,900', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: null,
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 10000 }).catch(() => null);
  const extId = swTarget ? new URL(swTarget.url()).host : unpackedId(EXT);
  check('la extensión carga', !!extId, swTarget ? 'service worker activo' : 'id calculado (sin service worker)');
  const BASE = `chrome-extension://${extId}/estudio.html`;

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  page.on('dialog', (d) => d.accept());
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

  // Al instalarse, la extensión abre su bienvenida en otra pestaña: se cierra, porque
  // Chrome no carga videos en pestañas de fondo.
  for (const p of await browser.pages()) if (p !== page) await p.close().catch(() => {});
  await page.goto(BASE);
  await page.bringToFront();
  check('la biblioteca vacía muestra la ayuda para empezar', await waitFor(() => page.$eval('#empty', (e) => !e.hidden && e.textContent.includes('Alt'))));

  // ---------- una grabación de prueba (como la guarda el grabador)
  const made = await record(page, { secs: SECS, mimes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'], title: 'Demo del estudio', chunks: true });
  check('se genera una grabación WebM de prueba', made?.size > 10_000, `${made?.mime}, ${made?.size} bytes, ${made?.parts} partes`);

  await page.reload();
  const card = await waitFor(() => page.$$eval('#grid .vcard', (els, id) => {
    const c = els.find((e) => e.dataset.id === id);
    return c && { title: c.querySelector('.vtitle').textContent, meta: c.querySelector('.vmeta').textContent, badge: c.querySelector('.badge').textContent, img: !!c.querySelector('img') };
  }, made.id));
  check('la biblioteca muestra la tarjeta con título, miniatura y duración', card?.title === 'Demo del estudio' && card.img && card.badge === '0:04', JSON.stringify(card));
  check('la tarjeta dice fecha, tamaño y modo', /\d{4}, \d{2}:\d{2} · [\d,]+ (KB|MB) · Pestaña$/.test(card?.meta || ''), card?.meta);
  check('la grabación interrumpida aparece con «Recuperar»', await waitFor(() => page.$$eval('#grid .vcard.pending', (els, rec) => els.some((e) => e.dataset.rec === rec && e.textContent.includes('Recuperar')), made.recId)));
  check('se muestra el espacio usado', await waitFor(() => page.$eval('#storage', (e) => /usados/.test(e.textContent))));

  // ---------- editor
  await page.$$eval('#grid .vcard', (els, id) => els.find((e) => e.dataset.id === id).querySelector('.thumb').click(), made.id);
  const st = () => page.evaluate(() => window.__estudio.state);
  const loaded = await waitFor(async () => { const s = await st(); return s.view === 'editor' && s.duration > 0 && s; }, { timeout: 20000 });
  check('el editor abre la grabación con su duración', loaded && near(loaded.duration, SECS, 0.5), `duración ${fmt(loaded?.duration)} s`);
  check('el reloj muestra «0:00 / 0:04»', await waitFor(() => page.$eval('#time', (e) => e.textContent === '0:00 / 0:04')));
  const thumbs = await waitFor(() => page.$$eval('#strip canvas.on', (els) => els.length === 16 && els.length), { timeout: 20000 });
  check('la línea de tiempo muestra las 16 miniaturas', thumbs === 16, `${thumbs ?? 'menos'} de 16`);
  check('el archivo se reconoce (contenedor y códecs)', await waitFor(async () => { const s = await st(); return s.info?.container === 'webm' && /vp[89]/.test(s.info.video) && s.info.audio === 'opus'; }));

  // Reproducir y pausar con Espacio
  await page.keyboard.press('Space');
  const advanced = await waitFor(async () => (await st()).time > 0.4, { timeout: 6000 });
  await page.keyboard.press('Space');
  check('Espacio reproduce y pausa', !!advanced && (await page.$eval('#video', (v) => v.paused)));

  // ---------- exportación instantánea (sin cambios, WebM → WebM)
  async function inspect() {
    return page.evaluate(async () => {
      const x = window.__lastExport;
      if (!x?.blob) return { error: x?.error || 'sin exportación' };
      const out = { size: x.size, type: x.type, filename: x.filename, copied: x.copied, fellBack: x.fellBack, ms: x.ms };
      if (x.type === 'image/gif') {
        out.head = new TextDecoder().decode(await x.blob.slice(0, 6).arrayBuffer());
        const dec = new ImageDecoder({ data: x.blob.stream(), type: 'image/gif' });
        await dec.tracks.ready;
        await dec.completed;
        out.frames = dec.tracks.selectedTrack.frameCount;
        let total = 0;
        const colors = new Set();
        const probe = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
        for (let i = 0; i < out.frames; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          if (i === 0) out.width = image.displayWidth;
          total += image.duration || 0;
          probe.drawImage(image, 600 * (image.displayWidth / 640), 20, 1, 1, 0, 0, 1, 1);
          colors.add(probe.getImageData(0, 0, 1, 1).data.slice(0, 3).join(','));
          image.close();
        }
        out.colors = colors.size;
        dec.close();
        out.duration = total / 1e6;
        return out;
      }
      const mb = await import('./lib/vendor/mediabunny.min.mjs');
      const input = new mb.Input({ source: new mb.BlobSource(x.blob), formats: mb.ALL_FORMATS });
      try {
        const v = await input.getPrimaryVideoTrack();
        const a = await input.getPrimaryAudioTrack();
        out.container = (await input.getFormat()).name;
        out.video = v ? await v.getCodec() : null;
        out.audio = a ? await a.getCodec() : null;
        out.duration = await input.computeDuration();
        out.vDur = v ? await v.computeDuration() : null;
        out.aDur = a ? await a.computeDuration() : null;
        out.metaDuration = await input.getDurationFromMetadata().catch(() => null);
        if (v) {
          const sink = new mb.VideoSampleSink(v);
          let frames = 0;
          for await (const s of sink.samples()) { frames++; s.close(); }
          out.frames = frames;
        }
      } finally {
        input.dispose();
      }
      return out;
    });
  }

  async function exportAs(format, { quality, gifWidth, gifFps, timeout = 180000 } = {}) {
    await page.evaluate(() => { window.__lastExport = null; window.__estudioTest = true; });
    await page.click(`#fmt [data-v="${format}"]`);
    if (quality) await page.click(`#quality [data-v="${quality}"]`);
    if (gifWidth) await page.click(`#gif-width [data-v="${gifWidth}"]`);
    if (gifFps) await page.click(`#gif-fps [data-v="${gifFps}"]`);
    const hint = await page.$eval('#export-hint', (e) => e.textContent);
    await page.click('#export');
    await waitFor(() => page.evaluate(() => !!window.__lastExport && !window.__estudio.state.exporting), { timeout });
    return { hint, ...(await inspect()) };
  }

  async function downloaded(filename) {
    const base = path.basename(filename).replace(/\.[a-z0-9]+$/i, '');
    const item = await waitFor(async () => {
      const items = await page.evaluate(() => new Promise((r) => chrome.downloads.search({ orderBy: ['-startTime'], limit: 20 }, r)));
      return items.find((d) => d.state === 'complete' && path.basename(d.filename).startsWith(base) && d.filename.includes(`${path.sep}Grabazo${path.sep}`));
    }, { timeout: 20000 });
    if (!item) {
      const items = await page.evaluate(() => new Promise((r) => chrome.downloads.search({ orderBy: ['-startTime'], limit: 5 }, r)));
      return { missing: items.map((d) => `${d.filename || d.url.slice(0, 40)} [${d.state}${d.error ? ' ' + d.error : ''}]`).join(' | ') || 'sin descargas' };
    }
    return fs.existsSync(item.filename) ? { file: item.filename, bytes: fs.statSync(item.filename).size } : { missing: `no está en el disco: ${item.filename}` };
  }

  const copy = await exportAs('webm');
  check('sin cambios, WebM es «exportación instantánea»', /instantánea/.test(copy.hint), copy.hint);
  check('la copia instantánea no vuelve a codificar', copy.copied === true && copy.fellBack === false, `${copy.ms} ms`);
  check('la copia dura lo mismo y ahora trae la duración en el archivo', near(copy.duration, SECS, 0.3) && near(copy.metaDuration, SECS, 0.3), `${fmt(copy.duration)} s (metadatos ${fmt(copy.metaDuration)} s)`);
  const dlCopy = await downloaded(copy.filename || '');
  check('la copia se descarga en la carpeta «Grabazo»', dlCopy?.bytes > 0 && copy.filename === 'Grabazo/Demo del estudio.webm', `${copy.filename} → ${dlCopy?.bytes ?? dlCopy?.missing} bytes`);
  check('aviso «Listo: …»', await waitFor(() => page.$eval('#toast', (e) => e.textContent.startsWith('Listo: Demo del estudio.webm'))));

  // ---------- recorte con las asas (0,5 s → 3,5 s)
  const dragTo = async (sel, seconds) => {
    const handle = await page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const tr = await page.$eval('#track', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, width: r.width }; });
    const { duration } = await st();
    const x = tr.left + (seconds / duration) * tr.width + (sel === '#h-start' ? 7 : -7);
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move((handle.x + x) / 2, handle.y, { steps: 4 });
    await page.mouse.move(x, handle.y, { steps: 4 });
    await page.mouse.up();
  };
  await dragTo('#h-start', 0.5);
  await dragTo('#h-end', 3.5);
  let s = await st();
  check('las asas recortan el inicio y el final', near(s.edit.trimStart, 0.5, 0.08) && near(s.edit.trimEnd, 3.5, 0.08), `${fmt(s.edit.trimStart)} – ${fmt(s.edit.trimEnd)}`);

  // ---------- corte con I / O / X
  await page.evaluate(() => window.__estudio.seek(1.5));
  await sleep(150);
  await page.keyboard.press('i');
  await page.evaluate(() => window.__estudio.seek(2));
  await sleep(150);
  await page.keyboard.press('o');
  check('I y O marcan la selección', await waitFor(async () => { const x = await st(); return near(x.sel?.start, 1.5, 0.05) && near(x.sel?.end, 2, 0.05); }));
  check('«Cortar selección» se activa', await page.$eval('#cut', (b) => !b.disabled));
  await page.keyboard.press('x');
  s = await st();
  check('X corta la selección (zona roja)', s.edit.cuts.length === 1 && near(s.edit.cuts[0].start, 1.5, 0.05) && near(s.edit.cuts[0].end, 2, 0.05) && (await page.$$eval('#cuts .cut', (e) => e.length)) === 1, JSON.stringify(s.edit.cuts));

  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  const undone = (await st()).edit.cuts.length === 0;
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('z');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  check('Ctrl+Z deshace y Mayús+Ctrl+Z rehace', undone && (await st()).edit.cuts.length === 1);

  // Un segundo corte arrastrando sobre la línea de tiempo, que luego se elige y se borra.
  const tr = await page.$eval('#track', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
  const xAt = (sec) => tr.left + (sec / s.duration) * tr.width;
  const y = tr.top + tr.height / 2;
  await page.mouse.move(xAt(2.6), y);
  await page.mouse.down();
  await page.mouse.move(xAt(2.7), y, { steps: 3 });
  await page.mouse.move(xAt(2.9), y, { steps: 3 });
  await page.mouse.up();
  const dragged = await st();
  check('arrastrar sobre la línea de tiempo selecciona una parte', near(dragged.sel?.start, 2.6, 0.08) && near(dragged.sel?.end, 2.9, 0.08), `${fmt(dragged.sel?.start)} – ${fmt(dragged.sel?.end)}`);
  await page.click('#cut');
  const two = (await st()).edit.cuts.length === 2;
  await page.mouse.click(xAt(2.75), y);
  const picked = (await st()).picked;
  await page.keyboard.press('Delete');
  s = await st();
  check('un corte se elige con un clic y Supr lo quita', two && picked === 1 && s.edit.cuts.length === 1, `cortes: ${s.edit.cuts.length}`);

  const expected = 2.5; // (0,5 → 1,5) + (2 → 3,5)
  check('quedan dos partes: 2,5 s en total', s.kept.length === 2 && near(s.kept.reduce((a, r) => a + r.end - r.start, 0), expected, 0.1), JSON.stringify(s.kept.map((r) => [fmt(r.start), fmt(r.end)])));
  check('la duración final se muestra', await page.$eval('#result', (e) => /Duración final: 2,[45] s de 4 s/.test(e.textContent)), await page.$eval('#result', (e) => e.textContent));

  // La reproducción salta el corte y se detiene en el final del recorte.
  await page.evaluate(() => window.__estudio.seek(1.2));
  await sleep(200);
  await page.keyboard.press('Space');
  const skipped = await waitFor(async () => { const x = await st(); return x.time >= 2 && x.time < 2.6 && x.time; }, { timeout: 5000, interval: 40 });
  const stopped = await waitFor(() => page.$eval('#video', (v) => v.paused && v.currentTime >= 3.4 && v.currentTime), { timeout: 6000 });
  check('al reproducir se salta el corte y se detiene en el final', !!skipped && !!stopped, `saltó a ${fmt(skipped)} s, paró en ${fmt(stopped)} s`);

  // ---------- exportaciones con cambios
  const mp4 = await exportAs('mp4', { quality: 'high' });
  check('MP4 con cambios: se vuelve a codificar', /codificar/.test(mp4.hint) && mp4.copied === false, mp4.hint);
  check('MP4: archivo válido con video y audio', mp4.type === 'video/mp4' && mp4.size > 5000 && mp4.video && mp4.audio, `${mp4.container}, ${mp4.video} + ${mp4.audio}, ${mp4.size} bytes, ${mp4.ms} ms`);
  check('MP4: dura lo que queda tras recortar y cortar (2,5 s)', near(mp4.duration, expected, 0.25), `${fmt(mp4.duration)} s, ${mp4.frames} cuadros`);
  check('MP4: audio y video duran lo mismo (sin desfase en los cortes)', near(mp4.aDur, mp4.vDur, 0.1), `video ${fmt(mp4.vDur)} s, audio ${fmt(mp4.aDur)} s`);
  const dlMp4 = await downloaded(mp4.filename || '');
  check('MP4: se descarga', dlMp4?.bytes === mp4.size, dlMp4?.file || dlMp4?.missing);

  const webm = await exportAs('webm', { quality: 'medium' });
  check('WebM: archivo válido con video y audio', webm.type === 'video/webm' && /vp[89]|av1/.test(webm.video || '') && webm.audio === 'opus', `${webm.video} + ${webm.audio}, ${webm.size} bytes, ${webm.ms} ms`);
  check('WebM: dura 2,5 s, con audio y video parejos', near(webm.duration, expected, 0.25) && near(webm.aDur, webm.vDur, 0.1), `${fmt(webm.duration)} s (video ${fmt(webm.vDur)}, audio ${fmt(webm.aDur)})`);

  await page.keyboard.press('m');
  const muted = (await st()).edit.mute && (await page.$eval('#mute', (e) => e.checked)) && (await page.$eval('#video', (v) => v.muted));
  const silent = await exportAs('webm', { quality: 'medium' });
  check('M quita el audio: la vista previa se silencia y el WebM sale sin audio', muted && silent.video && !silent.audio && near(silent.duration, expected, 0.25), `${silent.video} + ${silent.audio}`);
  await page.keyboard.press('m');

  const gif = await exportAs('gif', { gifWidth: '480', gifFps: '10' });
  check('GIF: archivo GIF89a de 480 px', gif.type === 'image/gif' && gif.head === 'GIF89a' && gif.width === 480, `${gif.size} bytes, ${gif.ms} ms`);
  check('GIF: 10 cuadros por segundo y 2,5 s', Math.abs(gif.frames - 25) <= 2 && near(gif.duration, expected, 0.2), `${gif.frames} cuadros, ${fmt(gif.duration)} s`);
  check('GIF: los cuadros cambian (la imagen no se congela)', gif.colors >= Math.min(15, gif.frames - 2), `${gif.colors} colores en ${gif.frames} cuadros`);
  const dlGif = await downloaded(gif.filename || '');
  check('GIF: se descarga', dlGif?.bytes === gif.size, dlGif?.file || dlGif?.missing);

  // ---------- cancelar
  await page.evaluate(() => { window.__lastExport = null; });
  await page.click('#fmt [data-v="gif"]');
  await page.click('#gif-width [data-v="800"]');
  await page.click('#gif-fps [data-v="20"]');
  await page.click('#export');
  await waitFor(() => page.$eval('#progress', (e) => !e.hidden), { timeout: 3000, interval: 20 });
  await page.click('#cancel').catch(() => {});
  const after = await waitFor(() => page.evaluate(() => window.__lastExport && !window.__estudio.state.exporting && window.__lastExport), { timeout: 30000 });
  const ready = await page.$eval('#export', (b) => !b.hidden && !b.disabled);
  check('«Cancelar» detiene la exportación y el botón vuelve a quedar listo', ready && (after?.error === 'canceled' || after?.size > 0), after?.error || 'terminó antes de cancelar');

  // ---------- título y cambios guardados
  await page.$eval('#title', (e) => { e.focus(); e.select(); });
  await page.keyboard.type('Mi demo editada');
  await page.keyboard.press('Enter');
  await sleep(600);
  await page.click('#back');
  const cardOf = () => page.$$eval('#grid .vcard', (els, id) => {
    const c = els.find((e) => e.dataset.id === id);
    return c && { title: c.querySelector('.vtitle').textContent, edited: !!c.querySelector('.badge.left') };
  }, made.id);
  const edited = (await waitFor(async () => { const c = await cardOf(); return c?.title === 'Mi demo editada' && c.edited && c; }, { timeout: 5000 })) || (await cardOf());
  check('el título nuevo y la marca «Editado» se ven en la biblioteca', edited?.title === 'Mi demo editada' && edited.edited, JSON.stringify(edited));
  await page.$$eval('#grid .vcard', (els, id) => els.find((e) => e.dataset.id === id).querySelector('.thumb').click(), made.id);
  const reopened = await waitFor(async () => { const x = await st(); return x.view === 'editor' && x.duration > 0 && x; });
  check('los cambios se conservan al volver a abrir', reopened?.edit.cuts.length === 1 && near(reopened.edit.trimStart, 0.5, 0.08), JSON.stringify(reopened?.edit));

  // ---------- una grabación MP4 (H.264): exportar a MP4 es instantáneo
  const mp4src = await record(page, { secs: 2, mimes: ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'], title: 'Demo MP4' });
  if (!mp4src) {
    console.log('SKIP  este Chrome no graba MP4 con MediaRecorder');
  } else {
    await page.goto(`${BASE}#${encodeURIComponent(mp4src.id)}`);
    await waitFor(async () => { const x = await st(); return x.view === 'editor' && x.duration > 0 && x.info?.container === 'mp4'; }, { timeout: 20000 });
    const quick = await exportAs('mp4');
    check('MP4 → MP4 sin cambios: copia instantánea', /instantánea/.test(quick.hint) && quick.copied === true && !quick.fellBack, `${quick.ms} ms`);
    check('la copia MP4 es válida y dura 2 s', quick.type === 'video/mp4' && quick.video === 'avc' && near(quick.duration, 2, 0.3) && near(quick.metaDuration, 2, 0.3), `${quick.video} + ${quick.audio}, ${fmt(quick.duration)} s`);
    await page.keyboard.press('m');
    const quiet = await exportAs('mp4');
    check('sin cambios pero sin audio: sigue siendo copia instantánea, sin la pista de audio', quiet.copied === true && quiet.video === 'avc' && !quiet.audio && near(quiet.duration, 2, 0.3), `${quiet.video} + ${quiet.audio}`);
    await page.keyboard.press('m');
    const toWebm = await exportAs('webm', { quality: 'high' });
    check('MP4 → WebM vuelve a codificar y dura 2 s', toWebm.copied === false && toWebm.type === 'video/webm' && near(toWebm.duration, 2, 0.3), `${toWebm.video} + ${toWebm.audio}, ${fmt(toWebm.duration)} s`);
  }

  // ---------- recuperar una grabación interrumpida
  await page.goto(`${BASE}#recuperar=${encodeURIComponent(made.recId)}`);
  check('#recuperar muestra el aviso', await waitFor(() => page.$eval('#recover-banner', (e) => !e.hidden)));
  await page.click('#recover-go');
  const recovered = await waitFor(async () => { const x = await st(); return x.view === 'editor' && x.id === made.recId && x.duration > 0 && x; }, { timeout: 30000 });
  check('al recuperarla se une y se abre en el editor', recovered && near(recovered.duration, SECS, 0.5), `duración ${fmt(recovered?.duration)} s`);
  const leftover = await page.evaluate(async (rec) => (await import('./lib/db.js')).chunksOf(rec).then((r) => r.length), made.recId);
  const savedMeta = await page.evaluate(async (rec) => { const v = await (await import('./lib/db.js')).getVideo(rec); return v && { title: v.meta.title, duration: v.meta.duration, thumb: !!v.meta.thumb, mode: v.meta.mode }; }, made.recId);
  check('quedó guardada (título, duración, miniatura) y sin partes sueltas', leftover === 0 && /^Grabación /.test(savedMeta?.title) && near(savedMeta.duration / 1000, SECS, 0.5) && savedMeta.thumb && savedMeta.mode === 'screen', JSON.stringify(savedMeta));

  // ---------- eliminar
  await page.click('#delete');
  await waitFor(async () => (await st()).view === 'library');
  const gone = await waitFor(() => page.$$eval('#grid .vcard', (els, rec) => !els.some((e) => e.dataset.id === rec || e.dataset.rec === rec), made.recId));
  check('«Eliminar» (con confirmación) la quita de la biblioteca', !!gone);

  // Mediabunny avisa (al recolectar basura) si se corta una lectura justo después del
  // primer cuadro, como al cancelar en seguida una exportación: es interno de la librería.
  const relevant = pageErrors.filter((e) => !/favicon|net::ERR|VideoSample was garbage collected/.test(e));
  check('sin errores en la página', relevant.length === 0, relevant.slice(0, 3).join(' | '));
} catch (err) {
  check('la prueba terminó sin errores', false, err.stack || String(err));
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
