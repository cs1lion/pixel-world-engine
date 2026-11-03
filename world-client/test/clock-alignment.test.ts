/**
 * 老档日界对齐的三件事：提示的触发/不触发/暂不后重启/再次触发、前跳方案、
 * 以及「对齐 → 撤销」把 `now` 与相对定时器原样放回去。
 *
 * 样本用老档实测：`world.now = 840300`，本地 07:15 时世界日界落在 07:01。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { Simulation } from '../src/world/simulation.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import {
  CLOCK_ALIGN_THRESHOLD_MS,
  ClockAlignmentGate,
  clearClockAlignment,
  formatBoundaryClock,
  formatDuration,
  inspectClockAlignment,
  mayAlignClock,
  readClockAlignment,
  writeClockAlignment,
} from '../src/world/clock-alignment.ts';
import type { BaselineStorage } from '../src/world/real-clock-baseline.ts';
import type { ClockAlignmentRecord } from '../src/world/clock-alignment.ts';

const OFFSET = 480;
const DAY = 86_400_000;
const OLD_SAVE_NOW = 840_300;

/** 本地时钟 07:15:01.300 的绝对墙钟时刻。 */
const WALL_AT_0715 = Date.UTC(2026, 10, 2, 7, 15, 1, 300) - OFFSET * 60_000;

function fakeStorage(): BaselineStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function simAt(now: number): Simulation {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '测试',
    wallClock: () => 0,
    initialNow: now,
  });
}

test('老档 07:01 的日界：超过阈值，前跳 7 小时 1 分，本日缩为 16 小时 59 分', () => {
  const probe = inspectClockAlignment(OLD_SAVE_NOW, WALL_AT_0715, OFFSET);
  assert.equal(probe.required, true);
  assert.equal(probe.boundaryLabel, '07:01');
  assert.ok(probe.deltaMs > 7 * 3_600_000 && probe.deltaMs < 7.1 * 3_600_000);
  assert.equal(probe.deltaMs, probe.boundaryMs, '最小正向跳量就是日界的本地位相');
  assert.equal(probe.dayLengthAfterMs, DAY - probe.deltaMs);
  assert.equal(formatDuration(probe.deltaMs), '7 小时 1 分');
  assert.equal(formatDuration(probe.dayLengthAfterMs), '16 小时 59 分');
  assert.equal(formatBoundaryClock(probe.boundaryMs), '07:01');
});

test('偏移小于阈值不提示，大于阈值才提示', () => {
  const below = inspectClockAlignment(0, Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET * 60_000 + 4 * 60_000, OFFSET);
  assert.equal(below.required, false);
  assert.equal(below.boundaryLabel, '00:04');

  const above = inspectClockAlignment(0, Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET * 60_000 + 6 * 60_000, OFFSET);
  assert.equal(above.required, true);
  assert.equal(above.boundaryLabel, '00:06');
  assert.equal(CLOCK_ALIGN_THRESHOLD_MS, 5 * 60_000);
});

test('新档零点对齐：偏移 0，不提示', () => {
  const wall = Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET * 60_000;
  const probe = inspectClockAlignment(0, wall, OFFSET);
  assert.equal(probe.boundaryMs, 0);
  assert.equal(probe.required, false);
  assert.equal(probe.boundaryLabel, '00:00');
});

test('暂不之后同一相位不再弹；重启（新 Gate 读持久值）也不弹；再次触发能弹', () => {
  const probe = inspectClockAlignment(OLD_SAVE_NOW, WALL_AT_0715, OFFSET);
  const gate = new ClockAlignmentGate();
  assert.equal(gate.open(probe), true, '第一次该弹');
  gate.decline(probe);
  assert.equal(gate.isVisible, false);
  assert.equal(gate.open(probe), false, '本次会话不再重复弹');

  const storage = fakeStorage();
  writeClockAlignment(storage, 'world', { kind: 'declined', boundaryMs: probe.boundaryMs, wallMs: 1 });
  const afterRestart = new ClockAlignmentGate(readClockAlignment(storage, 'world')?.boundaryMs ?? null);
  assert.equal(afterRestart.open(probe), false, '重启后同一相位仍不弹');
  // 重开页面按 100ms 步进取整，相位会漂几十毫秒；不能因此又弹。
  const drifted = { ...probe, boundaryMs: probe.boundaryMs + 52, deltaMs: probe.deltaMs + 52 };
  assert.equal(afterRestart.open(drifted), false, '几十毫秒的漂移仍算同一个日界');

  assert.equal(afterRestart.reopen(probe), true, '设置/调试面板的再次检查绕过暂不');
  assert.equal(afterRestart.isVisible, true);
  assert.equal(afterRestart.declinedAt, null);
});

