import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';
import type { MemoryEntry } from '../src/world/memory/types.ts';

/**
 * 听说一件事，就记下它。
 *
 * 协议第 6 节末行：「听说类记忆走传播协议：单位收到 `ClaimTold` 并更新信念后，
 * 生成 source_mode = heard 的条目。」而 `deliver` 原先只写一条 `Belief`。
 * 实测：一条事故在 10 人的村里传到第 7 个人，7 个人都「知道」这件事，
 * **只有目击者本人有一条记忆**——另外 6 个人的记忆库是空的。
 *
 * 后果不止「记不住」。补充设计 §1.1 的求证闭环第 1 步是「单位收到 `ClaimTold`
 * （准备生成 heard 记忆）时，检索自身记忆库中是否存在相同 `event_refs` 的
 * 高置信度记忆」，而 `checkConflict` 读的正是这个单位的记忆条目。heard 条目
 * 从来不存在，于是冲突检测只能拿目击者自己的记忆去比对——
 * 「听来的说法和我亲眼看见的不一样」这条触发路径一次都没走过。
 *
 * 这一组测的是接线本身：传闻落成了条目，来源链一级一级长，保真度照断言走。
 */

/** 一个 10 人的村子，站成一条 1 格间距的直线。 */
function village(count = 10): MemoryWorld {
  const world = new MemoryWorld();
  for (let index = 0; index < count; index += 1) {
    world.addHolder({
      holderId: `v${index}`,
      type: 'character',
      profile: { talkativeness: 0.5 },
      at: { x: index, y: 0 },
    });
  }
  return world;
}

function seedEvent(world: MemoryWorld, witnesses: readonly string[], at = 1000): void {
  world.ingest({
    eventId: 'ev_1',
    at,
    kind: 'workshop_accident',
    place: { placeId: 'foundry', at: { x: 0, y: 0 }, indoor: false, placeType: 'workshop' },
    actors: [witnesses[0] ?? 'v0'],
    outcome: {},
    visibility: 'world',
    source: 'world',
    importanceHint: 0.9,
    parentEventId: null,
    witnesses,
  });
}

function run(world: MemoryWorld, days: number): void {
  world.createClaimFrom('ev_1', 'v0', 1000);
  for (let day = 0; day < days; day += 1) world.dayClosed(day, (day + 1) * DAY_MS - 1);
}

/**
 * 这个人听来的当日条目。
 *
 * `legend` 层的碑文也是 `sourceMode === 'heard'`（它的来历是「大家都这么说」，
 * 不是某一个人告诉我的），所以要按 `tier` 分开——碑文不是这一组测的东西。
 */
function toldOf(world: MemoryWorld, holderId: string): readonly MemoryEntry[] {
  return world
    .viewOf(holderId)!
    .memories.filter((entry) => entry.sourceMode === 'heard' && entry.tier === 'day');
}

function believeCount(world: MemoryWorld, holderId: string): number {
  return world.viewOf(holderId)!.beliefs.length;
}

test('听说了就记下来：听来的那几个人各有一条 heard 条目', () => {
  // 改之前这里是「2 个人有信念、0 条听来的记忆」。目击者 v0 例外：
  // 断言诞生在他身上，他自己不持有信念（`diffuseDay` 在第 0 跳把他补进去），
  // 他有一条 `witnessed` 条目——那条路一直是通的，这一组不碰它。
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 1);

  const hearers = world.holderIds().filter((id) => believeCount(world, id) > 0);
  assert.ok(hearers.length > 0, '至少该传出去一点，否则这一条没在测东西');
  for (const id of hearers) {
    const told = toldOf(world, id);
    assert.equal(told.length, 1, `${id} 该正好有一条听来的记忆，实际 ${told.length} 条`);
    assert.equal(told[0]!.sourceMode, 'heard');
  }

  const witnessed = world.viewOf('v0')!.memories.filter((entry) => entry.sourceMode === 'witnessed');
  assert.equal(witnessed.length, 1, '目击者照旧只有亲历那一条，没被这次接线碰到');
  assert.equal(toldOf(world, 'v0').length, 0, '目击者不是听说来的，不该有 heard 条目');
});

test('heard 条目记的是同一条出处，细节与可信度照断言来', () => {
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 1);

  const told = toldOf(world, 'v1');
  assert.equal(told.length, 1, '同一条断言只该落成一条');
  const entry = told[0]!;
  assert.deepEqual(entry.eventRefs, ['ev_1'], '出处该是那条事件');
  assert.equal(entry.kind, 'episodic');
  assert.equal(entry.tier, 'day');
  // 第一跳：细节掉一级（3→2？不，hopDetailLoss 之后是 2），可信度打折。
  assert.ok(entry.content.detailLevel < 3, '听来的总比亲眼看的少一层细节');
  assert.ok(entry.confidence < 1, '传闻的可信度该低于 1');
  assert.equal(entry.content.what, '工坊里出了事故', '该照断言上的说法记');
  assert.equal(entry.content.where, 'foundry', '地点也该是断言上的');
});

