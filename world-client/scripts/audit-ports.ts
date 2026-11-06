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
 *
 * 端口分配表（基线 5211 的前提是「同时只允许一个服务端在 5210–5219 段监听」）：
 *   5211  默认 dev/preview 服务端：vite.config 默认、dev-live、CI preview；
 *         以及所有只连接、不监听的脚本（check-* / smoke / 各类 capture）。
 *   5212  accept-live 自起的隔离前端（`npm run test:live`），可与 5211 并存。
 *   5189  demo-run / demo-live-serve / e2e-real-frame / s5-e2e-serve 的临时 vite。
 *   5291  check-oracle-e2e；5322  daycard-browser；5307  evidence-liveliness 手动。
 *   8000/8001 开发 API；8011/8012 accept-live API 与 LLM 桩；8931/8932 oracle。
 *
 * 多工作树并行（本仓常见 30+ 棵同时开 `npm run dev`）：
 *   每棵工作树固定一个 5210–5299 内的端口（避开 5212 给 accept-live），并在该
 *   工作树的终端里导出 `PIXEL_WORLD_CLIENT_PORT=52xx`。`npm run dev` 已带
 *   `--strictPort`：端口被占会直接失败，不会静默漂到 521x 隔壁。
 *   客户端脚本一律 `PIXEL_WORLD_URL=http://127.0.0.1:52xx/` 指过去；未显式设置时会
 *   回落到 `PIXEL_WORLD_CLIENT_PORT`（check-interact 的变量名是 `PWE_URL`，
 *   capture-palette / demo-run 用各自的 URL 变量），再回落到 5211。
 *   剩余的洞：若两棵工作树都忘了设环境变量，第二棵的 dev 会在 strictPort 处失败，
 *   但它的 check-* 仍默认打 5211，可能测到第一棵的应用。所以并行时必须设环境
 *   变量；这条规则目前靠纪律 + strictPort 报错，客户端尚不校验「服务器是不是我
 *   这棵树起的」。
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
