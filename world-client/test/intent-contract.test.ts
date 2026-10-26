import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIntent } from '../src/world/intent-schema.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';

/**
 * 服务端 `/api/world/intent` 说出来的意图，客户端必须认得。
 *
 * 两份实现（`server/oracle/wire.py` 与 `src/world/intent-schema.ts`）各自校验一遍，
 * 各写一遍就一定会漂。这条测试拿**冻结样例**当输入，喂给客户端真正的校验器。
 *
 * 为什么是文件而不是这里手写一张表：手写的表只钉住「写这条测试的那天两边一致」。
 * `docs/intent.sample.json` 同时被 `server/tests/test_intent_api.py` 读，
 * 那边断言端点真的产出这些形状——于是这条测试钉的是**端点**，不是我的记性。
 * 任一端改了形状而没改样例，两份测试里必有一份先红。
 */

const templates = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);
const WORLD = { width: 96, height: 72 };

const SAMPLE = JSON.parse(
  readFileSync(new URL('../../docs/intent.sample.json', import.meta.url), 'utf8'),
) as {
  responses: { why: string; command: Record<string, unknown> | null; intent: Record<string, unknown> }[];
};

test('样例里服务端会返回的每一种意图，客户端的校验器都收得下', () => {
  assert.ok(SAMPLE.responses.length > 0, '样例空了，这条测试就等于没跑');
  for (const { why, intent } of SAMPLE.responses) {
    assert.doesNotThrow(
      () => parseIntent(intent, templates, WORLD),
      `「${why}」被客户端拒了——两边的形状已经漂了`,
    );
  }
});

test('样例覆盖了客户端的每一种意图，除了只能由规则产出的那三种', () => {
  // dispatch / complete / cancelPending 不经模型，服务端没有对应的白名单命令，
  // 所以它们不该出现在意图线样例里。反过来，其余每一种都必须有一条样例——
  // 少了就是一种「服务端会返回、但没人验证客户端认得」的形状。
  const covered = new Set(SAMPLE.responses.map((item) => String(item.intent.kind)));
  assert.deepEqual(
    [...covered].sort(),
    ['build', 'carry', 'demolish', 'miracle', 'setTide', 'setWeather', 'unknown'],
  );
});

test('服务端不会返回的「第十种意图」被客户端拒掉', () => {
  // 反过来钉：客户端不是什么都收。这条保证上面那条不是因为校验器太松才绿的。
  assert.throws(
    () => parseIntent({ kind: 'teleport', to: 'anywhere' }, templates, WORLD),
    /未知意图/,
  );
});

test('服务端的拨潮时长受同一个上限约束', () => {
  // 服务端 `rules/schema.py` 的 TIDE_OVERRIDE_MAX_MS 与这里必须一致。
  // 不一致的表现是：模型给 3 分钟，服务端收了，客户端拒了——用户看到"没听懂"，
  // 而实际上世界已经准备好执行了。样例里那条「正好等于上限」就是这条的正面用例。
  assert.doesNotThrow(() =>
    parseIntent({ kind: 'setTide', level: 0.5, durationMs: 120_000 }, templates, WORLD),
  );
  assert.throws(
    () => parseIntent({ kind: 'setTide', level: 0.5, durationMs: 120_001 }, templates, WORLD),
    /最多 120000/,
  );
});
