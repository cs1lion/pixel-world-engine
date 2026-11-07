import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 分类表钉在仓内：哪一格本来就该是纯黑（灯灭对照 / 曲线远端），
 * 哪一格必须点亮（灯亮池心 / 潮位 / 曲线近端）。
 *
 * 这条业务知识最会漂——漂了以后没有别的东西会发现。临时目录里的
 * evidence harness 不算证据，所以双向断言放进这里：
 *
 * - 预期零光 + 纯黑 → 通过，且文案是 `[零光]`；
 * - 必须点亮 + 纯黑 → 判红（退出码非 0），文案是 `[判据前提不成立]`。
 *
 * red-first 会把这份测试套到 base 上，base 没有 `scripts/lib/lamp-pool-classify.mjs`，
 * 所以动态 import + 吞掉模块不存在，每条用例先断言导出存在。
 */

interface ClassifyModule {
  MUST_BE_LIT_CURVE_MAX?: number;
  readingCases?: (out: Out) => Array<{ label: string; reading: Reading; mustBeLit: boolean }>;
  classifyReadings?: (out: Out) => { zeroLight: string[]; broken: string[] };
  reportReadings?: (
    out: Out,
    options?: { error?: (...args: unknown[]) => void },
  ) => 0 | 1;
}

type Reading = { cct: number | null; luminance: number };
type Out = {
  closeReading: { lit: Reading; dark: Reading };
  curve: Array<{ d: number; lit: Reading; dark: Reading }>;
  tide: { low: { value: Reading }; high: { value: Reading } };
};

const MODULE_PATH: string = '../scripts/lib/lamp-pool-classify.mjs';
const load = async (): Promise<ClassifyModule> => {
  try {
    return (await import(MODULE_PATH)) as unknown as ClassifyModule;
  } catch {
    return {};
  }
};

const ok = (): Reading => ({ cct: 5000, luminance: 1 });
const black = (): Reading => ({ cct: null, luminance: 0 });

/** 读数全有效。 */
const healthy = (): Out => ({
  closeReading: { lit: ok(), dark: ok() },
  curve: [{ d: 0.5, lit: ok(), dark: ok() }],
  tide: { low: { value: ok() }, high: { value: ok() } },
});

const run = (out: Out) => {
  const messages: string[] = [];
  const code = lib!.reportReadings!(out, { error: (...args) => messages.push(args.join(' ')) });
  return { code, messages };
};

let lib: ClassifyModule | undefined;

test('装载分类模块', async () => {
  lib = await load();
  assert.equal(typeof lib.reportReadings, 'function', '缺 reportReadings 导出');
  assert.equal(typeof lib.classifyReadings, 'function', '缺 classifyReadings 导出');
  assert.equal(typeof lib.readingCases, 'function', '缺 readingCases 导出');
});

test('预期零光：灯灭池心 + 曲线 4/6 格纯黑 → 通过，文案是 [零光]', async () => {
  lib = await load();
  assert.equal(typeof lib.reportReadings, 'function', '缺 reportReadings 导出');
  const out = healthy();
  out.closeReading.dark = black();
  out.curve = [
    { d: 0.5, lit: ok(), dark: ok() },
    { d: 4, lit: black(), dark: black() },
    { d: 6, lit: black(), dark: black() },
  ];
  const { code, messages } = run(out);
  assert.equal(code, 0, '合法零光不能判红');
  const zero = messages.filter((m) => m.startsWith('[零光]'));
  assert.ok(zero.some((m) => m.includes('灯灭（池心）')), `灯灭对照要报 [零光]，实际：${messages.join(' | ')}`);
  assert.ok(zero.some((m) => m.includes('4 格 亮')), `4 格远端要报 [零光]，实际：${messages.join(' | ')}`);
  assert.ok(zero.some((m) => m.includes('6 格 亮')), `6 格远端要报 [零光]，实际：${messages.join(' | ')}`);
  assert.equal(
    messages.filter((m) => m.startsWith('[判据前提不成立]')).length,
    0,
    '合法零光不能出现判红文案',
  );
});

test('必须点亮：灯亮池心纯黑 → 判红，文案是 [判据前提不成立]', async () => {
  lib = await load();
  assert.equal(typeof lib.reportReadings, 'function', '缺 reportReadings 导出');
  const out = healthy();
  out.closeReading.lit = black();
  const { code, messages } = run(out);
  assert.notEqual(code, 0, '灯亮池心纯黑必须判红');
  assert.ok(
    messages.some((m) => m.startsWith('[判据前提不成立]') && m.includes('灯亮（池心）')),
    `缺 [判据前提不成立] 灯亮（池心）文案，实际：${messages.join(' | ')}`,
  );
});

test('必须点亮：两档潮位纯黑 → 判红', async () => {
  lib = await load();
  assert.equal(typeof lib.reportReadings, 'function', '缺 reportReadings 导出');
  const out = healthy();
  out.tide.low.value = black();
  out.tide.high.value = black();
  const { code, messages } = run(out);
  assert.notEqual(code, 0, '潮位纯黑必须判红');
  assert.ok(messages.some((m) => m.includes('潮位低（灯亮池心）')));
  assert.ok(messages.some((m) => m.includes('潮位高（灯亮池心）')));
});

test('必须点亮：曲线近端 0.5 格纯黑 → 判红', async () => {
  lib = await load();
  assert.equal(typeof lib.reportReadings, 'function', '缺 reportReadings 导出');
  const out = healthy();
  out.curve = [{ d: 0.5, lit: black(), dark: ok() }];
  const { code, messages } = run(out);
  assert.notEqual(code, 0, '曲线近端纯黑必须判红');
  assert.ok(messages.some((m) => m.startsWith('[判据前提不成立]') && m.includes('0.5 格 亮')));
});

test('分类边界钉死：2.5 格亮态算「必须点亮」，3 格亮态不算', async () => {
  lib = await load();
  assert.equal(typeof lib.classifyReadings, 'function', '缺 classifyReadings 导出');
  assert.equal(lib.MUST_BE_LIT_CURVE_MAX, 2.5, '边界值漂了：曲线必须点亮的上限应为 2.5');
  const out = healthy();
  out.curve = [
    { d: 2.5, lit: black(), dark: ok() },
    { d: 3, lit: black(), dark: ok() },
  ];
  const { zeroLight, broken } = lib.classifyReadings!(out);
  assert.deepEqual(broken, ['2.5 格 亮'], '2.5 格亮态纯黑属于判据前提不成立');
  assert.deepEqual(zeroLight, ['3 格 亮'], '3 格亮态纯黑不在必须点亮集合，只记零光');
});

test('正例：全部有效像素 → 不判红、无任何文案', async () => {
  lib = await load();
  assert.equal(typeof lib.reportReadings, 'function', '缺 reportReadings 导出');
  const { code, messages } = run(healthy());
  assert.equal(code, 0);
  assert.deepEqual(messages, []);
});
