import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { WORLD } from '../src/world/palette-data.ts';
import { sourceFiles } from './source-scan.ts';

/**
 * #13 第二条验收条件的闸门：「现有世界完全由配置驱动：代码里没有写死的
 * 区域名、色值、预制体 id、作息落点」。
 *
 * 四样东西今天**不是一样的状态**，所以本文件分四种判据、三种处置，不说成一种：
 *
 * | 判征 | 今天 | 处置 |
 * |---|---|---|
 * | 色值 | 1 处（`blueprints.ts` 一条错误信息里的格式示例） | 已改，现在 0 处 → 硬闸 |
 * | 区域名 / 居民名 / 作息说法 | 0 处 | 硬闸 |
 * | 作息落点 | 4 处（莞尔镇的四个落点） | 登记表 `KNOWN_STOPS`，双向 |
 * | 预制体 id | 19 个 (文件, id) 对 | 登记表 `KNOWN_PREFABS`，双向 |
 *
 * **两张登记表是已知限制清单，不是豁免名单**（`terrain-edge-invisible.test.ts`
 * 立过的规矩）：多出一处会红，修好一处也会红（提示删行）。只看一边的闸门会被
 * 「悄悄修好」绕过，而清单失真之后，下一次真退化就会被当成已知项放过去。
 *
 * ## 登记表的 `why` 本身也会假（2026-10-28 逐条核过）
 *
 * 双向 diff 保的是「表里的行与代码里的行对得上」，保不了 `why` 说对了。
 * 2026-10-28 把 19 行 `why` 逐条对着代码核了一遍，**三处是假话**：`world-state.ts`
 * 四条把 `TaskKind` 说成「研究节点」（还把 `gear_tower` 的活对错了）、同四条
 * 说「莞尔镇没有配置包」（那张表不分局）、`wave_house` 那条说查找它是「才好把
 * 幌布挂在它两侧」（幌布走 `pack.scenery`，与它无关）。已按实测改写。
 *
 * 教训不是「下次写仔细点」——是**`why` 是散文，散文说错了只有复核能发现**。
 * 所以加了一条「`why` 里反引号点名的符号得还在」，并在那条测试里写明它拦不住
 * 上面这三处（它们一个符号都没带）。别把那条读成全自动保障。
 *
 * ## 为什么色值判据能全自动、预制体 id 判据不能
 *
 * 色值有唯一的出处：`palette-data.ts` 的 `WORLD`。判据直接拿 `Object.values(WORLD)`
 * 反查字面量，于是哈希常量（`0x9e3779b9`）、整数上界（`0xffffff`）自动出局——
 * 它们不在 24 色里。这一条**不需要任何人维护名单**。
 *
 * 预制体 id 没有这个性质：`oracle-build.ts` 把中文名词映射到 id，那是**命令
 * 白名单**，#13 的「不做」一节明写「归 #6，将来由 #6 反过来读配置包」——
 * 所以那个文件整份排除，且排除本身由下面一条测试盯着（它得还是那个 oracle
 * 解析器，不能悄悄变成别的）。剩下的 19 对分散在四个文件，各有各的缘由，
 * 只能登记。**登记不是终点**：每登记一对就是多认一处破例。
 *
 * ## 本文件不查的
 *
 * - **瓦片配方**（`tilemap.ts` 里按地形画什么）与**潮汐周期/抖动幅度**。
 *   #13 的交付清单里有这两样，但它们不在验收条件那一行里（那一行只点四样）。
 *   瓦片配方是渲染算法不是世界数据；潮汐那条另有冲突，见下。
 * - **`scripts/` 与 `test/` 不在扫描范围里**。`test/` 是夹具——测试**本该**引用
 *   设定集的数据，扫它只会得到一片噪声（实测 150 个文件里 8 个命中）。`scripts/`
 *   是工具，其中 `audit-palette.mjs` 那一份 24 色正是它自己要审的东西。
 *   但 `scripts/check-dengchao.mjs` 手抄了五个区域名，而它只查「这五个都在」——
 *   包里多一道区域它不红，会静默少查一项。所以那一处由最后一条测试单独钉着，
 *   不并进扫描范围。
 * - **莞尔镇本身没有配置包**。它的分区、预制体、四个落点全在 `setup.ts` 与
 *   `routines.ts` 里。`KNOWN_PREFABS` / `KNOWN_STOPS` 里绝大多数记录的理由
 *   就是这一句。等它有包了，两张表一起清空——在那之前，本闸门守的是
 *   「灯潮界完全由包驱动，且莞尔镇那部分不会再长」。
 *
 * ## 潮汐那条与 #13 的冲突（记账，不在本文件解决）
 *
 * #13 的交付清单写着「潮汐周期与抖动幅度」要进配置包。可 `tide.ts` 的文件头
 * 是「潮汐：世界自己的时钟」，`grime.ts` 写着「世界的节律归世界……不是世界走
 * 多快」，`docs/SPEC_V2.md` §4.3 有一条「『潮汐是时钟』这条不被夺权」。
 * 把 `TIDE_PERIOD_MS` / `TIDE_JITTER_MS` 交给设定集，就是让设定集能改世界的
 * 时钟——与上面三处直接冲突。这是范围问题，该由用户定，不由一道测试定。
 *
 * ## 变异记录（2026-10-28，逐个跑过，不是推理）
 *
 * | 变异 | 结果 |
 * |---|---|
 * | `src/world/` 里写一个区域名 | 判据二红，只红它 |
 * | `src/world/` 里写一个 24 色色值（`0x9c4f3c`） | 判据一红，只红它 |
 * | `src/world/` 里写一个 `#8a5a44` 字符串 | 判据一红——**证明 `blueprints.ts` 那笔修复承重** |
 * | `src/world/` 里声明一个带 `dwellMs` 的落点 | 判据三 `appeared` 红 |
 * | `src/world/` 里引用一个预制体 id | 判据四 `appeared` 红 |
 * | `KNOWN_STOPS` 加一行不存在的 | 判据三 `gone` 红 |
 * | `KNOWN_PREFABS` 加一行不存在的 | 判据四 `gone` 红 |
 * | `KNOWN_OTHER_LABELS` 加一行不存在的 | 判据四（盲区）`gone` 红 |
 * | 去掉「`label:` 得是字符串字面量」 | 多抓 `routines.ts` 的 14/84/92/125 四行 |
 * | `src/world/` 里写一个不带 `dwellMs` 的 `label:` | 盲区那条 `appeared` 红 |
 * | `check-dengchao.mjs` 的数组多加一个区域名 | 第八条红 |
 * | `check-dengchao.mjs` 的数组少一个区域名 | 第八条红 |
 *
 * 另有一条**不在本文件**的更正，记在这儿是因为它是同一轮复审挑出来的：
 * `settings-region-colors.test.ts` 原写「§4.2 的行已被两道各自拦下」——假的。
 * 复量确认：删掉节边界时 §4.2 漏七行，其第三格正是
 * `water`/`copper`/`terracotta`/`amber`/`ink`/`charcoal`/`moss`，token 判据一道
 * 都拦不住。拦 §4.2 的只有节边界；token 判据拦的是 §4.1 自己的表头与分隔行。
 */

