import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY_MS } from '../src/world/memory/config.ts';
import { inputsFor } from '../src/world/memory/salience.ts';
import { MemoryWorld } from '../src/world/memory/world.ts';

/**
 * 闪光灯记忆：从「够得着 `T_flash`」到「真的永久」。
 *
 * 「闪光灯记忆永久」这句话在协议里说了三遍（第 6 节 character 表的「闪光灯
 * 记忆永久」、补充设计 §3.1 阈值表的「标记 flashbulb 后永不衰减」、第 7 节的
 * 「flashbulb 与 pinned 不衰减」）。而实现里原先有**两道断口**，每一道都让它
 * 落空，且都是绿的：
 *
 * 1. `inputsFor` 只算事件自己的情绪，`KIND_PRIORS.emotion` 那一列 12 行一次都没
 *    被读过。没定性的事件落 `defaultValence` / `defaultArousal`，一律 0 / 0.3，
 *    算出来 0.15。实测 12 类事件、本人是当事人、`importanceHint` 拉满 1.0，
 *    最高只到 0.800（celebration）——`T_flash`（0.85）一类都够不着。
 * 2. 就算写上了 `flashbulb: true`，`T_promote`（0.6）低于 `T_flash`（0.85），
 *    于是每条闪光灯片段在当天第一次整理时就被 `makeSummary` 压成日摘要，摘要
 *    写死 `flashbulb: false`。实测一条 0.850 的里程碑片段，`dayClosed(0)` 一过
 *    就只剩摘要，第 6 天再并成周摘要——flag 活不过一天。
 *
 * 两处都补上，「永不衰减」的三个消费者（`decayStrength` 的豁免、归档豁免、
 * `trimBudget` 的「固定与闪光灯先保」）才第一次有东西可咬。
 *
 * 全部走公开 API：`viewOf` 看得见的，就该能透过它验。
 */

function world(): MemoryWorld {
  const w = new MemoryWorld({ worldId: 'flash', grid: { isWalkable: () => true } });
  w.addHolder({ holderId: 'v0', type: 'character', profile: {}, at: { x: 0, y: 0 } });
  w.addHolder({ holderId: 'p1', type: 'place', profile: {}, at: { x: 1, y: 0 } });
  return w;
}

/** 一件 v0 既是当事人又是唯一目击者的事。 */
function fire(w: MemoryWorld, eventId: string, kind: string, hint: number, at: number): void {
  w.ingest({
    eventId,
    at,
    kind,
    place: { placeId: 'p1', at: { x: 1, y: 0 }, indoor: false },
    actors: ['v0'],
    outcome: { what: '一件事' },
    visibility: 'world',
    source: 'world',
    importanceHint: hint,
    parentEventId: null,
    witnesses: ['v0'],
  });
}

/** 这个测试只关心的那几列。 */
type Row = {
  memoryId: string;
  kind: string;
  tier: string;
  flashbulb: boolean;
  archived: boolean;
  strength: number;
  salience: number;
};

function memoriesOf(w: MemoryWorld, holderId = 'v0'): readonly Row[] {
  return (w.viewOf(holderId)?.memories ?? []) as unknown as readonly Row[];
}

// ---------------------------------------------------------------- 第一道断口

test('inputsFor：kind 先验是情绪的地板，事件自己的情绪只能往上抬', () => {
  // 没定性的事件。世界侧默认表给 milestone 的是 valence 0 / arousal 0.3，
  // 自己算出来只有 0.15；先验说 0.7，那就该是 0.7。
  const bare = inputsFor({
    kind: 'milestone',
    holderId: 'v0',
    actors: [],
    importanceHint: null,
    valence: 0,
    arousal: 0.3,
  });
  assert.equal(bare.emotion, 0.7, 'KIND_PRIORS.milestone.emotion');

  // 事件自己的情绪更高时它赢——先验是地板，不是盖子。
  const loud = inputsFor({
    kind: 'workshop_accident',
    holderId: 'v0',
    actors: [],
    importanceHint: null,
    valence: -1,
    arousal: 1,
  });
  assert.equal(loud.emotion, 1, '炸炉加满唤醒压过 0.8 的先验');

  // 反过来不成立：一条没定性的事故仍然是 0.8，不落回 0.15。
  const quiet = inputsFor({
    kind: 'workshop_accident',
    holderId: 'v0',
    actors: [],
    importanceHint: null,
    valence: 0,
    arousal: 0.3,
  });
  assert.equal(quiet.emotion, 0.8);

  // 没登记的 kind 落 unknown（0.3），不因为没人登记就被当成没情绪。
  const novel = inputsFor({
    kind: 'brand_new_kind',
    holderId: 'v0',
    actors: [],
    importanceHint: null,
    valence: 0,
    arousal: 0,
  });
  assert.equal(novel.emotion, 0.3);
});

