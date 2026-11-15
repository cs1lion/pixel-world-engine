/**
 * red-first 的纯逻辑：把 `git diff --name-status` 的结果分成
 * 「该在 base 上跑红的测试」「合理跳过」「支撑文件」。
 *
 * 这一层不碰 git、不碰进程，方便单测；真正的临时 worktree / 跑测试在
 * `red-first.ts`。跳过条件集中在这里，避免 CLI 里散落 if。
 */

export interface ChangedFile {
  /** git 的 A/M/D/R 状态；R 取新路径。 */
  status: string;
  /** 仓库根相对路径。 */
  path: string;
}

export interface SkipEntry {
  file: string;
  reason: string;
}

export interface TestPlan {
  kind: 'run' | 'skip';
  run: string[];
  support: string[];
  skipped: SkipEntry[];
  reason?: string;
}

/**
 * 「快照型参数化用例」的显式清单。
 *
 * 这些用例钉的是已经存在的快照/夹具字段，或由参数化夹具驱动；在 base 上
 * 它们可能因为字段本来就存在而直接绿，红灯判据不成立。跳过不是放行，
 * 而是交给普通 `npm test` 与夹具自检，并在这里写明原因。
 */
export const SNAPSHOT_LIKE_TESTS: SkipEntry[] = [
  {
    file: 'test/pin-shot-state.test.ts',
    reason: '快照字段登记用例：钉的是现有快照/渲染输入表，base 上可能本来就绿',
  },
  {
    file: 'test/fixture-self-check.test.ts',
    reason: '夹具自检用例：参数化读 fixtures，base 上可能本来就绿',
  },
  {
    file: 'test/eval-fixture-hash.test.ts',
    reason: '夹具哈希用例：参数化读夹具与基线，base 上可能本来就绿',
  },
  {
    file: 'test/art-building-scale.test.ts',
    reason: '纯函数边界用例：依赖 src/render/art-assets.ts（base 上不存在），red-first 只套 test/ diff 无法带入新 src 文件',
  },
  {
    file: 'test/work-note-client.test.ts',
    reason: '牌子运输侧：依赖 src/world/work-note-client.ts（base 上不存在），red-first 只套 test/ diff 无法带入新 src 文件；世界侧仍在 test/work-note.test.ts 真出红',
  },
  {
    file: 'test/site-output.test.ts',
    reason: '场所产出账：依赖 src/world/site-output.ts（base 上不存在），red-first 只套 test/ diff 无法带入新 src 文件',
  },
  {
    file: 'test/villager-decision-client.test.ts',
    reason: '人物决策运输侧：依赖 src/world/villager-decision-client.ts（base 上不存在），red-first 只套 test/ diff 无法带入新 src 文件；世界侧仍在 test/villager-decision.test.ts 真出红',
  },
];

const SNAPSHOT_BY_FILE = new Map(SNAPSHOT_LIKE_TESTS.map((entry) => [entry.file, entry.reason]));

/** 测试文件路径 → 相对测试目录的路径；不在这棵树下返回 null。 */
export function toTestRelative(path: string): string | null {
  const prefix = 'world-client/';
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  return rest.startsWith('test/') ? rest : null;
}

export function isSnapshotLikeTest(testRelativePath: string): string | null {
  return SNAPSHOT_BY_FILE.get(testRelativePath) ?? null;
}

/**
 * 把 TypeScript 源码剥成「语义骨架」：去行注释、去块注释、去空白。
 *
 * 用途只有一个——判断两个版本的**行为是否一样**。字符串字面量里的内容
 * 原样保留（测试文案、断言消息改了也是真改动，不该被剥掉）。模板字符串
 * 同理原样保留：里面的 `${...}` 是表达式，剥注释会伤到它们，干脆整段留下。
 *
 * 这不是完整的 TS 解析器，**只服务 red-first 的一个判据**：
 * 「这个测试文件本次是不是只改了注释」。宁可把「像注释的字符串」留下（误判成
 * 有改动、多跑一次 base），也不能把真注释留下（漏判成有改动 → base 绿 → 判红）。
 * 前者是误伤自己一次，后者是闸门失灵。
 *
 * 行注释后那个换行也被剥掉（不是恢复成代码）：否则同一段代码一行注释与一段
 * 块注释会产出两个骨架——一行注释的版本末尾多一个换行、块注释的版本没有，
 * 本来只改注释的文件会被当成改了代码。
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote: string | null = null;
  const NEWLINE = String.fromCharCode(10);
  const BACKSLASH = String.fromCharCode(92);
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (inLine) {
      if (c === NEWLINE) { inLine = false; }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && next === '/') { inBlock = false; i += 2; continue; }
      i += 1;
      continue;
    }
    if (quote !== null) {
      out += c;
      if (c === BACKSLASH) { out += source[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && next === '/') { inLine = true; i += 2; continue; }
    if (c === '/' && next === '*') { inBlock = true; i += 2; continue; }
    if (c === ' ' || c === NEWLINE || c === '\r' || c === '\t') { i += 1; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 规则（按用户要求的窄范围）：
 * 1. 没有 world-client 改动 → 跳过（只改文档/其它目录）；
 * 2. 没有 test/ 下的测试文件改动 → 跳过（只改测试以外、纯重构、测试 diff 为空）；
 * 3. 测试文件被删除 → 跳过并说明（base 上没有可跑的新测试，需人工核对）；
 * 4. 快照型参数化用例 → 跳过并说明；混合时只跑剩下的普通测试。
 */
