// Grabazo — efectos de la cámara: fondo desenfocado o reemplazado (segmentación de
// personas con MediaPipe, en la propia computadora: la imagen no sale de Chrome) y
// filtros de color. Recibe una pista de video y entrega otra ya procesada, cuadro a
// cuadro (MediaStreamTrackProcessor → lienzo → MediaStreamTrackGenerator).
//
//   const fx = createEffects(track, { effect: 'blur', filter: 'warm' });
//   fx.track        → pista procesada (estable aunque cambien los efectos)
//   fx.set({ effect, filter })
//   fx.stop()

const BASE = new URL('./vendor/mediapipe/', import.meta.url).href;

// Filtros de color (CSS de lienzo).
export const FILTERS = {
  none: 'none',
  bw: 'grayscale(1) contrast(1.06)',
  warm: 'sepia(.22) saturate(1.25) hue-rotate(-6deg) brightness(1.02)',
  cool: 'saturate(1.08) hue-rotate(10deg) brightness(1.03) contrast(1.02)',
  vivid: 'saturate(1.55) contrast(1.08)',
  retro: 'sepia(.5) contrast(1.12) brightness(.96) saturate(.85)',
};

// Fondos generados en el momento (sin fotos): degradados suaves con luces.
const BACKGROUNDS = {
  'bg-grabazo': (ctx, w, h) => {
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.82, h * 0.12, Math.max(w, h) * 0.7, 'rgba(255,122,26,.55)');
    glow(ctx, w * 0.1, h * 0.95, Math.max(w, h) * 0.55, 'rgba(255,94,26,.22)');
  },
  'bg-atardecer': (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
    g.addColorStop(0, '#ffb067');
    g.addColorStop(0.5, '#ff5e62');
    g.addColorStop(1, '#6a2bd9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.7, h * 0.3, w * 0.4, 'rgba(255,240,200,.45)');
  },
  'bg-oceano': (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b2a4a');
    g.addColorStop(0.55, '#16627f');
    g.addColorStop(1, '#4fc3d7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.2, h * 0.2, w * 0.45, 'rgba(160,230,255,.35)');
  },
  'bg-bosque': (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, w, 0);
    g.addColorStop(0, '#0f3d24');
    g.addColorStop(0.6, '#2f7a45');
    g.addColorStop(1, '#a3d977');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.8, h * 0.15, w * 0.4, 'rgba(255,255,210,.35)');
  },
  'bg-grafito': (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#34343a');
    g.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.5, h * 0.35, w * 0.55, 'rgba(255,255,255,.08)');
  },
  'bg-estudio': (ctx, w, h) => {
    const g = ctx.createRadialGradient(w * 0.5, h * 0.4, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#c9c9cf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },
};

function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export const needsSegmentation = (effect) => effect === 'blur' || effect === 'blur-strong' || effect in BACKGROUNDS;
export const isPassThrough = ({ effect = 'none', filter = 'none' } = {}) => !needsSegmentation(effect) && (FILTERS[filter] || 'none') === 'none';

// ---------------------------------------------------------------- segmentación (MediaPipe)

let segmenterPromise = null;

export function loadSegmenter() {
  segmenterPromise ??= (async () => {
    const { ImageSegmenter } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset = { wasmLoaderPath: `${BASE}vision_wasm_internal.js`, wasmBinaryPath: `${BASE}vision_wasm_internal.wasm` };
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: `${BASE}selfie_segmenter.tflite`, delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    try {
      return await ImageSegmenter.createFromOptions(fileset, options('GPU'));
    } catch {
      return ImageSegmenter.createFromOptions(fileset, options('CPU'));
    }
  })().catch((err) => {
    console.debug('[Grabazo] efectos de fondo no disponibles:', err?.message || err);
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
}

// ---------------------------------------------------------------- tubería de efectos

const SEG_W = 320;

export function createEffects(input, initial = {}) {
  const processor = new MediaStreamTrackProcessor({ track: input });
  const generator = new MediaStreamTrackGenerator({ kind: 'video' });
  const reader = processor.readable.getReader();
  const writer = generator.writable.getWriter();
  let opts = { effect: 'none', filter: 'none', ...initial };
  let stopped = false;
  let seg = null;
  let segTs = 0;
  let onError = null;

  const out = new OffscreenCanvas(2, 2);
  const octx = out.getContext('2d', { alpha: false });
  const person = new OffscreenCanvas(2, 2);
  const pctx = person.getContext('2d');
  const small = new OffscreenCanvas(SEG_W, 180);
  const sctx = small.getContext('2d', { willReadFrequently: false });
  const mask = new OffscreenCanvas(SEG_W, 180);
  const mctx = mask.getContext('2d');
  let maskData = null;
  let prevMask = null;
  let bg = null;
  let bgKey = '';

  function wantSegmenter() {
    if (!needsSegmentation(opts.effect) || seg) return;
    loadSegmenter().then((s) => { seg = s; }, () => onError?.('effects'));
  }
  wantSegmenter();

  function size(w, h) {
    if (out.width !== w || out.height !== h) {
      out.width = person.width = w;
      out.height = person.height = h;
      bgKey = '';
    }
    const sh = Math.max(2, Math.round((SEG_W * h) / w));
    if (small.height !== sh) {
      small.height = mask.height = sh;
      maskData = null;
      prevMask = null;
    }
  }

  function background(w, h) {
    const key = `${opts.effect}:${w}x${h}`;
    if (bgKey !== key) {
      bg = new OffscreenCanvas(w, h);
      BACKGROUNDS[opts.effect]?.(bg.getContext('2d'), w, h);
      bgKey = key;
    }
    return bg;
  }

  // Máscara de la persona (alfa = probabilidad), suavizada entre cuadros para que el
  // borde no tiemble.
  function updateMask(frame) {
    const sw = small.width;
    const sh = small.height;
    sctx.drawImage(frame, 0, 0, sw, sh);
    let now = performance.now();
    if (now <= segTs) now = segTs + 0.01;
    segTs = now;
    const result = seg.segmentForVideo(small, now);
    try {
      const conf = result.confidenceMasks?.[0]?.getAsFloat32Array();
      if (!conf || conf.length !== sw * sh) return false;
      if (!maskData || maskData.width !== sw || maskData.height !== sh) {
        maskData = new ImageData(sw, sh);
        prevMask = new Float32Array(sw * sh);
      }
      const px = maskData.data;
      for (let i = 0; i < conf.length; i++) {
        const v = prevMask[i] * 0.45 + conf[i] * 0.55;
        prevMask[i] = v;
        // Curva: se aclara el borde sin endurecerlo.
        const a = v < 0.25 ? 0 : v > 0.75 ? 1 : (v - 0.25) * 2;
        const j = i * 4;
        px[j] = px[j + 1] = px[j + 2] = 255;
        px[j + 3] = a * 255;
      }
      mctx.putImageData(maskData, 0, 0);
      return true;
    } finally {
      result.close?.();
    }
  }

  function render(frame) {
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    size(w, h);
    const filter = FILTERS[opts.filter] || 'none';
    const segment = needsSegmentation(opts.effect) && seg && updateMask(frame);

    if (!segment) {
      octx.filter = filter;
      octx.drawImage(frame, 0, 0, w, h);
      octx.filter = 'none';
      return;
    }

    // Persona: la máscara agrandada (suave) y, encima, solo los píxeles de la persona.
    pctx.globalCompositeOperation = 'copy';
    pctx.filter = 'blur(2px)';
    pctx.drawImage(mask, 0, 0, w, h);
    pctx.filter = filter;
    pctx.globalCompositeOperation = 'source-in';
    pctx.drawImage(frame, 0, 0, w, h);
    pctx.globalCompositeOperation = 'source-over';
    pctx.filter = 'none';

    // Fondo: la misma imagen desenfocada o un fondo generado.
    if (opts.effect === 'blur' || opts.effect === 'blur-strong') {
      const r = opts.effect === 'blur' ? Math.max(6, w / 90) : Math.max(12, w / 45);
      octx.filter = `${filter === 'none' ? '' : filter} blur(${r}px)`.trim();
      octx.drawImage(frame, -r * 2, -r * 2, w + r * 4, h + r * 4);
      octx.filter = 'none';
    } else {
      octx.drawImage(background(w, h), 0, 0);
    }
    octx.drawImage(person, 0, 0);
  }

  (async () => {
    while (!stopped) {
      let frame;
      try {
        ({ value: frame } = await reader.read());
      } catch {
        break;
      }
      if (!frame) break;
      try {
        render(frame);
        const next = new VideoFrame(out, { timestamp: frame.timestamp, duration: frame.duration ?? undefined });
        frame.close();
        await writer.write(next);
      } catch (err) {
        try { frame.close(); } catch {}
        if (stopped) break;
        console.debug('[Grabazo] efectos', err?.message || err);
      }
    }
    try { writer.close(); } catch {}
  })();

  return {
    track: generator,
    set(next) {
      opts = { ...opts, ...next };
      wantSegmenter();
    },
    set onerror(fn) { onError = fn; },
    stop() {
      stopped = true;
      try { reader.cancel(); } catch {}
      try { generator.stop(); } catch {}
    },
  };
}
