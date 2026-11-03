import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MEMORY_CONFIG, DAY_MS } from '../src/world/memory/config.ts';
import { advanceEra, eraBreakReasons, eraLabel, signatureOf } from '../src/world/memory/era.ts';
import { gradeOf, irreversibilityOf, criteriaOf, makeEpic } from '../src/world/memory/epic.ts';
import {
  isStanding,
  landmarkAltered,
  landmarkBuilt,
  landmarkDemolished,
  landmarkRuined,
  plotKeyOf,
} from '../src/world/memory/landmark.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import type { EraSignature, Landmark, Legend, WorldFact, WorldVitals } from '../src/world/memory/types.ts';

/**
 * 场景记忆：一块地的一生、一段日子的名字、哪些事配得上「史诗」。
 *
 * 这一组钉三件事：
 * 1. **建 → 改 → 拆 → 废墟 → 重建** 整条序列读得出来，每次都带世界日；
 * 2. 时代的切段与命名**只看规则**，同样的输入得到同样的标签；
 * 3. 史诗判档可回放：同一份世界跑两遍，`epics()` 逐字节相同。
 */

const INFO = { displayName: '书斋', origin: { x: 4, y: 4 }, footprint: { w: 3, h: 2 } };
const DOOR = { x: 5, y: 5 };

function villageFrame(): MemoryRuntime {
  const rt = new MemoryRuntime({ worldId: 'scene-memory' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'hall#1', type: 'place', at: DOOR, name: '书斋' },
  ]);
  return rt;
}

function observed(
  rt: MemoryRuntime,
  eventId: string,
  change: 'built' | 'removed',
  placeId: string,
  at: number,
): void {
  rt.observe(
    {
      eventId,
      kind: change === 'built' ? 'milestone' : 'conflict',
      placeId,
      at: DOOR,
      actors: ['a'],
      outcome: { what: change === 'built' ? '有人立起了一栋新楼' : '一栋楼被拆了', name: '书斋' },
      importanceHint: change === 'built' ? 0.6 : 0.55,
      valence: change === 'built' ? 0.5 : -0.5,
      arousal: 0.4,
      placeType: 'building',
      landmark: { change, ...INFO },
    },
    ['a'],
    at,
  );
}

// ------------------------------------------------------------------ 地标

test('一块地的一生：建 → 拆 → 重建，三个阶段都在，各带世界日', () => {
  const rt = villageFrame();
  observed(rt, 'ev_built', 'built', 'hall#1', 1000);
  const first = rt.landmarks();
  assert.equal(first.length, 1);
  assert.equal(first[0]!.current, 'built');
  assert.equal(first[0]!.phases.length, 1);
  assert.equal(first[0]!.phases[0]!.day, 0);
  assert.equal(first[0]!.footprint?.w, 3, '占地留位：废墟态美术要它');

  observed(rt, 'ev_removed', 'removed', 'hall#1', DAY_MS + 1000);
  rt.removePlace('hall#1');
  const afterDemolish = rt.landmarks()[0]!;
  assert.equal(afterDemolish.current, 'demolished');
  assert.deepEqual(afterDemolish.phases.map((item) => item.state), ['built', 'demolished']);

  // 同一块地重建：新楼拿到的是新实例 id，地块没换。
  observed(rt, 'ev_rebuilt', 'built', 'hall#2', 2 * DAY_MS + 1000);
  const rebuilt = rt.landmarks()[0]!;
  assert.equal(rebuilt.current, 'rebuilt');
  assert.deepEqual(rebuilt.aliases, ['hall#1', 'hall#2'], '新旧 id 都属于这块地');
  assert.deepEqual(rebuilt.phases.map((item) => item.state), ['built', 'demolished', 'rebuilt']);
  assert.equal(rebuilt.phases[2]!.day, 2);

  const chronicle = rt.placeChronicle('hall#1')!;
  assert.equal(chronicle.name, '书斋');
  assert.equal(chronicle.state, 'rebuilt');
  assert.equal(chronicle.phases.length, 3, '面板读出整条序列');
  assert.equal(chronicle.absent, null, '楼又站起来了，没有「曾经有一栋楼」那一句');
});

