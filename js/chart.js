// 体重折线图：手写 SVG，不依赖图表库。

import { parseDateKey } from './calc.js';

const BOX = { width: 320, height: 160, padX: 36, padY: 20 };
const DAY_MS = 86400000;

// 把 [{date, value}]（按日期升序）映射成画布坐标。x 按真实日期间隔分布。
export function chartGeometry(data, box = BOX) {
  if (data.length === 0) return { points: [], min: 0, max: 0 };
  const days = data.map((d) => Math.round(parseDateKey(d.date).getTime() / DAY_MS));
  const values = data.map((d) => d.value);
  const [d0, d1] = [days[0], days[days.length - 1]];
  const [min, max] = [Math.min(...values), Math.max(...values)];
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

export function weightChartSvg(data, unit) {
  const { points, min, max } = chartGeometry(data);
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const dots = points
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${points.length > 40 ? 1.5 : 3}"/>`)
    .join('');
  const yLabels = max === min
    ? `<text x="4" y="${BOX.height / 2 + 4}">${max}</text>`
    : `<text x="4" y="${BOX.padY + 4}">${max}</text><text x="4" y="${BOX.height - BOX.padY + 4}">${min}</text>`;
  const xLabels = points.length === 1
    ? `<text x="${first.x}" y="${BOX.height - 2}" text-anchor="middle">${shortDate(first.date)}</text>`
    : `<text x="${BOX.padX}" y="${BOX.height - 2}">${shortDate(first.date)}</text>
       <text x="${BOX.width - BOX.padX}" y="${BOX.height - 2}" text-anchor="end">${shortDate(last.date)}</text>`;

  return `
    <svg class="chart" viewBox="0 0 ${BOX.width} ${BOX.height}" role="img"
         aria-label="体重变化，从 ${first.value} ${unit} 到 ${last.value} ${unit}">
      <line class="chart__grid" x1="${BOX.padX}" x2="${BOX.width - BOX.padX}" y1="${BOX.padY}" y2="${BOX.padY}"/>
      <line class="chart__grid" x1="${BOX.padX}" x2="${BOX.width - BOX.padX}" y1="${BOX.height - BOX.padY}" y2="${BOX.height - BOX.padY}"/>
      <polyline class="chart__line" points="${line}"/>
      <g class="chart__dots">${dots}</g>
      <g class="chart__labels">${yLabels}${xLabels}</g>
    </svg>`;
}
