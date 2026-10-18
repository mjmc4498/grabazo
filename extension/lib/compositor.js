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
//   comp.stop()

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

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

  const clockWorker = new Worker(new URL('./reloj.js', import.meta.url));
  let ticking = false;
  clockWorker.onmessage = () => tick();

  function setTicking(on) {
    if (on === ticking) return;
    ticking = on;
    clockWorker.postMessage(on ? fps : 0);
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

  const animating = () => Math.abs(z - zt) > 0.002 || Math.abs(cx - tx) > 0.001 || Math.abs(cy - ty) > 0.001;
  const transformed = () => !!crop || mirror || z > 1.001 || animating();

  function step(dt) {
    // Suavizado exponencial: no depende de los cuadros por segundo.
    const kz = 1 - Math.exp(-dt / 0.16);
    const kp = 1 - Math.exp(-dt / (z > 1.01 ? 0.22 : 0.08));
    z += (zt - z) * kz;
    if (Math.abs(z - zt) < 0.002) z = zt;
    cx += (tx - cx) * kp;
    cy += (ty - cy) * kp;
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
      await writer.write(out);
    } catch (err) {
      if (!stopped) console.debug('[Grabazo] composición', err?.message || err);
    } finally {
      writing = false;
    }
    setTicking(z > 1.001 || animating());
    if (pending && last && !stopped) emit(last);
  }

  function tick() {
    if (last && !stopped) emit(last);
  }

  // Lee los cuadros de una pista. Si la fuente cambia (la cámara se reconectó), se lee
  // la nueva y la salida sigue siendo la misma pista: la grabación no se corta.
  function read(track) {
    try { reader?.cancel(); } catch {}
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
        await emit(frame);
      }
    })();
  }
  read(input);

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
      try { reader?.cancel(); } catch {}
      try { writer.close(); } catch {}
      try { last?.close(); } catch {}
      last = null;
      try { generator.stop(); } catch {}
    },
  };
}
