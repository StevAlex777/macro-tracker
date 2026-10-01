import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lbToKg, kgToLb, toDisplayWeight, fromInputWeight, calories, sumEntries,
  targetGrams, remaining, multiples, weightOn, foodPortion, dateKey, shiftDate,
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
