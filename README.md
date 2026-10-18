<p align="center">
  <img src="extension/icons/icon-128.png" width="96" alt="Grabazo">
</p>

<h1 align="center">Grabazo</h1>
<p align="center">Graba tu pantalla, tu cámara y tus anotaciones desde Chrome, sin marcas de agua ni límites.<br>
Dibuja, haz zoom y difumina datos mientras grabas, recorta y exporta en MP4, WebM o GIF,<br>
y usa tu celular como control remoto, teleprompter y cámara con solo escanear un QR.</p>
<p align="center"><sub>Creado por <b>Miguel Mogrovejo</b> · v1.1.0 · hermano de <a href="https://github.com/mjmc4498/mando">Presentazo</a>, <a href="https://github.com/mjmc4498/botonazo">Botonazo</a>, <a href="https://github.com/mjmc4498/capturazo">Capturazo</a> y <a href="https://github.com/mjmc4498/preguntazo">Preguntazo</a></sub></p>

---

## Funciones

| | |
|---|---|
| **Modos de captura** | Pestaña (con su sonido), área personalizada de la pestaña (con proporciones libres, 16:9, 9:16, 1:1 o 4:3), ventana, pantalla completa o solo la cámara. Hasta 4K y 60 cuadros por segundo, en MP4 (H.264, cuando Chrome puede) o WebM. Sin marcas de agua, sin límite de duración y sin cuentas. |
| **Cámara** | Burbuja flotante y arrastrable sobre la página (círculo o rectángulo, cuatro tamaños, modo espejo), fondo desenfocado (suave o fuerte) o seis fondos virtuales generados, con segmentación de personas de MediaPipe en la propia computadora, y filtros de color. Al grabar una **ventana o la pantalla completa**, la cámara va **dentro del video**: antes de grabar aparece «Ubica tu cámara» (vista previa real donde la arrastras o eliges esquina, tamaño y forma) y mientras grabas la mueves con suavidad desde la barra, el celular o la pestaña del grabador, o la dejas fija. Sales en la grabación aunque cambies de app. |
| **Audio** | Micrófono y sonido de la pestaña o del sistema a la vez, mezclados en una pista, con reducción de ruido. **Pulsar para hablar**: el micrófono graba solo mientras mantienes una tecla (por defecto, la que está a la izquierda del 1), el botón de la barra o «Hablar» en el celular. |
| **Dibujo y anotación** | Lápiz, resaltador, flechas, rectángulos, círculos (Shift: perfectos), texto y borrador; 8 colores y 3 grosores; deshacer, rehacer, borrar todo y tinta que se desvanece. |
| **Cursor y pantalla** | Resaltado de clics, foco de luz que oscurece el resto, cursor oculto cuando no se mueve, **zoom dinámico** que sigue al cursor con movimiento suave (1,5× a 3×, o automático en cada clic) y **difuminar** en tiempo real (clic sobre un elemento o arrastrar una zona). |
| **Controles** | Cuenta regresiva (0, 3, 5 o 10 s, se cancela con un clic), pausar y reanudar, reiniciar, descartar, límite de tiempo con aviso a los 10 s, y una barra flotante arrastrable que se puede ocultar o que se desvanece sola. |
| **Estudio** | Se abre al terminar: recortar el inicio y el final, cortar partes del medio, deshacer, quitar el audio y exportar en MP4, WebM o GIF con WebCodecs (sin cambios, la exportación es casi instantánea). «Mis grabaciones» guarda todo en la computadora y recupera la grabación si Chrome se cierra a la mitad. |
| **Tu celular (QR)** | **Control remoto**: grabar, pausar, reiniciar, descartar, elegir herramienta, color y grosor, zoom, foco, clics, difuminar, cámara, micrófono y barra, sin tocar el mouse. **Teleprompter**: tu guion con desplazamiento automático que empieza solo al grabar, velocidad, tamaño de letra y modo espejo. **Cámara**: la cámara y el micrófono del celular como burbuja de la grabación. |
| **Conexión** | WebRTC directo y cifrado entre el celular y la computadora; retransmisión de Cloudflare para redes restrictivas; reconexión automática; el celular recuerda la computadora. |

Probado de principio a fin con **102 comprobaciones automáticas** (extensión real grabando pestañas, áreas, la pantalla con la cámara dentro del video y la cámara; el flujo real de clic en el ícono, popup y «Grabar»; página de ejemplo con la capa encima; celular real conectado por PeerJS como control remoto, teleprompter y cámara) y **51 del estudio** (recortes, cortes, exportación a MP4, WebM y GIF, recuperación).

