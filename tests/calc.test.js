import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDecimal, ingredientCost, batchCost, priceForMargin, evaluatePrice,
  breakEvenPrice, ceilToMinor, computeRecipe,
} from '../src/calc.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('1. harina $2/kg, uso 250 g = $0.50', () => {
  close(ingredientCost({ price: 2, boughtQty: 1, boughtUnit: 'kg', usedQty: 250, usedUnit: 'g' }), 0.5);
});

test('2. leche $1.50/l, uso 200 ml = $0.30', () => {
  close(ingredientCost({ price: 1.5, boughtQty: 1, boughtUnit: 'l', usedQty: 200, usedUnit: 'ml' }), 0.3);
});

test('3. lote $18, 12 vendibles = $1.50; margen 40% = $2.50', () => {
  const b = batchCost({ ingredients: [8], packagingPerUnit: 2 / 12, sellable: 12, produced: 12, laborHours: 1, hourlyPay: 5, energy: 1, overhead: 2 });
  close(b.total, 18);
  close(b.unitCost, 1.5);
  const p = priceForMargin(b.unitCost, 0.4);
  assert.equal(p.charged, 2.5); // sin el falso 2.51 por coma flotante
  close(p.realMargin, 0.4);
});

test('4. rendimiento menor vs. variación de empaques', () => {
  // Costo total fijo en $18 (empaque total fijo de $2) con 10 vendibles: $1.80
  const fixedTotal = batchCost({ ingredients: [8], packagingPerUnit: 2 / 10, sellable: 10, produced: 12, laborHours: 1, hourlyPay: 5, energy: 1, overhead: 2 });
  close(fixedTotal.total, 18);
  close(fixedTotal.unitCost, 1.8);
  // Con empaque POR UNIDAD constante, solo se empacan 10: el lote baja y el unitario es distinto
  const perUnit = batchCost({ ingredients: [8], packagingPerUnit: 2 / 12, sellable: 10, produced: 12, laborHours: 1, hourlyPay: 5, energy: 1, overhead: 2 });
  close(perUnit.packaging, 10 * (2 / 12));
  close(perUnit.total, 16 + 10 / 6);
  assert.ok(Math.abs(perUnit.unitCost - 1.8) > 0.01);
  close(perUnit.unitCost, (16 + 10 / 6) / 10);
});

test('5. costo $10, margen 30% => cobra $14.29, no $13', () => {
  const p = priceForMargin(10, 0.3);
  close(p.theoretical, 10 / 0.7);
  assert.equal(p.charged, 14.29);
  close(p.realMargin, (14.29 - 10) / 14.29);
  assert.ok(p.realMargin >= 0.3);
  // $13 es recargo de 30%, margen ~23.08%
  const at13 = evaluatePrice(13, 10);
  close(at13.markup, 0.3);
  close(at13.realMargin, 3 / 13);
  assert.equal(Math.round(at13.realMargin * 10000) / 100, 23.08);
});

test('6. comisiones: cu 1.50, f 0.30, q 6, r 5%, margen 30% => 1.55/0.65, cobra $2.39', () => {
  const fees = { r: 0.05, f: 0.3, q: 6 };
  const p = priceForMargin(1.5, 0.3, fees);
  close(p.theoretical, 1.55 / 0.65);
  assert.equal(p.charged, 2.39);
  const benefit = 6 * 2.39 * 0.95 - 6 * 1.5 - 0.3;
  close(p.profit, benefit);
  close(p.realMargin, benefit / (6 * 2.39));
  close(breakEvenPrice(1.5, fees), 1.55 / 0.95);
});

test('ceilToMinor', () => {
  assert.equal(ceilToMinor(2.5000000000000004), 2.5);
  assert.equal(ceilToMinor(2.3846), 2.39);
  assert.equal(ceilToMinor(1234.001, 0), 1235);
});

test('7a. parseo decimal', () => {
  assert.deepEqual(parseDecimal('1,50'), { ok: true, value: 1.5 });
  assert.deepEqual(parseDecimal('1.50'), { ok: true, value: 1.5 });
  assert.deepEqual(parseDecimal(' 250 '), { ok: true, value: 250 });
  assert.deepEqual(parseDecimal(',5'), { ok: true, value: 0.5 });
  assert.equal(parseDecimal('').empty, true);
  assert.equal(parseDecimal('1.500,00').ok, false);
  assert.equal(parseDecimal('1,500.00').ok, false);
  assert.equal(parseDecimal('abc').ok, false);
  assert.equal(parseDecimal('1e5').ok, false);
  assert.equal(parseDecimal('Infinity').ok, false);
});

const base = () => ({
  currency: 'USD', produced: '12', sellable: '12', margin: '40', manualPrice: '',
  ingredients: [{ id: 'a', name: 'Harina', price: '8', boughtQty: '1', boughtUnit: 'u', usedQty: '1', usedUnit: 'u' }],
  packaging: '0,1666666667', laborTime: '60', laborUnit: 'min', hourlyPay: '5', energy: '1', overhead: '2',
  advanced: { enabled: false, r: '', f: '', q: '1', delivery: '' },
});

