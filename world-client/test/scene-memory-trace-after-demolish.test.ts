import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_SCHEMA_VERSION, MemoryRuntime } from '../src/world/memory/runtime.ts';

/**
 * 楼拆了之后，痕迹还读得到、还画得出。
 *
 * 这是这一版最要紧的一条：拆楼的那一刻，地点 Holder 从名册里摘掉，
 * 而痕迹的可读路径（`withinTraceReach` / `placeHints`）原先都要经过 Holder。
 * 于是痕迹明明还在库里，「那儿原来有间铺子」既没人看得见、也画不出来。
 */

/** 一栋楼、两个人：一个在门口，一个隔着几格。 */
function world(): MemoryRuntime {
  const rt = new MemoryRuntime({ worldId: 'trace-after-demolish' });
  rt.syncHolders([
    { holderId: 'near', type: 'character', at: { x: 1, y: 1 } },
    { holderId: 'reader', type: 'character', at: { x: 3, y: 1 } },
    { holderId: 'hall', type: 'place', at: { x: 1, y: 1 }, name: '书斋' },
  ]);
  return rt;
}

/** 一栋楼立起来：`building.built` 在 `observe.ts` 那里是 `milestone` + `placeType: 'building'`。 */
function built(rt: MemoryRuntime): void {
  rt.observe(
    {
      eventId: 'ev_built',
      kind: 'milestone',
      placeId: 'hall',
      at: { x: 1, y: 1 },
      actors: [],
      outcome: { what: '有人立起了一栋新楼', name: '书斋' },
      importanceHint: 0.6,
      valence: 0.5,
      arousal: 0.4,
      placeType: 'building',
    },
    ['near'],
    1000,
  );
}

/** 一栋楼被拆：`building.removed` 在 `observe.ts` 那里是 `conflict` + `placeType: 'building'`。 */
function removed(rt: MemoryRuntime): void {
  rt.observe(
    {
      eventId: 'ev_removed',
      kind: 'conflict',
      placeId: 'hall',
      at: { x: 1, y: 1 },
      actors: [],
      outcome: { what: '一栋楼被拆了', name: '书斋' },
      importanceHint: 0.55,
      valence: -0.5,
      arousal: 0.5,
      placeType: 'building',
    },
    ['near'],
    2000,
  );
}

test('拆楼之后 Holder 摘掉了，但痕迹读得到：placeHints 不认 Holder，只认地点', () => {
  const rt = world();
  built(rt);
  removed(rt);
  assert.ok(rt.placeHints('hall').length > 0, '拆之前该看得见碑文与废墟');

  rt.removePlace('hall');
  assert.equal(rt.world.viewOf('hall'), null, '前置：Holder 真的被摘了');
  assert.ok(rt.world.tracesAt('hall').length > 0, '痕迹还在库里');

  const hints = rt.placeHints('hall');
  assert.ok(hints.length > 0, '拆之后 placeHints 仍然是那道单子，不是空数组');
  assert.ok(
    hints.some((hint) => hint.layer === 'ruin'),
    `拆楼该留下废墟那一层，实际：${hints.map((hint) => hint.layer).join(',')}`,
  );
});

test('拆楼之后路过的人仍够得着那道废墟——准入读坐标表，不读 Holder', () => {
  const rt = world();
  built(rt);
  removed(rt);
  rt.removePlace('hall');

  const inferred = rt.lookAtTraces('reader', 'hall');
  assert.ok(inferred.length > 0, 'reader 站在三格内，该看得见废墟');
  assert.ok(
    inferred.some((spec) => spec.what.includes('曾经有一栋楼')),
    `该推得出「这里曾经有一栋楼」，实际：${inferred.map((spec) => spec.what).join(' / ')}`,
  );
});

test('远离的人仍够不着：废墟不因为 Holder 摘掉就变成全村可见', () => {
  const rt = world();
  built(rt);
  removed(rt);
  rt.removePlace('hall');
  rt.syncHolders([{ holderId: 'far', type: 'character', at: { x: 40, y: 40 } }]);
  assert.deepEqual(rt.lookAtTraces('far', 'hall'), [], '四格外的废墟读不到');
});

test('地点坐标随存档回来：拆掉的楼读档后仍然是废墟，不是一处空白', () => {
  const rt = world();
  built(rt);
  removed(rt);
  rt.removePlace('hall');

  const restored = new MemoryRuntime({ worldId: 'trace-after-demolish' });
  assert.equal(restored.fromJSON(rt.toJSON()), true);
  assert.equal(restored.world.viewOf('hall'), null, '读档后 Holder 仍不在名册里');
  assert.deepEqual(restored.placeAnchor('hall'), { x: 1, y: 1 }, '坐标跟场景一起存回来了');
  assert.ok(restored.placeHints('hall').length > 0, '读档后痕迹照旧画得出');
  restored.syncHolders([{ holderId: 'reader', type: 'character', at: { x: 3, y: 1 } }]);
  assert.ok(restored.lookAtTraces('reader', 'hall').length > 0, '读档后仍够得着');
});

test('记忆段版本升到 2：老档（v1）迁移无损，补上的只是从 Holder 读出来的坐标', () => {
  const rt = world();
  built(rt);
  const v2 = JSON.parse(rt.toJSON()) as {
    memorySchemaVersion: number;
    lastClosedDay: number;
    started: boolean;
    now: number;
    positions: unknown[];
    world: Record<string, unknown>;
  };
  assert.equal(v2.memorySchemaVersion, MEMORY_SCHEMA_VERSION);

  // 造一份 v1 档：把 v2 才有的那一段拿掉，版本号改回 1。
  const { placeAnchors, ...v1World } = v2.world as {
    placeAnchors: unknown;
    [key: string]: unknown;
  };
  assert.ok(Array.isArray(placeAnchors), 'v2 该有 placeAnchors');
  const v1 = { ...v2, memorySchemaVersion: 1, world: v1World };

  const restored = new MemoryRuntime({ worldId: 'trace-after-demolish' });
  assert.equal(restored.fromJSON(JSON.stringify(v1)), true, 'v1 档该被迁移后接受');

  // 无损：v1 的每一段都原样在；新增的只有 placeAnchors。
  const after = JSON.parse(restored.toJSON()) as { memorySchemaVersion: number; world: Record<string, unknown> };
  assert.equal(after.memorySchemaVersion, MEMORY_SCHEMA_VERSION, '迁到当前版本');
  for (const key of Object.keys(v1World)) {
    assert.deepEqual(after.world[key], v1.world[key], `${key} 迁移后不该变`);
  }
  assert.equal(
    (after.world.facts as unknown[]).length,
    (v1.world.facts as unknown[]).length,
    '事实一条不少',
  );
  assert.equal(
    (after.world.traces as unknown[]).length,
    (v1.world.traces as unknown[]).length,
    '痕迹一条不少',
  );

  // 补上的坐标就是 Holder 上原来写着的那一个。
  const anchors = after.world.placeAnchors as { placeId: string; at: { x: number; y: number } }[];
  assert.deepEqual(
    anchors.map((item) => [item.placeId, item.at.x, item.at.y]),
    [['hall', 1, 1]],
  );
});
