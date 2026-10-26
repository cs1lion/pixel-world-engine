/**
 * 一个名字指着两个人时，世界拒，不替用户挑。
 *
 * `intent-schema.ts` 的 carry 注释答应的是「名字重了是世界的事——它拒」，
 * `demolishTargetOf` 对同模板的两栋楼正是这么办的。这条约束从前只有那两处守着，
 * 于是 `completeManually` 漏了：它用 `.find(id === target || name === target)`，
 * 两个人都叫莞尔时把成果递给排在前头的那位，然后照实说「成果已交付（莞尔）」。
 * 那句话听着像她点的那位交了——而世界其实挑了一个。
 *
 * 这条入口不是神谕：`intent-schema` 的 `complete` 只收 `kind` 一个字段，
 * 带名字的会被当未知字段拒掉。会带名字的是**玩家在界面上按的那一下**
 * （`SandboxScene.finish(target)`），所以这条测试排的是命令，不是意图。
 * 玩家点的就是具体某一个人，分不出是哪一个时更不能替他挑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >,
);

/** 两个同名的人。`villagerNames` 是调用方给的、读档也不查重名，所以这进得来。 */
function makeTwins(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    villagerNames: ['莞尔', '莞尔'],
    wallClock: () => 1000,
  });
}

/**
 * 让第一个去干活。
 *
 * 派的是**玩家自己那单**（`dispatch`），不是上游的活：上游单的完成权在上游，
 * 人工交付会被「这单的完成权在上游」拒掉——那是另一条规矩，与这条无关。
 */
function putFirstToWork(sim: Simulation): void {
  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写个脚本' });
  for (let i = 0; i < 60 && sim.snapshot().villagers[0]!.mode !== 'working'; i += 1) {
    sim.update(100);
  }
  assert.equal(sim.snapshot().villagers[0]!.mode, 'working', '前提：她人在工坊里');
}

test('两个人都叫莞尔，交付点名「莞尔」：拒，不把成果递给第一个', () => {
  const sim = makeTwins();
  putFirstToWork(sim);

  sim.enqueue({ kind: 'complete', target: '莞尔' });
  const results = sim.update(16);
  const last = results[results.length - 1]!;

  assert.equal(last.ok, false, '分不出是哪一个，就不能办');
  assert.match(last.message, /有 2 个人叫「莞尔」/, '得说清是为什么办不了');
  assert.match(last.message, /v0、v1/, '得把两个都点出来，用户才知道点哪个');
  assert.equal(
    sim.snapshot().villagers[0]!.mode,
    'working',
    '她的活不该被这一下收掉——收的是排在前头那位，不是玩家点的那位',
  );
});

test('点名 id 时照旧办得下：id 是世界上唯一的，不经过名字那一道', () => {
  const sim = makeTwins();
  putFirstToWork(sim);

  sim.enqueue({ kind: 'complete', target: 'v0' });
  const results = sim.update(16);
  const last = results[results.length - 1]!;

  assert.equal(last.ok, true, `点名 id 应该办得下，实际：${last.message}`);
  assert.notEqual(sim.snapshot().villagers[0]!.mode, 'working', '她的活真的被收了');
});

test('世界上没有这个人：说清都有谁，不说一句「没有叫 X 的角色」就完', () => {
  const sim = makeTwins();
  putFirstToWork(sim);

  sim.enqueue({ kind: 'complete', target: '守夜人' });
  const results = sim.update(16);
  const last = results[results.length - 1]!;

  assert.equal(last.ok, false);
  assert.match(last.message, /没有叫「守夜人」的人/, '得说没有这个人');
  assert.match(last.message, /莞尔/, '得说世界上都有谁');
});
