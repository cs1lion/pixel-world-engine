/**
 * 行号引用审计自己也得是被守住的那一个。
 *
 * 一个查不出问题的守卫比没有守卫更糟：它会一直绿灯，而人以为自述为真。
 * 所以这里拿一份临时目录当假仓库，把五种坏引用各造一个，看它是不是真的开口。
 * 哪天它闭上了嘴，这些条会红。
 *
 * 也钉住它**不**乱开口：指着注释、网址里的端口、「第 12 行」这种行文，
 * 都得放行——误报一样毁掉一个守卫，只是毁得慢一点。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditReferences } from '../scripts/audit-references.ts';

/** 一份够用的假仓库：两个源文件 + 一份文档。 */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-refs-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(path.join(root, 'world-client', 'src'), { recursive: true });
  mkdirSync(path.join(root, 'world-client', 'test'), { recursive: true });
  writeFileSync(
    path.join(root, 'world-client', 'src', 'a.ts'),
    ['export function one(): number {', '  return 1;', '}', '', '// 一段注释', 'export function two(): number {', '  return 2;', '}', ''].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(root, 'world-client', 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
  return root;
}

function doc(root: string, body: string): void {
  writeFileSync(path.join(root, 'docs', 'd.md'), body, 'utf8');
}

/**
 * 拼一个 `file:line` 引用。
 *
 * 不把坏行号直接写在源码里：审计脚本扫 `world-client/test`，那是它自己的
 * 一份测试数据，不是仓库的自述——写死了它会审到自己头上，于是「真仓库
 * 0 处存疑」那条永远红。拼出来，源码里就没有那个形状。
 */
function ref(file: string, from: number, to?: number): string {
  return `\`${file}:${from}${to === undefined ? '' : `-${to}`}\``;
}

const WHY_OF = (findings: readonly { readonly where: string; readonly why: string }[], line: number): string =>
  findings.find((f) => f.where === `docs${path.sep}d.md:${line}`)?.why ?? '';

test('指到文件外、指到空行、指到不存在的文件，三样都开口', () => {
  const root = fixture();
  try {
    doc(
      root,
      [
        `越界：${ref('a.ts', 99)}。`,
        `不存在：${ref('nope.ts', 3)}。`,
        `空行：${ref('a.ts', 4)}。`,
        '',
      ].join('\n'),
    );
    const { findings } = auditReferences({ root });
    assert.match(WHY_OF(findings, 1), /越界/, '行号超出文件长度要说出来');
    assert.match(WHY_OF(findings, 2), /找不到这个文件/, '指到一个没有的文件要说出来');
    assert.match(WHY_OF(findings, 3), /没有代码/, '指着空行等于什么都没指');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('指着注释是正当的：ADR 引的就是注释的原文', () => {
  const root = fixture();
  try {
    doc(root, `引一段注释（${ref('a.ts', 5)}）。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '注释不是真空，指着它不该被当成指错了');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('裸文件名撞上多个文件时报出来，还列出候选', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'world-client', 'test', 'a.ts'), 'export const dup = 1;\n', 'utf8');
    doc(root, `撞车：${ref('a.ts', 1)}。\n`);
    const { findings } = auditReferences({ root });
    const why = WHY_OF(findings, 1);
    assert.match(why, /撞上 2 个文件/, '两个同名文件不该由脚本挑一个');
    assert.match(why, /world-client.src.a\.ts/, '候选要列出来，人才知道挑哪个');
    assert.match(why, /world-client.test.a\.ts/, '两个候选都要列');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('网址里的端口与「第 12 行」这种行文不算指针', () => {
  const root = fixture();
  try {
    doc(root, '见 http://example.com/a.ts:8080 与 a.ts 第 3 行的说明。\n');
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '两者都没有坐标，不该占一个存疑名额');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('真仓库现在是干净的：0 处存疑', () => {
  // 这一条是那道真正的闸门。它不换 root，审的就是这个 checkout——
  // 谁改代码挪走了函数，这里当场红，而不是等某个后人在文档里照着错的行号改错地方。
  const { checked, findings } = auditReferences();
  assert.ok(checked > 50, `该查到几十处引用，只查到 ${checked}——扫描范围是不是缩了`);
  assert.deepEqual(
    findings.map((f) => `${f.where}  ${f.ref} —— ${f.why}`),
    [],
    '仓库里有没有哪处行号引用对不上了',
  );
});
