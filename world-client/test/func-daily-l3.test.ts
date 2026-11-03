/**
 * L3 边界与失败：关页面不推进、极端天气叠加安静段、节奏参数与步长边界。
 *
 * 这一层只问「边界上会不会自己长出来、会不会自己坏掉」：
 * - 关掉页面再打开，世界必须停在存档那一刻；等多久都与立刻重开逐字相同；
 * - 一场暴雨盖住整段 12–14 安静段时，安静段不该再有人离场，雨停才回环线；
 * - `?speed=` 的合法值透传、非法值回退，极小正数不能把一世界日算成无穷秒；
 * - `update(0)` 不推进、`update(6000)` 精确推进一步、负步长被拒。
 *
 * 极小倍率那条曾由另一条测试分支记为 BUG-004；现在由
 * `MIN_TIME_SCALE` 下限拒掉，回归为正常断言。期望值没有为了变绿而放宽。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FAST_TIME_SCALE,
  MAX_TIME_SCALE,
  resolveClockSelection,
} from '../src/world/real-clock.ts';
import { worldMinutes } from '../src/world/pace.ts';
import {
  DailyRun,
  DAY_MS,
  PACE,
  STEP_MS,
  dayRealSeconds,
  doorAt,
} from './func-daily-support.ts';

const WORLD_ID = 'func-daily-l3';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 关页面一致性：同一份存档，立刻重开与「等一会儿再重开」必须逐字相同。
 *
 * 判定口径是 `DailyRun.digest()`（世界快照 + 记忆快照整段序列化）；连续再走
 * 200 个逻辑步后仍要逐字相同，增量也必须正好是 200 × 6000ms。
 */
test('L3 关页面不推进：等待期间世界不自己积累，重开从存档断点继续', async () => {
  const closed = new DailyRun({ withMemory: true, worldId: WORLD_ID });
  closed.runTo(DAY_MS + worldMinutes(9 * 60));
  const entriesAtSave = closed.entryCount();
  const save = closed.save();
  const savedNow = save.world.now;

  assert.equal(save.world.memory, closed.memoryJson(), '存档里的记忆应是关页面那一刻的完整快照');
  assert.ok(entriesAtSave > 0, `关页面前应已有记忆条目，实测 ${entriesAtSave} 条`);

  const immediate = new DailyRun({ save, withMemory: true, worldId: WORLD_ID });
  assert.equal(
    immediate.now,
    savedNow,
    `立刻重开应停在存档时刻 ${savedNow}ms，实测 ${immediate.now}ms`,
  );
  assert.equal(
    immediate.entryCount(),
    entriesAtSave,
    `立刻重开应恢复 ${entriesAtSave} 条记忆，实测 ${immediate.entryCount()} 条`,
  );
  const digestOnOpen = immediate.digest();

  await wait(120);

  assert.equal(save.world.now, savedNow, `等待 120ms 期间存档时刻不应变化，实测 ${save.world.now}ms`);

  const delayed = new DailyRun({ save, withMemory: true, worldId: WORLD_ID });
  assert.equal(
    delayed.now,
    savedNow,
    `等待后重开仍应停在存档时刻 ${savedNow}ms（不补算离线），实测 ${delayed.now}ms`,
  );
  assert.equal(
    delayed.digest(),
    digestOnOpen,
    '等待后重开与立刻重开的世界+记忆快照应逐字相同；不等就说明关页面期间世界自己积累了',
  );

  const STEPS = 200;
  immediate.step(STEPS);
  delayed.step(STEPS);

  assert.equal(
    immediate.now,
    savedNow + STEPS * STEP_MS,
    `重开后走 ${STEPS} 步应推进 ${STEPS * STEP_MS}ms，实测 ${immediate.now - savedNow}ms`,
  );
  assert.equal(
    delayed.now,
    immediate.now,
    `两条重开路径走同样步数后时刻应相同，实测 delayed=${delayed.now}ms / immediate=${immediate.now}ms`,
  );
  assert.equal(
    delayed.digest(),
    immediate.digest(),
    '两条重开路径走同样步数后世界+记忆快照应逐字相同（同一种子、同一断点）',
  );
});