test('拆了三天没重建：状态从「刚拆」变成「废墟」，原因仍是那次拆除', () => {
  const rt = villageFrame();
  observed(rt, 'ev_built', 'built', 'hall#1', 1000);
  observed(rt, 'ev_removed', 'removed', 'hall#1', 2000);
  rt.removePlace('hall#1');

  rt.tick(3 * DAY_MS);
  assert.equal(rt.landmarks()[0]!.current, 'demolished', '第 2 天结束还只是「刚拆」');
  rt.tick(4 * DAY_MS);
  const ruined = rt.landmarks()[0]!;
  assert.equal(ruined.current, 'ruined');
  const last = ruined.phases[ruined.phases.length - 1]!;
  assert.equal(last.state, 'ruined');
  assert.equal(last.causeEventRef, 'ev_removed', '废墟不是新事件，是同一件事的下一个样子');
  assert.equal(rt.landmarks()[0]!.phases.filter((p) => p.state === 'demolished').length, 1, '旧阶段不删');
});

test('改：改名在同一块地上多一段阶段，不另起一条', () => {
  const built: Landmark = landmarkBuilt('hall#1', INFO, 0, 1000, 'ev_built');
  const altered = landmarkAltered(built, '书斋·立事', 2, 2 * DAY_MS, 'ev_legend');
  assert.equal(altered.phases.length, 2);
  assert.equal(altered.current, 'built', '改名不改变「站着」这件事');
  assert.match(altered.phases[1]!.note, /改名/);
  assert.equal(altered.displayName, '书斋·立事');
});

test('没有建成记录的拆楼：不编生日，只记一段「拆除」', () => {
  const land: Landmark = landmarkDemolished(
    landmarkBuilt('hall#1', INFO, 0, 1000, 'ev_built'),
    1,
    DAY_MS,
    'ev_removed',
    { x: 5, y: 5 },
  );
  assert.equal(isStanding(land.current), false);
  assert.equal(plotKeyOf(INFO), land.plotKey);
});

test('废墟只对「刚拆」生效，站着的地不会被标成荒废', () => {
  const standing = landmarkBuilt('hall#1', INFO, 0, 1000, 'ev_built');
  assert.equal(landmarkRuined(standing, 5, 5 * DAY_MS, 'ev_built').current, 'ruined', '纯函数本身不设闸');
  // 闸在 `shouldRuine`（world.ts 的日终用），这里只钉状态机允许的那一段。
  const demolished = landmarkDemolished(standing, 1, DAY_MS, 'ev_removed', { x: 5, y: 5 });
  assert.equal(demolished.current, 'demolished');
});

// ------------------------------------------------------------------ 时代

function sig(day: number, overrides: Partial<EraSignature> = {}): EraSignature {
  return {
    day,
    meanValence: 0,
    meanArousal: 0.3,
    infoEntropy: 0.2,
    isolatedHolders: 0,
    buildingCount: 7,
    ruinCount: 0,
    legendReachSum: 0,
    population: 7,
    ...overrides,
  };
}

test('时代切段：不满 30 天不切，满 30 天且偏移够大才切', () => {
  const start = sig(0);
  assert.deepEqual(eraBreakReasons(start, sig(20, { meanValence: 0.5 }), DEFAULT_MEMORY_CONFIG), [], '20 天不切');
  assert.deepEqual(
    eraBreakReasons(start, sig(31, { meanValence: 0.2 }), DEFAULT_MEMORY_CONFIG),
    [],
    '差 0.2 不到 0.25，不切',
  );
  assert.deepEqual(
    eraBreakReasons(start, sig(31, { meanValence: 0.3 }), DEFAULT_MEMORY_CONFIG),
    ['valence'],
    '差 0.3 越过了 0.25',
  );
  assert.deepEqual(
    eraBreakReasons(start, sig(31, { buildingCount: 5 }), DEFAULT_MEMORY_CONFIG),
    ['buildings'],
    '7 → 5 是 -28%，越过 20%',
  );
  assert.deepEqual(
    eraBreakReasons(start, sig(31, { isolatedHolders: 3 }), DEFAULT_MEMORY_CONFIG),
    ['isolation'],
    '3/7 = 43%，越过 30%',
  );
});

test('时代命名：规则表，不交给模型', () => {
  assert.equal(eraLabel(sig(31, { meanValence: -0.3, isolatedHolders: 4 }), sig(0)), '长夜');
  assert.equal(
    eraLabel(sig(31, { buildingCount: 9, ruinCount: 0 }), sig(0, { ruinCount: 2 })),
    '重建年代',
  );
  assert.equal(eraLabel(sig(31, { meanValence: 0.3 }), sig(0)), '灯潮初年');
  assert.equal(eraLabel(sig(31, { isolatedHolders: 4 }), sig(0)), '寂静年代');
  assert.equal(eraLabel(sig(31), sig(0)), '潮平年代');
});

