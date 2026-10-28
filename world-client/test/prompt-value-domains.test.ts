/**
 * 两份提示词写下的取值域，必须等于世界的真实取值域。
 *
 * ## 为什么要有这个文件
 *
 * 提示词里写着模型能说什么值：天气三档、神迹三种、凭证两样、意图十种。
 * 这些值是**从代码里抄进提示词的**，而代码会变：
 *
 * - 世界加了一样凭证（`CARRY_ITEMS` 多一个 `key`），提示词仍写
 *   `["lamp"|"shoes"]`——模型永远不说 `key`，用户要的东西永远办不成。
 * - 天气加了一档，提示词仍写三档——模型把新档折进行最近的旧档。
 *
 * 第一版这里写「两种都没有任何东西会红」——**那句话是假的**，复审实测：
 * 往 `types.ts` 的 `Weather` 联合里加 `'snow'`，`tsc` 当场报 **4 处** TS2741
 * （`simulation.ts:103` 的 `WEATHER_ALREADY`、`src/world/weather.ts:36` 的
 * `TARGET_INTENSITY`、`src/world/weather.ts:42` 的 `DURATION_MS`、
 * `src/world/weather.ts:118` 的
 * `WEATHER_LABEL`）。本文件自己也是会红的那一个。
 *
 * 而 `test/intent-prompt.test.ts` 第二条断言的是 `/"clear"\|"rain"\|"storm"/`
 * 这个**字面串**：加第四档不会让这个子串消失，所以它照旧绿。它钉的是
 * 「那句话还在」，不是「那句话与世界一致」——这一条补后面那半句：
 * **从世界的类型与常量问，不手写清单**（与 `intent-prompt.test.ts` 第三条
 * 「从联合类型问，不手写清单」同一条纪律）。
 *
 * ## 天气那一档有三个手写副本，这里对着类型问
 *
 * 同一个天气取值域在仓库里被手写了三遍：`types.ts` 的 `Weather` 联合、
 * `intent-schema.ts` 的 `WEATHERS`（校验器用的那一份）、`save.ts` 的
 * `WEATHER_KINDS`（读档校验用的那一份）。
 *
 * 第一版这里写「加第四档要同时改四处，而 `WEATHER_LABEL` 是
 * `Record<Weather, …>` 所以只有那一处编译器会红」——**后半句是假的**，
 * 实测是四处编译器都会红（上面那四个）。原话把「我数出来的那一处」当成了
 * 「唯一那一处」，而它只是最容易被想到的一处。
 *
 * 这里不去合并那三个副本——那是产品决定，而且 `WEATHERS` 与 `WEATHER_KINDS`
 * 各自被别处钉着。这一条只保证：**不管有几份副本，提示词说的是联合里那一份**。
 *
 * `weather-words.test.ts` 第三条写着「这条守的是加档」，实测**不守**：它那个
 * `states` 字面量与 `KINDS` 都是手写的，往联合里加第四档两者都不动，于是照旧绿。
 * 本文件对着 `types.ts` 的联合问，加档时它是会红的那个。
 *
 * ## 两份提示词都查
 *
 * - `src/world/intent-prompt.ts`——离线推演那一侧。
 * - `server/oracle/prompt.py`——**线上**那一侧，模型真说的话由它决定。
 *
 * 两份的形状不同（这边是 `"weather"`，那边是 `"value"`），所以提取用的键各写各的，
 * 表在下面。线上那一侧更要紧，而它今天一道这类判据都没有。
 *
 * ## 「哪个键算一个取值域」也是从提示词问的，不手写
 *
 * 第一版的 `DOMAINS` 是手写的表，而**提示词里新出现一个取值域形状的键，
 * 没有任何东西会响**。复审实测：往 `intent-prompt.ts` 里插一行
 * `{"kind":"dialTide","tide":"low"|"high"}`，十三条判据全绿——而那个 `tide`
 * 域从此没人对。本文件的头一条纪律是「从世界的类型与常量问，不手写清单」，
 * 于是「查哪些域」这件事本身也不能手写。
 *
 * 所以下面有一条「没登记的取值域」判据：它扫出两份提示词里**所有**
 * 取值域形状的键，逐个问「在 `DOMAINS` 里吗」。红的时候点名是哪个键，
 * 以及它该与哪份真实取值域比。
 *
 * 顺带它当天就抓出一处真的缺口：离线提示词的 `"kind"` 写着十种意图，
 * 而第一版的表里**没有它**。现在补上了，对着 `intent-schema.ts` 的
 * `IntentKind` 联合问——实测今天十种一个不差（含 `unknown`）。
 * 注意这个键的形状与别的不一样：它在提示词里**摊成 11 处单值**
 * （`carry` 写了两遍），没有哪一处是全集，所以比的是并集。见 `DOMAINS` 的 `mode`。
 *
 * ## 这一条**不**查什么
 *
 * - **不查那句话说得对不对。** 「晴 / 放晴 / 雨停 → clear」这批同义词归得准不准，
 *   这条管不着——语义只有人能核。它只问「提了哪些值」。
 * - **不查 `DOMAINS` 之外的东西。** 一个键要不是取值域形状（不带引号选项表），
 *   这条看不见它——那是形状判据的天花板，不是漏改。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CARRY_ITEMS } from '../src/world/gate.ts';

/** 从一个 TypeScript 源文件里读出一个字符串联合类型的成员。 */
function unionOf(relPath: string, name: string): readonly string[] {
  const source = readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');
  const union = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(source);
  assert.ok(union !== null, `${relPath} 里找不到 \`export type ${name}\` 了——这一条判据失去对象`);
  const members = [...(union[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((found) => found[1] ?? '');
  assert.ok(members.length > 0, `${relPath} 的 ${name} 联合里数不出成员了——判据失去对象`);
  return members;
}

const CLIENT_PROMPT = readFileSync(new URL('../src/world/intent-prompt.ts', import.meta.url), 'utf8');
const SERVER_SOURCE = readFileSync(new URL('../../server/oracle/prompt.py', import.meta.url), 'utf8');

/**
 * 线上那一侧只认 `COMMAND_LINES` 那一段——**不扫整个 `prompt.py`**。
 *
 * 第一版扫的是整个文件，当场红在自己的假阳性上：`prompt.py` 第 113 行有一个
 * **示范响应**，里面写着 `"value": "rain"`。那是一个具体例子，不是取值域声明，
 * 可正则分不出两者的区别，于是「取值域只有 rain」——天天红。红成噪声之后就
 * 没人看它了，所以把范围收窄到声明处。
 *
 * 这与 `server/tests/test_prompt_whitelist_agreement.py` 第三条是同一条纪律：
 * 那句「N 条命令」也只读 `COMMAND_LINES =` 上面那段注释，因为提示词正文里
 * 另有一句「一次最多一条命令」说的是另一件事。
 *
 * 锚失手时会红，那是对的：`COMMAND_LINES` 改名或换引号，说明这份提示词
 * 重新组织过，该有人回来看一眼这条判据还对不对。
 */
const SERVER_PROMPT = (() => {
  const block = /COMMAND_LINES\s*=\s*"""([\s\S]*?)"""/.exec(SERVER_SOURCE);
  assert.ok(
    block !== null,
    'server/oracle/prompt.py 里找不到 `COMMAND_LINES = """…"""` 了。这一条判据的线上'
      + '那一半失去对象——提示词重新组织过的话，回来把锚点一起改对，别把这条删掉。',
  );
  assert.ok(block[1]!.includes('weather.set'), 'COMMAND_LINES 里没有天气命令了——取值域锚点失效');
  return block[1]!;
})();

const WEATHERS = unionOf('src/world/types.ts', 'Weather');
const MIRACLES = unionOf('src/world/oracle-miracle.ts', 'MiracleKind');
const INTENT_KINDS = unionOf('src/world/intent-schema.ts', 'IntentKind');

// `CARRY_ITEMS` 不是联合类型而是常量数组，所以先确认它真是数组再展开。
// 第一版直接 `[...CARRY_ITEMS]`：复审实测把它换成 `Record` 之后，模块加载时
// 抛 `TypeError: CARRY_ITEMS is not iterable`，整个文件带着一堆栈死掉，
// 而本文件精心写的每一句「判据失去对象」一个字都没送到。先问形状再问值。
assert.ok(
  Array.isArray(CARRY_ITEMS),
  '`src/world/gate.ts` 的 CARRY_ITEMS 不是数组了——这一条判据的凭证那一半失去对象。'
    + '它换了形状（对象？Map？），回来把这里改成对应的读法，别把这条删掉。',
);
const CARRIES = [...CARRY_ITEMS];

/**
 * 提示词里某个键后面写的引号选项表：`"a"|"b"` 或 `["a"|"b"]`。
 *
 * **每个选项必须各自带引号。** 第一版写的是 `"([a-z|"]+)"`——一个捕获组吃下
 * 整串，再 `split('|')`。那个判据对一种写法永远失明：把
 * `"clear"|"rain"|"storm"` 改成 `"clear|rain|storm"`（整体一个引号），
 * 捕获到的还是 `clear|rain|storm`，切开还是三个值，**十三条判据全绿**。
 * 而那句话从此点名的是一个名叫 `clear|rain|storm` 的值，没有校验器收它。
 * 复审实测过，所以捕获组收紧成 `(?:"x"\|?)+`——整体一个引号的写法再也进不来，
 * 于是下面「找不到选项表」会红，而不是安静地放它过去。
 *
 * 一个键可能在提示词里出现多处，所以收**全部**，每一处都与真实取值域比——
 * 漏改任何一处都红。今天最极端的是离线提示词的 `"kind"`：**11 处**。
 * （第一版的 docstring 举的例子是「`carries` 与 `remove` 各写一遍」，
 * 实测那两个键今天各只出现 1 次——那个例子是假的，真例子是 `kind`。）
 */
function alternatives(text: string, key: string): readonly (readonly string[])[] {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[?((?:"[a-zA-Z0-9_]+"\\|?)+)`, 'g');
  return [...text.matchAll(pattern)].map((found) =>
    (found[1] ?? '').split('|').map((part) => part.replace(/"/g, '')),
  );
}

/**
 * 报错用的**宽松**提取：不问形状，只说提示词那一处到底写了什么。
 *
 * 为什么要有它：第一版的失败信息直接用 `alternatives()` 的结果。
 * 复审实测把 `"clear" | "rain" | "storm"`（管道两侧加空格）之后，
 * 报出来的是「取值域写的是 [clear]，而世界实际是 [clear | rain | storm]」——
 * **那句话少报了两个值**，因为捕获组 `[a-z|"]+` 不吃空格，`rain` 与 `storm`
 * 被静默丢掉。提示词是对的、闸门红了、而红的消息比真相少一半。
 * 在这个仓库里失败消息是最容易被下一段话引用的东西，所以它不能比真相少。
 */
function statedLoosely(text: string, key: string): string {
  const pattern = new RegExp(`"${key}"\\s*:\\s*([^,}\\n]{0,120})`);
  const hit = pattern.exec(text);
  return hit ? hit[1]!.trim() : '(提不出来)';
}

/**
 * 哪一份提示词、用哪个键提、与哪份真实取值域比。
 *
 * `key` 是提取用的，不是提示词里唯一的标识——所以 `what` 那份话是说给人听的，
 * 报错要靠它知道红在哪儿。
 *
 * `mode` 说这个域的**形状**，两种都真实存在，混在一起就会误判：
 *
 * - `each`——取值域在提示词里写成**一处 alternation**（`"clear"|"rain"|"storm"`），
 *   一个键可能写好几处，每一处都得等于全集。天气、神迹、凭证都是这种。
 * - `union`——取值域**摊成许多处单值**（`"kind":"build"` … `"kind":"unknown"`），
 *   没有哪一处是全集，全集只存在于「全部出现处的并集」里。离线提示词的
 *   意图种类是这种：11 处、10 个不同的值（`carry` 写了两遍）。
 *
 * 第一版只有 `each`，于是把 `kind` 按 `each` 比，报的是
 * 「意图种类取值域写的是 [dispatch]，而世界实际是 [十种]」——那句话是假的：
 * 提示词没说取值域只有 `dispatch`，它把十种摊在十一个地方各说了一遍。
 * 一个形状判据用错了对象，报出来的话比不报更糟。
 */
const DOMAINS: readonly {
  readonly where: string;
  readonly text: string;
  readonly key: string;
  readonly truth: readonly string[];
  readonly what: string;
  readonly mode: 'each' | 'union';
}[] = [
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'weather', truth: WEATHERS, what: '天气', mode: 'each' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'miracle', truth: MIRACLES, what: '神迹', mode: 'each' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'kind', truth: INTENT_KINDS, what: '意图种类', mode: 'union' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'carries', truth: CARRIES, what: '给出的凭证', mode: 'each' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'remove', truth: CARRIES, what: '收回的凭证', mode: 'each' },
  // 线上那一侧的天气写在 `"value"` 上（`weather.set` 的 args），神迹写在 `"kind"` 上。
  { where: '线上提示词', text: SERVER_PROMPT, key: 'value', truth: WEATHERS, what: '天气', mode: 'each' },
  { where: '线上提示词', text: SERVER_PROMPT, key: 'kind', truth: MIRACLES, what: '神迹', mode: 'each' },
  { where: '线上提示词', text: SERVER_PROMPT, key: 'carries', truth: CARRIES, what: '给出的凭证', mode: 'each' },
  { where: '线上提示词', text: SERVER_PROMPT, key: 'remove', truth: CARRIES, what: '收回的凭证', mode: 'each' },
];

test('提示词写下的取值域与世界的真实取值域一模一样', () => {
  const expected = [...new Set(DOMAINS.map((d) => d.what))];
  assert.ok(expected.length > 0, 'DOMAINS 空了——这一条判据失去对象');

  for (const domain of DOMAINS) {
    const found = alternatives(domain.text, domain.key);
    assert.ok(
      found.length > 0,
      `${domain.where}里找不到 \`"${domain.key}"\` 后面的选项表了。它换了写法——`
        + `那一处现在写的是 ${statedLoosely(domain.text, domain.key)}。`
        + '回来把正则与这张表一起改对，别把这条删掉。',
    );
    const truth = [...domain.truth].sort();

    if (domain.mode === 'union') {
      // 摊成多处单值的域：比的是并集，不是任何单独一处。
      const union = [...new Set(found.flat())].sort();
      assert.deepEqual(
        union,
        truth,
        `${domain.where}的${domain.what}取值域，把 ${found.length} 处单值并起来是`
          + ` [${union.join(' | ')}]，而世界实际是 [${domain.truth.join(' | ')}]。`
          + '少一种，模型永远说不出它；多一种，模型会说出一个被校验器拒的值。'
          + '（这个键在提示词里摊成多处单值，没有哪一处是全集——所以比并集。）',
      );
      continue;
    }

    for (const stated of found) {
      assert.deepEqual(
        [...stated].sort(),
        truth,
        `${domain.where}的${domain.what}取值域写的是 [${stated.join(' | ')}]，`
          + `而世界实际是 [${domain.truth.join(' | ')}]。`
          + '少一样，模型永远不说它，用户要的那个效果永远办不成；'
          + '多一样，模型会说出一个被校验器拒的值。两边都该回来改提示词。'
          + `（那一处的原文：${statedLoosely(domain.text, domain.key)}——若这里只列了一部分，`
          + '是提取正则漏了，回来改它，别照着一半的清单去改提示词。）',
      );
    }
  }
});

/**
 * 提示词里**每一个**取值域形状的键，都必须在 `DOMAINS` 里登记过。
 *
 * ## 为什么要有这一条
 *
 * 上面那条比的是「登记过的域对不对」。这一条问的是另一件事：
 * **没登记的域**。`DOMAINS` 是手写的表，而提示词随时会长出新键——
 * 长出来的那一刻，上面那条一条都不会响，因为它只在自己那张表里转。
 *
 * 复审实测：往 `intent-prompt.ts` 插一行 `{"kind":"dialTide","tide":"low"|"high"}`，
 * 十三条判据全绿。那个 `tide` 域从此没有任何东西对过——正是本文件的头一条
 * 纪律说要治的那种病，只是病在「查哪些」这一层，不在「查得准不准」那一层。
 *
 * ## 判据是形状，所以它自己也可能漏
 *
 * 「取值域形状」= `"键":` 后面跟着**各自带引号**的选项 alternation。
 * 这个形状判据漏掉的写法（不带引号的 `"value":0..1`、单个值
 * `"value": "rain"`、整体一个引号的 `"clear|rain|storm"`）都不算域——
 * 前两种本来就不是域，第三种由上面那条「找不到选项表」红着。
 * 所以形状这一层漏了不要紧：真正的域换了写法，上面那条会红。
 *
 * 今天量出来：离线 5 个键（`carries`/`kind`/`miracle`/`remove`/`weather`），
 * 线上 4 个（`carries`/`kind`/`remove`/`value`），**全部已登记**。
 */
test('提示词里每个取值域形状的键都登记在案', () => {
  const SHAPE = /"([A-Za-z_]\w*)"\s*:\s*\[?((?:"[a-zA-Z0-9_]+"\|?)+)/g;

  for (const where of ['离线提示词', '线上提示词'] as const) {
    const text = where === '离线提示词' ? CLIENT_PROMPT : SERVER_PROMPT;
    const registered = new Set(DOMAINS.filter((d) => d.where === where).map((d) => d.key));

    const shaped = new Set<string>();
    for (const hit of text.matchAll(SHAPE)) shaped.add(hit[1] ?? '');
    assert.ok(shaped.size > 0, `${where}里一个取值域形状的键都扫不到——判据失去对象`);

    const unregistered = [...shaped].filter((key) => !registered.has(key)).sort();
    assert.deepEqual(
      unregistered,
      [],
      `${where}里这些键写着取值域形状的选项表，却没有登记进本文件的 DOMAINS：`
        + `${unregistered.join('、')}。从此没有任何东西对过它们——而提示词点名让模型`
        + '说的值，模型就会说。两种处置：往 DOMAINS 加一行，写清它与哪份真实取值域比；'
        + '或者确认这个键其实不是取值域（那也该回来把判据的形状说清，别把它悄悄漏掉）。',
    );

    // 反方向：登记了的键今天还提得出选项表吗？提不出说明键改了名，
    // 上面那条会红，这里补一句说明红在哪儿。
    for (const key of registered) {
      assert.ok(
        alternatives(text, key).length > 0,
        `${where}登记了 "${key}"，可现在提不出它的选项表——键大概改了名。`
          + '上面那条会先红；两条一起看，别只改一条。',
      );
    }
  }
});
