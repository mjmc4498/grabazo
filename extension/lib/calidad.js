// Grabazo — calidad de la grabación: tamaño máximo según la calidad elegida, tasa de bits
// según el tamaño real y el codificador. Se prefiere el que Chrome hace con la tarjeta de
// video (por hardware): graba sin cargar el procesador. Para saber si hay hardware se
// pregunta a WebCodecs (usa los mismos codificadores que la grabación; Media Capabilities
// no responde para grabaciones).
//
//   await outputLimit('auto', 30)    → { w, h } máximo del video
//   bitrateFor(1920, 1080, 30)       → bits por segundo
//   await chooseEncoder({ format, width, height, fps, bitrate })
//                                    → { mime, codec, hw, heavy }

import { QUALITIES } from '../config.js';

// Contenedor y códec que acepta MediaRecorder, y el códec para WebCodecs (H.264 High: el
// nivel depende del tamaño y los cuadros, ver h264Level).
const MP4 = [
  { mime: 'video/mp4;codecs=avc1.640033,mp4a.40.2', probe: 'avc1.6400', codec: 'H.264' },
  { mime: 'video/mp4;codecs=avc1.4d0033,mp4a.40.2', probe: 'avc1.4d00', codec: 'H.264' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', probe: 'avc1.6400', codec: 'H.264' },
  { mime: 'video/mp4;codecs=avc1,opus', probe: 'avc1.6400', codec: 'H.264' },
];
// Sin hardware, VP8 usa bastante menos procesador que VP9: va primero entre los de software.
const WEBM = [
  { mime: 'video/webm;codecs=vp9,opus', probe: 'vp09.00.10.08', codec: 'VP9', heavy: true },
  { mime: 'video/webm;codecs=vp8,opus', probe: 'vp8', codec: 'VP8' },
];

// Nivel de H.264 que admite ese tamaño y cuadros por segundo (4.1: 1080p30; 5.1: hasta
// 4K30; 5.2: 4K60).
function h264Level(width, height, fps) {
  const rate = Math.ceil(width / 16) * Math.ceil(height / 16) * fps; // macrobloques por segundo
  return rate <= 245_760 ? '28' : rate <= 983_040 ? '33' : '34';
}

const LADDER = ['2160', '1440', '1080', '720'];

const recordable = (list) => list.filter((c) => {
  try { return MediaRecorder.isTypeSupported(c.mime); } catch { return false; }
});

// ¿Lo codifica la tarjeta de video? (MediaRecorder ya dijo que el formato se puede grabar.)
async function probe(c, width, height, fps, bitrate) {
  if (!globalThis.VideoEncoder?.isConfigSupported) return { supported: true, hw: false };
  const codec = c.probe.startsWith('avc1.') ? `${c.probe}${h264Level(width, height, fps)}` : c.probe;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec,
      width: width & ~1,
      height: height & ~1,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
    });
    return { supported: true, hw: !!supported };
  } catch {
    return { supported: true, hw: false };
  }
}

// Tasa de bits para un tamaño y cuadros por segundo (≈ 8 Mb/s en 1080p a 30 cuadros).
export function bitrateFor(width, height, fps = 30) {
  const perFrame = width * height * 0.13 * (fps > 30 ? 0.75 : 1);
  return Math.round(Math.min(35_000_000, Math.max(1_500_000, perFrame * fps)));
}

// El códec para grabar, en el formato pedido (MP4 o WebM): el que Chrome hace por hardware
// si hay; si no, el más liviano por software (VP8 antes que VP9). El otro formato solo se
// usa si este Chrome no puede grabar el pedido.
export async function chooseEncoder({ format = 'auto', width = 1920, height = 1080, fps = 30, bitrate } = {}) {
  const rate = bitrate || bitrateFor(width, height, fps);
  const preferred = recordable(format === 'webm' ? WEBM : MP4);
  const group = preferred.length ? preferred : recordable(format === 'webm' ? MP4 : WEBM);
  const tried = [];
  for (const c of group) {
    const p = await probe(c, width, height, fps, rate);
    const cand = { mime: c.mime, codec: c.codec, hw: p.hw, heavy: !!c.heavy };
    if (p.hw) return cand;
    tried.push(cand);
  }
  return tried.sort((a, b) => Number(a.heavy) - Number(b.heavy))[0] || { mime: '', codec: '', hw: false, heavy: false };
}

// Tamaño máximo del video. «Auto» es 1080p si la tarjeta de video lo codifica; si no,
// 720p (codificar por software cuesta procesador).
export async function outputLimit(quality = 'auto', fps = 30, format = 'auto') {
  if (quality !== 'auto') return QUALITIES[quality] || QUALITIES[1080];
  const enc = await chooseEncoder({ format, width: 1920, height: 1080, fps });
  return enc.hw ? QUALITIES[1080] : QUALITIES[720];
}

// Para el popup y los ajustes: qué tan pesada es una calidad en esta computadora.
export async function qualityReport(quality = 'auto', fps = 30, format = 'auto') {
  const max = await outputLimit(quality, fps, format);
  const enc = await chooseEncoder({ format, width: max.w, height: max.h, fps });
  const label = LADDER.find((k) => QUALITIES[k].h === max.h) || '1080';
  return { ...enc, w: max.w, h: max.h, fps, label };
}
