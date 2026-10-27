import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { claimContentFor, compile, FORBIDDEN_TOKENS } from '../src/world/memory/sanitize.ts';
import type { CompiledEvent } from '../src/world/memory/sanitize.ts';

/**
 * 上游事件的说法，从脱敏编译器那张表来。
 *
 * `claimContentFor` 从第一天起就写在 `sanitize.ts` 里，`FORBIDDEN_TOKENS`
 * 的注释还专门说「测试拿它扫 `claimContentFor` 的产物」——安全上它被当作
 * 边界的一部分，**而运行时一次都没读过它**。`ingestUpstream` 把
 * `valence` / `arousal` 显式传成 `undefined`，情绪落回 `defaultValence`
 * 那张世界侧的表；`what` 落回 `DEFAULT_WHAT`。
 *
 * 落回去的后果不是「换个说法」这么轻：`defaultArousal` 根本没有
 * `discipline` 与 `oracle_prayer` 两行，它们拿到的是通用的 0.3。于是
 * `COMPILE_TABLE` 上写着「高唤醒、负效价」的训诫，进世界时唤醒度 0.3——
 * 那句话在跑着的世界里一次都没实现过。
 *
 * 这一组测的是**接线本身**：编译器的定性一路带到记忆与断言，两边同源。
 */

/** 五种拓扑各跑一遍，返回「记忆里的说法」与「断言里的说法」。 */
function voices(topology: string, status: string): {
  readonly memory: { what: string; valence: number; arousal: number };
  readonly claim: { what: string; valence: number; arousal: number };
  readonly outcomeKeys: readonly string[];
  readonly voiceWhat: string;
} {
  const rt = new MemoryRuntime({ worldId: 'upstream-voice', occlusion: { isWalkable: () => true } });
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);
  const fact = rt.ingestUpstream(
    { topology: topology as never, status: status as never, retries: 1, elapsedMs: 5000, difficulty: 'hard' },
    1000,
    { placeId: 'p', at: { x: 0, y: 0 } },
    ['a'],
  );
  assert.ok(fact !== null, `${topology} 该编译出一条事件`);
  const entry = rt.viewOf('a')!.memories[0];
  assert.ok(entry !== undefined, '目击者该记下这一条');
  const claim = rt.world.createClaimFrom(fact.eventId, 'a', 2000);
  assert.ok(claim !== null, '该能为它造一条断言');
  return {
    memory: { what: entry.content.what, valence: entry.content.valence, arousal: entry.content.arousal },
    claim: { what: claim.content.what, valence: claim.content.valence, arousal: claim.content.arousal },
    outcomeKeys: Object.keys(fact.outcome).sort(),
    voiceWhat: fact.voice?.what ?? '',
  };
}

const TOPOLOGIES: ReadonlyArray<readonly [string, string]> = [
  ['execute', 'retrying'],
  ['retrieve', 'ok'],
  ['awaiting_human', 'blocked'],
  ['human_approved', 'ok'],
  ['human_rejected', 'ok'],
];

test('上游事件的说法来自编译器那张表，不是世界侧的先验默认值', () => {
  for (const [topology, status] of TOPOLOGIES) {
    const compiled = compile({
      topology: topology as never,
      status: status as never,
      retries: 1,
      elapsedMs: 5000,
      difficulty: 'hard',
    }) as CompiledEvent;
    const expected = claimContentFor(compiled);
    const got = voices(topology, status);
    assert.equal(got.memory.what, expected.what, `${topology} 的记忆该用编译器给的句子`);
    assert.equal(got.memory.arousal, expected.arousal, `${topology} 的唤醒度该用编译器给的`);
    assert.equal(got.memory.valence, expected.valence, `${topology} 的效价该用编译器给的`);
  }
});

test('训诫是高唤醒的：0.7，不是通用的 0.3', () => {
  // `defaultArousal` 里没有 `discipline` 这一行，它落到 `return 0.3`。
  // 接上之前，一条「人类打回」在上游被编成高唤醒的训诫，进世界只剩 0.3。
  const got = voices('human_rejected', 'ok');
  assert.equal(got.memory.arousal, 0.7, '训诫该是高唤醒的');
  assert.equal(got.memory.valence, -0.6, '该是负效价的');
  assert.equal(got.memory.what, '有人在祭坛被训诫了', '该说清是在祭坛');
});

test('祈祷的唤醒度也是编译器定的：0.4，不是 0.3', () => {
  const got = voices('awaiting_human', 'blocked');
  assert.equal(got.memory.arousal, 0.4, '等得越久越紧迫， arousial 该比默认高一档');
});

test('记忆与断言同源：同一条上游事件，两个读法一个字都不差', () => {
  // 少了这一条就会出现最坏的情况：接上编译器时只改了一处，记忆换了说法、
  // 断言还是老说法——同一件事在村里有两个版本，而它们本该是同一次感知。
  for (const [topology, status] of TOPOLOGIES) {
    const got = voices(topology, status);
    assert.deepEqual(got.memory, got.claim, `${topology} 的记忆与断言不一致`);
  }
});

test('编译器的句子也不许带上游的业务文本', () => {
  // `FORBIDDEN_TOKENS` 一直都在扫 `claimContentFor` 的产物，但那时它扫的是
  // 一份没人用的表。现在这张表真的进世界了，这道扫描才第一次有分量。
  for (const [topology, status] of TOPOLOGIES) {
    const got = voices(topology, status);
    for (const token of FORBIDDEN_TOKENS) {
      assert.ok(
        !got.voiceWhat.includes(token),
        `${topology} 的说法里出现了 ${token}——脱敏编译器的产物泄了`,
      );
    }
  }
});

test('脱敏的边界没被这次接线撑大：outcome 里还是只有那几个字段', () => {
  // 定性走事实的 `voice`，不走 `outcome`。`memory-runtime.test.ts` 那条
  // 「编译之后的事件里没有一处能带上游的业务文本」断言的是 outcome 的键，
  // 这里确认新加的这条路没有往 outcome 里塞东西。
  const got = voices('execute', 'retrying');
  assert.deepEqual(got.outcomeKeys, ['obstacle', 'retries']);
});

test('世界侧事件不受影响：没有 voice 时照旧按 kind 先验推', () => {
  const rt = new MemoryRuntime({ worldId: 'upstream-voice', occlusion: { isWalkable: () => true } });
  rt.syncHolders([{ holderId: 'a', type: 'character', at: { x: 0, y: 0 } }]);
  rt.observe(
    {
      eventId: 'mem_1',
      kind: 'milestone',
      placeId: 'p',
      at: { x: 0, y: 0 },
      actors: ['a'],
      outcome: {},
      importanceHint: 0.8,
    },
    undefined,
    1000,
  );
  const entry = rt.viewOf('a')!.memories[0]!;
  assert.equal(entry.content.what, '达成了一个里程碑', '世界侧事件照旧用 DEFAULT_WHAT');
  assert.equal(entry.content.valence, 0, 'milestone 没有先验效价');
  assert.equal(entry.content.arousal, 0.3, '落回 defaultArousal 的兜底值');
});