test('时代切段之后：上一段有界，下一段接在今天', () => {
  const opened = advanceEra(
    { eraId: 'era1', fromDay: 0, toDay: null, label: '潮平年代', startSignature: sig(0), lastSignature: sig(30), definingEventRefs: [], confidence: 0.34 },
    sig(31, { meanValence: 0.4 }),
    DEFAULT_MEMORY_CONFIG,
    () => 'era2',
    (from, to) => [`ev_${from}_${to}`],
  );
  assert.equal(opened.closed?.toDay, 30, '上一段止于切段前一天');
  assert.deepEqual(opened.closed?.definingEventRefs, ['ev_0_30'], '段内大事在关段时填');
  assert.equal(opened.open.fromDay, 31);
  assert.equal(opened.open.toDay, null);
  assert.equal(opened.open.eraId, 'era2');
});

test('日终记一笔时代：关一天就有一段，当前段没有结束日', () => {
  const rt = villageFrame();
  rt.tick(DAY_MS);
  const eras = rt.eras();
  assert.equal(eras.length, 1);
  assert.equal(eras[0]!.fromDay, 0);
  assert.equal(eras[0]!.toDay, null);
  assert.equal(eras[0]!.lastSignature.day, 0);
});

// ------------------------------------------------------------------ 史诗

function fact(overrides: Partial<WorldFact> = {}): WorldFact {
  return {
    eventId: 'ev_1',
    day: 0,
    tick: 0,
    kind: 'milestone',
    placeId: 'hall',
    actors: [],
    witnesses: [],
    parentEventId: null,
    outcome: { what: '一栋楼立起来了', name: '书斋' },
    visibility: 'world',
    importanceHint: 0.6,
    source: 'world',
    ...overrides,
  };
}

test('不可逆性：拆楼 1、改名 0.8、立楼 0.4、闲事 0', () => {
  assert.equal(irreversibilityOf(fact({ kind: 'conflict', placeType: 'building' })), 1);
  assert.equal(irreversibilityOf(fact({ kind: 'milestone', placeType: 'building' })), 0.4);
  assert.equal(irreversibilityOf(fact({ kind: 'conflict' })), 0, '口角可以过去，不算不可逆');
  assert.equal(irreversibilityOf(undefined), 0, '查不到的事件按 0 计，不按「很大」计');
});

function legendOf(overrides: Partial<Legend> = {}): Legend {
  return {
    legendId: 'lg1',
    eventRefs: ['ev_1'],
    variants: ['一栋楼被拆了'],
    reach: 7,
    homePlaceId: 'hall',
    formedDay: 3,
    ...overrides,
  };
}

test('史诗判档：五条度量决定档位，边界值可测', () => {
  const lookups = {
    factOf: (ref: string) => (ref === 'ev_1' ? fact({ kind: 'conflict', placeType: 'building', importanceHint: 0.55, day: 0 }) : undefined),
    population: 7,
    formedDay: 3,
  };
  const criteria = criteriaOf(legendOf(), lookups);
  assert.equal(criteria.importance, 0.55);
  assert.equal(criteria.irreversibility, 1);
  assert.equal(criteria.reachShare, 1);
  assert.equal(criteria.spanDays, 3);
  assert.equal(gradeOf(criteria, DEFAULT_MEMORY_CONFIG), 'epic', '0.55 够得着世界级，但够不着开天辟地（要 0.8）');

  const heavier = { ...criteria, importance: 0.9, reachShare: 0.75 };
  assert.equal(gradeOf(heavier, DEFAULT_MEMORY_CONFIG), 'founding', '不可逆 + 全员在讲 + 极重');

  const lowerReach = { ...criteria, reachShare: 0.4 };
  assert.equal(gradeOf(lowerReach, DEFAULT_MEMORY_CONFIG), 'local', '不到一半人讲，进不了史诗');

  const chatter = { importance: 0.55, irreversibility: 0, reachShare: 1, populationShare: 1, spanDays: 3 };
  assert.equal(gradeOf(chatter, DEFAULT_MEMORY_CONFIG), 'legend', '口角再响也只到传说档');

  const light = { ...chatter, importance: 0.4, populationShare: 0.3 };
  assert.equal(gradeOf(light, DEFAULT_MEMORY_CONFIG), 'local', '不够重、知道的人也不多，不进史诗');

  assert.equal(makeEpic('ep1', legendOf(), lookups, DEFAULT_MEMORY_CONFIG)?.grade, 'epic');
});

