#!/usr/bin/env node
/**
 * 视听反馈与世界法则（下雨躲雨 / 神谕光柱行礼 / 千人千音与程序化音效）EDD 评估脚本
 * 用法：
 *   node world-client/scripts/eval-sensory.mjs [--split main|held-out|all] [--url http://127.0.0.1:4173]
 *
 * 注意：请对照 world-client/src/ui/when-api.ts 对齐 window.__PIXEL_WORLD_DEBUG__ 挂钩名。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const EVAL_DIR = path.resolve(process.cwd(), 'world-client/eval/sensory');

function parseArgs(argv) {
  const args = { split: 'all', url: 'http://127.0.0.1:4173/?art=0&world=dengchao' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--split' && argv[i + 1]) args.split = argv[++i];
    else if (argv[i] === '--url' && argv[i + 1]) args.url = argv[++i];
  }
  return args;
}

async function loadSplit(name) {
  const filePath = path.join(EVAL_DIR, `${name}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function runCase(page, example) {
  const startedAt = performance.now();
  const networkAudioRequests = [];
  const networkImageRequests = [];
  const onRequest = (req) => {
    const url = req.url();
    if (/\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url)) networkAudioRequests.push(url);
    // 图片请求：K2 用「零外部图片请求」把「网络没发请求」升级成「源头确实是程序化」。
    if (/\.(png|webp|jpg|jpeg|gif)((\?|$))/i.test(url)) networkImageRequests.push(url);
  };
  page.on('request', onRequest);

  try {
    const result = await page.evaluate(async (ex) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      if (!api) return { ok: false, reason: 'missing window.__PIXEL_WORLD_DEBUG__' };

      if (ex.env?.seed) api.resetWorld({ world: ex.env.world ?? 'dengchao', seed: ex.env.seed, now: ex.env.now ?? 600 });
      if (ex.env?.weather) api.setWeather(ex.env.weather);

      switch (ex.check) {
        case 'rainShelter': {
          api.stepTicks(1);
          const v = api.getVillagerState(ex.input.villagerId);
          return {
            ok: v?.activeRule === ex.expect.activeRule && Boolean(v?.shelterTargetId),
            detail: v,
          };
        }
        case 'rainOraclePriority': {
          api.dispatchOracle({ kind: 'assign', villagerId: ex.input.villagerId, forced: true });
          api.stepTicks(1);
          const v = api.getVillagerState(ex.input.villagerId);
          return {
            ok: v?.activeRule !== 'rain-shelter' && Boolean(v?.hasForcedOracle),
            detail: v,
          };
        }
        case 'oracleSalute': {
          api.dispatchOracle({ kind: ex.input.command, villagerId: ex.input.villagerId });
          const at0 = api.getVillagerState(ex.input.villagerId)?.saluteTicksRemaining;
          const fxActive = api.hasActiveFx('oracle-beam');
          api.stepTicks(2);
          const at2 = api.getVillagerState(ex.input.villagerId)?.saluteTicksRemaining;
          return {
            ok: fxActive && at0 === ex.expect.saluteTicksRemainingAtTick0 && at2 === ex.expect.saluteTicksRemainingAtTick2,
            detail: { fxActive, at0, at2 },
          };
        }
        // H2：极端空旷地图（无建筑）时，躲雨规则回退，严禁仍判为 rain-shelter。
        case 'rainShelterFallback': {
          api.setWeather('rain');
          api.stepTicks(1);
          const v = api.getVillagerState(ex.input.villagerId);
          return { ok: v?.activeRule !== 'rain-shelter', detail: v };
        }
        // H3：行礼第 1 拍中途收到新神谕，平滑重置为 2 拍并补发光柱。
        case 'saluteResetOnNewOracle': {
          api.dispatchOracle({ kind: ex.input.command, villagerId: ex.input.villagerId, forced: false });
          api.stepTicks(1);
          api.dispatchOracle({ kind: 'assign', villagerId: ex.input.villagerId, forced: false });
          const v = api.getVillagerState(ex.input.villagerId);
          const beamActive = api.hasActiveFx('oracle-beam');
          return {
            ok: v?.saluteTicksRemaining === 2 && Boolean(beamActive),
            detail: { ticks: v?.saluteTicksRemaining, beamActive },
          };
        }
        case 'animaleseProfiles': {
          const profiles = api.getVillagerVoiceProfiles?.() ?? [];
          const uniqueKeys = new Set(profiles.map((p) => `${p.basePitch}:${p.wave}:${p.speedScale}`));
          const run1 = api.sampleAnimalesePitches?.('v_elder', ex.input.sampleText) ?? [];
          const run2 = api.sampleAnimalesePitches?.('v_elder', ex.input.sampleText) ?? [];
          return {
            ok: uniqueKeys.size >= ex.expect.uniqueProfileCount && JSON.stringify(run1) === JSON.stringify(run2),
            detail: { uniqueCount: uniqueKeys.size, run1 },
          };
        }
        case 'proceduralSfx': {
          const handled = ex.input.triggers.every((t) => api.triggerSfx?.(t) === true);
          return { ok: handled, detail: { handled } };
        }
        case 'rainClearResume': {
          api.setWeather('rain');
          api.stepTicks(1);
          api.setWeather('clear');
          api.stepTicks(1);
          const v = api.getVillagerState(ex.input.villagerId);
          return {
            ok: v?.activeRule !== 'rain-shelter',
            detail: v,
          };
        }
        case 'worldStillRuns': {
          const t0 = performance.now();
          api.stepTicks(10);
          const avgMs = (performance.now() - t0) / 10;
          return { ok: avgMs <= (ex.expect.maxAvgStepMs ?? 16.6), detail: { avgMs } };
        }
        case 'deterministicReplay': {
          api.resetWorld({ world: ex.env.world, seed: ex.env.seed, now: ex.env.now });
          api.setWeather('rain');
          api.dispatchOracle({ kind: 'assign', villagerId: 'v_elder' });
          api.stepTicks(4);
          const hashA = api.getStateHash();

          api.resetWorld({ world: ex.env.world, seed: ex.env.seed, now: ex.env.now });
          api.setWeather('rain');
          api.dispatchOracle({ kind: 'assign', villagerId: 'v_elder' });
          api.stepTicks(4);
          const hashB = api.getStateHash();
          return { ok: Boolean(hashA) && hashA === hashB, detail: { hashA, hashB } };
        }
        case 'saveSchemaIntact': {
          api.setWeather('rain');
          api.dispatchOracle({ kind: 'assign', villagerId: 'v_elder' });
          api.stepTicks(1);
          const raw = api.exportSaveJson();
          const parsed = JSON.parse(raw);
          const hasFields = ex.expect.persistedFields.every((f) => raw.includes(f));
          return { ok: Boolean(parsed) && hasFields, detail: { hasFields } };
        }
        default:
          return { ok: false, reason: `unhandled check: ${ex.check}` };
      }
    }, example);

    if (example.expect?.audioNetworkRequests === 0 && networkAudioRequests.length > 0) {
      return { id: example.id, ok: false, durationMs: performance.now() - startedAt, reason: 'unexpected external audio request' };
    }
    if (example.expect?.imageNetworkRequests === 0) {
      return { id: example.id, ok: networkImageRequests.length === 0, durationMs: performance.now() - startedAt, detail: { imageRequests: networkImageRequests.length } };
    }
    return { id: example.id, ok: result.ok, durationMs: performance.now() - startedAt, detail: result.detail ?? result.reason };
  } finally {
    page.off('request', onRequest);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const splits = args.split === 'all' ? ['main', 'held-out'] : [args.split];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let total = 0;
  let passed = 0;

  try {
    // 调试桥只在 `?debug=1` 下挂载：让页面带上这个参数，否则所有探针都「缺桥」判红。
    const finalUrl = args.url.includes('debug=1')
      ? args.url
      : args.url.includes('?')
        ? `${args.url}&debug=1`
        : `${args.url}?debug=1`;
    await page.goto(finalUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__PIXEL_WORLD_DEBUG__), null, { timeout: 15000 });
    async function gotoWorld(worldId) {
      // H2 需要「无建筑」的极端世界，而 resetWorld 用的是页面加载时捕获的 simDeps
      // （create() 从当前 URL 的设定集建出来的），所以要先切世界、等桥重新挂载。
      const base = args.url.split('?')[0];
      await page.goto(`${base}?art=0&world=${worldId}&debug=1`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(window.__PIXEL_WORLD_DEBUG__), null, { timeout: 15000 });
    }
    for (const splitName of splits) {
      const dataset = await loadSplit(splitName);
      console.log(`\n=== Running sensory eval split: ${splitName} (${dataset.examples.length} cases) ===`);
      for (const ex of dataset.examples) {
        total++;
        if (splitName === 'held-out' && ex.id === 'H2') {
          await gotoWorld('empty-map');
        }
        const res = await runCase(page, ex);
        // H2 之后回到有建筑的设定集，供 H3–H6 继续跑（它们依赖正常世界状态）。
        if (splitName === 'held-out' && ex.id === 'H2' && ex.id !== 'H1') {
          await gotoWorld('dengchao');
        }
        if (res.ok) passed++;
        console.log(`[${res.ok ? 'PASS' : 'FAIL'}] ${ex.id} (${ex.name}) - ${res.durationMs.toFixed(1)}ms`);
        if (!res.ok) console.log('   detail:', JSON.stringify(res.detail));
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nSummary: ${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});