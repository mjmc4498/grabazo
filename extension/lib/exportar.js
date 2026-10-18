// Grabazo — estudio: exportar.
//
//   keptRanges(edit)      partes que quedan tras recortar el inicio y el final y quitar los cortes
//   probe(blob)           contenedor, códecs, tamaño y (opcional) duración exacta
//   canCopy(info, fmt)    ¿se puede pasar a ese formato sin volver a codificar?
//   remux(blob, fmt)      copia el video a un archivo nuevo sin volver a codificarlo (segundos);
//                         de paso corrige la duración y el índice que le faltan a MediaRecorder
//   exportVideo(blob, …)  vuelve a codificar solo las partes que quedan (MP4 o WebM)
//   exportGif(blob, …)    GIF animado de las partes que quedan
//   filmstrip(blob, …)    miniaturas para la línea de tiempo
//   poster(blob)          miniatura JPEG para la biblioteca
//
// Todo se hace en la computadora con WebCodecs (Mediabunny) y gifenc: el video nunca
// sale del equipo. Las funciones largas aceptan `signal` (AbortController) para cancelar.

import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  ALL_FORMATS,
  Mp4OutputFormat,
  WebMOutputFormat,
  Conversion,
  VideoSampleSink,
  AudioSampleSink,
  VideoSampleSource,
  AudioSampleSource,
  EncodedPacketSink,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from './vendor/mediabunny.min.mjs';
import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.esm.js';

const MIN_RANGE = 0.04; // s: partes más cortas que esto no se exportan
const MAX_GAP = 1; // s: lo más que un track (video o audio) se adelanta al otro

// ---------------------------------------------------------------- partes que quedan

// Une cortes que se tocan o se superponen (ordenados por inicio).
export function mergeCuts(cuts = []) {
  const sorted = cuts
    .map((c) => ({ start: Math.min(c.start, c.end), end: Math.max(c.start, c.end) }))
    .filter((c) => c.end - c.start > 0)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.start <= last.end + 1e-3) last.end = Math.max(last.end, c.end);
    else out.push({ ...c });
  }
  return out;
}

// [inicio, final] menos los cortes.
export function keptRanges({ trimStart = 0, trimEnd = 0, cuts = [] }) {
  const out = [];
  let cur = trimStart;
  for (const c of mergeCuts(cuts)) {
    if (c.end <= cur) continue;
    if (c.start >= trimEnd) break;
    if (c.start > cur) out.push({ start: cur, end: Math.min(c.start, trimEnd) });
    cur = Math.max(cur, c.end);
  }
  if (cur < trimEnd) out.push({ start: cur, end: trimEnd });
  return out.filter((r) => r.end - r.start >= MIN_RANGE);
}

export const totalOf = (ranges) => ranges.reduce((sum, r) => sum + (r.end - r.start), 0);

// ---------------------------------------------------------------- utilidades

