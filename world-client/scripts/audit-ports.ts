/**
 * 端口纪律 lint：禁用 5188 / 5191 / 5202 / 5203 在脚本、配置、.env 示例里
 * 以**可执行字面量**出现。注释里的人话不算，命中即退出 1。
 *
 * 扫描面（窄而有界）：
 *   - world-client/scripts/**（递归，排除 lint 自身与 test/fixtures）
 *   - world-client/vite.config.ts、world-client/package.json
 *   - scripts/**、package.json
 *   - .github/workflows/**
 *   - server/** 的文本配置/脚本
 *   - 根与 world-client/server 下的 .env* 示例
 *
 * 不扫 docs/ 与 test/：文档里的历史读数与测试夹具不是运行端口。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentKindFor, findBannedPorts } from './audit-ports-lib.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORLD_ROOT = join(REPO_ROOT, 'world-client');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'tmp', 'fixtures', 'test', '.git', '.vite']);
const TEXT_EXTENSIONS = new Set([
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.mts',
  '.cts',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.py',
  '.sh',
  '.ps1',
]);

interface ScanTarget {
  path: string;
  why: string;
}

function walk(dir: string, files: ScanTarget[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, files);
    } else if (entry.isFile()) {
      files.push({ path, why: '' });
    }
  }
}

function collectTargets(): ScanTarget[] {
  const targets: ScanTarget[] = [];
  walk(join(WORLD_ROOT, 'scripts'), targets);
  walk(join(REPO_ROOT, 'scripts'), targets);
  walk(join(REPO_ROOT, '.github', 'workflows'), targets);
  walk(join(REPO_ROOT, 'server'), targets);

  for (const path of [
    join(WORLD_ROOT, 'vite.config.ts'),
    join(WORLD_ROOT, 'package.json'),
    join(REPO_ROOT, 'package.json'),
    join(REPO_ROOT, '.env'),
    join(REPO_ROOT, '.env.example'),
    join(WORLD_ROOT, '.env'),
    join(WORLD_ROOT, '.env.example'),
    join(REPO_ROOT, 'server', '.env'),
    join(REPO_ROOT, 'server', '.env.example'),
  ]) {
    if (existsSync(path)) targets.push({ path, why: '' });
  }

  return targets.filter((target) => {
    const name = basename(target.path).toLowerCase();
    if (name === 'audit-ports.ts' || name === 'audit-ports-lib.ts') return false;
    if (name.startsWith('.env')) return true;
    return TEXT_EXTENSIONS.has(extname(name));
  });
}

function isTestOrFixture(path: string): boolean {
  const rel = relative(REPO_ROOT, path).split('\\').join('/');
  return rel.includes('/test/') || rel.includes('/fixtures/');
}

function main(): void {
  const targets = collectTargets().filter((target) => !isTestOrFixture(target.path));
  let hitCount = 0;
  for (const target of targets) {
    const source = readFileSync(target.path, 'utf8');
    const hits = findBannedPorts(source, commentKindFor(target.path));
    for (const hit of hits) {
      hitCount += 1;
      const rel = relative(REPO_ROOT, target.path).split('\\').join('/');
      console.error(`${rel}:${hit.line}: 禁用端口 ${hit.port} — ${hit.text}`);
    }
  }

  const relTargets = targets.map((target) => relative(REPO_ROOT, target.path));
  if (hitCount > 0) {
    console.error(`audit-ports: ${hitCount} 处禁用端口（扫描 ${relTargets.length} 个文件）`);
    process.exitCode = 1;
    return;
  }
  console.log(`audit-ports: 0 处禁用端口（扫描 ${relTargets.length} 个文件）`);
}

main();
