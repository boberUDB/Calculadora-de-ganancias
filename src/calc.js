// Funciones puras de costos de Doña Fresa.
// Sin DOM ni almacenamiento: todo lo que entra son datos y todo lo que sale son datos.

export const UNITS = {
  g: { family: 'masa', factor: 1, label: 'g' },
  kg: { family: 'masa', factor: 1000, label: 'kg' },
  ml: { family: 'volumen', factor: 1, label: 'ml' },
  l: { family: 'volumen', factor: 1000, label: 'l' },
  u: { family: 'unidades', factor: 1, label: 'unidades' },
};

const EPS = 1e-9;

/**
 * Convierte texto a número aceptando punto o coma como separador DECIMAL.
 * Sin separadores de miles: "1,50" => 1.5, "1.50" => 1.5, "1500" => 1500.
 * "1.500,00" o "1,500.00" se rechazan por ambiguos.
 * @returns {{ empty: true } | { ok: true, value: number } | { ok: false, error: string }}
 */
export function parseDecimal(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  if (s === '') return { empty: true };
  if (!/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) {
    if (/\d[.,]\d*[.,]/.test(s)) {
      return { ok: false, error: 'Usa un solo separador decimal y sin separador de miles. Ej.: 1500 o 1,50' };
    }
    return { ok: false, error: 'Escribe solo números. Ej.: 2,50 o 2.50' };
  }
  const value = Number(s.replace(',', '.'));
  if (!Number.isFinite(value)) return { ok: false, error: 'Número no válido' };
  return { ok: true, value };
}

/** Convierte una cantidad a g, ml o unidades. */
export function normalize(qty, unit) {
  const u = UNITS[unit];
  if (!u) throw new Error(`Unidad desconocida: ${unit}`);
  return { value: qty * u.factor, family: u.family };
}

export function sameFamily(a, b) {
  return !!UNITS[a] && !!UNITS[b] && UNITS[a].family === UNITS[b].family;
}

/** costoIngrediente = precioCompra * cantidadUsadaNormalizada / cantidadCompradaNormalizada */
export function ingredientCost({ price, boughtQty, boughtUnit, usedQty, usedUnit }) {
  if (!(price >= 0) || !Number.isFinite(price)) throw new Error('precio inválido');
  if (!(boughtQty > 0) || !Number.isFinite(boughtQty)) throw new Error('cantidad comprada debe ser positiva');
  if (!(usedQty >= 0) || !Number.isFinite(usedQty)) throw new Error('cantidad usada inválida');
  if (!sameFamily(boughtUnit, usedUnit)) throw new Error('unidades incompatibles');
  return (price * normalize(usedQty, usedUnit).value) / normalize(boughtQty, boughtUnit).value;
}

/**
 * costoLote = ingredientes + empaquePorUnidad * vendibles + trabajo + energía + gastos
 * costoUnitario = costoLote / vendibles
 */
export function batchCost({ ingredients, packagingPerUnit = 0, sellable, produced, laborHours = 0, hourlyPay = 0, energy = 0, overhead = 0 }) {
  if (!(sellable > 0)) throw new Error('las unidades vendibles deben ser mayores que 0');
  if (produced != null && sellable > produced + EPS) throw new Error('vendibles no puede superar producidas');
  const ingredientsTotal = ingredients.reduce((s, c) => s + c, 0);
  const packaging = packagingPerUnit * sellable;
  const labor = laborHours * hourlyPay;
  const total = ingredientsTotal + packaging + labor + energy + overhead;
  return { ingredients: ingredientsTotal, packaging, labor, energy, overhead, total, unitCost: total / sellable };
}

/** Cifras decimales de la moneda (USD 2, CLP 0...). */
export function minorDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

/** Redondea hacia arriba a la mínima unidad, tolerando el ruido de coma flotante (1.5/0.6 = 2.5000000000000004). */
export function ceilToMinor(x, digits = 2) {
  const k = 10 ** digits;
  const s = x * k;
  const r = Math.round(s);
  return (Math.abs(s - r) < 1e-7 ? r : Math.ceil(s)) / k;
}

export function roundToMinor(x, digits = 2) {
  const k = 10 ** digits;
  return Math.round(x * k + (x >= 0 ? 1e-9 : -1e-9)) / k;
}

const NO_FEES = { r: 0, f: 0, q: 1, delivery: 0 };

/** Costo efectivo por unidad de un pedido: c = costoUnitario + (f + entrega) / q */
function effectiveCost(unitCost, fees) {
  const { f = 0, q = 1, delivery = 0 } = fees;
  return unitCost + (f + delivery) / q;
}