## Cómo funciona

```
┌───────────────────── Chrome (computadora) ─────────────────────┐          ┌──── Celular ────────────┐
│                                                                 │   QR     │                         │
│  popup.html ── modo, cámara, audio, Grabar y QR del celular     │ ───────▶ │  remote/ (GitHub Pages) │
│  options.html ── permisos, ajustes, guion y celular             │          │  Control · Guion ·      │
│                                                                 │  WebRTC  │  Cámara                 │
│  background.js ── la sesión: estado, órdenes, atajos            │ ◀══════▶ │  PeerJS (cliente)       │
│      │                                                          │ cifrado  └─────────────────────────┘
│      ├─ offscreen.html ── PeerJS (anfitrión) + cámara (PC o     │
│      │      celular) con efectos (MediaPipe) → reparto local    │      Señalización: 0.peerjs.com
│      │                                                          │      (solo para conectar)
│      ├─ grabador.html ── captura (tabCapture / desktopCapture), │
│      │      mezcla de audio, área y zoom (compositor),          │
│      │      MediaRecorder → IndexedDB parte por parte           │
│      │                                                          │
│      ├─ content/ ── la capa en la página: barra, dibujo,        │
│      │      efectos y burbuja (camara.html, en un iframe)       │
│      │                                                          │
│      └─ estudio.html ── biblioteca, recorte y exportación       │
│             (Mediabunny + WebCodecs, gifenc)                    │
└─────────────────────────────────────────────────────────────────┘
```

- **El grabador es una pestaña propia** (fijada a la izquierda mientras se graba): las páginas de la extensión no pueden recibir la captura de una ventana o de la pantalla en un documento offscreen, y el selector de Chrome necesita una pestaña. En el modo pestaña, el service worker pide `chrome.tabCapture.getMediaStreamId` con el grabador como consumidor (requiere que el usuario haya invocado la extensión en esa pestaña: activeTab).
- **Composición del video** (`lib/compositor.js`): `MediaStreamTrackProcessor` → lienzo → `MediaStreamTrackGenerator`. Recorta el área elegida, aplica el zoom dinámico (sigue al cursor con suavizado exponencial) y el espejo de la cámara. Si no hay nada que transformar, los cuadros pasan sin copiarse. Un Worker (`lib/reloj.js`) anima el zoom aunque la pestaña del grabador esté en segundo plano y la página grabada quieta.
- **Audio**: un `AudioContext` mezcla micrófono (con su volumen para silenciar y pulsar para hablar), sonido de la pestaña o del sistema y micrófono del celular. En el modo pestaña, el sonido capturado vuelve a los parlantes (Chrome silencia la pestaña al capturarla).
- **Guardado**: `MediaRecorder` entrega una parte por segundo, que se guarda en IndexedDB (`lib/db.js`). Al detener, las partes se unen en un video con miniatura y duración. Si Chrome o la pestaña del grabador se cierran, el estudio ofrece recuperar lo grabado.
- **La capa sobre la página** es un elemento `popover` con un shadow root cerrado: entra en la *top layer* (también sobre un video en pantalla completa) y no se mezcla con los estilos de la página. Los clics sobre la barra no llegan a la página. Todo lo que muestra sale en la grabación (en el modo área, el marco queda fuera del recorte).
- **La cámara llega por una conexión local**: el documento offscreen abre la cámara (de la computadora o del celular), le aplica los efectos (`lib/efectos.js`, MediaPipe Selfie Segmenter con GPU) y la reparte por WebRTC local (sin servidores) a la burbuja (`camara.html`, un iframe de la extensión dentro de la página) y al grabador. Así funciona aunque la página bloquee la cámara con *Permissions-Policy*, y los efectos se calculan una sola vez.
- **El celular** se conecta con PeerJS a la sesión de la computadora (`grabazo-<id>`), envía un `hello` con la clave del QR y recibe el estado (grabación, tiempo, herramientas). Sus órdenes pasan por el documento offscreen, que las valida y limita (20 por segundo), y llegan al service worker como las del popup o la barra. El QR contiene `https://…/grabazo/#id=…&k=…`: la clave va en el fragmento (`#`, nunca llega a un servidor) y el celular la quita de la barra de direcciones al conectarse.

## Estructura

