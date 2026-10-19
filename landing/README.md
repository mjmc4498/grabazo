# Grabazo (`grabazo.com`) — Landing page oficial

Sitio web oficial de **Grabazo**, la extensión gratuita de Google Chrome creada por **Miguel Mogrovejo** para grabar la pantalla, la cámara y las ideas, con el celular como control remoto, teleprompter y cámara. Sin marcas de agua, sin límite de tiempo, sin cuenta y con las grabaciones guardadas en la computadora.

Es un sitio **100 % estático**: HTML, CSS y JavaScript propios, sin frameworks, sin CDN y sin fuentes externas (usa la fuente del sistema). Todo cumple una CSP estricta (`script-src 'self'; style-src 'self'`): no hay scripts ni estilos en línea, salvo el bloque de datos JSON-LD, que el navegador no ejecuta.

## Estructura del proyecto

- [`index.html`](./index.html) — Landing con SEO técnico completo (título, descripción, palabras clave, canonical, Open Graph, Twitter Cards) y datos estructurados JSON-LD en un `@graph` (`Organization`, `Person`, `WebSite`, `SoftwareApplication`, `HowTo`, `FAQPage`). Secciones: hero con maqueta CSS/SVG, «los cuatro ceros», funciones (7 grupos), simulador interactivo, cómo funciona (3 pasos), estudio post-grabación, comparativa, privacidad y arquitectura, preguntas frecuentes, familia «-azo», llamada final y pie de página. Incluye el diálogo «Cómo instalar el ZIP».
- [`styles.css`](./styles.css) — Tema oscuro (por defecto) y claro, tipografía fluida con `clamp()`, `text-wrap: balance/pretty`, `content-visibility: auto` en las secciones bajo el pliegue, consultas de contenedor (`cqi`, `@container`) para que las maquetas escalen, soporte de `prefers-reduced-motion` y `forced-colors`. Funciona desde 320–360 px sin desplazamiento horizontal.
- [`app.js`](./app.js) — Tema claro/oscuro (se recuerda en `localStorage`), menú móvil, scrollspy, diálogo de instalación y el **simulador**: lienzo de dibujo (lápiz, resaltador, flecha, rectángulo, círculo, deshacer, borrar todo, tinta que se desvanece, 8 colores y 3 grosores), foco de luz que sigue al mouse, resaltado de clics, zoom 2× que sigue al cursor, difuminado de datos con un clic, burbuja de cámara arrastrable (forma, tamaño, filtros y fondos), grabación simulada con cuenta regresiva, celular con control remoto, pulsar para hablar y teleprompter con desplazamiento automático. Atajos `Alt+Shift+R/K/A` cuando el simulador está a la vista.
- [`theme.js`](./theme.js) — Aplica el tema guardado antes de pintar la página (evita el parpadeo y respeta la CSP).
- [`404.html`](./404.html) — Página de error con el mismo estilo (no indexable).
- [`assets/`](./assets/) — `logo.svg`, `logo-small.svg`, `og-image.svg` y su versión `og-image.png` (1200×630) para redes sociales.
- Íconos: `favicon.svg`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`, `apple-touch-icon.png`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (copiados de `design/`, `remote/` y `extension/icons/`).
- [`downloads/`](./downloads/) — Aquí va el paquete de la extensión: **`grabazo-chrome-v1.2.0.zip`** (los botones «Agregar a Chrome» apuntan a esa ruta).
- [`robots.txt`](./robots.txt), [`sitemap.xml`](./sitemap.xml) y [`manifest.webmanifest`](./manifest.webmanifest) — Indexación (Google Search Console) y PWA.
- [`wrangler.toml`](./wrangler.toml), [`_headers`](./_headers) y [`_redirects`](./_redirects) — Configuración para **Cloudflare Pages**: cabeceras de seguridad (CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS), caché y redirecciones cortas (`/descargar`, `/privacidad`, `/control`, `/github`, `/simulador`).

## Antes de publicar

1. **Copia el ZIP de la extensión** a `downloads/grabazo-chrome-v1.2.0.zip` (el paquete que genera `npm run build` en `dist/`). Si cambia la versión, actualiza el nombre en `index.html` (botones, diálogo y JSON-LD `downloadUrl`/`softwareVersion`) y en `_redirects`.
2. **Chrome Web Store:** cuando la ficha esté publicada, cambia los botones «Agregar a Chrome» para que apunten a la tienda, quita los avisos «Próximamente en la Chrome Web Store», agrega `installUrl` y la URL de la tienda en `sameAs` del JSON-LD y descomenta la regla `/chrome` de `_redirects`.
3. **Familia «-azo»:** solo Presentazo tiene enlace. Cuando Botonazo, Capturazo y Preguntazo tengan su web, convierte sus tarjetas (sección `#familia`) y los elementos del pie de página en enlaces.
4. Si cambias `styles.css` o `app.js`, sube el parámetro `?v=` en `index.html` y `404.html` para renovar la caché.
5. Si generas de nuevo la imagen social, edita `assets/og-image.svg` y renderízala a PNG con Chrome sin interfaz (mismas opciones que `scripts/render.py`):

   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
     --hide-scrollbars --window-size=1200,630 --screenshot=assets/og-image.png \
     file:///ruta/a/una/pagina-que-muestra/og-image.svg
   ```

## Probar en local

```bash
python3 -m http.server 8790 --directory landing
# abre http://localhost:8790/
```

(El servidor de Python no aplica `_headers` ni `_redirects`; eso solo ocurre en Cloudflare o con `npx wrangler pages dev .`.)

## Cómo desplegar en Cloudflare Pages

### Opción 1: Wrangler CLI (desde esta carpeta)

```bash
cd landing
npx wrangler pages deploy . --project-name grabazo
```

### Opción 2: Conectar el repositorio de GitHub

1. **Cloudflare Dashboard › Workers & Pages › Create › Pages › Connect to Git** y elige `mjmc4498/grabazo`.
2. Deja **Build command** vacío y pon **Build output directory** en `landing`.
3. En **Custom domains**, agrega `grabazo.com` y `www.grabazo.com`. Para que `www` redirija a `grabazo.com`, crea una regla en **Rules › Redirect Rules** (o *Bulk Redirects*) del dominio; `_redirects` no maneja dominios.

## Enlaces oficiales

- **Repositorio:** <https://github.com/mjmc4498/grabazo>
- **Control web del celular (GitHub Pages):** <https://mjmc4498.github.io/grabazo/>
- **Política de privacidad:** <https://mjmc4498.github.io/grabazo/privacy.html>
- **Creador:** [Miguel Mogrovejo en LinkedIn](https://www.linkedin.com/in/mjmc4498/)
- **Familia:** [Presentazo](https://presentazo.com/) · Botonazo · Capturazo · Preguntazo

© 2026 Miguel Mogrovejo.