test('相位变了才重新问；坏值一律当没有', () => {
  const storage = fakeStorage();
  writeClockAlignment(storage, 'world', { kind: 'declined', boundaryMs: 1000, wallMs: 1 });
  const gate = new ClockAlignmentGate(readClockAlignment(storage, 'world')?.boundaryMs ?? null);
  const other = inspectClockAlignment(0, Date.UTC(2026, 10, 2, 0, 0, 0) - OFFSET * 60_000 + 6 * 60_000, OFFSET);
  assert.equal(gate.open(other), true, '相位不同，重新提示');

  storage.setItem('xiaoxi.pixel-world.clock-align.v1:world', 'not json');
  assert.equal(readClockAlignment(storage, 'world'), null);
  storage.setItem('xiaoxi.pixel-world.clock-align.v1:world', '{"kind":"applied","deltaMs":1}');
  assert.equal(readClockAlignment(storage, 'world'), null);
  clearClockAlignment(storage, 'world');
  assert.equal(readClockAlignment(storage, 'world'), null);
});

test('墙钟回拨暂停时不执行对齐', () => {
  const probe = inspectClockAlignment(OLD_SAVE_NOW, WALL_AT_0715, OFFSET);
  assert.equal(mayAlignClock(probe, false), true);
  assert.equal(mayAlignClock(probe, true), false);
  assert.equal(mayAlignClock({ ...probe, required: false }, false), false);
});

test('对齐 → 撤销：now 与相对定时器原样回到对齐前', () => {
  const probe = inspectClockAlignment(OLD_SAVE_NOW, WALL_AT_0715, OFFSET);
  const sim = simAt(OLD_SAVE_NOW);
  const before = sim.snapshot();
  // `nextRoutineAt` 只进存档，不在快照里——从 `toSave()` 取，别为测试开新读口。
  const beforeRoutine = sim.toSave().world.villagers.map((villager) => villager.nextRoutineAt);

  const record: ClockAlignmentRecord = {
    kind: 'applied',
    boundaryMs: probe.boundaryMs,
    deltaMs: probe.deltaMs,
    fromNow: before.now,
    toNow: before.now + probe.deltaMs,
    dayBefore: Math.floor(before.now / DAY),
    wallMs: 1,
  };
  sim.fastForwardNow(record.deltaMs);
  sim.realignAfterClockJump(record.deltaMs);
  assert.equal(sim.snapshot().now, record.toNow);
  assert.deepEqual(
    sim.toSave().world.villagers.map((villager) => villager.nextRoutineAt),
    beforeRoutine.map((value) => value + record.deltaMs),
    '未来定时器随跳变平移，剩余时长不变',
  );

  // 对齐之后世界正常走了 1 秒；撤销要把这 1 秒也放回原值。
  sim.fastForwardNow(1000);
  const rewind = sim.snapshot().now - record.fromNow;
  sim.rewindNow(rewind);
  sim.realignAfterClockJump(-record.deltaMs);
  assert.equal(sim.snapshot().now, before.now, 'now 回到对齐前的值，不是只减 δ');
  assert.deepEqual(
    sim.toSave().world.villagers.map((villager) => villager.nextRoutineAt),
    beforeRoutine,
    '定时器也原样回去',
  );
  assert.equal(Math.floor(sim.snapshot().now / DAY), record.dayBefore, 'day 序号没变');
});

test('同一天内对齐/撤销不改变记忆条数与 closedThroughDay', () => {
  const probe = inspectClockAlignment(OLD_SAVE_NOW, WALL_AT_0715, OFFSET);
  const runtime = new MemoryRuntime({ worldId: 'align-same-day' });
  runtime.tickCapped(OLD_SAVE_NOW, 7);
  const beforeText = runtime.toJSON();
  const before = JSON.parse(beforeText) as { readonly world: unknown };
  const closedBefore = runtime.closedThroughDay;

  const applied = runtime.tickCapped(OLD_SAVE_NOW + probe.deltaMs, 7);
  assert.equal(applied.closed.length, 0, '不跨日界，不关账');
  const after = JSON.parse(runtime.toJSON()) as { readonly world: unknown };
  assert.deepEqual(after.world, before.world, '记忆条目与 day 一个字段没动');
  assert.equal(runtime.closedThroughDay, closedBefore);

  runtime.tickCapped(OLD_SAVE_NOW, 7);
  assert.equal(runtime.toJSON(), beforeText, '撤销后整份记忆段原样回去');
  assert.equal(runtime.closedThroughDay, closedBefore);
});
