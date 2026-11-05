/**
 * 需求层第二版：疲劳与睡眠。
 *
 * 钉五件事：
 *   1. 读数是纯值对象：清醒时只由「世界时刻 / 上次睡醒」决定，睡着时只由
 *      「入睡时刻 + 入睡疲劳」决定；
 *   2. 速率与衰减率是可枚举常量，跨阈时刻与醒来时刻都能手算；
 *   3. 跨阈 → 就地睡下 → 醒来，完整回路只发生一次，醒来读数回到 0、牌子撤掉；
 *   4. 睡着期间走位不动、状态只用已有字段（`routineLabel` / 决策 `kind`）；
 *   5. 不落档：存档里不出现疲劳读数、上一次睡醒、睡眠段。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import {
  NEEDS_FATIGUE_PER_DAY,
  NEEDS_SLEEP_CROSS_MS,
  NEEDS_SLEEP_DECAY_PER_DAY,
  NEEDS_SLEEP_THRESHOLD,
  NEEDS_WAKE_THRESHOLD,
  fatigueAt,
  fatigueReadingOf,
  sleepCrossedAtMs,
  wakeUpAtMs,
} from '../src/world/fatigue.ts';

const CROSS_DAYS = NEEDS_SLEEP_THRESHOLD / NEEDS_FATIGUE_PER_DAY;
const SLEEP_DAYS = NEEDS_SLEEP_THRESHOLD / NEEDS_SLEEP_DECAY_PER_DAY;

function makeSim(initialNow = 0): Simulation {
  return new Simulation({
    grid: new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [] }),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    villagerNames: ['莞尔'],
    wallClock: () => 1000,
    initialNow,
  });
}

/** 设定集自带作息的世界：`villagerProfiles` 一给，`hasExplicitRoutine === true`。 */
function makeExplicitRoutineSim(initialNow = 0): Simulation {
  return new Simulation({
    grid: new WorldGrid({ width: 12, height: 10, border: 1, zones: [], regions: [] }),
    buildings: [],
    altar: { x: 2, y: 2 },
    villagerName: '莞尔',
    villagerNames: ['莞尔'],
    wallClock: () => 1000,
    initialNow,
    villagerProfiles: [
      {
        at: { x: 2, y: 2 },
        routine: [{ id: 'promenade', label: '去街口', going: '去街口', target: { x: 8, y: 5 }, dwellMs: 300 }],
      },
    ],
  });
}

test('疲劳读数是纯值对象：同一对数永远算出同一个值', () => {
  assert.equal(fatigueAt(0, 0), 0);
  assert.equal(fatigueAt(DAY_MS, 0), NEEDS_FATIGUE_PER_DAY);
  assert.equal(fatigueAt(10, 20), 0, '时钟往回拨也不能出现负疲劳');
  assert.equal(fatigueAt(10 * DAY_MS, 0), 1, '封顶在 1');
  assert.deepEqual(fatigueReadingOf(0, 0), { fatigue: 0, sleepy: false, asleep: false });
  assert.equal(fatigueReadingOf(NEEDS_SLEEP_CROSS_MS, 0).sleepy, true);
});

test('睡眠读数是纯值对象：睡着后只看入睡时刻与入睡疲劳', () => {
  const span = { startedAtMs: 1000, fatigueAtStart: NEEDS_SLEEP_THRESHOLD };
  assert.equal(fatigueAt(1000, 0, span), NEEDS_SLEEP_THRESHOLD);
  assert.equal(fatigueAt(1000 + SLEEP_DAYS * DAY_MS / 2, 0, span), NEEDS_SLEEP_THRESHOLD / 2);
  assert.equal(fatigueAt(1000 + SLEEP_DAYS * DAY_MS, 0, span), 0);
  assert.equal(fatigueAt(1000 + 10 * DAY_MS, 0, span), 0, '睡过头也不会变成负的');
  assert.equal(fatigueReadingOf(1000, 0, span).asleep, true);
  assert.equal(fatigueReadingOf(1000, 0, span).sleepy, false, '睡着时 sleepy 不参与判定');
});

test('速率与衰减率可枚举：跨阈 1.6 天、睡 0.2 天，都能手算', () => {
  assert.equal(NEEDS_FATIGUE_PER_DAY, 1 / 2);
  assert.equal(NEEDS_SLEEP_DECAY_PER_DAY, 4);
  assert.equal(NEEDS_SLEEP_THRESHOLD, 0.8);
  assert.equal(NEEDS_WAKE_THRESHOLD, 0);
  assert.ok(Math.abs(CROSS_DAYS - 1.6) < 1e-9, `跨阈日数应为 1.6，实际 ${CROSS_DAYS}`);
  assert.ok(Math.abs(SLEEP_DAYS - 0.2) < 1e-9, `睡眠段应为 0.2 个世界日，实际 ${SLEEP_DAYS}`);
  assert.equal(sleepCrossedAtMs(1000), 1000 + NEEDS_SLEEP_CROSS_MS);
  assert.equal(
    wakeUpAtMs({ startedAtMs: 1000, fatigueAtStart: NEEDS_SLEEP_THRESHOLD }),
    1000 + SLEEP_DAYS * DAY_MS,
  );
  // 冻结的 50 小时轨迹（约 2.08 个世界日）**会**跨过 1.6 天——本轮指纹因此变，
  // 这是改行为的必然，不是扭逻辑去保住旧指纹。
  assert.ok(CROSS_DAYS * DAY_MS < 50 * 60 * 60 * 1000, '50 小时轨迹里必然会跨阈');
});