export function planTestChanges(changes: ChangedFile[]): TestPlan {
  const worldChanges = changes.filter((change) => change.path.startsWith('world-client/'));
  if (worldChanges.length === 0) {
    return {
      kind: 'skip',
      run: [],
      support: [],
      skipped: [],
      reason: '本次没有 world-client 改动（只改文档或其它目录）',
    };
  }

  const testChanges = worldChanges
    .map((change) => ({ ...change, relative: toTestRelative(change.path) }))
    .filter((change): change is ChangedFile & { relative: string } => change.relative !== null);

  if (testChanges.length === 0) {
    return {
      kind: 'skip',
      run: [],
      support: [],
      skipped: [],
      reason: '测试 diff 为空（只改测试以外，或纯重构没有新增/修改测试）',
    };
  }

  const run: string[] = [];
  const support: string[] = [];
  const skipped: SkipEntry[] = [];

  for (const change of testChanges) {
    if (!change.relative.endsWith('.test.ts')) {
      if (change.status !== 'D') support.push(change.relative);
      continue;
    }
    if (change.status === 'D') {
      skipped.push({
        file: change.relative,
        reason: '测试文件被删除：base 上没有可跑的测试，需人工核对是否只是删用例',
      });
      continue;
    }
    const snapshotReason = isSnapshotLikeTest(change.relative);
    if (snapshotReason) {
      skipped.push({ file: change.relative, reason: snapshotReason });
      continue;
    }
    run.push(change.relative);
  }

  if (run.length === 0) {
    return {
      kind: 'skip',
      run: [],
      support,
      skipped,
      reason:
        skipped.length > 0
          ? '改动只涉及快照型/被删除的测试，已按条件跳过'
          : '没有可跑的测试文件',
    };
  }

  return { kind: 'run', run: run.sort(), support: support.sort(), skipped };
}

/**
 * base 上失败的原因分类。
 *
 * 只有 `assertion` 算「红得对」：测试代码真的跑到了断言，并因为实现缺失而失败。
 * 其余四类一律不可采信（ERROR）：
 *   - module：模块解析失败（测试文件 import 写错、依赖不存在）；
 *   - compile：语法/类型/转译失败；
 *   - crash：进程级崩溃（OOM、段错误、未捕获的运行时致命错误）；
 *   - unknown：没有识别到断言信号，无法说明为什么红。
 *
 * 分类顺序是「基础设施错误优先」：同一份输出里既出现 import 错误又出现断言
 * 文字时，按 module 处理，避免把「根本没跑起来」误认成断言失败。
 */
export type BaseFailureKind = 'assertion' | 'module' | 'compile' | 'crash' | 'unknown';

const MODULE_FAILURE = [
  /ERR_MODULE_NOT_FOUND/,
  /ERR_UNKNOWN_FILE_EXTENSION/,
  /ERR_UNSUPPORTED_ESM_URL_SCHEME/,
  // 行首锚定：B14 的写法会把 Node 的原文（`Cannot find module …`）留在断言
  // 消息里，那是「测试先于实现」的合格红，不是基础设施错误。真正的模块错误
  // 总以 `Error [ERR_MODULE_NOT_FOUND]: …` 或 `Cannot find module …` 起行。
  /^\s*(?:Error(?: \[[A-Z_]+\])?: )?Cannot find module\b/m,
  /^\s*(?:Error(?: \[[A-Z_]+\])?: )?Cannot find package\b/m,
  /Failed to resolve import/,
];

const COMPILE_FAILURE = [
  /ERR_INVALID_TYPESCRIPT_SYNTAX/,
  /SyntaxError/,
  /error TS\d+/,
  /Unexpected token/,
  /Unexpected identifier/,
];

const CRASH_FAILURE = [
  /FATAL ERROR/,
  /Segmentation fault/,
  /core dumped/,
  /JavaScript heap out of memory/,
  /ERR_WORKER_OUT_OF_MEMORY/,
  /Aborted/,
];

const ASSERTION_FAILURE = [
  /ERR_ASSERTION/,
  /AssertionError/,
  /Assertion failed/,
  /failureType: 'testCodeFailure'/,
  /failureType: 'testTimeoutFailure'/,
  /test timed out/,
  /^\s*not ok \d+/m,
  /^\s*✖ /m,
  /\bexpected\b[\s\S]*\bactual\b/i,
];

export function classifyBaseFailure(output: string): BaseFailureKind {
  return explainBaseFailure(output).kind;
}

