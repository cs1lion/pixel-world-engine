/**
 * `npm run check` 那个包装的用例。
 *
 * 守的东西只有一件：**tsc 看见语法错时，整个工程的语义诊断一处都不算**——这件
 * 事必须一直被说着，因为它的失败形态是"看起来很干净"：输出短短一两行，还全在
 * 别人的草稿文件里，人就这样收工、提交。
 *
 * （这里**不写**"本仓已经因此红过一次"。那句话我在第一稿里写过，是证不出来的：
 * 我看得见 `be825d5` 的提交信息说"我那次 typecheck 是假的干净"，可看不见他当时
 * 的本地输出，没法说那就是这一条机制造成的。旁证不是因果，写成因果就成了这个仓
 * 最忌讳的那种假话。）
 *
 * 所以第 1 条用例不是测我的代码，是测 **tsc 的行为**：拿一个真的夹具喂真的
 * tsc，看语义错是不是真的不见了。哪天 TypeScript 改了这个行为，这条用例会红，
 * 而它**就该红**——那时候 `scripts/check-types.ts` 存在的理由整个没了，该做的
 * 是把那个脚本删掉，不是把这条用例改绿。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  blindnessNote,
  checkTypes,
  parseDiagnostics,
  tally,
} from '../scripts/check-types.ts';

/** 一个语法错（TS1110）和一个语义错（TS2322），两个文件互不 import。 */
const SYNTAX_ERROR = 'export const broken: = 1;\n';
const SEMANTIC_ERROR = 'export const wrong: number = "not a number";\n';

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['ES2022'],
    module: 'ESNext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
  },
  include: ['*.ts'],
});

function fixture(files: Record<string, string>, t: { after: (fn: () => void) => void }): string {
  // 夹具一律落在系统临时目录：本仓有另一个人同时在改，往 `src/` 里塞一个坏文件
  // 会把他那一遍 typecheck 也变成"假的干净"——正是这个脚本要防的那件事。
  const dir = mkdtempSync(join(tmpdir(), 'pwe-check-types-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body, 'utf8');
  }
  writeFileSync(join(dir, 'tsconfig.json'), TSCONFIG, 'utf8');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'tsconfig.json');
}

test('前提：一处语法错真的会让整个工程的语义诊断消失', (t) => {
  const tsconfig = fixture(
    { 'a.ts': SYNTAX_ERROR, 'b.ts': SEMANTIC_ERROR, 'c.ts': 'export const fine = 1;\n' },
    t,
  );
  const blind = checkTypes(tsconfig);

  assert.match(blind.stdout, /TS1110/, '语法错该报出来');
  assert.ok(
    !blind.stdout.includes('TS2322'),
    `语义错本该被算出来，可它不在输出里：\n${blind.stdout}`,
  );
  assert.equal(blind.status, 2, '有错就该非零退出');

  // 对照组：把语法错那个文件删掉，语义错必须立刻出现。
  // 少了这一笔，上面那条断言也可能是"夹具本身写错了"造成的假红。
  unlinkSync(join(tsconfig, '..', 'a.ts'));
  const seeing = checkTypes(tsconfig);
  assert.match(seeing.stdout, /TS2322/, '删掉语法错之后，语义错该回来');
  assert.ok(!seeing.stdout.includes('TS1110'), '语法错已经没了');
});

test('前提也覆盖同一个文件里两处错：只报语法那处', (t) => {
  const tsconfig = fixture({ 'both.ts': SYNTAX_ERROR + SEMANTIC_ERROR }, t);
  const result = checkTypes(tsconfig);
  assert.match(result.stdout, /TS1110/);
  assert.ok(
    !result.stdout.includes('TS2322'),
    `同一文件里的语义错也不报：\n${result.stdout}`,
  );
});

