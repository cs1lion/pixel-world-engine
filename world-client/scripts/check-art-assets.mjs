#!/usr/bin/env node
/**
 * `?art=1` 位图素材的装载冒烟。
 *
 * 判据刻意不靠截图：截图只能证明「这一帧看起来还行」，装没装、装了几张、
 * 有没有 404，都得看网络层。这里钉四件事：
 *   1. `?art=1` 一定请求 `/assets/manifest.json`，且清单可解析；
 *   2. 清单里每一件素材都被请求，且响应 200（漏装 / 路径错 / 图被删都会红）；
 *   3. **不带 `art` 参数（默认）也装**——2026-11-10 起默认开，谁都不该靠记着
 *      加参数才看得到这批素材；
 *   4. `?art=0` 一个 `/assets/` 请求都不发——排障与基线比对的退路仍在；
 *   5. 三跑都没有 pageerror。
 *
 * 这条闸门只管「装上了没有」，不管「好不好看」；观感由人眼与
 * `docs/evidence/art-pipeline/` 的对比图负责，别把两件事混成一件。
 *
 * 跑法：
 *   cd world-client && npm run build && npm run preview -- --port 5211 --strictPort
 *   PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-art-assets.mjs
 */

import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);

const browser = await chromium.launch();
const failures = [];

async function run(art) {
  const page = await browser.newPage({ viewport: { width: 1010, height: 700 } });
  const requests = [];
  const statuses = new Map();
  const errors = [];
  // Vite 把 JS bundle 也放在 assets/ 下（index-xxx.js），那是构建产物不是素材。
  // 只把 manifest.json 与 *.png 计入，否则 art=0 会被自己的 bundle 误判成「发了素材请求」。
  const assetPath = (url) => {
    if (!url.includes('/assets/')) return null;
    const tail = url.split('/assets/')[1].split('?')[0];
    return tail === 'manifest.json' || tail.endsWith('.png') ? tail : null;
  };
  page.on('request', (req) => {
    const key = assetPath(req.url());
    if (key !== null) requests.push(key);
  });
  page.on('response', (res) => {
    const key = assetPath(res.url());
    if (key !== null) statuses.set(key, res.status());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const query = `world=dengchao&time=noon&feed=off${art === null ? '' : `&art=${art}`}`;
  await page.goto(`${BASE}?${query}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  let manifest = null;
  if (art === '1' && statuses.get('manifest.json') === 200) {
    manifest = await page.evaluate(async () => {
      const res = await fetch(`${location.origin}${location.pathname}assets/manifest.json`);
      return res.ok ? res.json() : null;
    });
  }
  await page.close();
  return { art, requests, statuses, errors, manifest };
}

const on = await run('1');
const byDefault = await run(null);
const off = await run('0');
await browser.close();

// 1. 开：清单在且能解析
if (on.statuses.get('manifest.json') !== 200) {
  failures.push('art=1 未拿到 200 的 assets/manifest.json');
}
if (on.manifest === null) {
  failures.push('art=1 的 manifest.json 无法解析成 JSON');
} else {
  const ids = Object.keys(on.manifest.assets ?? {});
  if (ids.length === 0) failures.push('manifest.json 里一件素材都没有');
  // 2. 每一件都被请求且 200
  for (const id of ids) {
    const key = `${id}.png`;
    if (!on.requests.includes(key)) failures.push(`art=1 没请求 ${key}（清单有、装载漏了）`);
    const status = on.statuses.get(key);
    if (status !== 200) failures.push(`${key} 响应 ${String(status)}，应为 200`);
  }
  // 反过来：请求了但清单里没有的位图，也判红（防止孤儿图混进来）
  for (const key of on.requests) {
    if (key === 'manifest.json' || !key.endsWith('.png')) continue;
    if (!ids.includes(key.slice(0, -4))) failures.push(`请求了清单外的素材 ${key}`);
  }
  console.log(`art=1: 清单 ${ids.length} 件，实际请求 ${on.requests.filter((r) => r.endsWith('.png')).length} 张 PNG`);
}

// 3. 默认（不写参数）：也装
if (byDefault.statuses.get('manifest.json') !== 200) {
  failures.push('默认（不带 art 参数）没请求 assets/manifest.json——默认开这条退化了');
}
console.log(`默认: 请求 ${byDefault.requests.filter((r) => r.endsWith('.png')).length} 张 PNG`);

// 4. 关：零请求
if (off.requests.length !== 0) {
  failures.push(`art=0 仍发了 ${off.requests.length} 个 /assets/ 请求：${off.requests.join(', ')}`);
}
console.log(`art=0: /assets/ 请求 ${off.requests.length} 个`);

// 5. 三跑都无 pageerror
for (const [label, r] of [['art=1', on], ['默认', byDefault], ['art=0', off]]) {
  for (const err of r.errors) failures.push(`${label} pageerror: ${err}`);
}

if (failures.length > 0) {
  console.error('\n素材装载冒烟失败：');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('素材装载冒烟通过：默认与 art=1 全装、art=0 零请求、三跑无 pageerror。');