const SRC = new URL('../src/', import.meta.url);

/** `src/` 为根的正斜杠相对路径，与 `srcRelative` 同一口径（报错里要能搜到）。 */
function rel(file: string): string {
  return file.slice(SRC.pathname.length).replace(/^[/\\]/, '').split(/[\\/]/).join('/');
}

/**
 * 剔注释、**留字符串**。
 *
 * 为什么不能直接用 `source-scan.ts` 的两个helper：
 *   - `codeOf()` 把字符串内容换成等长空白——那是为查「代码里有没有出现某个词」
 *     设计的（注释里引用的旧词不误报）。可本文件要查的世界数据**全住在字符串里**，
 *     经它一过，`name: '渡口站台'` 变成 `name: '        '`，永远不命中。
 *   - `codeLines()` 只剔整行注释——import 语句够用，可这里会误报：一句
 *     `// 莞尔镇那张图上没有浅滩轨道` 就够让「区域名」判据红一次，而那句话
 *     正是在解释为什么不改。
 *
 * 残留边界（有意不假装补上）：`'渡口' + '站台'` 这种拼出来的词扫不到。
 * 真要靠一道闸拦住它得在构建期做标识符解析，那不属于一条测试的体量。
 * 所以只在这儿的注释里说清楚，别让读的人以为它拦得住。
 */
