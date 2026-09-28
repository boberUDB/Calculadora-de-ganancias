// Interfaz de la calculadora. Los cálculos viven en calc.js; el guardado en store.js.
import { computeRecipe, UNITS, roundToMinor } from './calc.js';
import { createStore, blankRecipe, blankIngredient, exampleRecipe, makeBackup, parseBackup, mergeRecipes, uid, MAX_IMPORT_BYTES } from './store.js';
import { KIT, SITE_URL, kitIsLive } from './config.js';
import { track } from './analytics.js';
import { mascotSVG } from './mascot.js';

/* global __PREVIEW__ */
const PREVIEW = typeof __PREVIEW__ !== 'undefined' && __PREVIEW__;
const $ = (id) => document.getElementById(id);
const LOCALE = 'es-US';
const CURRENCIES = [
  ['USD', 'Dólar estadounidense'], ['MXN', 'Peso mexicano'], ['GTQ', 'Quetzal'], ['HNL', 'Lempira'],
  ['NIO', 'Córdoba'], ['CRC', 'Colón costarricense'], ['PAB', 'Balboa'], ['DOP', 'Peso dominicano'],
  ['COP', 'Peso colombiano'], ['PEN', 'Sol peruano'], ['CLP', 'Peso chileno'], ['ARS', 'Peso argentino'],
  ['BOB', 'Boliviano'], ['PYG', 'Guaraní'], ['UYU', 'Peso uruguayo'], ['VES', 'Bolívar'], ['EUR', 'Euro'],
];
const UNIT_ORDER = ['kg', 'g', 'l', 'ml', 'u'];

// ---------- Estado ----------
let store;
try { store = createStore(window.localStorage); } catch { store = createStore(null); }

const S = { recipes: [], activeId: null, step: 1, touched: new Set(), shown: new Set(), lastStatus: null, lastKey: '', booted: false };
const active = () => S.recipes.find((r) => r.id === S.activeId);

// ---------- Formato ----------
const fmtCache = new Map();
function money(x, cur = active().currency) {
  let f = fmtCache.get(cur);
  if (!f) {
    try { f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur }); } catch { f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'USD' }); }
    fmtCache.set(cur, f);
  }
  return f.format(Object.is(x, -0) ? 0 : x);
}
const pctFmt = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 2 });
const pct = (x) => pctFmt.format(x);
function curSymbol(cur) {
  try { return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: cur }).formatToParts(0).find((p) => p.type === 'currency')?.value || cur; } catch { return cur; }
}

// ---------- Utilidades de interfaz ----------
function getPath(r, k) { return k.startsWith('adv.') ? r.advanced[k.slice(4)] : r[k]; }
function setPath(r, k, v) { if (k.startsWith('adv.')) r.advanced[k.slice(4)] = v; else r[k] = v; }
function stepOf(field) {
  if (field === 'produced' || field === 'sellable') return 1;
  if (field === 'margin' || field === 'manualPrice' || field.startsWith('adv.')) return 3;
  return 2;
}
function h(tag, attrs = {}, text) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'for' || k === 'role') el.setAttribute(k, v); else el[k] = v;
  }
  if (text != null) el.textContent = text;
  return el;
}

function confirmDialog({ title, text, ok = 'Aceptar' }) {
  const dlg = $('dlg');
  if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  $('dlg-title').textContent = title;
  $('dlg-text').textContent = text;
  $('dlg-ok').textContent = ok;
  dlg.returnValue = '';
  dlg.showModal();
  return new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once: true }));
}

let toastTimer;
function toast(text, onUndo) {
  $('toast-text').textContent = text;
  const undo = $('toast-undo');
  undo.hidden = !onUndo;
  undo.onclick = () => { $('toast').hidden = true; onUndo?.(); };
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, onUndo ? 7000 : 3000);
}

async function copyText(text, fallbackEl, statusEl, okMsg) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
    await navigator.clipboard.writeText(text);
    fallbackEl.hidden = true;
    statusEl.textContent = okMsg;
  } catch {
    fallbackEl.value = text;
    fallbackEl.hidden = false;
    fallbackEl.focus();
    fallbackEl.select();
    statusEl.textContent = 'No se pudo copiar automáticamente. El texto está seleccionado: cópialo desde aquí.';
  }
}

