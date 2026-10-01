import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lbToKg, kgToLb, toDisplayWeight, fromInputWeight, calories, sumEntries,
  targetGrams, remaining, multiples, weightOn, foodPortion, dateKey, shiftDate, kcalOf, sumKcal,
  rollingAverage, linearTrend, weeklyRate, estimateExpenditure, averageIntake, dailyTarget, status, kgPerWeekFromDeficit,
} from '../js/calc.js';

test('165 lb 换算成约 74.84 kg', () => {
  assert.ok(Math.abs(lbToKg(165) - 74.84274105) < 1e-6);
});

test('lb → kg → lb 来回不漂移', () => {
  const kg = fromInputWeight(165, 'lb');
  assert.equal(toDisplayWeight(kg, 'lb'), 165);
  assert.equal(toDisplayWeight(kg, 'kg'), 74.8);
});

test('kg 单位下输入的体重原样保存', () => {
  assert.equal(fromInputWeight(75, 'kg'), 75);
  assert.equal(toDisplayWeight(75, 'lb'), 165.3);
});

test('kgToLb 是 lbToKg 的逆运算', () => {
  assert.ok(Math.abs(kgToLb(lbToKg(200)) - 200) < 1e-9);
});

test('卡路里 = 蛋白×4 + 碳水×4 + 脂肪×9', () => {
  assert.equal(calories({ p: 46, c: 0, f: 5 }), 229);
  assert.equal(calories({ p: 10, c: 20, f: 10 }), 210);
});

test('汇总一天的所有食物', () => {
  const total = sumEntries([
    { p: 46, c: 0, f: 5 },
    { p: 4.5, c: 40, f: 1.2 },
  ]);
  assert.deepEqual(total, { p: 50.5, c: 40, f: 6.2 });
});

test('没有食物时汇总为 0', () => {
  assert.deepEqual(sumEntries([]), { p: 0, c: 0, f: 0 });
  assert.deepEqual(sumEntries(undefined), { p: 0, c: 0, f: 0 });
});

test('目标克数 = 倍数 × 体重 kg', () => {
  assert.deepEqual(targetGrams({ p: 2, c: 2.5, f: 0.8 }, 75), { p: 150, c: 187.5, f: 60 });
});

test('还差 = 目标 − 已吃，超出为负数', () => {
  assert.deepEqual(
    remaining({ p: 150, c: 150, f: 60 }, { p: 46, c: 0, f: 70 }),
    { p: 104, c: 150, f: -10 },
  );
});

test('已吃克数是体重的几倍', () => {
  assert.deepEqual(multiples({ p: 150, c: 75, f: 37.5 }, 75), { p: 2, c: 1, f: 0.5 });
});

test('当天有体重就用当天的', () => {
  const weights = { '2026-09-29': 76, '2026-10-01': 75 };
  assert.equal(weightOn(weights, '2026-10-01'), 75);
});

test('当天没填体重时沿用之前最近一次', () => {
  const weights = { '2026-09-20': 77, '2026-09-29': 76, '2026-10-03': 74 };
  assert.equal(weightOn(weights, '2026-10-01'), 76);
});

test('之前从未填过体重时返回 null', () => {
  assert.equal(weightOn({ '2026-10-03': 74 }, '2026-10-01'), null);
  assert.equal(weightOn({}, '2026-10-01'), null);
});

test('按每 100g 存的食物按重量折算', () => {
  const chicken = { basis: '100g', p: 23, c: 0, f: 2.5 };
  assert.deepEqual(foodPortion(chicken, 200), { p: 46, c: 0, f: 5 });
});

test('按每份存的食物按份数折算', () => {
  const shake = { basis: 'serving', p: 24, c: 3, f: 1.5 };
  assert.deepEqual(foodPortion(shake, 1.5), { p: 36, c: 4.5, f: 2.3 });
});

test('日期键使用本地时区而不是 UTC', () => {
  // 本地时间 10月1日 23:30，无论时区如何都应是 10-01
  assert.equal(dateKey(new Date(2026, 9, 1, 23, 30)), '2026-10-01');
  assert.equal(dateKey(new Date(2026, 0, 5, 0, 10)), '2026-01-05');
});

test('日期前后移动会跨月', () => {
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
});

test('填了包装上的卡路里就用包装的，不按 4/4/9 算', () => {
  // 含 2g 纤维和 7g 糖醇的蛋白棒：4/4/9 会算出 178，包装写 150
  assert.equal(kcalOf({ p: 28, c: 12, f: 2, kcal: 150 }), 150);
});