function codeKeepStrings(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (span) => span.replace(/[^\n]/g, ' '))
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => {
      const at = line.indexOf('//');
      if (at === -1) return line;
      // 引号个数为奇数，说明这个 `//` 在字符串里头（`'http://x'`）。
      const quotes = (line.slice(0, at).match(/['"`]/g) ?? []).length;
      return quotes % 2 === 1 ? line : line.slice(0, at);
    })
    .join('\n');
}

const FILES = sourceFiles(SRC.pathname.replace(/^\//, ''));
const CODE = new Map(FILES.map((f) => [f, codeKeepStrings(f)]));

/** 设定集自己的文件：那儿写着世界数据是天经地义，不是违例。 */
const isPackFile = (file: string) => rel(file).startsWith('settings/');

// ------------------------------------------------------------------ 判据一：色值

/**
 * `palette-data.ts` 之外不许出现**等于 24 色里任何一个值**的字面量。
 *
 * 匹配 `0xRRGGBB` 与 `#rrggbb` 两种旧写法（`blueprints.ts` 的 `readPaletteSlot`
 * 两种都收）。前后加 `(?<![\w$])` / `(?![\w$])`：`0x9e3779b9` 是 8 位十六进制，
 * 不拦；`0x100000000` 也不拦。
 */
function worldColourLiterals(): readonly string[] {
  const values = new Set(Object.values(WORLD).map((v) => v.toString(16).padStart(6, '0')));
  const hits: string[] = [];
  for (const [file, text] of CODE) {
    if (rel(file) === 'world/palette-data.ts') continue;
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(?<![\w$])0x([0-9a-fA-F]{6})(?![\w$])/g)) {
        if (values.has(m[1]!.toLowerCase())) hits.push(`${rel(file)}:${i + 1} 0x${m[1]}`);
      }
      const hex = /(?<![\w$])#([0-9a-fA-F]{6})(?![\w$])/.exec(line);
      if (hex && values.has(hex[1]!.toLowerCase())) hits.push(`${rel(file)}:${i + 1} #${hex[1]}`);
    });
  }
  return hits.sort();
}

test('24 色的色值字面量只许出现在 palette-data.ts', () => {
  assert.deepEqual(
    worldColourLiterals(),
    [],
    '这些地方把世界 24 色的**值**写死了。改成 token 名（或 `WORLD.xxx`）；'
      + '若是错误信息里的格式示例，用 "#rrggbb" 这种占位，别拿一个真色当例子。',
  );
});

// ------------------------------------------------- 判据二：包里的名字与说法（引用）

/** 包里写着的区域名、居民名、作息说法——这些词的归属是设定集，不是代码。 */
function packWords(): readonly string[] {
  return [
    ...DENGCHAO_RAW.regions.map((r) => r.name),
    ...DENGCHAO_RAW.villagers.map((v) => v.name),
    ...DENGCHAO_RAW.villagers.flatMap((v) => v.routine.map((s) => s.label)),
  ].filter((w) => w.length > 0);
}

/**
 * `src/settings/` 之外不许**引用**包里的名字与说法。
 *
 * 与判据三的分工：判据三查「在代码里声明一个作息落点」，这一条查「拿包里的
 * 某个具体词来比」。`beat.label === '点亮楼前的长灯'` 是后一种——它不声明落点，
 * 但同样把设定集的一个选择焊死在了代码里。
 *
 * 引号三种都算（`'` `"` `` ` ``）：只查单引号会漏，而漏掉的那一处正是有人
 * 「顺手改了个引号风格」的地方。
 */
function packWordReferences(): readonly string[] {
  const words = packWords();
  const hits: string[] = [];
  for (const [file, text] of CODE) {
    if (isPackFile(file)) continue;
    text.split('\n').forEach((line, i) => {
      for (const word of words) {
        for (const q of ['\'', '"', '`']) {
          if (line.includes(`${q}${word}${q}`)) hits.push(`${rel(file)}:${i + 1} ${word}`);
        }
      }
    });
  }
  return hits.sort();
}

test('src/settings/ 之外不引用设定集的名字与说法', () => {
  assert.deepEqual(
    packWordReferences(),
    [],
    '这些地方引用了设定集自己写着的区域名 / 居民名 / 作息说法。'
      + '换成查 id、或者让设定集把要的那个词给出来。',
  );
});

// ---------------------------------------------------------- 判据三：作息落点（形状）

/**
 * 已知的、写在代码里的作息落点。键是 `文件:行`，值得说清**为什么**它还能在。
 *
 * 清空的条件只有一个：那个世界有了配置包。四条全是莞尔镇的，理由同一句，
 * 但每一行都写出来——复制一句「同上」的清单，读的人不会真去核上面那句。
 */
