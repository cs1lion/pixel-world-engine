/**
 * 「确定性回放」的性质测试。
 *
 * 引擎的立身之说是一句此前没证过的承诺：**同一个世界、同一串输入，往后
 * 每一拍都一样**。存档测试证的是"存/取等价"，各子系统测试证的是"各自
 * 与步长无关"；端到端的"重放可验证"一直没有可对比的对象——没有回放函数、
 * 没有状态哈希。这一文件补上第一块：把「输入流」正式定义成
 * `[帧间隔 deltaMs, 这拍投递的命令]` 的序列，写出 `replay`，测它的三条性质。
 *
 * 三条测试各管一条：
 *   1. **同流必同态**——重放函数本身可用。
 *   2. **改流必现红**——哈希若抓不住真分叉，第一条就是空谈。
 *   3. **拆帧必现红**——**最重的一条**，测出来的是一个未解决的问题。
 *
 * 第三条是**特征测试（characterization test）**：断言"分叉"，把缺口钉在测试里。
 * 等"命令落拍与帧率解耦"那一步（要做 ADR）落地，这条会红——那时该改的是
 * 断言（翻成 `assert.equal`，即"重放与帧率无关"达成了），**不是删掉测试**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import {
  buildLargeWorld,
  buildWorldFromSave,
  LARGE_ALTAR,
  LARGE_WORLD_SPEC,
  placeBlueprint,
} from '../src/world/setup.ts';
import type { BuiltWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { SimulationDeps, WorldCommand } from '../src/world/simulation.ts';
import type { WorldSave } from '../src/world/save.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/**
 * 起世界的**唯一**一处装配。新建与读档共用它，规格固定为生产的大世界
 * （`LARGE_WORLD_SPEC` + `LARGE_ALTAR`）。
 *
 * 为什么必须是生产规格：回放若跑在 30×20 的小世界里，郊野铺子、民居、
 * 迷雾半径这些在生产里存在的东西在回放里根本不存在——那样验的是"另一个世界
 * 也能同流同态"，不是这个世界的承诺。`spawnBuilding` 也要带上：回放流里
 * 可能有造物命令，而 `Simulation.fromSave` 只是把存档灌回实例，造物能力
 * 来自 deps——**起世界的依赖与跑世界的依赖必须是同一套**。
 */
function openWorld(world: BuiltWorld): SimulationDeps {
  return {
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    wallClock: () => 1000,
    blueprints,
    spawnBuilding: (prefabId, instanceId, at) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at);
    },
  };
}

function newWorld(): Simulation {
  return new Simulation(openWorld(buildLargeWorld(blueprints)));
}

function worldFromSave(save: WorldSave): Simulation {
  const clone = JSON.parse(JSON.stringify(save)) as WorldSave;
  const world = buildWorldFromSave(
    clone.world.buildings,
    blueprints,
    LARGE_WORLD_SPEC,
    LARGE_ALTAR,
  );
  return Simulation.fromSave(clone, openWorld(world));
}

/**
 * 输入流：**一个不可分割的整体**。每帧两样——隔多久（deltaMs）、这帧投递
 * 哪些命令（顺序在内，队列按 FIFO 结算）。只记命令序列不记帧间隔，
 * "同一串输入"就没有确定含义：命令落在哪一拍执行，直接改变世界。
 */
export type InputStream = readonly (readonly [
  deltaMs: number,
  commands: readonly WorldCommand[],
])[];

/**
 * 回放器。**验证器要接进生产的就是这一个函数**：线上传"存档 + 输入流 +
 * 终点哈希"，离线重放比对。没有它，"线上出了岔子"只能事后靠存档猜。
 */
export function replay(start: WorldSave, stream: InputStream): Simulation {
  const sim = worldFromSave(start);
  for (const [delta, commands] of stream) {
    for (const command of commands) sim.enqueue(command);
    sim.update(delta);
  }
  return sim;
}

