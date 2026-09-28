// Pruebas de navegador sobre dist/index.html (Chromium de Playwright).
// Uso: npm run build && node scripts/e2e.mjs [carpeta-capturas]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const SHOTS = process.argv[2] || 'shots';
mkdirSync(SHOTS, { recursive: true });
const html = readFileSync('dist/index.html');
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }).listen(0);
const URL = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

let failed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); } catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

async function newPage(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, ...opts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.goto(URL);
  return page;
}
const fill = (page, sel, v) => page.fill(sel, v);

await t('anchos 320–1280 sin desplazamiento horizontal ni errores', async () => {
  for (const w of [320, 360, 390, 768, 1280]) {
    const page = await newPage({ viewport: { width: w, height: 800 } });
    for (const step of [1, 2, 3]) {
      await page.click(`.step-tab[data-go="${step}"]`);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 0, `${w}px paso ${step}: sobra ${over}px`);
      if (step !== 1 || w === 390) await page.screenshot({ path: `${SHOTS}/w${w}-paso${step}.png`, fullPage: true });
    }
    assert(!page.errors.length, `${w}px errores: ${page.errors.join(' | ')}`);
    await page.context().close();
  }
});

await t('primera pantalla móvil: promesa y acciones visibles sin desplazar', async () => {
  const page = await newPage({ viewport: { width: 360, height: 640 } });
  await page.screenshot({ path: `${SHOTS}/primera-pantalla-360.png` });
  for (const sel of ['#hero-title', '#btn-start', '#btn-example']) {
    const box = await page.locator(sel).boundingBox();
    assert(box && box.y + box.height <= 640, `${sel} fuera de la primera pantalla`);
  }
  await page.context().close();
});

await t('ejemplo ficticio identificado y calculado', async () => {
  const page = await newPage();
  await page.click('#btn-example');
  assert(await page.isVisible('#example-banner'), 'sin aviso de ejemplo');
  const txt = await page.textContent('#r-price');
  assert(/\$\d/.test(txt), `precio: ${txt}`);
  assert((await page.textContent('#res-status')) === 'Cálculo completo', 'no completo');
  await page.context().close();
});

await t('flujo nuevo (prueba 3 por la interfaz): $1.50 costo, $2.50 a 40%', async () => {
  const page = await newPage();
  await page.click('#btn-start');
  assert(!(await page.isVisible('#example-banner')), 'receta nueva marcada como ejemplo');
  assert((await page.textContent('#res-status')) === 'Cálculo incompleto', 'debería estar incompleto');
  await fill(page, '#f-name', 'Prueba 3');
  await fill(page, '#f-produced', '12');
  await fill(page, '#f-sellable', '12');
  await page.click('[data-next="2"]');
  const id = await page.getAttribute('.ing', 'data-id');
  await fill(page, `#i-${id}-name`, 'Mezcla');
  await fill(page, `#i-${id}-price`, '8');
  await page.selectOption(`#i-${id}-boughtUnit`, 'u');
  await fill(page, `#i-${id}-boughtQty`, '1');
  await fill(page, `#i-${id}-usedQty`, '1');
  await fill(page, '#f-packaging', '0,1666666667');
  await fill(page, '#f-laborTime', '1');
  await fill(page, '#f-hourlyPay', '5');
  await fill(page, '#f-energy', '1');
  await fill(page, '#f-overhead', '2');
  await page.click('[data-next="3"]');
  await fill(page, '#f-margin', '40');
  assert((await page.textContent('#r-unit')) === '$1.50', `unitario ${await page.textContent('#r-unit')}`);
  assert((await page.textContent('#r-batch')) === '$18.00', `lote ${await page.textContent('#r-batch')}`);
  assert((await page.textContent('#r-price')) === '$2.50', `precio ${await page.textContent('#r-price')}`);
  // comparador con precio manual 0
  await fill(page, '#f-manualPrice', '0');
  const sim = await page.textContent('#r-sim');
  assert(sim.includes('No definido'), 'margen con precio 0 debería ser no definido');
  assert(await page.locator('#r-profit-note.neg').count() === 1, 'pérdida no señalada');
  await fill(page, '#f-manualPrice', '1,20');
  assert((await page.textContent('#r-sim')).includes('−'), 'sin signo de resta');
  await page.screenshot({ path: `${SHOTS}/perdida-390.png`, fullPage: true });
  // 1,50 no es 150
  await fill(page, '#f-manualPrice', '1,50');
  assert((await page.textContent('#r-sim-title')).includes('$1.50'), 'coma decimal mal interpretada');
  assert(!page.errors.length, page.errors.join(' | '));
  await page.context().close();
});

