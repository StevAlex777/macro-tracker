// 一次性生成 PWA 图标：node scripts/make-icons.mjs
// 图案是三条量尺（蛋白质 / 碳水 / 脂肪），不依赖任何第三方库。
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = [0x14, 0x25, 0x2e];
const TRACK = [0x2b, 0x3f, 0x48];
const BARS = [
  { color: [0xef, 0x7a, 0x70], fill: 0.78 },
  { color: [0xe3, 0xb3, 0x4a], fill: 0.52 },
  { color: [0x8c, 0xc4, 0x86], fill: 0.34 },
];

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size) {
  // 图案留在中间 60%，这样安卓的 maskable 裁切不会切到
  const left = size * 0.2;
  const width = size * 0.6;
  const barH = size * 0.11;
  const gap = size * 0.07;
  const top = (size - (barH * 3 + gap * 2)) / 2;

  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    for (let x = 0; x < size; x++) {
      let color = BG;
      BARS.forEach((bar, i) => {
        const y0 = top + i * (barH + gap);
        if (y >= y0 && y < y0 + barH && x >= left && x < left + width) {
          color = x < left + width * bar.fill ? bar.color : TRACK;
        }
      });
      raw.set(color, row + 1 + x * 3);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 位 RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
  console.log(`icons/icon-${size}.png`);
}