test('该响的时候响：只有语法错时，那句「语义没算」必须说出口', (t) => {
  const tsconfig = fixture({ 'a.ts': SYNTAX_ERROR, 'b.ts': SEMANTIC_ERROR }, t);
  const result = checkTypes(tsconfig);
  assert.equal(result.counts.syntactic, 1);
  assert.equal(result.counts.semantic, 0);
  assert.ok(result.note !== null, '这种时刻不提醒，这个脚本就没有存在意义');
  assert.match(result.note, /没算/);
  assert.match(result.note, /不是\*\*算出来是 0\*\*/);
});

test('该闭嘴的时候闭嘴：语义错本来就会报，不用提醒', (t) => {
  const tsconfig = fixture({ 'b.ts': SEMANTIC_ERROR }, t);
  const result = checkTypes(tsconfig);
  assert.equal(result.counts.syntactic, 0);
  assert.equal(result.counts.semantic, 1);
  assert.equal(result.note, null, '没有语法错，语义错照常报，这时候提醒是噪音');
  assert.equal(result.status, 2);
});

test('干净的时候：退出 0，什么都不说', (t) => {
  const tsconfig = fixture({ 'ok.ts': 'export const n: number = 1;\n' }, t);
  const result = checkTypes(tsconfig);
  assert.equal(result.stdout, '');
  assert.equal(result.status, 0);
  assert.equal(result.note, null);
  assert.deepEqual(result.counts, { syntactic: 0, semantic: 0, unparsed: 0 });
});

test('解析不上的行不许被数成「0 处语义错」', () => {
  // 这是这个脚本自己的安全闸：它防的是"把没算当成算出来是 0"，
  // 那么它自己就不能再把"看不懂"当成"没有"。
  const parsed = parseDiagnostics('这一行完全不是 tsc 的输出\n');
  assert.equal(parsed.length, 1);
  assert.ok(Number.isNaN(parsed[0]!.code), '解析不上就该留着 NaN，不是 0');
  assert.equal(tally(parsed).unparsed, 1);
  assert.equal(
    blindnessNote(tally(parsed)),
    null,
    '看不懂输出时该说的是「看不懂」，不是「被关掉了」',
  );
});

test('那句话的三个触发条件，一个一个拆开验', () => {
  const note = blindnessNote({ syntactic: 1, semantic: 0, unparsed: 0 });
  assert.ok(note !== null);

  assert.equal(
    blindnessNote({ syntactic: 0, semantic: 0, unparsed: 0 }),
    null,
    '一处错都没有，没什么可说的',
  );
  assert.equal(
    blindnessNote({ syntactic: 3, semantic: 0, unparsed: 1 }),
    null,
    '有解析不上的行，结论不完整',
  );
  assert.equal(
    blindnessNote({ syntactic: 1, semantic: 4, unparsed: 0 }),
    null,
    '语义错本来就报了，tsc 没被关掉',
  );
});

test('tally 按码段分家：TS1xxx 是语法，TS2xxx 往后是语义', () => {
  const parsed = parseDiagnostics(
    [
      'x.ts(1,1): error TS1110: Type expected.',
      'y.ts(2,3): error TS2322: Type string is not assignable to type number.',
      'z.ts(4,5): error TS18046: x is of type unknown.',
      'w.ts(6,7): error TS2307: Cannot find module.',
    ].join('\n'),
  );
  assert.deepEqual(tally(parsed), { syntactic: 1, semantic: 3, unparsed: 0 });
});

