/**
 * L1 单点行为：一名居民在默认世界跑完整的一天。
 *
 * 这一层只问「真的发生了吗」：
 * - 环线：她真的动了、真的停了、每次停多久、最后真的回到了祭坛；
 * - 时刻表：05:00 / 06:00 / 08:00 / 12–14 / 17:00 / 18:00 / 19:00 / 22:00
 *   每一拍各一条，断言**行为**，不是日志里多了一句话。
 *
 * 灯态切换、安静段、每日两件小事、市面四拍与夜间起卧都写成正常断言；
 * 四条缺口在另一条测试分支上原样记过（逐条带最小复现），
 * 期望值一条都没有为了变绿而放宽。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { litLampCountAt } from '../src/world/lamp-street.ts';
import { worldMinutes } from '../src/world/pace.ts';
import type { TimetableId } from '../src/world/timetable.ts';
import type { WorldEventKind } from '../src/world/world-changes.ts';
import { HOME_GOING_LABEL } from '../src/world/homecoming.ts';
import {
  DailyRun,
  DAY_MS,
  LAMP_STREET_LAMP_COUNT,
  PACE,
  gridDistance,
  wetWalkableCount,
} from './func-daily-support.ts';

const GARDEN = { x: 40, y: 40 };
const STREET = { x: 56, y: 33 };

let sharedDay: DailyRun | undefined;

/** 默认世界、一名居民、连跑 24 小时；所有 L1 用例共用这一份轨迹。 */
function dayRun(): DailyRun {
  if (sharedDay === undefined) {
    sharedDay = new DailyRun();
    sharedDay.runTo(DAY_MS);
  }
  return sharedDay;
}

test('L1 日常环线：真的动了、真的停了、停 20–40 分、最后回到祭坛', () => {
  const run = dayRun();
  assert.ok(run.departures.length >= 6, `一天至少应有 6 次离场，实测 ${run.departures.length}`);
  assert.ok(run.arrivals.length >= 6, `一天至少应有 6 次到站，实测 ${run.arrivals.length}`);

  const visited = new Set(run.arrivals.map((arrival) => `${arrival.pos.x},${arrival.pos.y}`));
  for (const [name, at] of [
    ['农田边', GARDEN],
    ['街口', STREET],
    ['祭坛', run.world.altar],
  ] as const) {
    assert.ok(
      visited.has(`${at.x},${at.y}`),
      `一天里应到过${name} (${at.x},${at.y})，实际到站坐标集合=[${[...visited].join(' / ')}]`,
    );
  }
  const altarArrivals = run.arrivals.filter(
    (arrival) => arrival.pos.x === run.world.altar.x && arrival.pos.y === run.world.altar.y,
  );
  assert.ok(
    altarArrivals.length >= 2,
    `一天里应至少两次回到祭坛，实测 ${altarArrivals.length} 次；到站记录=${JSON.stringify(
      run.arrivals.map((a) => `${a.minute}m@${a.pos.x},${a.pos.y}`),
    )}`,
  );

  const steadyDwells = run.dwells.filter((dwell) => !dwell.quietOverlap);
  assert.ok(steadyDwells.length >= 6, `非安静段应有至少 6 次停留，实测 ${steadyDwells.length}`);
  const tolerance = worldMinutes(1);
  const durations = [...new Set(steadyDwells.map((dwell) => Math.round(dwell.ms / worldMinutes(1))))];
  for (const dwell of steadyDwells) {
    assert.ok(
      dwell.ms >= PACE.dwellMinMs - tolerance && dwell.ms <= PACE.dwellMaxMs + tolerance,
      `非安静段每次停留应在 ${PACE.dwellMinMs / worldMinutes(1)}–${
        PACE.dwellMaxMs / worldMinutes(1)
      } 世界分钟，实测 ${dwell.ms / worldMinutes(1)} 分钟（到站 ${dwell.pos.x},${dwell.pos.y}，全部实测值=${durations.join('、')} 分钟）`,
    );
    assert.ok(dwell.label !== null, `到站后应有一个停留说法，实测 label=null（${dwell.pos.x},${dwell.pos.y}）`);
  }

  const first = run.arrivals[0]!;
  const later = run.arrivals.find(
    (arrival) => arrival.pos.x !== first.pos.x || arrival.pos.y !== first.pos.y,
  );
  assert.ok(later !== undefined, '一天里应至少换过一个落点（真的动了），实测始终停在同一个坐标');
});

