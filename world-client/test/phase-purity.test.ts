/**
 * 「时辰不进世界」的三道闸。
 *
 * 出处是 `docs/adr/ADR_WORLD_ALIVE.md` §2（规矩）与 §6（怎么知道它还成立）。
 * §6 原来把这一条列在**缺口 1**：「明天有人把 `phaseAt` 接进 `Simulation`，
 * 今天没有一道闸会红」。本文件就是补上它的那一笔——而补的方式是拆成三道，
 * 因为「时辰进世界」有三条不同的路，一道闸拦不住三条：
 *
 *   1. **import 进来。** 这条 `test/purity.test.ts` 的「src/world 不 import 它
 *      上面的任何一层」已经拦了。本文件不重复。
 *      （判据是**解析后的落点**，不是「这一行有没有 `../`」：`src/world/memory/`
 *      开了子目录之后，`memory/perception.ts` 的 `from '../types.ts'` 解析到
 *      `world/types.ts`，那是世界内核自己。照字面判就会禁掉世界内部的子目录。）
 *   2. **抄一份进来。** 把 `phaseAt` 复制粘贴到 `src/world/` 下，import 图一片
 *      干净，而世界照样知道「现在几点」。第 2 条用例拦这个。
 *   3. **快照里开一个字段。** 不 import、不抄，只在 `WorldSnapshot` 上加一个
 *      `phase`——渲染层读快照就能拿到时辰，而世界仍然"不知道自己有时辰"。
 *      第 3 条用例拦这个：它不猜字段名，它把**快照今天的全部字段冻住**。
 *
 * 三条都不看墙钟。这不是遗漏：`phaseAt` 读的是墙钟（`new Date(epochMs).getHours()`），
 * 而墙钟在世界里的合法读者只有一个（`deps.wallClock`），那条由
 * `test/purity.test.ts` 的 §4.6 扫描按**整行字面量**守着。所以「世界读了墙钟」
 * 与「世界知道了时辰」是两件事，各有各的闸——把两者合成一道，红的时候说不清
 * 是哪条规矩被破了。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeOf, codeLines, sourceFiles, srcRelative } from './source-scan.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { Simulation } from '../src/world/simulation.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const WORLD_DIR = `${SRC}/world`;

/**
 * 时辰模块的标识符。出现任意一个，就说明世界那一层知道"一天有四刻"这件事。
 *
 * **`day-phase`（模块路径）故意不在表里。** 它不是"结构上不可能命中"——
 * 这话我写过，是错的，复审拿实验推翻了：`codeOf()` 按行切完才挖字符串，
 * 所以块注释里不带 `*` 的体行、多行模板字符串、正则字面量，这三样它都活得
 * 过去（实测过，`day-phase` 与 `phaseAt` 在七种形状下表现完全一样，没有一种
 * 能把两者分开）。
 *
 * 它不在表里的真实理由是**没用**：把这个键加进来，唯一想抓的那种走法——
 * 把 `day-phase.ts` 抄进 `src/world/` 再 import 它——恰好抓不到。那条 import
 * 的路径在字符串里，而 `codeOf()` 正好把字符串内容换成等长空白。而抄过来的
 * 文件里总得有 `phaseAt`（否则它也不叫时辰模块了），那一个键就够了。
 * 路径那一路归 `test/purity.test.ts` 的「src/world 不 import 它上面的任何一层」
 * 管——它禁的是**解析后落在 `src/world/` 之外**的 import，不是"有 `../`"，
 * 开了子目录之后这两件事不是一回事。
 *
 * 顺带记一笔：`docs/adr/ADR_WORLD_ALIVE.md` 原来把 `day-phase` 列在这道闸的
 * 词表里，列了六个名字，而代码里只有五个。那个文档错误已经修了。
 *
 * **为什么不拿裸词 `phase` 当键**：`src/world/bustle.ts` 的 `litWindowCount` 有一个
 * 参数就叫 `phase: { readonly litWindows: number }`，函数体里读 `phase.litWindows`。
 * 那是"楼里亮着几扇窗"的那个入参，与时辰无关——`litWindowCount` 收的是一个数，
 * 世界内核因此对"时辰"这个概念一无所知（`ADR_WORLD_ALIVE.md` §2 把这件事
 * 当作正向证据记着）。拿裸词扫，今天就会误报一次；而误报一样毁掉一道闸，
 * 只是毁得慢一点——下次真出事时，人会先学会忽略这条红。
 *
 * 同理不拿 `dawn` / `noon` / `dusk` / `night` 四个**档位名**当键：它们是普通
 * 英文词，将来完全可能名一个别的东西（比如一个叫 `nightWatch` 的活计），而那时
 * 这道闸就会逼人为一个无关的东西写豁免。要拦"开了一个时辰字段"，第 3 条用例
 * 比任何词表都准——它根本不用猜名字。
 *
 * 按子串匹配（`text.includes`），不是按词边界：`this.phaseAt(...)` 要能命中。
 * 代价是将来一个叫 `MOON_PHASES` 的常量也会命中——而报错里带整行，看得出来的。
 */
