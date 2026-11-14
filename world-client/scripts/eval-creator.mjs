#!/usr/bin/env node
/**
 * 造物主（Creator）EDD 评分器。
 *
 * 跑法（`world-client/` 下，先起 dev 服）：
 *   node scripts/eval-creator.mjs --split=main
 *   node scripts/eval-creator.mjs --split=heldout
 *   node scripts/eval-creator.mjs --split=all
 *
 * **它评分的方式只有一条：读真实存档字节。** 每条 check 都先 `exportSaveBytes()`
 * 再 `inspectSaveBytes()`，断言落在反序列化出来的世界账本上，不读场景里画了什么。
 * 理由很简单：只改 Phaser 视图的那种「假绿」，在字节面前立刻露馅。
 *
 * 调试桥 `window.__PIXEL_WORLD_DEBUG__` 是**测试面，不是白名单**：
 *   - 它只在 `?debug=1` 下挂载，生产路径上不存在；
 *   - 它认的 `UpgradeBuilding` / `ApplyHumanDiff` / `InjectViolations` 这些动作
 *     **不在** `GENESIS_COMMAND_KINDS` 里，也不进服务端规则层。白名单是 LLM 的合法域，
 *     这个桥是验收面，两者不许混——混了就会为了测试放宽 LLM 能做的事。
 *
 * 数据集 env 到 URL 的翻译是显式的一张表（见 `urlFor`）：
 * 数据集里的 `phase` 对应页面的 `time`，`seed` 对应 `debugPinSeed`。
 * 页面**没有** `art` 与 `tide` 参数，所以 K2 直接断言零图片请求，V1 用注入拨潮位。
 */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = join(ROOT, 'eval', 'creator');
const BASE_URL = process.env.EVAL_BASE_URL || 'http://127.0.0.1:5211';
const OUT_DIR = process.env.EVAL_OUT || join(ROOT, 'tmp', 'eval-creator');
/** 调试桥挂载超时。它没挂上，说明这一版还没有桥——那是红灯的正确形状，不是超时故障。 */
const BRIDGE_TIMEOUT_MS = 8000;

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);
const split = args.split || 'all';
const runId = args.run || `creator-${split}`;

const load = (name) => JSON.parse(readFileSync(join(DATASET, name), 'utf8'));

/** 数据集 env → 页面 URL 参数。注释里那张表就是这里。 */
function urlFor(env) {
  const params = new URLSearchParams({
    world: String(env.world ?? 'dengchao'),
    now: String(env.now ?? 540),
    time: String(env.phase ?? 'noon'),
    feed: String(env.feed ?? 'off'),
    debug: String(env.debug ?? 1),
  });
  if (env.seed !== undefined) params.set('debugPinSeed', String(env.seed));
  return `${BASE_URL}/?${params.toString()}`;
}

/**
 * 打开一条用例的页面，并等调试桥出现。
 *
 * 顺带收集两样东西：页面报错（任何一条都判该用例失败）与图片请求（K2 读它）。
 */
async function openPage(browser, example) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const imageRequests = [];

  page.on('pageerror', (error) => pageErrors.push(String(error.message || error)));
  page.on('request', (request) => {
    if (request.resourceType() === 'image' || /\.(png|webp|jpg|jpeg|gif)$/i.test(request.url())) {
      imageRequests.push(request.url());
    }
  });

  await page.goto(urlFor(example.env), { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => Boolean(window.__PIXEL_WORLD_DEBUG__), null, {
      timeout: BRIDGE_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `调试桥 window.__PIXEL_WORLD_DEBUG__ 在 ${BRIDGE_TIMEOUT_MS}ms 内没有挂上` +
        `（?debug=1 且场景 create 之后应当存在）。当前这一版还没有桥，所以这是预期的红灯。`,
    );
  }

  // 页面自身会加载设定集素材（`public/assets/**`，由 main 的绘制管线引入）。
  // K2 要验的是「造物不新增请求」，所以基线必须取在造物之前。
  const imageBaseline = imageRequests.length;
  return { context, page, pageErrors, imageRequests, imageBaseline };
}

