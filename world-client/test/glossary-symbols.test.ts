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
 * 这与 `pack-owns-world-data.test.ts` 里 `KNOWN_PREFABS 的 why 点名的符号都还在
 * 自己那个文件里` 那条测试是同一条纪律：那张表的 `why` 里反引号点名的符号也得还在。
 * 区别只在于对象换了——那张表管 19 行债务登记，这一份管整本词典。
 * （第一版写「第七条」，而那个文件**没有编号规则**：它自己的 docstring 第 12 行说
 * 「本文件分**四种判据**、三种处置」，收尾那条叫「四个判据的出处都还在，且没有缩水」。
 * 「第七条」从 `ca9e5af` 起就是假的，`3f5e66f` 把隔壁段重写了三遍也没碰它——
 * 一笔以删假话为业的提交，放着自己文件里的一句假话不管。）
 *
 * ## 今天量出来（2026-10-28，两个数都数过）
 *
 * 词典里反引号内容 **69 处**，其中形如「点分段标识符链」的：
 *
 * - **出现 58 次**（`checked.length` 数的就是这个——按「token × 段」累计）
 * - **去重后 44 个**（重复过一次以上的段有 8 个：`ts` ×7、`simulation` ×3，
 *   `SandboxScene` / `Date` / `now` / `worldChangeVersion` / `save` / `altar` 各 ×2）
 *
 * 第一版这儿写「词典里写着 58 个代码标识符」——那句话是假的。去重只有 44 个，
 * 58 是**出现次数**。一个 58 一个 44，读的人按哪个理解都会错一半，所以两个都写。
 *
 * 重复最多的那个 `ts` **不是标识符**，它是文件后缀：词典写着 `` `simulation.ts` ``
 * 这类文件名，`segmentsOf` 把它们当标识符链切开，就切出一个 `ts` 来。它对
 * `\bts\b` 永远命中（`save.ts`、`oracle.ts` 满地都是），所以**它永远不可能 missing**——
 * 一个永远绿的段混在「受查 58 次」里，把那 58 次说成 58 次真正的检查。2026-10-28
 * 把它挪进 `LITERALS` 那样的排除集，于是受查变成 **51 次 / 去重 43 个**，
 * 而 `missing` 一个都没变（它本来就不可能 missing）。**别把 58 当覆盖数报出去。**
 *
 * 受查的 51 次里，**0 次搜不到**。语料是量出来的，不是猜的：
 *
 * | 语料 | 文件数 | 搜不到 |
 * |---|---|---|
 * | 只 `src` | 115 | **1**（`direct_observation`——它住在 `server/memory/`） |
 * | `src` + `server` | 154 | 0 |
 * | 再加 `scripts/` | 183 | 0 |
 * | 再加 `test/`（本文件取的） | 344 | 0 |
 *
 * 取最宽那个，理由不是「今天更严」——**除只 `src` 那一种有 1 处假阳性外，另外三种
 * 今天都是 0**，严不了。第一版在这儿写「四种语料今天都是 0 假阳性」，而它自己
 * 上面第三行就写着只 `src` 是 1——一句话否掉自己三行前的表。
 * 理由是**最宽的那种未来不会误报**：词典今天没有只住在 `test/` 里的符号，
 * 可它随时会添一条（`codeOf`、`codeLines`、`KNOWN_PREFABS` 都住在那儿）。
 * 到那天，窄语料会红，而红的原因是语料选窄了，不是词典错了——那种红没人会信。
 *
 * 所以**加宽是保险，不是今天的需要**：今天窄语料也一片绿，没有哪一段
 * 非得靠 `test/` 才找得到。也因此没有为「语料有多宽」立断言——立了就是
 * 一个会漂的假数字（文件数今天 344，明天就不一定是）。宽度只靠这段说明撑着。
 *
 * **可上面那张表里的四个文件数本身就是会漂的数**：2026-10-28 复量，第一版写的
 * 153 与 341 当天就已经不对了（实测 154 与 344，`src` 的 115 与 `+scripts` 的 183
 * 那天还对）。一边说「不立断言因为它会漂」，一边把四个会漂的数钉在表里——
 * 这不是自相矛盾，这是**同一件事做了一半**：不立断言防的是「有人跑测试发现它红」，
 * 可散文里的假数不会让任何测试红，它只会安静地假下去。所以这几个数带着日期，
 * 并且**复核时重新数**，别信这张表。
 *
 * ## 为什么 `docs/adr/` 没有一道同样的闸
 *
 * 试过，量完拆了。**这一段的数与名单 2026-10-28 被复审整个推翻了**，下面写的是
 * 复量后的两份结果，**并且每一份都写明它的口径**——因为第一版的问题正是
 * 「用最宽语料扫」这句话与实际量的口径不是同一个。
 *
 * 今天 `docs/adr/` 有 **8 份**（第一版写 7 份，漏了 `ADR_DEFAULT_PACK_BYPASS.md`）：
 * `ADR_BUILDING_AT_OPTIONAL`、`ADR_DEFAULT_PACK_BYPASS`、`ADR_MEMORY`、
 * `ADR_PACK_SKIPS_WORLD_BUDGET`、`ADR_PALETTE_24`、`ADR_SAVE`、
 * `ADR_WORLD_ALIVE`、`ADR_WORLD_FACTS_SOURCE`。
 *
 * ### 口径一：最宽语料（`src`+`server`+`scripts`+`test`，含本文件自己）
 *
 * **3 处 miss、2 个不同的 token**，全在 `ADR_PALETTE_24.md`：
 * `ADR_WORLD_FACTS_SOURCE` ×2（第 5 行）、`dbaa9f8` ×1（第 197 行）。
 * 前者是另一份 ADR 的文件名，后者是提交号。
 *
 * **被否决的选项在这个口径下一个都不是 miss**：`building.addAnywhere` 找得到——
 * 可它只在 `test/glossary-symbols.test.ts`（本文件）里命中。也就是说这个口径下
 * 「搜不到」的样本少到只剩两个 token，而它俩连「ADR 记的是历史」都说明不了。
 *
 * ### 口径二：把本文件自己从语料里剔掉
 *
 * **11 处 miss、6 个不同的 token**：
 *
 * - **被否决的选项**——`building.addAnywhere` ×2（`ADR_BUILDING_AT_OPTIONAL.md`
 *   第 101、109 行）。那个符号**不在代码里正是对的**，因为 ADR 的职责就是记下
 *   没选的那条路。这是唯一一类「红得有理」的。
 * - 提交号——`c11897d` ×5、`ff1a742`、`dbaa9f8`。
 * - 文件名——`ADR_WORLD_FACTS_SOURCE` ×2（第一版把它写成 `R_WORLD_FACTS_SOURCE`，
 *   「AD」两个字吞了）、`test_projection`（第一版写 `test_projection.py` 还说它
 *   「不带后缀」——它带 `.py`，那句话对自己列的第二个成员就是假的）。
 * - **`agentName` / `step_idx` 两个口径下都不是 miss**：它们在
 *   `test/purity.test.ts` 里，那正是禁词表本身。第一版把它们算进「十处误报」，
 *   是算错了。
 *
 * ### 结论不变，但依据换过了
 *
 * 第一版写「扫出来另外 9 处也都是假阳性……十处误报一道闸」。实测：**10 这个数
 * 在任何口径下都不成立**（口径一 2 个 token，口径二 6 个），而它点名的例子里
 * `agentName`/`step_idx` 两个不在任何口径的 miss 集合中，真正是 miss 的
 * `dbaa9f8` 它没列。**结论（不给 ADR 立这道闸）我仍然认同**，但认同的理由不再是
 * 「十处误报」——是：唯一「红得有理」的那一类（被否决的选项）需要人判，
 * 而剩下五类一道闸分不开，于是它会一直在响。响到没有人再读它。
 * **依据是假的时候，读的人没法知道结论是不是碰巧对的**——所以把两份实测都留在这儿。
 *
 * ADR 是历史记录，只有人能核；本文件只管那本「读一份就够」的词典。
 *
 * ### 顺带一个真代价：加宽语料让闸门开始引用自己
 *
 * `test/` 进语料之后，**本文件自己的散文也成了语料**。上面口径一与口径二的差
 * （3 处 vs 11 处）就是这个代价的度量：8 处「miss」是被本文件自己写下的字
 * 静默消掉的。今天词典那一侧不受影响——44 个段里没有一个只靠 `test/` 命中
 * （2026-10-28 实测），所以不是循环。可机制已经通了：哪天词典添一个只在本文件
 * 里出现过的词，它会绿，而绿的理由是「闸门自己提到过它」。
 *
 * **所以本文件把自己排除出语料**（见下面 `corpus` 那儿）。只排自己这一份，
 * 不排整个 `test/`：`codeOf` / `codeLines` / `KNOWN_PREFABS` 住在别的测试文件里，
 * 排掉它们就又变成窄语料了。实测剔掉自己，受查 51 次、去重 43 个、miss 0——
 * 一个都没变，所以这个排除今天不花任何代价。
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
 * （那个 58 是**剔掉 `ts` 之前**的数。剔掉之后是 51/51——`ts` 是文件后缀，
 * 永远不可能 missing，把它算进分母是虚报覆盖。）
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
 * （那道断言 2026-10-28 之前是**死代码**：语料含 `test/`，而本文件就是 `test/`
 * 下的一个 `.ts`，所以只要它在跑语料就永远非空。实测过：把 `src/`、`scripts/`、
 * `server/` 全清空只留本文件，它不响，测试改去报符号搜不到。把自己排除出语料
 * 之后它活了——同一个变异现在报「一个源文件都没有——语料空了，判据失去对象」。）
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
  // `ts` 是文件后缀，不是标识符。词典写着 `` `simulation.ts` `` 这类文件名，
  // `segmentsOf` 把它们当标识符链切开就切出一个 `ts`——它对 `\bts\b` 永远命中
  // （`save.ts`、`oracle.ts` 满地都是），所以**它永远不可能 missing**。
  // 2026-10-28 之前它混在「受查 58 次」里，把那 58 次说成 58 次真正的检查。
  // 剔掉它：受查 58 → 51 次，去重 44 → 43 个，`missing` 一个都没变。
  'ts',
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
  //
  // **但本文件自己排除在外**，两个理由，都是 2026-10-28 复审挑出来的：
  //
  // 1. 不然「语料空了」那道断言是死代码——`test/` 在语料里，而本文件就是
  //    `test/` 下的一个 `.ts`，所以只要它在跑，语料永远非空。实测过：把
  //    `src/`、`scripts/`、`server/` 全清空、只留本文件，那道断言不响，
  //    测试改去报词典里的符号搜不到——「扫描范围整个空了」这一种失败抓不到。
  // 2. 不然闸门开始引用自己。本文件的散文里写着 `building.addAnywhere`、
  //    `c11897d`、`agentName` 这些词，语料一含自己，它们就「找得到」。
  //    这对词典那一侧今天没有影响（实测剔掉自己，受查 51 次、去重 43 个、
  //    miss 0，一个都没变），可机制通了：哪天词典添一个只在本文件里出现过
  //    的词，它会绿，而绿的理由是「闸门自己提到过它」。
  //
  // 只排**自己这一份**，不排整个 `test/`：`codeOf` / `codeLines` /
  // `KNOWN_PREFABS` 住在别的测试文件里，排掉它们就又变成窄语料了。
  const SELF = fileURLToPath(import.meta.url);
  const corpus = [
    ...sources(path.join(ROOT, 'src'), ['.ts']),
    ...sources(path.join(ROOT, '..', 'server'), ['.py']),
    ...sources(path.join(ROOT, 'scripts'), ['.ts', '.mjs']),
    ...sources(path.join(ROOT, 'test'), ['.ts']),
  ].filter((file) => file !== SELF);
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