test('缩进的续行不算独立的一条——真跑一遍的 170 行里 34 行是续行', () => {
  // 这一段是**真跑** `node scripts/check-types.ts` 抓下来的输出，只把那条长绝对
  // 路径截短了，形状一动没动。当时那份输出一共 170 行：136 条诊断 + 34 行续行。
  //
  // 为什么值得单独钉一条：不认续行的话，一条 TS2719 能派出三四行"解析不上"，
  // 全进 `unparsed`，安全闸当场把整个计数作废。实测就是这样——那一遍的计数是
  // "34 行没解析上"，而"语义没算"那句该响的时候响不出来。响不出来是安全闸在
  // 干活，但计数全废是它的代价，这个代价不必付。
  const parsed = parseDiagnostics(
    [
      "a.ts(1,1): error TS1110: Type expected.",
      "b.ts(2,3): error TS2719: Type '{ readonly id: string; }' is not assignable to type '{ readonly id: string; readonly primary: string; }'. Two different types with this name exist, but they are unrelated.",
      "  Type '{ id: string; }' is not assignable to type '{ readonly id: string; readonly primary: string; }'.",
      "    Types of property 'primary' are incompatible.",
      "b.ts(4,5): error TS2739: Type '{ id: string; }' is missing the following properties from type 'T': primary, accent",
    ].join('\n'),
  );
  assert.equal(parsed.length, 3, '两条诊断 + 一条语法错，续行不该各算一条');
  assert.deepEqual(tally(parsed), { syntactic: 1, semantic: 2, unparsed: 0 });
});

test('退出码透传到进程上：坏了就必须非零', (t) => {
  // 前几条走的是函数返回值，这一条走 main() 那条路——
  // 返回值对而退出码吞了，CI 会以为没事，那比没有这个脚本更糟。
  const tsconfig = fixture({ 'a.ts': SYNTAX_ERROR }, t);
  const script = fileURLToPath(new URL('../scripts/check-types.ts', import.meta.url));
  const run = spawnSync(process.execPath, [script, '--tsconfig', tsconfig], {
    encoding: 'utf8',
  });
  assert.notEqual(run.status, 0, '夹具是坏的，进程必须非零退出');
  assert.match(run.stderr, /没算/);
});

/**
 * 仓库**自己**那份 `tsconfig.json` 的 `include` 必须同时盖住 `src` 与 `test`。
 *
 * 上面十一条全是临时目录里的夹具，**没有一条看过真配置**。于是真配置被收窄时，
 * 全套照绿：把 `include` 改成 `["src"]`，`npm run check` 与 `npm run build`
 * 从此不再查那 150 多个测试文件，而它们的输出只会变短、不会变红。
 *
 * 这不是假想的坑。`c9d574d` 那一笔往 `test/` 里留了 11 处编译错没人发现，
 * 倒查时第一反应是「check-types 漏了 test/」——那句话是假的（它走
 * `tsconfig.json`，而 `include` 明明是 `["src", "test"]`，查得见），
 * 真正的原因是那一笔拿 `vite build` 当了类型验证，而 `vite build`
 * **一个类型都不查**（`package.json` 的 `build` 是
 * `node scripts/check-types.ts && vite build`，类型检查是前一半的事）。
 * 可倒查走到一半就够让人后怕：覆盖面全靠一行 `include` 撑着，
 * 而没有任何东西守着这一行。
 *
 * 所以这条不测行为，测**配置**：`src` 与 `test` 都得在 `include` 里。
 * 少一个就红，红的时候该做的是把它加回去，不是把这条改绿。
 *
 * 为什么只查这两项、不查 `exclude`：`exclude` 今天没有值，而一条
 * 「exclude 必须为空」的断言会在有人合理排除 `test/fixtures/` 时莫名其妙地红。
 * 真到了那天，该红的是别的判据，不是这一条。
 */
test('仓库真 tsconfig 的 include 同时盖住 src 与 test', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
    'utf8',
  );
  const config = JSON.parse(raw) as { include?: unknown; exclude?: unknown };
  const include = config.include;
  assert.ok(Array.isArray(include), 'tsconfig.json 里找不到 include 数组——它被删了或改了形状');
  for (const needed of ['src', 'test']) {
    assert.ok(
      (include as string[]).includes(needed),
      `tsconfig.json 的 include 里没有 "${needed}"——npm run check 从此不再查那一层，`
        + '而输出只会变短、不会变红。加回去，别把这条改绿。',
    );
  }
});
