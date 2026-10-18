// Grabazo — recibe la cámara (de la computadora o del celular) desde el documento offscreen
// por una conexión WebRTC local (sin servidores: el video no sale de la computadora).
// Lo usan la burbuja de la cámara en la página y el grabador.
//
//   const relay = GrabazoRelay.connect({ kind: 'bubble', onStream, onState, onIdle });
//   relay.stream   → MediaStream estable (sus pistas cambian si se reconecta)
//   relay.close()

(() => {
  'use strict';
  if (globalThis.GrabazoRelay) return;

  const PORT = 'grabazo-relay';

  function connect({ kind = 'bubble', onStream, onState, onIdle } = {}) {
    let port = null;
    let pc = null;
    let closed = false;
    let timer = 0;
    let delay = 600;
    let pending = [];
    const stream = new MediaStream();
    const api = { stream, state: null, close };

    function later() {
      clearTimeout(timer);
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 1.6, 4000);
    }

    function post(msg) {
      try { port?.postMessage(msg); } catch {}
    }

    function open() {
      if (closed) return;
      clearTimeout(timer);
      let p;
      try {
        p = chrome.runtime.connect({ name: PORT });
      } catch {
        // La extensión se actualizó o se desactivó: esta página ya no puede usarla.
        return;
      }
      port = p;
      p.onMessage.addListener((m) => { if (port === p) onMessage(m); });
      p.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (port !== p) return;
        port = null;
        teardown();
        setState(null);
        if (closed) return;
        onIdle?.();
        later();
      });
      p.postMessage({ t: 'join', kind });
    }

    function setState(s) {
      api.state = s;
      onState?.(s);
    }

    function teardown() {
      if (pc) {
        try { pc.close(); } catch {}
        pc = null;
      }
      pending = [];
      for (const t of stream.getTracks()) stream.removeTrack(t);
    }

    function attach(track) {
      for (const t of stream.getTracks()) if (t.kind === track.kind && t !== track) stream.removeTrack(t);
      if (!stream.getTracks().includes(track)) stream.addTrack(track);
      onStream?.(stream, track);
    }

    // Sin búfer extra: cada cuadro se muestra apenas se decodifica (sin el «suavizado»
    // de Chrome, que agrega un cuadro de espera).
    function lowLatency(receiver) {
      try { if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = 0; } catch {}
      try { if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0; } catch {}
    }

    async function onOffer(sdp) {
      teardown();
      const p = new RTCPeerConnection({ iceServers: [] });
      pc = p;
      p.ontrack = (e) => {
        if (pc !== p) return;
        lowLatency(e.receiver);
        attach(e.track);
      };
      p.onicecandidate = (e) => { if (e.candidate && pc === p) post({ t: 'ice', c: e.candidate.toJSON() }); };
      p.onconnectionstatechange = () => {
        if (pc === p && p.connectionState === 'failed') post({ t: 'restart' });
      };
      try {
        await p.setRemoteDescription(sdp);
        for (const c of pending.splice(0)) p.addIceCandidate(c).catch(() => {});
        await p.setLocalDescription(await p.createAnswer());
        if (pc === p) post({ t: 'answer', sdp: p.localDescription.toJSON() });
      } catch {
        if (pc === p) post({ t: 'restart' });
      }
    }

    function onMessage(m) {
      if (!m || typeof m !== 'object') return;
      switch (m.t) {
        case 'offer':
          delay = 600;
          onOffer(m.sdp);
          break;
        case 'ice':
          if (pc?.remoteDescription) pc.addIceCandidate(m.c).catch(() => {});
          else pending.push(m.c);
          break;
        case 'state':
          setState(m.state || null);
          break;
        case 'reset':
          teardown();
          break;
        case 'bye':
          teardown();
          setState(null);
          break;
      }
    }

    function close() {
      closed = true;
      clearTimeout(timer);
      teardown();
      try { port?.disconnect(); } catch {}
      port = null;
    }

    open();
    return api;
  }

  Object.defineProperty(globalThis, 'GrabazoRelay', { value: Object.freeze({ connect }) });
})();