test('跨阈 → 就地睡下 → 醒来：完整回路一次，醒来回正常', () => {
  // 开局刚跨过 1.6 天，而「上次睡醒」记在第 0 天：开局即困（疲劳 0.8）。
  const sim = makeSim(Math.ceil(CROSS_DAYS * DAY_MS));
  const villagerId = sim.snapshot().villagers[0]!.id;
  sim.setLastRestAt(villagerId, 0);
  const reading = sim.fatigueOf(villagerId)!;
  assert.equal(reading.sleepy, true, '开局就该困了');
  assert.ok(reading.fatigue >= NEEDS_SLEEP_THRESHOLD);

  const startPos = sim.snapshot().villagers[0]!.pos;
  sim.setDecisionLogEnabled(true);

  const rules: string[] = [];
  let sleptAt: number | null = null;
  let wokeAt: number | null = null;
  let parkedPos: typeof startPos | null = null;
  let parkedLabel: string | null = null;
  const report = () => sim.sleepReport();

  for (let index = 0; index < 10000 && wokeAt === null; index += 1) {
    sim.update(2000);
    for (const record of sim.drainDecisions()) rules.push(record.rule);
    if (report().spans.length > 0) {
      sleptAt = report().spans[0]!.sleptAt;
      if (parkedPos === null && report().spans[0]!.wokeAt === null) {
        // 还在睡的这一拍：人没动、牌子是那句「就地睡下了」。
        const villager = sim.snapshot().villagers[0]!;
        parkedPos = villager.pos;
        parkedLabel = villager.routine;
      }
      wokeAt = report().spans[0]!.wokeAt;
    }
  }

  assert.equal(report().crossings, 1, '一次跨阈只该睡一次');
  const span = report().spans[0]!;
  assert.equal(span.crossedAt, sleepCrossedAtMs(0), '跨阈时刻按「上次睡醒 + 阈值/速率」算');
  assert.equal(span.sleptAt, sleptAt);
  assert.ok(span.wokeAt !== null, '没醒来');
  assert.ok(span.crossedAt <= span.sleptAt, '入睡不会早于跨阈');
  const sleptMs = span.wokeAt! - span.sleptAt;
  assert.ok(
    Math.abs(sleptMs - SLEEP_DAYS * DAY_MS) <= 4000,
    `睡眠段应约 ${SLEEP_DAYS} 个世界日（±2 拍），实际 ${sleptMs}ms`,
  );

  // 睡着期间：人不动、牌子是那句「就地睡下了」（只用已有字段）。
  assert.deepEqual(parkedPos, startPos, '睡着时不该走动');
  assert.equal(parkedLabel, '实在熬不住，就地睡下了');
  // 一级判据：睡着的决策 kind 是 sleep，且只记一条（不是每拍一条）。
  assert.equal(rules.filter((rule) => rule === 'sleep').length, 1, '一整段觉只该记一条 sleep 决策');
  assert.notEqual(rules[rules.length - 1], 'sleep', '醒来后应回到正常规则');

  // 醒来回正常：读数 0、牌子换回正常（不是那句睡觉的话）、不再跨阈。
  assert.equal(sim.fatigueOf(villagerId)!.fatigue, 0, '醒来读数该回 0');
  assert.equal(sim.fatigueOf(villagerId)!.asleep, false);
  assert.notEqual(sim.snapshot().villagers[0]!.routine, '实在熬不住，就地睡下了');
  for (let index = 0; index < 10; index += 1) sim.update(2000);
  assert.equal(sim.sleepReport().crossings, 1, '醒来后不该立刻又睡');
  assert.equal(sim.goalInterruptCount(), 0, '睡觉不该触发打断');
});

test('设定集自带作息的世界里疲劳睡不触发：两套睡眠同一个开关', () => {
  // 同一对数、同样的「上次睡醒」：默认世界会跨阈，设定集世界不该跨。
  const explicit = makeExplicitRoutineSim(Math.floor(2.0 * DAY_MS));
  const id = explicit.snapshot().villagers[0]!.id;
  explicit.setLastRestAt(id, 0);
  explicit.setDecisionLogEnabled(true);
  for (let index = 0; index < 20; index += 1) explicit.update(2000);
  assert.equal(explicit.sleepReport().crossings, 0, '设定集世界里疲劳睡不该跨阈');
  assert.equal(explicit.sleepReport().spans.length, 0);
  assert.equal(explicit.fatigueOf(id)!.asleep, false);
});

test('疲劳读数不落档，也没有新增字段', () => {
  const sim = makeSim(Math.floor(1.7 * DAY_MS));
  const villagerId = sim.snapshot().villagers[0]!.id;
  sim.setLastRestAt(villagerId, 0);
  sim.update(2000);
  assert.equal(sim.fatigueOf(villagerId)!.asleep, true, '这一拍应当已经睡下');

  const save = JSON.stringify(sim.toSave());
  for (const word of ['fatigue', 'lastRest', 'asleep', 'sleepLog', 'sleepSpan']) {
    assert.equal(save.includes(word), false, `存档里不该出现 ${word}`);
  }
  // 已有字段照旧：牌子会存（`routineLabel` 本来就是存档字段），不是新增字段。
  assert.equal(save.includes('routineLabel'), true);
});
