import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commentKindFor, findBannedPorts } from '../scripts/audit-ports-lib.ts';
import { REQUIRED_DIRS, REQUIRED_FILES, scanRootProblems } from '../scripts/audit-ports.ts';

test('代码/字符串里的禁用端口：命中', () => {
  const source = [
    "const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';",
    'const ORIGIN = "http://127.0.0.1:5191";',
    'const PORT = 5202;',
    'const n = 5203;',
  ].join('\n');
  const hits = findBannedPorts(source, 'js');
  assert.deepEqual(hits.map((hit) => hit.port), [5188, 5191, 5202, 5203]);
  assert.deepEqual(hits.map((hit) => hit.line), [1, 2, 3, 4]);
});

test('注释里的禁用端口：不误报（含 URL）', () => {
  const source = [
    '// 端口 5188 是别的 worktree 的实例',
    '/* 用 PIXEL_WORLD_URL=http://127.0.0.1:5202/ 指过去 */',
    'const ok = 1; // 5191 只出现在注释里',
  ].join('\n');
  const hits = findBannedPorts(source, 'js');
  assert.equal(hits.length, 0);
});

test('注释符出现在字符串里时，不把后面的代码当注释', () => {
  const source = "const url = 'http://127.0.0.1:5188/path'; const port = 5203;";
  const hits = findBannedPorts(source, 'js');
  assert.deepEqual(hits.map((hit) => hit.port), [5188, 5203]);
});

test('非禁用端口不误报：5189 / 5211 / 15188', () => {
  const source = "const a = 'http://127.0.0.1:5189/'; const b = 'http://127.0.0.1:5211/'; const c = 15188;";
  const hits = findBannedPorts(source, 'js');
  assert.equal(hits.length, 0);
});

test('YAML 的 # 注释不误报，--port 值命中', () => {
  const source = ['# 5188 是开发时端口', 'run: npm run preview -- --port 5191'].join('\n');
  const hits = findBannedPorts(source, 'hash');
  assert.deepEqual(hits.map((hit) => hit.port), [5191]);
  assert.deepEqual(hits.map((hit) => hit.line), [2]);
});

test('.env 示例里的 # 注释不误报，PORT= 命中', () => {
  const source = ['# PORT=5188', 'PIXEL_WORLD_URL=http://127.0.0.1:5202/'].join('\n');
  const hits = findBannedPorts(source, 'hash');
  assert.deepEqual(hits.map((hit) => hit.port), [5202]);
});

test('文件类型判定：脚本走 JS 去注释，yaml/env 走 #', () => {
  assert.equal(commentKindFor('foo.mjs'), 'js');
  assert.equal(commentKindFor('foo.ts'), 'js');
  assert.equal(commentKindFor('ci.yml'), 'hash');
  assert.equal(commentKindFor('.env.example'), 'hash');
  assert.equal(commentKindFor('package.json'), 'none');
});

test('期望的扫描根不存在：逐个报出来，不许静默缩水', () => {
  // 原来 `walk()` 对着不存在的目录直接 `return`：受查文件数悄悄变少，
  // 输出仍是一句「0 处禁用端口」。这里拿一个空目录当假仓库，四目录 + 三文件
  // 一个都不在，必须一条不漏。
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-ports-empty-'));
  try {
    const problems = scanRootProblems(root);
    assert.equal(problems.length, REQUIRED_DIRS.length + REQUIRED_FILES.length);
    assert.deepEqual(
      problems.map((p) => p.scanRoot),
      [...REQUIRED_DIRS, ...REQUIRED_FILES],
    );
    for (const p of problems) {
      assert.equal(p.expected, path.join(root, p.scanRoot));
      assert.equal(p.actual, 'ENOENT');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('期望的根是文件而不是目录，也要报', () => {
  // 存在但形状不对，与不存在一样会让 `walk()` 静默空转；不能只看「在不在」。
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-ports-shape-'));
  try {
    for (const rel of REQUIRED_DIRS) {
      if (rel !== 'server') mkdirSync(path.join(root, rel), { recursive: true });
    }
    for (const rel of REQUIRED_FILES) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), '{}\n', 'utf8');
    }
    writeFileSync(path.join(root, 'server'), 'not a directory\n', 'utf8');
    const problems = scanRootProblems(root);
    assert.deepEqual(problems.map((p) => p.scanRoot), ['server']);
    assert.equal(problems[0]!.actual, '不是目录');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('根都在时一条问题都不报', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-ports-ok-'));
  try {
    for (const rel of REQUIRED_DIRS) mkdirSync(path.join(root, rel), { recursive: true });
    for (const rel of REQUIRED_FILES) {
      mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      writeFileSync(path.join(root, rel), '{}\n', 'utf8');
    }
    assert.deepEqual(scanRootProblems(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
