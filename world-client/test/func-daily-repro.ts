/**
 * 另一条测试分支记下的每条日常缺口的最小复现脚本。**不是测试文件**（文件名不带
 * `.test`），不参与 `node --test`，只打印取证读数。
 *
 * 用法（在 `world-client/` 下）：
 *   node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts night
 *   node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts water
 *   node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts narration
 *   node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts speed
 *   node --import ./test/phaser-hooks.mjs test/func-daily-repro.ts rhythm
 */

import {
  DEFAULT_FAST_TIME_SCALE,
  MAX_TIME_SCALE,
  resolveClockSelection,
} from '../src/world/real-clock.ts';
import type { TimetableId } from '../src/world/timetable.ts';
import { worldMinutes } from '../src/world/pace.ts';
import {
  DailyRun,
  DAY_MS,
  dayRealSeconds,
  gridDistance,
  wetWalkableCount,
} from './func-daily-support.ts';

const mode = process.argv[2] ?? 'night';

function night(): void {
  const run = new DailyRun();
  run.runTo(DAY_MS);
  const nightDepartures = run.departures.filter(
    (departure) => departure.minute >= 22 * 60 || departure.minute < 5 * 60,
  );
  console.log(`[night] 22:00–05:00 走动步数=${run.nightWalkingSteps}`);
  console.log(`[night] 22:00–05:00 离场次数=${nightDepartures.length}`);
  for (const departure of nightDepartures) {
    console.log(
      `[night]   ${departure.minute}m 从 (${departure.from.x},${departure.from.y}) 去「${departure.routine}」`,
    );
  }
}

function water(): void {
  const run = new DailyRun();
  run.runTo(DAY_MS);
  const hit = run.beat('wash_bridge');
  console.log(`[water] wash_bridge 命中=${hit === undefined ? '否' : `是（${hit.minute} 分）`}`);
  if (hit === undefined) return;
  const record = hit.changes.find(
    (item) => item.change.change === 'world.event' && item.change.kind === 'daily_water',
  );
  if (record === undefined || record.change.change !== 'world.event') {
    console.log('[water] 该窗口没有 world.event(daily_water)');
    return;
  }
  const where = record.change.where;
  const actor = hit.villager;
  console.log(`[water] 邻水可走格数=${wetWalkableCount(run.world)}`);
  console.log(
    `[water] 落点=(${where.x},${where.y}) 地形=${run.world.grid.at(where)?.terrain ?? '越界'} ` +
      `祭坛=(${run.world.altar.x},${run.world.altar.y})`,
  );
  console.log(
    `[water] 当事人=(${actor.pos.x},${actor.pos.y}) 到落点切比雪夫距离=${gridDistance(actor.pos, where)}`,
  );
  console.log(`[water] 同一窗口旁白=${JSON.stringify(hit.events.map((event) => event.text))}`);
}

function narration(): void {
  const run = new DailyRun();
  run.runTo(DAY_MS);
  const beats: TimetableId[] = ['market_open', 'work_end', 'night_market', 'market_close'];
  for (const id of beats) {
    const hit = run.beat(id);
    if (hit === undefined) {
      console.log(`[narration] ${id} 未被时刻表命中`);
      continue;
    }
    const kinds = hit.changes
      .filter((item) => item.change.change === 'world.event')
      .map((item) => (item.change.change === 'world.event' ? item.change.kind : ''));
    console.log(
      `[narration] ${id}（${hit.minute} 分）world.event=[${kinds.join(', ')}] ` +
        `旁白=${JSON.stringify(hit.events.map((event) => event.text))}`,
    );
  }
}

function rhythm(): void {
  const run = new DailyRun();
  run.runTo(2 * DAY_MS);
  for (const day of [0, 1]) {
    const departures = run.departures.filter(
      (item) => item.at >= day * DAY_MS && item.at < (day + 1) * DAY_MS,
    );
    const nonQuiet = departures.filter((item) => !item.quiet);
    const dwells = run.dwells.filter(
      (item) => item.arriveAt >= day * DAY_MS && item.arriveAt < (day + 1) * DAY_MS,
    );
    console.log(
      `[rhythm] 第 ${day} 天：离场=${departures.length}（非安静段 ${nonQuiet.length}），` +
        `停留=${dwells.length}，停留时长=${JSON.stringify(
          dwells.map((item) => Math.round(item.ms / worldMinutes(1))),
        )}`,
    );
    console.log(
      `[rhythm] 第 ${day} 天离场：${JSON.stringify(
        nonQuiet.map((item) => `${item.minute}m:${item.routine}`),
      )}`,
    );
  }
}

function speed(): void {
  const samples = [
    '5e-324',
    '1e-9',
    '0',
    '-1',
    '0.5',
    '1',
    '60',
    '60.0001',
    '61',
    '0x10',
    ' 12 ',
    'Infinity',
    'NaN',
    '',
    'abc',
    '1e309',
  ];
  for (const raw of samples) {
    const search = `?speed=${encodeURIComponent(raw)}`;
    const selection = resolveClockSelection(search);
    const seconds = dayRealSeconds(selection.timeScale);
    console.log(
      `[speed] ${search} -> timeScale=${selection.timeScale} 一世界日=${seconds} 秒` +
        (selection.timeScale === DEFAULT_FAST_TIME_SCALE && raw !== '60'
          ? `（回退默认 ${DEFAULT_FAST_TIME_SCALE}）`
          : ''),
    );
  }
  console.log(`[speed] 合法上限 MAX_TIME_SCALE=${MAX_TIME_SCALE}`);
}

switch (mode) {
  case 'night':
    night();
    break;
  case 'water':
    water();
    break;
  case 'narration':
    narration();
    break;
  case 'rhythm':
    rhythm();
    break;
  case 'speed':
    speed();
    break;
  default:
    console.error(`未知模式「${mode}」；可用：night / water / narration / speed / rhythm`);
    process.exitCode = 2;
}