// ---------- Guardado ----------
let saveTimer;
function setSaveState() {
  const el = $('save-state');
  if (!store.available) { el.textContent = 'Sin guardado: los cambios son temporales'; el.classList.add('warn'); return; }
  el.classList.remove('warn');
  el.textContent = 'Guardado en este dispositivo';
}
function scheduleSave() {
  if (!store.available) return;
  $('save-state').textContent = 'Guardando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!store.available) return setSaveState();
  const r = active();
  if (r) r.updatedAt = Date.now();
  if (!store.save(S.recipes, S.activeId)) {
    const el = $('save-state');
    el.textContent = 'No se pudo guardar: descarga un respaldo';
    el.classList.add('warn');
  } else setSaveState();
}

// ---------- Recetas ----------
function renderRecipeSelect() {
  const sel = $('recipe-select');
  sel.replaceChildren(...S.recipes.map((r) => h('option', { value: r.id, selected: r.id === S.activeId }, r.name || 'Receta sin nombre')));
}
function selectRecipe(id) {
  S.activeId = id;
  bindRecipe();
  saveNow();
}
function isPristine(r) {
  return !r.example && r.produced === '' && r.sellable === '' && r.ingredients.every((i) => !i.name && !i.price && !i.boughtQty && !i.usedQty);
}

