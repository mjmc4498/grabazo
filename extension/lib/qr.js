// Grabazo — código QR como trazado SVG.
// Módulos cuadrados y unidos por filas: se ve nítido a cualquier tamaño y se lee rápido
// con la cámara del celular. Lo usan el popup y los ajustes.

import qrcode from './qrcode.mjs';

export function qrPath(text, level = 'M') {
  const qr = qrcode(0, level);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      d += `M${start} ${r}h${c - start}v1h${start - c}z`;
    }
  }
  return { n, d };
}

// SVG completo (con margen de 2 módulos) para <img>, descargas y páginas.
export function qrSvg(text, { color = '#0b0b0c', background = 'none', margin = 2 } = {}) {
  const { n, d } = qrPath(text);
  const size = n + margin * 2;
  const bg = background === 'none' ? '' : `<rect x="${-margin}" y="${-margin}" width="${size}" height="${size}" fill="${background}"/>`;
  // style: los estilos de los íconos de las páginas (stroke) no deben engrosar los módulos.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${size} ${size}" shape-rendering="crispEdges" style="stroke:none">${bg}<path fill="${color}" d="${d}"/></svg>`;
}
