import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentKindFor, findBannedPorts } from '../scripts/audit-ports-lib.ts';

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
