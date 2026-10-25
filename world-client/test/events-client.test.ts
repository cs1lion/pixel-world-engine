import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createEventsClient,
  nextCursor,
  parsePage,
  EVENTS_DEFAULT_LIMIT,
  EVENTS_URL,
  type EventsResult,
} from '../src/world/events-client.ts';

/** 造一个假 fetch：记下请求，返回给定响应。 */
function fakeFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { impl, calls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const page = (events: unknown[], latestId = events.length, hasMore = false) => ({
  events,
  latestId,
  hasMore,
});

const event = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  at: id * 10,
  kind: 'world.changed',
  actor: 'world',
  payload: { n: id },
  ...extra,
});

// ---------------------------------------------------------------- 请求形状

test('请求带上 since 与 limit', async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse(page([])));
  const client = createEventsClient({ fetchImpl: impl });
  await client.fetchSince(7);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0]!.url, 'http://x');
  assert.equal(url.pathname, EVENTS_URL);
  assert.equal(url.searchParams.get('since'), '7');
  assert.equal(url.searchParams.get('limit'), String(EVENTS_DEFAULT_LIMIT));
});

test('limit 可以显式给', async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse(page([])));
  await createEventsClient({ fetchImpl: impl }).fetchSince(0, 50);
  const url = new URL(calls[0]!.url, 'http://x');
  assert.equal(url.searchParams.get('limit'), '50');
});

test('是 GET，不是 POST', async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse(page([])));
  await createEventsClient({ fetchImpl: impl }).fetchSince(0);
  assert.equal(calls[0]!.init?.method, 'GET');
});

// ---------------------------------------------------------------- 成功路径

test('正常一页被解析出来', async () => {
  const { impl } = fakeFetch(() => jsonResponse(page([event(1), event(2)], 2, false)));
  const result = await createEventsClient({ fetchImpl: impl }).fetchSince(0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.events.length, 2);
  assert.deepEqual(result.page.events[0], {
    id: 1,
    at: 10,
    kind: 'world.changed',
    actor: 'world',
    payload: { n: 1 },
  });
  assert.equal(result.page.latestId, 2);
  assert.equal(result.page.hasMore, false);
});

test('空页是成功，不是失败', async () => {
  const { impl } = fakeFetch(() => jsonResponse(page([], 5, false)));
  const result = await createEventsClient({ fetchImpl: impl }).fetchSince(5);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.page.events, []);
  assert.equal(result.page.latestId, 5);
});

test('中文 payload 原样保留', async () => {
  const raw = { id: 1, at: 0, kind: 'oracle.spoken', actor: 'player', payload: { raw: '让天晴' } };
  const { impl } = fakeFetch(() => jsonResponse(page([raw], 1)));
  const result = await createEventsClient({ fetchImpl: impl }).fetchSince(0);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.page.events[0]!.payload['raw'], '让天晴');
});

// ---------------------------------------------------------------- 失败路径

