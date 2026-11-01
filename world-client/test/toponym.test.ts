/**
 * 地名演变（协议 §11）：一个地点什么时候换名字。
 *
 * §11 只写了半条——「地名演变保存历史链：`ToponymChanged(place_id, old, new, event_ref)`」。
 * 存储、判据、发出点、接收方都在别处，四样原来一样都没有（`types.ts` 那张
 * `MemoryEventKind` 的表当时记着「零发出方、零接收方」）。这一组钉的是前四样里
 * 前三样：名字进链、判据、发出点。第四样（谁读它）在楼面板那一侧。
 *
 * 判据是**查表**，不是编故事（`toponym.ts`）：事件 kind 决定它说得出什么称号，
 * `renameImportanceFloor` 决定它配不配。0.6 正好是 `milestone` 的 hint，
 * 于是 `conflict`（0.55）落在门槛之下——「打架不给镇子改名」在这里成了一条
 * 能验的话，而不是一句没人执行的态度。
 *
 * 时间线与 `legend-cull.test.ts` 同一条：信念在第一次日终整理时才落成，
 * 传说在**第 4 天关账**时立起，所以下面都关到第 5 天。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MEMORY_CONFIG, DAY_MS } from '../src/world/memory/config.ts';
import type { MemoryEvent } from '../src/world/memory/types.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';

/** 一个 10 人的村，一个地点 `p1`，它有个名字。 */
function village(emit?: (event: MemoryEvent) => void): MemoryWorld {
  const world = new MemoryWorld({ worldId: 'toponym', grid: { isWalkable: () => true }, ...(emit === undefined ? {} : { emit }) });
  for (let i = 0; i < 10; i += 1) {
    world.addHolder({
      holderId: `v${i}`,
      type: 'character',
      profile: {},
      at: { x: i % 4, y: Math.floor(i / 4) },
    });
  }
  world.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 1, y: 0 } });
  world.setPlaceName('p1', '账房');
  return world;
}

/** 五个人目击的一件事。`kind` 决定它说得出什么称号，`importanceHint` 决定它配不配。 */
function witnessed(
  world: MemoryWorld,
  eventId: string,
  kind: string,
  importanceHint: number,
  at = 1000,
): void {
  world.ingest({
    eventId,
    at,
    kind,
    place: { placeId: 'p1', at: { x: 1, y: 0 }, indoor: false },
    actors: ['v0'],
    outcome: { what: `第 ${eventId} 件事` },
    visibility: 'world',
    source: 'world',
    importanceHint,
    parentEventId: null,
    witnesses: ['v0', 'v1', 'v2', 'v3', 'v4'],
  });
}

/** 关掉第 `from` 天到第 `to - 1` 天。`qualifies` 要 `nowDay - firstDay >= legendDays`（3）。 */
function closeDays(world: MemoryWorld, from: number, to: number): void {
  for (let d = from; d < to; d += 1) world.dayClosed(d, (d + 1) * DAY_MS);
}

test('名字进链：递进来的名字就是原名，历史链一开始是空的', () => {
  const world = village();
  const toponym = world.placeNameOf('p1');
  assert.notEqual(toponym, null, '登记过的地点该读得到一个名字');
  assert.equal(toponym!.name, '账房', '名字就是场景递进来的那个，不被改写成别的');
  assert.deepEqual([...toponym!.history], [], '还没改过名，历史链是空的');
});

test('登记只认第一次：每拍都递同一个名字，不会把改过的名字抹回原名', () => {
  const world = village();
  witnessed(world, 'ev_milestone', 'milestone', 0.6);
  closeDays(world, 0, 5);
  assert.equal(world.placeNameOf('p1')!.name, '账房·立事', '里程碑该给它挂上称号');

  // 场景每一拍都在 `syncHolders` 里递名字。若 `setPlaceName` 每拍覆盖，
  // 下一拍就把「账房·立事」抹回「账房」——历史链还在，名字却倒退。
  world.setPlaceName('p1', '账房');
  assert.equal(world.placeNameOf('p1')!.name, '账房·立事', '再递一次原名，不该把改过的名字覆盖掉');
});

test('没登记过名字的地点不改名：不编一个「无名·立事」出来', () => {
  const world = new MemoryWorld({ worldId: 'toponym-unnamed', grid: { isWalkable: () => true } });
  for (let i = 0; i < 10; i += 1) {
    world.addHolder({ holderId: `v${i}`, type: 'character', profile: {}, at: { x: i % 4, y: Math.floor(i / 4) } });
  }
  world.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 1, y: 0 } });
  witnessed(world, 'ev_milestone', 'milestone', 0.6);
  closeDays(world, 0, 5);

  assert.equal(world.legendsOf().length, 1, '碑照旧立起来——改名不是立碑的前提');
  assert.equal(world.placeNameOf('p1'), null, '没人告诉过它这地方叫什么，就不该凭空长出一个名字');
});

