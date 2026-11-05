/**
 * L2 跨系统：天气 × 作息、安静段 × 移动、跨日关账 × 记忆/灯油。
 *
 * 这一层不满足于「单个系统自己动了」：它要两侧同时成立——
 * 雨把居民从环线上拽到屋檐下；安静段的移动率显著低于非安静段；
 * 世界日关账后，vitals、记忆条目、灯油三笔账各自有真实增量。
 *
 * 阈值都写成常量并带实测值；没有为了变绿而放宽。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldMinutes } from '../src/world/pace.ts';
import {
  DailyRun,
  DAY_MS,
  LAMP_DRY,
  LAMP_FULL,
  PACE,
  doorAt,
} from './func-daily-support.ts';

/** 安静段移动率的判定阈值：每世界小时离场次数。 */
const QUIET_RATE_MAX = 0.6;
const NONQUIET_RATE_MIN = 1.2;
const RATE_RATIO_MIN = 2;

let sharedTwoDays: DailyRun | undefined;
let entriesAtNight = 0;
let entriesNextMorning = 0;

/**
 * 同一份两天轨迹：连跑 48 小时，第 0 天 23:00 与第 1 天 06:00 各记一次
 * 记忆条目数，终点正好落在第 2 天 00:00，让第 0、1 两个世界日都关账。
 */
function twoDayRun(): DailyRun {
  if (sharedTwoDays === undefined) {
    const run = new DailyRun({ withMemory: true, worldId: 'func-daily-l2' });
    run.runToMinute(0, 23 * 60);
    entriesAtNight = run.entryCount();
    run.runToMinute(1, 6 * 60);
    entriesNextMorning = run.entryCount();
    run.runTo(2 * DAY_MS);
    sharedTwoDays = run;
  }
  return sharedTwoDays;
}

test('L2 下雨：居民离开环线去屋檐，雨停后回到祭坛（可见行为与作息同时成立）', () => {
  const run = new DailyRun();
  run.runToMinute(0, 9 * 60);
  const setAt = run.now;
  run.setWeather('rain');
  run.step();

  assert.equal(run.snapshot().weather, 'rain', `setWeather 后应立刻是 rain，实测 ${run.snapshot().weather}`);
  assert.equal(run.villager.mode, 'sheltering', `下雨时应进入 sheltering，实测 mode=${run.villager.mode}`);
  assert.equal(run.villager.walking, true, '下雨瞬间应在赶路去屋檐，实测 walking=false');
  assert.equal(run.villager.umbrella, true, '下雨时应显示伞，实测 umbrella=false');
  assert.ok(
    run.villager.routine?.includes('躲雨') === true,
    `下雨时的说法应包含「躲雨」，实测 routine=${run.villager.routine}`,
  );

  run.runToMinute(0, 9 * 60 + 20);
  const arrival = run.arrivals.at(-1);
  assert.ok(arrival !== undefined, '下雨后 20 分钟内应至少到站一次，实测没有到站记录');
  if (arrival === undefined) return;
  assert.ok(
    arrival.minute >= 9 * 60 + 5 && arrival.minute <= 9 * 60 + 20,
    `到屋檐应在 09:05–09:20，实测 ${arrival.minute} 分`,
  );
  assert.notEqual(
    doorAt(run.world, arrival.pos),
    undefined,
    `躲雨落点应是某栋楼的门口，实测 (${arrival.pos.x},${arrival.pos.y}) 不是任何门口`,
  );
  assert.equal(run.villager.mode, 'idle', `到屋檐后应停住，实测 mode=${run.villager.mode}`);
  assert.equal(run.villager.walking, false, '到屋檐后不应继续走，实测 walking=true');
  assert.ok(
    run.villager.routine?.includes('看雨') === true,
    `到屋檐后的说法应包含「看雨」，实测 routine=${run.villager.routine}`,
  );
  assert.equal(run.villager.umbrella, true, '站在屋檐下仍应显示伞，实测 umbrella=false');

  run.runToMinute(0, 10 * 60 + 30);
  assert.equal(
    run.villager.mode,
    'idle',
    `10:30 仍在下雨，应继续停住，实测 mode=${run.villager.mode}`,
  );
  assert.equal(
    run.villager.pos.x,
    arrival.pos.x,
    `10:30 应还在同一个屋檐，实测 x=${run.villager.pos.x}，到站 x=${arrival.pos.x}`,
  );
  assert.equal(
    run.villager.pos.y,
    arrival.pos.y,
    `10:30 应还在同一个屋檐，实测 y=${run.villager.pos.y}，到站 y=${arrival.pos.y}`,
  );

  run.runToMinute(0, 11 * 60 - 1);
  assert.equal(run.snapshot().weather, 'rain', `11:00 前一分钟仍应是 rain，实测 ${run.snapshot().weather}`);
  run.runToMinute(0, 11 * 60);
  assert.equal(run.snapshot().weather, 'clear', `雨应恰在 11:00 停，实测 ${run.snapshot().weather}`);
  assert.equal(run.villager.walking, true, '雨停后应立刻重新赶路，实测 walking=false');
  assert.equal(run.villager.umbrella, false, '雨停后应收伞，实测 umbrella=true');
  assert.ok(
    run.villager.routine?.includes('祭坛') === true,
    `雨停后应回祭坛，实测 routine=${run.villager.routine}`,
  );
  assert.equal(
    (run.now - setAt) / worldMinutes(1),
    PACE.rainMinutes,
    `一场雨应持续 ${PACE.rainMinutes} 世界分钟，实测 ${(run.now - setAt) / worldMinutes(1)} 分钟`,
  );
});

