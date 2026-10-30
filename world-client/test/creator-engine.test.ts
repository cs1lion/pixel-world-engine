/** 造物引擎的端到端集成测试
 *
 * 验证：设定集 → Fuse（熔断）+ Director（导演）+ Metrics（指标）→ 世界绘制
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { RawSettingPack } from '../src/settings/types.ts';
import { CreatorEngine } from '../src/creator/engine.ts';
import * as fuseModule from '../src/world/creator/fuse.ts';
import { WORLD } from '../src/world/palette-data.ts';

/**
 * 24 个槽的值直接从 `WORLD` 推出来，不手抄一份。
 *
 * 第一版手抄了一张 24 行的表，用的还是旧世界的槽名（`scarf` / `scarfDark` /
 * `panel`…）——那些名字在 `WorldColor` 里一个都不存在，装载器第一句就报
 * 「缺少色板槽 ink」，十条用例全军覆没。手抄的第二份色表没有第二个用处，
 * 却有第一种用处：它会与 `WORLD` 悄悄分岔，而分岔的表现是「这个夹具测的世界
 * 与真世界不是同一个色板」。
 */
const PALETTE = Object.fromEntries(
  Object.entries(WORLD).map(([token, value]) => [token, `#${value.toString(16).padStart(6, '0')}`]),
) as Record<string, string>;

/** 最小化的测试设定集（简化版） */
const TEST_PACK: RawSettingPack = {
  id: 'test-pack',
  name: '测试镇',
  saveKey: 'test.save',
  palette: PALETTE,
  // 八个地形 → **token 名**（不是色值）。`tree` 这一格没有同名 token：
  // 树冠的底色本来就是 `soil`，与灯潮界同一处写法。
  terrainColors: {
    grass: 'grass',
    stone: 'stone',
    plaza: 'plaza',
    farm: 'farm',
    tree: 'soil',
    shallow: 'water',
    mud: 'soil',
    coal: 'charcoal',
  },
  grid: {
    width: 30,
    height: 20,
    border: 1,
    zones: [
      { id: 'street', x: 10, y: 5, w: 10, h: 5 },
      { id: 'altar', x: 13, y: 9, w: 4, h: 4 },
      { id: 'industry', x: 5, y: 5, w: 6, h: 6 },
      { id: 'living', x: 5, y: 13, w: 10, h: 6 },
    ],
  },
  terrain: [],
  regions: [],
  prefabs: {
    // 蓝图是外部 JSON 的形状，不是 `SettingPack` 的形状：`accent` / `silhouette` /
    // `boundTask` / `workSpots` / `chimney` / `clearMargin` / `palette` 七个字段
    // 一个都不能省。第一版只写了 id/displayName/zone/footprint/door/interior，
    // 装载器第二句就报「蓝图 code_forge: accent 必须是字符串」——它是对的，
    // 少一个字段的蓝图会在渲染层读出一个 `undefined` 色。
    code_forge: {
      id: 'code_forge',
      displayName: '代码工坊',
      zone: 'industry',
      footprint: { w: 3, h: 3 },
      clearMargin: 1,
      door: { x: 1, y: 3 },
      workSpots: [{ x: 1, y: 1 }],
      chimney: { x: 1.6, y: 0.4 },
      accent: 'smoke',
      silhouette: 'gable',
      boundTask: 'code',
      palette: { body: 'timber', roof: 'terracotta', trim: 'trim', window: 'amber' },
    },
    // 祭坛不是工坊：`boundTask: null`，所以它不必落在三个工坊分区里。
    altar_small: {
      id: 'altar_small',
      displayName: '祭坛',
      zone: 'altar',
      footprint: { w: 2, h: 2 },
      clearMargin: 0,
      door: { x: 1, y: 2 },
      workSpots: [{ x: 1, y: 1 }],
      chimney: { x: 1.2, y: 0.2 },
      accent: 'ink',
      silhouette: 'flat',
      boundTask: null,
      palette: { body: 'stone', roof: 'plaza', trim: 'trim', window: 'warmLight' },
    },
  },
  placements: [
    { prefabId: 'code_forge', at: { x: 6, y: 6 } },
    { prefabId: 'altar_small', at: { x: 14, y: 10 } },
  ],
  // 镇心不能压在建筑的占地里：`placeBlueprint` 会把它当障碍，于是每一栋楼的
  // 门口都「到不了镇心」，装载期报「门口到不了镇心」。
  hub: { x: 15, y: 13 },
  villagers: [
    {
      name: '测试村民',
      at: { x: 12, y: 8 },
      routine: [
        // 门口那一格在占地之外，是可走的最小目标；压在占地里的作息点会被
        // 装载期以「作息点不可走」拒掉。
        { label: '祭坛', x: 15, y: 12, dwellMs: 3000 },
        { label: '工坊', x: 7, y: 9, dwellMs: 5000 },
      ],
      style: { cloak: 'cloak', scarf: 'pale', lamp: true },
    },
  ],
  scenery: [],
};