/** 跑一条用例：开页面 → 按序执行 setup → 交给对应的 check。 */
async function runExample(browser, example) {
  // 开页面必须也在 try 里：桥没挂上时 `openPage` 抛，若放在 try 外面，
  // 一条用例的失败会中止整轮——十份报告缩成一条栈，看起来像评分器坏了。
  let session = null;
  try {
    session = await openPage(browser, example);
    for (const command of example.setup ?? []) {
      await session.page.evaluate((cmd) => {
        const outcome = window.__PIXEL_WORLD_DEBUG__.dispatchCreatorCommand(cmd);
        if (outcome && outcome.rejected) {
          throw new Error(`setup 被拒绝：${cmd.kind} → ${outcome.code ?? 'unknown'}`);
        }
        return outcome;
      }, command);
      await session.page.evaluate(() => window.__PIXEL_WORLD_DEBUG__.stepTicks(1));
    }

    // 每个 check 拿到的 ctx 里带着自己那条用例：输入、期望、以及收集到的页面读数。
    const ctx = { ...session, browser, example, expect: example.expect };
    const detail = await CHECKS[example.check](ctx, example.expect, example);
    if (session.pageErrors.length > 0) {
      throw new Error(`页面报错：${session.pageErrors.join(' | ')}`);
    }
    return { ok: true, detail };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (session !== null) await session.context.close();
  }
}

