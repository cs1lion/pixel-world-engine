#!/usr/bin/env node
/**
 * 行号引用审计：文档与注释里写的「代码在那儿」，得真的是在那儿。
 *
 * 为什么单独立一项：这个仓库的信条是「说谎比不去更糟」。它在代码里说得最重的
 * 一处是 `src/world/routines.ts:104`（涨潮回落那段，不在文件开头——开头讲的是
 * 日常作息）。那句只管世界对用户说的话，可同一个毛病在仓库自己身上一样成立——
 * `docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md` 的待办 A 曾写「留白环
 * （`grid.ts:230-237`）」，而 `canPlace` 的留白环在 `grid.ts:333-340`；照着
 * `230-237` 翻过去的人落在 `breathingAt` 的注释和函数体上，跟留白环不相干，
 * 潮位那两个取值器还在更下面（`grid.ts:260`、`grid.ts:265`）。那条引用后来
 * 修好了（ADR 今天写的就是 `grid.ts:333-340`），所以它现在是个**已经结案的
 * 例子**，不是正在流脓的伤口——把它当成活缺陷来讲，这个脚本自己的开头就成了
 * 它所警告的那种烂法。行号不会自己跟上：它每被一次提交推移一点，而写它那天
 * 之后没有人再核对过。
 *
 * 所以这里把它变成一条 CI 跑得到的断言，而不是一份「写完就对一次」的清单。
 *
 * 查五样：
 *   1. **指的文件存在**。引用写作 `grid.ts:230-237` 时只有一个裸文件名，
 *      所以按「引用者目录 → 仓库根 → 全仓唯一后缀」的顺序找。后缀撞上多个
 *      文件时报出来并列出候选——那不是脚本猜得了的，是人得挑一个写清楚。
 *   2. **行号在文件里**。越界比指错更糟：它连一个错位置都不指向。
 *   3. **那段里有可以落脚的东西**。空行与纯括号都算「什么都没指」——
 *      指着 `});` 不如不指。指着注释是正当的：ADR 经常引的就是注释的原文。
 *   4. **省略文件名的续引也在查**。「调用在 `setup.ts:NNN`、`:NNN`，定义在
 *      `:NNN`」这种写法只有第一处带文件名。不带文件名的那些曾完全没人管，
 *      于是 `test/terrain-edge-visibility.test.ts` 里那个指向不存在文档的
 *      第 218 行一直绿着。现在同一段里最近的那个文件会被带下去，空行一断就忘。
 *      （这里写 `NNN` 不写真行号：真行号会被本脚本自己审到，而 `setup.ts`
 *      每长一行它就烂一行——那是一条永远在红、又没人在看它为什么红的注释。
 *      形状才是要说明的东西，行号不是。同一条纪律见 `audit-references.test.ts`
 *      里那句「本文件的注释里不写『:数字』」。）
 *   5. **「那东西就在这儿」这种引用，那儿得有那样东西**。把一个函数名写在
 *      坐标旁边，本身就是一句可验的断言：它说那一行是它。而这一样恰恰最容易
 *      悄悄烂掉——行号在文件里、那段也有代码，只是代码是**别的**，于是前三样
 *      全绿。见 `CALL_REF` 上那段记着的真事。
 *
 * 两处**不查**，都是有意的：
 *   - 网址里的 `:8080` 是端口。整段挖掉，不是「这行有网址就整行跳过」——
 *     一行里可以同时有网址和真引用，按行跳过会把真的那一处一起放过。
 *   - 「见 a.ts 第 3 行」这种行文没有冒号，本来就不是指针。
 *
 * 不查「那段说的是不是那件事」：那是语义，机器判不了，也不该由脚本假装能判。
 * 所以「指着一段散文，可作者意思是那边的调用」这一类，脚本放它过去，
 * 靠 `--strict` 之外的那双眼睛。它能挡住的是**行号自己烂掉**那一种——
 * 那一种每天都在发生，而且没有任何别的机关在管。
 *
 * 用法：
 *   node scripts/audit-references.ts           # 人读报告（stdout）
 *   node scripts/audit-references.ts --strict  # 有任何一处存疑就退出码 1
 *
 * 与 `audit-palette.mjs` 分开：那个管颜色预算，这个管自述为真，两件不相干。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** 仓库根。这个脚本从 `world-client/` 里被 CI 调用，但它管的是整座仓库的自述。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 哪些地方的话要算数：文档、词汇表、自述、源码、测试、脚本。 */