function checkFees({ r = 0, f = 0, q = 1, delivery = 0 }) {
  if (!(r >= 0 && r < 1)) throw new Error('comisión porcentual fuera de rango');
  if (!(f >= 0) || !(delivery >= 0)) throw new Error('costos por pedido no pueden ser negativos');
  if (!(Number.isInteger(q) && q > 0)) throw new Error('unidades por pedido debe ser entero positivo');
}

/**
 * Precio por unidad para un MARGEN SOBRE VENTA (no recargo sobre costo).
 * precio = c / (1 - r - margen). Devuelve el teórico y el cobrado (redondeado hacia arriba).
 */
export function priceForMargin(unitCost, margin, fees = NO_FEES, digits = 2) {
  const f = { ...NO_FEES, ...fees };
  checkFees(f);
  if (!(margin >= 0 && margin < 1)) throw new Error('margen fuera de rango');
  const denom = 1 - f.r - margin;
  if (denom <= EPS) return { ok: false, error: 'El margen más la comisión deben sumar menos de 100%.' };
  const theoretical = effectiveCost(unitCost, f) / denom;
  const charged = ceilToMinor(theoretical, digits);
  return { ok: true, theoretical, charged, ...evaluatePrice(charged, unitCost, f) };
}

/**
 * Resultado de vender un pedido de q unidades a un precio unitario.
 * beneficioPedido = q*precio*(1-r) - q*costoUnitario - f - entrega
 * margenReal = beneficio / ingreso (null si el ingreso es 0).
 */
export function evaluatePrice(price, unitCost, fees = NO_FEES) {
  const f = { ...NO_FEES, ...fees };
  checkFees(f);
  if (!(price >= 0) || !Number.isFinite(price)) throw new Error('precio inválido');
  const revenue = f.q * price;
  const commissions = revenue * f.r + f.f;
  const costs = f.q * unitCost + f.delivery;
  const profit = revenue - commissions - costs;
  return {
    revenue,
    commissions,
    costs,
    profit,
    realMargin: revenue > 0 ? profit / revenue : null,
    markup: unitCost > 0 ? (price - unitCost) / unitCost : null,
  };
}

/** Precio mínimo por unidad sin perder: c / (1 - r) */
export function breakEvenPrice(unitCost, fees = NO_FEES) {
  const f = { ...NO_FEES, ...fees };
  checkFees(f);
  return effectiveCost(unitCost, f) / (1 - f.r);
}

/** Resultado del lote completo si todas las vendibles se venden a `price` (solo sin cargos fijos por pedido). */
export function batchOutcome(price, batch, sellable, r = 0) {
  const revenue = price * sellable;
  const commissions = revenue * r;
  const profit = revenue - commissions - batch.total;
  return { revenue, commissions, costs: batch.total, profit, realMargin: revenue > 0 ? profit / revenue : null };
}

// ---------- Receta completa (entrada en texto, tal como la escribe la persona) ----------

