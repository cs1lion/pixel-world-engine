import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CreatorSchemaError,
  DIRECTOR_EVENT_KINDS,
  GENESIS_COMMAND_KINDS,
  parseGenesisCommandBatch,
  type GenesisCommand,
  type InjectEventCommand,
  type PlaceBuildingCommand,
  type SeedHistoryCommand,
} from '../src/world/creator/schema.ts';
import type { PrefabBlueprint } from '../src/world/types.ts';

/**
 * 外环的第一道门禁：五条创世指令的白名单。
 *
 * 这些测试钉的是「什么能进世界、什么当场退回」——造物主没有旁路，
 * 模型多写一个字段、多编一个模板名、引一个不存在的角色，都必须在这里被挡住。
 */

const template = (id: string): PrefabBlueprint => ({
  id,
  displayName: id,
  zone: 'industry',
  footprint: { w: 4, h: 3 },
  clearMargin: 1,
  door: { x: 2, y: 3 },
  workSpots: [{ x: 2, y: 2 }],
  chimney: { x: 3, y: 0 },
  accent: 'smoke',
  silhouette: 'gable',
  boundTask: null,
  palette: { body: 0x1a4d2e, roof: 0x5c4033, trim: 0x8b7355, window: 0xf5deb3 },
});

const templates = new Map<string, PrefabBlueprint>([
  ['iron_workshop', template('iron_workshop')],
  ['tavern', template('tavern')],
]);

const worldSize = { width: 64, height: 64 };
const existingChars = new Set(['Alice', 'Bob']);

const parse = (commands: unknown[]) =>
  parseGenesisCommandBatch(
    { version: 1, commands },
    { templates, worldSize, existingChars },
  );

// ---------------------------------------------------------------- 白名单本身

test('五条指令就是全部白名单，没有第六种', () => {
  assert.deepEqual([...GENESIS_COMMAND_KINDS], [
    'CreateRegion',
    'PlaceBuilding',
    'SpawnCharacter',
    'SeedHistory',
    'InjectEvent',
  ]);
});

test('不在白名单里的 kind 被拒，并指名可选值', () => {
  assert.throws(
    () => parse([{ kind: 'DestroyWorld' }]),
    (err: unknown) =>
      err instanceof CreatorSchemaError && /不在白名单/.test(err.message) && /CreateRegion/.test(err.message),
  );
});

// ---------------------------------------------------------------- CreateRegion

test('CreateRegion 接受合法输入', () => {
  const batch = parse([
    {
      kind: 'CreateRegion',
      name: '迷雾森林',
      boundaries: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      terrainType: 'forest',
      environmentFeatures: ['fog', 'lights'],
    },
  ]);

  const region = batch.commands[0];
  assert.equal(region?.kind, 'CreateRegion');
  assert.equal(region?.name, '迷雾森林');
  assert.deepEqual((region as { boundaries: unknown[] }).boundaries.length, 3);
});

test('CreateRegion 拒绝未知字段——多写一个就不行', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'CreateRegion',
          name: '迷雾森林',
          boundaries: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
          terrainType: 'forest',
          population: 30,
        },
      ]),
    /未知字段 "population"/,
  );
});

test('CreateRegion 的多边形至少要 3 个点', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'CreateRegion',
          name: '一条线',
          boundaries: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
          terrainType: 'plains',
        },
      ]),
    /至少需要 3 个点/,
  );
});

test('CreateRegion 的地形类型必须在白名单里', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'CreateRegion',
          name: '虚空',
          boundaries: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
          terrainType: 'void',
        },
      ]),
    /terrainType 只能取/,
  );
});

// ---------------------------------------------------------------- PlaceBuilding

test('PlaceBuilding 接受合法输入', () => {
  const batch = parse([
    { kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 }, purpose: '铁匠铺' },
  ]);
  assert.equal(batch.commands[0]?.kind, 'PlaceBuilding');
});

test('PlaceBuilding 拒绝模型发明的模板', () => {
  assert.throws(
    () => parse([{ kind: 'PlaceBuilding', templateId: 'magic_tower', at: { x: 5, y: 5 } }]),
    /未知模板 "magic_tower"/,
  );
});

test('PlaceBuilding 拒绝十六进制色值——那会绕开调色板预算', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'PlaceBuilding',
          templateId: 'iron_workshop',
          at: { x: 5, y: 5 },
          palette: { body: '#ff0000' },
        },
      ]),
    /不接受十六进制/,
  );
});

test('PlaceBuilding 拒绝模板没有的调色板槽', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'PlaceBuilding',
          templateId: 'iron_workshop',
          at: { x: 5, y: 5 },
          palette: { banner: 'pale' },
        },
      ]),
    /未知槽 "banner"/,
  );
});

test('PlaceBuilding 拒绝世界之外的坐标', () => {
  assert.throws(
    () => parse([{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 100, y: 5 } }]),
    /在世界之外/,
  );
});

test('PlaceBuilding 接受模板已有的调色板槽', () => {
  const batch = parse([
    {
      kind: 'PlaceBuilding',
      templateId: 'iron_workshop',
      at: { x: 5, y: 5 },
      palette: { roof: 'cloak' },
    },
  ]);
  const cmd = batch.commands[0] as PlaceBuildingCommand;
  assert.deepEqual(cmd.palette, { roof: 'cloak' });
});

// ---------------------------------------------------------------- SpawnCharacter

test('SpawnCharacter 接受合法输入', () => {
  const batch = parse([
    {
      kind: 'SpawnCharacter',
      name: 'Charlie',
      role: '学者',
      startingLocation: { x: 20, y: 20 },
      personalityTraits: ['聪明', '好奇'],
    },
  ]);
  assert.equal(batch.commands[0]?.kind, 'SpawnCharacter');
});