await t('prueba 5 por la interfaz: costo $10, margen 30% => $14.29', async () => {
  const page = await newPage();
  await page.click('#btn-start');
  await fill(page, '#f-produced', '1'); await fill(page, '#f-sellable', '1');
  const id = await page.getAttribute('.ing', 'data-id');
  await page.click('.step-tab[data-go="2"]');
  await fill(page, `#i-${id}-price`, '10'); await page.selectOption(`#i-${id}-boughtUnit`, 'u');
  await fill(page, `#i-${id}-boughtQty`, '1'); await fill(page, `#i-${id}-usedQty`, '1');
  await page.click('.step-tab[data-go="3"]');
  await fill(page, '#f-margin', '30');
  assert((await page.textContent('#r-price')) === '$14.29', await page.textContent('#r-price'));
  const ex = await page.textContent('#r-explain');
  assert(ex.includes('$13.00') && ex.includes('23.08%'), `explicación: ${ex}`);
  await page.context().close();
});

await t('comisiones (prueba 6) por la interfaz: $2.39', async () => {
  const page = await newPage();
  await page.click('#btn-start');
  await fill(page, '#f-produced', '1'); await fill(page, '#f-sellable', '1');
  const id = await page.getAttribute('.ing', 'data-id');
  await page.click('.step-tab[data-go="2"]');
  await fill(page, `#i-${id}-price`, '1,50'); await page.selectOption(`#i-${id}-boughtUnit`, 'u');
  await fill(page, `#i-${id}-boughtQty`, '1'); await fill(page, `#i-${id}-usedQty`, '1');
  await page.click('.step-tab[data-go="3"]');
  await fill(page, '#f-margin', '30');
  await page.click('#adv summary');
  await page.check('#f-adv');
  await fill(page, '#f-adv-q', '6'); await fill(page, '#f-adv-r', '5'); await fill(page, '#f-adv-f', '0,30');
  assert((await page.textContent('#r-price')) === '$2.39', await page.textContent('#r-price'));
  assert((await page.textContent('#r-sim-title')).startsWith('Un pedido de 6'), 'totales no descritos por pedido');
  await fill(page, '#f-adv-r', '75');
  assert((await page.textContent('#res-status')) === 'Cálculo incompleto', 'margen+comisión imposible aceptado');
  assert(!(await page.textContent('body')).includes('Infinity') && !(await page.textContent('body')).includes('NaN'), 'Infinity/NaN visible');
  await page.context().close();
});

await t('validación: vacíos, 0 vendibles, cantidad comprada 0, unidades incompatibles, miles ambiguos', async () => {
  const page = await newPage();
  await page.click('#btn-start');
  await fill(page, '#f-produced', '10'); await fill(page, '#f-sellable', '0');
  await page.click('[data-next="2"]');
  await page.click('.step-tab[data-go="1"]');
  assert((await page.textContent('#e-sellable')).includes('mayor que 0'), 'sin error vendibles 0');
  await fill(page, '#f-sellable', '12');
  assert((await page.textContent('#e-sellable')).includes('más que las producidas'), 'vendibles > producidas');
  await fill(page, '#f-sellable', '10');
  assert((await page.textContent('#e-sellable')) === '', 'error no se limpia');
  await page.click('.step-tab[data-go="2"]');
  const id = await page.getAttribute('.ing', 'data-id');
  await fill(page, `#i-${id}-price`, '1.500,00');
  await page.locator(`#i-${id}-price`).blur();
  assert((await page.textContent(`[id="e-ing:${id}:price"]`)).includes('separador'), 'miles ambiguos aceptados');
  await fill(page, `#i-${id}-price`, '2');
  await fill(page, `#i-${id}-boughtQty`, '0');
  await page.locator(`#i-${id}-boughtQty`).blur();
  assert((await page.textContent(`[id="e-ing:${id}:boughtQty"]`)).includes('mayor que 0'), 'cantidad comprada 0');
  // unidades incompatibles: el selector solo ofrece la misma familia
  await page.selectOption(`#i-${id}-boughtUnit`, 'kg');
  const opts = await page.$$eval(`#i-${id}-usedUnit option`, (o) => o.map((x) => x.value));
  assert(opts.join() === 'kg,g', `opciones ${opts}`);
  const miss = await page.textContent('#res-missing');
  assert(miss.includes('Falta') || miss.includes('debe'), 'no dice qué falta');
  assert(!page.errors.length, page.errors.join(' | '));
  await page.context().close();
});