export const CHECKS = {
  /** M1 / H1 / V1：确定性选址——零重叠、留白边距、分区、淹没格。 */
  async slotAllocation(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const outcome = api.dispatchCreatorCommand(input);
      api.stepTicks(1);
      const reloaded = api.inspectSaveBytes(api.exportSaveBytes());
      return {
        rejected: Boolean(outcome?.rejected),
        rejectCode: outcome?.code ?? null,
        instanceId: outcome?.instanceId ?? null,
        overlapCount: reloaded.metrics.overlapCount,
        minClearMargin: reloaded.metrics.minClearMargin,
        submergedBuildingCount: reloaded.metrics.submergedBuildingCount ?? 0,
        placedRegion: outcome?.placedRegion ?? null,
      };
    }, ctx.example.input);

    if (expect.shouldReject === true) {
      assert.equal(res.rejected, true, '预期满载/非法选址应被拒绝，实际放行了');
      assert.equal(res.rejectCode, expect.rejectCode, `拒因代码不匹配：${res.rejectCode}`);
      return `rejected(${res.rejectCode})`;
    }

    assert.equal(res.rejected, false, `合法蓝图被拒绝：${res.rejectCode}`);
    assert.equal(res.overlapCount, expect.overlapCount, `重叠数 ${res.overlapCount} ≠ ${expect.overlapCount}`);
    assert.ok(
      res.minClearMargin >= expect.minClearMargin,
      `留白边距 ${res.minClearMargin} < ${expect.minClearMargin}`,
    );
    if (expect.submergedBuildingCount !== undefined) {
      assert.equal(res.submergedBuildingCount, expect.submergedBuildingCount, '高潮位落进了淹没格');
    }
    if (expect.inRegion !== undefined) {
      assert.equal(res.placedRegion, expect.inRegion, `没落在目标分区 ${expect.inRegion}`);
    }
    return `slot(${res.instanceId}, overlap=${res.overlapCount}, margin=${res.minClearMargin})`;
  },

  /** M2 / H2：门口自动铺路并连进主干道网。 */
  async roadAutoPave(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const outcome = api.dispatchCreatorCommand(input);
      api.stepTicks(2);
      const reloaded = api.inspectSaveBytes(api.exportSaveBytes());
      return {
        rejected: Boolean(outcome?.rejected),
        rejectCode: outcome?.code ?? null,
        connectivity: reloaded.metrics.pathfindingConnectivity,
        doorWalkableToAltar: reloaded.metrics.doorWalkableToAltar,
        roadTileCount: reloaded.roads.length,
        blockedTiles: reloaded.blockedTiles ?? [],
        plan: reloaded.lastRoadPlan ?? null,
      };
    }, ctx.example.input);

    // H2（spec 组）的防假绿：障碍必须真种进生产网格、生产铺出的路不穿它、
    // 且 `doorReaches` 仍判连通。
    // 旧断言「pathLength > straightDistance」测的是本仓曾经那套平行 BFS 的绕行长度；
    // P0 收敛后路径来自生产 `grid.path` 的存档增量，长度由生产算法决定，
    // 拿旧口径卡生产是拿错了尺子。这里改用生产自己提供的连通性判据。
    const hasObstacleSetup = (ctx.example.setup ?? []).some(
      (cmd) => cmd.kind === 'PlantObstacleAtDoor',
    );
    if (hasObstacleSetup) {
      assert.ok(res.blockedTiles.length > 0, 'setup 没有往生产网格种下任何障碍');
      assert.ok(res.plan !== null, '没有铺路读数，无法证明生产真的铺了路');
      const crossing = res.plan.path.filter((key) => res.blockedTiles.includes(key));
      assert.equal(crossing.length, 0, `生产铺出的路穿过了障碍格：${crossing.join(', ')}`);
      assert.ok(res.plan.pathLength > 0, '存档里没有新增道路格——生产没有铺路');
      assert.equal(res.doorWalkableToAltar, true, 'doorReaches 判门口连不到祭坛');
    }

    assert.equal(res.rejected, false, `落位被拒绝：${res.rejectCode}`);
    assert.equal(
      res.connectivity,
      expect.pathfindingConnectivity,
      `连通率 ${res.connectivity} ≠ ${expect.pathfindingConnectivity}`,
    );
    assert.equal(res.doorWalkableToAltar, expect.doorWalkableToAltar, '门口走不到主干道');
    assert.ok(res.roadTileCount > 0, '铺路之后存档里一条路都没有——那是没落盘');
    return `road(connectivity=${res.connectivity}, tiles=${res.roadTileCount})`;
  },

  /** M3 / H3：脚手架 → 完工，中途可导出存档并续跑。 */
  async constructionLifecycle(ctx, expect) {
    const first = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const outcome = api.dispatchCreatorCommand(input);
      api.stepTicks(1);
      const rawSave = api.exportSaveBytes();
      const reloaded = api.inspectSaveBytes(rawSave);
      const building = reloaded.buildings.find((b) => b.instanceId === outcome?.instanceId);
      return {
        instanceId: outcome?.instanceId ?? null,
        stage: building?.stage ?? null,
        smokeActive: Boolean(building?.smokeActive),
        chronicleAdded: reloaded.chronicle.some(
          (entry) => entry.kind === 'building.scaffolding_started' && entry.buildingId === outcome?.instanceId,
        ),
        bytes: rawSave,
      };
    }, ctx.example.input);

    assert.equal(first.stage, expect.stageAtTick1, `第 1 拍阶段 ${first.stage} ≠ ${expect.stageAtTick1}`);
    assert.equal(first.smokeActive, expect.smokeActiveAtTick1, '第 1 拍施工烟尘没起');
    if (expect.chronicleAdded) {
      assert.equal(first.chronicleAdded, true, '脚手架开工没有写进编年史');
    }

    if (expect.reloadMidConstruction) {
      await ctx.page.evaluate((bytes) => window.__PIXEL_WORLD_DEBUG__.reloadFromBytes(bytes), first.bytes);
    }

    const last = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      api.stepTicks(Math.max(1, Number(input.constructionTicks ?? 3)));
      const reloaded = api.inspectSaveBytes(api.exportSaveBytes());
      return {
        stage: reloaded.buildings.find((b) => b.stage === 'completed')?.stage ?? null,
        chronicleAdded: reloaded.chronicle.some((entry) => entry.kind === 'building.completed'),
      };
    }, ctx.example.input);

    assert.equal(last.stage, expect.stageAtTick3, `完工阶段 ${last.stage} ≠ ${expect.stageAtTick3}`);
    if (expect.chronicleAdded) {
      assert.equal(last.chronicleAdded, true, '完工没有写进编年史');
    }
    return `lifecycle(${first.stage} → ${last.stage})`;
  },

  /** M4：原位升级——坐标与道路不动，只换蓝图。 */
  async buildingUpgrade(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const placed = api.dispatchCreatorCommand({
        kind: 'PlaceBuilding',
        prefabId: 'smithy_lv1',
        constructionTicks: 1,
      });
      if (placed?.rejected) throw new Error(`升级前置落位被拒绝：${placed.code}`);
      api.stepTicks(2);

      const before = api.inspectSaveBytes(api.exportSaveBytes());
      const from = before.buildings.find((b) => b.instanceId === placed.instanceId);

      const upgraded = api.dispatchCreatorCommand({
        kind: 'UpgradeBuilding',
        targetId: placed.instanceId,
        toPrefabId: input.toPrefabId,
        constructionTicks: input.constructionTicks,
      });
      if (upgraded?.rejected) throw new Error(`升级被拒绝：${upgraded.code}`);
      api.stepTicks(Math.max(1, Number(input.constructionTicks ?? 2)) + 1);

      const after = api.inspectSaveBytes(api.exportSaveBytes());
      const to = after.buildings.find((b) => b.instanceId === placed.instanceId);
      return {
        beforeOrigin: from?.origin ?? null,
        afterOrigin: to?.origin ?? null,
        prefabId: to?.prefabId ?? null,
        beforeRoads: before.roads.length,
        afterRoads: after.roads.length,
      };
    }, ctx.example.input);

    if (expect.sameOrigin) {
      assert.deepEqual(res.afterOrigin, res.beforeOrigin, `升级挪了坐标：${JSON.stringify(res.afterOrigin)}`);
    }
    assert.equal(res.prefabId, expect.newPrefabId, `升级后蓝图 ${res.prefabId} ≠ ${expect.newPrefabId}`);
    if (expect.roadPreserved) {
      assert.equal(res.afterRoads, res.beforeRoads, `升级动了道路：${res.beforeRoads} → ${res.afterRoads}`);
    }
    return `upgrade(${res.prefabId}, origin 未变)`;
  },

  /** M5：人工改位 → 空间约束补丁，且下一次选址真的受它约束。 */
  async diffRuleSynthesis(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const synthesized = api.dispatchCreatorCommand({
        kind: 'ApplyHumanDiff',
        diffType: input.diffType,
        agentProposal: input.agentProposal,
        userOutcome: input.userOutcome,
      });
      const patch = synthesized?.patch ?? null;

      // 「已生效」= 再提一次被否的那套坐标，必须被拒（否则规则只是一张纸）。
      const retry = api.dispatchCreatorCommand({
        kind: 'PlaceBuilding',
        ...input.agentProposal,
        id: undefined,
      });
      return {
        patchKind: patch?.kind ?? null,
        selfJustifying: Boolean(patch?.isSelfJustifying),
        retryRejected: Boolean(retry?.rejected),
        retryCode: retry?.code ?? null,
      };
    }, ctx.example.input);

    assert.equal(res.patchKind, expect.patchKind, `补丁类型 ${res.patchKind} ≠ ${expect.patchKind}`);
    if (expect.selfJustifying) {
      assert.equal(res.selfJustifying, true, '补丁不具备自证性（isSelfJustifying=false）');
    }
    if (expect.enforcedOnNextPlace) {
      assert.equal(res.retryRejected, true, '被否的坐标再提一次仍然放行——规则没生效');
    }
    return `patch(${res.patchKind}, retry=${res.retryCode})`;
  },

  /** M6 / H4：连续违规触发熔断降级；回归全过则恢复。 */
  async fuseDowngrade(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      api.dispatchCreatorCommand({ kind: 'InjectViolations', role: input.role, count: input.count });
      const tripped = api.inspectSaveBytes(api.exportSaveBytes()).fuseState;
      let recovered = tripped;
      if (input.thenPassRegressionRate !== undefined) {
        api.dispatchCreatorCommand({
          kind: 'InjectRegression',
          role: input.role,
          passRate: input.thenPassRegressionRate,
        });
        recovered = api.inspectSaveBytes(api.exportSaveBytes()).fuseState;
      }
      return {
        trippedFused: Boolean(tripped?.isFused),
        trippedFrom: tripped?.fromLevel ?? null,
        trippedTo: tripped?.toLevel ?? null,
        trippedEvent: tripped?.lastEvent ?? null,
        finalFused: Boolean(recovered?.isFused),
        finalFrom: recovered?.fromLevel ?? null,
        finalTo: recovered?.toLevel ?? null,
        finalEvent: recovered?.lastEvent ?? null,
      };
    }, ctx.example.input);

    if (expectsTrip(expect)) {
      assert.equal(res.trippedFused, true, '连续违规没有触发熔断');
      assert.equal(res.trippedFrom, expect.fromLevel, `熔断前等级 ${res.trippedFrom} ≠ ${expect.fromLevel}`);
      assert.equal(res.trippedTo, expect.toLevel, `熔断后等级 ${res.trippedTo} ≠ ${expect.toLevel}`);
      assert.equal(res.trippedEvent, expect.lastEvent, `熔断事件 ${res.trippedEvent} ≠ ${expect.lastEvent}`);
    }
    if (expect.lastEvent === 'RECOVERY') {
      assert.equal(res.finalFused, false, '回归全过之后仍然处于熔断');
      assert.equal(res.finalFrom, expect.fromLevel, `恢复前等级 ${res.finalFrom} ≠ ${expect.fromLevel}`);
      assert.equal(res.finalTo, expect.toLevel, `恢复后等级 ${res.finalTo} ≠ ${expect.toLevel}`);
      assert.equal(res.finalEvent, expect.lastEvent, `恢复事件 ${res.finalEvent} ≠ ${expect.lastEvent}`);
    }
    return `fuse(${res.trippedEvent ?? '—'} → ${res.finalEvent ?? '—'})`;
  },

  /** K1：造物主干活期间，世界时钟照常走，且单拍均值在预算内。 */
  async worldStillRuns(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      api.dispatchCreatorCommand(input);
      const before = api.inspectSaveBytes(api.exportSaveBytes()).now;
      const started = performance.now();
      api.stepTicks(20);
      const elapsed = performance.now() - started;
      const after = api.inspectSaveBytes(api.exportSaveBytes()).now;
      return { before, after, avgStepMs: elapsed / 20 };
    }, ctx.example.input);

    if (expect.clockAdvanced) {
      assert.ok(res.after > res.before, `世界时钟没走：${res.before} → ${res.after}`);
    }
    assert.ok(
      res.avgStepMs <= expect.maxAvgStepMs,
      `单拍均值 ${res.avgStepMs.toFixed(2)}ms 超预算 ${expect.maxAvgStepMs}ms`,
    );
    return `clock(${res.before} → ${res.after}, ${res.avgStepMs.toFixed(2)}ms/拍)`;
  },

  /**
   * K2：造物**不新增**外部图片请求。
   *
   * 合并 main 之后这条口径必须改写：main 的绘制管线会加载 `public/assets/**`
   * （设定集素材、角色图标），"整页零图片请求"这个前提已经不成立。
   * 仍要守的不变量是——**造物这件事本身不该引入新素材**：楼与脚手架都是程序化烘焙。
   * 所以拿页面加载完那一刻的请求数作基线，只看造物新增的那部分。
   */
  async zeroImageRequests(ctx, expect) {
    const added = ctx.imageRequests.slice(ctx.imageBaseline);
    assert.equal(
      added.length,
      expect.imageNetworkRequests,
      `造物新增了 ${added.length} 个图片请求：${added.slice(0, 3).join(', ')}`,
    );
    return `zero-new-images(基线 ${ctx.imageBaseline})`;
  },

  /** K3：同开局同指令重放两次，状态哈希与网格快照逐字相同。 */
  async deterministicReplay(ctx, expect) {
    // 两次重放必须是**两个干净的浏览器 context**，不能在同一个页面上 reload：
    // `pagehide` 会把上一轮的世界写进存档槽，第二次开局读到的就是「已经建过一栋楼」
    // 的档，初始状态根本不相同。第一版用 reload 时这条用例红过一次，红的是评分器
    // 自己的口径，不是世界的不确定性。
    const runOnce = async () => {
      const context = await ctx.browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(String(error.message || error)));
        await page.goto(urlFor(ctx.example.env), { waitUntil: 'load' });
        await page.waitForFunction(() => Boolean(window.__PIXEL_WORLD_DEBUG__), null, {
          timeout: BRIDGE_TIMEOUT_MS,
        });
        const out = await page.evaluate((input) => {
          const api = window.__PIXEL_WORLD_DEBUG__;
          api.dispatchCreatorCommand(input);
          api.stepTicks(10);
          return { hash: api.stateHash(), grid: api.gridSnapshot() };
        }, ctx.example.input);
        return { ...out, errors };
      } finally {
        await context.close();
      }
    };

    const a = await runOnce();
    const b = await runOnce();
    assert.deepEqual(a.errors, [], `第一次重放页面报错：${a.errors.join(' | ')}`);
    assert.deepEqual(b.errors, [], `第二次重放页面报错：${b.errors.join(' | ')}`);

    if (expect.stateHashMatch) {
      assert.equal(a.hash, b.hash, `两次重放状态哈希不同：${a.hash} ≠ ${b.hash}`);
    }
    if (expect.gridSnapshotMatch) {
      assert.equal(a.grid, b.grid, '两次重放网格快照不同');
    }
    return `replay(${String(a.hash).slice(0, 12)}…)`;
  },

  /** K4 / V2：存档版本不变，且造物那两摞状态真的进了字节。 */
  async saveSchemaIntact(ctx, expect) {
    const res = await ctx.page.evaluate((input) => {
      const api = window.__PIXEL_WORLD_DEBUG__;
      const before = JSON.parse(api.exportSaveBytes());
      const placed = api.dispatchCreatorCommand(input);
      api.stepTicks(2);
      const raw = api.exportSaveBytes();
      const after = JSON.parse(raw);
      const buildings = Array.isArray(after.world?.buildings) ? after.world.buildings : [];
      return {
        before: before.schemaVersion,
        after: after.schemaVersion,
        // 真落盘：桥造的那栋楼必须出现在 SaveStore 写出的字节里，
        // 而不是只活在审计台账或 Phaser 视图里。
        newBuildingInSave: buildings.some((b) => b?.instanceId === placed?.instanceId),
        hasBuildings: Array.isArray(after.world?.buildings),
        hasRoads: Array.isArray(after.world?.roads),
        hasCreatorRules: 'creatorRules' in after,
        hasFuseState: 'fuseState' in after,
      };
    }, ctx.example.input);

    if (expect.schemaVersion === 'unchanged') {
      assert.equal(res.after, res.before, `存档版本被改了：${res.before} → ${res.after}`);
    }
    const fields = {
      buildings: res.hasBuildings,
      roads: res.hasRoads,
      creatorRules: res.hasCreatorRules,
      fuseState: res.hasFuseState,
    };
    for (const field of expect.persistedFields) {
      assert.equal(fields[field], true, `存档里缺少 ${field}——那就没落盘，只是内存态`);
    }
    assert.equal(
      res.newBuildingInSave,
      true,
      '新落的那栋楼没出现在存档字节里——只改了台账/视图，这正是防假绿要抓的',
    );
    return `save(v${res.after}, new building persisted)`;
  },
};

