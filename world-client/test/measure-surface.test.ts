import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SurfaceContract {
  readonly CHROME: readonly string[];
  readonly SCENE_DOM: readonly string[];
  readonly DYNAMIC: readonly string[];
  assertSurfacePresent?: (page: unknown, options?: { dynamic?: boolean }) => Promise<unknown>;
}

// 契约是纯 JS 模块（脚本侧共享）。它在本轮才新增，red-first 会把这份测试套到
// base 上，那里没有 `scripts/lib/measure-surface.mjs`——静态 import 会以
// ERR_MODULE_NOT_FOUND 结束（判 ERROR，不可采信）。沿用 `shot-output.test.ts`
// 的形状：动态 import + 吞掉模块不存在，每条用例先断言导出存在（base 上红在断言）。
const CONTRACT_PATH: string = '../scripts/lib/measure-surface.mjs';
const load = async (): Promise<Partial<SurfaceContract>> => {
  try {
    return (await import(CONTRACT_PATH)) as unknown as SurfaceContract;
  } catch {
    return {};
  }
};
const HERE = dirname(fileURLToPath(import.meta.url));

test('测量面契约三组互不重叠、各自非空', async () => {
  const contract = await load();
  assert.ok(
    Array.isArray(contract.CHROME) && Array.isArray(contract.SCENE_DOM) && Array.isArray(contract.DYNAMIC),
    '契约缺 CHROME / SCENE_DOM / DYNAMIC 导出',
  );
  const groups = [contract.CHROME, contract.SCENE_DOM, contract.DYNAMIC];
  for (const list of groups) {
    assert.ok(list.length > 0, '契约的每一组都必须有选择器');
    assert.equal(new Set(list).size, list.length, '组内不许有重复选择器');
  }
  const all = groups.flat();
  assert.equal(new Set(all).size, all.length, '三组之间不许重叠：同一元素只能属于一组');
  // `#world-overlay` 是透明容器，不是压暗层；藏它会连区域名/露话一起藏掉（改的是判据对象）。
  assert.ok(!all.includes('#world-overlay'), '#world-overlay 不能进任何隐藏组');
});

test('两个像素闸门只从契约取选择器，不再各自维护清单', async () => {
  const contract = await load();
  assert.ok(
    Array.isArray(contract.CHROME) && Array.isArray(contract.DYNAMIC),
    '契约缺 CHROME / DYNAMIC 导出',
  );
  for (const script of ['check-ground-shadow.mjs', 'check-phases-negative.mjs']) {
    const source = readFileSync(join(HERE, '..', 'scripts', script), 'utf8');
    assert.match(source, /from '\.\/lib\/measure-surface\.mjs'/, `${script} 必须引用测量面契约`);
    for (const selector of [...contract.CHROME, ...contract.DYNAMIC]) {
      assert.ok(
        !source.includes(`'${selector}'`),
        `${script} 里还留着自己的选择器字面量 ${selector}（两份清单会漂移）`,
      );
    }
  }
});

test('反例：隐藏清单里的选择器改名（页面上不存在）时必须抛错', async () => {
  const contract = await load();
  assert.equal(typeof contract.assertSurfacePresent, 'function', '契约缺 assertSurfacePresent');

  // 模拟真实页面在改名后的读数：querySelectorAll 一个都没命中。
  // 守卫必须把「缺失」当失败，而不是静默跳过。
  const renamed = '#topbar';
  const page = {
    evaluate: async () => ({ applied: [], missing: [renamed] }),
  };
  await assert.rejects(
    () => contract.assertSurfacePresent!(page),
    (error: unknown) => String((error as Error).message).includes(renamed),
  );
});