function bindRecipe() {
  const r = active();
  document.querySelectorAll('#form [data-k]').forEach((el) => {
    const v = getPath(r, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
  syncRange();
  $('adv').open = !!r.advanced.enabled;
  $('adv-fields').classList.toggle('off', !r.advanced.enabled);
  $('example-banner').hidden = !r.example;
  S.touched.clear();
  S.shown.clear();
  S.lastStatus = null;
  renderRecipeSelect();
  renderIngredients();
  updateCurrencyPrefix();
  update();
}

function updateCurrencyPrefix() {
  const sym = curSymbol(active().currency);
  document.querySelectorAll('.money').forEach((m) => {
    m.querySelector('.cur').textContent = sym;
    m.style.setProperty('--cur-w', `${Math.max(1, sym.length)}ch`);
  });
}

// ---------- Ingredientes ----------
function unitOptions(select, units, value) {
  select.replaceChildren(...units.map((u) => h('option', { value: u, selected: u === value }, u === 'u' ? 'unid.' : UNITS[u].label)));
}
function familyUnits(u) { return UNIT_ORDER.filter((x) => UNITS[x].family === UNITS[u]?.family); }

function ingredientItem(ing, n) {
  const id = ing.id;
  const f = (k) => `ing:${id}:${k}`;
  const input = (k, attrs) => {
    const el = h('input', { id: `i-${id}-${k}`, 'data-ing': id, 'data-ik': k, 'data-field': f(k), 'aria-describedby': `e-${f(k)}`, ...attrs });
    el.value = ing[k] ?? '';
    return el;
  };
  const money = (el) => { const w = h('div', { class: 'money' }); w.append(h('span', { class: 'cur', 'aria-hidden': 'true' }), el); return w; };
  const err = (k) => h('p', { class: 'err', id: `e-${f(k)}` });

  const li = h('li', { class: 'ing', 'data-id': id });
  const top = h('div', { class: 'ing-top' });
  const nameField = h('div', { class: 'field' });
  nameField.append(h('label', { for: `i-${id}-name` }, `Ingrediente ${n}`), input('name', { type: 'text', maxLength: 120, placeholder: 'Ej.: Harina', autocomplete: 'off' }));
  top.append(nameField);

  const buy = h('div', { class: 'ing-line', role: 'group', 'aria-labelledby': `i-${id}-buy` });
  const bu = h('select', { id: `i-${id}-boughtUnit`, 'data-ing': id, 'data-ik': 'boughtUnit', 'aria-label': 'Unidad del paquete' });
  unitOptions(bu, UNIT_ORDER, ing.boughtUnit);
  buy.append(
    h('span', { class: 'lead', id: `i-${id}-buy` }, 'Lo compras a'),
    money(input('price', { inputMode: 'decimal', placeholder: '2,00', 'aria-label': 'Precio que pagaste' })),
    h('span', { class: 'word', 'aria-hidden': 'true' }, 'por'),
    input('boughtQty', { inputMode: 'decimal', placeholder: '1', 'aria-label': 'Cantidad que trae el paquete' }),
    bu,
  );

  const use = h('div', { class: 'ing-line ing-use', role: 'group', 'aria-labelledby': `i-${id}-use` });
  const uu = h('select', { id: `i-${id}-usedUnit`, 'data-ing': id, 'data-ik': 'usedUnit', 'data-field': f('usedUnit'), 'aria-label': 'Unidad usada', 'aria-describedby': `e-${f('usedUnit')}` });
  unitOptions(uu, UNITS[ing.usedUnit]?.family === UNITS[ing.boughtUnit]?.family ? familyUnits(ing.boughtUnit) : UNIT_ORDER, ing.usedUnit);
  use.append(
    h('span', { class: 'lead', id: `i-${id}-use` }, 'Usas en este lote'),
    input('usedQty', { inputMode: 'decimal', placeholder: '250', 'aria-label': 'Cantidad usada en el lote' }),
    uu,
  );

  const foot = h('div', { class: 'ing-foot' });
  const btns = h('div', { class: 'ing-btns' });
  const label = ing.name?.trim() || `ingrediente ${n}`;
  btns.append(
    h('button', { type: 'button', class: 'icon-btn', 'data-act': 'dup', 'aria-label': `Duplicar ${label}` }, 'Duplicar'),
    h('button', { type: 'button', class: 'icon-btn del', 'data-act': 'del', 'aria-label': `Quitar ${label}` }, 'Quitar'),
  );
  foot.append(h('span', { class: 'ing-cost muted', id: `c-${id}` }, 'Costo: completa los datos'), btns);

  li.append(top, buy, err('price'), err('boughtQty'), use, err('usedQty'), err('usedUnit'), foot);
  return li;
}

function renderIngredients(focusId) {
  const list = $('ing-list');
  list.replaceChildren(...active().ingredients.map((ing, i) => ingredientItem(ing, i + 1)));
  updateCurrencyPrefix();
  if (focusId) $(`i-${focusId}-name`)?.focus();
}

function onIngredientAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.ing').dataset.id;
  const r = active();
  const idx = r.ingredients.findIndex((i) => i.id === id);
  if (idx < 0) return;
  if (btn.dataset.act === 'dup') {
    const copy = { ...r.ingredients[idx], id: uid() };
    r.ingredients.splice(idx + 1, 0, copy);
    renderIngredients(copy.id);
  } else {
    const [removed] = r.ingredients.splice(idx, 1);
    renderIngredients();
    const next = r.ingredients[Math.min(idx, r.ingredients.length - 1)];
    (next ? $(`i-${next.id}-name`) : $('btn-add-ing')).focus();
    toast(`Quitaste ${removed.name?.trim() || 'un ingrediente'}`, () => {
      if (active() !== r) return;
      r.ingredients.splice(Math.min(idx, r.ingredients.length), 0, removed);
      renderIngredients(removed.id);
      update(); scheduleSave();
    });
  }
  update(); scheduleSave();
}

// ---------- Pasos ----------
function go(n, { focus = true } = {}) {
  if (n > S.step) S.shown.add(S.step);
  S.step = n;
  const calc = $('calc');
  calc.dataset.step = String(n);
  document.querySelectorAll('.step-tab').forEach((b) => (b.dataset.go === String(n) ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
  $('step-progress').textContent = `Paso ${n} de 3`;
  document.body.classList.toggle('show-mini', n !== 3);
  renderErrors(S.lastRes);
  if (focus) {
    const top = calc.querySelector('.stepper').getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) calc.querySelector('.stepper').scrollIntoView({ block: 'start' });
    const legend = calc.querySelector(`.step[data-step="${n}"] .step-title`);
    legend.setAttribute('tabindex', '-1');
    legend.focus({ preventScroll: true });
  }
}

function syncRange() {
  const v = parseFloat(String(active().margin).replace(',', '.'));
  $('f-margin-range').value = Number.isFinite(v) ? Math.min(80, Math.max(0, v)) : 40;
}

// ---------- Cálculo y resultados ----------
function update() {
  const r = active();
  const res = computeRecipe(r);
  S.lastRes = res;
  renderErrors(res);
  renderIngredientCosts(res);
  renderResults(res);
  renderMini(res);
  announce(res);
  if (S.booted && res.status === 'ok' && S.lastStatus === 'incomplete') celebrate();
  S.lastStatus = res.status;
}

function renderErrors(res) {
  if (!res) return;
  const msgs = new Map();
  for (const e of res.errors) if (!msgs.has(e.field)) msgs.set(e.field, e.msg);
  document.querySelectorAll('#form .err[id^="e-"]').forEach((p) => {
    const field = p.id.slice(2);
    const msg = msgs.get(field);
    const show = !!msg && (S.touched.has(field) || S.shown.has(stepOf(field)));
    p.textContent = show ? msg : '';
    const input = document.querySelector(`#form [data-field="${CSS.escape(field)}"]`) || $(`f-${field}`);
    if (input) input.setAttribute('aria-invalid', show ? 'true' : 'false');
  });
}

function renderIngredientCosts(res) {
  const costs = new Map(res.ingredientLines.map((l) => [l.id, l.cost]));
  for (const ing of active().ingredients) {
    const el = $(`c-${ing.id}`);
    if (!el) continue;
    const c = costs.get(ing.id);
    el.textContent = c != null ? `Costo en el lote: ${money(c)}` : 'Costo: completa los datos';
    el.classList.toggle('muted', c == null);
  }
}

const BAR_PARTS = [
  ['ingredients', 'Ingredientes', 'var(--bar-1)'],
  ['packaging', 'Empaque', 'var(--bar-2)'],
  ['labor', 'Tu tiempo', 'var(--bar-3)'],
  ['energy', 'Gas o electricidad', 'var(--bar-4)'],
  ['overhead', 'Gastos generales', 'var(--bar-5)'],
];

function kvRow(label, value, { neg = false, total = false } = {}) {
  const d = h('div', { class: total ? 'total' : '' });
  d.append(h('dt', {}, label), h('dd', { class: neg ? 'neg' : '' }, value));
  return d;
}

function renderResults(res) {
  const r = active();
  const ok = res.status === 'ok';
  const pill = $('res-status');
  pill.textContent = ok ? 'Cálculo completo' : 'Cálculo incompleto';
  pill.classList.toggle('ok', ok);
  $('res-body').hidden = !ok;
  renderKit(ok);

  const miss = $('res-missing');
  if (!ok) {
    const seen = new Set();
    const items = res.errors.filter((e) => !seen.has(e.msg) && seen.add(e.msg));
    const ul = h('ul');
    items.slice(0, 8).forEach((e) => {
      const li = h('li');
      li.append(h('button', { type: 'button', class: 'linklike', 'data-jump': e.field }, e.msg));
      ul.append(li);
    });
    if (items.length > 8) ul.append(h('li', {}, `y ${items.length - 8} datos más`));
    miss.replaceChildren(h('p', {}, 'Para calcular falta o hay que corregir:'), ul);
    return;
  }
  miss.replaceChildren();

  const { batch, suggested, sim, simBatch, fees, perOrder, sellable, margin, manual, simPrice } = res;
  $('r-price').textContent = money(suggested.charged);
  $('r-price-sub').textContent = `Para ${pct(margin)} de margen sobre la venta${res.advanced ? ', con comisiones y costos por pedido' : ''}. Margen real con este precio: ${pct(suggested.realMargin)}.`;
  $('r-unit').textContent = money(batch.unitCost);
  $('r-batch').textContent = money(batch.total);
  $('r-break').textContent = money(res.breakEven);

  // Barras del costo del lote
  const parts = BAR_PARTS.filter(([k]) => batch[k] > 0);
  $('r-bars').replaceChildren(...parts.map(([k, , c]) => { const s = h('span'); s.style.flexGrow = String(batch[k]); s.style.background = c; return s; }));
  $('r-bars').setAttribute('aria-label', parts.map(([k, l]) => `${l} ${pct(batch[k] / batch.total)}`).join(', ') || 'Sin costos');
  $('r-legend').replaceChildren(...BAR_PARTS.map(([k, l, c]) => {
    const li = h('li');
    const dot = h('i'); dot.style.background = c;
    li.append(dot, h('span', {}, l), h('b', {}, money(batch[k])), h('span', { class: 'p' }, batch.total > 0 ? pct(batch[k] / batch.total) : '—'));
    return li;
  }));

  // Simulación
  const priceLabel = manual != null ? 'el precio que escribiste' : 'el precio sugerido';
  const q = fees.q;
  $('r-sim-title').textContent = perOrder
    ? `Un pedido de ${q} ${q === 1 ? 'unidad' : 'unidades'} a ${money(simPrice)} (${priceLabel})`
    : `Si vendes las ${sellable} unidades a ${money(simPrice)} (${priceLabel})`;
  const t = perOrder ? sim : simBatch;
  const rows = [kvRow('Ingreso', money(t.revenue))];
  if (res.advanced && t.commissions > 0) rows.push(kvRow('Comisiones de cobro', `− ${money(t.commissions)}`));
  rows.push(kvRow(perOrder ? 'Costos del pedido' : 'Costos del lote', `− ${money(t.costs)}`));
  rows.push(kvRow('Beneficio estimado', money(t.profit), { neg: t.profit < 0, total: true }));
  rows.push(kvRow('Beneficio por unidad', money(sim.profit / q), { neg: sim.profit < 0 }));
  rows.push(kvRow('Margen real sobre la venta', t.realMargin == null ? 'No definido (precio 0)' : pct(t.realMargin), { neg: t.realMargin != null && t.realMargin < 0 }));
  if (sim.markup != null) rows.push(kvRow('Recargo sobre el costo', pct(sim.markup), { neg: sim.markup < 0 }));
  $('r-sim').replaceChildren(...rows);

  const note = $('r-profit-note');
  const labor = res.laborCaptured
    ? `Ya descuenta tu tiempo (${money(batch.labor)} en este lote).`
    : res.laborWithoutPay
      ? 'No pusiste pago por hora, así que este beneficio incluye el pago de tu trabajo.'
      : 'No incluiste tu tiempo, así que este beneficio incluye el pago de tu trabajo.';
  if (t.profit < 0) {
    note.textContent = `Con este precio no se cubren los costos: faltan ${money(-t.profit)}. El precio mínimo sin perder es ${money(res.breakEven)} por unidad. ${labor}`;
  } else {
    note.textContent = `${labor} No descuenta impuestos ni costos que no escribiste.`;
  }
  note.classList.toggle('neg', t.profit < 0);

  // Margen vs. recargo
  const ex = $('r-explain');
  const keep = suggested.profit / q;
  const lines = [
    `<b>Margen sobre la venta:</b> de cada ${esc(money(suggested.charged))} que cobras, te quedan ${esc(money(keep))} después de pagar los costos (${esc(pct(suggested.realMargin))}).`,
  ];
  if (!res.advanced && batch.unitCost > 0) {
    const mk = roundToMinor(batch.unitCost * (1 + margin), res.digits);
    const mkMargin = mk > 0 ? (mk - batch.unitCost) / mk : 0;
    lines.push(`Sumar ${esc(pct(margin))} al costo es otra cosa: ${esc(money(batch.unitCost))} + ${esc(pct(margin))} = ${esc(money(mk))}, y deja solo ${esc(pct(mkMargin))} de margen.`);
  }
  lines.push('Ejemplo: con costo $10 y margen de 30%, el precio es $14.29. Cobrar $13 es sumar 30% al costo y deja un margen de 23.08%.');
  ex.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');

  $('r-fine').textContent = `${res.advanced ? '' : 'No incluye comisiones de cobro. '}El precio sugerido se redondea hacia arriba a la mínima unidad de la moneda y el margen se recalcula con ese precio.`;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

function renderKit(ok) {
  const box = $('kit');
  if (!ok || KIT.status === 'oculto') return box.replaceChildren();
  const list = h('ul');
  KIT.includes.forEach((i) => list.append(h('li', {}, i)));
  if (kitIsLive()) {
    const price = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: KIT.currency }).format(KIT.price);
    const a = h('a', { class: 'btn btn-primary', href: KIT.checkoutUrl, target: '_blank', rel: 'noopener' }, `Ver el kit · ${price}`);
    a.addEventListener('click', () => track('checkout_open', { product: 'kit' }));
    box.replaceChildren(h('h3', {}, KIT.name), list, a);
  } else {
    box.replaceChildren(h('p', { class: 'tag' }, 'En preparación'), h('h3', {}, KIT.name), list, h('p', { class: 'fine' }, 'Todavía no está a la venta. La calculadora es gratis y funciona completa sin el kit.'));
  }
}

function renderMini(res) {
  $('mini-text').textContent = res.status === 'ok'
    ? `Costo ${money(res.batch.unitCost)}/u · Precio ${money(res.suggested.charged)}`
    : `Cálculo incompleto · ${new Set(res.errors.map((e) => e.msg)).size} ${res.errors.length === 1 ? 'dato' : 'datos'} por completar`;
}

let announceTimer;
function announce(res) {
  const key = res.status === 'ok' ? `ok:${res.suggested.charged}:${res.simPrice}` : 'inc';
  if (key === S.lastKey) return;
  S.lastKey = key;
  clearTimeout(announceTimer);
  if (!S.booted) return;
  announceTimer = setTimeout(() => {
    $('announcer').textContent = res.status === 'ok'
      ? `Precio sugerido ${money(res.suggested.charged)} por unidad. Costo por unidad ${money(res.batch.unitCost)}.`
      : 'Cálculo incompleto.';
  }, 1400);
}

function celebrate() {
  document.querySelectorAll('.mascot').forEach((m) => {
    m.classList.remove('happy');
    void m.getBoundingClientRect();
    m.classList.add('happy');
    setTimeout(() => m.classList.remove('happy'), 900);
  });
}

// ---------- Resumen, impresión y compartir ----------
function summaryText() {
  const r = active();
  const res = S.lastRes;
  if (res.status !== 'ok') return '';
  const L = [`${r.name}${r.example ? ' (ejemplo ficticio)' : ''}`, `Unidades vendibles: ${res.sellable} de ${res.produced}`, ''];
  L.push('Ingredientes:');
  res.ingredientLines.forEach((l) => L.push(`- ${l.name}: ${money(l.cost)}`));
  L.push('', ...BAR_PARTS.map(([k, l]) => `${l}: ${money(res.batch[k])}`));
  L.push(`Costo del lote: ${money(res.batch.total)}`, `Costo por unidad: ${money(res.batch.unitCost)}`);
  L.push(`Precio sugerido (${pct(res.margin)} de margen sobre la venta): ${money(res.suggested.charged)}`);
  if (res.manual != null) L.push(`Precio probado: ${money(res.manual)} · margen real ${res.sim.realMargin == null ? 'no definido' : pct(res.sim.realMargin)}`);
  L.push(`Precio mínimo sin perder: ${money(res.breakEven)}`);
  L.push('', res.advanced ? 'Incluye comisiones y costos por pedido indicados.' : 'No incluye comisiones de cobro ni impuestos.', 'Calculado con la calculadora de Doña Fresa.');
  return L.join('\n');
}

function fillPrintSheet() {
  const sheet = $('print-sheet');
  const res = S.lastRes;
  const r = active();
  if (!res || res.status !== 'ok') return sheet.replaceChildren(h('p', {}, 'Completa la receta para imprimir el resumen.'));
  const table = h('table');
  const row = (a, b) => { const tr = h('tr'); tr.append(h('td', {}, a), h('td', { class: 'n' }, b)); table.append(tr); };
  res.ingredientLines.forEach((l) => row(l.name, money(l.cost)));
  BAR_PARTS.slice(1).forEach(([k, l]) => row(l, money(res.batch[k])));
  row('Costo del lote', money(res.batch.total));
  row('Costo por unidad vendible', money(res.batch.unitCost));
  row(`Precio sugerido (${pct(res.margin)} de margen)`, money(res.suggested.charged));
  if (res.manual != null) row('Precio probado', money(res.manual));
  row('Precio mínimo sin perder', money(res.breakEven));
  sheet.replaceChildren(
    h('h1', {}, r.name + (r.example ? ' (ejemplo ficticio)' : '')),
    h('p', {}, `${res.sellable} unidades vendibles de ${res.produced} · ${new Date().toLocaleDateString(LOCALE)}`),
    table,
    h('p', {}, res.advanced ? 'Incluye comisiones y costos por pedido indicados.' : 'No incluye comisiones de cobro ni impuestos.'),
    h('p', {}, 'Doña Fresa · Ponle precio a tus postres'),
  );
}

function shareUrl() { return SITE_URL || `${location.origin}${location.pathname}`; }

// ---------- Respaldo ----------
function importRecipes(text) {
  const status = $('backup-status');
  try {
    const incoming = parseBackup(text);
    const before = S.recipes.length;
    S.recipes = mergeRecipes(S.recipes, incoming);
    S.activeId = S.recipes[before].id;
    bindRecipe();
    go(1, { focus: false });
    saveNow();
    status.textContent = `Importaste ${incoming.length} ${incoming.length === 1 ? 'receta' : 'recetas'}. Tus recetas anteriores siguen aquí.`;
    $('paste-box').hidden = true;
    $('paste-area').value = '';
  } catch (e) {
    status.textContent = e.message || 'No se pudo importar el respaldo.';
  }
}

// ---------- Eventos ----------
function wire() {
  const form = $('form');
  form.addEventListener('submit', (e) => e.preventDefault());

  form.addEventListener('input', (e) => {
    const t = e.target;
    const r = active();
    if (t.id === 'f-margin-range') {
      r.margin = t.value;
      $('f-margin').value = t.value;
    } else if (t.dataset.k && t.dataset.k !== 'currency') {
      setPath(r, t.dataset.k, t.type === 'checkbox' ? t.checked : t.value);
      if (t.dataset.k === 'margin') syncRange();
      if (t.dataset.k === 'name') renderRecipeSelect();
      if (t.dataset.k === 'adv.enabled') $('adv-fields').classList.toggle('off', !t.checked);
    } else if (t.dataset.ing) {
      const ing = r.ingredients.find((i) => i.id === t.dataset.ing);
      if (!ing) return;
      ing[t.dataset.ik] = t.value;
      if (t.dataset.ik === 'boughtUnit') {
        const fam = familyUnits(t.value);
        if (!fam.includes(ing.usedUnit)) ing.usedUnit = t.value === 'kg' ? 'g' : t.value === 'l' ? 'ml' : t.value;
        unitOptions($(`i-${ing.id}-usedUnit`), fam, ing.usedUnit);
      }
      if (t.dataset.ik === 'name') {
        const label = t.value.trim() || 'ingrediente';
        const li = t.closest('.ing');
        li.querySelector('[data-act="dup"]').setAttribute('aria-label', `Duplicar ${label}`);
        li.querySelector('[data-act="del"]').setAttribute('aria-label', `Quitar ${label}`);
      }
    } else return;
    update();
    scheduleSave();
  });

  form.addEventListener('focusout', (e) => {
    const t = e.target;
    const field = t.dataset.field || t.dataset.k;
    if (!field || !t.value) return;
    S.touched.add(field);
    renderErrors(S.lastRes);
  });

  form.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id !== 'f-currency') return;
    const r = active();
    const next = t.value;
    const hasAmounts = [r.packaging, r.hourlyPay, r.energy, r.overhead, r.manualPrice, r.advanced.f, r.advanced.delivery, ...r.ingredients.map((i) => i.price)].some((v) => String(v ?? '').trim() !== '');
    if (hasAmounts) {
      const yes = await confirmDialog({
        title: `¿Cambiar a ${next}?`,
        text: `Solo cambia el símbolo. Los importes no se convierten: un precio de 2 ${r.currency} pasará a leerse como 2 ${next}. Revisa tus precios después.`,
        ok: `Cambiar a ${next}`,
      });
      if (!yes) { t.value = r.currency; return; }
    }
    r.currency = next;
    updateCurrencyPrefix();
    update();
    scheduleSave();
  });

  document.addEventListener('focusin', (e) => { if (e.target.matches('#form input, #form select, #form textarea')) document.body.classList.add('typing'); });
  // Se retrasa para que la barra inferior no aparezca bajo el dedo a mitad de un toque.
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!document.activeElement?.matches('#form input, #form select, #form textarea')) document.body.classList.remove('typing');
  }, 400));

  $('ing-list').addEventListener('click', onIngredientAction);
  $('btn-add-ing').addEventListener('click', () => {
    const ing = blankIngredient();
    active().ingredients.push(ing);
    renderIngredients(ing.id);
    update(); scheduleSave();
  });

  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.go))));
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.next))));
  $('mini-go').addEventListener('click', () => go(3));

  $('res-missing').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    if (!b) return;
    const field = b.dataset.jump;
    go(stepOf(field), { focus: false });
    const el = field === 'ingredients' ? $('btn-add-ing') : (document.querySelector(`#form [data-field="${CSS.escape(field)}"]`) || $(`f-${field}`));
    if (field.startsWith('adv.')) $('adv').open = true;
    el?.scrollIntoView({ block: 'center' });
    el?.focus({ preventScroll: true });
  });

  const startMine = () => {
    const blank = S.recipes.find(isPristine);
    if (blank) selectRecipe(blank.id);
    else {
      const r = blankRecipe(active()?.currency || 'USD');
      S.recipes.push(r);
      selectRecipe(r.id);
    }
    go(1, { focus: false });
    $('calc').scrollIntoView({ block: 'start' });
    $('f-name').focus({ preventScroll: true });
    $('f-name').select();
  };
  $('btn-start').addEventListener('click', startMine);
  $('btn-start-2').addEventListener('click', startMine);
  $('btn-example').addEventListener('click', () => {
    let ex = S.recipes.find((r) => r.example);
    if (!ex) { ex = exampleRecipe(); S.recipes.push(ex); }
    selectRecipe(ex.id);
    go(3, { focus: false });
    $('calc').scrollIntoView({ block: 'start' });
  });

  $('recipe-select').addEventListener('change', (e) => { selectRecipe(e.target.value); go(1, { focus: false }); });
  $('btn-new').addEventListener('click', startMine);
  $('btn-dup').addEventListener('click', () => {
    const src = active();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.example = false;
    copy.name = `${src.name} (copia)`.slice(0, 120);
    copy.ingredients.forEach((i) => { i.id = uid(); });
    S.recipes.splice(S.recipes.indexOf(src) + 1, 0, copy);
    selectRecipe(copy.id);
    toast('Receta duplicada');
  });
  $('btn-del').addEventListener('click', async () => {
    const r = active();
    const yes = await confirmDialog({ title: '¿Borrar esta receta?', text: `Se borrará «${r.name}» de este dispositivo. Si no tienes un respaldo, no se podrá recuperar.`, ok: 'Borrar receta' });
    if (!yes) return;
    const idx = S.recipes.indexOf(r);
    S.recipes.splice(idx, 1);
    if (!S.recipes.length) S.recipes.push(blankRecipe(r.currency));
    selectRecipe(S.recipes[Math.max(0, idx - 1)].id);
    go(1, { focus: false });
    toast('Receta borrada');
  });

  $('btn-copy').addEventListener('click', () => copyText(summaryText(), $('copy-fallback'), $('copy-status'), 'Resumen copiado.'));
  $('btn-print').addEventListener('click', () => { fillPrintSheet(); window.print(); });
  window.addEventListener('beforeprint', fillPrintSheet);
  $('btn-share').addEventListener('click', async () => {
    const url = shareUrl();
    if (navigator.share) {
      try { await navigator.share({ title: 'Doña Fresa: Ponle precio a tus postres', text: 'Calculadora gratis para ponerle precio a tus postres', url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
    }
    copyText(url, $('copy-fallback'), $('copy-status'), 'Enlace copiado. Tus costos no van en el enlace.');
  });

  $('btn-export').addEventListener('click', () => {
    saveNow();
    const blob = new Blob([makeBackup(S.recipes)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `dona-fresa-recetas-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    $('backup-status').textContent = 'Respaldo descargado. Guárdalo donde no se pierda.';
  });
  $('btn-export-copy').addEventListener('click', () => copyText(makeBackup(S.recipes), $('backup-fallback'), $('backup-status'), 'Respaldo copiado. Pégalo en una nota o mensaje para ti.'));
  $('file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { $('backup-status').textContent = 'El archivo es demasiado grande (máximo 1 MB).'; return; }
    importRecipes(await file.text());
  });
  $('btn-paste').addEventListener('click', () => { $('paste-box').hidden = !$('paste-box').hidden; if (!$('paste-box').hidden) $('paste-area').focus(); });
  $('btn-paste-go').addEventListener('click', () => importRecipes($('paste-area').value));

  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
}

// ---------- Inicio ----------
function boot() {
  document.querySelectorAll('#form [data-k]').forEach((el) => { el.dataset.field = el.dataset.k; });
  $('f-currency').replaceChildren(...CURRENCIES.map(([c, n]) => h('option', { value: c }, `${c} · ${n}`)));
  $('hero-mascot').innerHTML = mascotSVG('Doña Fresa');
  $('res-mascot').innerHTML = mascotSVG('Doña Fresa');

  if (PREVIEW) {
    document.querySelectorAll('[data-live-only]').forEach((el) => { el.hidden = true; });
    $('storage-note').textContent += ' En esta vista previa no se puede descargar ni imprimir; en la web publicada sí.';
  }
  if (!store.available) {
    $('storage-note').textContent = 'Este navegador no permite guardar. La calculadora funciona, pero los cambios son temporales: copia un respaldo antes de cerrar.';
  }

  const loaded = store.load();
  if (loaded) { S.recipes = loaded.recipes; S.activeId = loaded.activeId; } else { const ex = exampleRecipe(); S.recipes = [ex]; S.activeId = ex.id; }

  wire();
  bindRecipe();
  go(1, { focus: false });
  setSaveState();
  S.booted = true;
}

boot();
