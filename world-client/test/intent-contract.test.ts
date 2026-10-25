import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIntent } from '../src/world/intent-schema.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';

/**
 * 服务端 `/api/world/intent` 说出来的意图，客户端必须认得。
 *
 * 两份实现（`server/oracle/wire.py` 与 `src/world/intent-schema.ts`）各自校验一遍，
 * 各写一遍就一定会漂。这条测试拿**服务端会返回的那几种形状**当输入，
 * 喂给客户端真正的校验器——漂了当场红。
 *
 * 反方向的钉子（服务端收得下客户端发的请求）在 `server/tests/test_intent_api.py`。
 */

const templates = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);
const WORLD = { width: 96, height: 72 };

/**
 * 与 `server/oracle/api.py` 的 `command_to_intent` 逐条对应。
 *
 * 故意手写而不是从服务端生成：这条测试要说的是「客户端认得这几种形状」，
 * 从服务端生成会让它变成一句同义反复——服务端改坏了，生成的输入也跟着坏。
 */
const FROM_SERVER = {
  'weather.set rain': { kind: 'setWeather', weather: 'rain' },
  'weather.set storm': { kind: 'setWeather', weather: 'storm' },
  'tide.setLevel 1 / 30s': { kind: 'setTide', level: 1, durationMs: 30_000 },
  'tide.setLevel 0 / max': { kind: 'setTide', level: 0, durationMs: 120_000 },
  'building.add': { kind: 'build', templateId: 'code_forge', at: { x: 3, y: 4 } },
  'building.remove': { kind: 'demolish', templateId: 'ink_house' },
  'miracle.spawn 无坐标': { kind: 'miracle', miracle: 'cat', at: null },
  'miracle.spawn 带坐标': { kind: 'miracle', miracle: 'tree', at: { x: 40, y: 45 } },
  unknown: { kind: 'unknown', reason: '这句话不是在要求世界做任何事' },
} as const;

test('服务端会返回的每一种意图，客户端的校验器都收得下', () => {
  for (const [label, intent] of Object.entries(FROM_SERVER)) {
    assert.doesNotThrow(
      () => parseIntent(intent, templates, WORLD),
      `${label} 被客户端拒了——两边的形状已经漂了`,
    );
  }
});

test('服务端不会返回的「第九种意图」被客户端拒掉', () => {
  // 反过来钉：客户端不是什么都收。这条保证上面那条不是因为校验器太松才绿的。
  assert.throws(
    () => parseIntent({ kind: 'teleport', to: 'anywhere' }, templates, WORLD),
    /未知意图/,
  );
});

test('服务端的拨潮时长受同一个上限约束', () => {
  // 服务端 `rules/schema.py` 的 TIDE_OVERRIDE_MAX_MS 与这里必须一致。
  // 不一致的表现是：模型给 3 分钟，服务端收了，客户端拒了——用户看到"没听懂"，
  // 而实际上世界已经准备好执行了。
  assert.doesNotThrow(() =>
    parseIntent({ kind: 'setTide', level: 0.5, durationMs: 120_000 }, templates, WORLD),
  );
  assert.throws(
    () => parseIntent({ kind: 'setTide', level: 0.5, durationMs: 120_001 }, templates, WORLD),
    /最多 120000/,
  );
});