const KNOWN_STOPS: Readonly<Record<string, { readonly why: string }>> = {
  'world/routines.ts:27': {
    why: '莞尔镇没有配置包。这一拍是「在祭坛边坐着」，锚点就是祭坛本身，目标由参数传进来。',
  },
  'world/routines.ts:30': {
    why: '莞尔镇没有配置包。这一拍去农田边，落点是 `altar` 偏移 (-8,+4) 后找的最近可走格。',
  },
  'world/routines.ts:36': {
    why: '莞尔镇没有配置包。这一拍在街口站着，落点是 `altar` 偏移 (+8,-3) 后找的最近可走格。',
  },
  'world/routines.ts:40': {
    why: '莞尔镇没有配置包。这一拍回到祭坛等神谕，与第一拍同一个 target，一圈的收尾。',
  },
};

/**
 * 代码里**声明**的作息落点：对象字面量中 `label:` 的值是字符串字面量，
 * 且同一个字面量里有 `dwellMs:`。
 *
 * 判据是形状，不是词——所以它不认识任何世界，莞尔镇、灯潮界、将来的设定集 B
 * 一视同仁。两个条件都得要，**各自都承重**（变异实测过，不是推理）：
 *
 * 去掉「`label:` 的值得是字符串字面量」这一个条件，`world/routines.ts` 会多出
 * 四行——`:14` 是 `RoutineBeat` 的类型声明（`readonly label: string`），它在说
 * 「有一个 label 字段」，不是在说某一拍的词；`:84` 与 `:92` 是下雨 / 暴雨时
 * **换一句说法**（`label: 天气 === 'storm' ? '缩进屋檐下躲暴雨' : …`）；`:125`
 * 是 `fallbackTo` 把锚点的字段搬过来（`label: anchor.label`）。后三处是**行为**，
 * 不是数据——世界在下雨时换个说法，不等于哪个世界的作息被焊死在这儿。
 *
 * 「`dwellMs:` 得在同一个字面量里」放掉的 8 行见 `KNOWN_OTHER_LABELS`：时辰名与
 * 活计名。它们也是写在代码里的世界数据，只是不属于 #13 点的那四样——所以单独
 * 一条测试钉着，不混进这一条的清单。
 */
function declaredStops(): readonly string[] {
  return labelLiterals()
    .filter((hit) => hit.dwell)
    .map((hit) => hit.at);
}

/** `label:` 的值是字符串字面量的每一行，连同这个字面量里有没有 `dwellMs:`。 */
function labelLiterals(): readonly { readonly at: string; readonly dwell: boolean }[] {
  const out: { at: string; dwell: boolean }[] = [];
  for (const [file, text] of CODE) {
    if (isPackFile(file)) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (!/\blabel:\s*['"`]/.test(line)) return;
      // 只看这个对象字面量内部：往下走到收尾的 `}` `)` `,` 为止。
      let dwell = false;
      for (let j = i; j < Math.min(i + 8, lines.length); j++) {
        if (/\bdwellMs:/.test(lines[j]!)) {
          dwell = true;
          break;
        }
        if (j > i && /^\s*[}),]/.test(lines[j]!)) break;
      }
      out.push({ at: `${rel(file)}:${i + 1}`, dwell });
    });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/**
 * 实测与登记的双向差集。与 `terrain-edge-invisible.test.ts` 的 `diffAgainstKnown`
 同一形状：`appeared` 是新违例，`gone` 是记录过期。
 */
function diffStops(known: Readonly<Record<string, unknown>>): {
  readonly appeared: readonly string[];
  readonly gone: readonly string[];
} {
  const measured = declaredStops();
  return {
    appeared: measured.filter((k) => !(k in known)),
    gone: Object.keys(known).filter((k) => !measured.includes(k)),
  };
}

test('代码里声明的作息落点必须与 KNOWN_STOPS 一模一样', () => {
  const { appeared, gone } = diffStops(KNOWN_STOPS);
  assert.deepEqual(
    appeared,
    [],
    `出现清单外的作息落点：${appeared.join('、')}。#13 要求落点归配置包——`
      + '新写的一处要么搬进 `src/settings/` 下的设定集，要么往 KNOWN_STOPS 登记一行'
      + '（登记 = 多认一处破例，先想清楚那个世界为什么还没有包）。',
  );
  assert.deepEqual(
    gone,
    [],
    `这些落点已经不在代码里了，KNOWN_STOPS 里的记录过期了，删掉对应行：${gone.join('、')}`,
  );
});

