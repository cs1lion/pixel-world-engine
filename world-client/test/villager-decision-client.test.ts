/** 人物决策客户端只是运输：断网、超时、上游坏、空话，一律回 null 且不抛。
 *
 * **单独一个文件**是因为被测模块（`src/world/villager-decision-client.ts`）
 * 在 base 上不存在，`red:first` 只套 `test/` 的 diff、带不进新 src 文件，
 * 静态 import 会判成 module ERROR 而不是「断言先红」。登记进
 * `SNAPSHOT_LIKE_TESTS`，把「新模块有没有被测试钉住」交给普通 `npm test`。
 *
 * 这一组只钉一件事：**决策坏了世界不许坏，世界照旧走作息。**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const REQUEST = {
  villagerName: '炉匠',
  routineLabel: '锅炉房搬炭',
  day: 3,
  memories: [{ text: '昨天集市缺货', day: 2 }],
  availableSites: [
    { siteId: 'market', siteName: '集市', activities: ['trade'] },
    { siteId: 'boiler_annex#1', siteName: '锅炉房', activities: ['work'] },
  ],
};

test('运输侧：断网、超时、上游坏、空话，一律回 null 且不抛', async () => {
  const { createVillagerDecisionClient } = await import('../src/world/villager-decision-client.ts');

  const cases: Array<[string, () => Promise<Response>]> = [
    ['断网', async () => { throw new Error('ECONNREFUSED'); }],
    ['上游 500', async () => new Response('boom', { status: 500 })],
    ['没听懂', async () => Response.json({ ok: false, reason: '模型挂了' })],
    ['action 不是 follow/deviate', async () => Response.json({ ok: true, action: 'run_away' })],
    ['deviate 缺 siteId', async () => Response.json({ ok: true, action: 'deviate', activityId: 'trade', reason: '想去看看' })],
    ['deviate 缺 reason', async () => Response.json({ ok: true, action: 'deviate', siteId: 'market', activityId: 'trade' })],
    ['JSON 坏', async () => new Response('{', { status: 200 })],
  ];
  for (const [label, impl] of cases) {
    const client = createVillagerDecisionClient({ fetchImpl: impl as unknown as typeof fetch });
    assert.equal(await client(REQUEST), null, `${label} 时不该拿到决策`);
  }
});

test('运输侧：follow 正常返回', async () => {
  const { createVillagerDecisionClient } = await import('../src/world/villager-decision-client.ts');
  const client = createVillagerDecisionClient({
    fetchImpl: (async () => Response.json({ ok: true, action: 'follow', reason: '没什么特别的' })) as unknown as typeof fetch,
  });
  const result = await client(REQUEST);
  assert.deepEqual(result, { action: 'follow', reason: '没什么特别的' });
});

test('运输侧：deviate 正常返回', async () => {
  const { createVillagerDecisionClient } = await import('../src/world/villager-decision-client.ts');
  const client = createVillagerDecisionClient({
    fetchImpl: (async () => Response.json({
      ok: true,
      action: 'deviate',
      siteId: 'market',
      activityId: 'trade',
      reason: '记得昨天集市缺货',
    })) as unknown as typeof fetch,
  });
  const result = await client(REQUEST);
  assert.deepEqual(result, {
    action: 'deviate',
    siteId: 'market',
    activityId: 'trade',
    reason: '记得昨天集市缺货',
  });
});

test('运输侧：超时不卡世界', async () => {
  const { createVillagerDecisionClient } = await import('../src/world/villager-decision-client.ts');
  const client = createVillagerDecisionClient({
    timeoutMs: 20,
    fetchImpl: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch,
  });
  assert.equal(await client(REQUEST), null, '超时不该卡住世界');
});