```
grabazo/
├── extension/           ← lo que se empaqueta y sube a la Chrome Web Store
│   ├── manifest.json
│   ├── background.js    service worker: sesión, órdenes, capa en las pestañas, celular y atajos
│   ├── offscreen.*      enlace con el celular (PeerJS) y cámara con efectos, repartida en local
│   ├── grabador.*       la grabación: captura, audio, composición y guardado por partes
│   ├── estudio.*        biblioteca y editor (recortar, cortar, quitar audio, exportar)
│   ├── camara.*         la burbuja de la cámara (iframe dentro de la página)
│   ├── popup.*          qué grabar, cámara, audio, Grabar y QR del celular
│   ├── options.*        bienvenida, permisos, ajustes, guion y celular
│   ├── content/         capa.js (barra, cuenta regresiva, área), dibujo.js, efectos.js, camara.js
│   ├── lib/             compositor, efectos, relay, db, exportar, reloj, QR, i18n y vendor/
│   │   └── vendor/      Mediabunny, gifenc y MediaPipe (con su modelo)
│   ├── _locales/        textos en español (se generan con scripts/textos.py)
│   └── icons/
├── remote/              ← página del celular (se publica en GitHub Pages)
│   ├── privacy.html     política de privacidad (URL pública para la tienda)
│   └── favicon.ico, icon.svg, manifest.webmanifest…
├── landing/             ← landing page de grabazo.com (Cloudflare Pages)
├── cloudflare/          ← Worker de credenciales TURN (opcional: se comparte el de Presentazo)
├── store/               ← imágenes y textos para la ficha de la tienda (LISTING.md)
├── design/              logos SVG, página de ejemplo, escena de la cámara y composiciones de la tienda
├── presentacion/        presentación del producto (grabazo.pptx)
├── scripts/             build.sh, landing.sh, textos.py, render.py, capture-store.mjs, presentacion.py, demo-media.py
├── test/                prueba de punta a punta (e2e.mjs) y del estudio (estudio.mjs)
└── dist/                paquetes generados (.zip / .crx)
```

## Publicación paso a paso

### 1. Publica la página del celular (una sola vez)

El QR abre `https://mjmc4498.github.io/grabazo/`, así que esa página debe existir:

```bash
cd grabazo
git init -b main && git add . && git commit -m "Grabazo 1.0.0"
gh repo create mjmc4498/grabazo --public --source . --push
gh api -X POST repos/mjmc4498/grabazo/pages -f build_type=workflow
```

El flujo `.github/workflows/pages.yml` publica la carpeta `remote/` en cada cambio. En 1–2 minutos estarán disponibles:

- Celular: `https://mjmc4498.github.io/grabazo/`
- Privacidad: `https://mjmc4498.github.io/grabazo/privacy.html`

> ¿Otra dirección? Cambia `REMOTE_URL` en `extension/config.js` (y `homepage_url` en el manifiesto) y vuelve a empaquetar. También puede cambiarse en **Ajustes › Avanzado** sin reempaquetar.

### 2. Prueba la extensión en tu Chrome

1. Ejecuta `./scripts/build.sh`.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar extensión sin empaquetar**.
3. Elige la carpeta `dist/grabazo/` (su ruta no cambia entre versiones).
4. En la bienvenida pulsa **Permitir cámara y micrófono**. Abre cualquier página, haz clic en el ícono de Grabazo (o `Alt+Shift+G`), elige **Pestaña** y pulsa **Grabar**.
5. Para el celular: en el popup abre **Tu celular** y escanea el QR.

### 3. Empaqueta

```bash
./scripts/build.sh
```

Genera `dist/grabazo-<versión>.zip` para la tienda y la carpeta `dist/grabazo/` para «Cargar extensión sin empaquetar» (valida manifiesto, íconos, textos y scripts antes de comprimir).

> Si el Escritorio se sincroniza con iCloud, borrar y volver a crear archivos enseguida deja copias de conflicto (`_locales 3`, `popup 2.js`) y Chrome responde *«Filenames starting with "_" are reserved»*. Por eso `build.sh` actualiza el ZIP y la carpeta en su lugar, borra esas copias de `dist/` y se detiene si encuentra alguna dentro de `extension/`.

Para un `.crx` instalable fuera de la tienda: `./scripts/build.sh --crx` (la clave queda en `keys/grabazo.pem`; guárdala y no la subas a git). **La Chrome Web Store solo acepta el ZIP**; ella firma el paquete final.

### 4. Sube a la Chrome Web Store