/**
 * 极端天气 × 安静段：11:20 之后起的暴雨持续 180 世界分钟，整段盖住 12:00–14:00。
 * 雨把居民拽去屋檐；安静段开始与结束都不该再产生离场；雨停才回环线。
 */
test('L3 极端天气叠加安静段：暴雨盖住整段 12–14 安静段，安静段 0 离场，雨停才回环线', () => {
  const run = new DailyRun();
  // 先在 11:20 之后等到一个「站着」的瞬间再放暴雨：这样暴雨一定产生一次
  // 真实的离场（而不是撞上她本来就在赶路的那一步），且雨停落在 14:20 之后，
  // 整段 12:00–14:00 安静段都盖在雨里。
  run.runToMinute(0, 11 * 60 + 20);
  while (run.villager.walking) run.step();
  const setAt = run.now;
  run.setWeather('storm');
  run.step();

  assert.equal(run.snapshot().weather, 'storm', `暴雨应在 ${setAt}ms 起，实测 ${run.snapshot().weather}`);
  assert.equal(run.villager.mode, 'sheltering', `暴雨时应进入 sheltering，实测 ${run.villager.mode}`);
  assert.equal(run.villager.walking, true, '暴雨开始时应立刻赶路去屋檐，实测 walking=false');
  assert.equal(run.villager.umbrella, true, '暴雨时应显示伞，实测 umbrella=false');
  assert.ok(
    run.villager.routine?.includes('躲雨') === true,
    `暴雨开始时说法应包含「躲雨」，实测 routine=${run.villager.routine}`,
  );

  run.runTo(setAt + worldMinutes(20));
  const arrival = run.arrivals.at(-1);
  assert.ok(arrival !== undefined, '暴雨开始后 20 分钟内应到屋檐，实测没有到站记录');
  if (arrival === undefined) return;
  assert.notEqual(
    doorAt(run.world, arrival.pos),
    undefined,
    `躲雨落点应是某栋楼的门口，实测 (${arrival.pos.x},${arrival.pos.y}) 不是任何门口`,
  );
  assert.ok(
    run.villager.routine?.includes('躲暴雨') === true,
    `到屋檐后的说法应包含「躲暴雨」，实测 routine=${run.villager.routine}`,
  );

  run.runToMinute(0, 12 * 60);
  assert.equal(run.villager.mode, 'idle', `12:00 安静段开始时暴雨未停，应继续停住，实测 ${run.villager.mode}`);
  assert.equal(
    `${run.villager.pos.x},${run.villager.pos.y}`,
    `${arrival.pos.x},${arrival.pos.y}`,
    `12:00 应还在同一个屋檐，实测 (${run.villager.pos.x},${run.villager.pos.y})，到站 (${arrival.pos.x},${arrival.pos.y})`,
  );

  run.runToMinute(0, 13 * 60 + 30);
  assert.equal(run.villager.mode, 'idle', `13:30 仍应在屋檐下，实测 mode=${run.villager.mode}`);
  assert.equal(
    `${run.villager.pos.x},${run.villager.pos.y}`,
    `${arrival.pos.x},${arrival.pos.y}`,
    `13:30 应还在同一个屋檐，实测 (${run.villager.pos.x},${run.villager.pos.y})`,
  );

  run.runToMinute(0, 14 * 60);
  assert.equal(run.snapshot().weather, 'storm', `14:00 安静段结束时暴雨应仍未停，实测 ${run.snapshot().weather}`);
  assert.equal(run.villager.mode, 'idle', `14:00 安静段结束但暴雨未停，仍应停住，实测 mode=${run.villager.mode}`);
  assert.equal(
    `${run.villager.pos.x},${run.villager.pos.y}`,
    `${arrival.pos.x},${arrival.pos.y}`,
    `14:00 不应因安静段结束就离开屋檐，实测 (${run.villager.pos.x},${run.villager.pos.y})`,
  );

  const quietDepartures = run.departures.filter(
    (departure) => departure.minute >= 12 * 60 && departure.minute < 14 * 60,
  );
  assert.equal(
    quietDepartures.length,
    0,
    `安静段（12:00–14:00）离场应为 0 次，实测 ${quietDepartures.length} 次；离场=${JSON.stringify(
      quietDepartures.map((departure) => `${departure.minute}m:${departure.routine}`),
    )}`,
  );
  const stormDeparture = run.departures.find(
    (departure) => departure.at >= setAt && departure.minute < 12 * 60,
  );
  assert.ok(
    stormDeparture?.routine?.includes('躲雨') === true,
    `暴雨应让居民离开环线去躲雨（离场时刻≥${setAt}ms），实测离场=${JSON.stringify(
      run.departures
        .filter((departure) => departure.at >= setAt && departure.minute < 12 * 60)
        .map((departure) => `${departure.minute}m:${departure.routine}`),
    )}`,
  );

  const clearAt = setAt + worldMinutes(PACE.stormMinutes);
  run.runTo(clearAt - STEP_MS);
  assert.equal(
    run.snapshot().weather,
    'storm',
    `雨停前一逻辑步仍应是暴雨，实测 ${run.snapshot().weather}（现在 ${run.now}ms / 雨停 ${clearAt}ms）`,
  );
  assert.equal(run.villager.mode, 'idle', `雨停前一逻辑步仍应停在屋檐，实测 mode=${run.villager.mode}`);

  run.step();
  assert.equal(run.snapshot().weather, 'clear', `暴雨应恰在 ${clearAt}ms 停，实测 ${run.snapshot().weather}`);
  assert.equal(run.villager.walking, true, '雨停后应立刻重新赶路，实测 walking=false');
  assert.equal(run.villager.umbrella, false, '雨停后应收伞，实测 umbrella=true');
  assert.ok(
    run.villager.routine?.includes('祭坛') === true,
    `雨停后应回祭坛，实测 routine=${run.villager.routine}`,
  );
  assert.equal(
    (run.now - setAt) / worldMinutes(1),
    PACE.stormMinutes,
    `一场暴雨应持续 ${PACE.stormMinutes} 世界分钟，实测 ${(run.now - setAt) / worldMinutes(1)} 分钟`,
  );
});

