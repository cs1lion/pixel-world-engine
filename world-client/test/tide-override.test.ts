import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TIDE_OVERRIDE_MAX_MS,
  effectiveTideLevel,
  isOverrideActive,
  makeTideOverride,
  tideLevelAt,
  tideOverrideRejection,
  tideView,
} from '../src/world/tide.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, buildWorldFromSave, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { WorldSave } from '../src/world/save.ts';

/** #14：潮位覆盖与三档天气。
 *
 * 潮汐本来是 `now` 的纯函数，可确定性回放靠的就是这一条。这一组测试钉的是
 * **覆盖没有毁掉它**：覆盖只在有效期内改「结果」，过期就自动回到曲线，
 * 而且覆盖自己进存档、读回来还是同一条曲线。
 */

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

// ---------------------------------------------------------------- 纯函数

test('没有覆盖时，有效潮位就是纯函数曲线', () => {
  for (const now of [0, 60_000, 200_000, 1_000_000]) {
    assert.equal(effectiveTideLevel(now, null), tideLevelAt(now));
  }
});

test('覆盖期内按覆盖走，过期那一刻回到曲线', () => {
  const override = makeTideOverride(0.9, 30_000, 100_000);
  assert.equal(override.until, 130_000);

  assert.equal(effectiveTideLevel(100_000, override), 0.9, '刚拨下去就生效');
  assert.equal(effectiveTideLevel(129_999, override), 0.9, '到期前一刻还算数');
  assert.equal(
    effectiveTideLevel(130_000, override),
    tideLevelAt(130_000),
    '到期那一刻就回到节律——边界用 >= 不用 >，否则会多压一毫秒',
  );
  assert.equal(isOverrideActive(130_000, override), false);
});

test('时长超上限被拒，不是被夹到上限', () => {
  // 夹住会让「拨 10 分钟」变成「拨了 2 分钟」而回执说成功——世界做了件别的事。
  assert.equal(tideOverrideRejection(0.5, 10 * 60_000), 'duration-too-long');
  assert.equal(tideOverrideRejection(0.5, TIDE_OVERRIDE_MAX_MS), null, '正好等于上限是合法的');
});

test('零或负时长、越界潮位各有各的拒绝码', () => {
  assert.equal(tideOverrideRejection(0.5, 0), 'duration-not-positive');
  assert.equal(tideOverrideRejection(0.5, -1), 'duration-not-positive');
  assert.equal(tideOverrideRejection(0.5, Number.NaN), 'duration-not-positive');
  assert.equal(tideOverrideRejection(1.5, 1000), 'level-out-of-range');
  assert.equal(tideOverrideRejection(-0.1, 1000), 'level-out-of-range');
  assert.equal(tideOverrideRejection(Number.NaN, 1000), 'level-out-of-range');
  assert.equal(tideOverrideRejection(0, 1), null, '两个端点都合法');
  assert.equal(tideOverrideRejection(1, 1), null);
});

test('潮汐一栏在被压住时说出来，而不是假装一切正常', () => {
  const override = makeTideOverride(0.5, 30_000, 1000);
  const view = tideView(2000, override, 0.1);
  assert.equal(view.overridden, true);
  assert.equal(view.level, 0.5);
  assert.ok(view.label.includes('拨'), `被压住时要说出来，实际：${view.label}`);

  const free = tideView(2000, null, 0.1);
  assert.equal(free.overridden, false);
  assert.equal(free.level, tideLevelAt(2000));
});

// ---------------------------------------------------------------- 命令

test('命令拨潮水：世界立刻按新潮位走', () => {
  const sim = makeSim();
  const before = sim.snapshot().tide.level;
  sim.enqueue({ kind: 'setTideLevel', level: 1, durationMs: 30_000 });
  const result = sim.update(16);
  assert.equal(result[0]?.ok, true);
  const tide = sim.snapshot().tide;
  assert.equal(tide.level, 1);
  assert.equal(tide.overridden, true);
  assert.notEqual(before, 1, '初始不该正好是满潮，否则这条断言没有意义');
});

test('覆盖到期后潮位回到纯函数，且同一存档回放出同一条曲线', () => {
  const a = makeSim();
  const b = makeSim();
  const steps = [16, 100, 250, 1000, 5000, 16, 800, 100];
  const run = (sim: Simulation): number[] => {
    sim.enqueue({ kind: 'setTideLevel', level: 0.8, durationMs: 1000 });
    return steps.map((ms) => {
      sim.update(ms);
      return sim.snapshot().tide.level;
    });
  };
  const curveA = run(a);
  const curveB = run(b);
  assert.deepEqual(curveA, curveB, '同样的命令与步长，曲线逐拍一致');

  // 覆盖早该过期了：最后几拍的潮位必须来自纯函数。
  assert.equal(a.snapshot().tide.overridden, false);
  assert.equal(a.snapshot().tide.level, tideLevelAt(a.snapshot().now));
});

test('覆盖进存档，读回来还在压着', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setTideLevel', level: 0.25, durationMs: 45_000 });
  sim.update(16);
  const save = sim.toSave();
  const now = sim.snapshot().now;
  assert.deepEqual(save.world.tideOverride, { level: 0.25, until: now + 45_000 });

  // 读档后时间不前进：覆盖应该照旧有效。
  const rebuilt = buildWorldFromSave(save.world.buildings, blueprints);
  const loaded = Simulation.fromSave(
    JSON.parse(JSON.stringify(save)) as WorldSave,
    {
      grid: rebuilt.grid,
      buildings: rebuilt.buildings,
      altar: ALTAR,
      villagerName: '莞尔',
    },
  );
  const tide = loaded.snapshot().tide;
  assert.equal(tide.overridden, true);
  assert.equal(tide.level, 0.25, '读档后仍然按覆盖走，不会突然跳回曲线');
});

