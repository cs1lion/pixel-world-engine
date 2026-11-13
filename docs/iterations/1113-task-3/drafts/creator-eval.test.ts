/**
 * world-client/test/creator-eval.test.ts
 * 造物主（Creator）EDD 评测集与评分器防假绿自检单测（对齐 interaction-eval.test.ts 规范）
 *
 * 运行方式：
 *   node --import tsx --test test/creator-eval.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATASET_DIR = join(ROOT, 'eval', 'creator');
const SCRIPT_PATH = join(ROOT, 'scripts', 'eval-creator.mjs');

const loadJson = (name: string) =>
  JSON.parse(readFileSync(join(DATASET_DIR, name), 'utf8'));

test('1. 造物主 EDD 数据集规格完整性断言（main.json & held-out.json）', () => {
  const main = loadJson('main.json');
  const held = loadJson('held-out.json');

  assert.equal(main.version, 1, 'main.json version 必须为 1');
  assert.equal(main.split, 'main', 'main.json split 标识必须为 main');
  assert.equal(held.version, 1, 'held-out.json version 必须为 1');
  assert.equal(held.split, 'held-out', 'held-out.json split 标识必须为 held-out');

  for (const ds of [main, held]) {
    assert.ok(ds.spec, `${ds.split} 缺少 spec 定义`);
    for (const key of ['behavior', 'when', 'do', 'dont', 'keepIntact']) {
      assert.ok(
        ds.spec[key] && (typeof ds.spec[key] === 'string' || Array.isArray(ds.spec[key])),
        `${ds.split}.spec 缺少必填规范项: ${key}`,
      );
    }
  }

  assert.equal(main.examples.length, 10, '主集必须包含 10 条标准用例（M1~M6 + K1~K4）');
  assert.ok(held.examples.length >= 6, '保留集必须包含至少 6 条防过拟合用例');
});

test('2. 用例形状与环境配置（env 5 要素）完整性断言', () => {
  const main = loadJson('main.json');
  const held = loadJson('held-out.json');

  for (const ds of [main, held]) {
    for (const ex of ds.examples) {
      for (const field of ['id', 'name', 'check', 'expect', 'env']) {
        assert.ok(ex[field] !== undefined, `[${ds.split}] 用例 ${ex.id} 缺少字段: ${field}`);
      }
      for (const envKey of ['world', 'now', 'phase', 'feed', 'debug']) {
        assert.ok(
          ex.env[envKey] !== undefined,
          `[${ds.split}] 用例 ${ex.id}.env 缺少必填环境参数: ${envKey}`,
        );
      }
    }
  }
});

test('3. 主集与保留集 ID 互不相交且所有 check 函数已在 eval-creator.mjs 中真实实现', () => {
  const main = loadJson('main.json');
  const held = loadJson('held-out.json');
  const scriptSource = readFileSync(SCRIPT_PATH, 'utf8');

  const mainIds = new Set<string>();
  for (const ex of main.examples) {
    assert.ok(!mainIds.has(ex.id), `main.json 存在重复 ID: ${ex.id}`);
    mainIds.add(ex.id);
  }

  const heldIds = new Set<string>();
  for (const ex of held.examples) {
    assert.ok(!heldIds.has(ex.id), `held-out.json 存在重复 ID: ${ex.id}`);
    assert.ok(!mainIds.has(ex.id), `held-out.json 与 main.json 存在交叉 ID: ${ex.id}`);
    heldIds.add(ex.id);
  }

  const allChecks = new Set<string>(
    [...main.examples, ...held.examples].map((ex) => String(ex.check)),
  );
  for (const checkName of allChecks) {
    const fnPattern = new RegExp(`\\b(async\\s+)?${checkName}\\s*\\(`);
    assert.match(
      scriptSource,
      fnPattern,
      `eval-creator.mjs 的 CHECKS 中未实现检查函数: ${checkName}`,
    );
  }
});

test('4. 防假绿与防开局过拟合断言（真实落盘存档校验 + V* 环境变体时刻不重合）', () => {
  const main = loadJson('main.json');
  const held = loadJson('held-out.json');
  const scriptSource = readFileSync(SCRIPT_PATH, 'utf8');

  // 防假绿：评分器必须调用 exportSaveBytes 与 inspectSaveBytes 核查真实落盘存档，绝不能只读 View
  assert.match(
    scriptSource,
    /exportSaveBytes\s*\(/,
    '评分器必须导出真实存档字节（防止仅修改 Phaser View 产生假绿）',
  );
  assert.match(
    scriptSource,
    /inspectSaveBytes\s*\(/,
    '评分器必须反序列化核查落盘存档内容（防止内存态与持久化脱节）',
  );

  // 防开局过拟合：保留集至少包含 2 条 V* 环境变体用例，且 (now, phase) 与主集不重合
  const mainTimeKeys = new Set<string>(
    main.examples.map((ex: any) => `${ex.env.world}:${ex.env.now}:${ex.env.phase}`),
  );
  const variants = held.examples.filter((ex: any) => String(ex.id).startsWith('V'));
  assert.ok(variants.length >= 2, 'held-out.json 必须至少包含 2 条 V* 环境变体用例');

  for (const v of variants) {
    const vKey = `${v.env.world}:${v.env.now}:${v.env.phase}`;
    assert.ok(
      !mainTimeKeys.has(vKey),
      `环境变体用例 ${v.id} 的初始环境 (${vKey}) 与主集重合，无法防止开局过拟合`,
    );
  }
});