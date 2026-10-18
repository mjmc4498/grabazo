// Grabazo — reloj en un Worker. En una pestaña en segundo plano Chrome frena los
// temporizadores a uno por segundo; en un Worker no. El grabador lo usa para animar el
// zoom aunque la página grabada esté quieta.

let timer = 0;

self.onmessage = (e) => {
  clearInterval(timer);
  const fps = Number(e.data) || 0;
  if (fps > 0) timer = setInterval(() => self.postMessage(performance.now()), 1000 / fps);
};
