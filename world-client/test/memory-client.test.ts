import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryClient,
  parseEntry,
  parseList,
  MEMORY_ENTRY_URL,
  MEMORY_LIST_URL,
  type MemoryResult,
} from '../src/world/memory-client.ts';

/** 造一个假 fetch：记下请求，返回给定响应。与 events-client 的测试同一套。 */
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

const row = (path: string, extra: Record<string, unknown> = {}) => ({
  kind: 'event',
  title: '渡口的第一夜',
  path,
  summary: '我在旧站牌下点了一盏灯。',
  at: 1500,
  day: 0,
  section: null,
  ...extra,
});

const listPage = (entries: unknown[], count = entries.length) => ({ entries, count });

/** 把一次失败的理由取出来。断言里到处要用，值得一个帮手。 */
function reasonOf<T>(result: MemoryResult<T>): string {
  assert.equal(result.ok, false, `本该失败：${JSON.stringify(result)}`);
  return result.ok ? '' : result.reason;
}

// ---------------------------------------------------------------- 请求形状

test('列出记忆打到 /api/memory/list', async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse(listPage([])));
  await createMemoryClient({ fetchImpl: impl }).list();

  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url, 'http://x').pathname, MEMORY_LIST_URL);
  assert.equal(calls[0]!.init?.method, 'GET');
});

test('读一份记忆把 path 放进查询参数', async () => {
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ path: 'events/E0001.md', section: null, kind: 'event', title: '甲', text: '正文' }),
  );
  await createMemoryClient({ fetchImpl: impl }).read(row('events/E0001.md'));

  const url = new URL(calls[0]!.url, 'http://x');
  assert.equal(url.pathname, MEMORY_ENTRY_URL);
  assert.equal(url.searchParams.get('path'), 'events/E0001.md');
  // 一事一文件的那种不带小节名——多带一个空参数，服务端要凭空猜它是什么意思。
  assert.equal(url.searchParams.has('section'), false);
});

test('读居民记忆时把小节名一起带回去', async () => {
  // 列表答应的是一条记忆。只带 path 的话，服务端只能把整本档案翻出来，
  // 而点开「她记得那场雨」的人想读的是那一条。
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ path: 'characters/莞尔.md', section: '她记得那场雨', kind: 'character', title: '莞尔', text: '正文' }),
  );
  const row = {
    kind: 'character',
    title: '她记得那场雨',
    path: 'characters/莞尔.md',
    section: '她记得那场雨',
    summary: '她把伞留在了渡口。',
    at: 9000,
    day: 0,
  };
  await createMemoryClient({ fetchImpl: impl }).read(row);

  const url = new URL(calls[0]!.url, 'http://x');
  assert.equal(url.searchParams.get('path'), 'characters/莞尔.md');
  assert.equal(url.searchParams.get('section'), '她记得那场雨');
});

test('路径原样到达服务端：中文与斜杠都不丢', async () => {
  const { impl, calls } = fakeFetch(() =>
    jsonResponse({ path: 'characters/莞尔.md', section: null, kind: 'character', title: '莞尔', text: '正文' }),
  );
  await createMemoryClient({ fetchImpl: impl }).read(row('characters/莞尔.md'));
  // 编码成什么样是 URLSearchParams 的事（斜杠会变成 %2F，中文变成 %XX）。
  // 该守的是另一件事：服务端解回来必须还是原来那个路径。
  // 解不回来的话不会静悄悄——`resolve_entry` 的白名单会拒它，报 422。
  const url = new URL(calls[0]!.url, 'http://x');
  assert.equal(url.searchParams.get('path'), 'characters/莞尔.md');
});

test('读之前不查空路径', async () => {
  const { impl, calls } = fakeFetch(() => jsonResponse({}));
  const client = createMemoryClient({ fetchImpl: impl });
  const blank = row('events/E0001.md', { path: '' });
  assert.equal(reasonOf(await client.read(blank)), '没说读哪一份记忆');
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- 读成功

test('列出记忆', async () => {
  const { impl } = fakeFetch(() => jsonResponse(listPage([row('events/E0001.md')])));
  const result = await createMemoryClient({ fetchImpl: impl }).list();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.count, 1);
  assert.equal(result.value.entries[0]!.path, 'events/E0001.md');
});

test('读一份记忆的全文', async () => {
  const { impl } = fakeFetch(() =>
    jsonResponse({
      path: 'characters/莞尔.md',
      kind: 'character',
      title: '莞尔',
      text: '# 莞尔\n\n## 她记得我点了灯\n\n依据：#1\n\n正文\n',
    }),
  );
  const result = await createMemoryClient({ fetchImpl: impl }).read(row('characters/莞尔.md'));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.kind, 'character');
  assert.match(result.value.text, /她记得我点了灯/);
});

test('at 可以是 null：手写的记忆没有 frontmatter', async () => {
  const { impl } = fakeFetch(() =>
    jsonResponse(listPage([row('events/E0009.md', { at: null, day: null })])),
  );
  const result = await createMemoryClient({ fetchImpl: impl }).list();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.entries[0]!.at, null);
});

