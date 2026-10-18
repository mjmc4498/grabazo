#!/usr/bin/env bash
# Copia el paquete de la extensión a la landing page (landing/downloads/) para la
# descarga directa desde grabazo.com. Ejecuta antes ./scripts/build.sh.
#
#   ./scripts/landing.sh                 → landing/downloads/grabazo-chrome-v<versión>.zip
#   cd landing && npx wrangler pages deploy . --project-name grabazo   (publicar)

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])")
ZIP="dist/grabazo-${VERSION}.zip"
[[ -f "$ZIP" ]] || { echo "Falta $ZIP: ejecuta ./scripts/build.sh"; exit 1; }
mkdir -p landing/downloads
cp "$ZIP" "landing/downloads/grabazo-chrome-v${VERSION}.zip"
echo "▸ Landing: landing/downloads/grabazo-chrome-v${VERSION}.zip ($(du -h "$ZIP" | cut -f1))"
if ! grep -q "grabazo-chrome-v${VERSION}.zip" landing/index.html; then
  echo "  ⚠ landing/index.html enlaza otra versión: actualiza el nombre del ZIP, softwareVersion y downloadUrl."
fi