/**
 * `dwellMs` 条件放掉的那 8 行。**这不是豁免名单，是盲区登记。**
 *
 * 「同字面量里有 `dwellMs:`」把作息落点与别的 `label:` 字面量分开。可代码里还有
 * 别的 `label:`：时辰的四个名字（`day-phase.ts`）与活计的四个名字（`tasks.ts`）。
 * 它们同样是写在代码里的世界数据，只是 #13 的验收条件那一行没点它们——那一行
 * 只点「区域名、色值、预制体 id、作息落点」。
 *
 * 所以它们在这儿登记，而不是假装判据覆盖到了。**多一行会红**：将来有人在代码里
 * 写下第九个 `label:` 字面量，不管它是什么，先过这一条。而那正是这条存在的意义——
 * 否则「代码里没有写死的世界数据」会被读成已经被守住了，其实只守住了四样里的一样。
 */
const KNOWN_OTHER_LABELS: Readonly<Record<string, { readonly why: string }>> = {
  'render/day-phase.ts:46': { why: '一天四个时辰的名字。#13 没点这一样，时辰归世界的钟，不归设定集。' },
  'render/day-phase.ts:57': { why: '同上，四个时辰之一。' },
  'render/day-phase.ts:68': { why: '同上，四个时辰之一。' },
  'render/day-phase.ts:79': { why: '同上，四个时辰之一。' },
  'world/tasks.ts:10': { why: '四类活计的名字与估时。#13 没点这一样；估时是世界机制，不是设定集的选择。' },
  'world/tasks.ts:11': { why: '同上，四类活计之一。' },
  'world/tasks.ts:12': { why: '同上，四类活计之一。' },
  'world/tasks.ts:13': { why: '同上，四类活计之一。' },
};

test('dwellMs 条件放掉的其他 label 字面量必须与 KNOWN_OTHER_LABELS 一模一样', () => {
  const measured = labelLiterals()
    .filter((hit) => !hit.dwell)
    .map((hit) => hit.at);
  const appeared = measured.filter((k) => !(k in KNOWN_OTHER_LABELS));
  const gone = Object.keys(KNOWN_OTHER_LABELS).filter((k) => !measured.includes(k));
  assert.deepEqual(
    appeared,
    [],
    `代码里多了新的 label 字面量：${appeared.join('、')}。作息落点走上面那条；`
      + '不是作息的，先想清楚它是不是又一样写在代码里的世界数据——是就搬进设定集，'
      + '不是就登记一行并写清为什么它可以留在代码里。',
  );
  assert.deepEqual(
    gone,
    [],
    `这些 label 字面量已经不在代码里了，KNOWN_OTHER_LABELS 里的记录过期了，删掉对应行：${gone.join('、')}`,
  );
});

// ------------------------------------------------------------ 判据四：预制体 id

/**
 * 排除 `oracle-build.ts` 的**唯一**理由，钉在这儿。
 *
 * #13 的「不做」一节：「命令白名单不进配置包（归 #6，将来由 #6 反过来读配置包）」。
 * 那个文件是 oracle 的建造解析器，里面那张中文名词 → 预制体 id 的表就是命令白名单。
 *
 * 这条测试盯着排除本身：哪天 `oracle-build.ts` 被改名、被删、或者不再 import
 * 建造蓝图，排除就成了悄悄绕过闸门的后门——而闸门照绿。
 */
test('预制体 id 判据排除 oracle-build.ts 的理由仍然成立', () => {
  const oracle = CODE.get(FILES.find((f) => rel(f) === 'world/oracle-build.ts')!);
  assert.ok(oracle !== undefined, 'world/oracle-build.ts 不见了——判据四的排除失去了对象，先回来重写这条');
  assert.match(
    oracle,
    /PrefabBlueprint|prefab/,
    'world/oracle-build.ts 已经不再碰预制体了——「命令白名单归 #6」这个排除理由不成立了，'
      + '把它的 id 收进 KNOWN_PREFABS，或者干脆并进判据四的扫描范围。',
  );
});

