/**
 * `npm run check` 的真身。
 *
 * ## 为什么不是直接 `tsc --noEmit`
 *
 * 因为 **tsc 一旦看见任何一处语法错，就只报语法错，整个工程的语义诊断一处都不
 * 算**。这一条是实测的，不是推测：
 *
 *   两个文件，`a.ts` 一处 TS1110（语法），`b.ts` 一处 TS2322（语义），互不 import。
 *   `tsc --noEmit` 只输出 TS1110。把 `a.ts` 删掉，TS2322 立刻出现。
 *   两处错写在同一个文件里也一样：只报语法那处。
 *
 * 于是 `tsc --noEmit` 有一种**看起来很干净的失败**：输出短短一两行，全在别人的
 * 草稿文件里，你心想"那不是我的代码"，收工、提交。而你自己文件里的语义错——包括
 * 你这一笔刚引入的那两处——一行都没被算出来。这不是假想：本仓已经因此红过一次，
 * 提交信息里写的是「我那次 typecheck 是假的干净」。
 *
 * 退出码救不了这个：有语法错和有两处语义错，`tsc` 都是非零退出。CI 该红还是红，
 * 红得一样。**看不出来的是人**——而人是被那份"只有一行、还在别人的文件里"的输出
 * 说服的。
 *
 * 所以这个包装做的事只有一件：把"语义诊断没算"这件事说出口，并且说清那 0 处是
 * **没算**而不是**算出来是 0**。它不试图把被关掉的语义错捞回来（捞不出来，tsc 没
 * 算），也不改退出码（该红还是红）。
 *
 * ## 为什么 `build` 没一起换
 *
 * `npm run build` 里的 `tsc --noEmit` 有一模一样的坑。没换是因为它是发布路径，
 * 而这一笔只该修 `check`；换不换由下一个动 `build` 的人决定，那时候他该读到这里。
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `--pretty false` 之下，tsc 的诊断就长这样：`文件(行,列): error TS2322: 消息`。 */
const DIAGNOSTIC =
  /^(.*?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)$/;

/** 语法错的码段。TS1xxx 是 parse 阶段的，TS2xxx 往后全是语义与配置的。 */
const SYNTACTIC_FLOOR = 1000;
const SYNTACTIC_CEIL = 1999;

export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly severity: 'error' | 'warning';
  readonly code: number;
  readonly message: string;
  readonly raw: string;
}

/**
 * 把 tsc 的输出拆成一条条诊断。
 *
 * 解析不上的是**空行跳过、非空行原样留着**（`raw` 有值、`code` 是 NaN）。
 * 这一条是安全闸：宁可承认"我没解析上"，也不能把看不懂的行数成 0 处语义错——
 * 那正是这个脚本存在的理由，换个方向再犯一遍没有意义。
 */
export function parseDiagnostics(output: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const match = DIAGNOSTIC.exec(raw);
    if (match === null) {
      out.push({
        file: '',
        line: 0,
        col: 0,
        severity: 'error',
        code: Number.NaN,
        message: '',
        raw,
      });
      continue;
    }
    out.push({
      file: match[1] ?? '',
      line: Number(match[2]),
      col: Number(match[3]),
      severity: (match[4] as 'error' | 'warning') ?? 'error',
      code: Number((match[5] ?? 'TS0').slice(2)),
      message: match[6] ?? '',
      raw,
    });
  }
  return out;
}

export function isSyntactic(diagnostic: Diagnostic): boolean {
  if (Number.isNaN(diagnostic.code)) return false;
  return (
    diagnostic.code >= SYNTACTIC_FLOOR && diagnostic.code <= SYNTACTIC_CEIL
  );
}

export interface Tally {
  readonly syntactic: number;
  readonly semantic: number;
  /** 解析不上、因而没法归类的行数。大于 0 时下面的任何"0 处"都不可信。 */
  readonly unparsed: number;
}

export function tally(diagnostics: readonly Diagnostic[]): Tally {
  let syntactic = 0;
  let semantic = 0;
  let unparsed = 0;
  for (const diagnostic of diagnostics) {
    if (Number.isNaN(diagnostic.code)) unparsed += 1;
    else if (isSyntactic(diagnostic)) syntactic += 1;
    else semantic += 1;
  }
  return { syntactic, semantic, unparsed };
}