test('来源链一级一级长：三跳的传闻带三个名字进来', () => {
  // `Claim.sourceChain` 那条链是死的（`withLink` 没有调用方，`retell` 只加
  // `hop` 不加链节），所以链从**人**上接：说话人自己那条听来的记忆排在前头。
  // 少了这一条，三跳之后链上还是只有一个名字，「他又是听谁的」是空的。
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 6);

  const chains = world.holderIds().map((id) => toldOf(world, id).map((e) => e.sourceChain));
  const longest = chains
    .flat()
    .reduce<(readonly string[])[]>((best, chain) => (chain.length > (best[0]?.length ?? 0) ? [chain] : best), [[]]);
  const chain = longest[0]!;
  assert.ok(chain.length >= 4, `最长来源链只有 ${chain.length} 节：${chain.join(' > ')}`);
  assert.equal(chain[0], chain[0]!.startsWith('claim_') ? chain[0] : '', '领头该是 claim_id');
  // 节与节之间不重复：同一个人不该在同一条链上出现两次。
  const holders = chain.slice(1);
  assert.equal(new Set(holders).size, holders.length, `链上有人重复出现：${holders.join(' > ')}`);
});

test('第一跳的来源链就是协议要的最少那两样：claim_id 与前手', () => {
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 1);

  const entry = toldOf(world, 'v1')[0]!;
  assert.deepEqual([...entry.sourceChain], [entry.sourceChain[0], 'v0']);
  assert.ok(entry.sourceChain[0]!.startsWith('claim_'), '第一节该是 claim_id');
  assert.equal(entry.sourceChain.at(-1), 'v0', '末节该是告诉我这件事的人');
});

test('听来的记不住那么牢：同一条断言，亲历者的显著度高于听说者', () => {
  // 这不是写死的差，是算出来的：`inputsFor` 按 `actors` 判 involvement，
  // 传闻的接收者不是当事人，天然拿先验那个低值。一个 `T_write`，
  // 没有为传闻另立一个数。
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 1);

  // 不按 tier 找：日终整理可能已经把这一条从 day 提到 long，而它照旧是亲历的。
  const witnessed = world
    .viewOf('v0')!
    .memories.find((entry) => entry.sourceMode === 'witnessed')!;
  const heard = toldOf(world, 'v1')[0]!;
  assert.ok(
    heard.salience < witnessed.salience,
    `听说者 ${heard.salience} 不低于亲历者 ${witnessed.salience}——传闻比真相还牢`,
  );
  assert.ok(heard.salience >= 0.3, `显著度 ${heard.salience} 没过 T_write，这条传闻被丢掉了`);
});

test('保真度沿链递减：跳得越远，细节越少、可信度越低', () => {
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 6);

  const byHop = new Map<number, { detail: number; confidence: number }>();
  for (const id of world.holderIds()) {
    for (const entry of toldOf(world, id)) {
      const hop = entry.sourceChain.length - 1;
      const existing = byHop.get(hop);
      if (existing === undefined || entry.confidence < existing.confidence) {
        byHop.set(hop, { detail: entry.content.detailLevel, confidence: entry.confidence });
      }
    }
  }
  const hops = [...byHop.keys()].sort((a, b) => a - b);
  assert.ok(hops.length >= 2, '至少要看到两跳，否则这一条没在测东西');
  for (let index = 1; index < hops.length; index += 1) {
    const earlier = byHop.get(hops[index - 1]!)!;
    const later = byHop.get(hops[index]!)!;
    assert.ok(later.confidence <= earlier.confidence, '跳得越远越不可信');
    assert.ok(later.detail <= earlier.detail, '跳得越远细节越少');
  }
});

test('日记不收传闻：写日记照旧只收亲历的当日片段', () => {
  // 协议第 7 节把日记列为整理的表现产物。若传闻混进去，一个一天什么都没
  // 亲历的人也能写出日记来——那正是 `writeDiary` 的注释说不该发生的事。
  const world = village(10);
  seedEvent(world, ['v0']);
  run(world, 1);

  for (const id of world.holderIds()) {
    for (const record of world.writtenOf(id)) {
      const heardRefs = toldOf(world, id).flatMap((entry) => entry.eventRefs);
      for (const ref of heardRefs) {
        assert.ok(
          !record.claims.some((claim) => claim.eventRefs.includes(ref)),
          `${id} 的日记里出现了他只是听说的 ${ref}`,
        );
      }
    }
  }
});

test('回放一致：同一天两次扩散得到同一批 heard 条目', () => {
  const snapshot = (): string => {
    const world = village(10);
    seedEvent(world, ['v0']);
    run(world, 6);
    return JSON.stringify(
      world
        .holderIds()
        .map((id) => toldOf(world, id).map((entry) => [entry.memoryId, entry.sourceChain, entry.confidence])),
    );
  };
  assert.equal(snapshot(), snapshot());
});