/**
 * 已知的、写在代码里的预制体 id。键是 `文件|id`。
 *
 * **`oracle-build.ts` 整份不在这儿**（理由见上一条测试）。其余四条文件：
 * `setup.ts` 是莞尔镇的世界布局；`world-state.ts` 把四个 id 当研究节点的键；
 * `render/buildings.ts` 与 `render/setting-scenery.ts` 按 id 分叉画法。
 * 四处的共同根子是同一句：莞尔镇没有配置包。
 */
const KNOWN_PREFABS: Readonly<Record<string, { readonly why: string }>> = {
  // world/setup.ts：莞尔镇的镇心三件套、野外的矿/磨坊/塔、两种住宅。
  'world/setup.ts|code_forge': { why: '莞尔镇没有配置包。镇心三件套之一，`setup.ts` 开局就落位。' },
  'world/setup.ts|star_archive': { why: '莞尔镇没有配置包。镇心三件套之一。' },
  'world/setup.ts|ink_house': { why: '莞尔镇没有配置包。镇心三件套之一。' },
  'world/setup.ts|crawler_mine': { why: '莞尔镇没有配置包。野外的矿洞。' },
  'world/setup.ts|ink_mill': { why: '莞尔镇没有配置包。野外的磨坊。' },
  'world/setup.ts|gear_tower': { why: '莞尔镇没有配置包。野外的齿轮塔。' },
  'world/setup.ts|cottage_oak': { why: '莞尔镇没有配置包。三种镇内住宅之一。' },
  'world/setup.ts|cottage_plaster': { why: '莞尔镇没有配置包。三种镇内住宅之一。' },
  'world/setup.ts|cottage_stone': { why: '莞尔镇没有配置包。三种镇内住宅之一。' },
  'world/setup.ts|homestead_far': { why: '莞尔镇没有配置包。两种野外庄院之一。' },
  'world/setup.ts|homestead_ridge': { why: '莞尔镇没有配置包。两种野外庄院之一。' },
  // world/world-state.ts：每类活对应的郊野模板 id。
  //
  // 这一组的 why 我第一版全写错了，2026-10-28 逐条核过：
  //   - 写的是「研究节点」，可 `WILD_PREFAB_OF` 的键是 `TaskKind`，四类活
  //     （`tasks.ts` 的 `TASK_PROFILES`）分别是写代码 / 查资料 / 整理便笺 /
  //     顺手查一件小事，没有一类叫「研究」。
  //   - 写的是「莞尔镇没有配置包」，可这张表**不分局**：`oracle-panel.ts` 的
  //     补缺面板拿它决定建哪栋，不管当前加载哪个设定集。
  //   - `gear_tower` 那条还把 id 与显示名对错了：齿轮塔接的是「写代码」，
  //     不是「研究」。
  'world/world-state.ts|gear_tower': {
    why: '补缺按钮要建哪栋：`WILD_PREFAB_OF` 把「写代码」映到齿轮塔，而它不分局——'
      + 'oracle 面板不管当前是哪个设定集都读这张表。包侧没有对应字段。',
  },
  'world/world-state.ts|crawler_mine': {
    why: '同上，「查资料」映到爬虫矿洞。',
  },
  'world/world-state.ts|ink_mill': {
    why: '同上，「整理便笺」映到文档磨坊。',
  },
  'world/world-state.ts|workshop_plot': {
    why: '同上，「顺手查一件小事」映到新工坊。',
  },
  // render/buildings.ts：三栋常驻铺子各自的立面识别件（`drawFacade` 的原文）。
  //
  // 别写成「窗光」——实测三栋各画各的：炼码工坊是炉口加铁砧、星图书阁是高窗
  // 加书堆加星形徽记、抄书斋是纸屏（连窗都不是）。承重的共同点只有一句
  // 「这一栋认得出来」。
  'render/buildings.ts|code_forge': {
    why: '莞尔镇没有配置包。`drawFacade` 里炉口 + 铁砧那一支，别家没有。',
  },
  'render/buildings.ts|star_archive': {
    why: '莞尔镇没有配置包。`drawFacade` 里高窗 + 书堆 + 星形徽记那一支。',
  },
  'render/buildings.ts|ink_house': {
    why: '莞尔镇没有配置包。`drawFacade` 里纸屏那一支——它连窗都不是。',
  },
  // render/setting-scenery.ts：叠浪楼要从包里的落位里认出来。
  //
  // 这一条的 why 原来写着「才好把幌布挂在它两侧」——假话。幌布来自
  // `pack.scenery` 里 kind 为 'banner' 的项，跟这次查找半点关系没有。
  // 实测这次查找画的是陶土红栏（dy 23/44/65 三层）与逐层窗火。
  'render/setting-scenery.ts|wave_house': {
    why: '莞尔镇没有配置包。灯街的主楼（叠浪楼）要从包里的落位里认出来，'
      + '给它画三层红栏与逐层窗火——这是「哪一栋特殊」写死在渲染器里。',
  },
};

