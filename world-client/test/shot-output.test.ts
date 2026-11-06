import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/**
 * 输出口径是本轮新增的脚本模块。red-first 会把这份测试套到 base 上，而 base
 * 里没有 `scripts/lib/shot-output.mjs`——直接 `import` 会以
 * ERR_MODULE_NOT_FOUND 结束并被判成 ERROR（基础设施问题），不是「红在断言上」。
 *
 * 所以沿用 `tree-identity.test.ts` 的形状：动态 import + 吞掉模块不存在，
 * 每条用例第一句先断言导出存在（base 上红在断言，新码上跑真实用例）。
 */
interface ShotModule {
  BASELINE_DIR?: string;
  WRITE_BASELINE_FLAG?: string;
  resolveShotTarget?: (
    script: string,
    options?: Record<string, unknown>,
  ) => {
    dir: string;
    baseline: boolean;
    authorized: boolean;
    explicit: 'flag' | 'EVAL_OUT' | null;
  };
  blockedWriteLines?: (
    script: string,
    target: { dir: string; authorized: boolean },
    files: string[],
  ) => string[];
}

const MODULE_PATH: string = '../scripts/lib/shot-output.mjs';
const load = async (): Promise<ShotModule> => {
  try {
    return (await import(MODULE_PATH)) as unknown as ShotModule;
  } catch {
    return {};
  }
};

const CLIENT_ROOT = resolve(process.cwd(), 'fake-client');
const BASELINE = resolve(CLIENT_ROOT, 'eval', 'screens');
const baseOptions = { clientRoot: CLIENT_ROOT, baselineDir: BASELINE, argv: ['node', 'script.mjs'] };

test('缺省输出：tmp/screens/<脚本名>，不是仓库基线', async () => {
  const lib = await load();
  assert.equal(typeof lib.resolveShotTarget, 'function', '输出模块缺 resolveShotTarget');

  const target = lib.resolveShotTarget!('check-phases', { ...baseOptions, env: {} });
  assert.equal(target.dir, resolve(CLIENT_ROOT, 'tmp', 'screens', 'check-phases'));
  assert.equal(target.baseline, false);
  assert.equal(target.authorized, false);
  assert.equal(target.explicit, null);
});

test('--write-baseline：落到基线目录，且算显式授权', async () => {
  const lib = await load();
  assert.equal(typeof lib.resolveShotTarget, 'function', '输出模块缺 resolveShotTarget');
  assert.equal(typeof lib.WRITE_BASELINE_FLAG, 'string', '输出模块缺 WRITE_BASELINE_FLAG');

  const target = lib.resolveShotTarget!('check-phases', {
    ...baseOptions,
    env: {},
    argv: ['node', 'script.mjs', lib.WRITE_BASELINE_FLAG!],
  });
  assert.equal(target.dir, BASELINE);
  assert.equal(target.baseline, true);
  assert.equal(target.authorized, true);
  assert.equal(target.explicit, 'flag');
});

test('EVAL_OUT=eval/screens 是授权；其它 EVAL_OUT 只改路径、不算授权', async () => {
  const lib = await load();
  assert.equal(typeof lib.resolveShotTarget, 'function', '输出模块缺 resolveShotTarget');

  const baseline = lib.resolveShotTarget!('check-phases', { ...baseOptions, env: { EVAL_OUT: 'eval/screens' } });
  assert.equal(baseline.dir, BASELINE);
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.authorized, true);
  assert.equal(baseline.explicit, 'EVAL_OUT');

  const runnerTemp = resolve(process.cwd(), 'runner-temp', 'eval-screens');
  const other = lib.resolveShotTarget!('check-phases', { ...baseOptions, env: { EVAL_OUT: runnerTemp } });
  assert.equal(other.dir, runnerTemp);
  assert.equal(other.baseline, false);
  assert.equal(other.authorized, false);

  const subdir = lib.resolveShotTarget!('check-phases', {
    ...baseOptions,
    env: { EVAL_OUT: 'eval/screens/actor-pin' },
  });
  assert.equal(subdir.dir, resolve(BASELINE, 'actor-pin'));
  assert.equal(subdir.baseline, false, '子目录不是基线根目录本身');
  assert.equal(subdir.authorized, false);
});

test('命中已跟踪文件且无授权：拒绝并打印清单与两条放行命令', async () => {
  const lib = await load();
  assert.equal(typeof lib.blockedWriteLines, 'function', '输出模块缺 blockedWriteLines');

  const target = { dir: BASELINE, authorized: false };
  const files = ['world-client/eval/screens/phase-night.png', 'world-client/eval/screens/phase-night-rain.png'];
  const lines = lib.blockedWriteLines!('check-phases', target, files);
  assert.equal(lines.length > 0, true, '未授权的基线写入必须被拦');
  const text = lines.join('\n');
  assert.match(text, /拒绝写入/);
  assert.ok(text.includes(BASELINE), `缺目标目录：${text}`);
  for (const file of files) assert.ok(text.includes(file), `缺被覆盖文件 ${file}：${text}`);
  assert.ok(text.includes('--write-baseline'), `缺 --write-baseline 放行命令：${text}`);
  assert.ok(text.includes('EVAL_OUT=eval/screens'), `缺 EVAL_OUT 放行命令：${text}`);
  assert.ok(text.includes('check-phases'), `缺脚本名：${text}`);
});

test('已授权或目录里没有已跟踪文件：不拦', async () => {
  const lib = await load();
  assert.equal(typeof lib.blockedWriteLines, 'function', '输出模块缺 blockedWriteLines');

  const files = ['world-client/eval/screens/phase-night.png'];
  assert.deepEqual(lib.blockedWriteLines!('check-phases', { dir: BASELINE, authorized: true }, files), []);
  assert.deepEqual(lib.blockedWriteLines!('check-phases', { dir: BASELINE, authorized: false }, []), []);
});
