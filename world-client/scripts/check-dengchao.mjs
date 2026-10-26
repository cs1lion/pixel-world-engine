#!/usr/bin/env node
/**
 * 灯潮界的浏览器验收：验的是**屏幕上看得见**的那几件事。
 *
 * 与 `accept-live.mjs` 的分工：
 *   - 那边验命令闭环（一句话 → 服务端 → 白名单 → 世界真的变了），要起服务端与模型桩；
 *   - 这边验"换了设定集之后世界本身还成立"：五个区域标签真的画在 DOM 上、
 *     两位居民真的在走、拨潮真的改了画面与作息、两套存档互不串。
 *
 * 所以这里**不需要服务端**：`?feed=off` 让世界完全离线自转。
 * 只需要一个跑着的 Vite dev server（`npm run dev:live` 或 `npm run dev`）。
 *
 * 跑法：
 *   npm run dev:live        # 另一个终端
 *   npm run test:setting
 *
 * 端口可用 `PIXEL_WORLD_URL` 覆盖，例如 `PIXEL_WORLD_URL=http://127.0.0.1:5173/`。
 */

import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';
const OUT = resolve(import.meta.dirname, '..', 'eval', 'screens');
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (ok, label) => {
  assert.ok(ok, label);
  checks.push(label);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1010, height: 940 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

const view = () => page.evaluate(() => window.Oracle.view());

/**
 * 投递一句话并等真实回执。
 *
 * 监听必须先挂上再投递，且必须在**同一个** `evaluate` 里：分成两次调用时，
 * 回执会在投递那一拍就过去，等下一个 evaluate 挂上监听时已经晚了（实测超时）。
 */
const say = (text) =>
  page.evaluate(
    (line) =>
      new Promise((done) => {
        const stop = window.Oracle.onResult((result) => {
          if (result.message.includes('投递')) return;
          stop();
          done(result);
        });
        window.Oracle.say(line);
        setTimeout(() => {
          stop();
          done({ ok: false, message: 'timeout' });
        }, 20_000);
      }),
    text,
  );

const open = async (query) => {
  await page.goto(`${BASE}${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.Oracle?.view === 'function', null, {
    timeout: 20_000,
  });
  await page.waitForTimeout(1200);
};

try {
  // ---------------- 1) 灯潮界能启动，五个区域与六栋建筑都在
  await open('?world=dengchao&feed=off&time=noon');
  const first = await view();
  check((await page.title()).includes('灯潮界'), '页面标题是灯潮界');
  check(first.buildings.length === 6, '六栋建筑显式落位');
  check(
    first.villagers.length === 2 && first.villagers.every((v) => v.lampOil === 1),
    '两位居民满油出生',
  );
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.setting-region-label')].map((node) => node.textContent),
  );
  check(
    ['渡口站台', '浅滩轨道', '叠浪楼', '灯街', '积尘滩'].every((name) => labels.includes(name)),
    `五个区域标签都在：${labels.join(' / ')}`,
  );
  check(
    first.villagers[0].pos.x !== first.villagers[1].pos.x,
    '两位居民没有重叠出生',
  );
  // 输入框里的例句是玩家看到的第一句"能说什么"。默认世界写死的「建一间工坊」
  // 在灯潮界没有这个模板，照抄就是个注定被拒的例子。
  const placeholder = await page.getAttribute('#utterance', 'placeholder');
  check(
    typeof placeholder === 'string' && placeholder.includes('候车亭'),
    `输入框的例子换成了这张图真能建的东西：${placeholder}`,
  );

  // ---------------- 2) 世界真的自己过日子，不是一张静止的画
  await page.waitForTimeout(6000);
  const walked = await view();
  check(walked.now > first.now, '世界时钟在走');
  check(
    walked.villagers.some((v) => v.routine !== null),
    '居民进入了自己的作息',
  );
  check(
    walked.villagers.some(
      (v, i) => v.pos.x !== first.villagers[i].pos.x || v.pos.y !== first.villagers[i].pos.y,
    ),
    '居民真的移动了',
  );
  await page.screenshot({ path: join(OUT, 'dengchao-noon.png') });

  // ---------------- 3) 拨潮：画面、状态行、作息三处一起变
  await page.evaluate(() => window.Oracle.centerCameraOn(20 * 16, 9 * 16));
  const high = await say('涨潮');
  check(high.ok, `涨潮回执成功：${high.message}`);
  const highView = await view();
  check(highView.tide.level === 1 && highView.tide.overridden, '潮位真的被拨到满潮');
  await page.screenshot({ path: join(OUT, 'dengchao-tide-high.png') });

  const low = await say('退潮');
  check(low.ok, `退潮回执成功：${low.message}`);
  const lowView = await view();
  check(lowView.tide.level === 0, '潮位真的退到底');
  await page.screenshot({ path: join(OUT, 'dengchao-tide-low.png') });

  // ---------------- 4) 越界的话给具体拒绝，世界一动没动
  const before = await view();
  const refused = await say('涨潮到五米');
  check(!refused.ok, '越界命令被拒绝');
  check(
    typeof refused.message === 'string' && refused.message.length > 0,
    `拒绝有具体原因：${refused.message}`,
  );
  const after = await view();
  check(after.tide.level === before.tide.level, '被拒绝的命令没有改变世界');

  // ---------------- 5) 刷新后还是同一片灯潮界，且写在自己的存档槽
  await say('涨潮');
  await page.evaluate(() => window.Oracle.saveNow());
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check(
    keys.some((key) => key.includes('dengchao')),
    '灯潮界写进了自己的存档槽',
  );
  await open('?world=dengchao&feed=off&time=noon');
  const reloaded = await view();
  check((await page.title()).includes('灯潮界'), '刷新后仍是灯潮界');
  check(reloaded.buildings.length === 6, '刷新后建筑没有丢');
  check(
    ['迷路人', '汐'].every((name) => reloaded.villagers.some((v) => v.name === name)),
    '刷新后还是那两位居民',
  );

  // ---------------- 6) 打开灯潮界不会改坏旧世界
  await open('?feed=off&time=noon');
  const legacy = await view();
  check(!(await page.title()).includes('灯潮界'), '省略参数仍进旧世界');
  check(legacy.buildings.length > 6, '旧世界还是它自己那张大图');
  check(
    await page.evaluate(() => localStorage.getItem('dengchao.pixel-world.save.v1') !== null),
    '旧世界没有清掉灯潮界的存档',
  );

  check(errors.length === 0, `全程没有页面报错${errors.length > 0 ? `：${errors.join(' | ')}` : ''}`);

  console.log(`\n灯潮界浏览器验收通过（${checks.length} 项）：`);
  for (const label of checks) console.log(`  ok  ${label}`);
  console.log(`截图：${OUT}`);
} catch (error) {
  console.error(`\n失败：${error.message}`);
  console.error(`已完成 ${checks.length} 项：`);
  for (const label of checks) console.error(`  ok  ${label}`);
  if (errors.length > 0) console.error(`页面报错：\n${errors.join('\n')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