export const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'ConversionCanceledError';
const abortError = () => new DOMException('canceled', 'AbortError');
const openInput = (blob) => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
export const mimeOf = (format) => ({ mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' })[format] || 'application/octet-stream';

function newOutput(format) {
  const fmt = format === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  return new Output({ format: fmt, target: new BufferTarget() });
}

// Cede el turno para que la página se repinte (no se frena en pestañas de fondo, a
// diferencia de setTimeout).
function yieldNow() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}

function toJpeg(canvas, quality = 0.8) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

// ---------------------------------------------------------------- información del archivo

export async function probe(blob, { duration = false } = {}) {
  const input = openInput(blob);
  try {
    const format = await input.getFormat();
    const mime = format?.mimeType || '';
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    return {
      container: /webm|matroska/.test(mime) ? 'webm' : /mp4|quicktime/.test(mime) ? 'mp4' : '',
      video: v ? await v.getCodec() : null,
      audio: a ? await a.getCodec() : null,
      width: v ? await v.getDisplayWidth() : 0,
      height: v ? await v.getDisplayHeight() : 0,
      duration: duration ? await input.computeDuration() : 0,
    };
  } finally {
    input.dispose();
  }
}

// MP4 con H.264 → MP4, y WebM con VP8/VP9 → WebM: se copian los paquetes tal cual.
export function canCopy(info, format) {
  if (!info) return false;
  if (format === 'mp4') return info.container === 'mp4' && info.video === 'avc' && (!info.audio || ['aac', 'opus', 'mp3'].includes(info.audio));
  if (format === 'webm') return info.container === 'webm' && ['vp8', 'vp9', 'av1'].includes(info.video) && (!info.audio || ['opus', 'vorbis'].includes(info.audio));
  return false;
}

// ---------------------------------------------------------------- copia sin volver a codificar

export async function remux(blob, format, { mute = false, onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const input = openInput(blob);
  const output = newOutput(format);
  let conversion = null;
  const stop = () => conversion?.cancel();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    conversion = await Conversion.init({
      input,
      output,
      showWarnings: false,
      ...(mute ? { audio: { discard: true } } : {}),
    });
    if (!conversion.isValid) throw new Error('remux: conversión no válida');
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    if (signal?.aborted) throw abortError();
    await conversion.execute();
    if (signal?.aborted) throw abortError();
    return new Blob([output.target.buffer], { type: mimeOf(format) });
  } catch (err) {
    if (signal?.aborted || isAbort(err)) throw abortError();
    throw err;
  } finally {
    signal?.removeEventListener('abort', stop);
    input.dispose();
  }
}

// ---------------------------------------------------------------- video editado

async function pickAudio(format, channels, sampleRate) {
  const order = format === 'mp4' ? ['aac', 'opus'] : ['opus'];
  for (const codec of order) {
    if (await canEncodeAudio(codec, { numberOfChannels: channels, sampleRate }).catch(() => false)) return { codec };
    // Los códecs de Chrome suelen aceptar 48 kHz aunque el original use otra frecuencia.
    if (sampleRate !== 48000 && (await canEncodeAudio(codec, { numberOfChannels: channels, sampleRate: 48000 }).catch(() => false))) {
      return { codec, transform: { sampleRate: 48000 } };
    }
  }
  return null;
}

// Evita que un track se adelante demasiado al otro (el muxer tendría que guardar en
// memoria todo lo adelantado para intercalarlo).
function createSync(ids, isAborted) {
  const pos = new Map(ids.map((id) => [id, 0]));
  let waiters = [];
  const min = () => Math.min(...pos.values());
  const release = () => {
    const m = min();
    const still = [];
    for (const w of waiters) (w.t - m <= MAX_GAP || isAborted() ? w.resolve() : still.push(w));
    waiters = still;
  };
  return {
    async at(id, t) {
      pos.set(id, t);
      release();
      if (t - min() > MAX_GAP && !isAborted()) await new Promise((resolve) => waiters.push({ t, resolve }));
    },
    done(id) {
      pos.set(id, Infinity);
      release();
    },
    wake() { for (const w of waiters) w.resolve(); waiters = []; },
  };
}

export async function exportVideo(blob, { format = 'mp4', quality = 'high', ranges, mute = false, onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const total = totalOf(ranges);
  if (!(total > 0)) throw new Error('nothing');
  const input = openInput(blob);
  let output = null;
  let stopped = false; // los tracks dejan de leer (cancelado o falló el otro track)
  let sync = null;
  const onAbort = () => {
    stopped = true;
    sync?.wake();
    output?.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('sin video');
    const at = mute ? null : await input.getPrimaryAudioTrack();
    const width = await vt.getDisplayWidth();
    const height = await vt.getDisplayHeight();
    const ew = even(width);
    const eh = even(height);
    const q = quality === 'medium' ? QUALITY_MEDIUM : QUALITY_HIGH;

    const candidates = format === 'mp4' ? ['avc', 'hevc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'];
    const vcodec = await getFirstEncodableVideoCodec(candidates, { width: ew, height: eh, quality: q });
    if (!vcodec) throw new Error('sin códec de video');

    let audio = null;
    if (at && (await at.canDecode().catch(() => false))) {
      audio = await pickAudio(format, await at.getNumberOfChannels(), await at.getSampleRate());
    }

    output = newOutput(format);
    const videoSource = new VideoSampleSource({
      codec: vcodec,
      quality: q,
      keyFrameInterval: 2,
      sizeChangeBehavior: 'contain',
      ...(ew !== width || eh !== height ? { transform: { width: ew, height: eh } } : {}),
    });
    output.addVideoTrack(videoSource);
    let audioSource = null;
    if (audio) {
      audioSource = new AudioSampleSource({ codec: audio.codec, quality: q, ...(audio.transform ? { transform: audio.transform } : {}) });
      output.addAudioTrack(audioSource);
    }
    await output.start();

    const progress = { v: 0, a: audioSource ? 0 : Infinity };
    let lastReport = 0;
    const report = () => {
      const now = performance.now();
      if (now - lastReport < 120) return;
      lastReport = now;
      onProgress?.(Math.min(0.99, Math.min(progress.v, progress.a) / total));
    };
    sync = createSync(audioSource ? ['v', 'a'] : ['v'], () => stopped);

    // Video: cada cuadro se mueve a la línea de tiempo continua de salida.
    const pumpVideo = async () => {
      const sink = new VideoSampleSink(vt);
      let offset = 0;
      for (const r of ranges) {
        for await (const sample of sink.samples(r.start, r.end)) {
          try {
            if (stopped) break;
            const dur = sample.duration > 0 ? sample.duration : 1 / 30;
            const s = Math.max(r.start, sample.timestamp);
            const e = Math.min(r.end, sample.timestamp + dur);
            if (e - s <= 1e-4) continue;
            const ts = offset + (s - r.start);
            sample.setTimestamp(ts);
            sample.setDuration(e - s);
            await videoSource.add(sample);
            progress.v = ts + (e - s);
            report();
            await sync.at('v', ts);
          } finally {
            sample.close();
          }
        }
        if (stopped) break;
        offset += r.end - r.start;
      }
      progress.v = Infinity;
      if (!stopped) videoSource.close();
    };

    // Audio: las muestras que cruzan un borde se recortan para no desfasar el video.
    const pumpAudio = async () => {
      const sink = new AudioSampleSink(at);
      let offset = 0;
      for (const r of ranges) {
        for await (const sample of sink.samples(r.start, r.end)) {
          let piece = sample;
          try {
            if (stopped) break;
            const rate = sample.sampleRate;
            let from = 0;
            let to = sample.numberOfFrames;
            if (sample.timestamp < r.start) from = Math.round((r.start - sample.timestamp) * rate);
            if (sample.timestamp + sample.duration > r.end) to = Math.round((r.end - sample.timestamp) * rate);
            from = Math.max(0, Math.min(from, sample.numberOfFrames));
            to = Math.max(0, Math.min(to, sample.numberOfFrames));
            if (from >= to) continue;
            if (from > 0 || to < sample.numberOfFrames) piece = sample.trim(from, to);
            if (!piece.numberOfFrames) continue;
            const ts = offset + Math.max(0, piece.timestamp - r.start);
            piece.setTimestamp(ts);
            await audioSource.add(piece);
            progress.a = ts + piece.duration;
            report();
            await sync.at('a', ts);
          } finally {
            if (piece !== sample) piece.close();
            sample.close();
          }
        }
        if (stopped) break;
        offset += r.end - r.start;
      }
      progress.a = Infinity;
      if (!stopped) audioSource.close();
    };

    // Si un track falla, el otro se detiene (y no se queda esperando al primero).
    let failure = null;
    const run = (id, pump) => pump()
      .catch((err) => {
        failure ??= err;
        stopped = true;
        sync.wake();
      })
      .finally(() => sync.done(id));
    await Promise.all([run('v', pumpVideo), ...(audioSource ? [run('a', pumpAudio)] : [])]);
    if (signal?.aborted) throw abortError();
    if (failure) throw failure;

    onProgress?.(0.995);
    await output.finalize();
    if (signal?.aborted) throw abortError();
    onProgress?.(1);
    return new Blob([output.target.buffer], { type: mimeOf(format) });
  } catch (err) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    if (signal?.aborted || isAbort(err)) throw abortError();
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    input.dispose();
  }
}

// ---------------------------------------------------------------- GIF

// Los cuadros se leen en orden (no saltando a cada instante): con los archivos de
// MediaRecorder, que casi no tienen cuadros clave, es lo más rápido y lo más fiable.
export async function exportGif(blob, { ranges, width = 640, fps = 15, onProgress, signal } = {}) {
  if (signal?.aborted) throw abortError();
  const input = openInput(blob);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('sin video');
    const dw = await vt.getDisplayWidth();
    const dh = await vt.getDisplayHeight();
    const w = Math.max(16, Math.min(width, dw || width));
    const h = Math.max(16, Math.round((w * (dh || 9)) / (dw || 16)));

    // Un cuadro cada 1/fps segundos dentro de cada parte que queda.
    const plan = ranges.map((r) => {
      const n = Math.max(1, Math.round((r.end - r.start) * fps));
      return { ...r, times: Array.from({ length: n }, (_, i) => Math.min(r.start + i / fps, r.end - 1e-3)) };
    });
    const totalFrames = plan.reduce((sum, r) => sum + r.times.length, 0);
    if (!totalFrames) throw new Error('nothing');

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const gif = GIFEncoder();
    // El GIF mide los tiempos en centésimas: se reparten para no acumular error.
    const cs = (k) => Math.round(((k + 1) * 100) / fps) - Math.round((k * 100) / fps);
    let k = 0;
    const addFrame = async (sample) => {
      if (sample) sample.draw(ctx, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, w, h, { palette, delay: cs(k) * 10, ...(k === 0 ? { repeat: 0 } : {}) });
      k++;
      onProgress?.(Math.min(0.99, k / totalFrames));
      await yieldNow();
    };

    const sink = new VideoSampleSink(vt);
    for (const r of plan) {
      let i = 0;
      let prev = null;
      for await (const sample of sink.samples(r.start, r.end)) {
        if (signal?.aborted) {
          sample.close();
          break;
        }
        // En el instante times[i] se ve el cuadro anterior a este.
        while (i < r.times.length && r.times[i] < sample.timestamp) {
          await addFrame(prev || sample);
          i++;
        }
        prev?.close();
        prev = sample;
      }
      if (!signal?.aborted) {
        while (i < r.times.length) {
          await addFrame(prev);
          i++;
        }
      }
      prev?.close();
      if (signal?.aborted) throw abortError();
    }
    gif.finish();
    onProgress?.(1);
    return new Blob([gif.bytesView()], { type: 'image/gif' });
  } finally {
    input.dispose();
  }
}

