/**
 * 观察规则注册表：一条世界改变 → 若干条观察记录。
 *
 * 这一组钉四件事：
 *   1. **同一变化只命中一条规则**——分派是查表，不是按这再按那地叠加；
 *   2. **天气的分组拆法与旧 switch 相同**——第一条复用基础 id，之后每多一组
 *      才多消耗一个 id；空分组一条不落、也不空耗序号；
 *   3. **新增变化类型不需要改 Scene**——只加一条规则就能进记忆；
 *   4. 注册表覆盖 `WORLD_CHANGE_KINDS` 的每一种改变。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorldChange } from '../src/world/world-changes.ts';
import { WORLD_CHANGE_KINDS } from '../src/world/world-changes.ts';
import {
  OBSERVATION_RULES,
  observationsFor,
  type ObservationContext,
  type ObservationRule,
} from '../src/world/observation-rules.ts';
import type { RuntimeObservation } from '../src/world/memory/runtime.ts';
import { codeOf } from './source-scan.ts';

const lookups = {
  atOfHolder: (_holderId: string) => ({ x: 10, y: 10 }),
  atOfBuilding: (_instanceId: string) => ({ x: 10, y: 10 }),
  buildingOfTask: (_taskId: string) => undefined,
};

function context(overrides: Partial<ObservationContext> = {}): ObservationContext {
  return {
    lookups,
    eventId: 'mem_1',
    nextEventId: () => {
      throw new Error('这条改变不该再要事件 id');
    },
    stallsAt: [],
    peopleOf: () => [],
    landmarkOf: () => undefined,
    witnessesOf: () => undefined,
    ...overrides,
  };
}

/** 每种改变挑一个最小样本，只求能走完分派。 */
function sampleOf(kind: WorldChange['change']): WorldChange {
  switch (kind) {
    case 'task.delivered':
      return {
        change: kind, taskId: 't1', summary: '写完了', workerId: 'v0',
        source: 'local', taskKind: 'writing',
      };
    case 'building.built':
      return { change: kind, instanceId: 'b1', prefabId: 'p1', displayName: '一间铺子', summary: null };
    case 'building.removed':
      return { change: kind, instanceId: 'b1', displayName: '一间铺子' };
    case 'miracle':
      return { change: kind, miracle: 'lamp', at: { x: 10, y: 10 } };
    case 'weather':
      return { change: kind, weather: 'rain' };
    case 'tide':
      return { change: kind, level: 0.2, until: 1000 };
    case 'world.event':
      return {
        change: kind, kind: 'tide_turn', text: '潮水掉头了',
        placeId: 'place:shore', where: { x: 10, y: 10 }, actorId: null,
      };
    case 'world.vitals':
      return {
        change: kind, day: 1, meanValence: 0, meanArousal: 0,
        infoEntropy: 0, isolatedHoldersCount: 0,
      };
    case 'legend':
      return {
        change: kind, legendId: 'l1', text: '碑上那句话',
        placeId: 'place:shore', reach: 3, day: 1,
      };
  }
}

test('注册表覆盖每一种改变，分派只命中一次', () => {
  assert.deepEqual(
    Object.keys(OBSERVATION_RULES).sort(),
    [...WORLD_CHANGE_KINDS].sort(),
    '注册表的键必须与 `WORLD_CHANGE_KINDS` 逐项对上',
  );

  const hits: Record<string, number> = {};
  const counting: Record<string, ObservationRule> = {};
  for (const key of WORLD_CHANGE_KINDS) {
    const rule = OBSERVATION_RULES[key];
    counting[key] = (change, ctx) => {
      hits[key] = (hits[key] ?? 0) + 1;
      return rule(change, ctx);
    };
  }

  for (const kind of WORLD_CHANGE_KINDS) {
    for (const key of Object.keys(hits)) delete hits[key];
    observationsFor(sampleOf(kind), context(), counting);
    const total = Object.values(hits).reduce((sum, n) => sum + n, 0);
    assert.equal(total, 1, `「${kind}」命中的规则数是 ${total}，应当恰好 1`);
    assert.equal(hits[kind], 1, `「${kind}」必须命中它自己那一条规则`);
  }
});

test('天气分组：第一条复用基础 id，每多一组才多消耗一个', () => {
  const stalls = [{ x: 10, y: 10 }, { x: 40, y: 10 }];
  const people = [
    { id: 'v0', cell: { x: 10, y: 10 }, visible: true },
    { id: 'v1', cell: { x: 40, y: 10 }, visible: true },
  ];
  let serial = 1;
  let asked = 0;
  const ctx = context({
    eventId: 'mem_1',
    nextEventId: () => {
      asked += 1;
      return `mem_${(serial += 1)}`;
    },
    stallsAt: stalls,
    peopleOf: () => people,
  });

  const change: WorldChange = { change: 'weather', weather: 'rain' };
  const pending = observationsFor(change, ctx);

  assert.equal(pending.length, 2, '两个摊位各一组');
  assert.equal(pending[0]!.observation.eventId, 'mem_1', '第一条复用基础 id');
  assert.equal(pending[1]!.observation.eventId, 'mem_2', '第二条才消耗新 id');
  assert.equal(asked, 1, '只多要了一个 id');
  assert.deepEqual(pending[0]!.observation.at, stalls[0]);
  assert.deepEqual(pending[1]!.observation.at, stalls[1]);
  assert.deepEqual(pending[0]!.witnesses, ['v0']);
  assert.deepEqual(pending[1]!.witnesses, ['v1']);
});

test('天气分组：空分组一条不落，也不空耗事件 id', () => {
  const ctx = context({
    stallsAt: [{ x: 10, y: 10 }],
    peopleOf: () => [],
  });
  const pending = observationsFor({ change: 'weather', weather: 'fog' }, ctx);
  assert.deepEqual(pending, [], '没人就没账，与拆分前的空分组相同');
});

test('没有摊位时天气走默认一对一，不取地标也不取窄目击者', () => {
  const ctx = context();
  const pending = observationsFor({ change: 'weather', weather: 'clear' }, ctx);
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.witnesses, undefined);
  assert.equal(pending[0]!.observation.eventId, 'mem_1');
});

test('新增变化类型：只加一条规则即可，Scene 不必改', () => {
  const customObservation: RuntimeObservation = {
    eventId: 'mem_1',
    kind: 'weather_anomaly',
    placeId: 'place:sky',
    at: { x: 0, y: 0 },
    actors: [],
    outcome: { what: '天上掉下一件新事' },
    importanceHint: null,
  };
  const customRule: ObservationRule = () => [{ observation: customObservation, witnesses: undefined }];
  const fake = { change: 'custom.anomaly' } as unknown as WorldChange;

  const pending = observationsFor(fake, context(), { 'custom.anomaly': customRule });
  assert.equal(pending.length, 1, '注入的规则被查到并执行');
  assert.equal(pending[0]!.observation.kind, 'weather_anomaly');

  // Scene 只递上下文、照单落账：没有 switch，也没有按变化类型分支的天气特判。
  const scene = codeOf(new URL('../src/scenes/SandboxScene.ts', import.meta.url));
  assert.match(scene, /observationsFor\(/, 'Scene 必须走注册表');
  assert.doesNotMatch(scene, /change\.change === 'weather'/, '天气分组不该再长在 Scene 里');
});