const SCAN_ROOTS: readonly string[] = [
  'docs',
  'GLOSSARY.md',
  'README.md',
  'world-client/src',
  'world-client/test',
  'world-client/scripts',
  'server',
];

/** 不算「引用」的后缀：json 里没有行号可指，png 更不是文本。 */
const TEXT_EXT = /\.(ts|mjs|py|md)$/;

/** `file.ext:123` 或 `file.ext:123-145`。 */
const REF = /([\w./-]+\.(?:ts|mjs|py|md)):(\d+)(?:-(\d+))?/g;

/**
 * 省略了文件名的续引：`` `:123` ``、`` `:123-145` ``。
 *
 * 紧跟一个前引号是**硬条件**。`width: 64` 这种代码里的键值对也长得像，
 * 少了这个条件就会把一段里随便一句 `x: 12` 当成续引去查——那是误报，
 * 而误报一样毁掉一个守卫，只是毁得慢一点。
 */
const BARE_REF = /`:(\d+)(?:-(\d+))?`/g;

/** 一处引用。`ref` 为 null 表示文件名省略了，要接同一段里上一处的那个。 */
interface Hit {
  readonly index: number;
  readonly ref: string | null;
  readonly first: string;
  readonly last: string | undefined;
}

/** 一行里的全部引用，按出现顺序。
 *
 * 两个正则分开扫再合起来排序：省略文件名的那种要接着前一处带文件名的，
 * 而「前一处」是按位置算的，不是按哪个先扫完算的。 */
