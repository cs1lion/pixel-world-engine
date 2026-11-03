import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_SLOT_MS,
  TIDE_BEAT_SLOTS,
  ambientBetween,
  slotOf,
  type AmbientDweller,
  type AmbientInput,
} from '../src/world/ambient.ts';
import {
  EMPTY_LIVELY_HISTORY,
  LIVELY_AVOID_TRUST,
  LIVELY_CLOSE_CELLS,
  LIVELY_DAILY_CAP,
  LIVELY_GAP_MS,
  LIVELY_INCIDENT_SLOT_MS,
  LIVELY_QUARREL_COOLDOWN_DAYS,
  LIVELY_SLOT_MS,
  livelyBetween,
  livelyPairKey,
  livelySettledKey,
  type LivelyEvent,
  type LivelyHistory,
  type LivelyInput,
  type LivelyVillager,
} from '../src/world/liveliness.ts';

/**
 * 世界自己生事：没有谁下命令，镇子自己走到这一刻。
 *
 * 这一组钉三件事，正好对应 `ambient.ts` 开头那三条约束：
 *
 * 1. **限流靠时间槽**——同一槽里最多一件，跨槽那一拍才可能出；
 * 2. **纯函数**——同样输入两次得到同样输出，不读任何外部状态；
 * 3. **只报已经发生的事**——潮水跨没跨中线是判据，此刻在哪一侧不是。
 *
 * 第三条最容易被写成错的：判「此刻 ≥ 0.5」的话，潮水停在 0.51 的那几十个槽
 * 会反复报同一件事。
 *
 * 还有一条是实测补上的：**跨越要看整槽，不能看相邻两拍**。跨槽那一拍离槽首
 * 只差 100 毫秒，两读数法等于只在一个 100 毫秒的窗口里找跨越，而潮水半周期
 * 6 分钟才跨一次——三天里一个都碰不上。下面「整槽里跨过一次就报」那条钉它。
 */

const SLOT = AMBIENT_SLOT_MS;

/** 第 `n` 个槽走完的那一拍：`prevNow` 在槽 n 的末尾，`now` 在槽 n+1 的开头。 */
const straddle = (n: number): { prevNow: number; now: number } => ({
  prevNow: n * SLOT + SLOT - 1,
  now: (n + 1) * SLOT,
});

/** 一个节拍槽走完的那一拍——潮水只在这些槽里看。 */
const beat = straddle(TIDE_BEAT_SLOTS - 1);

/** 在第 `slot` 个槽的中线处跨过中线：之前 `from`，之后 `to`。 */
const crossingIn = (slot: number, from: number, to: number) => (t: number): number =>
  t < (slot - 0.5) * SLOT ? from : to;

/** 整槽平着走，不跨中线。 */
const flat = (level: number) => (): number => level;

const ALTAR = { placeId: 'place:9,9', where: { x: 9, y: 9 } };

const dweller: AmbientDweller = {
  id: 'v1',
  name: '汐',
  placeId: 'place:18,22',
  where: { x: 18, y: 22 },
  label: '在旧站牌下认路',
};

function input(over: Partial<AmbientInput> = {}): AmbientInput {
  return {
    ...beat,
    tideAt: flat(0.62),
    dwellers: [],
    tidePlace: ALTAR,
    ...over,
  };
}

test('同一槽里不出事——限流不是靠计数器，是靠时间槽', () => {
  // 放一个停在落点上的人：没有这一条，把时间槽闸拆掉这条也照样绿，
  // 因为空世界里本来就没东西可报——那就成了一个什么也没测的测试。
  const events = ambientBetween(input({ prevNow: 10, now: 20, dwellers: [dweller] }));
  assert.deepEqual(events, [], '槽还没走完就报了一件，一天下来会被刷满');
});

test('跨槽且整槽里潮水越过中线：报一次潮水掉头，方向对', () => {
  const rising = ambientBetween(input({ tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.49, 0.51) }));
  assert.equal(rising.length, 1);
  assert.equal(rising[0]!.kind, 'tide_turn');
  assert.match(rising[0]!.text, /涨/);
  assert.equal(rising[0]!.actorId, null, '潮水没有当事人');

  const falling = ambientBetween(input({ tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.51, 0.49) }));
  assert.equal(falling.length, 1);
  assert.equal(falling[0]!.kind, 'tide_turn');
  assert.match(falling[0]!.text, /退/);
});