/** `?speed=` 的解析边界：合法值原样透传，非法值回退默认，绝不落到非有限倍率。 */
test('L3 ?speed= 边界：合法值透传、非法值回退默认、倍率始终有限', () => {
  const legal: ReadonlyArray<readonly [string, number]> = [
    ['?speed=0.5', 0.5],
    ['?speed=1', 1],
    ['?speed=%2012%20', 12],
    ['?speed=0x10', 16],
    ['?speed=60', 60],
  ];
  for (const [search, expected] of legal) {
    const selection = resolveClockSelection(search);
    assert.equal(selection.mode, 'accelerated', `${search} 应是加速模式，实测 ${selection.mode}`);
    assert.equal(selection.timeScale, expected, `${search} 的倍率应是 ${expected}，实测 ${selection.timeScale}`);
    assert.ok(
      Number.isFinite(selection.timeScale) &&
        selection.timeScale > 0 &&
        selection.timeScale <= MAX_TIME_SCALE,
      `${search} 解析出的倍率应满足 0 < scale ≤ ${MAX_TIME_SCALE}，实测 ${selection.timeScale}`,
    );
  }

  const illegal = [
    '?speed=0',
    '?speed=-1',
    '?speed=61',
    '?speed=60.0001',
    '?speed=Infinity',
    '?speed=-Infinity',
    '?speed=NaN',
    '?speed=',
    '?speed=abc',
    '?speed=1e309',
    // IEEE754 最小次正规数：仍是正数，但日长会溢出成 Infinity。现在按
    // `MIN_TIME_SCALE` 的下限拒掉，和 0 / 负数 / NaN 走同一条回退路。
    '?speed=5e-324',
  ];
  for (const search of illegal) {
    const selection = resolveClockSelection(search);
    assert.equal(
      selection.timeScale,
      DEFAULT_FAST_TIME_SCALE,
      `非法倍率 ${search} 应回退默认 ${DEFAULT_FAST_TIME_SCALE}，实测 ${selection.timeScale}`,
    );
  }

  assert.equal(dayRealSeconds(MAX_TIME_SCALE), 24 * 60, `倍率 ${MAX_TIME_SCALE} 下一世界日应是 1440 秒，实测 ${dayRealSeconds(MAX_TIME_SCALE)} 秒`);
  assert.equal(dayRealSeconds(1), 24 * 60 * 60, '倍率 1 下一世界日应是 86400 秒');
  assert.equal(dayRealSeconds(0.5), 2 * 24 * 60 * 60, '倍率 0.5 下一世界日应是 172800 秒');
});