const PHASE_VOCABULARY: readonly string[] = [
  'phaseAt',
  'PhaseId',
  'PhaseRecipe',
  'PHASE_ORDER',
  'PHASES',
];

test('世界代码里没有时辰模块的标识符（抄一份也拦得住）', () => {
  // 走 `codeOf()` 而不是裸读：裸读会让这条闸从上线第一秒起就是红的——而一道
  // 从第一天就红的闸，等于没有。
  //
  // **逼着用 `codeOf()` 的是 `PHASES`，不是 `day-phase`。** 这话我原来写错了：
  // 写的是「`src/world/weather.ts` 的注释里提了四次 `day-phase`」，可
  // `day-phase` 根本不在词表里，提四次也红不了。实测裸读整个 `src/world/`、
  // 六个候选词全试，一共五处命中：`PHASES` 一处（`weather.ts` 那段讲萤火的
  // 注释里，`PHASES.night.fireflies`）、`day-phase` 四处（同一段）。所以
  // 结论没变（裸读确实会红），但**原因**是另一个词——而原因写错了，
  // 下一个人就会去删那四处 `day-phase`，删完照旧红，还以为是别的地方漏了。
  // （**指名，不叫行号**：那几行会随编辑漂，而引用审计只认「那一行有没有代码」。）
  //
  // 递归整个 `src/world/`：这个目录今天是平的，但同族的灯油扫描当初失效，
  // 正是因为它只看 `simulation.ts`（有人把"油尽了不走这条路"写进 `grid.ts`，
  // 全套照旧绿）。多一层子目录不该又变成一片安静的盲区。
  const strays: string[] = [];
  for (const file of sourceFiles(WORLD_DIR)) {
    const rel = srcRelative(file, SRC);
    const text = codeOf(file);
    for (const word of PHASE_VOCABULARY) {
      if (!text.includes(word)) continue;
      const line = text.split('\n').find((row) => row.includes(word)) ?? '';
      strays.push(`${rel} 出现了 ${word}：${line.trim()}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    `时辰只喂渲染层（ADR_WORLD_ALIVE §2）。世界内核出现时辰模块的标识符，\n` +
      `说明它要么 import 了那一层（该红的是 purity.test.ts），要么抄了一份。\n` +
      strays.join('\n'),
  );
});

test('时辰那一层不 import Phaser——否则配方在 node 下一条都测不了', () => {
  // 这一条看起来与"时辰不进世界"反向，其实守的是同一件事的**可验证性**：
  // `ADR_WORLD_ALIVE.md` §6 那段「另一处已经补上的缺口」（暴雨天没有萤火）记着实测——
  // 往 `day-phase.test.ts` 里 import 一个引 Phaser 的模块，整个文件直接崩，
  // 一条用例都跑不到。萤火那个条件当初就是因为长在 `phase-view.ts` 里，才一直
  // "有注释、没用例"。
  // （**指名那一段，不叫它的号**：它原来叫「缺口 2」，节号改过一次就指向不存在的东西，
  // 而引用审计只认「文件.ts:NNN」，节号它根本不查。）
  //
  // 所以时辰模块自己必须保持 Phaser-free：它一旦依赖渲染后端，上面两道闸
  // 的用例就都跑不起来了，而闸跑不起来与没有闸在这份仓里的后果是一样的。
  //
  // **走 `codeLines()`，不走 `codeOf()`。** 我第一版走的是 `codeOf()`，而这道闸
  // 因此是空的：`codeOf()` 把字符串字面量的内容换成等长空白，`from 'phaser'`
  // 一变就只剩 `from '       '`，正则永远不命中。mutation 实测过——往
  // `src/render/day-phase.ts` 末尾加一句 `import Phaser from 'phaser'`，三条测试全绿。
  // 同一个坑 `test/purity.test.ts` 的时辰那一层踩过并记着（见 `source-scan.ts`
  // 的 `codeLines` 说明）。import 扫描只能裸读 + 剔注释行。
  const text = codeLines(`${SRC}/render/day-phase.ts`);
  assert.ok(
    !/from\s+['"][^'"]*phaser/i.test(text),
    'day-phase.ts 不许 import Phaser：node 下一 import 就 window is not defined',
  );
  // 反向也不许：时辰层 import 世界内核，就成了世界 → 时辰 → 世界的环。
  // （今天它 import 的是 `palette-data.ts` 的 `WORLD` 与 `types.ts` 的 `Weather`
  // 类型，两个都在 `src/world/` 下——但那是**世界提供数据给时辰**，方向是对的。
  // 这条断言禁的是世界那一边的运行时模块，不是这两个。）
  assert.ok(
    !/from\s+['"]\.\.\/world\/(simulation|setup|grid|save)/.test(text),
    'day-phase.ts 只吃世界的常量与类型，不 import 世界内核',
  );
});

test('快照里没有时辰字段：字段清单冻在测试里，不猜名字', () => {
  // 为什么不拿正则扫 `WorldSnapshot` 的接口定义：正则只能猜名字（`phase`？
  // `timeOfDay`？`hour`？），而猜名字的闸迟早撞上"其实叫 `light` 的那个字段"。
  // 直接把**今天的全部字段**列死，任何人加一个字段都得先改这个文件——
  // 而改的时候就会看见上面那段话，从而决定"这个字段是不是把时辰放进来了"。
  //
  // 取的是**跑出来的键**，不是接口定义：`Object.keys(sim.snapshot())`。
  // 接口里加一个可选字段而实现里没给，键不会出现——而渲染层读不到的字段
  // 本来也就不构成"时辰进了世界"。
  const raw = JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>;
  const world = buildWorld(parseBlueprintTable(raw));
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1_700_000_000_000,
  });
  const keys = Object.keys(sim.snapshot() as unknown as Record<string, unknown>);

  // 2026-10-27 实测，23 个字段。加字段 → 改这里；改这里 → 就会读到上面的说明。
  const EXPECTED: readonly string[] = [
    'now',
    'villager',
    'villagers',
    'buildings',
    'startupBuildingIds',
    'workstations',
    'constructions',
    'tasks',
    'pending',
    'props',
    'oracle',
    'critters',
    'fog',
    'roads',
    'trails',
    'altar',
    'events',
    'weather',
    'tide',
    'faith',
    'deliveries',
    'deliveriesByVillager',
    'feed',
  ];
  assert.deepEqual(
    [...keys].sort(),
    [...EXPECTED].sort(),
    '世界快照的字段清单变了。如果新字段与时辰有关，它违反 ADR_WORLD_ALIVE §2；\n' +
      '如果无关，把它加进 EXPECTED——但加的时候请先确认它确实与时辰无关。',
  );

  // 上面那条 deepEqual 已经够狠，这一条是给读的人的：明确说清"没有时辰字段"
  // 在今天的键上长什么样。留着一个显式的空结果，比让人去数 23 个键好。
  const phaseish = keys.filter((key) => /phase|timeOfDay|clock|dawn|noon|dusk|night/i.test(key));
  assert.deepEqual(phaseish, [], `快照里出现了像时辰的字段：${phaseish.join(', ')}`);
});