test('判据：够得着门槛的里程碑改名，够不着的打架不改名', () => {
  const renamed = village();
  witnessed(renamed, 'ev_milestone', 'milestone', DEFAULT_MEMORY_CONFIG.renameImportanceFloor);
  closeDays(renamed, 0, 5);
  const after = renamed.placeNameOf('p1')!;
  assert.equal(after.name, '账房·立事', '正好落在门槛上的里程碑该改名（判据是大于等于）');
  assert.equal(after.history.length, 1, '历史链上该有一条');
  assert.equal(after.history[0]!.fromEventRef, 'ev_milestone', '这条改名记着它是因哪件事改的');
  assert.equal(after.history[0]!.day, 4, '第 4 天关账时立碑，改名就记在那一天');

  // `conflict` 在 `EPITHETS` 表里（说得出「争口」），但 0.55 落在 0.6 之下。
  // 这张表说的是「这类事说得出称号」，门槛说的是「配不配」——两件事分开才有这条。
  const brawled = village();
  witnessed(brawled, 'ev_conflict', 'conflict', 0.55);
  closeDays(brawled, 0, 5);
  assert.equal(brawled.legendsOf().length, 1, '打架够格立碑（0.55 在传说门槛 0.4 之上）');
  assert.equal(brawled.placeNameOf('p1')!.name, '账房', '但打架不给镇子改名');
  assert.deepEqual([...brawled.placeNameOf('p1')!.history], [], '历史链上什么都不该有');
});

test('一个地点只改一次名：第二次里程碑不再往上挂称号', () => {
  const world = village();
  witnessed(world, 'ev_first', 'milestone', 0.6);
  closeDays(world, 0, 5);
  assert.equal(world.placeNameOf('p1')!.name, '账房·立事');

  // 同一个地点、第二件里程碑。它会立自己的碑（不同事件），但名字不再改。
  // 第 5 天进的事，信念在当天关账时才落成，够格要再等三天——第 9 天关账立碑
  // （与 `legend-merge.test.ts` 同一个时间线）。
  witnessed(world, 'ev_second', 'milestone', 0.6, 5 * DAY_MS);
  closeDays(world, 5, 10);
  const toponym = world.placeNameOf('p1')!;
  assert.equal(toponym.name, '账房·立事', `不该长成「账房·立事·立事」，实际 ${toponym.name}`);
  assert.equal(toponym.history.length, 1, '历史链上只该有一条——改两次读起来就是世界说话不算数');
  assert.equal(world.legendsOf().length, 2, '碑该立两块：改名的上限管的是名字，不是碑');
});

test('toponym.changed 发出一次，载荷四个键，且只在那一次发', () => {
  const events: MemoryEvent[] = [];
  const world = village((event) => events.push(event));
  witnessed(world, 'ev_milestone', 'milestone', 0.6);
  witnessed(world, 'ev_conflict', 'conflict', 0.55, 1200);
  closeDays(world, 0, 5);

  const changes = events.filter((event) => event.kind === 'toponym.changed');
  assert.equal(changes.length, 1, `两件事里只有里程碑配改名，实际发了 ${changes.length} 条`);
  assert.deepEqual(
    Object.keys(changes[0]!.payload).sort(),
    ['eventRef', 'new', 'old', 'placeId'],
    '载荷就是协议 §11 写的四样，不多不少',
  );
  assert.equal(changes[0]!.payload.placeId, 'p1');
  assert.equal(changes[0]!.payload.old, '账房');
  assert.equal(changes[0]!.payload.new, '账房·立事');
  assert.equal(changes[0]!.payload.eventRef, 'ev_milestone', '记的是**最重**那件事：一条碑里并着闲话与里程碑时，说的是里程碑');

  // 第二天关账，同一条传说还活着、地点也没变——但历史链已经有了一条，
  // 不该再发一遍同样的改名。这条闸就是「一次为限」在事件流上的样子。
  closeDays(world, 5, 7);
  assert.equal(
    events.filter((event) => event.kind === 'toponym.changed').length,
    1,
    '第二天不该再发一条一模一样的改名',
  );
});

test('确定性：同样的世界跑两遍，名字与历史链一模一样', () => {
  const run = (): { name: string; history: readonly unknown[] } => {
    const world = village();
    witnessed(world, 'ev_a', 'milestone', 0.6);
    witnessed(world, 'ev_b', 'celebration', 0.8, 1200);
    closeDays(world, 0, 5);
    const toponym = world.placeNameOf('p1')!;
    return { name: toponym.name, history: toponym.history };
  };
  assert.deepEqual(run(), run(), '回放一致（§16）：同一个世界跑两遍，地名走的是同一条路');
});