test('L1 起卧：22:00–05:00 居民应当歇下来，不应继续巡镇', () => {
  const run = dayRun();
  // 口径：回家线在 22:00–05:00 会让她逐格走到自家门口（走到门口才消失），
  // 那几趟是「回家」，不是「巡镇」。期望值仍是 0；只是把合法归家排除在外。
  const nightDepartures = run.departures.filter(
    (departure) => (departure.minute >= 22 * 60 || departure.minute < 5 * 60)
      && departure.routine !== HOME_GOING_LABEL,
  );
  assert.equal(
    run.nightWalkingSteps,
    0,
    `期望 22:00–05:00 除归家外的走动步数=0（起卧），实测 ${run.nightWalkingSteps} 步；判定依据：` +
      '闭市后应回到住处过夜，而不是继续跑农田/街口/祭坛环线',
  );
  assert.equal(
    nightDepartures.length,
    0,
    `期望 22:00–05:00 离场次数=0，实测 ${nightDepartures.length} 次；` +
      `夜间离场=${JSON.stringify(nightDepartures.map((d) => `${d.minute}m:${d.routine}`))}`,
  );
});

test('L1 05:00 收灯：灯街从 28 盏亮切到 0 盏，是真行为不是旁白', () => {
  const run = dayRun();
  const hit = run.beat('lamps_out');
  assert.ok(hit !== undefined, '05:00 收灯这一拍没有被时刻表命中');
  if (hit === undefined) return;
  const before = litLampCountAt(hit.beforeNow, 'night', LAMP_STREET_LAMP_COUNT);
  const after = litLampCountAt(hit.at, 'night', LAMP_STREET_LAMP_COUNT);
  assert.equal(before, LAMP_STREET_LAMP_COUNT, `05:00 前一帧应亮 ${LAMP_STREET_LAMP_COUNT} 盏，实测 ${before} 盏`);
  assert.equal(after, 0, `05:00 这一帧应灭到 0 盏，实测 ${after} 盏（灯态谓词未随时刻表切换）`);
  assert.ok(
    hit.events.some((event) => event.text.includes('街灯')),
    `05:00 应有收灯的说法，实测事件=${JSON.stringify(hit.events.map((e) => e.text))}`,
  );
});

test('L1 06:00 打水：人应真的到水边，落点也不该退化成祭坛', () => {
  const run = dayRun();
  const hit = run.beat('wash_bridge');
  assert.ok(hit !== undefined, '06:00 打水这一拍没有被时刻表命中');
  if (hit === undefined) return;
  const change = hit.changes.find(
    (record) => record.change.change === 'world.event' && record.change.kind === 'daily_water',
  )?.change;
  if (change === undefined || change.change !== 'world.event') {
    assert.fail('06:00 应落成一条 world.event(daily_water)，实测该窗口没有这条改变');
    return;
  }
  const wetCount = wetWalkableCount(run.world);
  assert.ok(
    wetCount > 0,
    `期望默认世界至少有 1 个邻水可走格，实测 ${wetCount} 个；没有水边就无法真的去桥边打水`,
  );
  const terrain = run.world.grid.at(change.where)?.terrain ?? '越界';
  assert.notEqual(
    `${change.where.x},${change.where.y}`,
    `${run.world.altar.x},${run.world.altar.y}`,
    `期望打水落点不是祭坛，实测落点=(48,36)（与祭坛同坐标，地形=${terrain}）；台词却写「去桥边打水」`,
  );
  const actor = hit.villager;
  const distance = gridDistance(actor.pos, change.where);
  assert.ok(
    distance <= 2,
    `期望当事人到水边的切比雪夫距离≤2，实测 ${distance} 格（当事人在 ${actor.pos.x},${actor.pos.y}，落点 ${change.where.x},${change.where.y}）；` +
      '判定依据：每日小事应让当事人走到落点，而不是只把一句话记在世界账上',
  );
});

test('L1 08:00 开市：应有可见的开门动作，不只是「早市开了」这句话', () => {
  expectBeatEvent('market_open', 'market_open');
});

test('L1 12–14 安静：只回锚点一次就坐住，不在镇上反复走', () => {
  const run = dayRun();
  const quietDepartures = run.departures.filter((departure) => departure.quiet);
  assert.ok(
    quietDepartures.length <= 2,
    `安静段（12:00–14:00）离场应≤2 次，实测 ${quietDepartures.length} 次；离场=${JSON.stringify(
      quietDepartures.map((d) => `${d.minute}m:${d.routine}`),
    )}`,
  );
  for (const departure of quietDepartures) {
    assert.ok(
      departure.routine?.includes('祭坛') === true,
      `安静段只应回锚点（祭坛），实测算 ${departure.minute}m 离场去「${departure.routine}」`,
    );
  }
  assert.equal(
    run.departures.filter((departure) => departure.minute > 12 * 60 + 30 && departure.minute < 14 * 60)
      .length,
    0,
    `安静段 12:30 之后不应再离场，实测 ${JSON.stringify(
      run.departures
        .filter((d) => d.minute > 12 * 60 + 30 && d.minute < 14 * 60)
        .map((d) => `${d.minute}m:${d.routine}`),
    )}`,
  );
  const quietDwells = run.dwells.filter((dwell) => dwell.quietOverlap);
  const anchored = quietDwells.find((dwell) => dwell.ms >= PACE.quietDwellMs);
  assert.ok(
    anchored !== undefined,
    `期望至少有一次跨安静段的停留≥${PACE.quietDwellMs / worldMinutes(1)} 世界分钟，实测安静段停留=${JSON.stringify(
      quietDwells.map((d) => `${d.pos.x},${d.pos.y}:${d.ms / worldMinutes(1)}m`),
    )}`,
  );
});