function hits(line: string): readonly Hit[] {
  const out: Hit[] = [];
  for (const m of line.matchAll(REF)) {
    if (m[1] === undefined || m[2] === undefined) continue;
    out.push({ index: m.index ?? 0, ref: m[1], first: m[2], last: m[3] });
  }
  for (const m of line.matchAll(BARE_REF)) {
    if (m[1] === undefined) continue;
    out.push({ index: m.index ?? 0, ref: null, first: m[1], last: m[2] });
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * 一行里的网址整段。`https?://` 后面跟到空白为止。
 *
 * 为什么要整段挖掉、而不是「这行有网址就整行不算」：一行里可以同时有网址和
 * 真引用——「留白环见 `grid.ts:NNN`（背景见 https://…）」这种句子很自然。
 * 按行跳过会把那句里**真的**那一处一起放过：代码挪走、行号烂掉，而 CI 全绿。
 * 那正是这个脚本存在的理由所不容的一种沉默，比误报糟得多。
 *
 * 实测（2026-10-27）全仓当时只有一处落在那种沉默里，就是它自己测试数据里的
 * 那一行。那是运气，不是设计——所以改成逐处判。
 */
const URL_SPAN = /https?:\/\/\S*/g;

/** 把网址换成等长空白，剩下的才拿去找引用。
 *
 * 换空白而不是删掉：行里剩下的相对位置不变，将来若要在报错里带上列号也用得上。
 */
function stripUrls(line: string): string {
  return line.replace(URL_SPAN, (span) => ' '.repeat(span.length));
}

/** 一行里有没有可读的字符。中文也算：行号常常就指着一段中文注释。 */
const HAS_GLYPH = /[A-Za-z_$\p{Script=Han}]/u;

/** 一行里除了空白与括号，什么都没有。 */
const ONLY_BRACES = /^[\s{}()[\];,]*$/;

/**
 * 「那东西就在这儿」这种引用：一个带括号的函数名，后面紧跟一个坐标。
 *
 * 前四样都只查「行号自己烂没烂」——越界、空行、文件不存在。可还有一种烂法
 * 它们一句都说不出来：行号还在文件里、那段也有代码，只是那段是**别的**。
 * `scatterToShelter` 的定义挪走之后，它引的那个 1440 是一段讲潮位的注释，
 * 而 CI 全绿。这个脚本自己的文件头原来就写着「不查那段说的是不是那件事」——
 * 那是语义，机器判不了，也不该由脚本假装能判。
 *
 * 可这一种**不需要**懂语义：引用者自己把名字写在了坐标旁边。名字加一对括号、
 * 后面隔几个字一个坐标，这就是一句「这东西在那儿」的断言，而它可验。
 *
 * 两处收得很紧，都是有意的：
 *   - **名字后面必须立刻跟着坐标**，中间只允许一个括号（和一个反引号）。
 *     ADR 里有「每个模板都过同一个 `prefab()` 助手、`boundTask` 硬编码 null
 *     （`pack.ts:14`）」这种句子：`prefab()` 是顺带提的，坐标说的是
 *     `boundTask`。隔开半句再去认领一个坐标，就是把一句真话说成疑点——
 *     而误报一样毁掉一个守卫，只是毁得慢一点。
 *   - **必须带 `()`**。`placeBlueprint`（内部走…）这种只是提一句名字，
 *     不是在报位置，拿它去查坐标就是误报。
 *
 * 名字与坐标两头都**不要求**反引号：实测的那个样本里两者都是裸的。第一版两头
 * 都要求，于是一处都没匹配上——而它恰恰是这条判据唯一的活样本。守卫闭上嘴比
 * 没有守卫更糟，所以拿真仓库里那个形状当验收，不是拿想象当中的形状。
 *
 * 可「不要求」不等于「两种都认」。第二版把可选反引号只放在坐标前面，于是它认
 * 「名字带一对括号、坐标两头都裸」那一种，却漏掉代码Span的收反引号排在名字
 * 后面、坐标自己又带一对反引号那一种。漏掉的表现是这条判据对那一类引用静默
 * 失效——行号烂了、名字对不上，CI 照绿，正是它存在的理由所不容的那种沉默。
 * 所以坐标两侧各一个可选反引号，名字与全角括号之间也放一个。
 *
 * （那句改法写在 `802ef16` 的提交信息里，而真正的正则改动就在那一笔的 diff 里。
 *  后来 `3f08e94` 又原样说了一遍「改法：坐标两侧各一个可选反引号」——可那一笔的
 *  diff 只有注释，正则逐字节未动（`git show 3f08e94 -- scripts/audit-references.ts`
 *  只有一个 hunk，全是散文）。于是「什么时候改的、改了什么」在 `git log` 里被答错
 *  了九小时：17:01 那一笔读起来像修复，实际是 08:13 那一笔修的。这正是本文件要防
 *  的那种事，只是发生在提交信息上——提交信息也是自述为真。）
 *
 * **它仍然只看得见一小部分，别把这话读成全覆盖。** 有一种写法它一律看不见：
 * 名字挨着坐标，可名字后面跟的是**一对全角括号**而不是 `()`。
 * （2026-10-28 复核：七处，全在 `docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md`
 * 一个文件里。**这个分布会漂，数儿与分布都以测试为准**——我原来在这儿写的是
 * 「集中在两个 ADR 里」，那句是假的：另一个 ADR 里那一处（`authored: true`
 * 挨着 `load.ts:NNN`）前面的词是 `true`，正被下面那个 `/[A-Z]/` 筛子筛掉。
 * 一句话三行之后就有东西能证明它，那它就不该由我在这儿手写。）
 * **那个数由 `audit-references.test.ts` 的「盲区是数得出来
 * 的」那条冻着**，不在这儿手写——手写的数会漂，而漂掉的表现就是这段自述变成
 * 它所警告的那种烂法。它已经漂过一次：原写 8 处，2026-10-27 复核，把 `()`
 * 放宽成「括号即可」重数是 9 处，而多出来的正是本段自己举的两个例子。
 *
 * 为什么不把全角括号也收进来：收了会误报。全角括号在中文里就是普通括注，
 * 「……问题（`setup.ts:NNN`）」这种句子，括号前那个词是 `problem`，
 * 不是标识符；拿去查「附近有没有 problem」必然开口。而误报一样毁掉一个守卫，
 * 只是毁得慢一点。要收得先能分辨「这个词是不是代码里的名字」——那是另一道闸
 * 的事，不该由这条正则假装能判。
 *
 * （这里写 `NNN` 不写真行号：这本来是个例句，可写真行号它就被本脚本审到，
 * 而 `setup.ts` 每长一行它烂一次——原来写的 `634-639` 就已经烂了，那一段今天
 * 是承接计数的循环，不是记 `problem` 的地方。同一条纪律见文件头那几处。）
 *
 * 本文件的注释里因此不写那种形状的示例：审计连自己的注释一起审。
 */
const CALL_REF =
  /([A-Za-z_$][\w$]*)\(\)\s*`?\s*[（(]?\s*`?([\w./-]+\.(?:ts|mjs|py|md)):(\d+)(?:-(\d+))?`?(?:[\s）)]|$)/g;

/** 引用允许偏几行：ADR 常引函数上面那段注释，而注释里不一定再写一遍函数名。 */
const CALL_REF_SLACK = 3;

/**
 * `CALL_REF` 看不见的那一批：名字挨着坐标，可名字后面跟的不是 `()`。
 *
 * 正则与 `CALL_REF` 只差一处——那个 `()` 改成可有可无。**边界必须自己补**：
 * `CALL_REF` 靠 `()` 隔开名字与文件名，放宽之后 `simulation.ts:NNN` 会被读成
 * 「名字 = simulation、文件 = n.ts」。所以名字与坐标之间至少要有一个分隔符
 * （反引号、空白、括号任一个）。
 *
 * 为什么要有这个函数：`CALL_REF` 的盲区原先只在注释里写着一个数，而那个数
 * 会漂（原写 8 处，实测 9 处）。数得出来才冻得住——`audit-references.test.ts`
 * 拿它把今天的集合冻死，多一处少一处都红。
 *
 * 网址照挖：`http://example.com/a.ts:8080` 里那一段长得跟引用一模一样，
 * 而 `:8080` 是端口。复用的是上面那个 `stripUrls`。
 */
const NAME_REF_RELAXED = new RegExp(
  "([A-Za-z_$][\\w$]*)(\\(\\))?[`\\s（(]+`?\\s*`?([\\w./-]+\\.(?:ts|mjs|py|md)):(\\d+)(?:-(\\d+))?`?(?:[\\s）)]|$)",
  'g',
);

/** 一处 `CALL_REF` 看不见的「名字挨着坐标」。 */
export interface InvisibleNameRef {
  /** 引用写在哪儿：仓库相对路径，冒号后是行号。 */
  readonly where: string;
  /** 挨着坐标的那个词。 */
  readonly name: string;
  /** 它指的坐标。 */
  readonly target: string;
  /** 落点那个文件里，`CALL_REF_SLACK` 行之内有没有这个名字。 */
  readonly nameNearby: boolean;
}

/**
 * 全仓扫一遍，把 `CALL_REF` 看不见的那批列出来。
 *
 * 只收**像是代码里的名字**的那些：含第一个字符之后的大写字母，或者全大写。
 * 这不是判据，是个筛子——全角括号在中文里就是普通括注，「问题（坐标）」前面
 * 那个词不是名字。筛子会漏（全小写的函数名它也看不见），所以漏掉的那部分
 * **不在这个数里**，别把它读成盲区的全集。
 */
export function invisibleNameRefs({ root = ROOT }: { root?: string } = {}): InvisibleNameRef[] {
  const index: string[] = [];
  for (const entry of SCAN_ROOTS) walk(path.resolve(root, entry), index);
  index.sort();

  const out: InvisibleNameRef[] = [];
  for (const file of index) {
    const text = readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, at) => {
      const scanned = stripUrls(line);
      for (const m of scanned.matchAll(NAME_REF_RELAXED)) {
        const name = m[1];
        if (name === undefined || m[3] === undefined || m[4] === undefined) continue;
        // 带 `()` 的归 `CALL_REF` 管，不是盲区。
        if (m[2] !== undefined) continue;
        if (!/[A-Z]/.test(name.slice(1))) continue;
        const landed = land(m[3], m[4], m[5], file, root, index);
        const where = `${path.relative(root, file).split(path.sep).join('/')}:${at + 1}`;
        const target = `${m[3]}:${m[4]}${m[5] === undefined ? '' : `-${m[5]}`}`;
        if (!landed.ok) {
          out.push({ where, name, target, nameNearby: false });
          continue;
        }
        const lo = Math.max(0, landed.from - 1 - CALL_REF_SLACK);
        const hi = Math.min(landed.lines.length, landed.to + CALL_REF_SLACK);
        out.push({
          where,
          name,
          target,
          nameNearby: landed.lines.slice(lo, hi).join('\n').includes(name),
        });
      }
    });
  }
  return out;
}