test('史诗条目可回放：同一份世界跑两遍，epics() 逐字节相同', () => {
  function run(): string {
    const rt = new MemoryRuntime({ worldId: 'epic-determinism', occlusion: { isWalkable: () => true } });
    rt.syncHolders([
      { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
      { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
      { holderId: 'c', type: 'character', at: { x: 2, y: 0 } },
      { holderId: 'd', type: 'character', at: { x: 3, y: 0 } },
      { holderId: 'e', type: 'character', at: { x: 4, y: 0 } },
      { holderId: 'f', type: 'character', at: { x: 5, y: 0 } },
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
    for (let day = 1; day <= 6; day += 1) rt.tick(day * DAY_MS);
    return JSON.stringify(rt.epics());
  }
  const first = run();
  const second = run();
  assert.equal(first, second, '同一份输入跑两遍，史诗条目必须一样');
  assert.ok(JSON.parse(first).length > 0, '前置：这六天里该长出至少一条够格的条目');
});

// ------------------------------------------------------------------ 成长记录

test('求证证实之后留下一个转折点：from held → to confirmed', () => {
  const rt = new MemoryRuntime({ worldId: 'turning-point' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'c', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'd', type: 'character', at: { x: 3, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_accident',
      kind: 'workshop_accident',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 0.9,
      valence: -0.6,
      arousal: 0.9,
    },
    ['a'],
    1000,
  );
  rt.world.createClaimFrom('ev_accident', 'a', 1000);
  rt.tick(DAY_MS);

  const hearer = rt.world.holderIds().find((id) => (rt.viewOf(id)?.memories ?? []).some((m) => m.sourceMode === 'heard'));
  assert.ok(hearer !== undefined, '前置：日终该把这条传言传出去');
  const claimId = rt.viewOf(hearer)!.beliefs[0]!.claimId;
  // 直接走求证闭环：现场那道焦痕与这件事同向，定案为 confirmed。
  const result = rt.world.verify(hearer, claimId, 'foundry', 2 * DAY_MS);
  assert.equal(result.outcome, 'confirmed');

  const points = rt.turningPointsOf(hearer);
  assert.equal(points.length, 1, '看法落地成 confirmed 就记一个转折点');
  assert.equal(points[0]!.kind, 'belief-reversed');
  assert.equal(points[0]!.to, 'confirmed');
  assert.deepEqual(points[0]!.eventRefs, ['ev_accident'], '转折点仍指回原来的事件');
  assert.equal(rt.viewOf(hearer)!.turningPoints.length, 1, '从 viewOf 那扇门读得到');
});

test('求证没结果（inconclusive）不记转折点：没想明白不是「他变了」', () => {
  const rt = new MemoryRuntime({ worldId: 'turning-point-none' });
  rt.syncHolders([
    { holderId: 'a', type: 'character', at: { x: 0, y: 0 } },
    { holderId: 'b', type: 'character', at: { x: 1, y: 0 } },
    { holderId: 'c', type: 'character', at: { x: 2, y: 0 } },
    { holderId: 'd', type: 'character', at: { x: 3, y: 0 } },
    { holderId: 'foundry', type: 'place', at: { x: 0, y: 0 } },
    // 一处干净的验证地：没有痕迹、也没有公告。日报只贴在被讲的那件事的落点，
    // 所以「换个地方去看」才真的什么都没看见。
    { holderId: 'empty', type: 'place', at: { x: 20, y: 20 } },
  ]);
  rt.observe(
    {
      eventId: 'ev_clean',
      kind: 'expedition_done',
      placeId: 'foundry',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 0.9,
      valence: 0.3,
      arousal: 0.4,
    },
    ['a'],
    1000,
  );
  rt.world.createClaimFrom('ev_clean', 'a', 1000);
  rt.tick(DAY_MS);
  const hearer = rt.world.holderIds().find((id) => (rt.viewOf(id)?.memories ?? []).some((m) => m.sourceMode === 'heard'));
  assert.ok(hearer !== undefined);
  const claimId = rt.viewOf(hearer)!.beliefs[0]!.claimId;
  // `expedition_done` 不留任何痕迹，而这块干净的地方也没有公告：判不了案。
  const result = rt.world.verify(hearer, claimId, 'empty', 2 * DAY_MS);
  assert.equal(result.outcome, 'inconclusive');
  assert.deepEqual(rt.turningPointsOf(hearer), []);
});

test('vitals 形状：时代签名的四个数直接取关心的那四个', () => {
  const vitals: WorldVitals = { day: 5, meanValence: 0.1, meanArousal: 0.4, infoEntropy: 0.2, isolatedHoldersCount: 1 };
  const signature = signatureOf({
    day: 5,
    vitals,
    buildingCount: 2,
    ruinCount: 1,
    legendReachSum: 3,
    population: 4,
  });
  assert.equal(signature.meanValence, 0.1);
  assert.equal(signature.isolatedHolders, 1);
  assert.equal(signature.buildingCount, 2);
  assert.equal(signature.ruinCount, 1);
});