// ---------------------------------------------------------------- miniaturas

// El cuadro que se ve en el segundo `t`.
async function frameAt(sink, t) {
  for await (const sample of sink.samples(t, t + 1e-3)) return sample;
  return null;
}

// Llama a onFrame(i, canvas) con `count` miniaturas repartidas por el video, de
// izquierda a derecha. Lee en orden y solo salta cuando hay un cuadro clave más cerca
// de la siguiente miniatura (así cada cuadro se decodifica a lo más una vez).
export async function filmstrip(blob, { count = 16, duration, height = 90, onFrame, stale = () => false } = {}) {
  const input = openInput(blob);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('sin video');
    if (!(await vt.canDecode())) throw new Error('no se puede decodificar');
    const first = await vt.getFirstTimestamp().catch(() => 0);
    const end = duration > 0 ? duration : await input.computeDuration();
    const span = Math.max(0.1, end - first);
    const times = Array.from({ length: count }, (_, i) => first + ((i + 0.5) * span) / count);
    const dw = await vt.getDisplayWidth();
    const dh = await vt.getDisplayHeight();
    const canvas = new OffscreenCanvas(Math.max(2, Math.round((height * (dw || 16)) / (dh || 9))), height);
    const ctx = canvas.getContext('2d');
    const paint = (i, sample) => {
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      onFrame?.(i, canvas);
    };
    const packets = new EncodedPacketSink(vt);
    const sink = new VideoSampleSink(vt);

    let i = 0;
    while (i < count && !stale()) {
      let prev = null;
      let jumped = false;
      let check = true;
      for await (const sample of sink.samples(times[i])) {
        if (stale()) {
          sample.close();
          break;
        }
        while (i < count && times[i] < sample.timestamp) {
          paint(i, prev || sample);
          i++;
          check = true;
        }
        prev?.close();
        prev = sample;
        if (i >= count) break;
        if (check) {
          check = false;
          const key = await packets.getKeyPacket(times[i], { metadataOnly: true }).catch(() => null);
          if (key && key.timestamp > sample.timestamp + 1e-3) {
            jumped = true;
            break;
          }
        }
      }
      if (!jumped && !stale()) {
        // Se llegó al final del video: el último cuadro sirve para lo que falte.
        while (i < count && prev) {
          paint(i, prev);
          i++;
        }
      }
      prev?.close();
      if (!jumped) break;
    }
  } finally {
    input.dispose();
  }
}

// Miniatura JPEG (para la biblioteca) del cuadro en el segundo `at`.
export async function poster(blob, { at = 1, width = 480 } = {}) {
  const input = openInput(blob);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt || !(await vt.canDecode())) return null;
    const first = await vt.getFirstTimestamp().catch(() => 0);
    const sample = await frameAt(new VideoSampleSink(vt), first + at);
    if (!sample) return null;
    try {
      const dw = await vt.getDisplayWidth();
      const dh = await vt.getDisplayHeight();
      const canvas = new OffscreenCanvas(width, Math.max(2, Math.round((width * (dh || 9)) / (dw || 16))));
      sample.draw(canvas.getContext('2d'), 0, 0, canvas.width, canvas.height);
      return await toJpeg(canvas);
    } finally {
      sample.close();
    }
  } finally {
    input.dispose();
  }
}