describe('CreatorEngine 集成测试', () => {
  test('能够加载并编译最小化设定集', () => {
    const engine = new CreatorEngine(TEST_PACK);
    const pack = engine.getPackInfo();

    assert.strictEqual(pack.id, 'test-pack');
    assert.strictEqual(pack.name, '测试镇');
    assert.ok(pack.authored);
    assert.strictEqual(pack.villagers.length, 1);
    assert.strictEqual(pack.placements.length, 2);
  });

  test('构建的世界包含正确的网格和建筑', () => {
    const engine = new CreatorEngine(TEST_PACK);
    const world = engine.getWorldSnapshot();

    assert.strictEqual(world.grid.width, 30);
    assert.strictEqual(world.grid.height, 20);
    assert.ok(world.altar);
    assert.strictEqual(world.buildings.length, 2);
  });

  test('初始化所有造物主角色到 L0', () => {
    const engine = new CreatorEngine(TEST_PACK);
    const controller = (engine as any).fuseController as fuseModule.AutonomousFuseController;
    const roleIds = controller.getAllRoleIds();

    assert.strictEqual(roleIds.length, 6);
    for (const id of ['interpreter', 'director', 'auditor']) {
      assert.ok(roleIds.includes(id as never), `缺角色 ${id}：${roleIds.join(', ')}`);
    }

    for (const roleId of roleIds) {
      const state = engine.getRoleState(roleId);
      assert.strictEqual(state?.currentLevel, 0); // L0
      assert.strictEqual(state?.isFused, false);
    }
  });

  test('执行命令时 L0 需要人工确认', async () => {
    const engine = new CreatorEngine(TEST_PACK);
    const result = await engine.executeCommand('interpreter', {
      kind: 'setWeather',
      parameters: { weather: 'rain' },
    });

    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.level, 0); // L0
  });

  test('L2 通过门禁后自动放行', () => {
    const engine = new CreatorEngine(TEST_PACK, { targetLevel: 2 });
    const roleId = 'interpreter';
    const controller = (engine as any).fuseController as fuseModule.AutonomousFuseController;

    const level = (): number => engine.getRoleState(roleId)?.currentLevel ?? -1;

    /**
     * 每一级都要**从零重新证明自己**：`tryClimbUp` 升一级之后把指标清零
     * （「爬到新等级要从零证明」）。所以 L0 → L2 是两轮，不是一轮。
     *
     * 第一版写的是「14 次 `endOfDay` 就该到 L2」——那数出来是 L1，然后就红在
     * 「未升到 L2，实际等级：1」。断言没错，是那句注释里的算术错了：14 天
     * 只够**一次**升级。
     */
    const climbOnce = (): void => {
      for (let day = 0; day < 14; day += 1) {
        controller.recordCommandResult(roleId, {
          schemaPassed: true,
          hasConflict: false,
          coverageRate: 0.98,
          pathfindingConnected: true,
          hasCollision: false,
          spatialConstraintSatisfied: true,
          invariantViolated: false,
          traceable: true,
          replayHashConsistent: true,
        });
        controller.endOfDay(roleId);
      }
    };

    const levels: number[] = [];
    for (let step = 0; step < 2; step += 1) {
      climbOnce();
      levels.push(level());
    }

    // 中间那一格也要断言：只看终点的话，「一次跳两级」和「一级一级爬」
    // 在这里读起来一模一样，而 §3.3 规定的是后者。
    assert.deepStrictEqual(levels, [1, 2], `爬梯逐级：每一轮之后应是 L1、L2，实际 ${levels.join(' → ')}`);

    // 刚升上来的 L2 **还没有本级的证据**（升级即清零），所以它要求人工确认。
    // 这不是缺陷，是设计：`qualityGatesFor` 把 `null`（根本没测到）当成
    // 不达标——不能拿上一级的成绩替下一级背书。
    assert.strictEqual(engine.getFuseDecision(roleId).action, 'requireReview', '零证据的 L2 不该放行');

    // 在这一级里真的跑过一批，通过率够高 → 放行。
    // 这一句证明的不只是「等级数字变大」，而是「这个等级真的改变了执行路径」。
    controller.recordCommandResult(roleId, {
      schemaPassed: true,
      hasConflict: false,
      coverageRate: 0.98,
      pathfindingConnected: true,
      hasCollision: false,
      spatialConstraintSatisfied: true,
      invariantViolated: false,
      traceable: true,
      replayHashConsistent: true,
    });
    assert.strictEqual(engine.getFuseDecision(roleId).action, 'allow', '本级通过率够高就该放行');
  });

  test('Director 根据心电图注入事件', () => {
    const engine = new CreatorEngine(TEST_PACK);

    // 低唤醒度 → 应该注入
    const lowArousalResult = engine.processDayClosed({
      meanValence: 0.0,
      meanArousal: 0.1, // < 0.25
      infoEntropy: 0.5,
      isolatedHoldersCount: 0,
    });

    assert.ok(lowArousalResult.shouldInject, '低唤醒度应该注入');

    // 健康状态 → 不注入
    const healthyResult = engine.processDayClosed({
      meanValence: 0.2,
      meanArousal: 0.5,
      infoEntropy: 0.3,
      isolatedHoldersCount: 0,
    });

    assert.ok(!healthyResult.shouldInject, '健康状态不应该注入');
  });

  test('回归集测试通过后才能恢复熔断', () => {
    const engine = new CreatorEngine(TEST_PACK);
    const controller = (engine as any).fuseController as fuseModule.AutonomousFuseController;

    // 强制降级到 L1 并熔断
    controller.triggerRollback('interpreter', 'test-branch');
    assert.ok(controller.getRoleState('interpreter')?.isFused, '应该处于熔断状态');

    // 尝试恢复 → 失败
    const resumeBefore = engine.tryResumeFusedRole('interpreter');
    assert.strictEqual(resumeBefore, false, '没跑回归集不能恢复');

    // 跑回归集并通过
    engine.recordRegressionTest('interpreter', true, { testCount: 10 });

    // 再次尝试恢复 → 成功
    const resumeAfter = engine.tryResumeFusedRole('interpreter');
    assert.strictEqual(resumeAfter, true, '回归集通过后应该能恢复');
  });

  test('确定性随机数生成器', () => {
    const engine = new CreatorEngine(TEST_PACK);

    const seed = 'test-seed';
    const r1 = engine.deterministicRandom(seed);
    const r2 = engine.deterministicRandom(seed);

    // 同一种子 → 相同结果
    assert.strictEqual(r1, r2);

    // 不同种子 → 可能不同
    const r3 = engine.deterministicRandom('different-seed');
    assert.notStrictEqual(r1, r3);
  });

  test('内存配置正确计算', () => {
    const engine = new CreatorEngine(TEST_PACK);
    const config = engine.getMemoryConfig();

    assert.strictEqual(config.vitalsWindowDays, 3);
    assert.strictEqual(config.isolatedDays, 3);
  });

  test('获取所有角色状态', () => {
    const engine = new CreatorEngine(TEST_PACK);
    const allStates = engine.getAllRoleStates();

    assert.strictEqual(allStates.size, 6);
    for (const [, state] of allStates) {
      assert.strictEqual(state.currentLevel, 0);
      assert.strictEqual(state.isFused, false);
    }
  });
});
