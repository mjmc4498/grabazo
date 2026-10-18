#!/usr/bin/env python3
"""Genera presentacion/grabazo.pptx con capturas reales del producto.

Requiere python-pptx y Pillow (pip install python-pptx pillow). Las imágenes salen de
presentacion/img, que llena scripts/capture-store.mjs con capturas reales de la
extensión, el celular, el estudio y la página de ejemplo grabándose con la capa encima.

    python3 scripts/presentacion.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "presentacion" / "img"
OUT = ROOT / "presentacion" / "grabazo.pptx"
GEN = IMG / "generadas"
GEN.mkdir(parents=True, exist_ok=True)

BG = RGBColor(0x0B, 0x0B, 0x0C)
CARD = RGBColor(0x18, 0x18, 0x1B)
CARD2 = RGBColor(0x22, 0x22, 0x26)
TEXT = RGBColor(0xF5, 0xF5, 0xF7)
MUTED = RGBColor(0xA1, 0xA1, 0xA6)
ACCENT = RGBColor(0xFF, 0x7A, 0x1A)
FONT = "Arial"

# ---------------------------------------------------------------- imágenes

def fondo():
    path = GEN / "fondo.png"
    w, h = 1920, 1080
    base = Image.new("RGB", (w, h), (11, 11, 12))
    glow = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(glow)
    d.ellipse((1150, 520, 2250, 1400), fill=120)
    d.ellipse((-400, -500, 600, 300), fill=40)
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    cyan = Image.new("RGB", (w, h), (255, 122, 26))
    base = Image.composite(cyan, base, glow.point(lambda v: int(v * 0.3)))
    base.save(path)
    return path


def redondear(src, dest, radio):
    im = Image.open(src).convert("RGBA")
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width - 1, im.height - 1), radius=radio, fill=255)
    im.putalpha(mask)
    im.save(dest)
    return dest


def celular(nombre):
    """Pantalla del celular con bordes redondeados y marco oscuro."""
    dest = GEN / f"{nombre}-marco.png"
    pantalla = Image.open(IMG / f"{nombre}.png").convert("RGBA")
    pantalla = pantalla.resize((pantalla.width * 1170 // pantalla.width, pantalla.height * 1170 // pantalla.width), Image.LANCZOS)
    sw, sh = pantalla.size
    marco = 34
    w, h = sw + marco * 2, sh + marco * 2
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    cuerpo = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(cuerpo)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=150, fill=(26, 26, 29, 255), outline=(70, 70, 76, 255), width=3)
    out.alpha_composite(cuerpo)
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=118, fill=255)
    pantalla.putalpha(mask)
    out.alpha_composite(pantalla, (marco, marco))
    out.save(dest)
    return dest


# ---------------------------------------------------------------- utilidades de diapositivas

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]
FONDO = fondo()


def nueva():
    s = prs.slides.add_slide(BLANK)
    s.shapes.add_picture(str(FONDO), 0, 0, prs.slide_width, prs.slide_height)
    return s


def texto(s, x, y, w, h, contenido, size=16, color=TEXT, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, spacing=None, line=1.15):
    box = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    parrafos = contenido if isinstance(contenido, list) else [contenido]
    for i, p_text in enumerate(parrafos):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.line_spacing = line
        if i:
            p.space_before = Pt(size * 0.5)
        run = p.add_run()
        run.text = p_text
        f = run.font
        f.name = FONT
        f.size = Pt(size)
        f.bold = bold
        f.color.rgb = color
        if spacing is not None:
            rPr = run._r.get_or_add_rPr()
            rPr.set("spc", str(spacing))
    return box


def cabecera(s, kicker, titulo, y=0.62, w=11.8, size=36):
    texto(s, 0.7, y, 8, 0.3, kicker.upper(), size=12, color=ACCENT, bold=True, spacing=200)
    texto(s, 0.7, y + 0.38, w, 1.2, titulo, size=size, bold=True, line=1.05)


def tarjeta(s, x, y, w, h, titulo, cuerpo, numero=None, color=CARD):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.adjustments[0] = 0.08
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    shp.shadow.inherit = False
    top = y + 0.3
    if numero is not None:
        c = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x + 0.3), Inches(top), Inches(0.42), Inches(0.42))
        c.fill.solid()
        c.fill.fore_color.rgb = ACCENT
        c.line.fill.background()
        tf = c.text_frame
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = str(numero)
        r.font.size = Pt(14)
        r.font.bold = True
        r.font.name = FONT
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        top += 0.62
    # Arial negrita de 17 pt: unos 6 caracteres por pulgada. Si el título ocupa dos
    # líneas, el texto empieza más abajo.
    lineas = 2 if len(titulo) > (w - 0.6) * 6.2 else 1
    texto(s, x + 0.3, top, w - 0.6, 0.3 * lineas + 0.2, titulo, size=17, bold=True, line=1.05)
    cuerpo_y = top + 0.18 + 0.3 * lineas
    texto(s, x + 0.3, cuerpo_y, w - 0.6, h - (cuerpo_y - y) - 0.2, cuerpo, size=13, color=MUTED, line=1.25)
    return shp


def foto(s, path, x, y, w=None, h=None):
    kw = {}
    if w is not None:
        kw["width"] = Inches(w)
    if h is not None:
        kw["height"] = Inches(h)
    return s.shapes.add_picture(str(path), Inches(x), Inches(y), **kw)


def lista(s, x, y, w, items, size=15, gap=0.62):
    for i, (titulo, detalle) in enumerate(items):
        yy = y + i * gap
        dot = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(x), Inches(yy + 0.09), Inches(0.12), Inches(0.12))
        dot.fill.solid()
        dot.fill.fore_color.rgb = ACCENT
        dot.line.fill.background()
        texto(s, x + 0.3, yy, w - 0.3, 0.3, titulo, size=size, bold=True)
        texto(s, x + 0.3, yy + 0.27, w - 0.3, 0.3, detalle, size=size - 3, color=MUTED)


# ---------------------------------------------------------------- imágenes preparadas

phones = {n: celular(n) for n in ["phone-control", "phone-guion", "phone-camara"]}
r = lambda n, radio=36: redondear(IMG / f"{n}.png", GEN / f"{n}-r.png", radio)
dibujos = r("grabando-dibujos")
foco = r("grabando-foco")
difuminar = r("grabando-difuminar")
estudio = r("estudio", 28)
biblioteca = r("biblioteca", 28)
popup = r("popup", 34)
popup_grabando = r("popup-grabando", 34)
popup_qr = r("popup-qr", 34)
bienvenida = r("options", 28)

# ---------------------------------------------------------------- 1. portada

s = nueva()
foto(s, IMG / "logo-512.png", 0.7, 1.55, w=1.25)
texto(s, 0.7, 3.0, 7.4, 1.1, "Grabazo", size=66, bold=True)
texto(s, 0.7, 4.15, 7.2, 1.2, "Graba tu pantalla, tu cámara y tus anotaciones. Tu celular es el control remoto.", size=24, color=MUTED, line=1.2)
texto(s, 0.7, 6.55, 7, 0.4, "Miguel Mogrovejo · Octubre de 2026", size=13, color=MUTED)
foto(s, phones["phone-control"], 9.15, 0.55, h=6.4)

# ---------------------------------------------------------------- 2. el reto

s = nueva()
cabecera(s, "El reto", "Grabar un buen tutorial no debería ser difícil")
for i, (t, c) in enumerate([
    ("Herramientas a medias", "Una app para grabar, otra para la cámara, otra para dibujar y otra para recortar."),
    ("Límites y marcas de agua", "Cinco minutos gratis, un logo encima y una cuenta obligatoria."),
    ("Atado al mouse", "Para pausar, señalar o hacer zoom hay que soltar lo que estás explicando."),
    ("Sin guion a la vista", "Leer las notas en la misma pantalla se nota en el video."),
]):
    tarjeta(s, 0.7 + i * 3.03, 2.25, 2.83, 3.6, t, c, numero=i + 1)

# ---------------------------------------------------------------- 3. la solución

s = nueva()
cabecera(s, "La solución", "Todo en una extensión de Chrome", w=6.0)
texto(s, 0.7, 2.55, 4.9, 1.3, "Grabazo graba, anota y edita desde el navegador. Y con un QR, tu celular se vuelve control remoto, teleprompter y cámara.", size=16, color=MUTED, line=1.3)
lista(s, 0.7, 3.95, 4.9, [
    ("Sin límites ni marcas de agua", "Gratis, sin cuentas; los videos quedan en tu computadora."),
    ("Anota mientras grabas", "Dibujo, zoom, foco de luz y difuminar en vivo."),
    ("Tu celular al mando", "Control remoto, guion y cámara, sin instalar nada."),
], gap=0.78)
foto(s, dibujos, 6.25, 1.5, w=6.55)
foto(s, phones["phone-control"], 5.65, 3.2, h=4.0)

# ---------------------------------------------------------------- 4. cómo se usa

s = nueva()
cabecera(s, "Cómo se usa", "Tres pasos y estás grabando")
for i, (t, c) in enumerate([
    ("Elige qué grabar", "Haz clic en Grabazo (o Alt+Shift+G): pestaña, área, ventana, pantalla o solo cámara."),
    ("Graba y anota", "Pulsa Grabar (Alt+Shift+R). Dibuja, haz zoom o enciende el foco desde la barra o tu celular."),
    ("Recorta y exporta", "Al detener se abre el estudio: recorta, corta partes y exporta en MP4, WebM o GIF."),
]):
    tarjeta(s, 0.7 + i * 2.6, 2.25, 2.45, 4.1, t, c, numero=i + 1)
foto(s, popup, 8.95, 0.55, h=6.5)

# ---------------------------------------------------------------- 5. modos y audio

s = nueva()
cabecera(s, "Captura y audio", "Graba exactamente lo que quieres mostrar", w=6.4)
lista(s, 0.7, 2.35, 6.0, [
    ("Pestaña, área, ventana, pantalla o solo cámara", "Hasta 4K y 60 cuadros por segundo, en MP4 o WebM."),
    ("Micrófono y sonido a la vez", "La voz y el audio de la pestaña o del sistema, en una pista."),
    ("Pulsar para hablar", "El micrófono graba solo mientras mantienes una tecla o «Hablar» en el celular."),
    ("Cuenta regresiva y límite", "Pausa, reinicia o descarta; aviso 10 segundos antes del límite."),
], gap=0.88)
foto(s, popup_grabando, 7.0, 0.55, h=6.5)
foto(s, popup, 10.4, 1.2, h=5.6)

# ---------------------------------------------------------------- 6. cámara

s = nueva()
cabecera(s, "Burbuja de la cámara", "Tu cara, donde la quieras", w=6.0)
lista(s, 0.7, 2.35, 5.4, [
    ("Flotante y arrastrable", "Círculo o rectángulo, cuatro tamaños y modo espejo."),
    ("Fondos y desenfoque", "Separa a la persona del fondo en la propia computadora."),
    ("Filtros de color", "Blanco y negro, cálido, frío, vívido y retro."),
    ("Sobre todas las apps", "Ventana flotante al grabar la pantalla completa."),
], gap=0.88)
foto(s, dibujos, 6.4, 1.9, w=6.4)

# ---------------------------------------------------------------- 7. dibujo

s = nueva()
cabecera(s, "Dibuja y anota", "Señala lo importante sin pausar", w=7.0)
foto(s, dibujos, 0.7, 2.2, w=7.4)
lista(s, 8.45, 2.3, 4.3, [
    ("Lápiz y resaltador", "Trazos suaves, nítidos en cualquier pantalla."),
    ("Flechas y formas", "Rectángulos y círculos (Shift: perfectos)."),
    ("Texto", "Un clic y escribe sobre la página."),
    ("Borrador y deshacer", "Borra un trazo o todo; Ctrl+Z deshace."),
    ("Tinta que se desvanece", "Los dibujos se borran solos si quieres."),
], gap=0.85)

# ---------------------------------------------------------------- 8. cursor y pantalla

s = nueva()
cabecera(s, "Cursor y pantalla", "Que todos sigan lo que haces")
foto(s, foco, 0.7, 2.25, w=5.85)
foto(s, difuminar, 6.95, 2.25, w=5.85)
texto(s, 0.7, 5.85, 5.85, 1.0, ["Foco de luz, clics y zoom", "Oscurece el resto, resalta cada clic y acerca la imagen siguiendo al cursor."], size=14, color=MUTED, line=1.25)
texto(s, 6.95, 5.85, 5.85, 1.0, ["Difuminar datos sensibles", "Un clic sobre un elemento o arrastra una zona, en tiempo real."], size=14, color=MUTED, line=1.25)

# ---------------------------------------------------------------- 9. celular: control remoto

s = nueva()
cabecera(s, "Tu celular · control remoto", "Graba sin tocar el mouse", w=6.4)
lista(s, 0.7, 2.35, 5.6, [
    ("Escanea el QR", "Sin apps ni cuentas: se abre una página en el navegador."),
    ("Grabar, pausar, reiniciar", "Con el tiempo de grabación a la vista."),
    ("Herramientas y colores", "Elige lápiz, flecha, texto o borrador, y el color."),
    ("Zoom, foco, clics y barra", "Actívalos mientras explicas, desde tu mano."),
    ("Hablar", "Mantén el botón para que el micrófono grabe tu voz."),
], gap=0.82)
foto(s, phones["phone-control"], 7.4, 0.55, h=6.5)
foto(s, popup_qr, 10.55, 1.0, h=5.6)

# ---------------------------------------------------------------- 10. teleprompter y cámara del celular

s = nueva()
cabecera(s, "Tu celular · guion y cámara", "Lee tu guion y grábate con el celular", w=6.0)
lista(s, 0.7, 2.35, 5.4, [
    ("Teleprompter", "Tu guion con desplazamiento automático que empieza al grabar."),
    ("A tu medida", "Velocidad, tamaño de letra y modo espejo para vidrio."),
    ("Edítalo en cualquier lado", "En los ajustes de Grabazo o en el mismo celular."),
    ("La cámara del celular", "Como burbuja de la grabación, con su micrófono."),
], gap=0.88)
foto(s, phones["phone-guion"], 6.6, 0.55, h=6.5)
foto(s, phones["phone-camara"], 9.75, 0.55, h=6.5)

# ---------------------------------------------------------------- 11. estudio

s = nueva()
cabecera(s, "Estudio", "Recorta y exporta en segundos", w=7.2)
foto(s, estudio, 0.7, 2.2, w=7.4)
lista(s, 8.45, 2.3, 4.3, [
    ("Recortar y cortar", "El inicio, el final y partes del medio."),
    ("Quitar el audio", "Exporta solo la imagen."),
    ("MP4, WebM o GIF", "Procesado en tu computadora con WebCodecs."),
    ("Al instante", "Sin cambios, solo se copia el video."),
    ("Mis grabaciones", "Todo guardado y recuperable."),
], gap=0.85)

# ---------------------------------------------------------------- 12. cómo funciona

s = nueva()
cabecera(s, "Cómo funciona", "Todo pasa en tu computadora")


def nodo(x, y, w, h, titulo, detalle, color=CARD):
    tarjeta(s, x, y, w, h, titulo, detalle, color=color)


nodo(0.7, 2.5, 3.4, 2.2, "Tu celular", "Página web: control remoto, guion y cámara por WebRTC directo y cifrado.")
nodo(4.95, 2.5, 3.4, 2.2, "Extensión", "Captura, mezcla el audio, compone el zoom y el área, y guarda por partes.")
nodo(9.2, 2.5, 3.4, 2.2, "Estudio", "Recorta y exporta con WebCodecs: nada se sube a internet.")
for x in (4.15, 8.4):
    a = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(x), Inches(3.35), Inches(0.75), Inches(0.45))
    a.fill.solid()
    a.fill.fore_color.rgb = ACCENT
    a.line.fill.background()
texto(s, 0.7, 5.0, 11.9, 0.4, "Captura con tabCapture y desktopCapture · MediaRecorder (H.264 o VP9) · segmentación de personas con MediaPipe en la computadora", size=13, color=MUTED, align=PP_ALIGN.CENTER)
nodo(3.2, 5.5, 6.9, 1.5, "Si Chrome se cierra a la mitad", "Cada segundo se guarda en la computadora: el estudio recupera lo grabado.", color=CARD2)

# ---------------------------------------------------------------- 13. privacidad

s = nueva()
cabecera(s, "Privacidad", "Tus videos son tuyos")
for i, (t, c) in enumerate([
    ("Sin cuentas ni analítica", "No hay registro, anuncios ni cookies."),
    ("Todo en tu computadora", "Las grabaciones se guardan y se editan sin subirse a ningún servidor."),
    ("Celular directo y cifrado", "WebRTC de punto a punto; el servidor solo sirve para encontrarse."),
    ("Permisos mínimos", "El acceso a sitios es opcional y se puede quitar en los ajustes."),
]):
    tarjeta(s, 0.7 + i * 3.03, 2.25, 2.83, 3.6, t, c, numero=i + 1)

# ---------------------------------------------------------------- 14. estado y publicación

s = nueva()
cabecera(s, "Estado · versión 1.0.0", "Listo para publicar")
for i, (t, c) in enumerate([
    ("Probado de punta a punta", "77 comprobaciones con la extensión real y un celular conectado, más 51 del estudio (recortes, cortes y exportación)."),
    ("Paquete listo", "dist/grabazo-1.0.0.zip para la Chrome Web Store, Manifest V3, con acceso a sitios opcional."),
    ("Ficha completa", "Textos, 5 capturas, 2 mosaicos, política de privacidad, justificación de permisos y landing page."),
]):
    tarjeta(s, 0.7 + i * 4.05, 2.25, 3.85, 2.6, t, c, numero=i + 1)
texto(s, 0.7, 5.35, 11.9, 1.2, ["Siguiente paso: publicar la página del celular en mjmc4498.github.io/grabazo, la landing en grabazo.com y subir el ZIP 1.0.0 en el panel del desarrollador."], size=16, color=MUTED, line=1.3)

# ---------------------------------------------------------------- 15. cierre

s = nueva()
foto(s, IMG / "logo-512.png", 0.7, 1.7, w=1.25)
texto(s, 0.7, 3.15, 8, 1.1, "¡A grabar!", size=56, bold=True)
texto(s, 0.7, 4.3, 7.4, 1.4, ["Instala Grabazo, escanea el QR y graba tu próximo tutorial desde la mano.", "grabazo.com"], size=20, color=MUTED, line=1.25)
texto(s, 0.7, 6.55, 7, 0.4, "Creado por Miguel Mogrovejo", size=13, color=MUTED)
foto(s, phones["phone-guion"], 9.15, 0.55, h=6.4)

prs.save(OUT)
print("  ", OUT.relative_to(ROOT), f"({len(prs.slides)} diapositivas)")
