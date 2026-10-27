import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { codeOf } from './source-scan.ts';

// 世界内核的三条纯度契约。
//
// 1. src/world 不许 import Phaser：这条让世界逻辑能离线跑单测，
//    也是换渲染后端（Pixi / Canvas2D）时不改逻辑的前提。
// 2. src/world 不认识上游的**快照词汇**：督办、commission、agent_id、
//    ready_to_report、blocked_question 这些是旧台账接口的字段名。世界现在只读
//    事件（task.opened / task.blocked / task.settled / task.cancelled），
//    上游改自己的表结构不该牵动世界。
// 3. 潮汐不读墙钟：同一个存档要回放出同一条曲线。
//
// 第二条曾经是「等事件日志存在之后才能落」的欠账。事件日志落地后它才成立：
// 现在 src/world 里剩下的 `'ledger'` 只是**存档格式的冻结字面量**（见下），
// 不是上游接口的词汇。
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const files = walk(SRC);

function worldFile(rel: string): string | undefined {
  return files.find((file) => file.slice(SRC.length + 1).split(path.sep).join('/') === rel);
}

test('src/world 不 import Phaser', () => {
  const offenders: string[] = [];
  for (const file of files) {
    const rel = file.slice(SRC.length + 1).split(path.sep).join('/');
    if (!rel.startsWith('world/')) continue;
    const text = readFileSync(file, 'utf8');
    if (/from ['"]phaser['"]/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `世界内核必须与渲染后端无关：\n${offenders.join('\n')}`);
});

/**
 * 上游快照词汇。
 *
 * 每一条都对应旧台账接口上的一个具体字段或状态值——世界一旦重新说出这些词，
 * 就说明有人把「读快照」那条路又接回来了。
 *
 * 唯一的例外是 `'ledger'` 这个**字符串字面量**：它冻结在存档 v1–v3 的样例与
 * 校验里（`TASK_SOURCES` / `SETTLED_SOURCES`），改它要升 schema。所以这里禁的是
 * 「把 ledger 当概念用」的那些词，不是这个值本身——下面单独钉住它只准出现在
 * 存档相关的位置。
 */
const SNAPSHOT_VOCAB = [
  'commissionId',
  'commissions',
  'agentName',
  'agent_id',
  'ready_to_report',
  'blocked_question',
  'step_idx',
];

test('src/world 不说上游快照的词汇', () => {
  const offenders: string[] = [];
  for (const file of files) {
    const rel = file.slice(SRC.length + 1).split(path.sep).join('/');
    if (!rel.startsWith('world/')) continue;
    // 注释里提一句「旧接口曾经叫 commissions」是解释历史，不算把词汇接回来；
    // 所以只看代码行。剔注释那一行在 `source-scan.ts`。
    const code = codeOf(file);
    const hits = SNAPSHOT_VOCAB.filter((word) => code.includes(word));
    if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `世界只认事件，不认上游的快照字段：\n${offenders.join('\n')}`,
  );
});

test("`'ledger'` 只作为存档格式的冻结值存在，不当概念用", () => {
  // 允许出现这个字面量的地方，就这几处；新增一处都必须先想清楚
  // 「这是存档兼容，还是又把台账语义接回来了」。
  const ALLOWED = new Set([
    'world/types.ts', // TaskSource / TaskRecord.ledgerCompletedAt 的定义与说明
    'world/save.ts', // SAVE_* 键集合与 TaskSource/SettledSource 校验
    'world/simulation.ts', // 内部按 source 分流 + 落盘时剥离运行时字段
  ]);
  const offenders: string[] = [];
  for (const file of files) {
    const rel = file.slice(SRC.length + 1).split(path.sep).join('/');
    if (!rel.startsWith('world/')) continue;
    if (ALLOWED.has(rel)) continue;
    if (readFileSync(file, 'utf8').includes('ledger')) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `这些文件不该再提到 ledger：\n${offenders.join('\n')}`);
});

test('世界的网络入口是封闭的一份清单', () => {
  // 旧世界自己 fetch 督办列表、自己开 WebSocket 收增量——传输细节漏进了逻辑层。
  // 现在只剩三扇门，各自只做一件事：
  //   - events-client.ts：读只增日志（任务从这条流里长出来），并把世界做过的事回写；
  //   - intent-client.ts：把一句话发给意图模型（神谕那条路，与任务无关）；
  //   - memory-client.ts：读记忆目录（票据 #7 的编年史）。只读，不写——
  //     写入走服务端，由「已经观测到的事」触发，不该由界面上的按钮触发。
  // 新增任何一扇门都必须先想清楚它是不是在重造已有的一扇。
  const ALLOWED = new Set([
    'world/events-client.ts',
    'world/feed.ts',
    'world/intent-client.ts',
    'world/memory-client.ts',
  ]);
  const offenders: string[] = [];
  for (const file of files) {
    const rel = file.slice(SRC.length + 1).split(path.sep).join('/');
    if (!rel.startsWith('world/')) continue;
    if (ALLOWED.has(rel)) continue;
    const code = codeOf(file);
    if (/\bfetch\s*\(|new WebSocket\s*\(/.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `世界的网络入口只该是这份清单：\n${offenders.join('\n')}`);
});

test('潮汐逻辑不读墙钟', () => {
  // 潮位必须是 now 的纯函数。一旦读了 Date.now / performance.now，
  // 「同一个存档回放出同一条曲线」就不成立了，而那正是确定性回放的基础。
  const tideFile = worldFile('world/tide.ts');
  assert.ok(tideFile !== undefined, '找不到 world/tide.ts');
  const text = readFileSync(tideFile, 'utf8');
  const banned = ['Date.now', 'performance.now', 'new Date('];
  const hits = banned.filter((pattern) => text.includes(pattern));
  assert.deepEqual(hits, [], `潮汐不许读墙钟：${hits.join(', ')}`);
});

/**
 * SPEC_V2 §4.6 的三个新状态位都不读墙钟、不调外部服务。
 *
 * 抵押、渡有仪式、污浊度都是**世界自有的事实**：它们改变谁接得到活、走哪条路、
 * 画面上叠不叠噪点。一旦其中任何一个去问「现在几点」，同一个存档就回放不出
 * 同一条曲线——那正是 v1 以来一切确定性测试的地基。
 *
 * 这条扫描按**文件**而不是按函数：三个状态位的声明和用法散落在 types / gate /
 * simulation / grid / save / faith 里，逐函数点名会漏掉新加的那一处。
 * 新开一个装 §4.6 状态的文件，就把它加进下面的 `OWNERS`。
 */
const OWNERS = [
  'world/types.ts', // 闭集词：NameState / CarryItem
  'world/gate.ts', // 渡有仪式的判定
  'world/simulation.ts', // 谁能接活、走哪条路
  'world/grid.ts', // 区域 requires 与寻路过滤
  'world/save.ts', // 三个位子的存档槽
  'world/faith.ts', // 里程碑道具的 grime / reveal
  'world/grime.ts', // 清洗即还原：grime 与 reveal 的纯函数
];

/**
 * 墙钟在世界里只有一个合法读者：`Simulation` 构造时收下的那个注入函数
 * （`deps.wallClock ?? (() => Date.now())`）。它的产出只喂
 * `settled.completedAt`，不喂任何世界判定。所以扫描要放过这一行，
 * 禁的是**别处**直接去问时钟。
 *
 * 按整行匹配而不是按 `Date.now` 排除：这一行要是被改坏了（比如有人把默认值
 * 挪去喂世界判定），它就不再等于这串字面量，扫描立刻咬住。
 */
const WALL_CLOCK_DEFAULT = 'deps.wallClock ?? (() => Date.now())';

test('§4.6 三个状态位不读墙钟、不调外部服务', () => {
  const banned = [
    'Date.now',
    'performance.now',
    'new Date(',
    'setTimeout',
    'setInterval',
    'fetch(',
    'new WebSocket(',
  ];
  const offenders: string[] = [];
  for (const rel of OWNERS) {
    const file = worldFile(rel);
    assert.ok(file !== undefined, `找不到 ${rel}`);
    const code = codeOf(file)
      .split('\n')
      .filter((line) => !line.includes(WALL_CLOCK_DEFAULT))
      .join('\n');
    const hits = banned.filter((pattern) => code.includes(pattern));
    if (hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], `三个状态位必须是世界内的纯事实：\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------- 时辰那一层
//
// `docs/adr/ADR_WORLD_ALIVE.md` §2 的规矩是「时辰只喂渲染层」。它成立靠三件事，
// 本文件只负责其中一件，另外两件在 `test/phase-purity.test.ts`：
//
//   1. **不 import 上来**（本文件这条）：`src/world/` 下没有一个 import 的
//      **解析落点**在 `src/world/` 之外。注意不是「零个 `../`」——开了子目录
//      （`world/memory/`、`world/creator/`）之后，`memory/perception.ts` 写
//      `from '../types.ts'` 是**世界内核依赖自己**，那是合法的，今天就真有。
//   2. **不抄一份**（`phase-purity.test.ts` 的词汇扫描）：把 `phaseAt` 复制粘贴到
//      `src/world/` 下，import 图一片干净，而世界照样知道「现在几点」。
//   3. **快照里不开字段**（`phase-purity.test.ts` 的字段清单）：不 import、不抄，
//      只在 `WorldSnapshot` 上加一个 `phase`，渲染层读快照就拿到了时辰。
//
// （这三条原来是 §6 的缺口 1——「时辰不进世界这条规矩今天没有闸」。
// 2026-10-27 补齐，缺口 1 已从 §6 移除。留着这段是因为分工写在这儿，
// 读的人不用去翻 ADR 就知道另外两件归谁。）
//
// 为什么不只禁一个文件名（`day-phase.ts`）：那只是今天被 ADR 点到的那一个。
// 真正要守的是**世界内核不依赖它上面的任何一层**（render / scenes / ui /
// settings / audio）。只禁一个文件名，明天换个入口（`phase-view.ts`、
// `ambience.ts`、或者一个新文件）照样进得来，而测试还绿着。
//
// 代价说清楚：这条断言禁的是**一切**落在 `src/world/` 之外的 import，包括上面
// 点名的 render / scenes / ui / settings / audio 五层，也包括 `main.ts`。
// 这五层没有一层是世界内核该依赖的——`settings` 尤其不是：它是**喂给世界的那
// 一份配置**，世界 import 它就成了"世界回头读自己的设定集"，而设定集是可以整
// 套换掉的（`selectSetting` 就是干这个的），世界一旦认它，换设定集就不再是
// 换一份输入。所以这里不写"将来可能合理的依赖"那种话：想豁免就得连理由一起
// 加，而理由得答得上"这一层凭什么不算在世界上面"。
//
// **判据是「解析后的落点」，不是「这一行有没有 `../`」。** 这条扫描原先只看
// 字面：`from '../` 一出现就算越界。那在 `src/world/` 平铺的时候成立，一旦
// 开了子目录（`world/memory/`）就错了——`memory/perception.ts` 里的
// `from '../types.ts'` 解析到 `world/types.ts`，那是世界内核**自己**，
// 而不是它上面的一层。照着字面判，等于禁掉世界内部的子目录，而那道闸
// 要守的是「不越过 `src/world/` 的边界」。所以这里把路径真的解析一遍，
// 再问落点还在不在 `src/world/` 里面。守的东西没变，判据跟上了目录结构。
//
// **这条扫描不走 `codeOf()`，同文件其他几条走。** 差别是有原因的，而且我第一笔
// 写错了：`codeOf()` 会把字符串字面量的内容换成等长空白（`source-scan.ts` 的
// `STRING_SPAN`，为的是挖掉注释里引用的旧词）。于是
// `from '../render/day-phase.ts'` 被换成 `from '                  '`——路径没了，
// 正则永远不命中。**第一版的这条闸因此是空的**：往 `src/world/` 里塞一个
// `import type { PhaseId } from '../render/day-phase.ts'`，七条测试照绿。
// （实测过：`weather.ts` 末尾挂上那行，`node --test test/purity.test.ts` 全过。）
//
// 词汇扫描要用 `codeOf`——注释里提一句「旧接口曾经叫 commissions」是解释历史。
// 但 import 扫描不能：`from '../...'` 本身**就是**依赖，不是关于依赖的话。
// 所以这里裸读，只自己剔掉注释行（`//`、块注释续行 `*`、块注释头 `/*`）。
// 同文件上面「src/world 不 import Phaser」那条也是裸读，理由相同。
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/**
 * import 语句里的模块说明符。四种写法都要抓：
 *
 * - `from '...'`——具名与默认 import 的尾巴；
 * - `import '...'`——裸 import（只为副作用）；
 * - `import('...')`——**动态 import**。这一条原先漏了，而它是最容易被
 *   绕过去的一种：`const m = await import('../../render/x.ts')` 在语法上
 *   跟 import 语句没有任何相似之处，但它是**同一件事**——那一刻世界就
 *   拿到了上一层的东西，而且是延迟到运行时才拿，静态检查更容易放过。
 * - `require('...')`——这个 ESM 工程里本来没有 `require`，要用得先
 *   `createRequire`，是故意的一步，不是排版器能无意造出来的。补它只是
 *   顺手，别当成跟折行同一个量级的洞。
 *
 * **带 `g`，而且扫的是接起来的整份代码。** 两处都是实测漏过才补的：
 *
 * 1. 不带的 `g` 的话，一行里两个 import 只看第一个。
 *    `import { a } from './types.ts'; import { b } from '../../render/day-phase.ts';`
 *    ——第一个合法、第二个越界，闸门一片绿（实测：闸门"看见"的说明符只有
 *    `./types.ts`）。
 * 2. 按行扫的话，`import(` 与它的参数字符串分居两行就整体消失：
 *    ```
 *    const m = import(
 *      '../../render/day-phase.ts'
 *    );
 *    ```
 *    而这个形状**排版器就能造出来**，没人需要故意那么写。
 *
 * 所以注释行是**删掉**而不是留空：留着空行一样能把上一行结尾的 `import(`
 * 和下一行的字符串接上，于是一段讲解"这里别写 `import(...)`"的块注释就会
 * 把闸门点红。删掉就没这条缝——代价是行号得自己记，见下面那条扫描。
 */
const IMPORT_SPECIFIER =
  /(?:from\s+|import\s*\(?\s*|require\s*\(?\s*)['"]([^'"]+)['"]/g;

const WORLD_DIR = join(SRC, 'world');

/**
 * 把「越界 import」一个一个找出来。抽成函数是为了能拿临时目录里的假树喂它——
 * 不然这条扫描只能对着真仓库跑，而真仓库今天是干净的，"出现了会被抓住"这一条
 * 就永远证明不了（一个永远返回空数组的函数也能让真仓库绿着）。
 *
 * `srcRoot` 也收参数，同理：判据是"解析后的落点在不在 `<srcRoot>/world/` 里"，
 * 写死仓库那一份就没法在别处复现。
 */
export function importOffenders(
  worldFiles: readonly string[],
  srcRoot: string,
): string[] {
  const worldDir = join(srcRoot, 'world');
  const offenders: string[] = [];
  for (const file of worldFiles) {
    const rel = file.slice(srcRoot.length + 1).split(path.sep).join('/');
    if (!rel.startsWith('world/')) continue;
    const raw = readFileSync(file, 'utf8').split('\n');
    // 注释行删掉，但**记下它原来是第几行**：报出去的行号得指向原文件。
    // 指向删过之后的副本，那个人就再也找不到那一行了——而这道闸的全部价值
    // 就在"红的时候说得清是哪一行"。
    const kept: { text: string; at: number }[] = [];
    raw.forEach((line, at) => {
      if (!COMMENT_LINE.test(line)) kept.push({ text: line, at });
    });
    const code = kept.map((entry) => entry.text).join('\n');
    for (const match of code.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined || !specifier.startsWith('.')) continue;
      // 解析后的落点还在 `<srcRoot>/world/` 里就算自己人。用 `resolve` 而不是
      // 字符串前缀比较：`world/../render/x.ts` 这种绕一圈的写法同样拦得住。
      const landed = path.resolve(path.dirname(file), specifier);
      if (landed === worldDir || landed.startsWith(worldDir + path.sep)) continue;
      const seen = code.slice(0, match.index ?? 0).split('\n').length;
      const at = kept[seen - 1]?.at ?? 0;
      offenders.push(`${rel}:${at + 1} 往上一层 import：${raw[at]?.trim() ?? specifier}`);
    }
  }
  return offenders;
}

test('src/world 不 import 它上面的任何一层（时辰进不来）', () => {
  const offenders = importOffenders(
    files.filter((file) => file.startsWith(WORLD_DIR + path.sep)),
    SRC,
  );
  assert.deepEqual(
    offenders,
    [],
    `世界内核只能依赖它自己。时辰（render/day-phase.ts）、氛围、界面都长在它上面，\n` +
      `一旦世界 import 上去，「现在几点」就成了第二个墙钟读者，确定性回放当场不成立。\n` +
      offenders.join('\n'),
  );
});

test('折行的动态 import 也拦得住，而且行号指向原文件', (t) => {
  // 这一条对着假树跑，因为真仓库里没有越界 import——不造假树就证明不了
  // "出现了会被抓住"，而证明不了这个，上面那条绿得毫无意义。
  //
  // 行号那一半是同一次改动新写的逻辑（注释行删掉之后自己数回去），
  // 它错了不会让任何一条现有用例红，只会让将来真红的人找不到那一行。
  const dir = mkdtempSync(join(tmpdir(), 'pwe-purity-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const src = join(dir, 'src');
  mkdirSync(join(src, 'world', 'memory'), { recursive: true });
  mkdirSync(join(src, 'render'), { recursive: true });
  writeFileSync(join(src, 'world', 'types.ts'), 'export type T = 1;\n', 'utf8');
  // 第 3 行才是越界那个。前面垫一行注释、一行合法 import，
  // 行号 mapping 错一位这里就看得出来。
  writeFileSync(
    join(src, 'world', 'memory', 'perception.ts'),
    [
      '// 世界自己的子目录，往上是自己人',
      "import type { T } from '../types.ts';",
      'const m = import(',
      "  '../../render/day-phase.ts'",
      ');',
      '',
    ].join('\n'),
    'utf8',
  );
  // 子目录里 `../types.ts` 解析到 `world/types.ts`，那是世界内核自己。
  writeFileSync(
    join(src, 'world', 'memory', 'ok.ts'),
    "import type { T } from '../types.ts';\n",
    'utf8',
  );
  // 注释里提一句越界路径不算：它是**关于**依赖的话，不是依赖。
  writeFileSync(
    join(src, 'world', 'talk.ts'),
    "// 别在这儿写 import('../../render/day-phase.ts')\nexport const a = 1;\n",
    'utf8',
  );

  const offenders = importOffenders(
    [
      join(src, 'world', 'types.ts'),
      join(src, 'world', 'memory', 'perception.ts'),
      join(src, 'world', 'memory', 'ok.ts'),
      join(src, 'world', 'talk.ts'),
    ],
    src,
  );
  assert.deepEqual(
    offenders,
    [`world/memory/perception.ts:3 往上一层 import：const m = import(`],
    // 「:3」是**上面那份假树的第 3 行**，不是仓库里 src/world/memory/perception.ts
    // 的第 3 行（那份第 3 行是文件头注释）。假树就在本函数上面 writeFileSync 出来，
    // 垫了一行注释、一行合法 import，行的 mapping 错一位这里就看得出来。写清楚是因为
    // 审计器与读的人都按真文件读它——那不是指针，是同一形状的巧合。
    '折行的动态 import 该被抓住，且行号得指向 import( 那一行',
  );
});

test('那条闸认得动态 import——`import()` 也是 import', () => {
  // 这条守的是闸门自己的正则。上面那条只证明「当前仓库里没有越界 import」，
  // 证明不了「出现了会被抓住」——一个永远返回空的正则也能让上面那条绿。
  //
  // 动态 import 是最容易被绕过的一种：`const m = await import('../../render/x.ts')`
  // 在语法上跟 import 语句没有任何相似之处，但它是**同一件事**。闸门的正则
  // 原先要求 `import` 后面跟空白，`import(` 就被漏掉了。
  const forms = [
    "import { phaseAt } from '../../render/day-phase.ts';",
    "import '../../render/day-phase.ts';",
    "const m = import('../../render/day-phase.ts');",
    "const m = await import( '../../render/day-phase.ts' );",
    "export { phaseAt } from '../../render/day-phase.ts';",
    "export * from '../../render/day-phase.ts';",
    "import type { PhaseId } from '../../render/day-phase.ts';",
    // 折行：`import(` 在第一行末尾，字符串在第二行。按行扫的版本整体看不见它。
    "const m = import(\n  '../../render/day-phase.ts'\n);",
    // 一行两个：第一个合法、第二个越界。只 exec 第一个的版本会放过第二个。
    "import { a } from './types.ts'; import { b } from '../../render/day-phase.ts';",
  ];
  for (const form of forms) {
    // 走 matchAll 而不是 exec：`IMPORT_SPECIFIER` 带 `g`，exec 会推它的
    // lastIndex，循环到第二个 form 就从半中间开始找——那种错要让用例
    // 时好时坏才看得出来，而时好时坏的用例等于没有。
    const found = [...form.matchAll(IMPORT_SPECIFIER)].map((m) => m[1]);
    assert.ok(
      found.includes('../../render/day-phase.ts'),
      `闸门漏了这种写法：${form}\n实际看见：${JSON.stringify(found)}`,
    );
  }
});
