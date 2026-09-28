import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, blankRecipe, exampleRecipe, makeBackup, parseBackup, mergeRecipes, KEY } from '../src/store.js';
import { computeRecipe } from '../src/calc.js';

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
class BrokenStorage { getItem() { throw new Error('denied'); } setItem() { throw new Error('denied'); } removeItem() {} }

test('8a. guardar y recargar', () => {
  const mem = new MemStorage();
  const s = createStore(mem);
  assert.equal(s.available, true);
  const r = exampleRecipe();
  assert.equal(s.save([r], r.id), true);
  const s2 = createStore(mem);
  const loaded = s2.load();
  assert.equal(loaded.activeId, r.id);
  assert.deepEqual(loaded.recipes[0].ingredients.map((i) => i.name), r.ingredients.map((i) => i.name));
  assert.equal(computeRecipe(loaded.recipes[0]).status, 'ok');
});

test('8b. el ejemplo ficticio calcula', () => {
  const r = computeRecipe(exampleRecipe());
  assert.equal(r.status, 'ok');
  assert.ok(r.batch.unitCost > 0);
});

test('8c. fallo de almacenamiento no bloquea cálculos', () => {
  const s = createStore(new BrokenStorage());
  assert.equal(s.available, false);
  assert.equal(s.load(), null);
  assert.equal(s.save([blankRecipe()], 'x'), false);
  assert.equal(computeRecipe(exampleRecipe()).status, 'ok');
});

test('8d. datos guardados corruptos se ignoran', () => {
  const mem = new MemStorage();
  mem.setItem(KEY, '{no json');
  assert.equal(createStore(mem).load(), null);
});

test('8e. exportar e importar respaldo, duplicados con id nuevo', () => {
  const a = exampleRecipe();
  const b = { ...blankRecipe(), name: '<img src=x onerror=alert(1)>' };
  const json = makeBackup([a, b]);
  const back = parseBackup(json);
  assert.equal(back.length, 2);
  assert.equal(back[1].name, '<img src=x onerror=alert(1)>'); // se conserva como texto; la UI usa textContent/value
  const merged = mergeRecipes([a], back);
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map((r) => r.id)).size, 3);
});

test('8f. respaldos inválidos se rechazan con mensaje', () => {
  assert.throws(() => parseBackup('hola'), /no es un respaldo/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'otra', recipes: [] })), /no es un respaldo/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'dona-fresa', schema: 99, recipes: [] })), /más nueva/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'dona-fresa', schema: 1, recipes: [{ foo: 1 }] })), /no contiene/);
  assert.throws(() => parseBackup('x'.repeat(1_000_001)), /demasiado grande/);
});
