#!/usr/bin/env node
/**
 * 村民交互行为的 EDD 评分器（code eval，固定程序判别，不用 LLM judge）。
 *
 * 判的是「一轮交互往返之后，世界留下了什么状态」，不是最终回答像不像话：
 * 快照字段、事件日志、记忆、回执、动作帧名、存档字节、DOM 可点性。
 * 每条 example 一个干净 context（清 local/sessionStorage、固定世界时刻），
 * 所以一条用例不会污染下一条。
 *
 * 用法：
 *   node scripts/eval-interaction.mjs --split main
 *   node scripts/eval-interaction.mjs --split heldout --run heldout-0
 *   EVAL_OUT=tmp/eval-interaction node scripts/eval-interaction.mjs --split all
 *
 * 有任意一条 fail 就 exit 1（真红）。baseline 阶段新用例全红是**预期**，
 * 所以这一轮不把它接进 CI 挡 merge；主集转绿那一笔再接。
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { assertTreeIdentity } from './lib/tree-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = join(ROOT, 'eval', 'interaction');
// 与其他 check-* 同一套端口口径：CI 的 preview 在 5211，本地多工作树时
// 显式给 PIXEL_WORLD_URL 指到本树端口。
const BASE = process.env.PIXEL_WORLD_URL
  ?? `http://127.0.0.1:${process.env.PIXEL_WORLD_CLIENT_PORT ?? 5211}/`;
const OUT_DIR = process.env.EVAL_OUT
  ? (process.env.EVAL_OUT.startsWith('/') || /^[A-Za-z]:/.test(process.env.EVAL_OUT)
    ? process.env.EVAL_OUT : join(ROOT, process.env.EVAL_OUT))
  : join(ROOT, 'tmp', 'eval-interaction');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const split = argOf('--split', 'main');
const runId = argOf('--run', 'baseline-0');
if (!['main', 'heldout', 'all'].includes(split)) {
  console.error(`--split 只能是 main / heldout / all，收到 ${split}`);
  process.exit(2);
}

const load = (name) => JSON.parse(readFileSync(join(DATASET, name), 'utf8'));
const datasets = split === 'all'
  ? [load('main.json'), load('held-out.json')]
  : [load(split === 'main' ? 'main.json' : 'held-out.json')];

await assertTreeIdentity(BASE);
const browser = await chromium.launch();
const results = [];

/** 干净环境：新 context + 清存档 + 固定世界时刻/相位。 */
async function openPage(env) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  const page = await context.newPage();
  const requests = [];
  const pageerrors = [];
  page.on('request', (req) => {
    if (req.url().includes('/assets/')) requests.push(req.url());
  });
  page.on('pageerror', (err) => pageerrors.push(String(err)));
  const q = new URLSearchParams({
    world: env.world, time: env.phase, feed: env.feed, debug: '1', now: String(env.now),
  });
  if (env.art !== undefined) q.set('art', String(env.art));
  await page.goto(`${BASE}?${q.toString()}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.Oracle !== undefined && window.Oracle.view !== undefined);
  await page.waitForTimeout(900);
  return { context, page, requests, pageerrors };
}

const q = (page, selector) => page.locator(selector);

/** 固定检查：每条 example 按 check 字段分派，期望值从 dataset 读。 */
const CHECKS = {
  async actionContainer({ page }, expect) {
    const count = await q(page, expect.selector).count();
    assert.equal(count, 1, `${expect.selector} 应存在且只有一份`);
    const leaked = await q(page, `${expect.forbiddenIn} [data-action]`).count();
    assert.equal(leaked, 0, '动作按钮不许放进 unit-status（nodeCount 固定开销断言）');
    return `容器存在，unit-status 内动作按钮 ${leaked} 个`;
  },
  async actionButtons({ page }, expect) {
    const buttons = q(page, '#villager-panel-actions button[data-action]');
    const count = await buttons.count();
    assert.equal(count, expect.count, `应有 ${expect.count} 个动作按钮`);
    for (const action of expect.actions) {
      assert.equal(await q(page, `#villager-panel-actions button[data-action="${action}"]`).count(), 1,
        `缺少 ${action} 按钮`);
    }
    return `${count} 个按钮：${expect.actions.join(' / ')}`;
  },
  async actionIcons({ page }, expect) {
    // 逐笔爬坡时按钮是一个个加的，判据是「每个已存在的按钮都有图标」，
    // 不硬钉最终按钮数（那条由 M2 守）。
    const buttonCount = await q(page, '#villager-panel-actions button[data-action]').count();
    assert.ok(buttonCount > 0, '至少要有一个动作按钮');
    const imgs = q(page, '#villager-panel-actions img');
    assert.equal(await imgs.count(), buttonCount, '每个动作按钮要有一张图标');
    const srcs = await imgs.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src') ?? ''));
    const manifest = await page.evaluate(async () => (await (await fetch('assets/manifest.json')).json()).assets);
    for (const src of srcs) {
      const key = src.split('/assets/')[1]?.replace(/\.png$/, '');
      assert.ok(key && manifest[key], `图标不在清单里：${src}`);
      assert.ok(key.startsWith(`${expect.kind}/`), `图标类别应为 ${expect.kind}：${key}`);
    }
    return `${srcs.length} 张图标全部在清单内`;
  },
  async dispatchRoundTrip({ page }, expect) {
    // 面板默认 hidden，先打开它，否则 click 会超时而不是红在断言。
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="dispatch"]');
    assert.equal(await btn.count(), 1, '派活按钮不存在，往返无从发起');
    const before = await page.evaluate(() => window.Oracle.view());
    await btn.click();
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.Oracle.view());
    assert.notDeepEqual(after.villagers.map((v) => v.mode), before.villagers.map((v) => v.mode),
      '下一逻辑拍后村民状态应变化');
    const reply = await page.locator('#reply').textContent();
    assert.ok(reply && reply.trim().length > 0, '回执不该是空的');
    return `mode 变化 + 回执「${reply.trim().slice(0, 24)}」`;
  },
  async carryRoundTrip({ page }, expect) {
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="carry"]');
    assert.equal(await btn.count(), 1, '给东西按钮不存在');
    // 通行凭证 carries（lamp / shoes）与视觉 carrying（scroll / stone / paper）
    // 是两回事；给东西改的是前者，判据别读错字段。
    const read = () => page.evaluate((field) => window.Oracle.view().villagers.map((v) => v[field] ?? null), expect.field);
    const before = await read();
    await btn.click();
    await page.waitForTimeout(500);
    const after = await read();
    assert.notDeepEqual(after, before, `${expect.field} 应有变化`);
    return `${expect.field} 变化 + 回执`;
  },
  async askRoundTrip({ page }) {
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="ask"]');
    assert.equal(await btn.count(), 1, '问一句按钮不存在');
    await btn.click();
    await page.waitForTimeout(500);
    const reply = (await page.locator('#reply').textContent()) ?? '';
    assert.ok(reply.trim().length > 0, '世界应回一句可核查的话');
    return `回执「${reply.trim().slice(0, 24)}」`;
  },
  async dispatchBusy({ page }) {
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="dispatch"]');
    assert.equal(await btn.count(), 1, '派活按钮不存在');
    await btn.click();
    await page.waitForTimeout(500);
    const first = (await page.locator('#reply').textContent()) ?? '';
    await btn.click();
    await page.waitForTimeout(500);
    const second = (await page.locator('#reply').textContent()) ?? '';
    assert.ok(second.trim().length > 0, '拒收不能是空回执');
    assert.notEqual(second, first, '第二次派活不该和第一次同一句');
    assert.ok(/接不了|手上有活|抵押|呼吸段/.test(second), `拒收要说清原因，实际「${second}」`);
    return `第二次拒收并说明原因：「${second.trim().slice(0, 24)}」`;
  },
  async carryAbsent({ page }) {
    // 面板只对当前这个人下手；判「不顺手改递给旁边那位」：
    // 给灯之后，除 v3 外其余六人的 carries 一个都不许变。
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="carry"]');
    assert.equal(await btn.count(), 1, '给东西按钮不存在');
    const read = () => page.evaluate(() => window.Oracle.view().villagers.map((v) => [v.id, v.carries]));
    const before = await read();
    await btn.click();
    await page.waitForTimeout(500);
    const after = await read();
    const othersBefore = before.filter(([id]) => id !== 'v3');
    const othersAfter = after.filter(([id]) => id !== 'v3');
    assert.deepEqual(othersAfter, othersBefore, '别的人不该被顺手改到');
    assert.notDeepEqual(after.find(([id]) => id === 'v3'), before.find(([id]) => id === 'v3'),
      '点名的那个人应当收到');
    return '只有被点名的人 carries 变化';
  },
  async doubleClickOnce({ page }) {
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="dispatch"]');
    assert.equal(await btn.count(), 1, '派活按钮不存在');
    await btn.click();
    await page.waitForTimeout(500);
    const tasksAfterFirst = await page.evaluate(() => window.Oracle.view().tasks.length);
    await btn.click();
    await page.waitForTimeout(500);
    const tasksAfterSecond = await page.evaluate(() => window.Oracle.view().tasks.length);
    assert.equal(tasksAfterSecond, tasksAfterFirst, '连点两次不该多出一单活');
    return `两次点击后任务数 ${tasksAfterFirst} → ${tasksAfterSecond}`;
  },
  async rejectKeepsText({ page }) {
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const btn = q(page, '#villager-panel-actions button[data-action="dispatch"]');
    assert.equal(await btn.count(), 1, '派活按钮不存在');
    await btn.click();
    await page.waitForTimeout(500);
    const tasks = await page.evaluate(() => window.Oracle.view().tasks.length);
    await btn.click();
    await page.waitForTimeout(500);
    const reply = (await page.locator('#reply').textContent()) ?? '';
    const tasksAfter = await page.evaluate(() => window.Oracle.view().tasks.length);
    assert.ok(reply.trim().length > 0, '拒收回执不能为空');
    assert.equal(tasksAfter, tasks, '被拒的动作不该留下半截任务');
    return `拒收回执非空，任务数保持 ${tasks}`;
  },
  async worldStillRuns({ page }, expect) {
    await page.evaluate(() => window.Oracle.lookAtVillager('v3'));
    const a = await page.evaluate(() => window.Oracle.view().now);
    await page.waitForTimeout(350);
    const b = await page.evaluate(() => window.Oracle.view().now);
    assert.ok(b - a >= expect.minAdvanceMs, `面板打开时世界应继续推进（${a} → ${b}）`);
    return `now ${a} → ${b}`;
  },
  async artOffZeroRequests(ctx, expect) {
    // Vite 把 JS bundle 也放在 /assets/ 下，那不是素材。口径与
    // scripts/check-art-assets.mjs 一致：只算 manifest.json 与 *.png。
    const assetReqs = ctx.requests.filter((url) => {
      const tail = url.split('/assets/')[1]?.split('?')[0];
      return tail === 'manifest.json' || (tail !== undefined && tail.endsWith('.png'));
    });
    assert.equal(assetReqs.length, expect.assetRequests,
      `?art=0 不该发素材请求，实际 ${assetReqs.length} 个`);
    return `素材请求 ${assetReqs.length} 个（已排除构建产物）`;
  },
  async frozenNoRegression(ctx, expect, example) {
    // 不判「绝对静止」：整幅 canvas 本来就有约 0.15% 的零散像素变化
    // （A/B 实测 art=1 与 art=0 同量级），绝对静止要交给 check-ground-shadow
    // 的完整测量面前提。这里判的是本轮真正要防的回归：接入动作表之后，
    // 冻结画面的变化量不该比没有动作表时显著变大。
    const setup = (page) => page.evaluate(() => {
      window.Oracle.debugHoldWorld?.(true);
      window.Oracle.debugPinTide?.(1);
      window.Oracle.debugSetWeather?.('clear');
      window.Oracle.debugHideAmbience?.(true);
      window.Oracle.debugHideBayMist?.(true);
      window.Oracle.debugLampMotion?.({ ignite: false, breathe: false, sway: false });
      window.Oracle.debugStallMotion?.({ cloth: false, fire: false });
      window.Oracle.debugBannerMotion?.({ sway: false, shadow: false });
      window.Oracle.debugSmokeMotion?.({ drift: false });
      window.Oracle.setCameraMode?.('free');
    });
    const pixelDiff = async ([aB64, bB64]) => {
      const load = (s) => new Promise((done) => {
        const img = new Image();
        img.onload = () => done(img);
        img.src = `data:image/png;base64,${s}`;
      });
      const [ia, ib] = await Promise.all([load(aB64), load(bB64)]);
      const grab = (img) => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const da = grab(ia);
      const db = grab(ib);
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) changed += 1;
      }
      return { changed, total: ia.width * ia.height };
    };
    const measure = async (page) => {
      await setup(page);
      await page.waitForTimeout(700);
      const box = await page.locator('#app canvas').boundingBox();
      assert.ok(box !== null, '找不到主画布');
      const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
      const a = await page.screenshot({ clip });
      await page.waitForTimeout(150);
      const b = await page.screenshot({ clip });
      return page.evaluate(pixelDiff, [a.toString('base64'), b.toString('base64')]);
    };
    const on = await measure(ctx.page);
    let offCtx;
    let off;
    try {
      offCtx = await openPage({ ...example.env, art: 0 });
      off = await measure(offCtx.page);
    } finally {
      await offCtx?.context.close();
    }
    assert.ok(on.changed / on.total <= expect.maxChangedRatio,
      `冻结画面变化 ${on.changed}/${on.total} 超过 ${expect.maxChangedRatio}`);
    const allowed = off.changed * (1 + expect.maxRelativeIncrease) + expect.slackPixels;
    assert.ok(on.changed <= allowed,
      `动作表让冻结变化显著变大：art=1 ${on.changed} px vs art=0 ${off.changed} px（上限 ${Math.round(allowed)}）`);
    return `冻结后变化 art=1 ${on.changed} px / art=0 ${off.changed} px（未显著变大）`;
  },
  async saveSchemaIntact({ page }, expect) {
    // 读真实存档，不读 view()（view 没有这个字段，会读成 null → null 的假绿）。
    const read = () => page.evaluate(() => {
      const raw = localStorage.getItem('dengchao.pixel-world.save.v1');
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.schemaVersion ?? null;
      } catch {
        return null;
      }
    });
    await page.evaluate(() => window.Oracle.saveNow());
    const before = await read();
    assert.equal(typeof before, 'number', '存档里必须真读到一个数字版本号');
    await page.evaluate(() => window.Oracle.saveNow());
    const after = await read();
    assert.equal(after, before, `${expect.field} 不该因交互变化`);
    return `${expect.field} ${before} → ${after}（读自真实存档）`;
  },
};