test('整槽里跨过一次就报——不要求跨越正好落在槽首那 100 毫秒里', () => {
  // 跨越在槽的正中间，离槽首半小时。按「相邻两拍」写的实现会在这里一件都不报，
  // 而那是它唯一会看的那一拍。
  const events = ambientBetween(input({ tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.4, 0.6) }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'tide_turn');
});

test('潮水还在同一侧就不报——判的是「跨没跨过」，不是「此刻在哪一侧」', () => {
  // 整槽都在中线以上。按「此刻 ≥ 0.5」写的实现会在这里报一件，
  // 于是潮水停在 0.51 的几十个槽会反复说同一句话。
  assert.deepEqual(ambientBetween(input({ tideAt: flat(0.51) })), []);
});

test('潮水不在节拍槽里就让位：那一槽轮不到潮水，人声才进得来', () => {
  // 槽 1 里潮水照样跨了中线，但 1 % 8 !== 0。按「跨了就报」写，潮水一天报 240 次，
  // 每个槽都被它占满，下面那条日常一句也说不上。
  const crossing = crossingIn(1, 0.4, 0.6);
  assert.deepEqual(ambientBetween(input({ ...straddle(0), tideAt: crossing })), []);
  const events = ambientBetween(input({ ...straddle(0), tideAt: crossing, dwellers: [dweller] }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'routine_done');
});

test('潮水没动静时，取第一个停在落点上的人', () => {
  const second: AmbientDweller = { ...dweller, id: 'v2', name: '雾', label: '点亮楼前的长灯' };
  const events = ambientBetween(input({ dwellers: [dweller, second] }));
  assert.equal(events.length, 1, '一个槽最多一件');
  assert.equal(events[0]!.kind, 'routine_done');
  assert.equal(events[0]!.text, '汐在旧站牌下认路', '文案用她的作息牌子，不是另编一句');
  assert.deepEqual(events[0]!.where, { x: 18, y: 22 });
  assert.equal(events[0]!.actorId, 'v1', '这件事是她做的，当事人得带上——不然她自己都记不住');
});

test('跨槽但潮水没跨线、也没人停着：什么也不报', () => {
  assert.deepEqual(ambientBetween(input()), []);
});

test('潮水那件事落在潮位给的落点上（有楼进水就报那栋楼）', () => {
  const events = ambientBetween(
    input({
      tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.4, 0.6),
      tidePlace: { placeId: 'ferry_station#1', where: { x: 10, y: 10 } },
    }),
  );
  assert.equal(events[0]!.placeId, 'ferry_station#1');
  assert.deepEqual(events[0]!.where, { x: 10, y: 10 });
});

test('纯函数：同样输入两次，逐字相同', () => {
  const given = input({ tideAt: flat(0.62), dwellers: [dweller] });
  assert.deepEqual(ambientBetween(given), ambientBetween(given));
});

test('槽边界：正好落在边界上算新槽，差一毫秒不算', () => {
  assert.equal(slotOf(SLOT - 1), 0);
  assert.equal(slotOf(SLOT), 1);
  // 前一拍在边界上、这一拍还在同一槽里 → 不出事。
  assert.deepEqual(
    ambientBetween(input({ prevNow: SLOT, now: SLOT + 1, tideAt: flat(0.62), dwellers: [dweller] })),
    [],
  );
  // 前一拍差一毫秒到边界 → 跨槽，该出。
  assert.equal(
    ambientBetween(input({ prevNow: SLOT - 1, now: SLOT, tideAt: flat(0.62), dwellers: [dweller] }))
      .length,
    1,
  );
});

// ------------------------------------------------------------ 街头活气
//
// 这一组钉三件事：三个以上的互动确实能被位置 + 关系选出来；同一输入逐字可复现；
// 街头小事三种都能在合适的位置/时辰被触发。位置与关系都是输入的，判据不碰外部状态。

const WATER = { x: 12, y: 9 };
const STANDING: LivelyVillager = {
  id: 'v0',
  name: '甲',
  cell: { x: 10, y: 9 },
  walking: false,
  standing: true,
  carrying: false,
  free: true,
};
const STANDING_NEAR: LivelyVillager = {
  ...STANDING,
  id: 'v1',
  name: '乙',
  cell: { x: 11, y: 9 },
};
const WALKING_NEAR: LivelyVillager = {
  ...STANDING_NEAR,
  walking: true,
  standing: false,
};

function livelyInput(over: Partial<LivelyInput> = {}): LivelyInput {
  return {
    prevNow: 6 * 3_600_000,
    now: 6 * 3_600_000,
    seed: 'street-test',
    villagers: [STANDING, STANDING_NEAR],
    relations: [],
    waterPlace: WATER,
    ...over,
  };
}

