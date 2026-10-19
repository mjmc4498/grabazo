// Grabazo — abre la cámara de la computadora. Si la elegida ya no está conectada, usa la
// predeterminada; los errores se traducen a un código corto para los avisos.
//
//   const stream = await openPcCamera(deviceId, { width: 1280, height: 720, fps: 30 });
//   cameraError(err) → 'denied' | 'notfound' | 'busy' | 'camera'

export async function openPcCamera(deviceId = '', { width = 1280, height = 720, fps = 30 } = {}) {
  const video = { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: deviceId ? { ...video, deviceId: { exact: deviceId } } : video, audio: false });
  } catch (err) {
    if (!deviceId || !['OverconstrainedError', 'NotFoundError'].includes(err.name)) throw err;
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}

export function cameraError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError') return 'notfound';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'camera';
}
