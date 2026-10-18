// Grabazo — composición del video que se graba.
// Recibe la pista capturada y entrega otra con el recorte del área elegida, el zoom
// dinámico (sigue al cursor con movimiento suave) y el espejo de la cámara. Si no hay
// nada que transformar, los cuadros pasan tal cual (sin copiar píxeles).
//
//   const comp = createCompositor(track, { crop, mirror, maxW, maxH, fps });
//   comp.track            → pista para MediaRecorder
//   comp.zoomTo(level)    → 1 = sin zoom
//   comp.pointer(nx, ny)  → posición del cursor (0..1 dentro de lo que se graba)
//   comp.thumbnail()      → JPEG pequeño del último cuadro
//   comp.setCamera(track) → la cámara dentro del video (modos ventana y pantalla)
//   comp.camera({ visible, x, y, size, shape, mirror })  → dónde y cómo se dibuja
//                         (x, y: 0 = izquierda o arriba, 1 = derecha o abajo; size: alto
//                         en proporción al del video)
//   comp.stop()

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Cerrar un flujo que ya se cerró rechaza la promesa («Stream closed»): se ignora.
const quiet = (fn) => {
  try { fn()?.catch?.(() => {}); } catch {}
};

export function createCompositor(input, opts = {}) {
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const writer = generator.writable.getWriter();
  let reader = null;
  let firstFrame;
  const ready = new Promise((resolve) => { firstFrame = resolve; });
  const fps = opts.fps || 30;
  let crop = opts.crop || null; // { x, y, w, h } normalizado (0..1) sobre el cuadro capturado
  const mirror = !!opts.mirror;

  let stopped = false;
  let last = null; // último cuadro recibido (se conserva para animar el zoom)
  let outW = 0;
  let outH = 0;
  let canvas = null;
  let ctx = null;
  let writing = false;
  let pending = false;
  let lastTs = 0;
  let lastRender = 0;

  // Zoom: valor actual y objetivo; centro actual y objetivo (0..1 dentro del encuadre).
  let z = 1;
  let zt = 1;
  let cx = 0.5;
  let cy = 0.5;
  let tx = 0.5;
  let ty = 0.5;

  // Reloj (en un Worker, no se frena en segundo plano): a los cuadros por segundo del
  // video mientras hay zoom y, si no, unas pocas veces por segundo para que la grabación
  // no se detenga cuando la página está quieta (sin cuadros nuevos, MediaRecorder no
  // escribe nada, ni siquiera el audio).
  const KEEPALIVE_FPS = 4;
  const clockWorker = new Worker(new URL('./reloj.js', import.meta.url));
  let rate = 0;
  let lastEmit = 0;
  clockWorker.onmessage = () => tick();

  function setRate(next) {
    if (next === rate) return;
    rate = next;
    clockWorker.postMessage(next);
  }

  function setTicking(on) {
    setRate(stopped ? 0 : on ? fps : KEEPALIVE_FPS);
  }

  // Marca de tiempo propia y siempre creciente (µs).
  function ts() {
    const now = Math.round(performance.now() * 1000);
    lastTs = now > lastTs ? now : lastTs + 1;
    return lastTs;
  }

  function setup(fw, fh) {
    let w = crop ? fw * crop.w : fw;
    let h = crop ? fh * crop.h : fh;
    const scale = Math.min(1, (opts.maxW || w) / w, (opts.maxH || h) / h);
    outW = even(w * scale);
    outH = even(h * scale);
    canvas = new OffscreenCanvas(outW, outH);
    ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingQuality = 'high';
    firstFrame({ width: outW, height: outH });
  }

  // Cámara compuesta: posición dentro del espacio libre, tamaño (alto, 0..1 del video) y
  // valores objetivo hacia los que se mueve con suavidad.
  const cam = { reader: null, frame: null, visible: false, shape: 'circle', mirror: true, x: 0, y: 1, size: 0.25, tx: 0, ty: 1, tsize: 0.25 };
  const camActive = () => cam.visible && !!cam.frame && !!canvas;
  const camMoving = () => Math.abs(cam.x - cam.tx) > 0.0005 || Math.abs(cam.y - cam.ty) > 0.0005 || Math.abs(cam.size - cam.tsize) > 0.0005;

  const animating = () => Math.abs(z - zt) > 0.002 || Math.abs(cx - tx) > 0.001 || Math.abs(cy - ty) > 0.001 || camMoving();
  const transformed = () => !!crop || mirror || z > 1.001 || animating() || camActive();

  function step(dt) {
    // Suavizado exponencial: no depende de los cuadros por segundo.
    const kz = 1 - Math.exp(-dt / 0.16);
    const kp = 1 - Math.exp(-dt / (z > 1.01 ? 0.22 : 0.08));
    z += (zt - z) * kz;
    if (Math.abs(z - zt) < 0.002) z = zt;
    cx += (tx - cx) * kp;
    cy += (ty - cy) * kp;
    const kc = 1 - Math.exp(-dt / 0.18);
    cam.x += (cam.tx - cam.x) * kc;
    cam.y += (cam.ty - cam.y) * kc;
    cam.size += (cam.tsize - cam.size) * kc;
    if (!camMoving()) { cam.x = cam.tx; cam.y = cam.ty; cam.size = cam.tsize; }
  }

  // Rectángulo de la cámara en el video (px), con un margen al borde. `m` es el margen.
  function camRect(useTarget = false) {
    const size = useTarget ? cam.tsize : cam.size;
    const x = useTarget ? cam.tx : cam.x;
    const y = useTarget ? cam.ty : cam.y;
    const m = Math.round(Math.min(outW, outH) * 0.035);
    const h = Math.min(size * outH, outH - m * 2, (outW - m * 2) / (cam.shape === 'rect' ? 1.42 : 1));
    const w = cam.shape === 'rect' ? h * 1.42 : h;
    return { x: m + x * Math.max(0, outW - w - m * 2), y: m + y * Math.max(0, outH - h - m * 2), w, h, m };
  }

  function camPath(r) {
    ctx.beginPath();
    if (cam.shape === 'rect') ctx.roundRect(r.x, r.y, r.w, r.h, r.h * 0.12);
    else ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.h / 2, 0, Math.PI * 2);
  }

  function drawCamera() {
    const f = cam.frame;
    if (!camActive() || !f) return;
    const r = camRect();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.shadowColor = 'rgba(0,0,0,.38)';
    ctx.shadowBlur = r.h * 0.09;
    ctx.shadowOffsetY = r.h * 0.03;
    camPath(r);
    ctx.fillStyle = '#111113';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    camPath(r);
    ctx.clip();
    // La imagen llena la forma (recorte al centro) y, si se pide, en espejo.
    const fw = f.displayWidth;
    const fh = f.displayHeight;
    const k = Math.max(r.w / fw, r.h / fh);
    const sw = r.w / k;
    const sh = r.h / k;
    if (cam.mirror) {
      ctx.translate(r.x * 2 + r.w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(f, (fw - sw) / 2, (fh - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
    ctx.restore();
    ctx.save();
    camPath(r);
    ctx.lineWidth = Math.max(2, r.h * 0.022);
    ctx.strokeStyle = 'rgba(255,255,255,.92)';
    ctx.stroke();
    ctx.restore();
  }

  function draw(frame) {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    // Encuadre base: el área elegida o el cuadro completo.
    const bx = crop ? crop.x * fw : 0;
    const by = crop ? crop.y * fh : 0;
    const bw = crop ? crop.w * fw : fw;
    const bh = crop ? crop.h * fh : fh;
    // Con zoom se ve una parte del encuadre, centrada en el cursor sin salirse del borde.
    const vw = bw / z;
    const vh = bh / z;
    const sx = Math.min(Math.max(bx + cx * bw - vw / 2, bx), bx + bw - vw);
    const sy = Math.min(Math.max(by + cy * bh - vh / 2, by), by + bh - vh);
    // Si el tamaño del cuadro cambia (ventana redimensionada), se ajusta sin deformar.
    const ratio = Math.min(outW / vw, outH / vh);
    const dw = vw * ratio;
    const dh = vh * ratio;
    const dx = (outW - dw) / 2;
    const dy = (outH - dh) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dw < outW - 1 || dh < outH - 1) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);
    }
    if (mirror) ctx.setTransform(-1, 0, 0, 1, outW, 0);
    ctx.drawImage(frame, sx, sy, vw, vh, dx, dy, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // La cámara va encima y no se acerca con el zoom.
    drawCamera();
  }

  async function emit(frame) {
    if (stopped) return;
    if (writing) {
      // Se escribe el último cuadro apenas termine el anterior (no se pierde el final
      // de una animación aunque la página quede quieta después).
      pending = true;
      return;
    }
    writing = true;
    pending = false;
    try {
      const now = performance.now();
      step(lastRender ? Math.min(0.1, (now - lastRender) / 1000) : 1 / fps);
      lastRender = now;
      let out;
      if (!transformed() && frame.displayWidth === outW && frame.displayHeight === outH) {
        out = new VideoFrame(frame, { timestamp: ts() });
      } else {
        draw(frame);
        out = new VideoFrame(canvas, { timestamp: ts() });
      }
      try {
        await writer.write(out);
      } catch (err) {
        // Si no se pudo escribir (la pista ya se cerró), el cuadro se libera aquí.
        try { out.close(); } catch {}
        throw err;
      }
      lastEmit = performance.now();
    } catch (err) {
      if (!stopped) console.debug('[Grabazo] composición', err?.message || err);
    } finally {
      writing = false;
    }
    setTicking(z > 1.001 || animating() || camActive());
    if (pending && last && !stopped) emit(last);
  }

  // Sin ningún cuadro todavía (página quieta al empezar): un cuadro negro del tamaño final.
  async function emitBlank() {
    if (writing || stopped || !canvas) return;
    writing = true;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, outW, outH);
      drawCamera();
      const blank = new VideoFrame(canvas, { timestamp: ts() });
      try {
        await writer.write(blank);
      } catch {
        try { blank.close(); } catch {}
        return;
      }
      lastEmit = performance.now();
    } catch {} finally {
      writing = false;
    }
  }

  function tick() {
    if (stopped) return;
    // Con zoom, movimiento o la cámara encima, se dibuja a los cuadros por segundo del video.
    if (z > 1.001 || animating() || camActive()) {
      if (last) emit(last);
      else emitBlank();
      return;
    }
    // Página quieta: se repite el último cuadro para que la grabación siga avanzando.
    if (performance.now() - lastEmit < 400) return;
    if (last) emit(last);
    else emitBlank();
  }

  // Lee los cuadros de una pista. Si la fuente cambia (la cámara se reconectó), se lee
  // la nueva y la salida sigue siendo la misma pista: la grabación no se corta.
  function read(track) {
    quiet(() => reader?.cancel());
    const own = new MediaStreamTrackProcessor({ track }).readable.getReader();
    reader = own;
    (async () => {
      while (!stopped && reader === own) {
        let frame;
        try {
          ({ value: frame } = await own.read());
        } catch {
          break;
        }
        if (!frame) break;
        if (reader !== own || stopped) { frame.close(); break; }
        if (!canvas) setup(frame.displayWidth, frame.displayHeight);
        const prev = last;
        last = frame;
        prev?.close();
        // Si el reloj ya dibuja a los cuadros por segundo del video (zoom o cámara encima),
        // el cuadro nuevo sale en el próximo tic y no se escribe dos veces.
        if (rate === fps && lastEmit) continue;
        await emit(frame);
      }
    })();
  }
  read(input);
  setTicking(false);

  // Cuadros de la cámara compuesta: se guarda siempre el último.
  function readCamera(track) {
    quiet(() => cam.reader?.cancel());
    const own = new MediaStreamTrackProcessor({ track }).readable.getReader();
    cam.reader = own;
    (async () => {
      while (!stopped && cam.reader === own) {
        let frame;
        try {
          ({ value: frame } = await own.read());
        } catch {
          break;
        }
        if (!frame) break;
        if (cam.reader !== own || stopped) { frame.close(); break; }
        const prev = cam.frame;
        cam.frame = frame;
        prev?.close();
        if (camActive()) setTicking(true);
      }
    })();
  }

  return {
    track: generator,
    ready,
    get size() { return { width: outW, height: outH }; },
    setInput(track) { if (track && !stopped) read(track); },
    // Tamaño de salida sin esperar el primer cuadro (una página quieta puede tardar en
    // mandar imagen).
    prime(width, height) { if (!canvas && width > 0 && height > 0) setup(width, height); },
    zoomTo(level) {
      zt = Math.max(1, Math.min(4, Number(level) || 1));
      if (zt === 1) { tx = 0.5; ty = 0.5; }
      setTicking(true);
    },
    pointer(nx, ny) {
      if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
      tx = Math.min(1, Math.max(0, nx));
      ty = Math.min(1, Math.max(0, ny));
      if (z > 1.001 || zt > 1) setTicking(true);
    },
    get zoom() { return zt; },
    setCamera(track) {
      if (stopped) return;
      if (track) {
        readCamera(track);
        return;
      }
      quiet(() => cam.reader?.cancel());
      cam.reader = null;
      try { cam.frame?.close(); } catch {}
      cam.frame = null;
    },
    camera(layout = {}) {
      if (typeof layout.visible === 'boolean') cam.visible = layout.visible;
      if (layout.shape === 'circle' || layout.shape === 'rect') cam.shape = layout.shape;
      if (typeof layout.mirror === 'boolean') cam.mirror = layout.mirror;
      if (Number.isFinite(layout.x)) cam.tx = Math.min(1, Math.max(0, layout.x));
      if (Number.isFinite(layout.y)) cam.ty = Math.min(1, Math.max(0, layout.y));
      if (Number.isFinite(layout.size)) cam.tsize = Math.min(0.7, Math.max(0.08, layout.size));
      if (layout.instant) { cam.x = cam.tx; cam.y = cam.ty; cam.size = cam.tsize; }
      setTicking(true);
    },
    // Dónde queda la cámara (px del video), para arrastrarla sobre la vista previa.
    get cameraRect() { return canvas && outW > 2 ? camRect(true) : null; },
    get cameraLive() { return camActive(); },
    async thumbnail(width = 480) {
      if (!last) return null;
      try {
        const w = width;
        const h = Math.round((outH / outW) * w) || Math.round(w * 0.5625);
        const c = new OffscreenCanvas(w, h);
        const cctx = c.getContext('2d');
        if (canvas && transformed()) cctx.drawImage(canvas, 0, 0, w, h);
        else cctx.drawImage(last, 0, 0, w, h);
        return await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
      } catch {
        return null;
      }
    },
    stop() {
      stopped = true;
      setTicking(false);
      clockWorker.terminate();
      quiet(() => reader?.cancel());
      quiet(() => cam.reader?.cancel());
      quiet(() => writer.close());
      try { last?.close(); } catch {}
      try { cam.frame?.close(); } catch {}
      last = null;
      cam.frame = null;
      try { generator.stop(); } catch {}
    },
  };
}
