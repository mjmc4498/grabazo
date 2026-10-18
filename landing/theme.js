/* Grabazo · aplica el tema guardado (o el del sistema) antes de pintar la página.
   Va en un archivo aparte para cumplir la CSP (sin scripts en línea). */
(function () {
  var t = null;
  try { t = localStorage.getItem("grabazo-theme"); } catch (e) {}
  if (t !== "light" && t !== "dark") {
    t = window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", t);
})();