/** 一次分类的现场：命中的是哪条规则、哪一行、哪个文件。 */
export interface BaseFailureEvidence {
  kind: BaseFailureKind;
  /** 命中的正则源码；`unknown` 时为 null。 */
  pattern: string | null;
  /** 命中行在输出里的行号（1 起）。 */
  line: number | null;
  /** 命中的那一行（已 trim）。 */
  matched: string | null;
  /** 出错文件；输出里找不到时为 null。 */
  file: string | null;
  /** 出错文件里的行号（能解析到就带）。 */
  fileLine: number | null;
  /** 命中行前后各 4 行，供人直接看现场。 */
  context: string[];
}

const SIGNALS: readonly { kind: BaseFailureKind; patterns: readonly RegExp[] }[] = [
  { kind: 'module', patterns: MODULE_FAILURE },
  { kind: 'compile', patterns: COMPILE_FAILURE },
  { kind: 'crash', patterns: CRASH_FAILURE },
  { kind: 'assertion', patterns: ASSERTION_FAILURE },
];

/**
 * 测试文件的路径（可带 `file://` 前缀）都认；路径后面紧跟行号的也认。
 * （注释里不写具体的文件路径或冒号加数字：`audit-references` / `audit-citations`
 * 会把它们当成真的引用去查。）
 */
const FILE_HINT = /((?:file:\/\/\/)?[^\s()"']*?test[/\\][^\s:'"()]+\.(?:ts|tsx|mjs|js))(?::(\d+)(?::\d+)?)?/;

/**
 * 给出「为什么红」的现场，而不只是分类。
 *
 * 分类器扫的是**全量输出**，而闸门只打 `tail(output, 18)`——真因常常在截掉的
 * 前面（2026-11-08：`kind=module` 的真因是另一份测试的 `ERR_MODULE_NOT_FOUND`，
 * 日志尾部只剩一条形状正确的 shot-stable 断言，读日志的人会追错方向）。
 * 所以这里把命中规则、行号、文件和上下文一并交出来。
 */
export function explainBaseFailure(output: string): BaseFailureEvidence {
  const lines = output.split(/\r?\n/);
  for (const signal of SIGNALS) {
    for (const pattern of signal.patterns) {
      const match = pattern.exec(output);
      if (!match) continue;
      const lineIndex = output.slice(0, match.index).split(/\r?\n/).length - 1;
      const hint = findFileHint(lines, lineIndex);
      return {
        kind: signal.kind,
        pattern: pattern.source,
        line: lineIndex + 1,
        matched: (lines[lineIndex] ?? '').trim(),
        file: hint?.file ?? null,
        fileLine: hint?.line ?? null,
        context: lines.slice(Math.max(0, lineIndex - 4), Math.min(lines.length, lineIndex + 5)),
      };
    }
  }
  return { kind: 'unknown', pattern: null, line: null, matched: null, file: null, fileLine: null, context: [] };
}

function findFileHint(lines: readonly string[], hit: number): { file: string; line: number | null } | null {
  // 先看命中行本身与下一行（`ERR_MODULE_NOT_FOUND` 的 `imported from …` 在下一行），
  // 再往回找（`SyntaxError` 的文件头与源码行在错误消息上方）。
  const offsets = [0, 1, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
  for (const offset of offsets) {
    const index = hit + offset;
    if (index < 0 || index >= lines.length) continue;
    const found = FILE_HINT.exec(lines[index] ?? '');
    if (!found) continue;
    return { file: stripFileUrl(found[1] ?? ''), line: found[2] ? Number(found[2]) : null };
  }
  return null;
}

/** `file:///tmp/x` → `/tmp/x`；`file:///C:/x` → `C:/x`。 */
function stripFileUrl(raw: string): string {
  if (!raw.startsWith('file:///')) return raw;
  const rest = raw.slice('file:///'.length);
  return /^[A-Za-z]:/.test(rest) ? rest : `/${rest}`;
}

/** 解析 `--base` / `--repo` / `--timeout` / `--keep`；空字符串的 base 视为未给。 */
export interface Args {
  base: string;
  repo: string;
  timeoutMs: number;
  keep: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { base: '', repo: '', timeoutMs: 120_000, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--keep') {
      args.keep = true;
    } else if (arg.startsWith('--base=')) {
      args.base = arg.slice('--base='.length).trim();
    } else if (arg === '--base') {
      args.base = (argv[i + 1] ?? '').trim();
      i += 1;
    } else if (arg.startsWith('--repo=')) {
      args.repo = arg.slice('--repo='.length).trim();
    } else if (arg === '--repo') {
      args.repo = (argv[i + 1] ?? '').trim();
      i += 1;
    } else if (arg.startsWith('--timeout=')) {
      const value = Number(arg.slice('--timeout='.length));
      if (Number.isFinite(value) && value > 0) args.timeoutMs = value;
    } else if (arg === '--timeout') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) args.timeoutMs = value;
      i += 1;
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }
  return args;
}
