# Doña Fresa — Ponle precio a tus postres

Calculadora de costos y precios para reposteras. Todo se calcula en el navegador: no necesita servidor, cuentas, claves ni IA.

## Estructura

| Archivo | Qué hace |
|---|---|
| `src/calc.js` | Funciones puras: conversión de unidades, costos, margen sobre venta, comisiones, equilibrio, validación |
| `src/store.js` | Guardado local versionado, ejemplo ficticio, respaldo JSON validado |
| `src/app.js` | Interfaz (3 pasos, resultados, copiar/imprimir/compartir, respaldo) |
| `src/config.js` | **Kit digital**: nombre, precio, estado y `checkoutUrl`. Único lugar a editar para activar la venta |
| `src/analytics.js` | Gancho de eventos sin proveedor (`window.dfTrack`) |
| `src/mascot.js` | Doña Fresa en SVG |
| `index.html`, `src/styles.css` | Estructura y estilos |

## Comandos

```bash
npm install          # esbuild + playwright-core (solo para desarrollo)
npm test             # 22 pruebas de las funciones puras y el guardado
npm run build        # genera dist/index.html (un único archivo, ~21 KB gzip)
node scripts/e2e.mjs # pruebas de navegador (requiere Chromium; ruta en la variable CHROMIUM)
```

Para desarrollar sin build: sirve la carpeta con cualquier servidor estático (`npx serve .`) y abre `index.html`.

## Publicar (hosting estático gratuito)

Solo hay que subir **`dist/index.html`**. Cualquiera de estas opciones da un enlace HTTPS:

- **Netlify Drop**: entra a app.netlify.com/drop y arrastra la carpeta `dist`.
- **Cloudflare Pages**: crea un proyecto → «Direct upload» → sube `dist`.
- **GitHub Pages**: sube `dist/index.html` a un repositorio y activa Pages.

Publicada en https://boberudb.github.io/Calculadora-de-ganancias/ (rama `gh-pages`). Si cambias de dominio, actualiza `SITE_URL` de `src/config.js` y vuelve a hacer `npm run build`.

## Activar el kit (solo cuando exista)

En `src/config.js`: `status: 'disponible'` y `checkoutUrl: 'https://…'` (enlace real del checkout). Si falta cualquiera de los dos, la web muestra «En preparación» y no ofrece compra.

## Mediciones hechas (28/09/2026, Chromium headless)

- JS 13.1 KB gzip; página completa 21.3 KB gzip (1 solicitud).
- Con CPU 4× más lenta, 150 ms de latencia y 1.6 Mbps: LCP ≈ 0.3–0.35 s, CLS 0.000.
- Sin desplazamiento horizontal a 320, 360, 390, 768 y 1280 px; sin errores de consola.

Estas cifras vienen de una emulación local. Para medir en real, publica la web y pásala por PageSpeed Insights (móvil) o prueba con un Android de gama baja.
