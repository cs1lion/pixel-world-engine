/**
 * 截图输出口径：默认写 `tmp/screens/<脚本名>/`（未跟踪），写回仓库基线必须显式授权。
 *
 * 为什么统一：`eval/screens/` 同时装着**已跟踪的验收基线**和**每次跑都会变的现场图**。
 * 以前十几条 gate 默认直接写进去，跑一次就脏一棵工作树；`git add -A` 分不开
 * 「这次跑的现场」和「上一次的底片」。所以：
 *
 *   · 缺省（没有 `EVAL_OUT`、没有 `--write-baseline`）→ `tmp/screens/<脚本名>/`；
 *   · 显式 `--write-baseline` → `world-client/eval/screens/`；
 *   · 显式 `EVAL_OUT` → 尊重这个路径（CI 指到 runner 临时目录，行为不变）；
 *   · 目标目录下**命中已跟踪文件**、又没有上面两种显式授权 → 直接拒绝并退出，
 *     打印会被覆盖的文件清单与放行命令。
 *
 * 只做「写」的判断，不改「读」：需要读已提交基线的脚本应显式用 `BASELINE_DIR`，
 * 不要把输出目录当输入目录用（`lamp-band-before*.png` 就是这么分开的）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
/** `world-client/`，与脚本所在位置无关，避免 cwd 不同时相对路径漂走。 */
export const CLIENT_ROOT = resolve(LIB_DIR, '..', '..');
/** 已跟踪基线目录。读基线用它，写基线要显式授权。 */
export const BASELINE_DIR = resolve(CLIENT_ROOT, 'eval', 'screens');
/** 显式写回基线的开关。 */
export const WRITE_BASELINE_FLAG = '--write-baseline';

const toPosix = (value) => value.split(/[\\/]+/).join('/');

/** 目录下已跟踪的文件（仓库相对路径）。目录在仓库外或 git 不可用时返回空。 */
export function trackedFilesIn(dir, { clientRoot = CLIENT_ROOT } = {}) {
  const rel = toPosix(relative(clientRoot, dir));
  if (rel !== '' && (rel.startsWith('..') || rel.includes(':'))) return [];
  const pathspec = rel === '' ? '.' : rel;
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', pathspec], {
      cwd: clientRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 解析输出目标（不落盘、不退出，便于单测）。
 *
 * @param {string} script 脚本名（`tmp/screens/<脚本名>/` 的最后一段）。
 * @param {{env?:Record<string,string|undefined>, argv?:string[], clientRoot?:string, baselineDir?:string}} [options]
 * @returns {{dir:string, baseline:boolean, authorized:boolean, explicit:'flag'|'EVAL_OUT'|null}}
 */
export function resolveShotTarget(script, options = {}) {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const clientRoot = options.clientRoot ?? CLIENT_ROOT;
  const baselineDir = options.baselineDir ?? resolve(clientRoot, 'eval', 'screens');

  const flag = argv.includes(WRITE_BASELINE_FLAG);
  const evalOut = env.EVAL_OUT;
  const explicitOut = typeof evalOut === 'string' && evalOut.length > 0;

  // 相对 `EVAL_OUT` 一律以 `world-client/` 为基准：npm 脚本与直接 node 调用
  // 的 cwd 可能不同，旧代码里 `'eval/screens'` 是按 cwd 解析的，这里把它钉死。
  const dir = explicitOut
    ? resolve(clientRoot, evalOut)
    : flag
      ? baselineDir
      : resolve(clientRoot, 'tmp', 'screens', script);
  const baseline = resolve(dir) === resolve(baselineDir);
  const authorized = baseline && (flag || explicitOut);
  const explicit = flag ? 'flag' : explicitOut ? 'EVAL_OUT' : null;
  return { dir, baseline, authorized, explicit };
}

/** 拒写时打印的行；放行（已授权或没有已跟踪文件）时返回空数组。 */
export function blockedWriteLines(script, target, files) {
  if (target.authorized || files.length === 0) return [];
  return [
    `[截图输出] 拒绝写入 ${target.dir}：该目录下有 ${files.length} 个**已跟踪**文件，但没有显式授权。`,
    '[截图输出] 会被覆盖的已跟踪文件：',
    ...files.map((file) => `  - ${file}`),
    '[截图输出] 放行方式（二选一）：',
    `  node scripts/${script}.mjs ${WRITE_BASELINE_FLAG}`,
    `  EVAL_OUT=eval/screens node scripts/${script}.mjs`,
  ];
}

/**
 * 解析并创建输出目录；命中已跟踪文件且无授权时打印清单并退出（退出码 1）。
 *
 * @param {string} script
 * @param {Parameters<typeof resolveShotTarget>[1]} [options]
 * @returns {string} 可写的输出目录
 */
export function resolveShotDir(script, options = {}) {
  const target = resolveShotTarget(script, options);
  const files = trackedFilesIn(target.dir, { clientRoot: options.clientRoot });
  const blocked = blockedWriteLines(script, target, files);
  if (blocked.length > 0) {
    for (const line of blocked) console.error(line);
    process.exit(1);
  }
  mkdirSync(target.dir, { recursive: true });
  const note = target.authorized ? '（仓库基线，已显式授权）' : '（未跟踪）';
  console.log(`[截图输出] ${script} → ${target.dir}${note}`);
  return target.dir;
}
