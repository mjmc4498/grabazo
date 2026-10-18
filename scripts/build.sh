#!/usr/bin/env bash
# Empaqueta la extensión para la Chrome Web Store.
#
#   ./scripts/build.sh          → dist/grabazo-<versión>.zip   (lo que se sube a la tienda)
#                                 dist/grabazo/                (carpeta para «Cargar extensión sin empaquetar»;
#                                                             la ruta no cambia entre versiones)
#   ./scripts/build.sh --crx    → además dist/grabazo-<versión>.crx (instalación fuera de la tienda)
#
# La clave privada del CRX se guarda en keys/grabazo.pem: no la compartas ni la subas a git.

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
ZIP="dist/grabazo-${VERSION}.zip"
mkdir -p dist

echo "▸ Validando la extensión ${VERSION}…"
python3 - <<'PY'
import json, pathlib, re, sys
ext = pathlib.Path("extension")
errors = []
manifest = json.loads((ext / "manifest.json").read_text())

for size, path in {**manifest["icons"], **manifest["action"]["default_icon"]}.items():
    if not (ext / path).exists():
        errors.append(f"falta el ícono {path}")

locales = {p.parent.name: json.loads(p.read_text()) for p in (ext / "_locales").glob("*/messages.json")}
base = set(locales.get(manifest["default_locale"], {}))
for lang, msgs in locales.items():
    if set(msgs) != base:
        errors.append(f"_locales/{lang} no tiene las mismas claves que {manifest['default_locale']}")
    if len(msgs["extDescription"]["message"]) > 132:
        errors.append(f"descripción en {lang} supera 132 caracteres")
    if len(msgs["extName"]["message"]) > 75:
        errors.append(f"nombre en {lang} supera 75 caracteres")

# Bibliotecas de terceros (vendor/): se revisan los sourcemaps; el cargador de MediaPipe
# (Emscripten) se ejecuta bajo la CSP de la extensión, que no permite eval.
for js in [*ext.rglob("*.js"), *ext.rglob("*.mjs")]:
    text = js.read_text()
    if "sourceMappingURL" in text:
        errors.append(f"{js} referencia un sourcemap inexistente")
    if "vendor" not in js.parts and re.search(r"\beval\s*\(|new Function\s*\(", text):
        errors.append(f"{js} usa eval/new Function (prohibido en MV3)")

used = set()
for f in ext.glob("*.html"):
    used |= set(re.findall(r'data-i18n(?:-html|-title|-aria)?="([^"]+)"', f.read_text()))
for f in [*ext.glob("*.js"), *ext.glob("content/*.js"), *ext.glob("lib/*.js")]:
    used |= set(re.findall(r"\b(?:t|msg)\('([A-Za-z0-9_]+)'", f.read_text()))
for key in sorted(used - base):
    errors.append(f"falta el texto «{key}» en _locales")

for path in ["content/capa.js", "content/dibujo.js", "content/efectos.js", "content/camara.js", "lib/relay.js", "lib/compositor.js", "lib/efectos.js", "lib/db.js", "lib/qr.js", "lib/qrcode.mjs", "lib/peerjs.min.js",
             "lib/vendor/mediabunny.min.mjs", "lib/vendor/gifenc.esm.js", "lib/vendor/mediapipe/vision_bundle.mjs", "lib/vendor/mediapipe/vision_wasm_internal.wasm", "lib/vendor/mediapipe/selfie_segmenter.tflite",
             "offscreen.html", "popup.html", "grabador.html", "camara.html", "estudio.html", "options.html", "THIRD_PARTY_NOTICES.txt"]:
    if not (ext / path).exists():
        errors.append(f"falta {path}")

# Copias de conflicto de iCloud («popup 2.js», «_locales 3»): Chrome rechaza las que
# empiezan con «_» y las demás irían al paquete sin usarse.
for f in ext.rglob("*"):
    if re.search(r" \d+(\.[^./]+)?$", f.name):
        errors.append(f"copia duplicada {f.relative_to(ext)} (bórrala; suele dejarla iCloud)")

if errors:
    print("\n".join("  ✗ " + e for e in errors))
    sys.exit(1)
print("  ✓ manifiesto, íconos, textos y scripts correctos")
PY

if command -v node >/dev/null; then
  for f in extension/*.js extension/content/*.js extension/lib/*.js remote/app.js; do node --check "$f"; done
  echo "  ✓ sintaxis JavaScript"
fi

# Si el Escritorio se sincroniza con iCloud, borrar y volver a crear un archivo o una
# carpeta enseguida deja copias de conflicto («_locales 3», «popup 2.js»…) y Chrome no
# carga la extensión. Por eso el ZIP y la carpeta se actualizan en su lugar, sin borrarlos,
# y las copias que ya existan en dist/ (todo es generado) se eliminan.
find dist \( -name '* [0-9]' -o -name '* [0-9].*' \) -prune -exec rm -rf {} + 2>/dev/null || true

(cd extension && zip -qr -X -9 -FS "../$ZIP" . -x '.*' -x '*/.*' -x '__MACOSX/*')
echo "▸ ZIP listo: $ZIP ($(du -h "$ZIP" | cut -f1))"

UNPACKED="dist/grabazo"
mkdir -p "$UNPACKED"
rsync -a --delete --checksum --exclude '.*' extension/ "$UNPACKED/"
if find "$UNPACKED" -name '* [0-9]*' | grep -q .; then
  echo "  ✗ quedaron copias duplicadas en $UNPACKED; vuelve a ejecutar ./scripts/build.sh"
  exit 1
fi
echo "▸ Carpeta para «Cargar extensión sin empaquetar»: $UNPACKED"

if [[ "${1:-}" == "--crx" ]]; then
  CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
  [[ -x "$CHROME" ]] || CHROME="$(command -v google-chrome || command -v chromium || true)"
  [[ -n "$CHROME" ]] || { echo "No se encontró Chrome para empaquetar el CRX"; exit 1; }
  mkdir -p keys
  TMP_PROFILE=$(mktemp -d)
  ARGS=(--pack-extension="$PWD/extension" --user-data-dir="$TMP_PROFILE" --no-message-box)
  [[ -f keys/grabazo.pem ]] && ARGS+=(--pack-extension-key="$PWD/keys/grabazo.pem")
  "$CHROME" "${ARGS[@]}" >/dev/null 2>&1 || true
  rm -rf "$TMP_PROFILE"
  [[ -f extension.pem ]] && mv extension.pem keys/grabazo.pem
  if [[ -f extension.crx ]]; then
    mv extension.crx "dist/grabazo-${VERSION}.crx"
    echo "▸ CRX listo: dist/grabazo-${VERSION}.crx (clave: keys/grabazo.pem)"
  else
    echo "No se pudo generar el CRX"; exit 1
  fi
fi
