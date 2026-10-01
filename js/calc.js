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

// ---------- 趋势与消耗估算 ----------

const DAY_MS = 86400000;
const KCAL_PER_KG = 7700; // 每公斤体重变化约对应的热量，粗略值
const dayNumber = (key) => Math.round(parseDateKey(key).getTime() / DAY_MS);
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
const keysBetween = (obj, from, to) => Object.keys(obj).filter((k) => k >= from && k <= to).sort();

// 每个称重日取含当天在内前 days 天的平均，用来抹平水分造成的日间波动
export function rollingAverage(weights, days = 7) {
  return Object.keys(weights).sort().map((date) => {
    const window = keysBetween(weights, shiftDate(date, -(days - 1)), date);
    return { date, kg: round(mean(window.map((k) => weights[k])), 2) };
  });
}

// 最小二乘直线。se 是斜率的标准误；点数不足或都在同一个 x 上时返回 null
export function linearTrend(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  const sse = points.reduce((s, p) => s + (p.y - my - slope * (p.x - mx)) ** 2, 0);
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : 0;
  return { slope, se };
}

function weightTrend(weights, today, windowDays) {
  const keys = keysBetween(weights, shiftDate(today, -(windowDays - 1)), today);
  const points = keys.map((k) => ({ x: dayNumber(k), y: weights[k] }));
  const spanDays = keys.length ? points[points.length - 1].x - points[0].x : 0;
  return { trend: linearTrend(points), weighIns: keys.length, spanDays, meanKg: keys.length ? mean(points.map((p) => p.y)) : null };
}

export function weeklyRate(weights, today, windowDays = 21) {
  const { trend, weighIns, spanDays, meanKg } = weightTrend(weights, today, windowDays);
  if (!trend || weighIns < 4 || spanDays < 7) return { ok: false, weighIns, spanDays };
  const kgPerWeek = trend.slope * 7;
  return { ok: true, kgPerWeek: round(kgPerWeek, 2), pctPerWeek: round((kgPerWeek / meanKg) * 100, 2), weighIns, spanDays };
}

// 有记录的天的平均摄入；不含今天，因为今天通常还没吃完
function intakeWindow(entries, today, days) {
  return keysBetween(entries, shiftDate(today, -days), shiftDate(today, -1)).filter((k) => entries[k].length > 0);
}

export function averageIntake(entries, today, days = 7) {
  const keys = intakeWindow(entries, today, days);
  if (keys.length === 0) return null;
  const totals = keys.map((k) => sumEntries(entries[k]));
  return {
    days: keys.length,
    kcal: round(mean(keys.map((k) => sumKcal(entries[k]))), 0),
    ...mapMacros((m) => round(mean(totals.map((t) => t[m])))),
  };
}

export const EXPENDITURE_NEEDS = { weighIns: 8, spanDays: 14, loggedDays: 10 };

// 实际消耗 ≈ 平均摄入 − 体重变化折算的热量。low/high 来自斜率 ±1 个标准误
export function estimateExpenditure(weights, entries, today, windowDays = 28) {
  const { trend, weighIns, spanDays } = weightTrend(weights, today, windowDays);
  const logged = intakeWindow(entries, today, windowDays);
  const have = { weighIns, spanDays, loggedDays: logged.length };
  const enough = trend && Object.keys(EXPENDITURE_NEEDS).every((k) => have[k] >= EXPENDITURE_NEEDS[k]);
  if (!enough) return { ok: false, ...have };
  const avgIntake = mean(logged.map((k) => sumKcal(entries[k])));
  const at = (slope) => round(avgIntake - slope * KCAL_PER_KG, 0);
  return {
    ok: true,
    kcal: at(trend.slope),
    low: at(trend.slope + trend.se),
    high: at(trend.slope - trend.se),
    avgIntake: round(avgIntake, 0),
    ...have,
  };
}

export const kgPerWeekFromDeficit = (kcalPerDay) => round((kcalPerDay * 7) / KCAL_PER_KG, 2);

// ---------- 目标模式与达标判断 ----------

// 两种设法统一成 {p, c, f, kcal}。定总热量模式下碳水取余数
export function dailyTarget(settings, kg) {
  const grams = targetGrams(settings.targets, kg);
  if (settings.mode !== 'kcal' || settings.kcalTarget == null) {
    return { ...grams, kcal: calories(grams), overBudget: false };
  }
  const rest = settings.kcalTarget - grams.p * 4 - grams.f * 9;
  return { ...grams, c: round(Math.max(0, rest) / 4), kcal: settings.kcalTarget, overBudget: rest < 0 };
}

const TOLERANCE = 0.05;

// floor（蛋白质）：吃够就算达标，多吃不算超。ceiling（碳水、脂肪、总热量）：超过容差才算超
export function status(kind, eaten, target) {
  if (eaten < target * (1 - TOLERANCE)) return 'under';
  if (kind === 'ceiling' && eaten > target * (1 + TOLERANCE)) return 'over';
  return 'met';
}