/** 预制体 id 的全集：共享蓝图目录 + 灯潮界那份包自己声明的。 */
function prefabIds(): readonly string[] {
  const catalogue = JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  return [...new Set([...Object.keys(catalogue), ...Object.keys(DENGCHAO_RAW.prefabs)])];
}

function prefabIdPairs(): readonly string[] {
  const ids = prefabIds();
  const pairs: string[] = [];
  for (const [file, text] of CODE) {
    if (isPackFile(file)) continue;
    if (rel(file) === 'world/oracle-build.ts') continue;
    for (const id of ids) {
      if (text.includes(`'${id}'`) || text.includes(`"${id}"`) || text.includes('`' + id + '`')) {
        pairs.push(`${rel(file)}|${id}`);
      }
    }
  }
  return pairs.sort();
}

test('代码里写死的预制体 id 必须与 KNOWN_PREFABS 一模一样', () => {
  const measured = prefabIdPairs();
  const appeared = measured.filter((k) => !(k in KNOWN_PREFABS));
  const gone = Object.keys(KNOWN_PREFABS).filter((k) => !measured.includes(k));
  assert.deepEqual(
    appeared,
    [],
    `出现清单外的预制体 id：${appeared.join('、')}。#13 要求预制体 id 归配置包——`
      + '新的参照要么改成从包里查，要么往 KNOWN_PREFABS 登记一行并写清为什么。',
  );
  assert.deepEqual(
    gone,
    [],
    `这些 id 已经不在代码里了，KNOWN_PREFABS 里的记录过期了，删掉对应行：${gone.join('、')}`,
  );
});

/**
 * `KNOWN_PREFABS` 的 `why` 里点名的符号，得还在它自己那个文件里。
 *
 * ## 先说清这条**不能**防什么
 *
 * 2026-10-28 我逐条核过这 19 行的 `why`，挑出**三处假话**：
 *
 * - `world-state.ts` 四条写着「研究节点」——可 `WILD_PREFAB_OF` 的键是
 *   `TaskKind`，四类活是写代码 / 查资料 / 整理便笺 / 顺手查一件小事，
 *   没有一类叫「研究」；`gear_tower` 那条还把 id 和显示名对错了。
 * - 同四条写着「莞尔镇没有配置包」——可那张表**不分局**，补缺面板不管当前
 *   是哪个设定集都读它。
 * - `wave_house` 那条写着「才好把幌布挂在它两侧」——幌布来自 `pack.scenery`
 *   里 kind 为 `'banner'` 的项，与那次查找无关；那次画的是三层红栏与逐层窗火。
 *
 * **这三处一条都不带反引号符号**，所以下面这条判据一道都拦不住。拦不住是
 * 实话：`why` 是散文，散文说错了只有人能发现。这一轮是靠复核发现的，不是靠
 * 闸门。别把这条读成「以后假 `why` 会被自动抓到」——那是下一个假话。
 *
 * ## 那这条还防什么
 *
 * 防下一轮：新写下的 `why` 是带着符号写的（`WILD_PREFAB_OF` / `drawFacade` /
 * `pack.scenery`…）。哪天这些符号被改名或删掉，`why` 当场变成一句指向空气的
 * 话——而它会安静地躺在登记表里，直到下一个人核它。符号改名是**会响的**那种
 * 破坏，这一条让它在这里就响。
 *
 * 判据只认反引号里的内容，且只在本行对应的那个文件里找。之所以不认中文引号
 * 「」：那里面装的是人话，不是标识符。
 */
