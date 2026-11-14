/**
 * 落地检查的**两个执行器必须同口径**。
 *
 * 同一个世界有两个执行器：浏览器里的 `SandboxScene`，和无头回放里的 `TraceRuntime`。
 * 浏览器侧对「非造物主提案的落地」（神谕建的楼）会跑 `checkLandedBuilding` 并写一条
 * landing 记录（`recordUnplannedLanding`）；无头侧此前直接 `return`，于是同一段轨迹
 * 在两个执行器里长出不同的账——那正是本仓最忌讳的一类缺陷：两边都"正常"，数字不同。
 *
 * 本测用一条**最小轨迹**（外层开启 + 一条普通 build 指令）钉住三件事：
 *   1. 无头回放里，非造物主提案的落地也要产出 landing 记录；
 *   2. 那条记录必须真的跑过业务规则（`hasConflict` / `invariantViolated` 有值）；
 *   3. 外环自评**不因此加分**（`totalCommands` 仍为 0）——世界层账归世界层，
 *      外环的通过率只算它自己提的案（`ADR_SCHEMA_PASS_RATE_SEMANTICS`）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTrace } from '../src/trace/replay.ts';
import { TRACE_FORMAT, TRACE_VERSION } from '../src/trace/format.ts';
import { selectSetting, worldForSetting } from '../src/settings/index.ts';

/** 用设定集里**开局还没有**的第一张蓝图：`Simulation.build` 会拒「同模板已有一栋」，
 *  开局那 9 栋里已存在的模板建不出来，用例就会退化成「什么都没发生」。
 *  不写死预制体 id——那归配置包。 */
function firstUnbuiltBlueprintId(): string {
  const pack = selectSetting('?world=dengchao');
  const existing = new Set(worldForSetting(pack).buildings.map((item) => item.prefabId));
  const id = [...pack.blueprints.keys()].sort().find((candidate) => !existing.has(candidate));
  assert.ok(id !== undefined, '灯潮界必须至少有一张开局没落位的蓝图');
  return id;
}

function minimalTrace(): Parameters<typeof runTrace>[0] {
  const prefabId = firstUnbuiltBlueprintId();
  return {
    format: TRACE_FORMAT,
    traceVersion: TRACE_VERSION,
    description: 'parity: 非造物主提案的一次 build 落地',
    worldId: 'dengchao',
    worldSeed: 'parity-seed',
    initialNow: 0,
    stepMs: 100,
    steps: 40,
    eventRange: { from: 0, to: 0 },
    injections: [
      {
        seq: 1,
        atWorldMs: 1_000,
        kind: 'command',
        payload: {
          command: { kind: 'build', prefabId, instanceId: 'parity-build-1' },
        },
      },
    ],
    outer: { memory: false, creator: true },
  };
}

test('1. 无头回放也要为非造物主提案的落地产出 landing 记录', async () => {
  const run = await runTrace(minimalTrace());
  const business = run.creator?.business;
  assert.ok(business !== null && business !== undefined, '外层应当被启用');

  // 楼确实落地了：世界里有这一栋，才谈得上「落地检查」。
  const landed = business.landings.find((item) => item.instanceId === 'parity-build-1');
  assert.ok(
    landed !== undefined,
    `无头回放里这栋楼落地了，却没有 landing 记录（现有 ${business.landings.length} 条）——` +
      '浏览器侧会检查，无头侧直接跳过，两个执行器账本不同口径',
  );
});

test('2. 那条记录真的跑过落地后业务规则，不是空壳', async () => {
  const run = await runTrace(minimalTrace());
  const landed = run.creator?.business.landings.find((item) => item.instanceId === 'parity-build-1');
  assert.ok(landed !== undefined, '先要有记录');
  for (const key of ['hasConflict', 'invariantViolated'] as const) {
    assert.equal(typeof landed[key], 'boolean', `${key} 必须是真跑出来的布尔，不是缺省`);
  }
  assert.equal(typeof landed.pathfindingConnected, 'boolean', '可达性也要真判一次');
  assert.equal(
    landed.replayHashConsistent,
    null,
    '这个入口没有冻落地前的 view，回放一致性只能记 null（「没跑」不是「通过」）',
  );
});

test('3. 世界层账不替外环加分：外环 totalCommands 仍为 0', async () => {
  const run = await runTrace(minimalTrace());
  const business = run.creator?.business;
  assert.ok(business !== null && business !== undefined);
  const mapper = business.roles.find((role) => role.roleId === 'mapper');
  assert.ok(mapper !== undefined, '必须有 mapper 角色');
  assert.equal(
    mapper.totalCommands,
    0,
    '神谕/世界里建的楼不是外环提的案，记进外环通过率就是拿别人的活给自己加分',
  );
});