/**
 * 一样**量过、但故意没有做成闸**的检查：「那句话引了一个带引号的串，那个串在
 * 目标文件里，却不在它指的那几行里」。
 *
 * 为什么想它：`CALL_REF` 管「名字挨着坐标」，管不了一句里引的**字符串**。
 * `ADR_DEFAULT_PACK_BYPASS` 里有一句引「居民必须至少一位且不重名」，坐标指着
 * `load.ts` 里一行 `超出地图右边界`——而那句话串在同一份文件的别处。这类沉默
 * 一天也没人响。
 *
 * 为什么不做成闸：2026-10-27 拿一份探针量过三轮，每一轮都在修误报，轮到最后
 * 还剩的也分不出真假。三轮的量（都是那一天的一次性测量，不是不变量，别当数用）：
 *
 *   1. 不限「紧前面」、不限出现次数——47 处。绝大多数是 `placeBlueprint`、
 *      `assertWorldInvariants` 这类在多处出现的标识符：那句话常常是在说「它内部的
 *      那段」，坐标指着同一函数的另一行，完全合法。
 *   2. 加「那个串在目标文件里只出现一次」——5 处，其中 4 处是噪声。噪声的形状很
 *      固定：坐标真正的主语是**另一个**在附近多次出现的记号。`buildWorldFromSave`
 *      跑 `assertWorldInvariants`（坐标）这句，主语是后者；`boundTask` 写死成
 *      `null`（坐标一）后面隔了半句才轮到坐标二。
 *   3. 再加「只认坐标紧前面那个引号串」——量出来是 0 处，连那处真错的也漏了。
 *      因为容差 `CALL_REF_SLACK` 是 ±3 行，而那处真错的两处相隔 4 行。
 *
 * 第三条是死路：这道检查的分辨率被 `CALL_REF_SLACK` 卡着。容差放到 0 才抓得到，
 * 而容差 0 会让 `CALL_REF` 自己开始误报——ADR 常引函数上面那段注释，注释里不
 * 一定再写一遍函数名。两个检查共用一个容差，于是这里没有可调的中间值。
 *
 * 所以这一层今天靠人。真错的已经手工改掉（`load.ts` 的 docstring 行、`authored`
 * 那行、`不重名` 那条铁律行，三处都偏了 2–4 行）。**下次想再加闸，先读这三轮**：
 * 要绕开死路，得先能分辨「坐标前面那个词是不是这句话的主语」——那是另一道闸
 * （中文句法）的事，不该由这条正则假装能判。同一条纪律见 `CALL_REF` 上那段
 * 「为什么不把全角括号也收进来」。
 */

