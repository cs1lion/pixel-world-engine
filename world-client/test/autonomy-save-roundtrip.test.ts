/** A2：外环自治状态入存档的往返验收。
 *
 * 用户拍板「扩展存档」要的是：刷新/重进后不再从 L0 重来。这里钉住四件事：
 *   1. 一份非 L0 的自治快照能落进 v7 存档并过 `assertSave`；
 *   2. 用存档里的快照新建控制器，等级 / 指标窗口 / 世界日计数 / 熔断态逐一还原；
 *   3. 没有快照（新世界 / 旧档迁移）时全部角色仍是 L0；
 *   4. 角色对不上的快照静默跳过，不凭空造角色。
 *
 * 刻意不跑爬梯/降级路径来造状态：那套逻辑会顺带改等级与熔断态，
 * 把「存档有没有把状态原样搬回来」这件正事搅浑。这里直接构造快照，
 * 让判据只落在 `exportRoleSnapshots` / `restoreRoleSnapshots` 与存档校验上。
 *
 * `CreatorEngine` 的构造接线由类型检查与 `creator-engine.test.ts` 覆盖。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AutonomousFuseController,
  AutonomyLevel,
  type AutonomyRoleSnapshot,
  type MetricWindow,
} from '../src/world/creator/fuse.ts';
import {
  assertSave,
  collectSavePaths,
  CURRENT_SCHEMA_VERSION,
  type AutonomyRoleState,
  type WorldSave,
} from '../src/world/save.ts';

// v7 的两个新导出走动态 import + typeof 断言：base 上它们还不存在，
// 静态 import 会抛 SyntaxError，被 red-first 判成 compile 而不是合格的红
//（OPEN_ISSUES B7，2026-11-08 已登记的已知误报）。
const v7 = (await import('../src/world/save.ts')) as unknown as {
  SAVE_V7_ALLOWED_PATHS?: readonly string[];
  SCHEMA_V7_FINGERPRINT?: string;
};
assert.equal(typeof v7.SAVE_V7_ALLOWED_PATHS, 'object', 'v7 路径集合必须存在');
assert.equal(typeof v7.SCHEMA_V7_FINGERPRINT, 'string', 'v7 指纹常量必须存在');
const SAVE_V7_ALLOWED_PATHS = v7.SAVE_V7_ALLOWED_PATHS!;
const SCHEMA_V7_FINGERPRINT = v7.SCHEMA_V7_FINGERPRINT!;

/** 从 v7 冻结样例取一份合法存档骨架，替换 autonomy 后校验。 */
function baseSave(): WorldSave {
  return JSON.parse(
    readFileSync(new URL('../../docs/save-v7.sample.json', import.meta.url), 'utf8'),
  ) as WorldSave;
}

/** 一份非空的指标窗口（字段与 `emptyMetrics()` 对齐，值故意各不相同）。 */
function fullMetrics(): MetricWindow {
  return {
    batches: 3, days: 7, totalCommands: 11, schemaPassCount: 9,
    conflictCount: 1, conflictChecks: 11, coverageRate: 0.96, coverageChecks: 8,
    pathfindingChecks: 6, pathfindingConnectedCount: 6,
    collisionChecks: 5, collisionFreeCount: 5,
    constraintChecks: 4, constraintSatisfiedCount: 4,
    traceabilityChecks: 3, traceableCount: 3,
    replayChecks: 2, replayConsistentCount: 2,
    manualModificationCount: 1, rollbackCount: 0,
    invariantViolationCount: 0, invariantChecks: 11,
  };
}

/** 把控制器快照转成存档形状（两者结构一致，这里显式过一遍以防漂移）。 */
function toSaveState(snap: AutonomyRoleSnapshot): AutonomyRoleState {
  return {
    roleId: snap.roleId,
    currentLevel: snap.currentLevel,
    targetLevel: snap.targetLevel,
    days: snap.days,
    isFused: snap.isFused,
    metrics: { ...snap.metrics },
  };
}

/** 一份「上一次会话留下了东西」的快照：一个 L2 + 一个熔断的 L1。 */
function progressedSnapshots(): AutonomyRoleSnapshot[] {
  return [
    {
      roleId: 'interpreter',
      currentLevel: AutonomyLevel.L2,
      targetLevel: AutonomyLevel.L3,
      days: 7,
      isFused: false,
      metrics: fullMetrics(),
    },
    {
      roleId: 'mapper',
      currentLevel: AutonomyLevel.L1,
      targetLevel: AutonomyLevel.L3,
      days: 2,
      isFused: true,
      metrics: { ...fullMetrics(), totalCommands: 2 },
    },
  ];
}

