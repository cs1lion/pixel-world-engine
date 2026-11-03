/**
 * 固定时刻表：世界自己走到几点，以及两件已经接通的每日小事。
 *
 * 这一组钉四件事：
 * 1. 时刻表按**世界日分钟**算，跨日也照付；
 * 2. 12:00–14:00 是安静段，居民回锚点坐着；
 * 3. 06:00 打水、18:00 点灯各自落成一条 `world.event`（世界改变）；
 * 4. 同一条改变能被 `observe.ts` 翻译成记忆条目——两条链路都通。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { worldMinutes } from '../src/world/pace.ts';
import {
  TIMETABLE,
  beatsBetween,
  isQuietAt,
  minuteOfDay,
} from '../src/world/timetable.ts';
import { routineFor, routineBeats } from '../src/world/routines.ts';
import { observationOf } from '../src/world/memory/observe.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

function makeSim(initialNow = 0): { sim: Simulation; changes: WorldChange[] } {
  const world = buildWorld(blueprints);
  const changes: WorldChange[] = [];
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    initialNow,
    onChange: (change) => changes.push(change),
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
  return { sim, changes };
}

/** 模拟默认倍率 60 下的一拍：100ms 逻辑步 × 60 = 6 世界秒。 */
const STEP_MS = 6000;

test('时刻表覆盖 05:00–22:00 的十一个节点，顺序单调', () => {
  assert.deepEqual(
    TIMETABLE.map((beat) => beat.id),
    [
      'lamps_out', 'wash_bridge', 'market_open', 'tea_talk', 'quiet_start', 'quiet_end',
      'work_end', 'light_lamps', 'night_market', 'pack_up', 'market_close',
    ],
  );
  const minutes = TIMETABLE.map((beat) => beat.minuteOfDay);
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b), '时刻表必须按一天里的先后排');
});

test('05:00 收灯与 18:00 点灯各一条，语义对称', () => {
  const out = TIMETABLE.filter((beat) => beat.id === 'lamps_out');
  const lit = TIMETABLE.filter((beat) => beat.id === 'light_lamps');
  assert.equal(out.length, 1, '05:00 收灯只能有一条');
  assert.equal(lit.length, 1, '18:00 点灯只能有一条');
  assert.equal(out[0]!.minuteOfDay, 300, '05:00 = 第 300 分钟');
  assert.equal(lit[0]!.minuteOfDay, 1080, '18:00 = 第 1080 分钟');
  assert.match(out[0]!.text, /收/, '文案必须真的是「收灯」');
  assert.doesNotMatch(out[0]!.text, /亮起来/, '不能把收灯写成点灯');
  // 收灯只切渲染谓词，不是每日小事——不开新的 world.event 白名单。
  assert.equal(out[0]!.chore, null, '收灯不落世界事件');
});

test('分钟口径：06:00 是第 360 分钟，安静段是 [720, 840)', () => {
  assert.equal(minuteOfDay(worldMinutes(6 * 60)), 360);
  assert.equal(minuteOfDay(worldMinutes(22 * 60)), 1320);
  assert.equal(minuteOfDay(DAY_MS - 1), 1439);
  assert.equal(isQuietAt(worldMinutes(12 * 60)), true);
  assert.equal(isQuietAt(worldMinutes(13 * 60)), true);
  assert.equal(isQuietAt(worldMinutes(14 * 60)), false, '右开，14:00 已经不是安静段');
  assert.equal(isQuietAt(worldMinutes(11 * 60)), false);
});

test('跨过的节拍：左开右闭，跨日也照付', () => {
  const at6 = beatsBetween(worldMinutes(6 * 60) - STEP_MS, worldMinutes(6 * 60));
  assert.deepEqual(at6.map((beat) => beat.id), ['wash_bridge']);
  // 不跨就不报。
  assert.deepEqual(beatsBetween(worldMinutes(6 * 60), worldMinutes(6 * 60) + 1), []);
  // 跨日：前一天 22:00 之后到第二天 05:00。第二天 05:00 是新加的收灯节拍。
  assert.deepEqual(
    beatsBetween(worldMinutes(23 * 60), DAY_MS + worldMinutes(5 * 60)).map((beat) => beat.id),
    ['lamps_out'],
  );
  // 大步长跨日时，第二天已经越过的节拍要补上。
  assert.deepEqual(
    beatsBetween(worldMinutes(23 * 60), DAY_MS + worldMinutes(9 * 60)).map((beat) => beat.id),
    ['lamps_out', 'wash_bridge', 'market_open'],
  );
  // 05:00 这一拍本身也拿得到（左开右闭）。
  const at5 = beatsBetween(DAY_MS + worldMinutes(5 * 60) - STEP_MS, DAY_MS + worldMinutes(5 * 60));
  assert.deepEqual(at5.map((beat) => beat.id), ['lamps_out']);
});

test('安静段：作息回锚点坐着，停满 40 世界分钟', () => {
  const beats = routineBeats(ALTAR, buildWorld(blueprints).grid);
  const quiet = routineFor('clear', beats, 2, 0.5, null, true);
  assert.deepEqual(quiet.target, beats[0]!.target, '安静段回锚点');
  assert.equal(quiet.label, beats[0]!.label, '说法也借锚点，不另编一句');
  assert.equal(quiet.dwellMs, worldMinutes(40));
});

test('06:00 打水与 18:00 点灯：世界改变 + 记忆条目两条链路', () => {
  const water = makeSim(worldMinutes(6 * 60) - STEP_MS);
  water.sim.update(STEP_MS);
  const waterEvents = water.changes.filter(
    (change): change is Extract<WorldChange, { change: 'world.event' }> =>
      change.change === 'world.event' && change.kind === 'daily_water',
  );
  assert.equal(waterEvents.length, 1, '06:00 应当落成一条打水');
  assert.match(waterEvents[0]!.text, /打水/);
  assert.notEqual(waterEvents[0]!.actorId, null, '日常小事有当事人，否则她自己记不住');

  const lamp = makeSim(worldMinutes(18 * 60) - STEP_MS);
  lamp.sim.update(STEP_MS);
  const lampEvents = lamp.changes.filter(
    (change): change is Extract<WorldChange, { change: 'world.event' }> =>
      change.change === 'world.event' && change.kind === 'daily_lamp',
  );
  assert.equal(lampEvents.length, 1, '18:00 应当落成一条点灯');
  assert.match(lampEvents[0]!.text, /点亮/);

  // 第二条链路：同一条世界改变能被翻译成记忆条目。位置由世界给，不由这里编。
  const observed = observationOf(waterEvents[0]!, 'ev_water_1', {
    atOfHolder: () => undefined,
    atOfBuilding: () => undefined,
    buildingOfTask: () => undefined,
  });
  assert.notEqual(observed, null);
  assert.equal(observed!.kind, 'daily_water');
  assert.deepEqual(observed!.at, waterEvents[0]!.where);
  assert.deepEqual(observed!.actors, [waterEvents[0]!.actorId]);
  assert.match(String(observed!.outcome.what), /打水/);
});

test('其余节拍只写旁白，不假装做成世界改变', () => {
  const { sim, changes } = makeSim(worldMinutes(8 * 60) - STEP_MS);
  sim.update(STEP_MS);
  assert.equal(
    changes.filter(
      (change) =>
        change.change === 'world.event' &&
        (change.kind === 'daily_water' || change.kind === 'daily_lamp'),
    ).length,
    0,
    '08:00 开市还没接具体动作，只能有旁白（环境事件另算）',
  );
});
