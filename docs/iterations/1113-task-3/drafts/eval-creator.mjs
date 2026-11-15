#!/usr/bin/env node
/**
 * world-client/scripts/eval-creator.mjs
 * 造物主（Creator）模块 EDD 自动化评测脚本（对齐 eval-interaction.mjs 规范）
 *
 * 运行方式：
 *   node scripts/eval-creator.mjs --split=main
 *   node scripts/eval-creator.mjs --split=heldout
 *   node scripts/eval-creator.mjs --split=all
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATASET = join(ROOT, 'eval', 'creator');
const BASE_URL = process.env.EVAL_BASE_URL || 'http://127.0.0.1:5211';
const OUT_DIR = process.env.EVAL_OUT || join(ROOT, 'tmp', 'eval-creator');

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, v] = arg.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const split = args.split || 'all';
const runId = args.run || `creator-${split}-${Date.now()}`;

const load = (name) => JSON.parse(readFileSync(join(DATASET, name), 'utf8'));

/**
 * 打开带有指定环境查询参数的测试页面并收集运行时错误与网络请求
 */
async function openPage(browser, env) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const pageerrors = [];
  const imageRequests = [];

  page.on('pageerror', (err) => pageerrors.push(String(err.message || err)));
  page.on('request', (req) => {
    if (req.resourceType() === 'image' || /\.(png|webp|jpg|jpeg)$/i.test(req.url())) {
      imageRequests.push(req.url());
    }
  });

  const params = new URLSearchParams({
    world: String(env.world ?? 'dengchao'),
    now: String(env.now ?? 540),
    phase: String(env.phase ?? 'noon'),
    feed: String(env.feed ?? 'off'),
    debug: String(env.debug ?? 1),
  });
  if (env.art !== undefined) params.set('art', String(env.art));
  if (env.seed !== undefined) params.set('seed', String(env.seed));
  if (env.tide !== undefined) params.set('tide', String(env.tide));

  await page.goto(`${BASE_URL}/?${params.toString()}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__PIXEL_WORLD_DEBUG__), { timeout: 8000 });

  return { context, page, pageerrors, imageRequests };
}

/**
 * 评分器核心检查表（CHECKS）：每一项必须核查真实 WorldState 与落盘存档字节，杜绝仅改 View 的假绿
 */
export const CHECKS = {
  /**
   * M1 / H1 / H2: 螺旋选址器零重叠、遵守 clearMargin 与潮汐淹没禁建区
   */
  async slotAllocation(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ input }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        const outcome = api.dispatchCreatorCommand(input);
        api.stepTicks(1);
        const rawSave = api.exportSaveBytes();
        const reloaded = api.inspectSaveBytes(rawSave);
        return {
          rejected: outcome.rejected ?? false,
          rejectCode: outcome.code ?? null,
          overlapCount: reloaded.metrics.overlapCount,
          minClearMargin: reloaded.metrics.minClearMargin,
          submergedCount: reloaded.metrics.submergedBuildingCount ?? 0,
          placedRegion: outcome.placedRegion ?? null,
        };
      },
      { input: example.input },
    );

    if (expect.shouldReject) {
      assert.equal(res.rejected, true, `预期满载或非法选址应被拒绝，实际未拒绝`);
      assert.equal(res.rejectCode, expect.rejectCode, `拒因代码不匹配: ${res.rejectCode}`);
      return `rejected as expected (${res.rejectCode})`;
    }

    assert.equal(res.rejected, false, `合法蓝图选址被意外拒绝: ${res.rejectCode}`);
    assert.equal(res.overlapCount, expect.overlapCount, `建筑重叠数不为 0: ${res.overlapCount}`);
    assert.ok(
      res.minClearMargin >= expect.minClearMargin,
      `建筑安全边距不足: ${res.minClearMargin} < ${expect.minClearMargin}`,
    );
    if (expect.submergedBuildingCount !== undefined) {
      assert.equal(res.submergedCount, expect.submergedBuildingCount, `高潮位淹没区违规建房`);
    }
    if (expect.inRegion) {
      assert.equal(res.placedRegion, expect.inRegion, `未落在目标分区 ${expect.inRegion}`);
    }
    return `slot allocated (overlap=${res.overlapCount}, margin=${res.minClearMargin})`;
  },

  /**
   * M2 / H3: 建筑门口自动修路并绕开障碍物连入主干道网（pathfindingConnectivity === 1.0）
   */
  async roadAutoPave(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ input }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        const outcome = api.dispatchCreatorCommand(input);
        api.stepTicks(1);
        const rawSave = api.exportSaveBytes();
        const reloaded = api.inspectSaveBytes(rawSave);
        return {
          connectivity: reloaded.metrics.pathfindingConnectivity,
          doorWalkableToAltar: reloaded.metrics.doorWalkableToAltar,
          roadCrossedObstacle: reloaded.metrics.roadCrossedObstacle ?? false,
          pavedTiles: outcome.pavedRoadCount ?? 0,
        };
      },
      { input: example.input },
    );

    assert.equal(
      res.connectivity,
      expect.pathfindingConnectivity,
      `道路连通率未达标: ${res.connectivity}`,
    );
    assert.equal(res.doorWalkableToAltar, expect.doorWalkableToAltar, `新建筑门口无法步行至祭坛`);
    assert.equal(res.roadCrossedObstacle, false, `自动修路穿过了不可通行障碍物`);
    assert.ok(res.pavedTiles > 0, `未生成任何铺路瓦片`);
    return `road connected (tiles=${res.pavedTiles}, connectivity=${res.connectivity})`;
  },

  /**
   * M3 / H5: 脚手架施工倒计时（scaffolding -> completed）、施工烟尘与中途存档恢复
   */
  async constructionLifecycle(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ input, testMidSave }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        const placed = api.dispatchCreatorCommand(input);
        const bId = placed.buildingId;

        // 第 1 拍：处于 scaffolding 阶段，冒施工烟尘，前檐层隐藏，脚手架线框可见
        api.stepTicks(1);
        const snap1 = api.getBuildingSnapshot(bId);
        const render1 = api.getBuildingRenderState(bId);

        // 若测试中途存档恢复（H5），在第 1 拍导出存档并重载，再推进剩余 2 拍
        if (testMidSave) {
          const midBytes = api.exportSaveBytes();
          api.loadSaveBytes(midBytes);
        }

        // 推进剩余拍数直至完工
        const remaining = (input.constructionTicks ?? 3) - 1;
        api.stepTicks(remaining);
        const rawSave = api.exportSaveBytes();
        const reloaded = api.inspectSaveBytes(rawSave);
        const snapEnd = reloaded.buildings.find((b) => b.id === bId);
        const renderEnd = api.getBuildingRenderState(bId);

        return {
          stageAtTick1: snap1.stage,
          smokeActiveAtTick1: render1.smokeActive && render1.scaffoldingVisible && !render1.frontEavesVisible,
          stageAtEnd: snapEnd?.stage,
          ticksLeftAtEnd: snapEnd?.constructionTicksRemaining,
          frontEavesAtEnd: renderEnd.frontEavesVisible && !renderEnd.scaffoldingVisible,
          chronicleAdded: reloaded.chronicleCount > 0,
        };
      },
      { input: example.input, testMidSave: Boolean(expect.reloadMidConstruction) },
    );

    assert.equal(res.stageAtTick1, expect.stageAtTick1, `第 1 拍阶段应为 scaffolding`);
    assert.equal(res.smokeActiveAtTick1, expect.smokeActiveAtTick1, `第 1 拍未激活施工烟尘与脚手架`);
    assert.equal(res.stageAtEnd, expect.stageAtTick3, `完工拍未切换为 completed`);
    assert.equal(res.ticksLeftAtEnd, 0, `完工后剩余施工拍数未归零`);
    assert.equal(res.frontEavesAtEnd, true, `完工后前檐层未正常展开或脚手架未移除`);
    assert.equal(res.chronicleAdded, expect.chronicleAdded, `建筑落成未记入编年史`);
    return `lifecycle verified (tick1=${res.stageAtTick1} -> end=${res.stageAtEnd})`;
  },

  /**
   * M4: 建筑原位升级（保留坐标与门口道路，替换蓝图与外观）
   */
  async buildingUpgrade(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ input }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        const before = api.getBuildingSnapshot(input.targetId);
        api.dispatchCreatorCommand(input);
        api.stepTicks(input.constructionTicks ?? 2);
        const rawSave = api.exportSaveBytes();
        const reloaded = api.inspectSaveBytes(rawSave);
        const after = reloaded.buildings.find((b) => b.id === input.targetId);
        return {
          sameOrigin: before.origin.x === after.origin.x && before.origin.y === after.origin.y,
          newPrefabId: after.prefabId,
          roadPreserved: reloaded.metrics.pathfindingConnectivity === 1.0,
        };
      },
      { input: example.input },
    );

    assert.equal(res.sameOrigin, expect.sameOrigin, `原位升级改变了建筑原点坐标`);
    assert.equal(res.newPrefabId, expect.newPrefabId, `升级后蓝图 ID 未更新`);
    assert.equal(res.roadPreserved, expect.roadPreserved, `升级后破坏了原有道路连通性`);
    return `upgraded in-place to ${res.newPrefabId}`;
  },

  /**
   * M5: 人工挪动/驳回 Diff 经 RuleSynthesizer 合成自证规则并在后续选址中强制生效
   */
  async diffRuleSynthesis(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ input }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        const synth = api.applyHumanDiff(input);
        const rawSave = api.exportSaveBytes();
        const reloaded = api.inspectSaveBytes(rawSave);
        const nextAttempt = api.testViolationAgainstActiveRules(input.agentProposal);
        return {
          patchKind: synth.patches[0]?.kind ?? null,
          selfJustifying: synth.selfJustifying,
          persistedRuleCount: reloaded.creatorRules.length,
          enforcedOnNextPlace: nextAttempt.blockedByRule,
        };
      },
      { input: example.input },
    );

    assert.equal(res.patchKind, expect.patchKind, `未合成预期类型的规则补丁`);
    assert.equal(res.selfJustifying, expect.selfJustifying, `合成补丁未通过 isSelfJustifying 校验`);
    assert.ok(res.persistedRuleCount > 0, `合成的规则补丁未落盘至存档`);
    assert.equal(res.enforcedOnNextPlace, expect.enforcedOnNextPlace, `新规则未在后续选址中生效拦截`);
    return `synthesized ${res.patchKind} (persisted=${res.persistedRuleCount})`;
  },

  /**
   * M6 / H6: 连续违规触发 AutonomousFuseController 熔断降级与回归达标恢复
   */
  async fuseDowngrade(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ input }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        const state = api.simulateCreatorFuseSequence(input);
        const rawSave = api.exportSaveBytes();
        const reloaded = api.inspectSaveBytes(rawSave);
        return {
          isFused: reloaded.fuseState[input.role].isFused,
          fromLevel: state.lastEvent.fromLevel,
          toLevel: reloaded.fuseState[input.role].level,
          lastEvent: state.lastEvent.type,
          resumed: state.resumed ?? false,
        };
      },
      { input: example.input },
    );

    assert.equal(res.isFused, expect.isFused, `熔断状态不匹配`);
    assert.equal(res.toLevel, expect.toLevel, `自治等级未按预期切换: ${res.toLevel}`);
    assert.equal(res.lastEvent, expect.lastEvent, `熔断事件类型不匹配: ${res.lastEvent}`);
    return `fuse event=${res.lastEvent} (L${res.fromLevel}->L${res.toLevel})`;
  },

  /**
   * K1: 造物主执行期间世界时钟正常推进且单拍耗时低于 16.6ms 硬闸
   */
  async worldStillRuns(ctx, expect) {
    const res = await ctx.page.evaluate(() => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const t0 = api.getWorldTime();
      const stats = api.benchmarkCreatorStep(10);
      const t1 = api.getWorldTime();
      return { clockAdvanced: t1 > t0, avgStepMs: stats.avgStepMs };
    });

    assert.equal(res.clockAdvanced, expect.clockAdvanced, `造物主操作阻塞了世界时钟推进`);
    assert.ok(
      res.avgStepMs <= expect.maxAvgStepMs,
      `单拍平均耗时超标: ${res.avgStepMs.toFixed(2)}ms > ${expect.maxAvgStepMs}ms`,
    );
    return `clock advanced, avgStepMs=${res.avgStepMs.toFixed(2)}ms`;
  },

  /**
   * K2: ?art=0 模式下新增建筑与脚手架保持零图片网络请求
   */
  async artOffZeroRequests(ctx, expect) {
    await ctx.page.evaluate(() => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      api.dispatchCreatorCommand({ kind: 'PlaceBuilding', prefabId: 'workshop_lantern', region: 'industrial' });
      api.stepTicks(3);
    });
    assert.equal(
      ctx.imageRequests.length,
      expect.imageNetworkRequests,
      `?art=0 模式下产生了非零图片请求: ${ctx.imageRequests.join(', ')}`,
    );
    return `zero image requests verified`;
  },

  /**
   * K3: 相同初始存档与相同创世批次重放两次，状态哈希与网格快照 100% 一致
   */
  async deterministicReplay(ctx, expect, example) {
    const res = await ctx.page.evaluate(
      ({ seed }) => {
        const api = window.__PIXEL_WORLD_DEBUG__;
        return api.verifyCreatorDeterministicReplay(seed, 5);
      },
      { seed: example.env.seed },
    );

    assert.equal(res.stateHashMatch, expect.stateHashMatch, `两次重放的状态哈希不一致`);
    assert.equal(res.gridSnapshotMatch, expect.gridSnapshotMatch, `两次重放的网格与道路快照不一致`);
    return `deterministic replay bit-exact (hash=${res.hash})`;
  },

  /**
   * K4 / H4: 存档 schemaVersion 不变且跨设定集蓝图色板兼容
   */
  async saveSchemaIntact(ctx, expect) {
    const res = await ctx.page.evaluate(() => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const vBefore = api.getSaveSchemaVersion();
      api.dispatchCreatorCommand({ kind: 'PlaceBuilding', prefabId: 'workshop_lantern', region: 'industrial' });
      api.stepTicks(2);
      const raw = JSON.parse(api.exportSaveBytes());
      return {
        schemaVersionUnchanged: raw.schemaVersion === vBefore,
        keys: Object.keys(raw),
      };
    });

    assert.equal(res.schemaVersionUnchanged, expect.schemaVersionUnchanged, `存档 schemaVersion 被篡改`);
    for (const field of expect.persistedFields) {
      assert.ok(res.keys.includes(field), `落盘存档缺少必需字段: ${field}`);
    }
    return `save schema intact (${expect.persistedFields.join(', ')})`;
  },
};

async function main() {
  const datasets =
    split === 'all'
      ? [load('main.json'), load('held-out.json')]
      : [load(split === 'main' ? 'main.json' : 'held-out.json')];

  const browser = await chromium.launch({ headless: true });
  const results = [];
  let passed = 0;
  let failed = 0;

  try {
    for (const dataset of datasets) {
      for (const example of dataset.examples) {
        const fn = CHECKS[example.check];
        assert.ok(typeof fn === 'function', `未知的检查函数: ${example.check}`);

        let ctx;
        try {
          ctx = await openPage(browser, example.env);
          const firstLine = await fn(ctx, example.expect, example);
          assert.equal(
            ctx.pageerrors.length,
            0,
            `页面运行时错误: ${ctx.pageerrors[0] || ''}`,
          );
          passed += 1;
          results.push({
            split: dataset.split,
            id: example.id,
            name: example.name,
            pass: true,
            firstLine: String(firstLine),
            env: example.env,
          });
          console.log(`[PASS] [${dataset.split}] ${example.id} ${example.name} -> ${firstLine}`);
        } catch (err) {
          failed += 1;
          const firstLine = String(err?.message || err).split('\n')[0];
          results.push({
            split: dataset.split,
            id: example.id,
            name: example.name,
            pass: false,
            firstLine,
            env: example.env,
          });
          console.error(`[FAIL] [${dataset.split}] ${example.id} ${example.name} -> ${firstLine}`);
        } finally {
          if (ctx) await ctx.context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    run: runId,
    split,
    base: BASE_URL,
    at: new Date().toISOString(),
    summary: { total: passed + failed, passed, failed },
    results,
  };
  const outPath = join(OUT_DIR, `${runId}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n[eval-creator] Total=${report.summary.total} Passed=${passed} Failed=${failed} -> ${outPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}