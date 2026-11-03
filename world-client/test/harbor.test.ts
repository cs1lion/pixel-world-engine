import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HARBOR_REPORT_MINUTES,
  JETTY_CELLS,
  MAX_REFLECTION_CELLS,
  boatStatusAt,
  harborReportsBetween,
  harborStateAt,
  jettyExposedCells,
  lampReflectionCells,
  withinHarborWitnessRange,
} from '../src/world/harbor.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { TIDE_HIGH_MIN, TIDE_LOW_MAX, tideLevelAt } from '../src/world/tide.ts';
import { WorldGrid } from '../src/world/grid.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

/**
 * 渡口的潮汐后果。
 *
 * 这一组测的是**四件事与同一个 level 的耦合**：船班的三档门槛、突堤与灯影
 * 随水位单调变化、每天三次播报落在世界时间的固定分钟上，以及同一输入逐项相同。
 * 它不是渲染测试——画得好不好看留给同机位截图，这里只钉住可测的数。
 */

test('船班三档：涨潮靠岸、退潮搁浅、中间往返', () => {
  assert.equal(boatStatusAt(TIDE_HIGH_MIN), 'docked');
  assert.equal(boatStatusAt(1), 'docked');
  assert.equal(boatStatusAt(TIDE_LOW_MAX), 'grounded');
  assert.equal(boatStatusAt(0), 'grounded');
  const between = (TIDE_HIGH_MIN + TIDE_LOW_MAX) / 2;
  assert.equal(boatStatusAt(between), 'crossing');
  // 只有搁浅这一档停航；靠岸是开着等客，不是停航。
  assert.equal(harborStateAt(1).boatOpen, true);
  assert.equal(harborStateAt(between).boatOpen, true);
  assert.equal(harborStateAt(0).boatOpen, false);
});

test('突堤露出长度随潮位单调变短，灯影单调变长', () => {
  const levels = Array.from({ length: 11 }, (_, i) => i / 10);
  let previousExposed = Infinity;
  let previousReflection = -Infinity;
  for (const level of levels) {
    const exposed = jettyExposedCells(level);
    const reflection = lampReflectionCells(level);
    assert.ok(exposed <= previousExposed, `突堤露出必须随水位变短：${level}`);
    assert.ok(reflection >= previousReflection, `灯影必须随水位变长：${level}`);
    assert.ok(exposed >= 0 && exposed <= JETTY_CELLS, `突堤越界：${exposed}`);
    assert.ok(reflection >= 0 && reflection <= MAX_REFLECTION_CELLS, `灯影越界：${reflection}`);
    previousExposed = exposed;
    previousReflection = reflection;
  }
  // 退到底全露、没有水就没有倒影；满潮倒影最长。
  assert.equal(jettyExposedCells(0), JETTY_CELLS);
  assert.equal(jettyExposedCells(1), 0);
  assert.equal(lampReflectionCells(0), 0);
  assert.equal(lampReflectionCells(1), MAX_REFLECTION_CELLS);
});

test('状态句同时报潮位、船班与突堤，读数可被面板直接引用', () => {
  const high = harborStateAt(1);
  const low = harborStateAt(0);
  assert.match(high.text, /潮位 1\.00/);
  assert.match(high.text, /船班靠岸，可开航/);
  assert.match(high.text, /突堤露出 0 格/);
  assert.match(low.text, /潮位 0\.00/);
  assert.match(low.text, /船班搁浅，停航/);
  assert.match(low.text, /突堤露出 7 格/);
});

test('每天三班落在 06:30 / 12:30 / 18:30，跨窗口不重不漏', () => {
  const day = DAY_MS;
  const tideAt = (at: number): number => tideLevelAt(at);
  const first = harborReportsBetween(-1, day - 1, tideAt);
  assert.equal(first.length, HARBOR_REPORT_MINUTES.length);
  assert.deepEqual(
    first.map((report) => (report.at - 0) / 60_000),
    HARBOR_REPORT_MINUTES.map((minute) => minute),
  );

  // 相邻两个窗口各报当天三班：同一条播报不会因为分帧而重复。
  const second = harborReportsBetween(day - 1, day * 2 - 1, tideAt);
  assert.equal(second.length, HARBOR_REPORT_MINUTES.length);
  const all = [...first, ...second].map((report) => report.at);
  assert.equal(new Set(all).size, all.length);

  // 同一拍重复问、或者窗口为空，都不会补出第二条。
  assert.deepEqual(harborReportsBetween(0, 0, tideAt), []);
  assert.equal(harborReportsBetween(first[0]!.at, first[0]!.at, tideAt).length, 0);
});