test('receta completa en texto reproduce la prueba 3', () => {
  const r = computeRecipe(base());
  assert.equal(r.status, 'ok');
  assert.ok(Math.abs(r.batch.unitCost - 1.5) < 1e-6);
  assert.equal(r.suggested.charged, 2.5);
});

test('7b. errores: rendimiento 0, cantidad comprada 0, vacíos, unidades incompatibles', () => {
  const zero = computeRecipe({ ...base(), sellable: '0' });
  assert.equal(zero.status, 'incomplete');
  assert.ok(zero.errors.some((e) => e.field === 'sellable'));

  const more = computeRecipe({ ...base(), sellable: '13' });
  assert.ok(more.errors.some((e) => /más que las producidas/.test(e.msg)));

  const b = base(); b.ingredients[0].boughtQty = '0';
  assert.ok(computeRecipe(b).errors.some((e) => e.field === 'ing:a:boughtQty'));

  const empty = computeRecipe({ ...base(), produced: '', margin: '' });
  assert.equal(empty.status, 'incomplete');
  assert.ok(empty.errors.some((e) => e.msg === 'Falta unidades producidas'));
  assert.ok(empty.errors.some((e) => e.field === 'margin'));
  assert.equal(JSON.stringify(empty).includes('NaN'), false);

  const inc = base(); inc.ingredients[0].boughtUnit = 'kg'; inc.ingredients[0].usedUnit = 'ml';
  assert.ok(computeRecipe(inc).errors.some((e) => /no se puede convertir/.test(e.msg)));

  const neg = computeRecipe({ ...base(), energy: '-1' });
  assert.ok(neg.errors.some((e) => e.field === 'energy'));

  const noIng = computeRecipe({ ...base(), ingredients: [{ id: 'x', name: '', price: '', boughtQty: '', usedQty: '', boughtUnit: 'g', usedUnit: 'g' }] });
  assert.ok(noIng.errors.some((e) => e.field === 'ingredients'));
});

test('ingrediente gratis (precio 0) es válido', () => {
  const b = base(); b.ingredients.push({ id: 'z', name: 'Menta del jardín', price: '0', boughtQty: '1', boughtUnit: 'u', usedQty: '1', usedUnit: 'u' });
  assert.equal(computeRecipe(b).status, 'ok');
});

test('7c. precio manual cero: pérdida y margen no definido', () => {
  const r = computeRecipe({ ...base(), manualPrice: '0' });
  assert.equal(r.status, 'ok');
  assert.equal(r.sim.revenue, 0);
  assert.ok(r.sim.profit < 0);
  assert.equal(r.sim.realMargin, null);
  assert.ok(r.simBatch.profit < 0);
});

test('precio manual negativo en beneficio se muestra, no se oculta', () => {
  const r = computeRecipe({ ...base(), manualPrice: '1,20' });
  assert.equal(r.manual, 1.2);
  assert.ok(r.sim.profit < 0 && r.sim.realMargin < 0);
});

test('7d. margen/comisión imposibles', () => {
  assert.equal(computeRecipe({ ...base(), margin: '100' }).status, 'incomplete');
  const adv = { ...base(), margin: '60', advanced: { enabled: true, r: '45', f: '0', q: '1', delivery: '0' } };
  const r = computeRecipe(adv);
  assert.equal(r.status, 'incomplete');
  assert.ok(r.errors.some((e) => /menos de 100%/.test(e.msg)));
  assert.equal(priceForMargin(1, 0.7, { r: 0.3 }).ok, false);
  assert.throws(() => priceForMargin(1, 0.2, { r: 0, f: 0, q: 1.5 }));
  const q = computeRecipe({ ...base(), advanced: { enabled: true, r: '5', f: '0,30', q: '2,5', delivery: '' } });
  assert.ok(q.errors.some((e) => e.field === 'adv.q'));
});

test('comisiones en receta: totales por pedido cuando hay tarifa fija', () => {
  const b = { ...base(), margin: '30', advanced: { enabled: true, r: '5', f: '0,30', q: '6', delivery: '' } };
  const r = computeRecipe(b);
  assert.equal(r.status, 'ok');
  assert.equal(r.perOrder, true);
  assert.equal(r.simBatch, null);
  assert.equal(r.suggested.charged, 2.39);
});

test('moneda sin decimales (CLP) redondea a unidades', () => {
  const r = computeRecipe({ ...base(), currency: 'CLP', ingredients: [{ id: 'a', name: 'x', price: '1000', boughtQty: '1', boughtUnit: 'u', usedQty: '1', usedUnit: 'u' }], packaging: '', laborTime: '', hourlyPay: '', energy: '', overhead: '', sellable: '3', produced: '3', margin: '40' });
  assert.equal(r.status, 'ok');
  assert.equal(r.suggested.charged, Math.ceil(1000 / 3 / 0.6));
});