/** 在一个 10 分钟槽的边界上走一拍。 */
const livelyAt = (slot: number, over: Partial<LivelyInput> = {}): LivelyInput => ({
  ...livelyInput(over),
  prevNow: slot * LIVELY_SLOT_MS - 1,
  now: slot * LIVELY_SLOT_MS,
});

test('同样输入两次，逐字相同（种子是唯一的随机来源）', () => {
  for (let slot = 37; slot < 120; slot += 1) {
    const given = livelyAt(slot);
    assert.deepEqual(livelyBetween(given), livelyBetween(given));
    if (livelyBetween(given).length > 0) return;
  }
  assert.fail('120 个槽里一件街头互动都没有——这条测试自己就没在验复现');
});

test('位置 + 关系能选出三种以上的互动：招呼 / 一起做事 / 让路', () => {
  const kinds = new Set<string>();
  for (let slot = 37; slot < 220; slot += 1) {
    for (const event of livelyBetween(livelyAt(slot))) kinds.add(event.kind);
    for (const event of livelyBetween(livelyAt(slot, { villagers: [STANDING, WALKING_NEAR] }))) {
      kinds.add(event.kind);
    }
  }
  assert.ok(kinds.has('street_greet'), '站着的两个人碰面从来没招呼过');
  assert.ok(kinds.has('street_together'), '白天挨着的两个人从来没一起搭手');
  assert.ok(kinds.has('street_yield'), '走路的人从来没让过路');
});

test('关系读数够冷时，站着碰面一定变成争执而不是招呼', () => {
  const cold = [
    { from: 'v0', to: 'v1', trust: LIVELY_AVOID_TRUST - 0.05, warmth: -0.2 },
    { from: 'v1', to: 'v0', trust: LIVELY_AVOID_TRUST - 0.05, warmth: -0.2 },
  ];
  for (let slot = 37; slot < 400; slot += 1) {
    const events = livelyBetween(livelyAt(slot, { relations: cold }));
    if (events.length === 0) continue;
    assert.equal(events[0]!.kind, 'street_quarrel', '冷到阈值以下还在笑着打招呼，关系读数等于没接上');
    return;
  }
  assert.fail('400 个槽里没有一次跨槽——这条测试的前提没成立');
});

test('让路只挪站着的那位，走路的那位路线不动', () => {
  for (let slot = 37; slot < 220; slot += 1) {
    const events = livelyBetween(livelyAt(slot, { villagers: [STANDING, WALKING_NEAR] }));
    const yieldEvent = events.find((event) => event.kind === 'street_yield');
    if (yieldEvent === undefined) continue;
    assert.equal(yieldEvent.shift?.villagerId, 'v0', '被让路的那位反而挪了');
    assert.equal(yieldEvent.shift?.awayFromId, 'v1');
    return;
  }
  assert.fail('200 个槽里没有一次让路');
});

test('街头小事三种都能被触发：撞担 / 抢水 / 帮抬', () => {
  const kinds = new Set<string>();
  const carrier: LivelyVillager = {
    ...STANDING,
    id: 'v0',
    name: '甲',
    carrying: true,
  };
  const helper: LivelyVillager = {
    ...STANDING_NEAR,
    id: 'v1',
    name: '乙',
  };
  for (let day = 0; day < 60; day += 1) {
    const base = day * 12 * LIVELY_INCIDENT_SLOT_MS;
    for (const hourOffset of [3, 4]) {
      // 槽首是 6:00 / 8:00——抢水那两拍。
      const now = base + hourOffset * LIVELY_INCIDENT_SLOT_MS;
      const incidentInput = (villagers: LivelyVillager[], relations: LivelyInput['relations'] = []) => ({
        ...livelyInput({ villagers, relations }),
        prevNow: now - 1,
        now,
      });
      for (const event of livelyBetween(incidentInput([carrier, helper]))) kinds.add(event.kind);
      for (const event of livelyBetween(incidentInput([STANDING, WALKING_NEAR]))) kinds.add(event.kind);
      for (const event of livelyBetween(incidentInput(
        [{ ...STANDING, cell: WATER }, { ...STANDING_NEAR, cell: { x: WATER.x + 1, y: WATER.y } }],
      ))) kinds.add(event.kind);
    }
  }
  assert.ok(kinds.has('street_help'), '肩上有货却从没人搭手');
  assert.ok(kinds.has('street_water'), '清晨井边从来没抢过水');
  assert.ok(kinds.has('street_tumble'), '路上从来没撞翻过担子');
  assert.ok(kinds.size >= 3);
  // 位置判据必须真的在起作用：把两人拉到 4 格外，什么都不会出。
  const far = { ...STANDING_NEAR, cell: { x: STANDING.cell.x + LIVELY_CLOSE_CELLS + 2, y: STANDING.cell.y } };
  for (let slot = 37; slot < 60; slot += 1) {
    assert.deepEqual(livelyBetween(livelyAt(slot, { villagers: [STANDING, far] })), []);
  }
});