test('同一条基线跑两次，四件事与播报逐项相同', () => {
  const tideAt = (at: number): number => tideLevelAt(at);
  const run = () => ({
    states: [0.1, 0.34, 0.5, 0.6, 0.9].map((level) => harborStateAt(level)),
    reports: harborReportsBetween(0, DAY_MS * 2, tideAt),
  });
  assert.deepEqual(run(), run());
});

test('船班播报只进码头边在场的人：同一次靠岸 +1 / +0', () => {
  const harborAt = { x: 15, y: 13 };
  const dock = { id: 'dock', pos: { x: 15, y: 12 }, visible: true, mode: 'idle' as const };
  const center = { id: 'center', pos: { x: 35, y: 30 }, visible: true, mode: 'idle' as const };
  const sheltering = { id: 'sheltering', pos: { x: 14, y: 13 }, visible: true, mode: 'sheltering' as const };

  assert.equal(withinHarborWitnessRange(dock.pos, harborAt), true);
  assert.equal(withinHarborWitnessRange(center.pos, harborAt), false);
  // 12 格的依据：渡口中心到镇中心 20 多格，到栈头约 8 格。
  assert.ok(Math.hypot(center.pos.x - harborAt.x, center.pos.y - harborAt.y) > 20);

  const witnesses = [dock, center, sheltering]
    .filter((villager) => villager.visible && villager.mode !== 'sheltering')
    .filter((villager) => withinHarborWitnessRange(villager.pos, harborAt))
    .map((villager) => villager.id);
  assert.deepEqual(witnesses, ['dock']);

  const runtime = new MemoryRuntime({ worldId: 'harbor-witness' });
  runtime.syncHolders([
    { holderId: 'dock', type: 'character', at: dock.pos },
    { holderId: 'center', type: 'character', at: center.pos },
  ]);
  const at = DAY_MS + 60_000;
  const state = harborStateAt(1);
  runtime.observe(
    {
      eventId: 'mem_harbor_1',
      kind: 'harbor_report',
      placeId: 'ferry',
      at: harborAt,
      actors: [],
      outcome: { what: state.text },
      importanceHint: 0.55,
      valence: 0,
      arousal: 0.4,
    },
    witnesses,
    at,
  );
  assert.equal(runtime.dayTimelineFor('dock', 1).length, 1, '码头边的人记一条');
  assert.equal(runtime.dayTimelineFor('center', 1).length, 0, '镇中心的人不记广播');
});

test('没有渡口的图不凭空长码头；有渡口就按世界时间播报并进快照', () => {
  const emptyGrid = (withFerry: boolean): WorldGrid =>
    new WorldGrid({
      width: 32,
      height: 20,
      border: 1,
      zones: [],
      regions: withFerry ? [{ id: 'ferry', x: 2, y: 2, w: 10, h: 8 }] : [],
    });

  const without = new Simulation({
    grid: emptyGrid(false),
    buildings: [],
    altar: { x: 28, y: 18 },
    villagerName: '汐',
  });
  assert.equal(without.snapshot().harbor, null, '没有渡口时快照必须是 null');

  const changes: WorldChange[] = [];
  const withFerry = new Simulation({
    grid: emptyGrid(true),
    buildings: [],
    altar: { x: 28, y: 18 },
    villagerName: '汐',
    harborAt: { x: 7, y: 6 },
    onChange: (change) => {
      changes.push(change);
    },
  });
  assert.ok(withFerry.snapshot().harbor !== null, '有渡口时快照必须带四件事');

  // 60fps 的等价写法：按世界时间一步一步推过 06:30（390 分钟）。
  for (let minute = 0; minute < 420; minute += 1) withFerry.update(60_000);
  const reports = changes.filter(
    (change): change is Extract<WorldChange, { change: 'world.event' }> =>
      change.change === 'world.event' && change.kind === 'harbor_report',
  );
  assert.equal(reports.length, 1);
  assert.match(reports[0]!.text, /潮位 \d\.\d\d.*船班/);
});
