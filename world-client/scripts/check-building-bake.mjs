#!/usr/bin/env node
/**
 * 建筑烘焙的对齐自检：一次把**每栋楼每一层**的烘焙 Image 全钉住。
 *
 * 为什么需要它：逐字节截图（25 张落地影 + 49 帧穿行）只能证明"这一帧这些楼
 * 没歪"；一旦某栋楼因为尺寸/留白改动而错了 1px，画面往往仍然"看起来还行"，
 * 只有对着源 Graphics 的坐标算才抓得住。这里钉两条：
 *
 *   1. 落点/尺寸：Image 的 x/y 必须等于 `buildingBakeBox(w, h)`，原点 (0,0)、
 *      缩放 1、纹理尺寸等于盒尺寸——盒与落点是**一对**，错一个就整体移位。
 *   2. 四边 alpha 必须为 0：内容贴边 = 留白不够、已经被裁掉 1px，且不报错。
 *
 * 跑法：
 *   cd world-client && npm run dev
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-building-bake.mjs
 */

import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

/** 每栋楼必须有的烘焙层。墙层拆成三段（见 `render/buildings.ts` 的注释）。 */
const LAYERS = ['wall-body', 'wall-base', 'wall-struct', 'roof', 'chimney', 'window', 'step', 'front'];

await assertTreeIdentity(BASE);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`${BASE}?world=dengchao&time=dusk&feed=off&ledger=off&debug=1&now=960`, {
  waitUntil: 'load',
});
await page.waitForFunction(() => window.Oracle?.debugBuildingBake !== undefined, null, {
  timeout: 30000,
});
const readings = await page.evaluate(() => window.Oracle.debugBuildingBake());
await browser.close();

const failures = [];
let images = 0;
for (const building of readings) {
  const { instanceId, box, layers } = building;
  const seen = new Set();
  for (const layer of layers) {
    images += 1;
    const where = `${instanceId}/${layer.layer}`;
    if (seen.has(layer.layer)) failures.push(`${where}: 同一层出现两张 Image`);
    seen.add(layer.layer);
    if (layer.x !== box.x || layer.y !== box.y) {
      failures.push(`${where}: 落点 (${layer.x},${layer.y}) ≠ 烘焙盒 (${box.x},${box.y})`);
    }
    if (layer.originX !== 0 || layer.originY !== 0) {
      failures.push(`${where}: 原点 (${layer.originX},${layer.originY}) ≠ (0,0)`);
    }
    if (layer.scaleX !== 1 || layer.scaleY !== 1) {
      failures.push(`${where}: 缩放 (${layer.scaleX},${layer.scaleY}) ≠ (1,1)`);
    }
    if (layer.frameW !== box.w || layer.frameH !== box.h) {
      failures.push(
        `${where}: 纹理 ${layer.frameW}×${layer.frameH} ≠ 烘焙盒 ${box.w}×${box.h}`,
      );
    }
    if (layer.borderAlpha === null) {
      failures.push(`${where}: 纹理四边读不到（不能算通过）`);
    } else if (layer.borderAlpha !== 0) {
      failures.push(`${where}: 四边 alpha=${layer.borderAlpha}（内容贴边，已被裁 1px）`);
    }
  }
  const missing = LAYERS.filter((name) => !seen.has(name));
  if (missing.length > 0) failures.push(`${instanceId}: 缺层 ${missing.join(',')}`);
  const extra = [...seen].filter((name) => !LAYERS.includes(name));
  if (extra.length > 0) failures.push(`${instanceId}: 多出层 ${extra.join(',')}`);
}

if (readings.length === 0) failures.push('没有任何建筑读数（场景没起来？）');
if (errors.length > 0) failures.push(`页面报错 ${errors.length} 条：${errors[0]}`);

console.log(
  `建筑 ${readings.length} 栋 / 烘焙 Image ${images} 张（每栋 ${LAYERS.length} 层）；失败 ${failures.length} 条`,
);
for (const failure of failures) console.log(`  ✗ ${failure}`);
if (failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log('判据：落点=烘焙盒、原点 0/0、缩放 1、纹理尺寸=盒、四边 alpha=0 —— 全部通过');
}
