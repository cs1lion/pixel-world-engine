/**
 * `GLOSSARY.md` 反引号点名的代码符号，必须还在代码里。
 *
 * ## 为什么要有这个文件
 *
 * `CLAUDE.md` 定了域内文档是**单上下文**：一份 `GLOSSARY.md` 加 `docs/adr/`。
 * 单上下文的意思是「读那一份就够」——而「够」有个前提：它指的东西还在。
 *
 * 词典里反引号点着 44 个互不相同的代码标识符（`worldChangeVersion` /
 * `doorReaches` / `ZoneId` / `lampOil` / `LEGACY_PACK`……），一共出现 58 次。
 * 改名是**会响的**那种破坏——可响在编译器里，
 * 不响在词典里。`worldChangeVersion` 改成 `changeCount`，`tsc` 一路绿，
 * 词典那条从此指向空气，而它会安静地躺在那儿直到下一个人核它。
 *
 * 这与 `pack-owns-world-data.test.ts` 第七条是同一条纪律：那张表的 `why` 里反引号
 * 点名的符号也得还在自己那个文件里。区别只在于对象换了——那张表管 19 行债务登记，
 * 这一份管整本词典。
 *
 * ## 今天量出来（2026-10-28，两个数都数过）
 *
 * 词典里反引号内容 **69 处**，其中形如「点分段标识符链」的：
 *
 * - **出现 58 次**（`checked.length` 数的就是这个——按「token × 段」累计）
 * - **去重后 44 个**（`SandboxScene`、`Date`、`now`、`worldChangeVersion`、
 *   `simulation`、`altar`、`save` 各重复了一次以上）
 *
 * 第一版这儿写「词典里写着 58 个代码标识符」——那句话是假的。去重只有 44 个，
 * 58 是**出现次数**。一个 58 一个 44，读的人按哪个理解都会错一半，所以两个都写。
 *
 * 受查的 58 次里，**0 次搜不到**。语料是量出来的，不是猜的：
 *
 * | 语料 | 文件数 | 搜不到 |
 * |---|---|---|
 * | 只 `src` | 115 | **1**（`direct_observation`——它住在 `server/memory/`） |
 * | `src` + `server` | 153 | 0 |
 * | 再加 `scripts/` | 183 | 0 |
 * | 再加 `test/`（本文件取的） | 341 | 0 |
 *
 * 取最宽那个，理由不是「今天更严」——四种语料今天都是 0 假阳性，严不了。
 * 理由是**最宽的那种未来不会误报**：词典今天没有只住在 `test/` 里的符号，
 * 可它随时会添一条（`codeOf`、`codeLines`、`KNOWN_PREFABS` 都住在那儿）。
 * 到那天，窄语料会红，而红的原因是语料选窄了，不是词典错了——那种红没人会信。
 *
 * 所以**加宽是保险，不是今天的需要**：今天窄语料也一片绿，没有哪一段
 * 非得靠 `test/` 才找得到。也因此没有为「语料有多宽」立断言——立了就是
 * 一个会漂的假数字（文件数今天 341，明天就不一定是）。宽度只靠这段说明撑着。
 *
 * ## 为什么 `docs/adr/` 没有一道同样的闸
 *
 * 试过，量完拆了。7 份 ADR 里反引号点名的标识符，用最宽语料扫，
 * **真正搜不到的只有一类：被否决的选项**——`ADR_BUILDING_AT_OPTIONAL.md:101`
 * 写「加一条 `building.addAnywhere` 命令……不是一件不同的事」，`:109` 又写
 * 「结论（不选 `building.addAnywhere`）不受影响」。那个符号**不在代码里正是对的**，
 * 因为 ADR 的职责就是记下没选的那条路。
 *
 * 扫出来另外 9 处也都是假阳性：提交号（`c11897d`、`ff1a742`）、
 * 不带后缀的文件名（`R_WORLD_FACTS_SOURCE`、`test_projection.py`）、
 * 以及**被明令禁止的词汇**——`ADR_WORLD_ALIVE.md:226` 点名禁 `agentName` /
 * `step_idx`，它们在 `src/world/` 里不存在恰好是 `test/purity.test.ts` 的功劳。
 *
 * 十处误报一道闸，正是「判据错了比没有判据更糟」那句话说的东西：
 * 它会一直在响，响到没有人再读它。所以 ADR 不设这道闸——
 * **ADR 是历史记录，只有人能核**；本文件只管那本「读一份就够」的词典。
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

  // 语料取最宽：src + server + scripts + test。为什么不是只 src + server，
  // 见文件头那张表——窄语料今天也是 0，可词典明天添一条住在 test/ 里的符号
  // （`codeOf`、`KNOWN_PREFABS` 都住那儿）就会误报，而误报的原因在语料不在词典。
  const corpus = [
    ...sources(path.join(ROOT, 'src'), ['.ts']),
    ...sources(path.join(ROOT, '..', 'server'), ['.py']),
    ...sources(path.join(ROOT, 'scripts'), ['.ts', '.mjs']),
    ...sources(path.join(ROOT, 'test'), ['.ts']),
  ];
  assert.ok(corpus.length > 0, '一个源文件都没有——语料空了，判据失去对象');
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
