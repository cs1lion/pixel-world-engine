/** EDD 数据集的结构自检：主集与备用集必须真的分开，否则「防过拟合」只是口号。
 *
 * 这份测试不碰浏览器，只钉住 dataset 的形状；评分器本身的正确由
 * `scripts/eval-interaction.mjs` 的逐条断言负责。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname ?? '.', '..', 'eval', 'interaction');
const main = JSON.parse(readFileSync(join(dir, 'main.json'), 'utf8'));
const held = JSON.parse(readFileSync(join(dir, 'held-out.json'), 'utf8'));
const grader = readFileSync(join(dir, '..', '..', 'scripts', 'eval-interaction.mjs'), 'utf8');

test('两份数据集各自身份正确，spec 四段齐全', () => {
  assert.equal(main.version, 1);
  assert.equal(main.split, 'main');
  assert.equal(held.version, 1);
  assert.equal(held.split, 'held-out');
  for (const key of ['behavior', 'when', 'do', 'dont', 'keepIntact']) {
    assert.ok(main.spec[key] !== undefined, `主集 spec 缺 ${key}`);
  }
  assert.ok(main.spec.do.length > 0 && main.spec.dont.length > 0 && main.spec.keepIntact.length > 0);
});

test('每条 example 形状完整：id / name / check / expect / env 五件齐', () => {
  for (const [label, ds] of [['main', main], ['held-out', held]] as const) {
    for (const e of ds.examples) {
      for (const key of ['id', 'name', 'check', 'expect', 'env']) {
        assert.ok(e[key] !== undefined, `${label}/${e.id ?? '?'} 缺 ${key}`);
      }
      for (const key of ['world', 'now', 'phase', 'feed', 'debug']) {
        assert.ok(e.env[key] !== undefined, `${label}/${e.id} 的 env 缺 ${key}`);
      }
    }
  }
});

test('主集与备用集 id 不交叉，且每个 check 都有评分器实现', () => {
  const mainIds = new Set<string>(main.examples.map((e: { id: string }) => e.id));
  const heldIds = new Set<string>(held.examples.map((e: { id: string }) => e.id));
  assert.equal(mainIds.size, main.examples.length, '主集内部 id 不许重复');
  assert.equal(heldIds.size, held.examples.length, '备用集内部 id 不许重复');
  for (const id of heldIds) assert.ok(!mainIds.has(id), `${id} 同时出现在两集里`);
  for (const e of [...main.examples, ...held.examples]) {
    assert.ok(
      new RegExp(`\\b${e.check}\\s*\\(`).test(grader) || grader.includes(`${e.check}:`),
      `评分器里没有 ${e.check} 的实现`,
    );
  }
});

test('备用集含不看着调的用例，且至少两条环境变体换了世界初始条件', () => {
  assert.ok(held.examples.length >= 4, '备用集不能只有一两条');
  const variants = held.examples.filter((e: { id: string }) => e.id.startsWith('V'));
  assert.ok(variants.length >= 2, '要有环境变体，防对固定开局过拟合');
  const mainEnvs = new Set(main.examples.map((e: { env: { now: number; phase: string } }) => `${e.env.now}/${e.env.phase}`));
  for (const v of variants) {
    assert.ok(!mainEnvs.has(`${v.env.now}/${v.env.phase}`), `${v.id} 的初始条件和主集重复了`);
  }
});
