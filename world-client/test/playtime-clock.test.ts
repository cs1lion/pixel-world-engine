/**
 * 「关页面 3 天再开」——世界时间、事件与记忆必须**原样停在断点**。
 *
 * ## 为什么这条是判据
 *
 * 真实时钟做默认时，重开页面会把墙钟经过的时间补进世界：离线 3 天就翻 3 天
 * 日历、关 3 次账。但那 3 天里页面没运行、没有任何事件发生，补出来的
 * 「历史」是凭空写的。这条据此钉住三件事：
 *
 * 1. 默认入口解析出的是**游玩时间驱动**（倍率 6），不是真实时钟。
 * 2. 同一份存档，无论隔 0 天还是 3 天读回，`world.now` 都等于档里写下的值。
 * 3. 事件与记忆也完全一致：读档不会因为墙钟推移而多出任何一条。
 *
 * 真实时钟（`?clock=real`）的补算与日界对齐仍由 `real-clock.test.ts` /
 * `clock-alignment.test.ts` 覆盖；这里只断言它**不再**是默认。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { Simulation, type SimulationDeps } from '../src/world/simulation.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import {
  DEFAULT_FAST_TIME_SCALE,
  resolveClockSelection,
} from '../src/world/real-clock.ts';
import { clockAlignmentAvailable } from '../src/world/clock-alignment.ts';

const DAY = 86_400_000;
/** 世界第 0 天的中午：够跑几步，也离日界很远，读档不该顺手关账。 */
const NOW = 12 * 3_600_000;

function depsAt(wallMs: number): SimulationDeps {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  return {
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '测试',
    wallClock: () => wallMs,
  };
}

test('默认入口是游玩时间驱动：倍率 6，日界对齐不参与', () => {
  const selection = resolveClockSelection('');
  assert.equal(selection.mode, 'accelerated');
  assert.equal(selection.timeScale, DEFAULT_FAST_TIME_SCALE);
  assert.equal(clockAlignmentAvailable(selection.mode), false, '默认模式没有墙钟日界可对齐');
  assert.equal(clockAlignmentAvailable('real'), true, '真实时钟模式才保留日界对齐');
});

test('关 3 天再开：now、事件与记忆全部停在断点，不补算', () => {
  const runtime = new MemoryRuntime({ worldId: 'playtime-clock' });
  runtime.tickCapped(NOW, 7);

  const sim = new Simulation({ ...depsAt(0), initialNow: NOW });
  // 跑一小段，让快照里有事件、记忆有内容（关账不跨日界）。
  for (let step = 0; step < 50; step += 1) sim.update(100);
  const save = sim.toSave(runtime.toJSON());
  const savedNow = sim.snapshot().now;
  assert.ok(savedNow > NOW, '世界在页面开着时确实走了一段');
  assert.ok(save.world.memory !== '', '记忆段进了存档');

  // 同一份档读两次：一次「立刻重开」，一次「关 3 天再开」。
  const immediate = Simulation.fromSave(save, depsAt(0));
  const later = Simulation.fromSave(save, depsAt(3 * DAY));

  assert.equal(immediate.snapshot().now, savedNow, '立刻读回等于断点');
  assert.equal(later.snapshot().now, savedNow, '隔 3 天读回仍等于断点，没有补算');
  assert.equal(
    later.snapshot().events.length,
    immediate.snapshot().events.length,
    '离线 3 天没有多出任何事件',
  );
  assert.deepEqual(
    later.snapshot().events,
    immediate.snapshot().events,
    '事件内容也逐条一致',
  );

  // 记忆段按存档原样复原：条数与闭账日都不动。
  const memoryNow = new MemoryRuntime({ worldId: 'playtime-clock' });
  const memoryLater = new MemoryRuntime({ worldId: 'playtime-clock' });
  assert.equal(memoryNow.fromJSON(save.world.memory), true);
  assert.equal(memoryLater.fromJSON(save.world.memory), true);
  assert.equal(memoryLater.toJSON(), memoryNow.toJSON(), '记忆段一个字段没动');
  assert.equal(memoryLater.closedThroughDay, memoryNow.closedThroughDay, '闭账日没动');
});