for (const dataset of datasets) {
  for (const example of dataset.examples) {
    const fn = CHECKS[example.check];
    if (fn === undefined) {
      results.push({ split: dataset.split, id: example.id, name: example.name, pass: false,
        firstLine: `评分器没有 ${example.check} 这个检查` });
      continue;
    }
    let ctx;
    try {
      ctx = await openPage(example.env);
      const firstLine = await fn(ctx, example.expect, example);
      assert.equal(ctx.pageerrors.length, 0, `页面报错：${ctx.pageerrors.join(' | ')}`);
      results.push({ split: dataset.split, id: example.id, name: example.name, pass: true,
        firstLine, env: example.env });
    } catch (error) {
      results.push({ split: dataset.split, id: example.id, name: example.name, pass: false,
        firstLine: error instanceof Error ? error.message.split('\n')[0] : String(error),
        env: example.env });
    } finally {
      await ctx?.context.close();
    }
  }
}
await browser.close();

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
const record = {
  run: runId,
  split,
  base: BASE,
  at: new Date().toISOString(),
  summary: { total: results.length, passed, failed },
  results,
};
mkdirSync(OUT_DIR, { recursive: true });
const outFile = join(OUT_DIR, `${runId}.json`);
writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

for (const r of results) {
  console.log(`${r.pass ? '  ok' : 'FAIL'}  ${r.id} ${r.name} — ${r.firstLine}`);
}
console.log(`合计 ${results.length} 项，${passed} 通过 / ${failed} 失败`);
console.log(`读数：${existsSync(outFile) ? outFile : OUT_DIR}`);
if (failed > 0) process.exitCode = 1;