test('非 L0 的自治快照能进 v7 存档、过完整校验', () => {
  const snaps = progressedSnapshots();
  const withAutonomy = {
    ...baseSave(),
    world: { ...baseSave().world, autonomy: snaps.map(toSaveState) },
  } as WorldSave;
  assert.doesNotThrow(() => assertSave(withAutonomy), '带 autonomy 的存档必须合法');
  assert.equal(withAutonomy.schemaVersion, CURRENT_SCHEMA_VERSION);
  const allowed = new Set(SAVE_V7_ALLOWED_PATHS);
  for (const path of collectSavePaths(withAutonomy)) {
    assert.ok(allowed.has(path), `v7 允许集合漏了 ${path}`);
  }
  assert.equal(withAutonomy.meta.schemaFingerprint, SCHEMA_V7_FINGERPRINT);
});

test('存档往返后等级、指标、天数、熔断态逐一还原，不再从 L0 重来', () => {
  const snaps = progressedSnapshots();

  // 落档 → JSON 往返（真实读写路径）→ 读回
  const written = {
    ...baseSave(),
    world: { ...baseSave().world, autonomy: snaps.map(toSaveState) },
  } as WorldSave;
  const reloaded = JSON.parse(JSON.stringify(written)) as WorldSave;
  assert.doesNotThrow(() => assertSave(reloaded));
  const readBack = reloaded.world.autonomy;
  assert.ok(readBack !== null);

  // 用读回的快照新建控制器（模拟刷新后 new CreatorEngine）
  const after = new AutonomousFuseController(() => 0);
  for (const id of ['interpreter', 'mapper']) {
    after.initRole(id as never, `${id}-role`, AutonomyLevel.L0, AutonomyLevel.L3);
  }
  after.restoreRoleSnapshots(readBack);

  const exported = after.exportRoleSnapshots();
  assert.equal(exported.find((s) => s.roleId === 'interpreter')!.currentLevel,
    AutonomyLevel.L2, '等级不能退回 L0');
  assert.equal(exported.find((s) => s.roleId === 'mapper')!.isFused, true, '熔断态要还原');
  assert.deepEqual(exported, snaps, '导出/存档/恢复整条链逐字段一致');

  // 指标窗口必须真的非空，否则上面的 deepEqual 是空对空的假绿。
  assert.ok(exported[0]!.metrics.totalCommands > 0);
  assert.equal(after.getRates('interpreter')!.schemaPassRate,
    snaps[0]!.metrics.schemaPassCount / snaps[0]!.metrics.totalCommands);
});

test('没有快照时全部角色从 L0 起步（旧档迁移 / 新世界）', () => {
  const c = new AutonomousFuseController(() => 0);
  for (const id of ['interpreter', 'mapper']) {
    c.initRole(id as never, `${id}-role`, AutonomyLevel.L0, AutonomyLevel.L3);
  }
  c.restoreRoleSnapshots([]); // 空快照 = 没有外环状态
  for (const snap of c.exportRoleSnapshots()) {
    assert.equal(snap.currentLevel, AutonomyLevel.L0);
    assert.equal(snap.days, 0);
    assert.equal(snap.isFused, false);
    assert.equal(snap.metrics.totalCommands, 0);
  }
  // 冻结样例里的 autonomy 就是 null，代表这个语义。
  assert.equal(baseSave().world.autonomy, null);
});

test('角色对不上的快照静默跳过，不凭空造角色', () => {
  const c = new AutonomousFuseController(() => 0);
  c.initRole('mapper', 'mapper-role', AutonomyLevel.L0, AutonomyLevel.L3);
  const stray: AutonomyRoleSnapshot = {
    roleId: 'role_from_another_setting',
    currentLevel: AutonomyLevel.L4,
    targetLevel: AutonomyLevel.L4,
    days: 99,
    isFused: false,
    metrics: fullMetrics(),
  };
  c.restoreRoleSnapshots([stray]);
  assert.equal(c.exportRoleSnapshots().length, 1);
  assert.equal(c.getRoleState('mapper')!.currentLevel, AutonomyLevel.L0);
});
