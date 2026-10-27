import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';

/**
 * 传说落成的那一刻，碑要刻下来。
 *
 * `MemoryTier` 从第一天起就列着 `'legend'`，`tierFactor.legend = 0.05`、
 * `limitFor('legend') = Infinity` 也早就配好了，下游的 `consolidateHolder`
 * 与 `trimBudget` 都按 `entry.tier` 通用地读它们。**而没有任何一处写出过
 * 这个层的条目。**于是 `legend.ts` 开头那句「淡去不是删除，它降到 legend 层
 * 之后衰减系数只有 0.05，能撑很久」的后半截在代码里是空的：0.05 这个数
 * 一次都没进过算式，`limitFor` 那个分支一次都没被走到。
 *
 * `inscribe` 补的就是这一笔。这一组测的是**它真的落下来了**，而且落得慢、
 * 裁不掉——不是又一处「配好了没人用」。
 */

/** 一个五人村子，公告栏在 (6,0)。`legendHolders = 5`，刚好够门槛。 */
function village(): MemoryRuntime {
  const rt = new MemoryRuntime({ worldId: 'legend-inscribe', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'c', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'd', type: 'character', at: { x: 3, y: 0 } },
    { holderId: 'e', type: 'character', at: { x: 4, y: 0 } },
    { holderId: 'board', type: 'place', at: { x: 6, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'mem_1',
      kind: 'workshop_accident',
      placeId: 'board',
      at: { x: 6, y: 0 },
      actors: ['a'],
      outcome: { what: '炉子炸了' },
      importanceHint: 0.95,
      valence: -0.6,
      arousal: 0.9,
    },
    undefined,
    1000,
  );
  return rt;
}

function inscriptionsOf(rt: MemoryRuntime, holderId: string): readonly MemoryEntryLike[] {
  return rt.viewOf(holderId)!.memories.filter((entry) => entry.tier === 'legend');
}

/** 那场事故的碑文。同一个世界里可能有别的碑文，认 eventRefs 不认顺序。 */
function inscriptionOf(rt: MemoryRuntime, holderId: string): MemoryEntryLike {
  const found = inscriptionsOf(rt, holderId).find((entry) => entry.eventRefs.includes('mem_1'));
  assert.ok(found !== undefined, `${holderId} 该有一块关于那场事故的碑文`);
  return found;
}

/**
 * 一件只有 a 看得见的小事。
 *
 * 大事的当日片段会被摘要吃掉（`derivedFrom` 的删除级联），四十天后一条也不剩，
 * 于是「当日层早就归档了」这句话没法在同一世界里对照。小事显著度低，
 * 进不了摘要，才能一路衰减到归档线以下留在表里。
 */
function trivia(rt: MemoryRuntime): void {
  rt.observe(
    {
      eventId: 'trivia_1',
      kind: 'milestone',
      placeId: 'board',
      at: { x: 6, y: 0 },
      actors: ['a'],
      outcome: { what: '风吹动了一片叶子' },
      importanceHint: 0.1,
      valence: 0.05,
      arousal: 0.05,
    },
    undefined,
    2000,
  );
}

/** 只为类型：不 import 整个 types，测试里用到的字段就地取。 */
interface MemoryEntryLike {
  readonly tier: string;
  readonly kind: string;
  readonly sourceMode: string;
  readonly eventRefs: readonly string[];
  readonly strength: number;
  readonly archived: boolean;
  readonly pinned: boolean;
  readonly flashbulb: boolean;
  readonly content: {
    readonly what: string;
    readonly where: string;
    readonly when: number;
    readonly valence: number;
    readonly arousal: number;
  };
}

test('传说立起来的那一刻，持有它的每人都刻上一条', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  for (const holderId of ['a', 'b', 'c', 'd', 'e']) {
    const inscriptions = inscriptionsOf(rt, holderId);
    assert.equal(inscriptions.length, 1, `${holderId} 该有一条碑文`);
  }
  // 碑文是世界对这件事的记录，不是每人各自编一份——五条的记忆号各不相同，
  // 但说的是同一件事。
  const whats = ['a', 'b', 'c', 'd', 'e'].map((id) => inscriptionsOf(rt, id)[0]!.content.what);
  assert.equal(new Set(whats).size, 1, '五个人刻的该是同一件事');
});

test('碑文记的是「大家都这么说」：来源是听说，不是某一个人转述', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  const entry = inscriptionOf(rt, 'a');
  assert.equal(entry.sourceMode, 'heard', '传说的出处是口耳相传，不是某一次目击');
  // `sourceChain` 空着：它不经过任何一次具体的转述，所以没有一条链可以指。
  // 这跟公告的 `hop = 0` 是两回事——公告有发布者，传说没有。
  assert.equal(entry.kind, 'episodic');
});

