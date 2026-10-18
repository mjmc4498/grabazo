/**
 * Grabazo (grabazo.com) — Interactividad de la landing page
 * Creado por Miguel Mogrovejo · Sin dependencias ni scripts externos
 *
 * 1. Tema claro/oscuro   2. Menú móvil   3. Scrollspy   4. Diálogo de instalación
 * 5. Simulador: dibujo en canvas, foco, clics, zoom, difuminado, burbuja de cámara,
 *    grabación simulada, celular como control remoto y teleprompter.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const html = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ------------------------------------------------------------------
     1. Tema claro / oscuro
     ------------------------------------------------------------------ */
  const themeBtn = $("#theme-toggle");
  const metaTheme = $("#meta-theme-color");

  function syncThemeUI() {
    const light = html.getAttribute("data-theme") === "light";
    if (themeBtn) themeBtn.setAttribute("aria-label", light ? "Cambiar a tema oscuro" : "Cambiar a tema claro");
    if (metaTheme) metaTheme.setAttribute("content", light ? "#f5f5f7" : "#0b0b0c");
  }

  syncThemeUI();
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = html.getAttribute("data-theme") === "light" ? "dark" : "light";
      html.setAttribute("data-theme", next);
      try {
        localStorage.setItem("grabazo-theme", next);
      } catch (_) {
        /* almacenamiento bloqueado: el tema dura solo esta visita */
      }
      syncThemeUI();
    });
  }

  /* ------------------------------------------------------------------
     2. Menú móvil
     ------------------------------------------------------------------ */
  const menuBtn = $("#menu-btn");
  const nav = $("#main-nav");

  if (menuBtn && nav) {
    const setMenu = (open) => {
      nav.classList.toggle("is-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
      menuBtn.setAttribute("aria-label", open ? "Cerrar el menú" : "Abrir el menú");
    };
    menuBtn.addEventListener("click", () => setMenu(!nav.classList.contains("is-open")));
    $$("a", nav).forEach((a) => a.addEventListener("click", () => setMenu(false)));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("is-open")) {
        setMenu(false);
        menuBtn.focus();
      }
    });
    document.addEventListener("click", (e) => {
      if (nav.classList.contains("is-open") && !nav.contains(e.target) && !menuBtn.contains(e.target)) setMenu(false);
    });
  }

  /* ------------------------------------------------------------------
     3. Scrollspy con IntersectionObserver (resalta la sección visible)
     ------------------------------------------------------------------ */
  const navLinks = $$(".nav-links a");

  if ("IntersectionObserver" in window) {
    const ids = new Set(navLinks.map((a) => a.hash.slice(1)));
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = ids.has(entry.target.id) ? entry.target.id : "";
          navLinks.forEach((a) => {
            const on = a.hash === "#" + id;
            a.classList.toggle("is-current", on);
            if (on) a.setAttribute("aria-current", "location");
            else a.removeAttribute("aria-current");
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" }
    );
    $$("main section").forEach((s) => spy.observe(s));
  }

  /* ------------------------------------------------------------------
     4. Diálogo «Cómo instalar el ZIP»
     ------------------------------------------------------------------ */
  const dialog = $("#install-dialog");
  const openDialog = () => {
    if (dialog && typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  };

  $$("[data-open-install]").forEach((b) => b.addEventListener("click", openDialog));
  $$("[data-close-install]").forEach((b) => b.addEventListener("click", () => dialog && dialog.close()));
  if (dialog) {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
  // La descarga empieza sola (atributo download); además mostramos los pasos para cargarla.
  $$("[data-download]").forEach((a) => a.addEventListener("click", () => setTimeout(openDialog, 350)));

  /* ------------------------------------------------------------------
     5. Simulador interactivo
     ------------------------------------------------------------------ */
  const sim = $("#sim");
  if (sim) initSimulator(sim);

  function initSimulator(sim) {
    const stage = $("#sim-stage");
    const zoomLayer = $("#sim-zoom");
    const canvas = $("#sim-canvas");
    const ctx = canvas.getContext("2d");
    const cam = $("#sim-cam");
    const ripples = $("#sim-ripples");
    const countdownEl = $("#sim-countdown");
    const doneEl = $("#sim-done");
    const doneTime = $("#sim-done-time");
    const statusEl = $("#sim-status");
    const phState = $("#ph-state");
    const showBarBtn = $("#sim-showbar");
    const timeEls = [$("#sim-time"), $("#ph-time")];
    const recIcon = $('.sb-rec use');

    const DRAW_TOOLS = new Set(["pen", "highlighter", "arrow", "rect", "ellipse"]);
    const WIDTHS = [3, 6, 11];
    const SHAPES = [["circle", "círculo"], ["rect", "rectángulo"]];
    const SIZES = ["S", "M", "L", "XL"];
    const FILTERS = [["none", "ninguno"], ["bw", "B/N"], ["warm", "cálido"], ["cool", "frío"], ["vivid", "vívido"], ["retro", "retro"]];
    const BGS = [["none", "original"], ["blur", "desenfoque"], ["v1", "virtual 1"], ["v2", "virtual 2"]];

    const state = {
      tool: "cursor",
      color: "#FF7A1A",
      width: 1,
      spot: false,
      clicks: true,
      zoom: false,
      fade: false,
      cam: true,
      mic: true,
      bar: true,
      ptt: false,
      shape: 0,
      size: 1,
      filter: 0,
      bg: 0,
      rec: "idle", // idle | countdown | recording | paused
      elapsed: 0,
      startedAt: 0
    };

    const STATUS = {
      idle: "Listo para grabar",
      countdown: "Cuenta regresiva…",
      recording: "Grabando",
      paused: "En pausa"
    };

    /* ---------- Render: refleja el estado en la barra, los controles y el celular ---------- */
    function render() {
      stage.dataset.tool = state.tool;
      $$("[data-tool]", sim).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === state.tool)));
      $$("[data-color]", sim).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === state.color)));
      $$("[data-width]", sim).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.width) === state.width)));
      $$("[data-toggle]", sim).forEach((b) => b.setAttribute("aria-pressed", String(Boolean(state[b.dataset.toggle]))));

      sim.classList.toggle("is-spot", state.spot);
      sim.classList.toggle("is-zoom", state.zoom);
      sim.classList.toggle("bar-hidden", !state.bar);
      sim.classList.toggle("is-talking", state.ptt);
      sim.classList.toggle("mic-off", !state.mic && !state.ptt);
      showBarBtn.hidden = state.bar;

      cam.classList.toggle("is-off", !state.cam);
      cam.dataset.shape = SHAPES[state.shape][0];
      cam.dataset.size = String(state.size);
      cam.dataset.filter = FILTERS[state.filter][0];
      cam.dataset.bg = BGS[state.bg][0];
      setOut("shape", SHAPES[state.shape][1]);
      setOut("size", SIZES[state.size]);
      setOut("filter", FILTERS[state.filter][1]);
      setOut("bg", BGS[state.bg][1]);

      const recording = state.rec === "recording";
      const paused = state.rec === "paused";
      const busy = recording || paused || state.rec === "countdown";
      sim.classList.toggle("is-recording", recording);
      sim.classList.toggle("is-paused", paused);
      $$('[data-act="pause"]', sim).forEach((b) => {
        b.disabled = !(recording || paused);
        b.setAttribute("aria-pressed", String(paused));
        b.setAttribute("aria-label", paused ? "Reanudar" : "Pausar");
      });
      $$('[data-act="restart"]', sim).forEach((b) => (b.disabled = !(recording || paused)));
      $$('[data-act="rec"]', sim).forEach((b) => b.setAttribute("aria-label", busy ? "Detener la grabación" : "Empezar a grabar"));
      if (recIcon) recIcon.setAttribute("href", busy ? "#i-stop" : "#i-rec");

      if (statusEl.textContent !== STATUS[state.rec]) statusEl.textContent = STATUS[state.rec];
      phState.textContent = STATUS[state.rec];
    }

    function setOut(key, text) {
      $$(`[data-out="${key}"]`, sim).forEach((el) => (el.textContent = text));
    }

    /* ---------- Grabación simulada ---------- */
    let countdownTimer = 0;
    let tickTimer = 0;

    const fmt = (ms) => {
      const s = Math.floor(ms / 1000);
      return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    };
    const elapsedNow = () => (state.rec === "recording" ? state.elapsed + performance.now() - state.startedAt : state.elapsed);
    const paintTime = () => {
      const t = fmt(elapsedNow());
      timeEls.forEach((el) => el && el.textContent !== t && (el.textContent = t));
    };
    const startTick = () => {
      clearInterval(tickTimer);
      tickTimer = setInterval(paintTime, 250);
    };
    const stopTick = () => clearInterval(tickTimer);

    function startRecording() {
      if (state.rec !== "idle") return;
      doneEl.hidden = true;
      state.rec = "countdown";
      render();
      let n = 3;
      const step = () => {
        if (state.rec !== "countdown") return;
        if (n === 0) {
          countdownEl.classList.remove("is-on");
          countdownEl.textContent = "";
          state.rec = "recording";
          state.elapsed = 0;
          state.startedAt = performance.now();
          paintTime();
          startTick();
          tpPlay(true);
          render();
          return;
        }
        const num = document.createElement("span");
        num.textContent = String(n);
        countdownEl.replaceChildren(num);
        countdownEl.classList.add("is-on");
        n -= 1;
        countdownTimer = setTimeout(step, 800);
      };
      step();
    }

    function stopRecording() {
      if (state.rec === "countdown") {
        clearTimeout(countdownTimer);
        countdownEl.classList.remove("is-on");
        countdownEl.textContent = "";
        state.rec = "idle";
        render();
        return;
      }
      if (state.rec === "idle") return;
      const total = elapsedNow();
      stopTick();
      state.rec = "idle";
      state.elapsed = 0;
      paintTime();
      tpPlay(false);
      render();
      doneTime.textContent = "(" + fmt(total) + ")";
      doneEl.hidden = false;
    }

    function togglePause() {
      if (state.rec === "recording") {
        state.elapsed = elapsedNow();
        state.rec = "paused";
        stopTick();
        tpPlay(false);
      } else if (state.rec === "paused") {
        state.startedAt = performance.now();
        state.rec = "recording";
        startTick();
        tpPlay(true);
      } else {
        return;
      }
      paintTime();
      render();
    }

    function restartRecording() {
      if (state.rec !== "recording" && state.rec !== "paused") return;
      state.elapsed = 0;
      state.startedAt = performance.now();
      strokes.length = 0;
      requestRedraw();
      tpReset();
      paintTime();
    }

    const toggleRecording = () => (state.rec === "idle" ? startRecording() : stopRecording());

    /* ---------- Lienzo de dibujo ---------- */
    const strokes = [];
    let current = null;
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    let frame = 0;

    function resizeCanvas() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = w;
      ch = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      redraw();
    }

    const lineWidth = (s) => WIDTHS[s.width] * clamp(cw / 720, 0.55, 1.3) * (s.tool === "highlighter" ? 3.2 : 1);
    const toPx = (p) => [p[0] * cw, p[1] * ch];

    function drawStroke(s, alpha) {
      const pts = s.pts;
      if (!pts.length || alpha <= 0) return;
      const lw = lineWidth(s);
      ctx.save();
      ctx.globalAlpha = alpha * (s.tool === "highlighter" ? 0.38 : 1);
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();

      if (s.tool === "pen" || s.tool === "highlighter") {
        const [x0, y0] = toPx(pts[0]);
        ctx.moveTo(x0, y0);
        if (pts.length === 1) ctx.lineTo(x0 + 0.1, y0);
        for (let i = 1; i < pts.length - 1; i++) {
          const [x1, y1] = toPx(pts[i]);
          const [x2, y2] = toPx(pts[i + 1]);
          ctx.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
        }
        if (pts.length > 1) {
          const [xl, yl] = toPx(pts[pts.length - 1]);
          ctx.lineTo(xl, yl);
        }
        ctx.stroke();
      } else {
        const [ax, ay] = toPx(pts[0]);
        const [bx, by] = toPx(pts[pts.length - 1]);
        if (s.tool === "arrow") {
          const angle = Math.atan2(by - ay, bx - ax);
          const head = Math.max(10, lw * 3.4);
          const len = Math.hypot(bx - ax, by - ay);
          const ex = len > head ? bx - Math.cos(angle) * head * 0.6 : bx;
          const ey = len > head ? by - Math.sin(angle) * head * 0.6 : by;
          ctx.moveTo(ax, ay);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - head * Math.cos(angle - 0.45), by - head * Math.sin(angle - 0.45));
          ctx.lineTo(bx - head * Math.cos(angle + 0.45), by - head * Math.sin(angle + 0.45));
          ctx.closePath();
          ctx.fill();
        } else if (s.tool === "rect") {
          ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
        } else if (s.tool === "ellipse") {
          ctx.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    const FADE_HOLD = 1600;
    const FADE_OUT = 700;

    function redraw() {
      frame = 0;
      if (!cw) return;
      const now = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      let fading = false;
      for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        let alpha = 1;
        if (state.fade) {
          alpha = 1 - clamp((now - s.done - FADE_HOLD) / FADE_OUT, 0, 1);
          if (alpha <= 0) {
            strokes.splice(i, 1);
            continue;
          }
          fading = true;
        }
        s.alpha = alpha;
      }
      strokes.forEach((s) => drawStroke(s, s.alpha));
      if (current) drawStroke(current, 1);
      if (fading) requestRedraw();
    }

    function requestRedraw() {
      if (!frame) frame = requestAnimationFrame(redraw);
    }

    const toNorm = (e) => {
      const r = canvas.getBoundingClientRect();
      return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)];
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (!DRAW_TOOLS.has(state.tool) || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      current = { tool: state.tool, color: state.color, width: state.width, pts: [toNorm(e)] };
      requestRedraw();
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!current) return;
      if (current.tool === "pen" || current.tool === "highlighter") {
        const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
        (events.length ? events : [e]).forEach((ev) => current.pts.push(toNorm(ev)));
      } else {
        current.pts[1] = toNorm(e);
      }
      requestRedraw();
    });

    const endStroke = () => {
      if (!current) return;
      const freehand = current.tool === "pen" || current.tool === "highlighter";
      if (freehand || current.pts.length > 1) {
        current.done = performance.now();
        strokes.push(current);
      }
      current = null;
      requestRedraw();
    };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointercancel", endStroke);

    if ("ResizeObserver" in window) new ResizeObserver(resizeCanvas).observe(canvas);
    else window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    /* ---------- Puntero: foco, zoom que sigue al cursor, clics y difuminado ---------- */
    function trackPointer(e) {
      const r = stage.getBoundingClientRect();
      const x = clamp(e.clientX - r.left, 0, r.width);
      const y = clamp(e.clientY - r.top, 0, r.height);
      stage.style.setProperty("--sx", x + "px");
      stage.style.setProperty("--sy", y + "px");
      if (!current) {
        zoomLayer.style.setProperty("--zx", ((x / r.width) * 100).toFixed(2) + "%");
        zoomLayer.style.setProperty("--zy", ((y / r.height) * 100).toFixed(2) + "%");
      }
      return [x, y];
    }

    stage.addEventListener("pointermove", trackPointer);

    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".sim-cam, .sim-done, .sim-showbar")) return;
      const [x, y] = trackPointer(e);
      if (state.clicks && !DRAW_TOOLS.has(state.tool)) spawnRipple(x, y);
      if (state.tool === "blur") {
        const field = e.target.closest("[data-blurable]");
        if (field) field.classList.toggle("is-blurred");
      }
    });

    function spawnRipple(x, y) {
      const r = document.createElement("span");
      r.style.left = x + "px";
      r.style.top = y + "px";
      ripples.appendChild(r);
      const remove = () => r.remove();
      r.addEventListener("animationend", remove, { once: true });
      setTimeout(remove, 1200);
    }

    /* ---------- Burbuja de cámara arrastrable ---------- */
    let drag = null;

    function placeCam(x, y) {
      const r = stage.getBoundingClientRect();
      const c = cam.getBoundingClientRect();
      const px = clamp(x, 0, Math.max(0, r.width - c.width));
      const py = clamp(y, 0, Math.max(0, r.height - c.height));
      cam.style.setProperty("--cx", ((px / r.width) * 100).toFixed(2) + "%");
      cam.style.setProperty("--cy", ((py / r.height) * 100).toFixed(2) + "%");
    }

    function reclampCam() {
      // Tras cambiar forma o tamaño (hay una transición corta), la burbuja no debe salirse.
      setTimeout(() => {
        const r = stage.getBoundingClientRect();
        const c = cam.getBoundingClientRect();
        if (r.width) placeCam(c.left - r.left, c.top - r.top);
      }, 300);
    }

    cam.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      cam.setPointerCapture(e.pointerId);
      const c = cam.getBoundingClientRect();
      drag = { dx: e.clientX - c.left, dy: e.clientY - c.top };
    });
    cam.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = stage.getBoundingClientRect();
      placeCam(e.clientX - r.left - drag.dx, e.clientY - r.top - drag.dy);
    });
    const endDrag = () => (drag = null);
    cam.addEventListener("pointerup", endDrag);
    cam.addEventListener("pointercancel", endDrag);

    cam.addEventListener("keydown", (e) => {
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const c = cam.getBoundingClientRect();
      const step = r.width * 0.03;
      placeCam(c.left - r.left + m[0] * step, c.top - r.top + m[1] * step);
    });

    /* ---------- Pulsar para hablar (botón del celular) ---------- */
    const ptt = $("#ph-ptt");
    const setPtt = (on) => {
      if (state.ptt === on) return;
      state.ptt = on;
      ptt.setAttribute("aria-pressed", String(on));
      render();
    };
    ptt.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      ptt.setPointerCapture(e.pointerId);
      setPtt(true);
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => ptt.addEventListener(ev, () => setPtt(false)));
    ptt.addEventListener("contextmenu", (e) => e.preventDefault());
    ptt.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        setPtt(true);
      }
    });
    ptt.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") setPtt(false);
    });
    ptt.addEventListener("blur", () => setPtt(false));

    /* ---------- Teleprompter ---------- */
    const tpBox = $("#tp");
    const tpView = $("#tp-view");
    const tpText = $("#tp-text");
    const tpSpeedEl = $("#tp-speed");
    const tpPlayBtn = $('[data-tp="play"]', sim);
    const guionPanel = $("#ph-panel-guion");
    const tp = { playing: false, y: 0, speed: 3, size: 1.15, mirror: false, last: 0, raf: 0 };
    let simVisible = true;

    function tpLoop(t) {
      tp.raf = 0;
      if (!tp.playing) return;
      const dt = tp.last ? Math.min(64, t - tp.last) : 16;
      tp.last = t;
      const height = tpText.scrollHeight;
      if (simVisible && height && !guionPanel.hidden) {
        tp.y += (dt / 1000) * (8 + tp.speed * 8);
        if (tp.y > height - tpView.clientHeight * 0.55) tp.y = 0;
        tpText.style.setProperty("--tp-y", (-tp.y).toFixed(1) + "px");
      }
      tp.raf = requestAnimationFrame(tpLoop);
    }

    function tpPlay(on) {
      tp.playing = on;
      tp.last = 0;
      tpPlayBtn.setAttribute("aria-pressed", String(on));
      tpPlayBtn.querySelector("span").textContent = on ? "Pausar" : "Iniciar";
      tpPlayBtn.querySelector("use").setAttribute("href", on ? "#i-pause" : "#i-play");
      if (on && !tp.raf) tp.raf = requestAnimationFrame(tpLoop);
    }

    function tpReset() {
      tp.y = 0;
      tpText.style.setProperty("--tp-y", "0px");
    }

    function tpAction(action, btn) {
      if (action === "play") tpPlay(!tp.playing);
      else if (action === "slower" || action === "faster") {
        tp.speed = clamp(tp.speed + (action === "faster" ? 1 : -1), 1, 10);
        tpSpeedEl.textContent = String(tp.speed);
      } else if (action === "smaller" || action === "bigger") {
        tp.size = clamp(tp.size + (action === "bigger" ? 0.15 : -0.15), 0.85, 1.75);
        tpText.style.setProperty("--tp-size", tp.size.toFixed(2) + "rem");
      } else if (action === "mirror") {
        tp.mirror = !tp.mirror;
        tpBox.classList.toggle("is-mirror", tp.mirror);
        btn.setAttribute("aria-pressed", String(tp.mirror));
      }
    }

    /* ---------- Pestañas del celular ---------- */
    const phTabs = $$('[role="tab"]', sim);

    function selectTab(tab, focus) {
      phTabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        $("#" + t.getAttribute("aria-controls")).hidden = !on;
      });
      if (focus) tab.focus();
    }

    phTabs.forEach((t, i) => {
      t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        selectTab(phTabs[(i + (e.key === "ArrowRight" ? 1 : -1) + phTabs.length) % phTabs.length], true);
      });
    });

    /* ---------- Clics en cualquier control del simulador (barra, panel o celular) ---------- */
    sim.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !sim.contains(b) || b.disabled) return;
      const d = b.dataset;

      if (d.ptab) {
        selectTab(b, false);
        return;
      }
      if (d.tp) {
        tpAction(d.tp, b);
        return;
      }

      if (d.tool) {
        state.tool = d.tool;
      } else if (d.color) {
        state.color = d.color;
        if (!DRAW_TOOLS.has(state.tool)) state.tool = "pen";
      } else if (d.width) {
        state.width = Number(d.width);
        if (!DRAW_TOOLS.has(state.tool)) state.tool = "pen";
      } else if (d.toggle) {
        state[d.toggle] = !state[d.toggle];
        if (d.toggle === "fade" && state.fade) {
          const now = performance.now();
          strokes.forEach((s) => (s.done = now));
        }
        if (d.toggle === "fade" || d.toggle === "cam") requestRedraw();
      } else if (d.cycle) {
        const lists = { shape: SHAPES, size: SIZES, filter: FILTERS, bg: BGS };
        state[d.cycle] = (state[d.cycle] + 1) % lists[d.cycle].length;
        if (d.cycle === "shape" || d.cycle === "size") reclampCam();
      } else if (d.act) {
        switch (d.act) {
          case "rec":
            toggleRecording();
            break;
          case "pause":
            togglePause();
            break;
          case "restart":
            restartRecording();
            break;
          case "undo":
            strokes.pop();
            requestRedraw();
            break;
          case "clear":
            strokes.length = 0;
            $$(".is-blurred", stage).forEach((el) => el.classList.remove("is-blurred"));
            requestRedraw();
            break;
          case "hidebar":
            state.bar = false;
            break;
          case "showbar":
            state.bar = true;
            break;
          case "close-done":
            doneEl.hidden = true;
            break;
          default:
            return;
        }
      } else {
        return;
      }
      render();
    });

    /* ---------- Atajos de teclado (como en la extensión) cuando el simulador está a la vista ---------- */
    if ("IntersectionObserver" in window) {
      simVisible = false;
      new IntersectionObserver(([entry]) => {
        simVisible = entry.isIntersecting;
      }, { threshold: 0.12 }).observe(sim);
    }

    document.addEventListener("keydown", (e) => {
      if (!simVisible || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "KeyR") toggleRecording();
      else if (e.code === "KeyK") togglePause();
      else if (e.code === "KeyA") state.tool = state.tool === "pen" ? "cursor" : "pen";
      else return;
      e.preventDefault();
      render();
    });

    // Pausa el simulador si la pestaña se oculta (ahorra batería).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.rec === "recording") togglePause();
    });

    reduceMotion.addEventListener?.("change", requestRedraw);
    render();
  }
})();