await t('agregar, duplicar, quitar y deshacer ingrediente', async () => {
  const page = await newPage();
  await page.click('#btn-example');
  await page.click('.step-tab[data-go="2"]');
  const n0 = await page.locator('.ing').count();
  await page.click('.ing >> nth=0 >> [data-act="dup"]');
  assert((await page.locator('.ing').count()) === n0 + 1, 'duplicar');
  await page.click('.ing >> nth=0 >> [data-act="del"]');
  assert((await page.locator('.ing').count()) === n0, 'quitar');
  assert(await page.isVisible('#toast-undo'), 'sin deshacer');
  await page.click('#toast-undo');
  assert((await page.locator('.ing').count()) === n0 + 1, 'deshacer');
  await page.click('#btn-add-ing');
  assert((await page.locator('.ing').count()) === n0 + 2, 'agregar');
  await page.context().close();
});

await t('guardar, recargar, duplicar y borrar receta con confirmación', async () => {
  const page = await newPage();
  await page.click('#btn-start');
  await fill(page, '#f-name', 'Tres leches de prueba');
  await fill(page, '#f-produced', '8');
  await page.waitForTimeout(700);
  assert((await page.textContent('#save-state')) === 'Guardado en este dispositivo', await page.textContent('#save-state'));
  await page.reload();
  assert((await page.inputValue('#f-name')) === 'Tres leches de prueba', 'no se recuperó');
  assert((await page.inputValue('#f-produced')) === '8', 'no se recuperó producidas');
  await page.click('#btn-dup');
  assert((await page.inputValue('#f-name')).endsWith('(copia)'), 'duplicado');
  const count = await page.locator('#recipe-select option').count();
  await page.click('#btn-del');
  assert(await page.isVisible('#dlg'), 'sin confirmación');
  await page.click('#dlg-cancel'); await page.waitForTimeout(100);
  assert((await page.locator('#recipe-select option').count()) === count, 'borró al cancelar');
  await page.click('#btn-del');
  await page.click('#dlg-ok'); await page.waitForTimeout(100);
  assert((await page.locator('#recipe-select option').count()) === count - 1, 'no borró');
  await page.context().close();
});

await t('cambio de moneda pide confirmación y no convierte importes', async () => {
  const page = await newPage();
  await page.click('#btn-example');
  const before = await page.textContent('#r-price');
  await page.click('.step-tab[data-go="1"]');
  await page.selectOption('#f-currency', 'MXN');
  assert(await page.isVisible('#dlg'), 'sin confirmación');
  await page.click('#dlg-cancel'); await page.waitForTimeout(100);
  assert((await page.inputValue('#f-currency')) === 'USD', 'no revirtió');
  await page.selectOption('#f-currency', 'MXN');
  await page.click('#dlg-ok'); await page.waitForTimeout(100);
  const after = await page.textContent('#r-price');
  assert(after.replace(/[^\d.]/g, '') === before.replace(/[^\d.]/g, ''), `${before} -> ${after}`);
  assert(after.includes('MX'), after);
  await page.context().close();
});

await t('exportar e importar respaldo', async () => {
  const page = await newPage({ acceptDownloads: true });
  await page.click('#btn-example');
  await page.click('#backup summary');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const path = await dl.path();
  const json = readFileSync(path, 'utf8');
  assert(JSON.parse(json).app === 'dona-fresa', 'respaldo inválido');
  writeFileSync(`${SHOTS}/respaldo.json`, json);
  const page2 = await newPage();
  await page2.click('#backup summary');
  const n = await page2.locator('#recipe-select option').count();
  await page2.setInputFiles('#file-import', `${SHOTS}/respaldo.json`);
  await page2.waitForFunction(() => document.getElementById('backup-status').textContent !== '');
  assert((await page2.textContent('#backup-status')).startsWith('Importaste 1'), await page2.textContent('#backup-status'));
  assert((await page2.locator('#recipe-select option').count()) === n + 1, 'no se agregó');
  writeFileSync(`${SHOTS}/malo.json`, '{"hola":1}');
  await page2.setInputFiles('#file-import', `${SHOTS}/malo.json`);
  await page2.waitForFunction(() => document.getElementById('backup-status').textContent.includes('respaldo válido'));
  assert((await page2.textContent('#backup-status')).includes('no es un respaldo'), 'aceptó archivo inválido');
  // nombre con HTML se trata como texto
  await page2.click('.step-tab[data-go="1"]');
  await fill(page2, '#f-name', '<img src=x onerror="window.__xss=1">');
  assert(!(await page2.evaluate(() => window.__xss)), 'XSS');
  await page.context().close(); await page2.context().close();
});