test('L2 暴雨：屋檐说法升级为「躲暴雨」，持续 180 世界分钟', () => {
  const run = new DailyRun();
  run.runToMinute(0, 9 * 60);
  const setAt = run.now;
  run.setWeather('storm');
  run.step();

  assert.equal(run.snapshot().weather, 'storm', `setWeather 后应立刻是 storm，实测 ${run.snapshot().weather}`);
  assert.equal(run.villager.mode, 'sheltering', `暴雨时应进入 sheltering，实测 mode=${run.villager.mode}`);
  assert.equal(run.villager.umbrella, true, '暴雨时应显示伞，实测 umbrella=false');

  run.runToMinute(0, 9 * 60 + 15);
  const arrival = run.arrivals.at(-1);
  assert.ok(arrival !== undefined, '暴雨开始后 15 分钟内应到屋檐，实测没有到站记录');
  if (arrival === undefined) return;
  assert.notEqual(
    doorAt(run.world, arrival.pos),
    undefined,
    `暴雨躲雨落点应是某栋楼的门口，实测 (${arrival.pos.x},${arrival.pos.y}) 不是任何门口`,
  );
  assert.ok(
    run.villager.routine?.includes('躲暴雨') === true,
    `暴雨时屋檐说法应包含「躲暴雨」，实测 routine=${run.villager.routine}`,
  );

  run.runToMinute(0, 10 * 60 + 30);
  assert.equal(run.villager.mode, 'idle', `10:30 暴雨未停，应继续停住，实测 mode=${run.villager.mode}`);
  assert.ok(
    run.villager.routine?.includes('躲暴雨') === true,
    `10:30 仍应是「躲暴雨」，实测 routine=${run.villager.routine}`,
  );

  run.runToMinute(0, 12 * 60 - 1);
  assert.equal(run.snapshot().weather, 'storm', `12:00 前一分钟仍应是 storm，实测 ${run.snapshot().weather}`);
  run.runToMinute(0, 12 * 60);
  assert.equal(run.snapshot().weather, 'clear', `暴雨应恰在 12:00 停，实测 ${run.snapshot().weather}`);
  assert.equal(
    (run.now - setAt) / worldMinutes(1),
    PACE.stormMinutes,
    `一场暴雨应持续 ${PACE.stormMinutes} 世界分钟，实测 ${(run.now - setAt) / worldMinutes(1)} 分钟`,
  );
});

test('L2 安静段移动率显著低于非安静段（阈值 0.6 / 1.2 / 2×）', () => {
  const run = twoDayRun();
  const quietCount = run.departures.filter((departure) => departure.quiet).length;
  const nonQuietCount = run.departures.length - quietCount;
  // 两天 × 2 世界小时的安静段；非安静段每天 22 小时。
  const quietRate = quietCount / 2 / 2;
  const nonQuietRate = nonQuietCount / 2 / 22;
  const ratio = nonQuietRate / quietRate;

  assert.ok(
    quietRate <= QUIET_RATE_MAX,
    `安静段离场率应≤${QUIET_RATE_MAX} 次/世界小时，实测 ${quietRate.toFixed(2)}` +
      `（两天共 ${quietCount} 次，安静段总时长 4 世界小时）`,
  );
  assert.ok(
    nonQuietRate >= NONQUIET_RATE_MIN,
    `非安静段离场率应≥${NONQUIET_RATE_MIN} 次/世界小时，实测 ${nonQuietRate.toFixed(2)}` +
      `（两天共 ${nonQuietCount} 次，总时长 44 世界小时）`,
  );
  assert.ok(
    ratio >= RATE_RATIO_MIN,
    `非安静段/安静段移动率应≥${RATE_RATIO_MIN}×，实测 ${ratio.toFixed(2)}×` +
      `（非安静 ${nonQuietRate.toFixed(2)}/h vs 安静 ${quietRate.toFixed(2)}/h）`,
  );
});