const num = (raw, field, label, errors, { required = false, min = 0, allowZero = true, integer = false } = {}) => {
  const p = parseDecimal(raw);
  if (p.empty) {
    if (required) errors.push({ field, msg: `Falta ${label}` });
    return required ? null : 0;
  }
  if (!p.ok) {
    errors.push({ field, msg: p.error });
    return null;
  }
  if (p.value < min) {
    errors.push({ field, msg: `${cap(label)} no puede ser negativo` });
    return null;
  }
  if (!allowZero && p.value === 0) {
    errors.push({ field, msg: `${cap(label)} debe ser mayor que 0` });
    return null;
  }
  if (integer && !Number.isInteger(p.value)) {
    errors.push({ field, msg: `${cap(label)} debe ser un número entero` });
    return null;
  }
  return p.value;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function isBlankIngredient(ing) {
  return ['name', 'price', 'boughtQty', 'usedQty'].every((k) => String(ing[k] ?? '').trim() === '');
}

/**
 * Calcula una receta guardada como texto. Nunca devuelve NaN: si falta algo, status = 'incomplete'
 * y `errors` dice exactamente qué campo falta o está mal.
 */
export function computeRecipe(recipe) {
  const errors = [];
  const digits = minorDigits(recipe.currency || 'USD');

  const produced = num(recipe.produced, 'produced', 'unidades producidas', errors, { required: true, allowZero: false });
  const sellable = num(recipe.sellable, 'sellable', 'unidades vendibles', errors, { required: true, allowZero: false });
  if (produced != null && sellable != null && sellable > produced) {
    errors.push({ field: 'sellable', msg: 'Las vendibles no pueden ser más que las producidas' });
  }

  const ingredientLines = [];
  const rows = (recipe.ingredients || []).filter((i) => !isBlankIngredient(i));
  if (rows.length === 0) errors.push({ field: 'ingredients', msg: 'Agrega al menos un ingrediente' });
  rows.forEach((ing) => {
    const who = ing.name?.trim() || 'un ingrediente sin nombre';
    const f = (k) => `ing:${ing.id}:${k}`;
    const before = errors.length;
    const price = num(ing.price, f('price'), `precio de ${who}`, errors, { required: true });
    const boughtQty = num(ing.boughtQty, f('boughtQty'), `cantidad comprada de ${who}`, errors, { required: true, allowZero: false });
    const usedQty = num(ing.usedQty, f('usedQty'), `cantidad usada de ${who}`, errors, { required: true });
    if (!sameFamily(ing.boughtUnit, ing.usedUnit)) {
      errors.push({ field: f('usedUnit'), msg: `En ${who}: no se puede convertir ${UNITS[ing.boughtUnit]?.label} a ${UNITS[ing.usedUnit]?.label}. Usa la misma medida del envase.` });
    }
    if (errors.length === before) {
      ingredientLines.push({ id: ing.id, name: who, cost: ingredientCost({ price, boughtQty, boughtUnit: ing.boughtUnit, usedQty, usedUnit: ing.usedUnit }) });
    }
  });

  const packagingPerUnit = num(recipe.packaging, 'packaging', 'empaque por unidad', errors);
  const laborTime = num(recipe.laborTime, 'laborTime', 'tiempo de trabajo', errors);
  const hourlyPay = num(recipe.hourlyPay, 'hourlyPay', 'pago por hora', errors);
  const energy = num(recipe.energy, 'energy', 'gas o electricidad', errors);
  const overhead = num(recipe.overhead, 'overhead', 'gastos generales', errors);

  const marginPct = num(recipe.margin, 'margin', 'margen deseado', errors, { required: true });
  if (marginPct != null && marginPct >= 100) errors.push({ field: 'margin', msg: 'El margen debe ser menor que 100%' });

  let fees = NO_FEES;
  const adv = recipe.advanced || {};
  if (adv.enabled) {
    const r = num(adv.r, 'adv.r', 'comisión porcentual', errors);
    const fixed = num(adv.f, 'adv.f', 'comisión fija por pedido', errors);
    const delivery = num(adv.delivery, 'adv.delivery', 'costo de entrega por pedido', errors);
    const q = num(adv.q, 'adv.q', 'unidades por pedido', errors, { required: true, allowZero: false, integer: true });
    if (r != null && r >= 100) errors.push({ field: 'adv.r', msg: 'La comisión debe ser menor que 100%' });
    if ([r, fixed, delivery, q].every((v) => v != null) && r < 100) fees = { r: r / 100, f: fixed, q, delivery };
    if (r != null && marginPct != null && r < 100 && marginPct < 100 && r + marginPct >= 100) {
      errors.push({ field: 'margin', msg: 'Margen + comisión deben sumar menos de 100%' });
    }
  }

  let manual = null;
  const manualParsed = parseDecimal(recipe.manualPrice);
  if (!manualParsed.empty) {
    if (!manualParsed.ok) errors.push({ field: 'manualPrice', msg: manualParsed.error });
    else if (manualParsed.value < 0) errors.push({ field: 'manualPrice', msg: 'El precio no puede ser negativo' });
    else manual = roundToMinor(manualParsed.value, digits);
  }

  if (errors.length) return { status: 'incomplete', errors, ingredientLines, digits };

  const laborHours = recipe.laborUnit === 'min' ? laborTime / 60 : laborTime;
  const batch = batchCost({ ingredients: ingredientLines.map((l) => l.cost), packagingPerUnit, sellable, produced, laborHours, hourlyPay, energy, overhead });
  const margin = marginPct / 100;
  const suggested = priceForMargin(batch.unitCost, margin, fees, digits);
  if (!suggested.ok) return { status: 'incomplete', errors: [{ field: 'margin', msg: suggested.error }], ingredientLines, digits };

  const perOrder = fees.f > 0 || fees.delivery > 0; // con cargos fijos los totales describen un pedido de q unidades
  const simPrice = manual ?? suggested.charged;
  const sim = evaluatePrice(simPrice, batch.unitCost, fees);
  return {
    status: 'ok',
    errors: [],
    digits,
    ingredientLines,
    batch,
    sellable,
    produced,
    margin,
    fees,
    advanced: !!adv.enabled,
    perOrder,
    suggested,
    manual,
    simPrice,
    sim,
    simBatch: perOrder ? null : batchOutcome(simPrice, batch, sellable, fees.r),
    breakEven: breakEvenPrice(batch.unitCost, fees),
    laborCaptured: laborTime > 0 && hourlyPay > 0,
    laborWithoutPay: laborTime > 0 && !(hourlyPay > 0),
  };
}
