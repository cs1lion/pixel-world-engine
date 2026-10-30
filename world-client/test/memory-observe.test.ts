import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationOf, type ObservationLookups } from '../src/world/memory/observe.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

/**
 * 翻译层：世界回写的改变 → 记忆层的观察。
 *
 * 这一层最容易出的错不是崩溃，是**安静地记错**：把一件没在任何地方发生的事
 * 记成一条有地点的记忆，或者把时钟的读数当成事件。所以每一条都钉住
 * 「落点从哪来」与「该不该进记忆」。
 */

const lookups: ObservationLookups = {
  atOfHolder: (holderId) => (holderId === 'v0' ? { x: 5, y: 5 } : undefined),
  atOfBuilding: (instanceId) => (instanceId === 'bookshop#1' ? { x: 3, y: 4 } : undefined),
  buildingOfTask: (taskId) => (taskId === 'c_1' ? 'bookshop#1' : undefined),
};

test('交付：落点是那栋楼，不是那个人站的地方', () => {
  const change: WorldChange = {
    change: 'task.delivered',
    taskId: 'c_1',
    summary: '写爬虫',
    workerId: 'v0',
    source: 'feed',
    taskKind: 'code',
  };
  const observation = observationOf(change, 'ev_1', lookups)!;
  assert.deepEqual(observation.at, { x: 3, y: 4 }, '屋里收工，屋外看不见——落点必须是楼');
  assert.equal(observation.placeId, 'bookshop#1');
  assert.deepEqual(observation.actors, ['v0']);
});

test('交付：不知道在哪栋楼，就退回那个人站的地方', () => {
  const change: WorldChange = {
    change: 'task.delivered',
    taskId: 'c_unknown',
    summary: '写爬虫',
    workerId: 'v0',
    source: 'local',
    taskKind: 'quick',
  };
  const observation = observationOf(change, 'ev_1', lookups)!;
  assert.deepEqual(observation.at, { x: 5, y: 5 });
});

test('交付：连人在哪都不知道，就不记——世界不能假装知道', () => {
  const change: WorldChange = {
    change: 'task.delivered',
    taskId: 'c_unknown',
    summary: '写爬虫',
    workerId: 'v9',
    source: 'local',
    taskKind: 'quick',
  };
  assert.equal(observationOf(change, 'ev_1', lookups), null);
});

test('潮位与心电图都不进记忆', () => {
  // 潮位是 `now` 的纯函数，记它等于记时钟；心电图是本层的输出，
  // 喂回来就是自己吃自己。
  assert.equal(observationOf({ change: 'tide', level: 0.25, until: 1000 }, 'e', lookups), null);
  assert.equal(
    observationOf(
      {
        change: 'world.vitals',
        day: 0,
        meanValence: 0,
        meanArousal: 0.4,
        infoEntropy: 0.5,
        isolatedHoldersCount: 1,
      },
      'e',
      lookups,
    ),
    null,
  );
});

test('每一种会进记忆的改变，都带得动一个落点', () => {
  // 加一种 `WorldChange` 时这条会红：新的一种要么给出落点，要么显式返回 null。
  // 红在这里比红在「世界记得一件没发生过的事」要好查。
  const changes: WorldChange[] = [
    { change: 'task.delivered', taskId: 'c_1', summary: 's', workerId: 'v0', source: 'feed', taskKind: 'code' },
    { change: 'building.built', instanceId: 'bookshop#1', prefabId: 'bookshop', displayName: '书斋', summary: null },
    { change: 'building.removed', instanceId: 'bookshop#1', displayName: '书斋' },
    { change: 'miracle', miracle: 'lamp', at: { x: 12, y: 9 } },
    { change: 'weather', weather: 'storm' },
    {
      change: 'world.event',
      kind: 'tide_turn',
      text: '潮水退过一半，滩涂露出来了',
      placeId: 'place:12,7',
      where: { x: 12, y: 7 },
      actorId: null,
    },
  ];
  for (const change of changes) {
    const observation = observationOf(change, 'ev', lookups);
    assert.ok(observation !== null, `${change.change} 该进记忆`);
    assert.equal(typeof observation.at.x, 'number', `${change.change} 的落点必须是坐标`);
    assert.equal(typeof observation.at.y, 'number');
    assert.ok(observation.eventId === 'ev', '事件 id 由调用方给，与日志里那一条对齐');
  }
});

test('世界自己生的事：kind 原样透传，落点用世界给的，不在这里编', () => {
  const observation = observationOf(
    {
      change: 'world.event',
      kind: 'routine_done',
      text: '汐在旧站牌下认路',
      placeId: 'place:18,22',
      where: { x: 18, y: 22 },
      actorId: 'v1',
    },
    'e',
    lookups,
  )!;
  // 记忆层不认得 `routine_done` 这个 kind 也不要紧——kind 是开放字符串，
  // 落 `unknown` 先验；但落点编不得，编了就成了一件没在任何地方发生过的事。
  assert.equal(observation.kind, 'routine_done');
  assert.equal(observation.placeId, 'place:18,22');
  assert.deepEqual(observation.at, { x: 18, y: 22 });
  assert.deepEqual(observation.outcome, { what: '汐在旧站牌下认路' }, '文案是世界组织好的那句，不是兜底表');
  // `actors` 是**当事人**，不是目击者——目击者由感知模型按遮挡网格算。
  // 少了这一条，她对这件事的卷入度只有 0.15，显著度 0.4375 掉到 0.225，
  // 够不着 `T_write`：她自己的一天，她一件也记不住。
  assert.deepEqual(observation.actors, ['v1'], '做这件事的人是她');
});

test('潮水那件事没有当事人：actors 是空的，目击者交给感知模型', () => {
  const observation = observationOf(
    {
      change: 'world.event',
      kind: 'tide_turn',
      text: '潮水退过一半，滩涂露出来了',
      placeId: 'place:12,7',
      where: { x: 12, y: 7 },
      actorId: null,
    },
    'e',
    lookups,
  )!;
  assert.deepEqual(observation.actors, [], '潮水不是谁做的');
});

test('神迹的落点就是那格坐标，不借任何建筑', () => {
  const observation = observationOf({ change: 'miracle', miracle: 'tree', at: { x: 12, y: 9 } }, 'e', lookups)!;
  assert.deepEqual(observation.at, { x: 12, y: 9 });
  assert.equal(observation.kind, 'celebration');
});