const DAY_SLOTS = 24 * 60 / 10;

/**
 * 按 `Simulation` 的同一本日账逐槽走一天：去重、上限、冷却、最近互动都要吃账。
 * 返回每一件落地的时刻，供「不堆在同一分钟」的断言用。
 */
function runLivelyDay(options: {
  seed: string;
  villagers: LivelyVillager[];
  relations?: LivelyInput['relations'];
  day?: number;
  history?: LivelyHistory;
}): { events: { event: LivelyEvent; at: number }[]; history: LivelyHistory } {
  let totalToday = options.history?.totalToday ?? 0;
  const settledToday = [...(options.history?.settledToday ?? [])];
  const quarrelDays = { ...(options.history?.quarrelDays ?? {}) };
  const lastAt = { ...(options.history?.lastAt ?? {}) };
  const todayByVillager = { ...(options.history?.todayByVillager ?? {}) };
  const events: { event: LivelyEvent; at: number }[] = [];
  const day = options.day ?? 0;
  for (let slot = day * DAY_SLOTS + 36; slot < day * DAY_SLOTS + 138; slot += 1) {
    const at = slot * LIVELY_SLOT_MS;
    const found = livelyBetween({
      prevNow: at - 1,
      now: at,
      seed: options.seed,
      villagers: options.villagers,
      relations: options.relations ?? [],
      waterPlace: WATER,
      history: { totalToday, settledToday, quarrelDays, lastAt, todayByVillager },
    });
    for (const event of found) {
      events.push({ event, at });
      totalToday += 1;
      const pairKey = livelyPairKey(event.actorId, event.otherId);
      settledToday.push(livelySettledKey(pairKey, event.kind));
      lastAt[event.actorId] = at;
      lastAt[event.otherId] = at;
      todayByVillager[event.actorId] = (todayByVillager[event.actorId] ?? 0) + 1;
      todayByVillager[event.otherId] = (todayByVillager[event.otherId] ?? 0) + 1;
      if (event.kind === 'street_quarrel') quarrelDays[pairKey] = day;
    }
  }
  return {
    events,
    history: { totalToday, settledToday, quarrelDays, lastAt, todayByVillager },
  };
}

test('一天上限 12 件、同一对同类只落一次，时间不堆在同一分钟', () => {
  const run = runLivelyDay({ seed: 'street-test', villagers: [STANDING, STANDING_NEAR] });
  assert.ok(run.events.length >= 3, '一天下来一件互动都没有，这条测试自己就没在验限流');
  assert.ok(
    run.events.length <= LIVELY_DAILY_CAP,
    `一天落了 ${run.events.length} 件，超过上限 ${LIVELY_DAILY_CAP}`,
  );
  const keys = run.events.map(
    ({ event }) => livelySettledKey(livelyPairKey(event.actorId, event.otherId), event.kind),
  );
  assert.equal(new Set(keys).size, keys.length, '同一对同一类在同一天落了两次');
  assert.equal(
    new Set(run.events.map(({ at }) => at)).size,
    run.events.length,
    '两件互动落在同一拍，街上还是叠在一起',
  );
  const hourSpread = new Set(run.events.map(({ at }) => Math.floor(at / 3_600_000)));
  assert.ok(hourSpread.size > 1, '所有互动都挤在同一个小时里');
  for (let index = 1; index < run.events.length; index += 1) {
    const gap = run.events[index]!.at - run.events[index - 1]!.at;
    assert.ok(
      gap >= LIVELY_GAP_MS,
      `第 ${index} 与第 ${index + 1} 件只隔 ${gap / 60_000} 分钟，短于 ${LIVELY_GAP_MS / 60_000} 分钟的护栏`,
    );
  }
});

test('任意两件之间至少隔 30 世界分钟：20 分钟后那一槽直接跳过', () => {
  const at = 6 * 60 * 60_000 + 20 * 60_000;
  const recent: LivelyHistory = { ...EMPTY_LIVELY_HISTORY, lastAt: { v0: at - 20 * 60_000, v1: at - 20 * 60_000 } };
  assert.deepEqual(livelyBetween(livelyAt(0, { now: at, history: recent })), []);
});

