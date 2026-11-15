import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * `audit-claims-state` 的允许清单**自己也会烂**：条目指向一个已经改名的小节、
 * 条数与 `declaredCount` 不等、或者写不出「为什么不是缺陷」，都会让「未允许 = 0」
 * 变成一个假的绿。所以这里直接读真清单，把这三件事钉住。
 *
 * 模块不存在时必须红在**断言**上（`actual 'undefined'` / `expected 'function'`），
 * 不能是 `ERR_MODULE_NOT_FOUND`——后者会被 red-first 判成 `module`，不可采信（B7）。
 */

interface AllowEntry {
  file: string;
  section: string;
  why: string;
}

interface AllowlistReport {
  declaredCount: number | null;
  entries: ReadonlyArray<AllowEntry>;
  problems: ReadonlyArray<string>;
}

interface StateModule {
  loadAllowlist?: (options?: { root?: string; path?: string }) => AllowlistReport;
}

const MODULE_PATH = new URL('../scripts/audit-claims-state.ts', import.meta.url).href;

async function load(): Promise<StateModule> {
  let mod: StateModule | null = null;
  let importError: unknown = null;
  try {
    mod = (await import(MODULE_PATH)) as unknown as StateModule;
  } catch (error) {
    importError = error;
  }
  assert.equal(
    typeof mod?.loadAllowlist,
    'function',
    `模块缺 loadAllowlist${importError === null ? '' : `：${importError instanceof Error ? importError.message : String(importError)}`}`,
  );
  assert.equal(importError, null, '模块缺 audit-claims-state：import 抛了错');
  return mod!;
}

test('允许清单自身没问题：条数等于声明、每条都指向真实文件与小节、都写了理由', async () => {
  const report = (await load()).loadAllowlist!();
  assert.deepEqual(report.problems, [], `清单有问题：${report.problems.join('；')}`);

  assert.equal(
    report.entries.length,
    report.declaredCount,
    `条数必须等于声明：entries ${report.entries.length} / declaredCount ${String(report.declaredCount)}`,
  );

  for (const entry of report.entries) {
    assert.notEqual(entry.why.trim(), '', `${entry.file} 的 ${entry.section} 缺「为什么不是缺陷」的理由`);
  }
});
