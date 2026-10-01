// 纯计算函数：单位换算、卡路里、目标与差额。不依赖 DOM，可在 node 下测试。

const KG_PER_LB = 0.45359237;
const KCAL = { p: 4, c: 4, f: 9 };
export const MACROS = ['p', 'c', 'f'];

const round = (n, digits = 1) => {
  const k = 10 ** digits;
  return Math.round((n + Number.EPSILON) * k) / k;
};

const mapMacros = (fn) => ({ p: fn('p'), c: fn('c'), f: fn('f') });

export const lbToKg = (lb) => lb * KG_PER_LB;
export const kgToLb = (kg) => kg / KG_PER_LB;

// 体重内部一律以 kg 全精度保存，只在显示时取 1 位小数
export const fromInputWeight = (value, unit) => (unit === 'lb' ? lbToKg(value) : value);
export const toDisplayWeight = (kg, unit) => round(unit === 'lb' ? kgToLb(kg) : kg);

export const calories = (m) => round(m.p * KCAL.p + m.c * KCAL.c + m.f * KCAL.f, 0);

// 含膳食纤维、糖醇的食物按 4/4/9 会算高，所以包装上的卡路里（kcal）填了就优先用
export const kcalOf = (item) => (typeof item.kcal === 'number' ? item.kcal : calories(item));

export const sumKcal = (entries = []) => round(entries.reduce((sum, e) => sum + kcalOf(e), 0), 0);

export const sumEntries =(entries = []) =>
  mapMacros((k) => round(entries.reduce((sum, e) => sum + e[k], 0)));

export const targetGrams = (targets, kg) => mapMacros((k) => round(targets[k] * kg));

export const remaining = (target, eaten) => mapMacros((k) => round(target[k] - eaten[k]));

export const multiples = (eaten, kg) => mapMacros((k) => round(eaten[k] / kg, 2));

// 取 date 当天或之前最近一次的体重；日期键是 YYYY-MM-DD，字符串比较即时间顺序
export function weightOn(weights, date) {
  let best = null;
  for (const key of Object.keys(weights)) {
    if (key <= date && (best === null || key > best)) best = key;
  }
  return best === null ? null : weights[best];
}

// amount：basis 为 100g 时是克数，为 serving 时是份数
export function foodPortion(food, amount) {
  const factor = food.basis === '100g' ? amount / 100 : amount;
  const portion = mapMacros((k) => round(food[k] * factor));
  if (typeof food.kcal === 'number') portion.kcal = round(food.kcal * factor, 0);
  return portion;
}

const pad = (n) => String(n).padStart(2, '0');

export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseDateKey = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function shiftDate(key, days) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}