/** 一处存疑的引用。 */
export interface ReferenceFinding {
  /** 引用写在哪儿：那份文档的路径，冒号后是行号。 */
  readonly where: string;
  /** 写的那一串：`grid.ts`。 */
  readonly ref: string;
  /** 为什么存疑。 */
  readonly why: string;
}

export interface ReferenceAudit {
  /** 一共查了多少处。 */
  readonly checked: number;
  readonly findings: readonly ReferenceFinding[];
}

/**
 * 一段里有没有可以落脚的**东西**。
 *
 * 判「那段不全是空行、也不只是括号」——不是判「那段里有代码」。
 * 区别是要紧的：ADR 引用 `blueprints.ts:103-104` 时引的是那两行**注释**的原文
 * （「0 栋等于这类活无处可去」），指着注释是正当的，脚本不该拦。
 * 而指着 `});` 或一片空行是另一回事——那不是位置，是真空。
 *
 * 仍然查不了的是「指着散文，可作者意思是那边的调用」。那要懂语义，
 * 机器判不了，也不该由脚本假装能判（见文件头第三条）。
 */
function hasCode(body: string): boolean {
  return body.split(/\r?\n/).some((line) => HAS_GLYPH.test(line) && !ONLY_BRACES.test(line));
}

function walk(dir: string, out: string[]): string[] {
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    return out;
  }
  if (stat.isDirectory()) {
    const base = path.basename(dir);
    // node_modules 与缓存里没有人的话，只有生成物。
    if (base === 'node_modules' || base === '__pycache__' || base === '.git' || base === '.vite') {
      return out;
    }
    for (const name of readdirSync(dir)) walk(path.join(dir, name), out);
    return out;
  }
  if (TEXT_EXT.test(dir)) out.push(dir);
  return out;
}