await t('almacenamiento bloqueado: calcula igual y avisa', async () => {
  const page = await newPage({}, () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('bloqueado', 'SecurityError'); } }); });
  assert((await page.textContent('#save-state')).includes('temporales'), await page.textContent('#save-state'));
  await page.click('#btn-example');
  assert((await page.textContent('#res-status')) === 'Cálculo completo', 'no calcula');
  assert(!page.errors.length, page.errors.join(' | '));
  await page.context().close();
});

await t('copiar resumen con alternativa si falla el portapapeles', async () => {
  const page = await newPage({}, () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) } }); });
  await page.click('#btn-example');
  await page.click('#btn-copy');
  assert(await page.isVisible('#copy-fallback'), 'sin alternativa');
  assert((await page.inputValue('#copy-fallback')).includes('Costo por unidad'), 'resumen vacío');
  await page.context().close();
});

await t('teclado: el primer foco útil es la acción principal y el foco es visible', async () => {
  const page = await newPage({ viewport: { width: 1280, height: 900 } });
  await page.keyboard.press('Tab'); // enlace de salto
  await page.keyboard.press('Tab');
  assert((await page.evaluate(() => document.activeElement.id)) === 'btn-start', await page.evaluate(() => document.activeElement.id));
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  assert(outline !== 'none', 'foco invisible');
  await page.context().close();
});

await t('objetivos táctiles de al menos 44 px (móvil)', async () => {
  const page = await newPage({ viewport: { width: 360, height: 800 } });
  await page.click('.step-tab[data-go="2"]');
  const small = await page.$$eval('button:not(.linklike), select, input:not([type=file]):not([type=checkbox])', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 43.5).map((e) => e.id || e.className));
  assert(!small.length, small.join(', '));
  await page.context().close();
});

await t('movimiento reducido e impresión', async () => {
  const page = await newPage({ reducedMotion: 'reduce' });
  await page.click('#btn-example');
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration);
  assert(anim === '0s', `transición ${anim}`);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: `${SHOTS}/resumen.pdf`, format: 'A4' });
  const visible = await page.evaluate(() => [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.tagName));
  assert(visible.join() === 'print-sheet', `visible al imprimir: ${visible}`);
  assert((await page.textContent('#print-sheet')).includes('Costo por unidad'), 'resumen imprimible vacío');
  await page.context().close();
});

await t('tema oscuro sin errores', async () => {
  const page = await newPage({ colorScheme: 'dark', viewport: { width: 390, height: 800 } });
  await page.click('#btn-example');
  await page.screenshot({ path: `${SHOTS}/oscuro-paso3.png`, fullPage: true });
  assert(!page.errors.length, page.errors.join(' | '));
  await page.context().close();
});

// Rendimiento: CPU 4x más lenta + red "Slow 4G" simulada
await t('rendimiento móvil simulado (LCP, CLS, interacción)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.click('#btn-example');
  await page.click('.step-tab[data-go="3"]');
  const t0 = Date.now();
  await page.fill('#f-margin', '35');
  const typeMs = Date.now() - t0;
  const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: window.__cls }));
  results.push(`     LCP ${m.lcp} ms · CLS ${m.cls.toFixed(3)} · escribir margen y recalcular ${typeMs} ms (CPU 4x, 150 ms latencia, 1.6 Mbps)`);
  assert(m.lcp < 2500, `LCP ${m.lcp}`);
  assert(m.cls < 0.1, `CLS ${m.cls}`);
  await ctx.close();
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodas las pruebas de navegador pasaron');
process.exit(failed ? 1 : 0);