test('KNOWN_PREFABS 的 why 点名的符号都还在自己那个文件里', () => {
  const missing: string[] = [];
  for (const [key, entry] of Object.entries(KNOWN_PREFABS)) {
    const [file] = key.split('|');
    // 拿 rel() 反查而不自己拼路径：CODE 的键是 sourceFiles() 拼出来的，
    // 那边在已带尾斜杠的目录后又接了一个 "/"（`src//main.ts`），复刻这个形状
    // 等于把一处巧合写进判据。rel() 认得它，就让 rel() 去认。
    const text = CODE.get(FILES.find((f) => rel(f) === file) ?? '');
    assert.ok(text !== undefined, `${key} 指向的文件 ${file} 不在 src/ 里`);
    for (const named of entry.why.match(/`([^`]+)`/g) ?? []) {
      const symbol = named.slice(1, -1);
      // 形如 'banner' / "banner" 的是字面量，不是标识符。
      const bare = symbol.replace(/^['"`]|['"`]$/g, '');
      if (!/^[A-Za-z_$][\w$]*$/.test(bare)) continue;
      if (!text!.includes(bare)) missing.push(`${key} 的 why 写了 \`${symbol}\`，可 ${file} 里没有它`);
    }
  }
  assert.deepEqual(missing, [], `${missing.join('；')}。why 是给人核的，符号没了它就是一句指向空气的话。`);
});

/**
 * 判据不是同义反复：把每个判据各自的**出处**钉住。
 *
 * 这一条防的是「扫描范围空了所以全绿」。色值判据的出处是 24 个 token、
 * 作息说法判据的出处是包里的 15 个词、预制体判据的出处是蓝图目录 12 个 + 包的
 * 7 个模板（无重叠，并集 19）。哪一天 `prefabs.json` 改名、`DENGCHAO_RAW` 换了
 * 结构，或者 `WORLD` 只剩几个色，扫描范围就静悄悄缩到几乎不拦——而七条测试照绿。
 *
 * 四个数都是**下限，取的是今天的值**，不是测量值：设定集将来多一道区域、多一个
 * 模板，这一条不该红（那是长，不是缩）。所以它只拦「掉到今天以下」，不跟踪增长。
 * `WORLD` 那个用相等而不用下限——24 色是 ADR 定的，多一个少一个都得重新走 ADR。
 */
test('四个判据的出处都还在，且没有缩水', () => {
  assert.equal(Object.keys(WORLD).length, 24, '世界色板不是 24 色了——判据一的出处变了，回来重写它');
  assert.ok(DENGCHAO_RAW.regions.length >= 5, '灯潮界的区域少于 5 道——判据二的出处缩水了');
  assert.ok(packWords().length >= 15, `包里的名字与说法只有 ${packWords().length} 个——判据二的出处缩水了`);
  assert.ok(prefabIds().length >= 19, `预制体 id 只有 ${prefabIds().length} 个——判据四的出处缩水了`);
});

/**
 * `scripts/check-dengchao.mjs` 手抄的那份区域名，必须与包里的**一模一样**。
 *
 * 那个脚本是浏览器冒烟验收，验「五个区域标签真的画在 DOM 上」。它自己写死了
 * 五个名字——而它只查「这五个**都在**」。于是包里添第六道区域时它一声不响，
 * 静默少查一项；改一个名字时它才红。**「只在」与「都在」不是同一句话**，这条把
 * 它钉成一样。
 *
 * 为什么不并进上面四条判据的扫描范围：那条扫的是 `src/`（产品代码），`scripts/`
 * 是工具，`test/` 是夹具——两处都不该按「代码里不写死世界数据」来量。这一处是
 * 例外，因为它是一份**会静默腐烂的手抄**，与闸门守的是同一类东西。
 */
test('check-dengchao.mjs 手抄的区域名与包里一模一样', () => {
  const script = readFileSync(new URL('../scripts/check-dengchao.mjs', import.meta.url), 'utf8');
  // 锚在 `.every((name) => labels.includes(name))` 上，那才是承重的那半——
  // 换成在全文里找第一个字符串数组，明天有人在脚本别处加一个数组就会抓错。
  const list = /\[([^\]]+)\]\s*\.every\(\(name\)\s*=>\s*labels\.includes/.exec(script);
  assert.ok(
    list !== null,
    'check-dengchao.mjs 里那份「五个区域标签都在」的数组找不到了——脚本改了写法，先回来看这条',
  );

  const names = (list[1]!.match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
  const declared = DENGCHAO_RAW.regions.map((r) => r.name);
  assert.deepEqual(
    [...names].sort(),
    [...declared].sort(),
    'check-dengchao.mjs 那份区域名与包里的不一致。包里添了区域它不会自己知道——'
      + '那个脚本只查「这几个都在」，多一道不红。',
  );
});