test('账本满了：第 13 件直接跳过，不再开口', () => {
  const full: LivelyHistory = { ...EMPTY_LIVELY_HISTORY, totalToday: LIVELY_DAILY_CAP };
  for (let slot = 37; slot < 80; slot += 1) {
    assert.deepEqual(livelyBetween(livelyAt(slot, { history: full })), []);
  }
});

test('争执按 3 个世界日冷却：第二、三天不再吵，第四天才可能再吵', () => {
  const cold = [
    { from: 'v0', to: 'v1', trust: LIVELY_AVOID_TRUST - 0.05, warmth: -0.2 },
    { from: 'v1', to: 'v0', trust: LIVELY_AVOID_TRUST - 0.05, warmth: -0.2 },
  ];
  const first = runLivelyDay({ seed: 'quarrel-cool', villagers: [STANDING, STANDING_NEAR], relations: cold });
  assert.ok(
    first.events.some(({ event }) => event.kind === 'street_quarrel'),
    '第一天没有吵起来，冷却测试的前提没成立',
  );
  const carry = (): LivelyHistory => ({
    totalToday: 0,
    settledToday: [],
    quarrelDays: first.history.quarrelDays,
    lastAt: first.history.lastAt,
    todayByVillager: {},
  });
  for (const day of [1, 2]) {
    const next = runLivelyDay({
      seed: 'quarrel-cool', villagers: [STANDING, STANDING_NEAR], relations: cold, day, history: carry(),
    });
    assert.ok(
      !next.events.some(({ event }) => event.kind === 'street_quarrel'),
      `第 ${day} 天又吵了——${LIVELY_QUARREL_COOLDOWN_DAYS} 日冷却没生效`,
    );
  }
  const later = runLivelyDay({
    seed: 'quarrel-cool',
    villagers: [STANDING, STANDING_NEAR],
    relations: cold,
    day: LIVELY_QUARREL_COOLDOWN_DAYS,
    history: carry(),
  });
  assert.ok(
    later.events.some(({ event }) => event.kind === 'street_quarrel'),
    '冷却期满后一天都没再吵，冷却把争执永久关掉了',
  );
});

test('五个人同场：轮转按最近互动，没人整天零互动', () => {
  const five = ['v0', 'v1', 'v2', 'v3', 'v4'].map((id) => ({
    ...STANDING,
    id,
    name: id,
    cell: { x: 10, y: 10 },
  }));
  const run = runLivelyDay({ seed: 'five-way', villagers: five });
  const counts: Record<string, number> = {};
  for (const { event } of run.events) {
    counts[event.actorId] = (counts[event.actorId] ?? 0) + 1;
    counts[event.otherId] = (counts[event.otherId] ?? 0) + 1;
  }
  assert.equal(Object.keys(counts).length, five.length, '五个人里有人一整天没进过任何互动');
  const values = Object.values(counts);
  assert.ok(
    Math.max(...values) - Math.min(...values) <= 4,
    `互动分布差得太多：${JSON.stringify(counts)}`,
  );
});

test('五个人排成一排：只有邻对够得着时，也没人整天零互动', () => {
  // 同一格那条会显不出「距离」：十对全在 2 格以内。这里把人铺开成一条
  // 间距 2 格的街，能互动的只剩四对邻对，谁都不该被挤掉。
  const five = ['v0', 'v1', 'v2', 'v3', 'v4'].map((id, index) => ({
    ...STANDING,
    id,
    name: id,
    cell: { x: 10 + index * 2, y: 10 },
  }));
  const run = runLivelyDay({ seed: 'five-way', villagers: five });
  const counts: Record<string, number> = {};
  const adjacent = new Set(['v0|v1', 'v1|v2', 'v2|v3', 'v3|v4']);
  for (const { event } of run.events) {
    counts[event.actorId] = (counts[event.actorId] ?? 0) + 1;
    counts[event.otherId] = (counts[event.otherId] ?? 0) + 1;
    const pairKey = livelyPairKey(event.actorId, event.otherId);
    assert.ok(adjacent.has(pairKey), `隔着一格以上的 ${pairKey} 也互动了，距离判据没生效`);
  }
  assert.equal(Object.keys(counts).length, five.length, '排成一排时有人一整天零互动');
  const values = Object.values(counts);
  assert.ok(
    Math.max(...values) - Math.min(...values) <= 4,
    `一排站位的互动分布差得太多：${JSON.stringify(counts)}`,
  );
});