test('碑文能追到那件事：eventRefs 就是传说的那组事件', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  const entry = inscriptionOf(rt, 'a');
  assert.deepEqual(entry.eventRefs, ['mem_1']);
  // 立碑的地方是这件事发生的地方，不是听说的地方。
  assert.equal(entry.content.where, 'board');
});

test('碑文不参与淘汰：四十天后当日那条已经归档，碑文还在', () => {
  // 少了这一条，`tierFactor.legend = 0.05` 与 `limitFor('legend') = Infinity`
  // 就仍然只是两个没人读的配置项。
  const rt = village();
  trivia(rt);
  for (let day = 1; day <= 40; day += 1) rt.tick(day * DAY_MS);
  const view = rt.viewOf('a')!.memories;
  const legend = inscriptionOf(rt, 'a');
  const dayEntry = view.find((entry) => entry.tier === 'day')!;
  assert.equal(legend.archived, false, '碑文不该被归档');
  assert.ok(
    legend.strength > 0.7,
    `碑文四十天后该还剩七成以上，实际 ${legend.strength.toFixed(3)}——legend 层的系数没生效`,
  );
  // 归档机器是开着的：同一条时间线上，当日那条小事早掉到 0.15 以下进了档案。
  assert.equal(dayEntry.archived, true, '当日那条该早就归档了');
  assert.ok(dayEntry.strength < 0.05, `当日那条该衰减到几乎没有了，实际 ${dayEntry.strength.toFixed(3)}`);
});

test('碑文不钉住：钉住会让它整个跳过衰减，0.05 那个数又成了摆设', () => {
  // 第一版写的是 `pinned: true`，想着「碑文嘛，钉住最稳」。实测钉住的碑文
  // 四十天 strength 一动不动停在 1.000——`consolidateHolder` 里
  // `exempt = flashbulb || pinned`，钉住即免衰减。碑文该慢，不该停。
  const rt = village();
  for (let day = 1; day <= 40; day += 1) rt.tick(day * DAY_MS);
  const legend = rt.viewOf('a')!.memories.find((entry) => entry.tier === 'legend')!;
  assert.equal(legend.pinned, false, '碑文不该钉住');
  assert.equal(legend.flashbulb, false, '碑文也不是闪光灯记忆');
  assert.ok(legend.strength < 1, `钉住的话 strength 会一直是 1，实际 ${legend.strength.toFixed(3)}`);
});

test('碑文占的预算没有上限：当日那条被裁掉，碑文一条不裁', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  const before = rt.viewOf('a')!.memories.length;
  // 之后几天天天出事，且都发生在 a 眼前——当日那层的预算（16）会被顶穿。
  for (let day = 7; day <= 10; day += 1) {
    for (let i = 0; i < 20; i += 1) {
      rt.observe(
        {
          eventId: `flood_${day}_${i}`,
          kind: 'milestone',
          placeId: 'board',
          at: { x: 6, y: 0 },
          actors: ['a'],
          outcome: { what: '又立起一根柱子' },
          importanceHint: 0.3,
          valence: 0.1,
          arousal: 0.2,
        },
        undefined,
        day * DAY_MS + i * 100,
      );
    }
    rt.tick((day + 1) * DAY_MS);
  }
  const after = rt.viewOf('a')!.memories;
  assert.ok(after.length > before, '该攒下一堆当日记忆');
  assert.equal(
    after.filter((entry) => entry.tier === 'day').length,
    16,
    '当日那层该被裁到预算（16）以内——不然这道测试根本没在压预算',
  );
  // 三天之内满五个人都听说了几件新事，于是长出了几条新传说。它们连同最早
  // 那条，一条都不该被裁：legend 层的上限是 Infinity，那一桶不存在。
  const legends = after.filter((entry) => entry.tier === 'legend');
  assert.ok(legends.length >= 2, `该长出几条新传说，实际 ${legends.length}`);
  assert.ok(
    legends.some((entry) => entry.eventRefs.includes('mem_1')),
    '最早那块碑文该还在',
  );
});

test('后来听说的人没有碑文：碑文是形成那一刻的世界记录，不是每人一份', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  // 第七天搬来一个新人，站在 e 旁边——他会听说这件事，但那已经是后话了。
  rt.syncHolders([{ holderId: 'late', type: 'character', at: { x: 4, y: 0 } }]);
  rt.tick(7 * DAY_MS);
  assert.equal(rt.viewOf('late')!.beliefs.length, 1, '新人该听说这件事');
  assert.equal(
    inscriptionsOf(rt, 'late').length,
    0,
    '但碑文不给他补刻一份——传说的形成是一次性的',
  );
});

test('碑文的情绪跟着事件走：不是一条没有温度的字', () => {
  const rt = village();
  for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
  const content = inscriptionOf(rt, 'a').content;
  assert.ok(content.valence < 0, '炉子炸了该是负向的');
  assert.ok(content.arousal > 0.5, '该是高唤醒的');
});