/** M6 与 H4 共用同一个 check，判据不同：先看熔断，再看恢复。 */
function expectsTrip(expect) {
  return expect.lastEvent === 'FUSE_TRIPPED';
}

async function main() {
  // 计划文档里写的是 `--split=heldout`，而文件名沿用仓库的连字符习惯 `held-out.json`。
  // 两种写法都收，免得一条不存在的路径把整轮变成空跑。
  const SPLIT_FILES = { all: ['main.json', 'held-out.json'], main: ['main.json'], heldout: ['held-out.json'], 'held-out': ['held-out.json'] };
  const files = SPLIT_FILES[split];
  if (!files) {
    console.error(`未知 split=${split}（可用：all / main / heldout）`);
    process.exitCode = 1;
    return;
  }
  const browser = await chromium.launch();
  const report = { runId, split, baseUrl: BASE_URL, results: [] };
  let failed = 0;

  try {
    for (const file of files) {
      const dataset = load(file);
      console.log(`\n=== ${file} (${dataset.split}, ${dataset.examples.length} 条) ===`);
      for (const example of dataset.examples) {
        const result = await runExample(browser, example);
        if (!result.ok) failed += 1;
        const mark = result.ok ? 'PASS' : 'FAIL';
        const mode = String(example.mode ?? 'production').padEnd(10);
        console.log(`  ${mark} [${mode}] ${example.id} ${example.name} — ${result.detail}`);
        report.results.push({
          split: dataset.split, id: example.id, name: example.name,
          mode: example.mode ?? 'production', ...result,
        });
      }
    }
  } finally {
    await browser.close();
  }

  const total = report.results.length;
  const byMode = (mode) => {
    const rows = report.results.filter((r) => r.mode === mode);
    return `${rows.length - rows.filter((r) => !r.ok).length}/${rows.length}`;
  };
  console.log(`
生产组 ${byMode('production')}　规格组 ${byMode('spec')}　合计 ${total - failed}/${total}（split=${split}）`);
  console.log('规格组测的是生产尚未实现的能力（升级 / 逆向规则 / 熔断注入 / 满载 / 障碍 / 恢复），只作规格验收，不算生产验收。');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${split}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`报告：${join(OUT_DIR, `${split}.json`)}`);

  // 一条用例都没跑也是一种失败：空跑与全绿长得一模一样。
  if (total === 0) {
    console.error('一条用例都没跑——数据集没读进来，这不是绿。');
    process.exitCode = 1;
  }
  if (failed > 0) process.exitCode = 1;
}

/** 只在被直接执行时跑；被 import（将来的 check 单测）时不动。
 *
 * 判据必须用 `pathToFileURL`：Windows 上 `process.argv[1]` 是 `D:\...`，
 * 拼成 `file://D:\...` 永远不等于 `import.meta.url` 的 `file:///D:/...`，
 * 于是整个脚本**什么都不做、退出码 0**——一种最像成功空跑。
 */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