/**
 * 极小正数倍率：`5e-324` 是 IEEE754 最小次正规数，只过 `speed > 0` 与
 * `≤ 60` 两道闸时会被接受，但 `DAY_MS / (1000 × 5e-324)` 溢出成 `Infinity`。
 * 现在入口多了 `MIN_TIME_SCALE` 下限：它被拒，回退默认倍率，日长有限可读。
 */
test('L3 ?speed= 极小正数：倍率要么被拒，要么日长有限可读', () => {
  const selection = resolveClockSelection('?speed=5e-324');
  const seconds = dayRealSeconds(selection.timeScale);
  const acceptedExtreme = selection.timeScale !== DEFAULT_FAST_TIME_SCALE;
  const readable = Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER;
  assert.ok(
    !acceptedExtreme || readable,
    `期望极小倍率要么被拒绝（回退 ${DEFAULT_FAST_TIME_SCALE}，实测 timeScale=${selection.timeScale}），` +
      `要么给出有限且 ≤${Number.MAX_SAFE_INTEGER} 秒的日长；实测一世界日=${seconds} 秒`,
  );
});

/** 步长边界：0 不推进、一个逻辑步精确 6000ms、负步长被拒。 */
test('L3 步长边界：update(0) 不推进、update(6000) 精确推进一个逻辑步、负步长被拒', () => {
  const run = new DailyRun();
  run.runToMinute(0, 7 * 60);
  const before = run.snapshot().now;
  const changesBefore = run.changes.length;
  const eventsBefore = run.snapshot().events.length;

  run.sim.update(0);
  assert.equal(
    run.snapshot().now,
    before,
    `update(0) 不应推进世界时间（期望仍为 ${before}ms，实测 ${run.snapshot().now}ms）`,
  );
  assert.equal(
    run.changes.length,
    changesBefore,
    `update(0) 不应产生世界改变（期望 ${changesBefore} 条，实测 ${run.changes.length} 条）`,
  );
  assert.equal(
    run.snapshot().events.length,
    eventsBefore,
    `update(0) 不应产生事件流文本（期望 ${eventsBefore} 条，实测 ${run.snapshot().events.length} 条）`,
  );

  run.sim.update(STEP_MS);
  assert.equal(
    run.snapshot().now - before,
    STEP_MS,
    `update(${STEP_MS}) 应精确推进 ${STEP_MS}ms，实测 ${run.snapshot().now - before}ms`,
  );

  assert.throws(
    () => run.sim.update(-1),
    /deltaMs 不能为负/,
    '负步长应被拒绝（期望抛 deltaMs 不能为负），实测没有抛',
  );
  assert.throws(
    () => run.sim.update(-STEP_MS),
    /deltaMs 不能为负/,
    `update(${-STEP_MS}) 应被拒绝（期望抛 deltaMs 不能为负），实测没有抛`,
  );
});