test('服务端 5xx 落到 ok:false，带状态码', async () => {
  const { impl } = fakeFetch(() => jsonResponse({ detail: 'boom' }, 503));
  const result = await createEventsClient({ fetchImpl: impl }).fetchSince(0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
  assert.match(result.reason, /503/);
});

test('网络层失败落到 ok:false，不抛异常', async () => {
  const { impl } = fakeFetch(() => {
    throw new Error('ECONNREFUSED');
  });
  const result = await createEventsClient({ fetchImpl: impl }).fetchSince(0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, null);
  assert.match(result.reason, /ECONNREFUSED/);
});

test('超时落到 ok:false，且真的 abort 了', async () => {
  let aborted = false;
  const { impl } = fakeFetch((_url, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  });
  const result = await createEventsClient({ fetchImpl: impl, timeoutMs: 5 }).fetchSince(0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(aborted, true);
  assert.match(result.reason, /超时/);
});

test('返回的不是 JSON 落到 ok:false', async () => {
  const { impl } = fakeFetch(() => new Response('<html>502</html>', { status: 200 }));
  const result = await createEventsClient({ fetchImpl: impl }).fetchSince(0);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /不是 JSON/);
});

test('任何失败都不抛异常——调用方是世界主循环', async () => {
  const failures: (() => Response | Promise<Response>)[] = [
    () => jsonResponse({}, 500),
    () => {
      throw new Error('network');
    },
    () => new Response('not json', { status: 200 }),
    () => jsonResponse({ events: 'oops', latestId: 0, hasMore: false }),
  ];
  for (const handler of failures) {
    const { impl } = fakeFetch(handler);
    const result: EventsResult = await createEventsClient({ fetchImpl: impl }).fetchSince(0);
    assert.equal(result.ok, false);
  }
});

// ---------------------------------------------------------------- 形状校验

test('形状不对整页作废，不做部分接受', () => {
  // 跳过坏的那条等于悄悄改变世界的因果链，调用方不会知道。
  const cases: unknown[] = [
    null,
    [],
    'text',
    {},
    { events: [] },
    { events: [], latestId: -1, hasMore: false },
    { events: [], latestId: 0, hasMore: 'no' },
    { events: [event(1), { id: 2 }], latestId: 2, hasMore: false },
    { events: [{ ...event(1), at: -5 }], latestId: 1, hasMore: false },
    { events: [{ ...event(1), kind: '' }], latestId: 1, hasMore: false },
    { events: [{ ...event(1), actor: '' }], latestId: 1, hasMore: false },
    { events: [{ ...event(1), payload: [] }], latestId: 1, hasMore: false },
    { events: [{ ...event(1), id: 0 }], latestId: 1, hasMore: false },
    { events: [{ ...event(1), id: 1.5 }], latestId: 1, hasMore: false },
  ];
  for (const body of cases) {
    assert.equal(parsePage(body), null, `应作废：${JSON.stringify(body)}`);
  }
});

test('页内 id 必须严格递增', () => {
  const outOfOrder = { events: [event(2), event(1)], latestId: 2, hasMore: false };
  assert.equal(parsePage(outOfOrder), null, '乱序会让调用方的游标原地打转');
  const duplicate = { events: [event(1), event(1)], latestId: 1, hasMore: false };
  assert.equal(parsePage(duplicate), null);
});

test('页内最大 id 不得超过 latestId', () => {
  const inconsistent = { events: [event(1), event(5)], latestId: 3, hasMore: false };
  assert.equal(parsePage(inconsistent), null, '超了说明两边对日志的认知已经不一致');
});

test('最新一页只有一条时合法', () => {
  assert.notEqual(parsePage({ events: [event(3)], latestId: 3, hasMore: false }), null);
});

// ---------------------------------------------------------------- 断点续读

test('断点续读拼起来不重不漏', async () => {
  // 用一份内存日志模拟服务端。
  const all = [event(1), event(2), event(3), event(4), event(5)];
  const { impl } = fakeFetch((url) => {
    const params = new URL(url, 'http://x').searchParams;
    const since = Number(params.get('since'));
    const limit = Number(params.get('limit'));
    const slice = all.filter((e) => e.id > since).slice(0, limit);
    const latestId = all[all.length - 1]!.id;
    return jsonResponse(page(slice, latestId, slice.length > 0 && slice[slice.length - 1]!.id < latestId));
  });

  const client = createEventsClient({ fetchImpl: impl });
  const collected: number[] = [];
  let since = 0;
  for (let guard = 0; guard < 10; guard += 1) {
    const result = await client.fetchSince(since, 2);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const e of result.page.events) collected.push(e.id);
    since = nextCursor(result.page, since);
    if (!result.page.hasMore) break;
  }
  assert.deepEqual(collected, [1, 2, 3, 4, 5]);
});

test('拿 latestId 当游标会漏事件——这就是 nextCursor 存在的理由', async () => {
  const all = [event(1), event(2), event(3), event(4), event(5)];
  const { impl } = fakeFetch((url) => {
    const params = new URL(url, 'http://x').searchParams;
    const since = Number(params.get('since'));
    const limit = Number(params.get('limit'));
    const slice = all.filter((e) => e.id > since).slice(0, limit);
    return jsonResponse(page(slice, 5, slice.length > 0 && slice[slice.length - 1]!.id < 5));
  });
  const client = createEventsClient({ fetchImpl: impl });

  const first = await client.fetchSince(0, 2);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  // 反例：用 latestId 当游标，3 4 5 直接被跳过。
  const wrong = await client.fetchSince(first.page.latestId, 2);
  assert.equal(wrong.ok, true);
  if (!wrong.ok) return;
  assert.deepEqual(wrong.page.events, [], 'latestId 是日志末端，不是这一页的末端');
  // 正解：用这一页最后一条的 id。
  assert.equal(nextCursor(first.page, 0), 2);
});

test('nextCursor：空页时游标原地不动', () => {
  assert.equal(nextCursor({ events: [], latestId: 42, hasMore: false }, 17), 17);
});

test('nextCursor：非空页取这一页最后一条的 id', () => {
  const page1 = {
    events: [event(3), event(4)],
    latestId: 100,
    hasMore: true,
  };
  assert.equal(nextCursor(page1, 0), 4);
});

// ---------------------------------------------------------------- 冻结样例

test('docs/events-page.sample.json 能通过解析（服务端与客户端对形状的一致口径）', () => {
  // 这份样例是线协议的冻结产物：服务端 `test_events_api.py` 断言自己产出的
  // 形状与它一致，客户端这里断言自己读得懂。两边各自冻结，改协议时两边同时红。
  const raw = JSON.parse(
    readFileSync(new URL('../../docs/events-page.sample.json', import.meta.url), 'utf8'),
  ) as unknown;
  const parsed = parsePage(raw);
  assert.notEqual(parsed, null);
  if (parsed === null) return;
  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.latestId, 3);
  assert.equal(parsed.hasMore, false);
  assert.equal(nextCursor(parsed, 0), 3);
});
