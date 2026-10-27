/**
 * 散文数字分诊自己也得是被守住的那一个。
 *
 * 它是个「宁可漏、不可冤」的候选生成器，所以它的失效方式不是误报而是**闭嘴**：
 * 判据一收紧就一条都不报，而报 0 处的时候人以为干净。这里拿临时目录当假仓库，
 * 把它会漏的那一种造一个，看它是不是真的开口。
 *
 * ## 这一条守的正是它已经闭过一次的那张嘴
 *
 * 第一版 `SKIP` 是**整行**开关：`if (SKIP.test(raw)) return;`。注释里
 * 「§6 缺口 2」与「77 万与 87% 还在那个脚本第 6 行」常常同住一行，后者是这个
 * 工具唯一该抓的东西，却因为同一行有个 §号被一起丢掉。2026-10-28 在本仓实测
 * 整行丢 568 处候选、片段级 581 处（这两个数只为说明漏的是量过的值，不承重，
 * 加一个源文件就漂）。所以下面的第一条就是把这两种话塞进同一行。
 *
 * 也钉住它**不**乱开口：纯粹的结构性编号（`§4.1`、`第 12 行`、`ADR-3`、`#17`）
 * 一条都不该报；被自己的守卫文件提过的数不该报；在自己文件的代码里出现过的数
 * 不该报。误报一样毁掉一个守卫，只是毁得慢一点。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = `${ROOT}scripts/prose-numbers.ts`;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly number: string;
  readonly text: string;
}

/** 一份假仓库：一个源文件 + 一个同名守卫。内容由调用方给。 */
function fixture(src: string, guard: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-prose-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'test'), { recursive: true });
  writeFileSync(path.join(root, 'src', 'a.ts'), src, 'utf8');
  writeFileSync(path.join(root, 'test', 'a.test.ts'), guard, 'utf8');
  return root;
}

function scan(root: string): readonly Hit[] {
  const run = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `prose-numbers --json 非零退出：\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(run.stdout) as Hit[];
}

test('结构性编号与实测数同住一行时，实测数照样报——不整行丢', () => {
  const root = fixture(
    [
      'export const A = 1;',
      '',
      '/**',
      ' * 这句原来写的是「§6 缺口 2」——把萤火那条移出 §6 的范围，所以补一句：',
      ' * 实测 77 万条，其中 87% 在屏幕外，见那个脚本第 6 行。',
      ' */',
      'export const B = 2;',
      '',
    ].join('\n'),
    '// 守卫里一个数都不提。\n',
  );
  try {
    const numbers = scan(root).map((h) => h.number);
    assert.deepEqual(
      numbers,
      ['77', '87%'],
      '同一行里既有 §6/第 6 行又有实测数。整行丢的那一版这里一条都不报——'
        + '而那正是这个工具唯一该抓的东西。',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('纯粹的结构性编号一条都不报', () => {
  const root = fixture(
    [
      'export const A = 1;',
      '',
      '// 见 SPEC §4.1 的第 12 行，以及 ADR-3 与 #17 两条，还有 issue #13。',
      '',
    ].join('\n'),
    '// 空守卫。\n',
  );
  try {
    assert.deepEqual(
      scan(root).map((h) => `${h.file}:${h.line}:${h.number}`),
      [],
      '结构性坐标与编号不是实测值，一条都不该报。报出来了就是误判——'
        + '误判一样毁掉一个守卫，只是毁得慢一点。',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('被守卫文件提过的数、被自己代码用过的数，都不报', () => {
  const root = fixture(
    [
      'export const A = 1;',
      '',
      '// 阈值 42 由守卫钉住；55 在下面代码里；99 没人提。',
      'export const B = 55;',
      '',
    ].join('\n'),
    'assert.equal(threshold, 42);\n',
  );
  try {
    assert.deepEqual(
      scan(root).map((h) => h.number),
      ['99'],
      '判据是「它自己的守卫文件提都没提」——42 被守卫提了，55 在自己文件的代码里，'
        + '都算有机器在看。只剩 99 是候选。',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