test('T_flash 可达：一条当事人亲历的里程碑够得上闪光灯', () => {
  const w = world();
  fire(w, 'ev_ms', 'milestone', 1, 1000);
  const flash = memoriesOf(w).filter((m) => m.flashbulb);
  assert.equal(flash.length, 1, '本人是当事人、importanceHint 拉满，里程碑该亮');
  assert.ok(flash[0]!.salience >= w.config.T_flash, `salience ${flash[0]!.salience} 该过线`);
});

test('够不上的 kind 照样不亮：同一个设置下 task_done 到不了 0.85', () => {
  const w = world();
  fire(w, 'ev_td', 'task_done', 1, 1000);
  assert.deepEqual(memoriesOf(w).filter((m) => m.flashbulb), []);
  // 但它还是写进来了——T_flash 罕见不等于 T_write 罕见。
  assert.equal(memoriesOf(w).length, 1);
});

// ---------------------------------------------------------------- 第二道断口

test('闪光灯不被压成摘要：十天后还是当天那条鲜明的片段', () => {
  const w = world();
  fire(w, 'ev_ms', 'milestone', 1, 1000);
  for (let d = 0; d < 10; d += 1) w.dayClosed(d, (d + 1) * DAY_MS);

  const flash = memoriesOf(w).filter((m) => m.flashbulb);
  assert.equal(flash.length, 1, '压一次就没了，等于 flag 只活一天');
  assert.equal(flash[0]!.kind, 'episodic', '它还是一条片段，不是摘要');
  assert.equal(flash[0]!.tier, 'day');
  assert.equal(flash[0]!.strength, 1, 'flashbulb 不衰减');
  assert.equal(flash[0]!.archived, false, 'strength 不落，归档也轮不到它');
});

test('对照组：同一天的普通片段照旧衰减、归档', () => {
  const w = world();
  fire(w, 'ev_ms', 'milestone', 1, 1000); // 闪光灯
  fire(w, 'ev_td', 'task_done', 0.2, 2000); // 写得进，但够不着晋升
  for (let d = 0; d < 20; d += 1) w.dayClosed(d, (d + 1) * DAY_MS);

  const mine = memoriesOf(w);
  const flash = mine.filter((m) => m.flashbulb);
  assert.equal(flash.length, 1, '前提：那条闪光灯还在');
  assert.equal(flash[0]!.strength, 1);

  const plain = mine.filter((m) => !m.flashbulb);
  assert.ok(plain.length > 0, '前提：那条普通的也得还在');
  assert.ok(
    plain.some((m) => m.strength < 1 || m.archived),
    '豁免只给闪光灯，别的不该跟着免',
  );
});

test('豁免只针对那一条：同一天的别的事照旧进日摘要', () => {
  const w = world();
  fire(w, 'ev_ms', 'milestone', 1, 1000);
  fire(w, 'ev_big', 'workshop_accident', 1, 2000);
  w.dayClosed(0, DAY_MS);

  const mine = memoriesOf(w);
  assert.equal(mine.filter((m) => m.flashbulb).length, 1, '闪光灯留着');
  assert.ok(mine.some((m) => m.kind === 'summary'), '别的事还是被压成了摘要');
});

test('当日预算挤不下时，闪光灯排在最前', () => {
  const w = world();
  fire(w, 'ev_ms', 'milestone', 1, 1000); // day 0
  // 往 day 桶里灌 20 条只够写、够不着晋升的普通片段。
  for (let d = 1; d <= 20; d += 1) fire(w, `ev_td_${d}`, 'task_done', 0.2, d * DAY_MS + 500);
  for (let d = 0; d < 20; d += 1) w.dayClosed(d, (d + 1) * DAY_MS);

  const dayTier = memoriesOf(w).filter((m) => m.tier === 'day');
  assert.equal(dayTier.length, w.config.budget.day, '前提：day 桶真的满了');
  assert.equal(dayTier.filter((m) => m.flashbulb).length, 1, '挤满了也该留着它');
});
