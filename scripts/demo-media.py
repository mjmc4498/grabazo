#!/usr/bin/env python3
"""Genera la cámara y el micrófono de demostración para las pruebas y las capturas.

Chrome puede simular una cámara con un video MJPEG y un micrófono con un WAV
(--use-file-for-fake-video-capture y --use-file-for-fake-audio-capture). La cámara
muestra la escena de design/demo/escena.html saludando; el micrófono, una voz
sintética para que se muevan los medidores.

    python3 scripts/demo-media.py      → test/out/media/camara.mjpeg y microfono.wav
"""

import io
import math
import struct
import tempfile
import wave
from pathlib import Path

from PIL import Image

from render import ROOT, screenshot

OUT = ROOT / "test" / "out" / "media"
SCENE = ROOT / "design" / "demo" / "escena.html"
STEPS = 12  # posiciones distintas de la mano
REPEAT = 3  # cuadros por posición (Chrome lee el MJPEG a 30 cuadros por segundo)


def camera():
    frames = []
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(STEPS):
            png = Path(tmp) / f"{i}.png"
            screenshot(f"{SCENE.as_uri()}?f={i / STEPS:.4f}", png, 1280, 720)
            buf = io.BytesIO()
            Image.open(png).convert("RGB").save(buf, "JPEG", quality=88)
            frames.append(buf.getvalue())
    path = OUT / "camara.mjpeg"
    path.write_bytes(b"".join(f for f in frames for _ in range(REPEAT)))
    # Un cuadro suelto para las composiciones de la tienda.
    Image.open(io.BytesIO(frames[2])).save(OUT / "camara.jpg", quality=92)
    print("  ", path.relative_to(ROOT), f"({STEPS * REPEAT} cuadros)")


def microphone(seconds=4.0, rate=48000):
    """Sílabas de una voz sintética: tono con armónicos y vibrato, con pausas."""
    samples = []
    syllables = [(0.0, 0.32, 180), (0.4, 0.7, 210), (0.78, 1.15, 165), (1.5, 1.8, 200), (1.9, 2.4, 230), (2.9, 3.3, 175), (3.4, 3.7, 195)]
    for n in range(int(seconds * rate)):
        t = n / rate
        v = 0.0
        for start, end, f0 in syllables:
            if start <= t < end:
                x = (t - start) / (end - start)
                env = math.sin(math.pi * x) ** 0.8
                f = f0 * (1 + 0.03 * math.sin(2 * math.pi * 5.5 * t))
                v += env * sum(math.sin(2 * math.pi * f * k * t) / k ** 1.3 for k in range(1, 7))
        samples.append(int(max(-1, min(1, v * 0.32)) * 32767))
    path = OUT / "microfono.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    print("  ", path.relative_to(ROOT))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("Cámara y micrófono de demostración:")
    camera()
    microphone()
