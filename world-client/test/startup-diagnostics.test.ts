import { test } from 'node:test';
import assert from 'node:assert/strict';

interface StartupDiagnostics {
  startupFailureMessage?: (
    reason: string,
    logs: string,
    probe: { lastStatus: number | null; lastError: string | null; msSinceSpawn: number },
  ) => string;
  describeFetchError?: (error: unknown) => string;
}

/**
 * 诊断格式化模块是新增的（`scripts/lib/`）。red-first 会把这份测试套到 base 上，
 * 那里没有 `startup-diagnostics.mjs`——静态 import 会以 ERR_MODULE_NOT_FOUND
 * 结束（判 ERROR，不可采信）。沿用 `shot-output.test.ts` 的形状：动态 import +
 * 吞掉模块不存在，每条用例先断言导出存在（base 上红在断言）。
 */
const MODULE_PATH: string = '../scripts/lib/startup-diagnostics.mjs';
const load = async (): Promise<StartupDiagnostics> => {
  try {
    return (await import(MODULE_PATH)) as unknown as StartupDiagnostics;
  } catch {
    return {};
  }
};

test('启动超时的失败信息必须带 lastStatus / lastError / msSinceSpawn', async () => {
  const lib = await load();
  assert.equal(typeof lib.startupFailureMessage, 'function', '诊断模块缺 startupFailureMessage');

  const message = lib.startupFailureMessage!(
    '服务在 20 秒内没起来',
    'INFO: Uvicorn running on http://127.0.0.1:1723\n',
    { lastStatus: 503, lastError: 'fetch failed（ECONNREFUSED）', msSinceSpawn: 20015 },
  );
  assert.match(message, /lastStatus=503/);
  assert.match(message, /lastError=fetch failed（ECONNREFUSED）/);
  assert.match(message, /msSinceSpawn=20015/);
  // 日志照旧附在后面：只有这三个读数、丢掉日志就查不了「服务到底起没起」。
  assert.match(message, /Uvicorn running on http:\/\/127\.0\.0\.1:1723/);

  // 一次都没拿到响应（B13 那次的现象）时也要显式写「无响应 / 无」，不能留空。
  const silent = lib.startupFailureMessage!('服务在 20 秒内没起来', '', {
    lastStatus: null,
    lastError: null,
    msSinceSpawn: 20001,
  });
  assert.match(silent, /lastStatus=无响应/);
  assert.match(silent, /lastError=无/);
  assert.match(silent, /msSinceSpawn=20001/);
});

test('describeFetchError 带出 cause.code，不是裸 message', async () => {
  const lib = await load();
  assert.equal(typeof lib.describeFetchError, 'function', '诊断模块缺 describeFetchError');

  const refused = new TypeError('fetch failed');
  (refused as { cause?: unknown }).cause = { code: 'ECONNREFUSED' };
  assert.equal(lib.describeFetchError!(refused), 'fetch failed（ECONNREFUSED）');

  // 没有 cause.code 时只给消息，不能凭空补一个码。
  assert.equal(lib.describeFetchError!(new TypeError('fetch failed')), 'fetch failed');
  assert.equal(lib.describeFetchError!('plain'), 'plain');
});
