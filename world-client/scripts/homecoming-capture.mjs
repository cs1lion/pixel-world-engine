/**
 * 回家之后的室内取证：屋里真的有人，人真的画在内景上。
 *
 * 跑法（在 `world-client/` 下先开本 worktree 的 dev server）：
 *   npx vite --port 5211 --strictPort
 *   node scripts/homecoming-capture.mjs
 *
 * 页面默认从世界 00:00 起跑（加速 60×）。入夜判定从 22:00 起到 06:00——
 * 00:00 本来就落在夜里，所以两名居民一开局就各回各家，约 11 秒后民居里有人。
 * 取数是**等页面自己走到「有人的家」**，不拨时钟、不写存档、不造假人。
 */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const OUT = 'D:/project/pwe-material/docs/evidence/homecoming';
const BASE = process.env.PIXEL_WORLD_URL ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;

await assertTreeIdentity(BASE);
const VIEW = { width: 960, height: 640 };

const browser = await chromium.launch();
await mkdir(`${OUT}/shots`, { recursive: true });
const page = await browser.newPage({ viewport: VIEW });
await page.goto(`${BASE}?time=night&debug=1&interior=instant`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 30000 });

async function shot(name) {
  await page.locator('#app canvas').first().screenshot({ path: `${OUT}/shots/${name}.png` });
}

// 等居民走回家。门到家的距离约 15 格，世界 60× 加速下约 10 秒。
//
// 用**轮询次数**而不是墙钟计时：取证脚本也不读墙钟，同一份脚本在任何机器上
// 都只报「第几次轮询等到」。
const MAX_POLLS = 360; // × 250ms ≈ 90 秒
const waited = await page.evaluate((maxPolls) => new Promise((resolve) => {
  let polls = 0;
  const poll = () => {
    polls += 1;
    const state = window.Oracle.interior();
    const occupied = state.buildings.filter((item) => item.zone === 'living' && item.occupants > 0);
    if (occupied.length > 0) {
      resolve({ polls, occupied, state });
      return;
    }
    if (polls >= maxPolls) {
      resolve({ polls: -1, occupied: [], state });
      return;
    }
    setTimeout(poll, 250);
  };
  poll();
}), MAX_POLLS);
if (waited.occupied.length === 0) throw new Error('90 秒内没有一栋民居有人——取证失败');

const street = await page.evaluate(() => ({
  interior: window.Oracle.interior(),
  camera: window.Oracle.camera(),
}));
// 街上还有谁？——`visible` 的人才是真站在街上的；这一项用来对照「都进屋了」。
await shot('street-night');

const home = waited.occupied[0];
await page.evaluate((id) => window.Oracle.enterInterior(id), home.id);
await page.waitForFunction(() => window.Oracle.interior().mode === 'inside', null, { timeout: 20000 });
await page.waitForTimeout(300);
await shot('interior-occupied');

const interior = await page.evaluate(() => window.Oracle.interior());
const stats = await page.evaluate(() => window.Oracle.renderStats());

await page.evaluate(() => window.Oracle.exitInterior());
await page.waitForFunction(() => window.Oracle.interior().mode === 'street', null, { timeout: 20000 });

const report = {
  waitedPolls: waited.polls,
  occupiedHomes: waited.occupied.map((item) => ({ id: item.id, occupants: item.occupants, floors: item.floors })),
  entered: {
    id: home.id,
    mode: interior.mode,
    floor: interior.floor,
    floors: interior.floors,
    occupants: interior.occupants,
  },
  renderStats: stats,
};
await writeFile(`${OUT}/shots.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