/** 一个裸文件名解析出来的结果：唯一命中、多个候选、或者没有。 */
type Resolved = { readonly file: string } | { readonly candidates: readonly string[] } | null;

/** 按后缀找唯一的那一个。
 *
 * 一律换成 `/` 再比：引用里写的是 `/`，而 `path.join` 在 Windows 上给的是 `\`。
 * 直接 `endsWith(path.sep + ref)` 在 Windows 上一个都匹配不上——
 * 那会让一整类「写对了但没写全」的引用被误判成「找不到这个文件」。 */
function bySuffix(ref: string, index: readonly string[]): Resolved {
  const wanted = ref.split(path.sep).join('/');
  const hits = index
    .map((file) => file.split(path.sep).join('/'))
    .filter((posix) => posix === wanted || posix.endsWith(`/${wanted}`));
  if (hits.length === 0) return null;
  if (hits.length === 1) return { file: hits[0]! };
  return { candidates: hits };
}

function resolveRef(ref: string, fromDir: string, index: readonly string[]): Resolved {
  const direct = path.resolve(fromDir, ref);
  if (index.includes(direct)) return { file: direct };
  const fromRoot = path.resolve(ROOT, ref);
  if (index.includes(fromRoot)) return { file: fromRoot };
  return bySuffix(ref, index);
}

/**
 * 把一个引用落到文件行上。
 *
 * 落不下去就回一句为什么；落得下去就回那份文件的全部行，连引用指的区间，
 * 好让调用方自己再看那一段里该有什么。
 */
function land(
  named: string,
  first: string,
  last: string | undefined,
  file: string,
  root: string,
  index: readonly string[],
):
  | { readonly ok: true; readonly lines: readonly string[]; readonly from: number; readonly to: number; readonly span: string }
  | { readonly ok: false; readonly why: string } {
  const resolved = resolveRef(named, path.dirname(file), index);
  if (resolved === null) return { ok: false, why: '找不到这个文件' };
  if ('candidates' in resolved) {
    const names = resolved.candidates.map((c) => path.relative(root, c)).join('、');
    return { ok: false, why: `裸文件名撞上 ${resolved.candidates.length} 个文件（${names}）——写全路径` };
  }
  const target = readFileSync(resolved.file, 'utf8').split(/\r?\n/);
  const from = Number(first);
  const to = last === undefined ? from : Number(last);
  const span = `${path.relative(root, resolved.file)}:${first}${last === undefined ? '' : `-${last}`}`;
  if (from < 1 || to > target.length) {
    return { ok: false, why: `${span} 越界：那份一共 ${target.length} 行` };
  }
  return { ok: true, lines: target, from, to, span };
}

/**
 * 审一遍。`root` 可换，为的是测试能拿一份临时目录跑，不必动真仓库。
 */
