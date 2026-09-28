// Estado y persistencia local (localStorage con versión de esquema).
// Todo lo guardado son textos tal como se escribieron; se tratan como texto, nunca como HTML.

export const SCHEMA = 1;
export const KEY = 'donafresa.recetas';
export const MAX_IMPORT_BYTES = 1_000_000;
const MAX_RECIPES = 200;
const MAX_INGREDIENTS = 100;
const MAX_TEXT = 120;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function blankIngredient() {
  return { id: uid(), name: '', price: '', boughtQty: '', boughtUnit: 'kg', usedQty: '', usedUnit: 'g' };
}

export function blankRecipe(currency = 'USD') {
  return {
    id: uid(), name: 'Mi receta', example: false, currency,
    produced: '', sellable: '',
    ingredients: [blankIngredient()],
    packaging: '', laborTime: '', laborUnit: 'h', hourlyPay: '', energy: '', overhead: '',
    margin: '40', manualPrice: '',
    advanced: { enabled: false, r: '', f: '', q: '1', delivery: '' },
    updatedAt: Date.now(),
  };
}

/** Ejemplo FICTICIO para demostrar la herramienta. Precios inventados, no de mercado. */
export function exampleRecipe() {
  const ing = (name, price, boughtQty, boughtUnit, usedQty, usedUnit) => ({ id: uid(), name, price, boughtQty, boughtUnit, usedQty, usedUnit });
  return {
    ...blankRecipe('USD'),
    name: 'Ejemplo ficticio: 12 cupcakes de fresa',
    example: true,
    produced: '12', sellable: '11',
    ingredients: [
      ing('Harina', '2', '1', 'kg', '250', 'g'),
      ing('Leche', '1,50', '1', 'l', '200', 'ml'),
      ing('Azúcar', '1,80', '1', 'kg', '200', 'g'),
      ing('Mantequilla', '3,20', '500', 'g', '150', 'g'),
      ing('Huevos', '3', '12', 'u', '3', 'u'),
      ing('Fresas', '2,50', '500', 'g', '250', 'g'),
    ],
    packaging: '0,25', laborTime: '2', laborUnit: 'h', hourlyPay: '3', energy: '0,80', overhead: '0,50',
    margin: '40',
  };
}

const TEXT_FIELDS = ['produced', 'sellable', 'packaging', 'laborTime', 'hourlyPay', 'energy', 'overhead', 'margin', 'manualPrice'];
const ING_FIELDS = ['name', 'price', 'boughtQty', 'usedQty'];
const UNITS = ['g', 'kg', 'ml', 'l', 'u'];
const str = (v, max = 40) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');

/** Valida y limpia una receta de origen no confiable. Devuelve null si no tiene forma de receta. */
export function sanitizeRecipe(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (!Array.isArray(r.ingredients)) return null;
  const out = blankRecipe(/^[A-Z]{3}$/.test(r.currency) ? r.currency : 'USD');
  out.id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : uid();
  out.name = str(r.name, MAX_TEXT).trim() || 'Receta sin nombre';
  out.example = r.example === true;
  for (const k of TEXT_FIELDS) out[k] = str(r[k]);
  out.laborUnit = r.laborUnit === 'min' ? 'min' : 'h';
  out.ingredients = r.ingredients.slice(0, MAX_INGREDIENTS).filter((i) => i && typeof i === 'object').map((i) => {
    const o = blankIngredient();
    for (const k of ING_FIELDS) o[k] = str(i[k], k === 'name' ? MAX_TEXT : 40);
    o.boughtUnit = UNITS.includes(i.boughtUnit) ? i.boughtUnit : 'g';
    o.usedUnit = UNITS.includes(i.usedUnit) ? i.usedUnit : o.boughtUnit;
    return o;
  });
  if (!out.ingredients.length) out.ingredients = [blankIngredient()];
  const a = r.advanced && typeof r.advanced === 'object' ? r.advanced : {};
  out.advanced = { enabled: a.enabled === true, r: str(a.r), f: str(a.f), q: str(a.q) || '1', delivery: str(a.delivery) };
  out.updatedAt = Number.isFinite(r.updatedAt) ? r.updatedAt : Date.now();
  return out;
}

/** Interpreta un respaldo JSON. Lanza Error con mensaje para la persona si no es válido. */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_IMPORT_BYTES) throw new Error('El archivo es demasiado grande (máximo 1 MB).');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('El archivo no es un respaldo válido de Doña Fresa.'); }
  if (!data || data.app !== 'dona-fresa' || !Array.isArray(data.recipes)) throw new Error('El archivo no es un respaldo válido de Doña Fresa.');
  if (typeof data.schema !== 'number' || data.schema > SCHEMA) throw new Error('Este respaldo viene de una versión más nueva de la calculadora.');
  const recipes = data.recipes.slice(0, MAX_RECIPES).map(sanitizeRecipe).filter(Boolean);
  if (!recipes.length) throw new Error('El respaldo no contiene recetas.');
  return recipes;
}

export function makeBackup(recipes) {
  return JSON.stringify({ app: 'dona-fresa', schema: SCHEMA, exportedAt: new Date().toISOString(), recipes }, null, 2);
}

/** Crea un almacén sobre un Storage (localStorage o un doble para pruebas). Nunca lanza. */
export function createStore(storage) {
  let available = false;
  try {
    const t = '__df_test__';
    storage.setItem(t, '1');
    storage.removeItem(t);
    available = true;
  } catch { available = false; }

  return {
    get available() { return available; },
    load() {
      if (!available) return null;
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || data.schema !== SCHEMA || !Array.isArray(data.recipes)) return null;
        const recipes = data.recipes.map(sanitizeRecipe).filter(Boolean);
        if (!recipes.length) return null;
        return { recipes, activeId: recipes.some((r) => r.id === data.activeId) ? data.activeId : recipes[0].id };
      } catch { return null; }
    },
    save(recipes, activeId) {
      if (!available) return false;
      try {
        storage.setItem(KEY, JSON.stringify({ schema: SCHEMA, activeId, recipes }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Importa sin pisar: si un id ya existe, la receta importada recibe uno nuevo. */
export function mergeRecipes(existing, incoming) {
  const ids = new Set(existing.map((r) => r.id));
  const added = incoming.map((r) => (ids.has(r.id) ? { ...r, id: uid() } : r));
  return [...existing, ...added];
}
