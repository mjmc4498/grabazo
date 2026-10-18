#!/usr/bin/env python3
"""Genera los íconos PNG y las imágenes de la Chrome Web Store de Grabazo.

Usa Google Chrome en modo headless para renderizar SVG/HTML y Pillow para
reescalar con alta calidad.

    python3 scripts/render.py            # íconos + imágenes de la tienda
    python3 scripts/render.py icons      # solo íconos
    python3 scripts/render.py store      # solo imágenes de la tienda
"""

import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "design"
EXT_ICONS = ROOT / "extension" / "icons"
REMOTE = ROOT / "remote"
STORE = ROOT / "store"

CHROME_CANDIDATES = [
    os.environ.get("CHROME_BIN", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    shutil.which("google-chrome") or "",
    shutil.which("chromium") or "",
]
CHROME = next((c for c in CHROME_CANDIDATES if c and Path(c).exists()), None)


def screenshot(url: str, out: Path, width: int, height: int, scale: float = 1, transparent: bool = False):
    if not CHROME:
        sys.exit("No se encontró Google Chrome. Define CHROME_BIN.")
    with tempfile.TemporaryDirectory() as profile:
        args = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={profile}",
            f"--force-device-scale-factor={scale}",
            f"--window-size={width},{height}",
            "--virtual-time-budget=4000",
            "--allow-file-access-from-files",
            f"--screenshot={out}",
        ]
        if transparent:
            args.append("--default-background-color=00000000")
        args.append(url)
        # Chrome sin interfaz a veces termina con error al arrancar (sobre todo si hay
        # otro Chrome de pruebas abierto): se reintenta un par de veces.
        for attempt in range(3):
            done = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if done.returncode == 0 and out.exists():
                break
            time.sleep(1.5)
        else:
            done.check_returncode()
    img = Image.open(out)
    expected = (round(width * scale), round(height * scale))
    if img.size != expected:
        img = img.crop((0, 0, *expected))
        img.save(out)


def render_svg(svg: Path, size: int) -> Image.Image:
    """Renderiza un SVG a `size` px usando Chrome."""
    with tempfile.TemporaryDirectory() as tmp:
        html = Path(tmp) / "icon.html"
        html.write_text(
            "<!doctype html><html><head><style>html,body{margin:0;background:transparent}"
            f"img{{display:block;width:{size}px;height:{size}px}}</style></head>"
            f'<body><img src="{svg.as_uri()}"></body></html>'
        )
        png = Path(tmp) / "icon.png"
        screenshot(html.as_uri(), png, size, size, transparent=True)
        return Image.open(png).convert("RGBA").copy()


def icons():
    EXT_ICONS.mkdir(parents=True, exist_ok=True)
    big = render_svg(DESIGN / "logo.svg", 1024)
    small = render_svg(DESIGN / "logo-small.svg", 1024)
    maskable = render_svg(DESIGN / "logo-maskable.svg", 1024)

    def save(img: Image.Image, size: int, path: Path):
        img.resize((size, size), Image.LANCZOS).save(path, optimize=True)
        print("  ", path.relative_to(ROOT))

    for size in (16, 32):
        save(small, size, EXT_ICONS / f"icon-{size}.png")
    for size in (48, 128):
        save(big, size, EXT_ICONS / f"icon-{size}.png")

    STORE.mkdir(parents=True, exist_ok=True)
    save(big, 128, STORE / "icon-128.png")

    # Celular (PWA / pantalla de inicio)
    save(maskable, 180, REMOTE / "apple-touch-icon.png")
    save(big, 192, REMOTE / "icon-192.png")
    save(big, 512, REMOTE / "icon-512.png")
    save(maskable, 512, REMOTE / "icon-maskable-512.png")

    # Favicon clásico (.ico con 16, 32 y 48 px) para navegadores y marcadores.
    ico = REMOTE / "favicon.ico"
    small.resize((48, 48), Image.LANCZOS).save(ico, sizes=[(16, 16), (32, 32), (48, 48)])
    print("  ", ico.relative_to(ROOT))


STORE_PAGES = [
    # (html, salida, ancho, alto)
    ("promo-small.html", "promo-small-440x280.png", 440, 280),
    ("promo-marquee.html", "promo-marquee-1400x560.png", 1400, 560),
    ("shot-1.html", "screenshots/1-graba-pestana-ventana-o-pantalla.png", 1280, 800),
    ("shot-2.html", "screenshots/2-dibuja-y-anota-mientras-grabas.png", 1280, 800),
    ("shot-3.html", "screenshots/3-tu-celular-es-el-control-remoto.png", 1280, 800),
    ("shot-4.html", "screenshots/4-teleprompter-y-camara-del-celular.png", 1280, 800),
    ("shot-5.html", "screenshots/5-recorta-y-exporta-mp4-webm-gif.png", 1280, 800),
]


# Las composiciones usan capturas reales (design/store/captures) y se abren desde el
# servidor local para que carguen igual que en el navegador.
STORE_BASE = os.environ.get("STORE_BASE", "http://localhost:8769")


def store_url(src: Path) -> str:
    url = f"{STORE_BASE}/{src.relative_to(ROOT).as_posix()}"
    try:
        urllib.request.urlopen(url, timeout=2)
        return url
    except Exception:
        print(f"   (sin servidor en {STORE_BASE}: ejecuta «npm run serve»; se usa file://)")
        return src.as_uri()


def store():
    (STORE / "screenshots").mkdir(parents=True, exist_ok=True)
    for html, out, w, h in STORE_PAGES:
        src = DESIGN / "store" / html
        if not src.exists():
            continue
        dest = STORE / out
        with tempfile.TemporaryDirectory() as tmp:
            hi = Path(tmp) / "hi.png"
            # Se renderiza al doble y se reduce: texto más nítido.
            screenshot(store_url(src), hi, w, h, scale=2)
            Image.open(hi).convert("RGB").resize((w, h), Image.LANCZOS).save(dest, optimize=True)
        print("  ", dest.relative_to(ROOT))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("all", "icons"):
        print("Íconos:")
        icons()
    if what in ("all", "store"):
        print("Imágenes de la tienda:")
        store()
