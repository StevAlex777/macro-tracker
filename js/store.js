// 本地存储读写与备份校验。storage 由调用方传入，便于测试。

export const STORAGE_KEY = 'macro-tracker-v1';

export const defaultState = () => ({
  // mode：multiples = 三个倍数；kcal = 定总热量，碳水取余数
  settings: { unit: 'lb', targets: { p: 2, c: 2, f: 0.8 }, mode: 'multiples', kcalTarget: null },
  weights: {},
  entries: {},
  foods: [],
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isAmount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isDateKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k);
const hasMacros = (v) => isObject(v) && isAmount(v.p) && isAmount(v.c) && isAmount(v.f);
const isEntry = (v) => hasMacros(v) && typeof v.name === 'string' && (v.kcal === undefined || isAmount(v.kcal));
const isFood = (v) => isEntry(v) && (v.basis === '100g' || v.basis === 'serving');

// 缺的字段用默认值补齐，这样旧版本存档也能读
function withDefaults(raw) {
  const base = defaultState();
  const settings = isObject(raw.settings) ? raw.settings : {};
  return {
    settings: {
      unit: settings.unit === 'kg' ? 'kg' : base.settings.unit,
      targets: { ...base.settings.targets, ...(isObject(settings.targets) ? settings.targets : {}) },
      mode: settings.mode === 'kcal' ? 'kcal' : base.settings.mode,
      kcalTarget: isAmount(settings.kcalTarget) ? settings.kcalTarget : base.settings.kcalTarget,
    },
    weights: isObject(raw.weights) ? raw.weights : base.weights,
    entries: isObject(raw.entries) ? raw.entries : base.entries,
    foods: Array.isArray(raw.foods) ? raw.foods : base.foods,
  };
}

function isValid(state) {
  const { settings, weights, entries, foods } = state;
  return (
    hasMacros(settings.targets) &&
    Object.entries(weights).every(([k, v]) => isDateKey(k) && isAmount(v) && v > 0) &&
    Object.entries(entries).every(([k, list]) => isDateKey(k) && Array.isArray(list) && list.every(isEntry)) &&
    foods.every(isFood)
  );
}

export function load(storage) {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (!text) return defaultState();
    const raw = JSON.parse(text);
    if (!isObject(raw)) return defaultState();
    return withDefaults(raw);
  } catch {
    return defaultState();
  }
}

export function save(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// 解析导入的备份；格式不对就抛错，调用方不应覆盖现有数据
export function parseBackup(text) {
  const invalid = new Error('不是有效的备份文件');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalid;
  }
  const looksLikeBackup = isObject(raw) && ['settings', 'weights', 'entries', 'foods'].some((k) => k in raw);
  if (!looksLikeBackup) throw invalid;
  const state = withDefaults(raw);
  if (!isValid(state)) throw invalid;
  return state;
}
