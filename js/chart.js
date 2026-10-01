// 体重折线图：手写 SVG，不依赖图表库。

import { parseDateKey } from './calc.js';

const BOX = { width: 320, height: 160, padX: 36, padY: 20 };
const DAY_MS = 86400000;

// 把 [{date, value}]（按日期升序）映射成画布坐标。x 按真实日期间隔分布。
// domain 可指定纵轴范围，让多组数据共用同一把尺；不传则取数据自身的最小最大值。
export function chartGeometry(data, box = BOX, domain = null) {
  if (data.length === 0) return { points: [], min: 0, max: 0 };
  const days = data.map((d) => Math.round(parseDateKey(d.date).getTime() / DAY_MS));
  const values = data.map((d) => d.value);
  const [d0, d1] = [days[0], days[days.length - 1]];
  const min = domain ? domain.min : Math.min(...values);
  const max = domain ? domain.max : Math.max(...values);
  const innerW = box.width - box.padX * 2;
  const innerH = box.height - box.padY * 2;

  const points = data.map((d, i) => ({
    x: d1 === d0 ? box.width / 2 : box.padX + ((days[i] - d0) / (d1 - d0)) * innerW,
    y: max === min ? box.height / 2 : box.padY + ((max - d.value) / (max - min)) * innerH,
    date: d.date,
    value: d.value,
  }));
  return { points, min, max };
}

const shortDate = (key) => {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// raw：每天称的体重，画成浅色点；avg：同一批日期的 7 天平均，画成线
export function weightChartSvg(raw, avg, unit) {
  if (raw.length === 0) return '';
  const all = [...raw, ...avg].map((d) => d.value);
  const domain = { min: Math.min(...all), max: Math.max(...all) };
  const { points } = chartGeometry(raw, BOX, domain);
  const avgPoints = chartGeometry(avg, BOX, domain).points;
  const first = points[0];
  const last = points[points.length - 1];
  const xy = (p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const dots = points
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${points.length > 40 ? 1.5 : 2.5}"/>`)
    .join('');
  const yLabels = domain.max === domain.min
    ? `<text x="4" y="${BOX.height / 2 + 4}">${domain.max}</text>`
    : `<text x="4" y="${BOX.padY + 4}">${domain.max}</text><text x="4" y="${BOX.height - BOX.padY + 4}">${domain.min}</text>`;
  const xLabels = points.length === 1
    ? `<text x="${first.x}" y="${BOX.height - 2}" text-anchor="middle">${shortDate(first.date)}</text>`
    : `<text x="${BOX.padX}" y="${BOX.height - 2}">${shortDate(first.date)}</text>
       <text x="${BOX.width - BOX.padX}" y="${BOX.height - 2}" text-anchor="end">${shortDate(last.date)}</text>`;
  const avgFirst = avg[0].value;
  const avgLast = avg[avg.length - 1].value;

  return `
    <svg class="chart" viewBox="0 0 ${BOX.width} ${BOX.height}" role="img"
         aria-label="体重变化，7 天平均从 ${avgFirst} ${unit} 到 ${avgLast} ${unit}">
      <line class="chart__grid" x1="${BOX.padX}" x2="${BOX.width - BOX.padX}" y1="${BOX.padY}" y2="${BOX.padY}"/>
      <line class="chart__grid" x1="${BOX.padX}" x2="${BOX.width - BOX.padX}" y1="${BOX.height - BOX.padY}" y2="${BOX.height - BOX.padY}"/>
      <g class="chart__dots">${dots}</g>
      <polyline class="chart__line" pathLength="1" points="${avgPoints.map(xy).join(' ')}"/>
      <g class="chart__labels">${yLabels}${xLabels}</g>
    </svg>`;
}