/**
 * 语义哈希：取 `toSave().world` 里**不重复、不随文案变**的字段。
 *
 * 刻意排除两类：
 *
 * 1. **wall-clock**：`meta.savedAtWallClock` 与 settled 里 `mock` 来源的
 *    `completedAt`。那不是世界的时间，两次跑注定不同。
 * 2. **纯派生值**：雾半径、交付计数、潮位——它们分别是「settled 条数」「now」的
 *    纯函数（`revealedRadiusFor` / `effectiveTideLevel`），上面已经通过
 *    `settled` 与 `now` 进了哈希。再放一份进来，只会让同一次分叉在三个地方
 *    各红一次，红的地方变多、指向的地方没变。
 *
 * 另外两样**在存档里、但不进哈希**：
 *
 * - `feed.*`：`fromSave` 一律归零（连接态、游标、对账位），回放语义就是"从零开始读"。
 * - `oracle`（石板）：它是原话与回执的**转写稿**，措辞改一个字就变，而世界没动。
 *   纳进来会把"改一句提示文案"报成"世界分叉"。它落盘是为了给读者看，不是为了回放。
 *
 * `pos` 与 `critters.at` 按**整数格**量化（`Math.round`，同 `cellOf`）。
 * 探针已证浮点 pos 随拆帧分叉；量化后"她在哪一格"是语义的（走没走到门口），
 * 但**逐帧等价仍未达成**——把它翻成逐位断言需要先做世界侧决定
 * （整数累加，或 pos 改成"格坐标+余量"），那是 ADR，不是这个文件的事。
 */
export function semanticHash(sim: Simulation): string {
  const save = sim.toSave().world;
  const cell = (p: { x: number; y: number }) => ({
    x: Math.round(p.x),
    y: Math.round(p.y),
  });
  return JSON.stringify({
    now: save.now,
    villagers: save.villagers.map((v) => ({ ...v, pos: cell(v.pos) })),
    buildings: save.buildings,
    roads: save.roads,
    props: save.props,
    critters: save.critters.map((c) => ({ ...c, at: cell(c.at) })),
    tasks: save.tasks,
    pending: save.pending,
    activities: save.activities,
    constructions: save.constructions,
    weather: save.weather,
    faith: save.faith,
    // mock 来源的完成时刻来自墙钟，剔除；ledger 来源是上游事件时间，保留。
    settled: save.settled.map((record) =>
      record.source === 'mock' ? { ...record, completedAt: null } : record,
    ),
    nextTaskNumber: save.nextTaskNumber,
    nextPendingNumber: save.nextPendingNumber,
    tideOverride: save.tideOverride,
    worldChangeVersion: save.worldChangeVersion,
  });
}

/** 一条有代表性的流：派活、下雨、拨潮，然后干跑。命令在第 fireAt 拍投递。 */
function runStream(frames: number, delta: number, fireAt = 0): InputStream {
  const out: (readonly [number, readonly WorldCommand[]])[] = [];
  for (let i = 0; i < frames; i += 1) {
    out.push(
      i === fireAt
        ? [
            delta,
            [
              { kind: 'dispatch', taskKind: 'code', summary: '修 bug' },
              { kind: 'setWeather', weather: 'rain' },
              { kind: 'setTideLevel', level: 0.25, durationMs: 2000 },
            ],
          ]
        : [delta, []],
    );
  }
  return out;
}

test('同一条流重放两次，语义状态逐位一致', () => {
  const seed = newWorld().toSave();
  assert.equal(
    semanticHash(replay(seed, runStream(60, 100))),
    semanticHash(replay(seed, runStream(60, 100))),
    '重放器对同一输入必须给出同一终态；这条红了说明回放本身不可信。',
  );
});

test('流里改一处真分叉，语义哈希必须变红', () => {
  const seed = newWorld().toSave();
  const tampered: InputStream = runStream(60, 100).map(([delta, commands], i) =>
    i === 0
      ? [
          delta,
          commands.map((command) =>
            command.kind === 'dispatch'
              ? ({ ...command, taskKind: 'quick' } as WorldCommand)
              : command,
          ),
        ]
      : [delta, commands],
  );
  assert.notEqual(
    semanticHash(replay(seed, tampered)),
    semanticHash(replay(seed, runStream(60, 100))),
    '把派活种类改掉，哈希必须现红——抓不住分叉的哈希，测了等于没测。',
  );
});

test('同总时长、不同拆帧：语义哈希分叉（特征测试——这是已知缺口，不是回归）', () => {
  const seed = newWorld().toSave();
  // 6000ms 总时长不变，60fps 拍 vs 20fps 拍。命令投递的"那一拍"随帧率移动：
  // createdAt、潮位覆盖的 until、气泡到期时戳都跟着漂移（探针实测：
  // 16×375 与 48×125 的 tasks[0].createdAt = 16 vs 48）。生产里的固定 100ms
  // 步长掩盖不了这一点——命令是在 rAF 回调里入队的，落在固定步的哪一拍
  // 取决于累加器余量，照样跟帧率走。
  const as16 = replay(seed, runStream(375, 16));
  const as48 = replay(seed, runStream(125, 48));
  assert.notEqual(
    semanticHash(as16),
    semanticHash(as48),
    '断言的是**现状**：输入流目前无法与帧率解耦。等"命令带世界时间戳入队"' +
      '（或等价方案）落地后，把这里翻成 assert.equal——那条红是修好了的信号。',
  );
});