// ---------------------------------------------------------------- 读失败

test('服务端不可达时降级成 ok: false，不抛', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  const result = await createMemoryClient({ fetchImpl: impl }).list();
  assert.equal(reasonOf(result), '记忆目录不可达：ECONNREFUSED');
});

test('超时按失败算，不说成服务端错了', async () => {
  const impl = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch;
  const result = await createMemoryClient({ fetchImpl: impl, timeoutMs: 5 }).list();
  assert.match(reasonOf(result), /超时 5ms/);
});

test('422 把服务端的话原样给人看', async () => {
  // 「没有这份记忆」是服务端能说出的最具体的一句，客户端不该用自己的话盖掉它。
  const { impl } = fakeFetch(() => jsonResponse({ detail: '没有这份记忆：events/E9999.md' }, 422));
  const result = await createMemoryClient({ fetchImpl: impl }).read(row('events/E9999.md'));
  assert.equal(reasonOf(result), '没有这份记忆：events/E9999.md');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 422);
});

test('422 但没有 detail 时退回状态码', async () => {
  const { impl } = fakeFetch(() => jsonResponse({}, 422));
  assert.equal(reasonOf(await createMemoryClient({ fetchImpl: impl }).list()), '记忆目录返回 422');
});

test('返回的不是 JSON', async () => {
  const { impl } = fakeFetch(() => new Response('<html>nope', { status: 200 }));
  assert.equal(reasonOf(await createMemoryClient({ fetchImpl: impl }).list()), '记忆目录返回的不是 JSON');
});

test('列表形状不对就整页作废', async () => {
  const bad: unknown[] = [
    null,
    [],
    {},
    { entries: 'x', count: 0 },
    { entries: [], count: 1 }, // 服务端少数了一条
    { entries: [null], count: 1 },
    { entries: [row('a.md', { title: '' })], count: 1 },
    { entries: [row('a.md', { at: -1 })], count: 1 },
    { entries: [row('a.md', { at: 'x' })], count: 1 },
    { entries: [row('a.md', { day: 'x' })], count: 1 },
    { entries: [row('a.md', { summary: 5 })], count: 1 },
    { entries: [row('a.md', { section: '' })], count: 1 },
    { entries: [row('a.md')], count: '1' },
    // at 与 day 只有一个：两边对这条记忆的认知已经不一致。
    { entries: [{ kind: 'event', title: '甲', path: 'a.md', summary: 's', at: 1500 }], count: 1 },
    { entries: [{ kind: 'event', title: '甲', path: 'a.md', summary: 's', day: 0 }], count: 1 },
    // 有一个是 null、另一个不是：同样不一致。
    { entries: [row('a.md', { day: null })], count: 1 },
    { entries: [row('a.md', { at: null })], count: 1 },
  ];
  for (const body of bad) {
    assert.equal(parseList(body), null, `本该作废：${JSON.stringify(body)}`);
  }
});

test('单条形状不对就作废', async () => {
  const bad: unknown[] = [
    null,
    {},
    { path: 'a.md', kind: 'event', title: '甲' }, // 缺 text
    { path: '', kind: 'event', title: '甲', text: 'x' },
    { path: 'a.md', kind: 'event', title: '甲', text: 42 },
    { path: 'a.md', kind: 'event', title: '甲', text: 'x', section: '' },
    { path: 'a.md', kind: 'event', title: '甲', text: 'x', section: 7 },
  ];
  for (const body of bad) {
    assert.equal(parseEntry(body), null, `本该作废：${JSON.stringify(body)}`);
  }
});

test('客户端自己也截一遍全文与摘要', () => {
  // 服务端换了上限时，界面不该跟着变形。
  const entry = parseEntry({ path: 'a.md', kind: 'event', title: '甲', text: 'x'.repeat(50) });
  assert.equal(entry?.text.length, 50);
  const list = parseList(listPage([row('a.md', { summary: 'y'.repeat(500) })]));
  assert.equal(list?.entries[0]!.summary.length, 120);
});

test('服务端该同时给 at 与 day：少一个就整页作废', () => {
  // 第几个世界日由服务端算（「一天多长」这个常数只在它那里有一份）。
  // 客户端少收一个字段时不该自己补——补出来的那一天可能是错的，
  // 而错的表现是「同一天的记忆被拆成两天」，在界面上看不出来。
  const base = { kind: 'event', title: '甲', path: 'a.md', summary: 's' };
  assert.equal(parseList(listPage([{ ...base, at: 1500 }])), null);
  assert.equal(parseList(listPage([{ ...base, day: 0 }])), null);
  assert.equal(parseList(listPage([{ ...base, at: 1500, day: null }])), null);
  assert.notEqual(parseList(listPage([{ ...base, at: 1500, day: 0 }])), null);
  assert.notEqual(parseList(listPage([{ ...base, at: null, day: null }])), null);
});
