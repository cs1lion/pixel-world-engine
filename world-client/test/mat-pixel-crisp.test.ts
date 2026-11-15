/**
 * MAT-G5（只锁「现在就是对的」三条，1.5× 相机缩放是否保留归 owner）。
 *
 * 像素风的边缘一旦被平滑，风格就没了。所以把「不糊」的三个现值钉住：
 *   1. `pixelArt: true`（Phaser 侧关掉平滑采样）；
 *   2. 没有显式 `antialias: true`（别在升级/调参时把它打开）；
 *   3. canvas 的 CSS 是 `image-rendering: pixelated`，没有 `auto`（浏览器放大时最近邻）。
 *
 * `ZOOM_STEPS` 里的 1.5 是非整数档，会让像素边缘落在半个设备像素上。删不删是
 * UX 决定，**这里只登记、不判定失败**（见 docs/OPEN_ISSUES.md MAT-G5）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('MAT-G5 pixelArt 与 roundPixels 锁在 true', () => {
  assert.ok(/pixelArt:\s*true/.test(main), 'main.ts 的 pixelArt 不再是 true：像素会被平滑采样');
  assert.ok(/roundPixels:\s*true/.test(main), 'main.ts 的 roundPixels 不再是 true：精灵会落在半像素');
});

test('MAT-G5 没有显式 antialias: true', () => {
  assert.ok(!/antialias\s*:\s*true/.test(main), 'main.ts 显式打开了 antialias：像素风边缘会被糊掉');
});

test('MAT-G5 canvas 用 image-rendering: pixelated，没有 auto', () => {
  assert.ok(html.includes('image-rendering: pixelated'), 'index.html 的 canvas 没有 pixelated：放大后边缘会糊');
  assert.ok(!/image-rendering\s*:\s*auto/.test(html), 'index.html 出现了 image-rendering: auto');
});
