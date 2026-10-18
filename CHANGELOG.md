# Registro de cambios

Todas las versiones de la extensión Grabazo. El número de versión de cada paquete
debe ser mayor que el anterior para que la Chrome Web Store lo acepte.

## 1.1.0 — 18 de octubre de 2026

- **Tu cámara dentro del video en Ventana y Pantalla.** Antes la burbuja vivía en la
  página y no salía al grabar otras apps; ahora el grabador la compone en cada cuadro
  (círculo o rectángulo, con borde, sombra y modo espejo), así sales siempre.
- **Paso «Ubica tu cámara»:** después de elegir la ventana o la pantalla, una vista
  previa real donde arrastras la cámara (o eliges esquina, tamaño y forma) y pulsas
  «Empezar a grabar». Se puede saltar con «Preguntar siempre» apagado (también en
  Ajustes › Cámara, con la posición por defecto).
- **Moverla mientras grabas,** con movimiento suave en el video: desde un menú nuevo de
  la barra flotante (esquinas, tamaño, forma y espejo), desde el celular («Tu cámara en
  el video») o arrastrándola en la pestaña del grabador (también con las flechas). O
  dejarla fija. En Pestaña y Área, las esquinas mueven la burbuja de la página.
- **Vista previa de la cámara en el popup,** con su forma, espejo y efectos.
- **El video se guarda por partes mientras grabas** (un cuadro clave cada 2 s): si se
  cierra la pestaña del grabador, se recupera lo grabado hasta ese momento.
- Se quitó la ventana flotante de la burbuja: su uso (verse al grabar la pantalla) lo
  cubre ahora la cámara dentro del video.
- Corrección: al grabar una pestaña a más resolución que la de la pantalla (por ejemplo
  1080p con una pantalla común), Chrome la volvía a dibujar ampliada y la burbuja de la
  cámara salía agrandada y recortada en el video. Ahora la captura nunca pide más que los
  píxeles reales de la pestaña.
- Corrección: la capa de la página ya no da error si se cierra justo al empezar.
- Imágenes: la persona de demostración (cámara de las capturas, tienda, presentación,
  landing e imagen para redes) tiene el cabello bien colocado sobre la cabeza, y en las
  capturas de la tienda la burbuja ya no sale ampliada ni descentrada.
- Prueba de punta a punta con 102 comprobaciones (incluye el modo Pantalla con una
  pantalla simulada) y prueba del estudio con 51.

## 1.0.0 — 17 de octubre de 2026

Primera versión.

- **Cinco modos de captura:** pestaña (con su sonido), área personalizada de la
  pestaña, ventana, pantalla completa o solo la cámara. Hasta 4K y 60 cuadros por
  segundo, en MP4 (H.264) o WebM, sin marcas de agua ni límite de duración.
- **Burbuja de la cámara:** flotante y arrastrable, en círculo o rectángulo, cuatro
  tamaños, modo espejo, fondo desenfocado o fondos virtuales (segmentación de personas
  en la computadora con MediaPipe), filtros de color y ventana flotante sobre todas las
  apps.
- **Audio:** micrófono y sonido de la pestaña o del sistema a la vez, reducción de
  ruido y pulsar para hablar (tecla, botón de la barra o «Hablar» en el celular).
- **Dibujo en vivo:** lápiz, resaltador, flechas, rectángulos, círculos, texto y
  borrador, con 8 colores, 3 grosores, deshacer y tinta que se desvanece.
- **Cursor y pantalla:** resaltado de clics, foco de luz, cursor oculto cuando no se
  mueve, zoom dinámico suave que sigue al cursor (o automático en cada clic) y
  difuminado de información sensible en tiempo real.
- **Controles:** cuenta regresiva, pausar y reanudar, reiniciar, descartar, límite de
  tiempo con aviso y barra flotante que se puede ocultar.
- **Estudio:** recortar el inicio y el final, cortar partes del medio, quitar el audio
  y exportar en MP4, WebM o GIF; biblioteca «Mis grabaciones» y recuperación de
  grabaciones interrumpidas.
- **Tu celular por QR:** control remoto de la grabación y de las herramientas,
  teleprompter con tu guion (arranca solo al grabar) y la cámara y el micrófono del
  celular como burbuja de la grabación. WebRTC directo y cifrado, con retransmisión de
  Cloudflare para redes restrictivas.
- **Atajos:** Alt+Shift+G (abrir), Alt+Shift+R (grabar o detener), Alt+Shift+K
  (pausar) y Alt+Shift+A (lápiz).
- Prueba de punta a punta con 77 comprobaciones y prueba del estudio con 51.