/**
 * 那句必须说出口的话。返回 `null` 表示没有需要提醒的。
 *
 * 触发条件刻意收得很紧：**有语法错、且一条语义错都没报出来、且没有解析不上的行**。
 * 三者缺一个都不提醒——缺第二个说明语义错本来就报了（tsc 没被关掉），缺第三个
 * 说明我们看不懂输出，那该说的是"看不懂"而不是"被关掉了"。
 */
export function blindnessNote(counts: Tally): string | null {
  if (counts.unparsed > 0) return null;
  if (counts.syntactic === 0) return null;
  if (counts.semantic > 0) return null;
  return [
    '',
    '──────────────────────────────────────────────────────────────',
    'tsc 看见语法错时只报语法错：整个工程的语义诊断一处都没算。',
    '',
    `上面这 ${counts.semantic} 处「语义错」是**没算**，不是**算出来是 0**。`,
    '所以此刻这份输出不能当作「类型干净」用——修掉语法错，再跑一次。',
    '',
    '别把上面那几行语法错当成「别人的草稿，与我无关」就收工：',
    '它正在替你藏着你**自己**文件里的语义错，',
    '包括你这一笔刚引入的那几处。',
    '──────────────────────────────────────────────────────────────',
    '',
  ].join('\n');
}

export interface CheckResult {
  /** tsc 的原样输出。包装不改写它，测试也照这一份判。 */
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
  readonly counts: Tally;
  readonly note: string | null;
}

/**
 * 对**任意** tsconfig 跑一遍，把结果连那句提醒一起交回来。
 *
 * 收 `tsconfig` 当参数而不是读死仓库那一份：测试要拿临时目录里的夹具喂它，
 * 而夹具的状态是我能钉死的——仓库那份的状态由另一个人的草稿文件决定，
 * 拿它当判据的测试今天绿、明天红，那种测试比没有更糟。
 */
export function checkTypes(tsconfig: string): CheckResult {
  const tsc = fileURLToPath(
    new URL('../node_modules/typescript/bin/tsc', import.meta.url),
  );
  const run = spawnSync(
    process.execPath,
    [tsc, '--noEmit', '-p', tsconfig, '--pretty', 'false'],
    { encoding: 'utf8' },
  );

  // tsc 自己起不来（配置坏了、二进制没了）：照原样交出去，别吞。
  if (run.error !== undefined) {
    return {
      stdout: '',
      stderr: `check-types：tsc 没跑起来：${run.error.message}`,
      status: 1,
      counts: { syntactic: 0, semantic: 0, unparsed: 0 },
      note: null,
    };
  }

  const counts = tally(parseDiagnostics(run.stdout));
  return {
    stdout: run.stdout,
    stderr: run.stderr,
    status: run.status ?? 1,
    counts,
    note: blindnessNote(counts),
  };
}

function main(): void {
  // `--tsconfig <path>` 这个口子只开给测试：进程级那条用例得指着临时目录里的
  // 夹具跑。仓库那一份的状态由另一个人的草稿文件决定——拿它当判据的测试
  // 今天绿、明天红，那种测试比没有更糟。
  const at = process.argv.indexOf('--tsconfig');
  const override = at === -1 ? undefined : process.argv[at + 1];
  if (at !== -1 && override === undefined) {
    process.stderr.write('check-types：--tsconfig 后面缺一个路径\n');
    process.exitCode = 1;
    return;
  }
  const tsconfig =
    override ?? fileURLToPath(new URL('../tsconfig.json', import.meta.url));
  const result = checkTypes(tsconfig);

  // 原样转发，一行不改：诊断本身是 tsc 的产物，包装不该有改写权。
  if (result.stdout !== '') process.stdout.write(result.stdout);
  if (result.stderr !== '') process.stderr.write(result.stderr);

  if (result.counts.unparsed > 0) {
    process.stderr.write(
      `check-types：${result.counts.unparsed} 行输出没解析上，下面的计数不完整，别当结论用。\n`,
    );
  }
  if (result.note !== null) process.stderr.write(result.note);

  if (result.counts.unparsed === 0) {
    const { syntactic, semantic } = result.counts;
    process.stderr.write(
      `check-types：语法 ${syntactic} 处 / 语义 ${semantic} 处` +
        `${syntactic > 0 && semantic === 0 ? '（语义那栏是没算，见上）' : ''}\n`,
    );
  }

  process.exitCode = result.status;
}

// 被 import 时不跑 main：测试要的是那几个纯函数，不是它的退出码。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
