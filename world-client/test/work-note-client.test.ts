/** 牌子客户端只是运输：断网、超时、上游坏、空话，一律回 null 且不抛。
 *
 * **单独一个文件**是因为被测模块（`src/world/work-note-client.ts`）在 base 上
 * 不存在，`red:first` 只套 `test/` 的 diff、带不进新 src 文件，静态 import 会
 * 判成 module ERROR 而不是「断言先红」。同一个理由已经在 `site-output` 上用过：
 * 登记进 `SNAPSHOT_LIKE_TESTS`，把「新模块有没有被测试钉住」交给普通 `npm test`。
 *
 * 这一组只钉一件事：**牌子坏了世界不许坏**。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('运输侧：断网、超时、上游坏、空话，一律回 null 且不抛', async () => {
  const { createWorkNoteClient } = await import('../src/world/work-note-client.ts');
  const request = {
    villagerId: 'v1',
    site: 'boiler_annex#1',
    siteName: '搬炭',
    activity: 'work',
    stock: 2,
    day: 1,
    people: [],
    canonical: '搬炭',
  };

  const cases: Array<[string, () => Promise<Response>]> = [
    ['断网', async () => { throw new Error('ECONNREFUSED'); }],
    ['上游 500', async () => new Response('boom', { status: 500 })],
    ['没听懂', async () => Response.json({ ok: false, text: null })],
    ['空话', async () => Response.json({ ok: true, text: '   ' })],
    ['字段不是字符串', async () => Response.json({ ok: true, text: 42 })],
    ['JSON 坏', async () => new Response('{', { status: 200 })],
  ];
  for (const [label, impl] of cases) {
    const client = createWorkNoteClient({ fetchImpl: impl as unknown as typeof fetch });
    assert.equal(await client(request), null, `${label} 时不该拿到牌子文案`);
  }

  // 正常一条：去掉首尾空白再交出去。
  const ok = createWorkNoteClient({
    fetchImpl: (async () => Response.json({ ok: true, text: '  弯腰把炭码齐  ' })) as unknown as typeof fetch,
  });
  assert.equal(await ok(request), '弯腰把炭码齐');

  // 超时：12s 没回就放弃，不许压着后面所有拍。
  const hang = createWorkNoteClient({
    timeoutMs: 20,
    fetchImpl: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch,
  });
  assert.equal(await hang(request), null, '超时不该卡住世界');
});
