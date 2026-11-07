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
 *
 *   这之后不再是「靠纪律」：vite dev/preview 注册只读 `/__tree-id`，返回本服务的
 *   工作树绝对路径、实际监听端口、启动时间；连本机 vite 的 check-* / smoke /
 *   capture / verify 脚本在等待 HTTP 通过后先校验身份，路径不一致即退出 1，并打印
 *   「你连的是 52xx 那棵树（路径 X），你站在另一棵树（路径 Y）」。端点不可达或返回
 *   体不合法同样判红，不放行。端点不进生产构建产物：插件 `apply: 'serve'`，只挂
 *   `configureServer` / `configurePreviewServer`，`build` 不触发。外部 URL 或显式
 *   `PIXEL_WORLD_SKIP_TREE_IDENTITY=1` 时跳过比对（并打印跳过原因）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentKindFor, findBannedPorts } from './audit-ports-lib.ts';
import {
  SCAN_BASELINE_PATH,
  checkScanFloor,
  failureWhy,
  loadScanBaseline,
} from './audit-scan-guard-lib.ts';
import type { ScanFloor, ScanRootProblem } from './audit-scan-guard-lib.ts';

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

/** 必须有、否则说明扫描面缺了一块：目录根。 */
export const REQUIRED_DIRS: readonly string[] = [
  'world-client/scripts',
  'scripts',
  '.github/workflows',
  'server',
];

/**
 * 必须有、否则说明扫描面缺了一块：固定文件落点。
 * `.env*` 不在此列——文件头写明它们是**示例**，允许不存在。
 */
export const REQUIRED_FILES: readonly string[] = [
  'world-client/vite.config.ts',
  'world-client/package.json',
  'package.json',
];

/**
 * 期望的扫描根在不在。**根缺失就是红**：`walk()` 原来对着不存在的目录
 * `return`，受查数悄悄缩水，而输出仍是一句「0 处禁用端口」。
 */
export function scanRootProblems(repoRoot: string = REPO_ROOT): ScanRootProblem[] {
  const problems: ScanRootProblem[] = [];
  const check = (rel: string, kind: '目录' | '文件'): void => {
    const abs = join(repoRoot, rel);
    try {
      const st = statSync(abs);
      const ok = kind === '目录' ? st.isDirectory() : st.isFile();
      if (!ok) problems.push({ scanRoot: rel, expected: abs, actual: `不是${kind}` });
    } catch (error) {
      problems.push({ scanRoot: rel, expected: abs, actual: failureWhy(error) });
    }
  };
  for (const rel of REQUIRED_DIRS) check(rel, '目录');
  for (const rel of REQUIRED_FILES) check(rel, '文件');
  return problems;
}

function collectTargets(repoRoot: string = REPO_ROOT, worldRoot: string = WORLD_ROOT): ScanTarget[] {
  const targets: ScanTarget[] = [];
  walk(join(worldRoot, 'scripts'), targets);
  walk(join(repoRoot, 'scripts'), targets);
  walk(join(repoRoot, '.github', 'workflows'), targets);
  walk(join(repoRoot, 'server'), targets);

  for (const path of [
    join(worldRoot, 'vite.config.ts'),
    join(worldRoot, 'package.json'),
    join(repoRoot, 'package.json'),
    join(repoRoot, '.env'),
    join(repoRoot, '.env.example'),
    join(worldRoot, '.env'),
    join(worldRoot, '.env.example'),
    join(repoRoot, 'server', '.env'),
    join(repoRoot, 'server', '.env.example'),
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

function isTestOrFixture(path: string, repoRoot: string = REPO_ROOT): boolean {
  const rel = relative(repoRoot, path).split('\\').join('/');
  return rel.includes('/test/') || rel.includes('/fixtures/');
}

function main(): void {
  const problems = scanRootProblems();
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

  if (problems.length > 0) {
    console.error(`audit-ports: 扫描面不完整：${problems.length} 个扫描根不存在。`);
    for (const p of problems) {
      console.error(
        `  扫描根不存在：${p.scanRoot} —— 期望 ${p.expected}，实际 ${p.actual}`,
      );
    }
    process.exitCode = 1;
  }

  const loaded = loadScanBaseline(SCAN_BASELINE_PATH);
  let floor: ScanFloor;
  if (loaded.ok) {
    floor = checkScanFloor(loaded.baseline, 'ports', 'files', targets.length);
  } else {
    console.error(`audit-ports: 扫描面基线没查成：${loaded.why}。没有地板就不是绿。`);
    floor = { kind: 'missing' };
    process.exitCode = 1;
  }
  if (floor.kind === 'missing' && loaded.ok) {
    console.error('audit-ports: 基线文件里没有 ports.files。没有地板就不是绿。');
    process.exitCode = 1;
  } else if (floor.kind === 'breach') {
    console.error(
      `audit-ports: 扫描面塌陷：受查 ${targets.length} 个文件，比基线 ${floor.baseline} ` +
        `少 ${floor.baseline - targets.length} 个（允许最多降 ${floor.allowed} 个）。`,
    );
    process.exitCode = 1;
  }

  const clean = problems.length === 0 && floor.kind === 'ok';
  if (hitCount > 0) {
    console.error(`audit-ports: ${hitCount} 处禁用端口（扫描 ${targets.length} 个文件）`);
    process.exitCode = 1;
    return;
  }
  if (!clean) {
    // 有扫描面问题时绝不打印那句「0 处」的绿话——它会被读成「验过了」。
    console.error(`audit-ports: 扫描 ${targets.length} 个文件，0 处禁用端口；但扫描面问题未解决，本次不算绿。`);
    return;
  }
  console.log(`audit-ports: 0 处禁用端口（扫描 ${targets.length} 个文件）`);
}

// 被 import 时不跑 main：测试要的就是那几个纯函数，不是它的退出码。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
