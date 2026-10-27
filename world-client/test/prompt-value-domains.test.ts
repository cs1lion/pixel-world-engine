/**
 * 两份提示词写下的取值域，必须等于世界的真实取值域。
 *
 * ## 为什么要有这个文件
 *
 * 提示词里写着模型能说什么值：天气三档、神迹三种、凭证两样。这些值是**从代码里
 * 抄进提示词的**，而代码会变：
 *
 * - 世界加了一样凭证（`CARRY_ITEMS` 多一个 `key`），提示词仍写
 *   `["lamp"|"shoes"]`——模型永远不说 `key`，用户要的东西永远办不成。
 * - 天气加了一档，提示词仍写三档——模型把新档折进行最近的旧档。
 *
 * 两种都没有任何东西会红。`test/intent-prompt.test.ts` 第二条断言的是
 * `/"clear"\|"rain"\|"storm"/` 这个**字面串**：加第四档不会让这个子串消失，
 * 所以它照旧绿。它钉的是「那句话还在」，不是「那句话与世界一致」。
 *
 * 这一条补后面那半句：**从世界的类型与常量问，不手写清单**（与
 * `intent-prompt.test.ts` 第三条「从联合类型问，不手写清单」同一条纪律）。
 *
 * ## 天气那一档有三个手写副本，这里对着类型问
 *
 * 同一个天气取值域在仓库里被手写了三遍：`types.ts` 的 `Weather` 联合、
 * `intent-schema.ts` 的 `WEATHERS`（校验器用的那一份）、`save.ts` 的
 * `WEATHER_KINDS`（读档校验用的那一份）。加第四档要同时改四处，而
 * `WEATHER_LABEL` 是 `Record<Weather, …>` 所以只有那一处编译器会红——
 * 另外两处编译器一声不出，测试也一声不出。
 *
 * `weather-words.test.ts` 第三条写着「这条守的是加档」，实测**不守**：它那个
 * `states` 字面量与 `KINDS` 都是手写的，往联合里加第四档两者都不动，于是照旧绿。
 * 本文件对着 `types.ts` 的联合问，加档时它是会红的那个。
 *
 * 这里不去合并那三个副本——那是产品决定，而且 `WEATHERS` 与 `WEATHER_KINDS`
 * 各自被别处钉着。这一条只保证：**不管有几份副本，提示词说的是联合里那一份**。
 *
 * ## 两份提示词都查
 *
 * - `src/world/intent-prompt.ts`——离线推演那一侧。
 * - `server/oracle/prompt.py`——**线上**那一侧，模型真说的话由它决定。
 *
 * 两份的形状不同（这边是 `"weather"`，那边是 `"value"`），所以提取用的键各写各的，
 * 表在下面。线上那一侧更要紧，而它今天一道这类判据都没有。
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
const CARRIES = [...CARRY_ITEMS];

/**
 * 提示词里某个键后面写的引号选项表：`"a"|"b"` 或 `["a"|"b"]`。
 *
 * 一个键可能在提示词里出现多处（`carries` 与 `remove` 各写一遍），所以收**全部**，
 * 每一处都与真实取值域比——漏改任何一处都红。
 */
function alternatives(text: string, key: string): readonly (readonly string[])[] {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[?"([a-z|"]+)"`, 'g');
  return [...text.matchAll(pattern)].map((found) =>
    (found[1] ?? '').split('|').map((part) => part.replace(/"/g, '')),
  );
}

/**
 * 哪一份提示词、用哪个键提、与哪一份真实取值域比。
 *
 * `key` 是提取用的，不是提示词里唯一的标识——所以 `what` 那份话是说给人听的，
 * 报错要靠它知道红在哪儿。
 */
const DOMAINS: readonly {
  readonly where: string;
  readonly text: string;
  readonly key: string;
  readonly truth: readonly string[];
  readonly what: string;
}[] = [
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'weather', truth: WEATHERS, what: '天气' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'miracle', truth: MIRACLES, what: '神迹' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'carries', truth: CARRIES, what: '给出的凭证' },
  { where: '离线提示词', text: CLIENT_PROMPT, key: 'remove', truth: CARRIES, what: '收回的凭证' },
  // 线上那一侧的天气写在 `"value"` 上（`weather.set` 的 args），神迹写在 `"kind"` 上。
  { where: '线上提示词', text: SERVER_PROMPT, key: 'value', truth: WEATHERS, what: '天气' },
  { where: '线上提示词', text: SERVER_PROMPT, key: 'kind', truth: MIRACLES, what: '神迹' },
  { where: '线上提示词', text: SERVER_PROMPT, key: 'carries', truth: CARRIES, what: '给出的凭证' },
  { where: '线上提示词', text: SERVER_PROMPT, key: 'remove', truth: CARRIES, what: '收回的凭证' },
];

test('提示词写下的取值域与世界的真实取值域一模一样', () => {
  const expected = [...new Set(DOMAINS.map((d) => d.what))];
  assert.ok(expected.length > 0, 'DOMAINS 空了——这一条判据失去对象');

  for (const domain of DOMAINS) {
    const found = alternatives(domain.text, domain.key);
    assert.ok(
      found.length > 0,
      `${domain.where}里找不到 \`"${domain.key}"\` 后面的选项表了。它换了写法——`
        + '回来把正则与这张表一起改对，别把这条删掉。',
    );
    const truth = [...domain.truth].sort();
    for (const stated of found) {
      assert.deepEqual(
        [...stated].sort(),
        truth,
        `${domain.where}的${domain.what}取值域写的是 [${stated.join(' | ')}]，`
          + `而世界实际是 [${domain.truth.join(' | ')}]。`
          + '少一样，模型永远不说它，用户要的那个效果永远办不成；'
          + '多一样，模型会说出一个被校验器拒的值。两边都该回来改提示词。',
      );
    }
  }
});
