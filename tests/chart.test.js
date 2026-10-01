import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry } from '../js/chart.js';

const box = { width: 320, height: 160, padX: 36, padY: 20 };

test('没有数据时没有点', () => {
  assert.deepEqual(chartGeometry([], box).points, []);
});

test('最早的点在最左，最新的点在最右', () => {
  const { points } = chartGeometry(
    [{ date: '2026-09-01', value: 170 }, { date: '2026-09-11', value: 168 }, { date: '2026-10-01', value: 165 }],
    box,
  );
  assert.equal(points[0].x, 36);
  assert.equal(points[2].x, 320 - 36);
  // 10 天 / 30 天 = 1/3 处，按真实日期间隔而不是等距
  assert.ok(Math.abs(points[1].x - (36 + (248 / 3))) < 0.01);
});

test('体重越重点越靠上', () => {
  const { points } = chartGeometry(
    [{ date: '2026-09-01', value: 170 }, { date: '2026-10-01', value: 165 }],
    box,
  );
  assert.ok(points[0].y < points[1].y);
  assert.ok(points[0].y >= 20 && points[1].y <= 140);
});

test('只有一个点时放在正中，不除以零', () => {
  const { points } = chartGeometry([{ date: '2026-10-01', value: 165 }], box);
  assert.deepEqual(points, [{ x: 160, y: 80, date: '2026-10-01', value: 165 }]);
});

test('所有体重相同时画成一条水平线', () => {
  const { points } = chartGeometry(
    [{ date: '2026-09-01', value: 165 }, { date: '2026-10-01', value: 165 }],
    box,
  );
  assert.equal(points[0].y, 80);
  assert.equal(points[1].y, 80);
});

test('指定纵轴范围时两组数据共用同一把尺', () => {
  const domain = { min: 160, max: 170 };
  const raw = chartGeometry([{ date: '2026-09-01', value: 170 }, { date: '2026-10-01', value: 160 }], box, domain);
  const avg = chartGeometry([{ date: '2026-09-01', value: 165 }, { date: '2026-10-01', value: 165 }], box, domain);
  assert.equal(raw.points[0].y, 20);
  assert.equal(raw.points[1].y, 140);
  assert.equal(avg.points[0].y, 80); // 没有 domain 时会被当成水平线放在正中，这里是因为 165 恰在中点
  assert.equal(chartGeometry([{ date: '2026-09-01', value: 162.5 }, { date: '2026-10-01', value: 162.5 }], box, domain).points[0].y, 110);
});
