// Genera dist/index.html (web pública, un solo archivo) y dist-preview/index.html (vista previa en Artifacts).
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const html = readFileSync('index.html', 'utf8');
const css = (await transform(readFileSync('src/styles.css', 'utf8'), { loader: 'css', minify: true })).code;

async function js(preview) {
  const r = await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'esm', target: 'es2019', write: false, define: { __PREVIEW__: String(preview) } });
  return r.outputFiles[0].text;
}
const page = (script) => html
  .replace(/<!--STYLES-->[\s\S]*?<!--\/STYLES-->/, `<style>${css}</style>`)
  .replace(/<!--SCRIPT-->[\s\S]*?<!--\/SCRIPT-->/, `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`);

const site = page(await js(false));
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', site);

// Artifacts envuelve la página en su propio esqueleto: se entrega title + style + contenido del body.
const prev = page(await js(true));
const title = prev.match(/<title>[\s\S]*?<\/title>/)[0];
const style = prev.match(/<style>[\s\S]*?<\/style>/)[0];
const body = prev.match(/<body>([\s\S]*)<\/body>/)[1];
mkdirSync('dist-preview', { recursive: true });
writeFileSync('dist-preview/index.html', `${title}\n${style}\n${body}`);

const jsOnly = await js(false);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('dist/index.html', kb(site.length), '| gzip', kb(gzipSync(site).length), '| brotli', kb(brotliCompressSync(site).length));
console.log('  JS', kb(jsOnly.length), '| gzip', kb(gzipSync(jsOnly).length), '  CSS', kb(css.length), '| gzip', kb(gzipSync(css).length));