test('没填卡路里时按 4/4/9 算', () => {
  assert.equal(kcalOf({ p: 28, c: 12, f: 2 }), 178);
});

test('一天的总卡路里混合使用包装值和自动计算值', () => {
  assert.equal(sumKcal([{ p: 28, c: 12, f: 2, kcal: 150 }, { p: 46, c: 0, f: 5 }]), 379);
  assert.equal(sumKcal(undefined), 0);
});

test('食物库里填了卡路里的食物按份量一起折算', () => {
  const bar = { basis: 'serving', p: 28, c: 12, f: 2, kcal: 150 };
  assert.deepEqual(foodPortion(bar, 0.5), { p: 14, c: 6, f: 1, kcal: 75 });
});

// ---------- 趋势与消耗估算 ----------

// 从 start 起连续 n 天，第 i 天的值为 fn(i)
function daily(start, n, fn) {
  const out = {};
  for (let i = 0; i < n; i++) out[shiftDate(start, i)] = fn(i);
  return out;
}
const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} 应接近 ${expected}`);

test('7 天平均只取含当天在内的前 7 天', () => {
  const avg = rollingAverage({ '2026-10-01': 80, '2026-10-02': 79, '2026-10-08': 78 });
  assert.deepEqual(avg, [
    { date: '2026-10-01', kg: 80 },
    { date: '2026-10-02', kg: 79.5 },
    { date: '2026-10-08', kg: 78.5 }, // 10-01 已在 7 天窗口之外
  ]);
});

test('线性回归还原每天降 0.1 kg 的斜率', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 80 - 0.1 * i }));
  const trend = linearTrend(points);
  near(trend.slope, -0.1, 1e-9);
  near(trend.se, 0, 1e-9);
});

test('带噪声的数据有非零的斜率标准误', () => {
  const trend = linearTrend([{ x: 0, y: 80 }, { x: 1, y: 81 }, { x: 2, y: 79 }, { x: 3, y: 80.5 }, { x: 4, y: 78.5 }]);
  assert.ok(trend.se > 0);
});

test('只有一个点或所有点在同一天时没有趋势', () => {
  assert.equal(linearTrend([{ x: 1, y: 80 }]), null);
  assert.equal(linearTrend([{ x: 1, y: 80 }, { x: 1, y: 79 }]), null);
});

test('每天降 0.1 kg 即每周降 0.7 kg，约为体重的 0.89%', () => {
  const weights = daily('2026-09-11', 21, (i) => 80 - 0.1 * i);
  const rate = weeklyRate(weights, '2026-10-01');
  assert.equal(rate.ok, true);
  near(rate.kgPerWeek, -0.7);
  near(rate.pctPerWeek, -0.89);
});

test('称重不足 4 次时不给每周减速', () => {
  const weights = { '2026-09-20': 80, '2026-09-25': 79.5, '2026-10-01': 79 };
  assert.equal(weeklyRate(weights, '2026-10-01').ok, false);
});

test('称重跨度不足 7 天时不给每周减速', () => {
  const weights = daily('2026-09-28', 4, (i) => 80 - 0.1 * i);
  assert.equal(weeklyRate(weights, '2026-10-01').ok, false);
});

test('每周减速只看最近 21 天', () => {
  const weights = { ...daily('2026-07-01', 10, () => 95), ...daily('2026-09-11', 21, () => 80) };
  near(weeklyRate(weights, '2026-10-01').kgPerWeek, 0);
});

const meal2000 = [{ name: '一天', p: 0, c: 500, f: 0 }];

test('每天吃 2000 且体重不变，估算消耗就是 2000', () => {
  const weights = daily('2026-09-04', 28, () => 80);
  const entries = daily('2026-09-03', 28, () => meal2000);
  const est = estimateExpenditure(weights, entries, '2026-10-01');
  assert.equal(est.ok, true);
  near(est.kcal, 2000, 1);
});

test('每天吃 2000 且每天降 0.1 kg，估算消耗约 2770', () => {
  const weights = daily('2026-09-04', 28, (i) => 80 - 0.1 * i);
  const entries = daily('2026-09-03', 28, () => meal2000);
  const est = estimateExpenditure(weights, entries, '2026-10-01');
  near(est.kcal, 2770, 1);
  assert.ok(est.low <= est.kcal && est.kcal <= est.high);
});

test('今天还没吃完，不计入平均摄入', () => {
  const weights = daily('2026-09-04', 28, () => 80);
  const entries = { ...daily('2026-09-03', 28, () => meal2000), '2026-10-01': [{ name: '早餐', p: 0, c: 25, f: 0 }] };
  near(estimateExpenditure(weights, entries, '2026-10-01').kcal, 2000, 1);
});

test('没记录的天不当作吃了 0', () => {
  const weights = daily('2026-09-04', 28, () => 80);
  const entries = daily('2026-09-03', 12, () => meal2000);
  near(estimateExpenditure(weights, entries, '2026-10-01').kcal, 2000, 1);
});

test('称重不足 8 次时不估算消耗，并说明现有多少', () => {
  const weights = daily('2026-09-25', 7, () => 80);
  const entries = daily('2026-09-03', 28, () => meal2000);
  const est = estimateExpenditure(weights, entries, '2026-10-01');
  assert.equal(est.ok, false);
  assert.equal(est.weighIns, 7);
  assert.equal(est.loggedDays, 28);
});

test('饮食记录不足 10 天时不估算消耗', () => {
  const weights = daily('2026-09-04', 28, () => 80);
  const entries = daily('2026-09-22', 9, () => meal2000);
  const est = estimateExpenditure(weights, entries, '2026-10-01');
  assert.equal(est.ok, false);
  assert.equal(est.loggedDays, 9);
});

test('近 7 天平均摄入只算有记录的天，且不含今天', () => {
  const entries = {
    '2026-09-23': [{ name: '太早', p: 100, c: 100, f: 100 }],
    '2026-09-29': [{ name: 'a', p: 100, c: 200, f: 50 }],
    '2026-09-30': [{ name: 'b', p: 140, c: 100, f: 70, kcal: 1500 }],
    '2026-10-01': [{ name: '今天', p: 10, c: 10, f: 10 }],
  };
  assert.deepEqual(averageIntake(entries, '2026-10-01'), { days: 2, kcal: 1575, p: 120, c: 150, f: 60 });
  assert.equal(averageIntake({}, '2026-10-01'), null);
});

// ---------- 目标模式与达标判断 ----------

const targets = { p: 2, c: 2, f: 0.8 };

test('三倍数模式下总热量是三个目标相加的结果', () => {
  assert.deepEqual(
    dailyTarget({ mode: 'multiples', targets, kcalTarget: null }, 75),
    { p: 150, c: 150, f: 60, kcal: 1740, overBudget: false },
  );
});

test('定总热量模式下碳水取余数', () => {
  // 1800 − 150×4 − 60×9 = 660 → 165 g
  assert.deepEqual(
    dailyTarget({ mode: 'kcal', targets, kcalTarget: 1800 }, 75),
    { p: 150, c: 165, f: 60, kcal: 1800, overBudget: false },
  );
});

test('蛋白加脂肪已超过总热量时碳水为 0 并标记', () => {
  const t = dailyTarget({ mode: 'kcal', targets, kcalTarget: 1000 }, 75);
  assert.equal(t.c, 0);
  assert.equal(t.overBudget, true);
});

test('定总热量模式但还没填热量时退回三倍数', () => {
  assert.equal(dailyTarget({ mode: 'kcal', targets, kcalTarget: null }, 75).kcal, 1740);
});

test('蛋白质是下限：吃到 120% 仍是达标而不是超出', () => {
  assert.equal(status('floor', 180, 150), 'met');
  assert.equal(status('floor', 143, 150), 'met');   // 95.3%
  assert.equal(status('floor', 140, 150), 'under'); // 93.3%
});

test('上限类目标有 ±5% 容差', () => {
  assert.equal(status('ceiling', 62.4, 60), 'met');   // 104%
  assert.equal(status('ceiling', 63.6, 60), 'over');  // 106%
  assert.equal(status('ceiling', 57, 60), 'met');     // 95%
  assert.equal(status('ceiling', 50, 60), 'under');
});

test('目标为 0 时吃了任何量都算超出', () => {
  assert.equal(status('ceiling', 5, 0), 'over');
  assert.equal(status('ceiling', 0, 0), 'met');
});

test('每天 550 kcal 的缺口约等于每周 0.5 kg', () => {
  assert.equal(kgPerWeekFromDeficit(550), 0.5);
});
