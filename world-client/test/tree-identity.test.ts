import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/**
 * 身份模块是本轮新增的脚本。red-first 会把这份测试单独套到 base 上，而 base
 * 里没有这个文件——直接 `import` 会以 ERR_MODULE_NOT_FOUND 结束，分类器会把
 * 它判成 ERROR（基础设施问题），不是「红灯红在断言上」。
 *
 * 所以：动态 import + 吞掉「模块不存在」，让每条用例先断言导出函数存在。
 * base 上缺模块 → `typeof` 断言失败（PASS 的红）；新码上 → 继续跑真实用例。
 * 这也是 `docs/OPEN_ISSUES.md` B7 的同一形状，只是从「新导出」扩到「新模块」。
 */
type Identity = { worktree: string; port: number; startedAt: string };
type VerifyResult =
  | { skipped: true; reason: string }
  | { skipped: false; identity: Identity };
interface IdentityModule {
  sameWorktree?: (a: string, b: string) => boolean;
  validateTreeIdentity?: (body: unknown) => Identity;
  treeIdentityUrl?: (baseUrl: string) => URL;
  verifyTreeIdentity?: (
    baseUrl: string,
    options?: Record<string, unknown>,
  ) => Promise<VerifyResult>;
  TreeIdentityError?: new (code: string, message: string) => Error & { code?: string };
}

const MODULE_PATH: string = '../scripts/lib/tree-identity.mjs';
const load = async (): Promise<IdentityModule> => {
  try {
    return (await import(MODULE_PATH)) as unknown as IdentityModule;
  } catch {
    return {};
  }
};

const treeA = resolve(process.cwd(), 'tree-a');
const treeB = resolve(process.cwd(), 'tree-b');
const identity = (worktree: string, port = 5211): Identity => ({
  worktree,
  port,
  startedAt: '2026-11-06T10:00:00.000Z',
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** 每次调用都返回一份新的 Response：waitHttp 与身份读取各消费一次。 */
const fetchReturning = (body: unknown, status = 200) => async (): Promise<Response> =>
  jsonResponse(body, status);

test('返回体形状：只认绝对路径 / 端口整数 / 可解析启动时间', async () => {
  const lib = await load();
  assert.equal(typeof lib.validateTreeIdentity, 'function', '身份模块缺 validateTreeIdentity');

  const good = identity(treeA, 5213);
  assert.deepEqual(lib.validateTreeIdentity!(good), good);

  assert.throws(() => lib.validateTreeIdentity!(null), /不是对象/);
  assert.throws(() => lib.validateTreeIdentity!([]), /不是对象/);
  assert.throws(
    () => lib.validateTreeIdentity!({ ...good, worktree: 'relative/path' }),
    /绝对路径/,
  );
  assert.throws(
    () => lib.validateTreeIdentity!({ ...good, port: '5213' }),
    /1–65535/,
  );
  assert.throws(
    () => lib.validateTreeIdentity!({ ...good, startedAt: 'not-a-date' }),
    /可解析的时间串/,
  );
});

test('路径比较：绝对路径、分隔符与 Windows 大小写不敏感', async () => {
  const lib = await load();
  assert.equal(typeof lib.sameWorktree, 'function', '身份模块缺 sameWorktree');

  assert.equal(lib.sameWorktree!(treeA, treeA), true);
  assert.equal(lib.sameWorktree!(treeA, `${treeA}/`), true);
  assert.equal(lib.sameWorktree!(treeA, treeB), false);
  assert.equal(lib.sameWorktree!('relative/a', 'relative/a'), false);
  if (process.platform === 'win32') {
    assert.equal(lib.sameWorktree!(treeA, treeA.toUpperCase()), true);
  }
});

test('身份端点 URL：丢掉查询串，固定为 /__tree-id', async () => {
  const lib = await load();
  assert.equal(typeof lib.treeIdentityUrl, 'function', '身份模块缺 treeIdentityUrl');

  assert.equal(
    lib.treeIdentityUrl!('http://127.0.0.1:5213/?ledger=off&debug=1').href,
    'http://127.0.0.1:5213/__tree-id',
  );
  assert.equal(
    lib.treeIdentityUrl!('http://127.0.0.1:5213/base/path').href,
    'http://127.0.0.1:5213/__tree-id',
  );
});

test('同一棵工作树：放行并带回身份读数', async () => {
  const lib = await load();
  assert.equal(typeof lib.verifyTreeIdentity, 'function', '身份模块缺 verifyTreeIdentity');

  const result = await lib.verifyTreeIdentity!('http://127.0.0.1:5213/', {
    fetchImpl: fetchReturning(identity(treeA, 5213)),
    expectedWorktree: treeA,
    env: {},
  });
  assert.equal(result.skipped, false);
  if (result.skipped === false) {
    assert.equal(result.identity.worktree, treeA);
    assert.equal(result.identity.port, 5213);
  }
});

test('不同工作树：判红，并同时打印「连的是谁」与「我站在哪」', async () => {
  const lib = await load();
  assert.equal(typeof lib.verifyTreeIdentity, 'function', '身份模块缺 verifyTreeIdentity');
  assert.equal(typeof lib.TreeIdentityError, 'function', '身份模块缺 TreeIdentityError');

  await assert.rejects(
    lib.verifyTreeIdentity!('http://127.0.0.1:5211/', {
      fetchImpl: fetchReturning(identity(treeB, 5211)),
      expectedWorktree: treeA,
      env: {},
    }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'mismatch');
      assert.match(error.message, /身份不符/);
      assert.match(error.message, /5211/);
      assert.ok(error.message.includes(treeB), `消息里缺「连的是」路径 ${treeB}：${error.message}`);
      assert.ok(error.message.includes(treeA), `消息里缺「站在」路径 ${treeA}：${error.message}`);
      assert.match(error.message, /PIXEL_WORLD_CLIENT_PORT/);
      return true;
    },
  );
});

test('端点不可达：判红，不放行', async () => {
  const lib = await load();
  assert.equal(typeof lib.verifyTreeIdentity, 'function', '身份模块缺 verifyTreeIdentity');

  await assert.rejects(
    lib.verifyTreeIdentity!('http://127.0.0.1:5213/', {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
      timeoutMs: 0,
      retryMs: 1,
      attemptMs: 1,
      env: {},
    }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'unreachable');
      assert.match(error.message, /判红/);
      assert.match(error.message, /不能放行/);
      return true;
    },
  );
});