test('SpawnCharacter 拒绝连到不存在的单位', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'SpawnCharacter',
          name: 'Dave',
          role: '商人',
          startingLocation: { x: 20, y: 20 },
          relationships: [
            { targetName: 'Nobody', relationType: 'friend', strength: 0.5 },
          ],
        },
      ]),
    /尚未存在/,
  );
});

test('SpawnCharacter 拒绝范围外的关系强度', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'SpawnCharacter',
          name: 'Eve',
          role: '农夫',
          startingLocation: { x: 20, y: 20 },
          relationships: [
            { targetName: 'Alice', relationType: 'enemy', strength: 2 },
          ],
        },
      ]),
    /必须在 -1 到 1 之间/,
  );
});

// ---------------------------------------------------------------- SeedHistory

test('SeedHistory 接受引用了真实单位的历史', () => {
  const batch = parse([
    { kind: 'SeedHistory', eventKind: 'wedding', dayOffset: -30, participants: ['Alice', 'Bob'] },
  ]);
  const cmd = batch.commands[0] as SeedHistoryCommand;
  assert.deepEqual(cmd.participants, ['Alice', 'Bob']);
});

test('SeedHistory 拒绝编造出来的参与者——这是溯源红线', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'SeedHistory',
          eventKind: 'accident',
          dayOffset: -7,
          participants: ['Alice', 'Ghost'],
        },
      ]),
    /溯源红线/,
  );
});

test('SeedHistory 至少要一个参与者', () => {
  assert.throws(
    () => parse([{ kind: 'SeedHistory', eventKind: 'quiet_day', dayOffset: -1, participants: [] }]),
    /至少需要 1 个参与者/,
  );
});

// ---------------------------------------------------------------- InjectEvent（导演专用）

test('InjectEvent 接受白名单里的导演事件', () => {
  const batch = parse([
    { kind: 'InjectEvent', eventKind: 'visitor_arrival', timing: { dayOffset: 5 }, scope: 'global' },
  ]);
  const cmd = batch.commands[0] as InjectEventCommand;
  assert.equal(cmd.eventKind, 'visitor_arrival');
});

test('InjectEvent 拒绝导演自己编的事件类型', () => {
  assert.throws(
    () =>
      parse([
        { kind: 'InjectEvent', eventKind: 'dragon_attack', timing: { dayOffset: 5 }, scope: 'global' },
      ]),
    /eventKind 只能取/,
  );
});

test('InjectEvent 只能注入未来——导演不能改写昨天', () => {
  assert.throws(
    () =>
      parse([
        { kind: 'InjectEvent', eventKind: 'festival_start', timing: { dayOffset: -1 }, scope: 'global' },
      ]),
    /必须是正整数/,
  );
});

test('InjectEvent 的 worldTime 必须在 0..23', () => {
  assert.throws(
    () =>
      parse([
        {
          kind: 'InjectEvent',
          eventKind: 'tavern_feast',
          timing: { dayOffset: 1, worldTime: 24 },
          scope: 'global',
        },
      ]),
    /0\.\.23/,
  );
});

test('导演事件白名单里的每一种都真的能通过校验', () => {
  for (const kind of DIRECTOR_EVENT_KINDS) {
    const batch = parse([
      { kind: 'InjectEvent', eventKind: kind, timing: { dayOffset: 1 }, scope: 'global' },
    ]);
    assert.equal(batch.commands.length, 1, `${kind} 应该通过`);
  }
});

// ---------------------------------------------------------------- 批处理

test('一次批处理可以混合多条指令', () => {
  const batch = parse([
    {
      kind: 'CreateRegion',
      name: '新大陆',
      boundaries: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }],
      terrainType: 'plains',
    },
    { kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } },
    { kind: 'SpawnCharacter', name: 'Frank', role: '工匠', startingLocation: { x: 10, y: 10 } },
  ]);

  assert.deepEqual(
    batch.commands.map((c: GenesisCommand) => c.kind),
    ['CreateRegion', 'PlaceBuilding', 'SpawnCharacter'],
  );
});

test('坏掉的是第几条，报错就说是第几条', () => {
  assert.throws(
    () =>
      parse([
        { kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } },
        { kind: 'PlaceBuilding', templateId: 'nope', at: { x: 9, y: 9 } },
      ]),
    /commands\[1\] 无效/,
  );
});

test('空批处理被拒——一次什么也没说的提交不是创世', () => {
  assert.throws(() => parse([]), /不能是空数组/);
});

// ---------------------------------------------------------------- 上下文

test('批处理带上设定包上下文', () => {
  const batch = parseGenesisCommandBatch(
    {
      version: 1,
      commands: [{ kind: 'PlaceBuilding', templateId: 'iron_workshop', at: { x: 5, y: 5 } }],
      context: { settingPackId: 'shangyou-v1', promptHash: 'abc123', llmModel: 'claude' },
    },
    { templates, worldSize, existingChars },
  );

  assert.equal(batch.context?.settingPackId, 'shangyou-v1');
  assert.equal(batch.context?.llmModel, 'claude');
});

test('上下文里的未知字段也被拒', () => {
  assert.throws(
    () =>
      parseGenesisCommandBatch(
        { version: 1, commands: [{ kind: 'PlaceBuilding', templateId: 'tavern', at: { x: 1, y: 1 } }], context: { settingPackId: 'x', secret: 'y' } },
        { templates, worldSize, existingChars },
      ),
    /未知字段 "secret"/,
  );
});
