/**
 * `GLOSSARY.md` 反引号点名的代码符号，必须还在代码里。
 *
 * ## 为什么要有这个文件
 *
 * `CLAUDE.md` 定了域内文档是**单上下文**：一份 `GLOSSARY.md` 加 `docs/adr/`。
 * 单上下文的意思是「读那一份就够」——而「够」有个前提：它指的东西还在。
 *
 * 词典里写着 58 个代码标识符（`worldChangeVersion` / `doorReaches` / `ZoneId` /
 * `lampOil` / `LEGACY_PACK`……）。改名是**会响的**那种破坏——可响在编译器里，
 * 不响在词典里。`worldChangeVersion` 改成 `changeCount`，`tsc` 一路绿，
 * 词典那条从此指向空气，而它会安静地躺在那儿直到下一个人核它。
 *
 * 这与 `pack-owns-world-data.test.ts` 第七条是同一条纪律：那张表的 `why` 里反引号
 * 点名的符号也得还在自己那个文件里。区别只在于对象换了——那张表管 19 行债务登记，
 * 这一份管整本词典。
 *
 * ## 今天量出来（2026-10-28）
 *
/**
 * 词典里反引号内容 69 处，其中形如「点分段标识符链」的贡献 **58 个**标识符段，
 * 在 `src/` 与 `server/` 里逐个搜，**0 个搜不到**。
 *
 * 语料选 `src` + `server` 是量出来的，不是猜的：
 *
 * | 语料 | 受查段数 | 搜不到 |
 * |---|---|---|
 * | 只 `src` | 58 | **1**（`direct_observation`——它住在 `server/memory/`） |
 * | `src` + `server` | 58 | **0** |
 * | 再加 `scripts/` 与 `test/` | 58 | 0 |
 *
 * 所以取中间那个：再放宽只是让判据变钝，而今天并没有假阳性需要它去容。
 *
 * ## 判据是**词边界**，不是子串
 *
 * 第一版写的是 `code.includes(symbol)`。那有个洞，而且是当天变异时撞上的：
 * `routeTo` 改名成 `routeTowards`，**整树跑下来一片绿**——因为 `routeTowards`
 * 里含着 `routeTo` 这个子串。改名加上一个前缀或后缀是最自然的一种改法，
 * 子串判据对它永远失明。
 *
 * 改成 `\b符号\b` 之后量过：今天两种判据都是 58/58，**一个假阳性都没多**。
 * 所以严一点不花钱，就严一点。
 *
 * 顺带一层也说清：这条只问「这个**名字**还在」，不问「它还在不在原来的文件里」。
 * `CARRY_ITEMS` 住在 `gate.ts`，可 `save.ts`、`simulation.ts` 也 import 它——
 * 只在 `gate.ts` 里改掉名字，编译会响，这条不会。要按文件钉得住，得先让词典写下
 * 「这个符号住哪个文件」，而它今天不写那个。这是已知的缺口，不是漏改。
 *
 * ## 这一条**不**查什么
 *
 * - **文件路径与文档引用不在范围内**：`settings/load.ts`、`docs/SPEC.md`、
 *   `test/day-phase.test.ts` 这些由 `audit-citations` 管，不在这儿重复。
 * - **中文引号「」里的话不在范围内**：那里面装的是人话，不是标识符。
 * - **只查「符号还在」，不查「那句话说得对不对」。** 词典一条说 `doorReaches`
 *   管的是「门到不到得了世界中心」——哪怕哪天它改了语义，这条照旧绿。语义只有
 *   人能核，别把这条读成「词典从此自动为真」。
 *
 * 反过来说：**这条报 0 处是正常的**（今天就是 0）。它的价值在改名那一天，
 * 不在今天。所以下面有一条「判据失去对象」的断言，免得扫描范围空了也一片绿。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GLOSSARY = fileURLToPath(new URL('../../GLOSSARY.md', import.meta.url));

function sources(dir: string, ext: readonly string[]): readonly string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(at, ext));
    else if (ext.some((e) => entry.name.endsWith(e))) out.push(at);
  }
  return out;
}

/** 语言字面量与通用词——不是本仓的符号，别拿去源码里找。 */
const LITERALS: ReadonlySet<string> = new Set([
  'NaN', 'Infinity', 'null', 'undefined', 'true', 'false',
]);

/**
 * 一个反引号内容是不是「点分段的标识符链」。
 *
 * 判据严到把带 `/`、`[]`、空格、中文的一律排除：那些是路径、下标、命令行与人话，
 * 不是符号。所以 `settings/load.ts`、`world.tasks[].summary`、「听懂了」
 * 都不进受查集合——它们在别的工具那儿有人管，或者根本不该由一条测试管。
 */
function segmentsOf(token: string): readonly string[] {
  const body = token.replace(/\(\)$/, '');
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(body)) return [];
  return body.split('.').filter((s) => !LITERALS.has(s));
}

test('GLOSSARY.md 点名的代码符号都还在', () => {
  assert.ok(existsSync(GLOSSARY), `找不到 ${GLOSSARY}——单上下文的词典不在了，这一条失去对象`);

  const corpus = [
    ...sources(path.join(ROOT, 'src'), ['.ts']),
    ...sources(path.join(ROOT, '..', 'server'), ['.py']),
  ];
  assert.ok(corpus.length > 0, 'src/ 与 server/ 里一个源文件都没有——语料空了，判据失去对象');
  const code = corpus.map((file) => readFileSync(file, 'utf8'));
  const named = (symbol: string): RegExp =>
    new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

  const glossary = readFileSync(GLOSSARY, 'utf8');
  const tokens = [...glossary.matchAll(/`([^`\n]+)`/g)].map((found) => found[1] ?? '');

  const checked: string[] = [];
  const missing: string[] = [];
  for (const token of tokens) {
    for (const segment of segmentsOf(token)) {
      checked.push(segment);
      // 逐文件查，不把语料接成一长串：接起来会让「一个符号在一份文件的末尾、
      // 另一个在下一份的开头」假通过，也会让跨文件的同名局部变量互相掩护。
      if (!code.some((text) => named(segment).test(text))) {
        // 整条就是一个裸标识符时，别说「X 里的 X」——那读着像bug。
        missing.push(segment === token ? segment : `${token} 里的 ${segment}`);
      }
    }
  }

  assert.ok(
    checked.length > 0,
    '一个标识符都没受查——要么 GLOSSARY.md 被改写得不带反引号了，要么 segmentsOf 的正则'
      + '失效了。两种都该回来看，不是把这条改绿。',
  );
  assert.deepEqual(
    missing,
    [],
    `GLOSSARY.md 点了这些代码里已经没有的符号：${missing.join('、')}。`
      + '改名会把编译器弄响，不会把词典弄响——于是词典那条从此指向空气，而它会'
      + '安静地躺到下一个核它的人。两种处置：把词典改对，或者（如果这个词是本项目的'
      + '域词而代码里那个名字起错了）把代码改对。别把这条删掉。',
  );
});