export function auditReferences({ root = ROOT }: { root?: string } = {}): ReferenceAudit {
  const index: string[] = [];
  for (const entry of SCAN_ROOTS) walk(path.resolve(root, entry), index);
  index.sort();

  const findings: ReferenceFinding[] = [];
  let checked = 0;

  for (const file of index) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    // 一个段落里最近解析出来的那个文件。
    //
    // 「调用在 `setup.ts:NNN`、`:NNN`，定义在 `:NNN`」这种写法很常见——同一个
    // 文件连指几行，只有第一处带文件名。不带文件名的那些曾是完全没人查的：
    // `test/terrain-edge-visibility.test.ts` 里就留着这么一个指向不存在文档的
    // 「218 行」续引，而审计一直绿着。所以这里把最近的那个文件带下去。
    //
    // 只在**同一个段落**里带，且每个文件重新起算：空行一断就忘。跨段落或跨文件
    // 带会把 `:218` 安到一个毫不相干的文件头上——那是误报，而误报一样毁掉一个守卫。
    let carried: string | null = null;
    lines.forEach((line, at) => {
      // 网址先挖掉：`http://example.com/a.ts:8080` 里那一段长得跟引用一模一样，
      // 可 `:8080` 是端口，不是行号。见 `URL_SPAN` 上那段为什么不能按行跳过。
      const scanned = stripUrls(line);
      // 空行断段。注释壳（` *`、`//`、`---`）不算内容：它独自一行时什么都不说。
      if (!HAS_GLYPH.test(scanned.replace(/^[\s*/#-]+/, ''))) {
        carried = null;
        return;
      }
      for (const hit of hits(scanned)) {
        // 文件名省略时接着同一段里上一处那个；一段的开头没有可接的，那它就不是指针。
        const named = hit.ref ?? carried;
        if (named === null) continue;
        checked += 1;
        const where = `${path.relative(root, file)}:${at + 1}`;
        const landed = land(named, hit.first, hit.last, file, root, index);

        if (!landed.ok) {
          findings.push({ where, ref: named, why: landed.why });
          continue;
        }
        // 这一段指的文件记下来：后面省略文件名的那些处接它。
        carried = named;
        if (!hasCode(landed.lines.slice(landed.from - 1, landed.to).join('\n'))) {
          findings.push({
            where,
            ref: named,
            why: `${landed.span} 那段里没有代码，只有空行或括号`,
          });
        }
      }

      // 第五样：「这东西在那儿」这种断言，那儿得有那样东西。见 `CALL_REF`。
      // 单独立一段而不是并进上面那个循环：它多带一个名字，也多一条判据。
      for (const m of scanned.matchAll(CALL_REF)) {
        const name = m[1];
        if (name === undefined || m[2] === undefined || m[3] === undefined) continue;
        checked += 1;
        const where = `${path.relative(root, file)}:${at + 1}`;
        const landed = land(m[2], m[3], m[4], file, root, index);
        // 指不到就到此为止，**不在这里再报一次**。
        //
        // `REF` 不要求坐标前面有名字，所以它认得的坐标集合永远包含这一处——
        // 越界、文件不存在这两种早就由前四样报过了，`where` 与 `why` 一字不差。
        // 留着 push 的那一版实测出来是每条错在报告里出现两遍（同一行、同一句），
        // 读报告的人以为有两处。所以这里只 `continue`：拦住名字那一段别拿一份
        // 落不了地的坐标去查。
        if (!landed.ok) continue;
        // 允许偏几行：引用指的常是函数上面那段注释，而注释里不一定再写一遍名字。
        const lo = Math.max(0, landed.from - 1 - CALL_REF_SLACK);
        const hi = Math.min(landed.lines.length, landed.to + CALL_REF_SLACK);
        if (!landed.lines.slice(lo, hi).join('\n').includes(name)) {
          findings.push({
            where,
            ref: m[2],
            why: `${landed.span} 那段附近没有 ${name}——引用说它在那儿，可那儿不是它`,
          });
        }
      }
    });
  }

  return { checked, findings };
}

function main(): void {
  const strict = process.argv.includes('--strict');
  const { checked, findings } = auditReferences();
  const shown = findings.slice(0, 40);
  for (const finding of shown) {
    process.stdout.write(`${finding.where}  ${finding.ref} —— ${finding.why}\n`);
  }
  if (findings.length > shown.length) {
    process.stdout.write(`……还有 ${findings.length - shown.length} 处\n`);
  }
  process.stdout.write(`共查 ${checked} 处行号引用，${findings.length} 处存疑\n`);
  // 跟调色板那个不一样：这里没有预算可超，只有自述为真这一条。
  // 所以 `--strict` 的退出码只看有没有存疑，不看多少。
  if (strict && findings.length > 0) process.exitCode = 1;
}

// 被 import 时不跑 main：测试要的就是那个纯函数，不是它的退出码。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