test('过期的覆盖留在存档里也无害：读的时候判', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setTideLevel', level: 0.9, durationMs: 1000 });
  for (let i = 0; i < 20; i += 1) sim.update(100);
  const save = sim.toSave();
  assert.ok(save.world.tideOverride !== null, '字段还在——世界不靠删字段来"过期"');

  const rebuilt = buildWorldFromSave(save.world.buildings, blueprints);
  const loaded = Simulation.fromSave(
    JSON.parse(JSON.stringify(save)) as WorldSave,
    { grid: rebuilt.grid, buildings: rebuilt.buildings, altar: ALTAR, villagerName: '莞尔' },
  );
  assert.equal(loaded.snapshot().tide.overridden, false);
  assert.equal(loaded.snapshot().tide.level, tideLevelAt(loaded.snapshot().now));
});

test('潮位越界、时长非正数：世界不动，说清为什么', () => {
  const sim = makeSim();
  sim.update(16); // 空一拍，让世界先走起来

  sim.enqueue({ kind: 'setTideLevel', level: 1.5, durationMs: 1000 });
  const high = sim.update(16);
  assert.equal(high[0]?.ok, false);
  assert.ok(high[0]?.message.includes('0 到 1'), high[0]?.message);

  sim.enqueue({ kind: 'setTideLevel', level: 0.5, durationMs: 0 });
  const zero = sim.update(16);
  assert.equal(zero[0]?.ok, false);
  assert.ok(zero[0]?.message.includes('多久'), zero[0]?.message);

  sim.enqueue({ kind: 'setTideLevel', level: 0.5, durationMs: 10 * 60_000 });
  const long = sim.update(16);
  assert.equal(long[0]?.ok, false);
  assert.ok(long[0]?.message.includes('2 分钟'), long[0]?.message);

  assert.equal(sim.snapshot().tide.overridden, false, '三次都被拒，一次覆盖都没落下');
});

test('再拨一次同一位置等于延期：命令照做，不猜用户想不想', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setTideLevel', level: 0.6, durationMs: 5000 });
  assert.equal(sim.update(16)[0]?.ok, true);
  const firstUntil = sim.toSave().world.tideOverride?.until;

  for (let i = 0; i < 10; i += 1) sim.update(100); // 走掉一秒
  sim.enqueue({ kind: 'setTideLevel', level: 0.6, durationMs: 5000 });
  assert.equal(sim.update(16)[0]?.ok, true, '同一句命令落在新时刻，就是一条新覆盖');
  assert.ok(
    (sim.toSave().world.tideOverride?.until ?? 0) > (firstUntil ?? 0),
    '到期时间往后推了',
  );
});

// ---------------------------------------------------------------- 天气三档

test('暴雨能设，而且比雨重：同样的浓淡，渲染强度更高', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  sim.update(16);
  const rainAt = sim.weatherIntensity();
  assert.ok(rainAt > 0, '雨要有浓淡');

  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  sim.update(16);
  assert.equal(sim.snapshot().weather, 'storm');
  assert.ok(
    sim.weatherIntensity() > rainAt,
    `暴雨必须明显重于雨：rain=${rainAt} storm=${sim.weatherIntensity()}`,
  );
});

test('暴雨也是一场有期限的天气，自己会停', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  sim.update(16);
  assert.equal(sim.snapshot().weather, 'storm');

  // 暴雨 90 秒，雨 45 秒——比雨久，但仍然会停。
  for (let i = 0; i < 100; i += 1) sim.update(1000);
  assert.equal(sim.snapshot().weather, 'clear');
});

test('从雨转暴雨不清零：浓淡接着往上走，不先停一下', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  for (let i = 0; i < 30; i += 1) sim.update(100); // 浓淡升到 1
  const before = sim.weatherIntensity();

  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  sim.update(16);
  assert.ok(
    sim.weatherIntensity() >= before,
    `换档不该掉下来：before=${before} after=${sim.weatherIntensity()}`,
  );
});

test('转晴是渐变，不是当场关掉雨', () => {
  // 这条以前是漏的：`setWeather('clear')` 直接把 intensity 归零，雨幕一帧消失。
  const sim = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'rain' });
  for (let i = 0; i < 30; i += 1) sim.update(100);
  const wet = sim.weatherIntensity();
  assert.ok(wet > 0.9);

  sim.enqueue({ kind: 'setWeather', weather: 'clear' });
  sim.update(16);
  assert.equal(sim.snapshot().weather, 'clear');
  assert.ok(
    sim.weatherIntensity() > wet * 0.5,
    `转晴第一拍不该掉一半以上：${wet} → ${sim.weatherIntensity()}`,
  );

  // 而它确实会退干净。
  for (let i = 0; i < 30; i += 1) sim.update(100);
  assert.equal(sim.weatherIntensity(), 0);
});

test('暴雨天也躲雨、也打伞——加第三档时不能漏掉这些地方', () => {
  const sim = makeSim();
  sim.update(16);
  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  sim.update(16);

  const villager = sim.snapshot().villager;
  assert.equal(villager.mode, 'sheltering');
  assert.equal(villager.umbrella, true);
});

test('已经是这个天气时回执明说，不假装改成功了', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  sim.update(16);
  sim.enqueue({ kind: 'setWeather', weather: 'storm' });
  const again = sim.update(16);
  assert.equal(again[0]?.ok, false);
  assert.ok(again[0]?.message.includes('暴雨'), again[0]?.message);
});
