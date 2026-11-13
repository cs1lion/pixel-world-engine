/**
 * 造物主 EDD 评测集的防假绿自检。
 *
 * 它**不跑世界**，只查三件事：数据集自身的形状对不对、评分器是不是真的实现了数据集
 * 点名的每一个 check、以及保留集有没有躲开主集的开局环境（防开局过拟合）。
 *
 * 为什么这层单测必须存在：评分器跑起来是几分钟的浏览器活儿，而「数据集里写了个
 * 没人实现的 check」这种错，在评分器里表现为一条 `undefined is not a function`；
 * 在 `--split=main` 的十几条输出里，它和一条真的规则不符长得几乎一样。把它挪到
 * 毫秒级的静态检查里，红灯就只剩下一种解释。
 *
 * 跑法（`world-client/` 下，`npm test` 会自动收走本文件）：
 *   node --import ./test/phaser-hooks.mjs --test test/creator-eval.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATASET_DIR = join(ROOT, 'eval', 'creator');
const SCORER_PATH = join(ROOT, 'scripts', 'eval-creator.mjs');

interface Example {
  readonly id: string;
  readonly name: string;
  readonly check: string;
  readonly env: Record<string, string | number>;
  readonly input?: Record<string, unknown>;
  readonly expect: Record<string, unknown>;
}

interface Dataset {
  readonly version: number;
  readonly split: string;
  readonly spec: Record<string, unknown>;
  readonly examples: Example[];
}

const load = (name: string): Dataset =>
  JSON.parse(readFileSync(join(DATASET_DIR, name), 'utf8')) as Dataset;

const exampleOf = (dataset: Dataset, id: string): Example => {
  const found = dataset.examples.find((example) => example.id === id);
  assert.ok(found, `${dataset.split} 里没有用例 ${id}`);
  return found;
};

test('1. 数据集规格完整：version / split / spec 五项，主集 10 条、保留集 6 条', () => {
  const main = load('main.json');
  const held = load('held-out.json');

  assert.equal(main.version, 1, 'main.json 的 version 必须是 1');
  assert.equal(main.split, 'main', 'main.json 的 split 必须是 main');
  assert.equal(held.version, 1, 'held-out.json 的 version 必须是 1');
  assert.equal(held.split, 'held-out', 'held-out.json 的 split 必须是 held-out');

  for (const dataset of [main, held]) {
    for (const key of ['behavior', 'when', 'do', 'dont', 'keepIntact']) {
      const value = dataset.spec[key];
      assert.ok(
        typeof value === 'string' || Array.isArray(value),
        `${dataset.split}.spec 缺少必填项 ${key}`,
      );
    }
  }

  assert.equal(main.examples.length, 10, '主集必须正好 10 条（M1~M6 + K1~K4）');
  assert.equal(held.examples.length, 6, '保留集必须正好 6 条（H1~H4 + V1~V2）');
});

test('2. 用例形状与环境五要素齐全', () => {
  for (const dataset of [load('main.json'), load('held-out.json')]) {
    for (const example of dataset.examples) {
      for (const field of ['id', 'name', 'check', 'expect', 'env'] as const) {
        assert.ok(example[field] !== undefined, `[${dataset.split}] ${example.id} 缺少字段 ${field}`);
      }
      for (const envKey of ['world', 'now', 'phase', 'feed', 'debug']) {
        assert.ok(
          example.env[envKey] !== undefined,
          `[${dataset.split}] ${example.id}.env 缺少 ${envKey}`,
        );
      }
    }
  }
});

test('3. ID 不交叉、不重复，且每个 check 都在评分器里真实实现', () => {
  const main = load('main.json');
  const held = load('held-out.json');
  const scorerSource = readFileSync(SCORER_PATH, 'utf8');

  const mainIds = new Set(main.examples.map((example) => example.id));
  assert.equal(mainIds.size, main.examples.length, 'main.json 有重复 ID');
  for (const example of held.examples) {
    assert.ok(!mainIds.has(example.id), `held-out 与 main 交叉的 ID：${example.id}`);
  }
  assert.equal(new Set(held.examples.map((example) => example.id)).size, held.examples.length, 'held-out.json 有重复 ID');

  const checks = new Set([...main.examples, ...held.examples].map((example) => example.check));
  for (const check of checks) {
    const pattern = new RegExp(`\\b(async\\s+)?${check}\\s*\\(`);
    assert.match(scorerSource, pattern, `评分器的 CHECKS 里没有实现 ${check}`);
  }
});

test('4. 防假绿：评分器必须读真实存档字节；V* 变体的开局环境不得与主集重合', () => {
  const main = load('main.json');
  const held = load('held-out.json');
  const scorerSource = readFileSync(SCORER_PATH, 'utf8');

  assert.match(
    scorerSource,
    /exportSaveBytes\s*\(/,
    '评分器必须导出真实存档字节，否则只能证明画面动了',
  );
  assert.match(
    scorerSource,
    /inspectSaveBytes\s*\(/,
    '评分器必须反序列化核查落盘内容，否则内存态与持久化脱节也看不出来',
  );

  const mainEnvs = new Set(
    main.examples.map((example) => `${example.env.world}:${example.env.now}:${example.env.phase}`),
  );
  const variants = held.examples.filter((example) => example.id.startsWith('V'));
  assert.equal(variants.length, 2, '保留集必须有 2 条 V* 环境变体（V1 夜晚 / V2 清晨）');

  for (const variant of variants) {
    const key = `${variant.env.world}:${variant.env.now}:${variant.env.phase}`;
    assert.ok(!mainEnvs.has(key), `环境变体 ${variant.id} 的开局 (${key}) 与主集重合，防不住开局过拟合`);
  }

  // 时间档必须真的不同：V1 在夜里、V2 在清晨，否则「变异」只是改了个名字。
  assert.equal(exampleOf(held, 'V1').env.phase, 'night', 'V1 必须是夜晚档');
  assert.equal(exampleOf(held, 'V2').env.phase, 'dawn', 'V2 必须是清晨档');
});