1. Entra al [Panel del desarrollador](https://chrome.google.com/webstore/devconsole) (la misma cuenta de Presentazo, Botonazo, Capturazo y Preguntazo; el registro de USD 5 ya está pagado).
2. **Nuevo elemento** → sube `dist/grabazo-1.1.0.zip`.
3. Completa las pestañas copiando los textos de [`store/LISTING.md`](store/LISTING.md) y sube las imágenes de `store/`.
4. **Enviar para revisión.** El acceso a los sitios es un permiso opcional que se pide en tiempo de ejecución, así que el paquete no declara permisos de host; las justificaciones de cada permiso ya están redactadas en `LISTING.md`.

### 5. Publica la landing page (grabazo.com)

```bash
./scripts/landing.sh                                        # copia el ZIP a landing/downloads/
cd landing && npx wrangler pages deploy . --project-name grabazo
```

Detalles (dominio, redirecciones, cabeceras de seguridad) en [`landing/README.md`](landing/README.md). Cuando la extensión esté publicada, cambia los botones «Agregar a Chrome» por el enlace de la tienda.

### Nuevas versiones

1. Sube `version` en `extension/manifest.json` (y `VERSION` en `remote/app.js`, y el `?v=` de `remote/index.html` si cambió la página del celular).
2. Anota los cambios en `CHANGELOG.md`.
3. `./scripts/build.sh` y sube el nuevo ZIP en el panel (**Paquete › Subir nuevo paquete**). Para la landing, `./scripts/landing.sh` y actualiza el nombre del ZIP en `landing/index.html`.

## Desarrollo

```bash
npm install                 # Puppeteer (solo para pruebas y capturas)
npm run serve               # servidor local en http://localhost:8769 (otra terminal)
npm run test:e2e            # prueba completa extensión ↔ página ↔ celular (102 comprobaciones)
npm run test:estudio        # estudio: recortes, cortes y exportación (51 comprobaciones)
npm run textos              # regenera _locales/es/messages.json desde scripts/textos.py y textos_estudio.py
npm run icons               # regenera íconos y favicon desde design/*.svg
python3 scripts/demo-media.py   # escena de demostración para la cámara de las capturas
npm run store:capture       # capturas reales de la extensión, la capa, el celular y el estudio
npm run store:images        # compone las imágenes de la tienda
npm run presentacion        # genera presentacion/grabazo.pptx (requiere python-pptx)
npm run landing             # copia el ZIP a la landing
```

- Vista previa del celular sin computadora: `http://localhost:8769/remote/?demo` (añade `&view=script|camera`, `&rec=idle|countdown|recording|paused|saving`, `&ptt`, `&limit`, `&want` o `&camphone`).
- Página de ejemplo: `design/demo/tutorial.html` (las pruebas la sirven como `https://demo.example.com`).
- **Particularidades de las pruebas automáticas** (Chrome sin ventana):
  - La extensión se copia a la carpeta temporal del sistema (fuera de iCloud) con `host_permissions` para la página de ejemplo.
  - El clic en el ícono se simula con CDP (`Extensions.triggerAction`), que abre el popup real y da activeTab. Para recorrer muchas acciones seguidas, la segunda sesión usa además una clave fija y `--allowlisted-extension-id` (con ese indicador Chrome no le da cámara ni micrófono normales a la extensión): por eso `e2e.mjs` usa tres sesiones (normal, autorizada y clic real).
  - `--use-fake-ui-for-media-stream` y `--use-file-for-fake-video-capture` dejan sin imagen a la captura de pestañas: los permisos se conceden por CDP (`Browser.setPermission`) y, en las capturas, la cámara del celular se simula con un lienzo.
  - La capa expone su estado en atributos del elemento anfitrión (`data-role`, `data-toolbar`, `data-tool`, `data-shapes`, `data-spotlight`, `data-blur`, `data-bubble`, `data-area`, `data-countdown`) para poder comprobarlo desde fuera del shadow root cerrado. El grabador expone `globalThis.__grabador` y el estudio `window.__estudio` para diagnóstico.
- La presentación en PDF se exporta desde Keynote o PowerPoint (`presentacion/grabazo.pptx` → Archivo › Exportar a PDF).

### Retransmisión con Cloudflare (redes restrictivas)

Grabazo comparte con Presentazo, Botonazo, Capturazo y Preguntazo el Worker `https://mando-turn.mjmc4498.workers.dev`, que entrega credenciales temporales del servidor TURN de Cloudflare (gratis hasta 1.000 GB al mes, con pausa automática a los 900 GB). Acepta cualquier extensión de Chrome y el origen `https://mjmc4498.github.io`. Las órdenes del control remoto y el guion pesan muy poco; la cámara del celular sí consume (unos 1–3 Mbps) si pasa por la retransmisión, algo que solo ocurre en redes que bloquean la conexión directa. Consumo del mes: <https://mando-turn.mjmc4498.workers.dev/estado>.

La carpeta `cloudflare/` tiene una copia (`grabazo-turn`, que además acepta `https://grabazo.com` y `http://localhost:8769`): `cd cloudflare && npx wrangler deploy`, guarda los secretos `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` y `CF_ANALYTICS_TOKEN`, y cambia `ICE_ENDPOINT` en `extension/config.js` y `remote/app.js`.

## Permisos

| Permiso | Para qué |
|---|---|
| `activeTab` | Grabar la pestaña actual e insertar en ella la barra y la cámara cuando abres Grabazo o usas un atajo, sin pedir acceso a sitios. |
| `tabCapture` | Grabar la pestaña elegida (modos Pestaña y Área) con su sonido. |
| `desktopCapture` | Mostrar el selector de Chrome para grabar una ventana o la pantalla. |
| `scripting` | Insertar la capa (barra, dibujo, efectos y burbuja) en la pestaña que se graba. |
| `offscreen` | Mantener la conexión WebRTC con el celular y preparar la cámara con sus efectos. |
| `storage` | Guardar los ajustes, el guion y la conexión con el celular. |
| `unlimitedStorage` | Guardar las grabaciones (y sus partes mientras se graba) en la computadora. |
| `downloads` | Guardar en Descargas › Grabazo los videos exportados. |
| Sitios web (opcional: `https://*/*`, `http://*/*`) | Solo con «La barra en todas las páginas»: la barra y la cámara siguen en pantalla al cambiar de página o de pestaña mientras grabas. Se quita en **Ajustes › Permisos**. |

## Atajos

| Atajo | Acción |
|---|---|
| `Alt+Shift+G` | Abrir Grabazo |
| `Alt+Shift+R` | Empezar o detener la grabación |
| `Alt+Shift+K` | Pausar o reanudar |
| `Alt+Shift+A` | Activar o desactivar el lápiz |
| (sin asignar) | Zoom, foco de luz, micrófono, cámara y barra: se asignan en `chrome://extensions/shortcuts` |

Mientras dibujas: `Esc` vuelve al mouse, `Ctrl/⌘+Z` deshace y `Shift+Ctrl/⌘+Z` rehace. En el modo área: `Enter` graba y `Esc` cancela. Pulsar para hablar: mantén la tecla elegida en **Ajustes › Audio** (por defecto, la que está a la izquierda del 1).

## Limitaciones

- Chrome no permite extensiones en `chrome://` ni en la Chrome Web Store: ahí solo se puede grabar una ventana, la pantalla o la cámara, y no aparece la barra.
- El sonido del sistema al grabar la pantalla o una ventana depende de lo que ofrezca Chrome en cada sistema (en Windows y ChromeOS suele estar; en macOS, según la versión). El sonido de una pestaña siempre se puede grabar.
- La barra, los dibujos y los efectos se dibujan sobre las páginas web: al grabar la pantalla, se ven mientras la página está a la vista. La cámara, en cambio, va dentro del video y se ve siempre.
- Al grabar una pestaña o un área, el video no supera los píxeles reales de la pestaña (en una pantalla Retina, el doble de su tamaño): si se pidiera más, Chrome la volvería a dibujar ampliada y la burbuja de la cámara saldría recortada.
- El zoom en los modos ventana y pantalla se centra con la posición del cursor sobre la pantalla donde está Chrome; con varias pantallas puede no coincidir exactamente.
- Las exportaciones se arman en memoria: un video muy largo necesita aproximadamente el doble de su tamaño en RAM. Exportar con cambios vuelve a codificar todo el video.
- La conexión directa del celular necesita que ambos puedan encontrarse; si la red lo impide, se usa la retransmisión de Cloudflare, o el celular puede usar sus datos móviles.

## Licencia

© 2026 Miguel Mogrovejo. Incluye PeerJS, QR Code Generator y gifenc (MIT), Mediabunny (MPL-2.0), MediaPipe Tasks Vision y su modelo Selfie Segmenter (Apache-2.0) e íconos basados en Lucide (ISC) — ver `extension/THIRD_PARTY_NOTICES.txt`.