test('端点返回 404 / 非 JSON：判红，不把「没这个端点」当通过', async () => {
  const lib = await load();
  assert.equal(typeof lib.verifyTreeIdentity, 'function', '身份模块缺 verifyTreeIdentity');

  await assert.rejects(
    lib.verifyTreeIdentity!('http://127.0.0.1:5213/', {
      fetchImpl: async () => new Response('not found', { status: 404 }),
      env: {},
    }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /HTTP 404/);
      return true;
    },
  );

  await assert.rejects(
    lib.verifyTreeIdentity!('http://127.0.0.1:5213/', {
      fetchImpl: async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      env: {},
    }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'invalid');
      assert.match(error.message, /不是合法 JSON/);
      return true;
    },
  );
});

test('外部地址 / 显式开关：跳过比对，并给出可读原因', async () => {
  const lib = await load();
  assert.equal(typeof lib.verifyTreeIdentity, 'function', '身份模块缺 verifyTreeIdentity');

  let fetched = 0;
  const countedFetch = async () => {
    fetched += 1;
    return jsonResponse(identity(treeA));
  };

  const external = await lib.verifyTreeIdentity!('https://example.com/', {
    fetchImpl: countedFetch,
    env: {},
  });
  assert.equal(external.skipped, true);
  if (external.skipped) assert.match(external.reason, /不是本机回环地址/);
  assert.equal(fetched, 0, '外部地址不应发起身份探测');

  const explicit = await lib.verifyTreeIdentity!('http://127.0.0.1:5213/', {
    fetchImpl: countedFetch,
    env: { PIXEL_WORLD_SKIP_TREE_IDENTITY: '1' },
  });
  assert.equal(explicit.skipped, true);
  if (explicit.skipped) assert.match(explicit.reason, /显式跳过/);
  assert.equal(fetched, 0, '显式跳过不应发起身份探测');
});