test('L1 17:00 收工：街上的活应停下来，不只是钟响了一句', () => {
  expectBeatEvent('work_end', 'work_end');
});

test('L1 18:00 点灯：灯街从 0 盏亮到 28 盏，并落成一条 world.event', () => {
  const run = dayRun();
  const hit = run.beat('light_lamps');
  assert.ok(hit !== undefined, '18:00 点灯这一拍没有被时刻表命中');
  if (hit === undefined) return;
  const before = litLampCountAt(hit.beforeNow, 'night', LAMP_STREET_LAMP_COUNT);
  const after = litLampCountAt(hit.at, 'night', LAMP_STREET_LAMP_COUNT);
  assert.equal(before, 0, `18:00 前一帧灯街应全灭，实测 ${before} 盏`);
  assert.equal(after, LAMP_STREET_LAMP_COUNT, `18:00 这一帧应亮 ${LAMP_STREET_LAMP_COUNT} 盏，实测 ${after} 盏`);
  const dailyLamp = hit.changes.filter(
    (record) => record.change.change === 'world.event' && record.change.kind === 'daily_lamp',
  );
  assert.equal(dailyLamp.length, 1, `18:00 应落成 1 条 world.event(daily_lamp)，实测 ${dailyLamp.length} 条`);
  const event = dailyLamp[0]?.change;
  if (event === undefined || event.change !== 'world.event') {
    assert.fail('18:00 的 daily_lamp 改变没有 world.event 载荷');
    return;
  }
  assert.ok(event.actorId !== null, '点灯这件小事应有一个当事人，实测 actorId=null');
});

test('L1 19:00 夜市：应有人/摊子真的动起来，不只是「灯下有人走动」', () => {
  expectBeatEvent('night_market', 'night_market');
});

test('L1 22:00 闭市：应落成闭市改变并让镇子歇下来，不只是「市面闭了」', () => {
  const run = dayRun();
  // 口径：22:00 那一刻的「回家」是闭市的结果（人往家走），不是「市面还开着」。
  // 期望值仍是 0；只把 `routine = 回家` 这一趟排除。
  const afterClose = run.departures.filter(
    (departure) => departure.minute >= 22 * 60 && departure.routine !== HOME_GOING_LABEL,
  );
  expectBeatEvent('market_close', 'market_close');
  assert.equal(
    afterClose.length,
    0,
    `期望 22:00 后离场次数=0（闭市后歇业），实测 ${afterClose.length} 次；离场=${JSON.stringify(
      afterClose.map((d) => `${d.minute}m:${d.routine}`),
    )}`,
  );
});

/**
 * 期望的拍事件种类：已接通的四类来自 world-changes 的闭集，另外四拍是
 * BUG-003 里「应当有、实际没有」的种类，故意写在这里而不是放宽成 string。
 */
type ExpectedBeatKind =
  | WorldEventKind
  | 'market_open'
  | 'work_end'
  | 'night_market'
  | 'market_close';

/** 拍窗口里应出现指定种类的 world.event；没有就是「只写了日志」。 */
function expectBeatEvent(beat: TimetableId, expectedKind: ExpectedBeatKind): void {
  const run = dayRun();
  const hit = run.beat(beat);
  assert.ok(hit !== undefined, `${beat} 这一拍没有被时刻表命中`);
  if (hit === undefined) return;
  const actualKinds: string[] = hit.changes
    .filter((record) => record.change.change === 'world.event')
    .map((record) => (record.change.change === 'world.event' ? record.change.kind : ''));
  assert.ok(
    actualKinds.includes(expectedKind),
    `期望 ${hit.minute} 分的「${beat}」有可见行为并落成 world.event(kind=${expectedKind})，` +
      `实测该窗口 world.event 种类=[${actualKinds.join(', ')}]；` +
      `同一窗口的 info 旁白=${JSON.stringify(hit.events.map((event) => event.text))}`,
  );
  assert.ok(
    hit.events.length > 0,
    `期望 ${beat} 至少有可读的事件流文本，实测 0 条`,
  );
}