test('L2 跨日关账：两个世界日各产出一份 onVitals（world.vitals）', () => {
  const run = twoDayRun();
  assert.ok(
    run.vitals.length >= 2,
    `48 小时应至少关账两次并产出 2 份 vitals，实测 ${run.vitals.length} 份；` +
      `关账日=${JSON.stringify(run.vitals.map((v) => v.day))}`,
  );
  const days = run.vitals.map((vitals) => vitals.day);
  assert.deepEqual(days.slice(0, 2), [0, 1], `前两份 vitals 应对应第 0、1 世界日，实测 ${JSON.stringify(days)}`);
  for (const vitals of run.vitals) {
    assert.ok(
      Number.isFinite(vitals.meanValence) && vitals.meanValence >= -1 && vitals.meanValence <= 1,
      `第 ${vitals.day} 日 meanValence 应在 [-1,1]，实测 ${vitals.meanValence}`,
    );
    assert.ok(
      Number.isFinite(vitals.meanArousal) && vitals.meanArousal >= 0 && vitals.meanArousal <= 1,
      `第 ${vitals.day} 日 meanArousal 应在 [0,1]，实测 ${vitals.meanArousal}`,
    );
    assert.ok(
      Number.isFinite(vitals.infoEntropy) && vitals.infoEntropy >= 0 && vitals.infoEntropy <= 1,
      `第 ${vitals.day} 日 infoEntropy 应在 [0,1]，实测 ${vitals.infoEntropy}`,
    );
    assert.ok(
      Number.isInteger(vitals.isolatedHoldersCount) && vitals.isolatedHoldersCount >= 0,
      `第 ${vitals.day} 日 isolatedHoldersCount 应为非负整数，实测 ${vitals.isolatedHoldersCount}`,
    );
  }
});

test('L2 跨日关账：记忆条目隔夜有真实增量（阈值 +2，实测夜 6 → 晨 9）', () => {
  const run = twoDayRun();
  assert.ok(
    entriesNextMorning - entriesAtNight >= 2,
    `第 0 天 23:00 到第 1 天 06:00 的记忆条目应至少 +2，实测 ${entriesAtNight} → ${entriesNextMorning}` +
      `（增量 ${entriesNextMorning - entriesAtNight}）`,
  );
  assert.ok(
    run.entryCount() >= entriesNextMorning,
    `第 2 天开始时的条目不应少于第 1 天早晨，实测 ${run.entryCount()} < ${entriesNextMorning}`,
  );
});

test('L2 跨日关账：灯油每天烧掉一整盏并在日界添满', () => {
  const run = twoDayRun();
  for (const day of [0, 1]) {
    const burned = run.burnedByDay.get(day);
    assert.ok(burned !== undefined, `第 ${day} 天应有灯油消耗记录，实测没有`);
    if (burned === undefined) continue;
    assert.ok(
      Math.abs(burned - LAMP_FULL) <= 1e-9,
      `第 ${day} 天应烧掉 ${LAMP_FULL} 盏灯油，实测 ${burned}`,
    );
    const minOil = run.minOilByDay.get(day);
    assert.ok(minOil !== undefined, `第 ${day} 天应有灯油余量记录，实测没有`);
    if (minOil === undefined) continue;
    assert.ok(
      minOil <= LAMP_DRY,
      `第 ${day} 天灯油应烧到见底（≤${LAMP_DRY}），实测最低 ${minOil}`,
    );
  }
  assert.equal(
    run.refills,
    2,
    `48 小时应跨两个日界、添两次油，实测 ${run.refills} 次（日界在第 1、2 天 00:00）`,
  );
  assert.equal(
    run.lamp.oil,
    LAMP_FULL,
    `终点刚跨入第 2 天，灯油应已添满为 ${LAMP_FULL}，实测 ${run.lamp.oil}`,
  );
});
