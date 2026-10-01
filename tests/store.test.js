import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, defaultState, load, save, parseBackup } from '../js/store.js';

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

test('没有存档时返回默认状态', () => {
  const state = load(fakeStorage());
  assert.deepEqual(state, defaultState());
  assert.equal(state.settings.unit, 'lb');
  assert.deepEqual(state.settings.targets, { p: 2, c: 2, f: 0.8 });
});

test('保存后能原样读回', () => {
  const storage = fakeStorage();
  const state = defaultState();
  state.weights['2026-10-01'] = 74.84;
  state.entries['2026-10-01'] = [{ id: 'a', name: '鸡胸肉', p: 46, c: 0, f: 5 }];
  save(storage, state);
  assert.deepEqual(load(storage), state);
});

test('存档损坏时回到默认状态而不是崩溃', () => {
  const state = load(fakeStorage({ [STORAGE_KEY]: '{不是 json' }));
  assert.deepEqual(state, defaultState());
});

test('旧存档缺字段时用默认值补齐', () => {
  const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ weights: { '2026-10-01': 75 } }) });
  const state = load(storage);
  assert.equal(state.weights['2026-10-01'], 75);
  assert.deepEqual(state.foods, []);
  assert.deepEqual(state.settings.targets, { p: 2, c: 2, f: 0.8 });
});

test('导入合法备份', () => {
  const backup = defaultState();
  backup.settings.unit = 'kg';
  backup.foods.push({ id: 'f1', name: '燕麦', basis: '100g', p: 13, c: 67, f: 7 });
  const state = parseBackup(JSON.stringify(backup));
  assert.equal(state.settings.unit, 'kg');
  assert.equal(state.foods[0].name, '燕麦');
});

test('导入的不是 JSON 时拒绝', () => {
  assert.throws(() => parseBackup('hello'), /不是有效的备份文件/);
});

test('导入的 JSON 结构不对时拒绝', () => {
  assert.throws(() => parseBackup('[1,2,3]'), /不是有效的备份文件/);
  assert.throws(() => parseBackup(JSON.stringify({ foo: 1 })), /不是有效的备份文件/);
});

test('导入的体重不是数字时拒绝', () => {
  const bad = defaultState();
  bad.weights['2026-10-01'] = 'heavy';
  assert.throws(() => parseBackup(JSON.stringify(bad)), /不是有效的备份文件/);
});

test('导入的食物记录缺营养素时拒绝', () => {
  const bad = defaultState();
  bad.entries['2026-10-01'] = [{ id: 'a', name: '谜之食物', p: 10 }];
  assert.throws(() => parseBackup(JSON.stringify(bad)), /不是有效的备份文件/);
});

test('导入带包装卡路里的记录', () => {
  const backup = defaultState();
  backup.entries['2026-10-01'] = [{ id: 'a', name: '蛋白棒', p: 28, c: 12, f: 2, kcal: 150 }];
  assert.equal(parseBackup(JSON.stringify(backup)).entries['2026-10-01'][0].kcal, 150);
});

test('导入的卡路里不是数字时拒绝', () => {
  const bad = defaultState();
  bad.entries['2026-10-01'] = [{ id: 'a', name: '蛋白棒', p: 28, c: 12, f: 2, kcal: '很多' }];
  assert.throws(() => parseBackup(JSON.stringify(bad)), /不是有效的备份文件/);
});

test('旧存档没有目标模式时默认用三倍数', () => {
  const old = { settings: { unit: 'kg', targets: { p: 2.2, c: 1.5, f: 0.7 } }, weights: {}, entries: {}, foods: [] };
  const state = load(fakeStorage({ [STORAGE_KEY]: JSON.stringify(old) }));
  assert.equal(state.settings.mode, 'multiples');
  assert.equal(state.settings.kcalTarget, null);
  assert.equal(state.settings.targets.p, 2.2);
});

test('定总热量模式能随备份保存和恢复', () => {
  const backup = defaultState();
  backup.settings.mode = 'kcal';
  backup.settings.kcalTarget = 1800;
  const state = parseBackup(JSON.stringify(backup));
  assert.equal(state.settings.mode, 'kcal');
  assert.equal(state.settings.kcalTarget, 1800);
});
