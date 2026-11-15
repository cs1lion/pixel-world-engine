import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ShotStableResult {
  stable: boolean;
  framesWaited: number;
  hash: string | null;
  elapsedMs: number;
  reason: string | null;
  buffer: Buffer | null;
}

interface ShotStableModule {
  shotStable?: (
    page: unknown,
    options?: {
      clip?: unknown;
      requireIdenticalFrames?: number;
      timeoutMs?: number;
      advance?: () => Promise<void>;
    },
  ) => Promise<ShotStableResult>;
}

/**
 * 抓拍前提是本轮新增的脚本模块（`scripts/lib/shot-stable.mjs`）。red-first 会把
 * 这份测试套到 base 上，那里没有这个文件——静态 import 会以 ERR_MODULE_NOT_FOUND
 * 结束（判 ERROR，不可采信）。沿用 `shot-output.test.ts` 形状：动态 import +
 * 吞掉模块不存在，每条用例先断言导出存在（base 上红在断言）。
 */
const MODULE_PATH: string = '../scripts/lib/shot-stable.mjs';
const load = async (): Promise<ShotStableModule> => {
  try {
    return (await import(MODULE_PATH)) as unknown as ShotStableModule;
  } catch {
    return {};
  }
};

const CLIP = { x: 0, y: 0, width: 100, height: 60 };
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * 假页面：`npm test` 是离线跑的，不起 Playwright。
 * - `applyMeasurementSurface` 会调 `page.evaluate(fn, selectors)`，这里把选择器
 *   全当作命中（真实页面上的存在性由 measure-surface 的守卫管）。
 * - `page.screenshot({ clip })` 每调一次取下一帧字节。
 * 每个假帧之间让出 1ms，模拟真实截图不是零成本；否则 160ms 超时会空转成千次。
 */
function fakePage(nextFrame: () => Buffer) {
  return {
    evaluate: async (_fn: unknown, selectors: unknown) => ({
      applied: Array.isArray(selectors) ? selectors : [],
      missing: [] as string[],
    }),
    screenshot: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return nextFrame();
    },
  };
}

test('冻结帧场景在有限帧数内返回 stable:true，并记下实际 framesWaited', async () => {
  const lib = await load();
  assert.equal(typeof lib.shotStable, 'function', '模块缺 shotStable');

  const constant = Buffer.from('same-frame-bytes');
  const page = fakePage(() => constant);
  const result = await lib.shotStable!(page, { clip: CLIP, requireIdenticalFrames: 8, timeoutMs: 5000 });

  assert.equal(result.stable, true);
  assert.equal(result.framesWaited, 8, '连续 8 帧相同应在第 8 帧收手，不多拍');
  assert.equal(result.reason, null);
  assert.equal(typeof result.hash, 'string');
  assert.equal(result.hash!.length, 64, 'hash 是 sha256');
  assert.equal(result.buffer, constant, '返回的 buffer 就是满足判据的那一帧');
});

test('反例：逐帧都在变的画面不得被当成稳定', async () => {
  const lib = await load();
  assert.equal(typeof lib.shotStable, 'function', '模块缺 shotStable');

  let frame = 0;
  const page = fakePage(() => Buffer.from(`changing-frame-${frame++}`));
  const result = await lib.shotStable!(page, { clip: CLIP, requireIdenticalFrames: 8, timeoutMs: 160 });

  assert.equal(result.stable, false, '每帧都变必须判不稳定');
  assert.ok(result.framesWaited >= 1);
  assert.equal(result.buffer, null, '不稳定时不许交出可用的帧');
  assert.match(String(result.reason), /从未出现连续 8 帧相同/);
  assert.match(String(result.reason), /每次都在变/);
});

test('反例：平台期短于 N 帧（5 帧相同后即变）也不算稳定', async () => {
  const lib = await load();
  assert.equal(typeof lib.shotStable, 'function', '模块缺 shotStable');

  const plateau = Buffer.from('plateau');
  let calls = 0;
  // 第 1–5 次调用返回同一字节（连续 5 帧），之后每次都不同。
  const page = fakePage(() => (calls++ < 5 ? plateau : Buffer.from(`after-plateau-${calls}`)));
  const result = await lib.shotStable!(page, { clip: CLIP, requireIdenticalFrames: 8, timeoutMs: 200 });

  assert.equal(result.stable, false, '连续 5 帧 < 8 帧，不能因为「两帧相同」就放行');
  assert.match(String(result.reason), /最长连续 5 帧/);
});

test('取样链路不许用 toDataURL（E9：当前 WebGL 上下文里它是全黑）', async () => {
  const lib = await load();
  assert.equal(typeof lib.shotStable, 'function', '模块缺 shotStable');

  const source = readFileSync(join(HERE, '..', 'scripts', 'lib', 'shot-stable.mjs'), 'utf8');
  // 注释里会解释「为什么不用 toDataURL」，只看代码本体。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!code.includes('toDataURL'), 'shotStable 不得依赖 toDataURL');
  assert.match(code, /page\.screenshot\(\{ clip \}\)/, '必须走 Playwright 的 page.screenshot({ clip })');
});

/**
 * 步进模式（`advance`）：帧数固定，两页才走同样的帧序列。
 * 这里同时钉住「步进不看墙钟」——`timeoutMs` 给 1ms 也必须靠步进收手。
 */
test('步进模式：恰好步进 N 帧即判稳定，不受墙钟超时影响', async () => {
  const lib = await load();
  assert.equal(typeof lib.shotStable, 'function', '模块缺 shotStable');

  const constant = Buffer.from('stepped-frame-bytes');
  const page = fakePage(() => constant);
  let advanced = 0;
  const result = await lib.shotStable!(page, {
    clip: CLIP,
    requireIdenticalFrames: 8,
    timeoutMs: 1,
    advance: async () => {
      advanced += 1;
    },
  });

  assert.equal(result.stable, true);
  assert.equal(advanced, 8, '必须步进恰好 8 帧，不多不少');
  assert.equal(result.framesWaited, 8);
  assert.equal(result.reason, null);
  assert.equal(result.buffer, constant);
});

test('步进模式反例：逐帧都在变 → stable:false 且报「每次都在变」', async () => {
  const lib = await load();
  assert.equal(typeof lib.shotStable, 'function', '模块缺 shotStable');

  let frame = 0;
  const page = fakePage(() => {
    frame += 1;
    return Buffer.from(`stepped-changing-${frame}`);
  });
  const result = await lib.shotStable!(page, {
    clip: CLIP,
    requireIdenticalFrames: 8,
    advance: async () => {
      /* 每帧都推进，画面每帧都不同 */
    },
  });

  assert.equal(result.stable, false, '步进模式下每帧都变也必须判不稳定');
  assert.equal(result.framesWaited, 8, '步进模式的帧预算是确定的');
  assert.equal(result.buffer, null, '不稳定时不许交出可用的帧');
  assert.match(String(result.reason), /每次都在变/);
  assert.match(String(result.reason), /步进 8 帧/);
});
