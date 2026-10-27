/**
 * 「一天有多长」这句**散文**，必须与代码里的 `DAY_MS` 一致。
 *
 * ## 为什么要有这个文件
 *
 * `test/memory-day.test.ts` 已经钉住了三处**代码常量**：客户端两份、服务端一份，
 * 全都得等于 24 小时。改 `DAY_MS` 会响——那条测试里 `ONE_DAY` 是个写死的字面量。
 *
 * 可同一个长度还在两处**散文**里又写了一遍：
 *
 * - `GLOSSARY.md`：「记忆按天归档的单位，一天是 24 个世界小时。」
 * - `docs/adr/ADR_MEMORY.md`：「一天 = 24 个世界小时」
 *
 * 这两句没有任何东西量。于是漂的方向只剩一种，而它恰好是代码那条拦不住的：
 * **代码没动，话被改错了**。谁把词典那句改成「12 个世界小时」——手滑、复制粘贴、
 * 或者从某份外部设计资料里抄了个 `day_length_seconds = 900` 进来——代码照旧绿，
 * 而「读那一份就够」的词典从此指向一个错的世界。
 *
 * `docs/iterations/README.md` 已经承认这个缺口，原话是「散文那两处没有闸，
 * 所以这一条本身也会漂——要复核就重新数一遍，别信这张表」。这个文件就是那道闸。
 * 别信那张表，也别信这个文件——两个都只是把「今天量出来是多少」钉住，
 * 好让明天改了的时候有东西会响。
 *
 * ## 今天量出来（2026-10-28）
 *
 * 五处说同一个长度，两处代码两份散文——不，**三处代码两份散文**：
 *
 * | 位置 | 形状 | 今天 | 谁守着 |
 * |---|---|---|---|
 * | `src/world/memory/config.ts` `DAY_MS` | 代码常量 | 24h | `memory-day.test.ts` |
 * | `src/world/lampoil.ts` `LAMP_DAY_MS` | 代码常量 | 24h | `memory-day.test.ts` |
 * | `server/memory/snapshot.py` `DAY_MS` | 代码常量 | 24h | `memory-day.test.ts` |
 * | `GLOSSARY.md` | 散文 | 24 | **本文件** |
 * | `docs/adr/ADR_MEMORY.md` | 散文 | 24 | **本文件** |
 *
 * 服务端那份本文件不重复读——`memory-day.test.ts` 已经读了一遍，再读一遍只是
 * 把同一段解析抄两遍，而抄的那份会先烂。本文件只补它没管的那两处散文。
 *
 * ## 判据：散文里那个数与 `DAY_MS` 换算出来的小时数相等
 *
 * 散文两种写法都认（`一天是 24 个世界小时` / `一天 = 24 个世界小时`），
 * 中间那个「是」或「=」可有可无，数字前后允许空格。今天两份文档各命中 1 处，
 * 全文含「世界小时」的行也各只有 1 行——**没有第二处会被误抓**（量过）。
 *
 * 反过来说：这条判据只认「一天 N 个世界小时」这一种句式。散文改成
 * 「一个世界日合 24 小时」它就抓不到，于是下面「找不到」会红。
 * 那正是要人回来重新指路的意思，**不是**去把新句式悄悄加进来而不看它——
 * 加一种句式就等于承认这个长度可以换一种说法，而换说法的时候最容易改错数。
 *
 * ## 这一条**不**查什么
 *
 * - **不查那句话说得对不对。** 「记忆按天归档的单位」是不是真的按天归档，
 *   这条管不着——语义只有人能核。
 * - **不查 `DAY_MS` 本身该是几小时。** 它只问散文与代码是否一致。真要改成
 *   12 小时制，代码、散文、`docs/SPEC_V2.md` 一起改，这条会一路护航。
 * - **不查别处出现的 `86400000`。** 样例载荷、测试数据里也有这个数，
 *   那些不定义一天有多长（`docs/iterations/README.md` 记了这条分界）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAY_MS } from '../src/world/memory/config.ts';

/** 散文里的「一天 N 个世界小时」。`是`/`=` 可有可无，数字前后容忍空格。 */
const DAY_IN_PROSE = /一天\s*[是为=＝]?\s*(\d+)\s*个世界小时/g;

/**
 * 两份散文在哪儿、以及那句话负责什么——红的时候要能说出是哪一份漂了。
 *
 * 键是仓库根相对路径。`docs/iterations/README.md` 那张表点名了这两处，
 * 所以它们不是「顺带找到的」，是被点过名的。
 */
const PROSE: Readonly<Record<string, string>> = {
  'GLOSSARY.md': '词典那条——「读那一份就够」的那一份',
  'docs/adr/ADR_MEMORY.md': '定了「一天 = 24 个世界小时」的那份 ADR',
};

test('散文里那个小时数与代码里的 DAY_MS 对得上', () => {
  const expected = DAY_MS / (60 * 60 * 1000);
  assert.ok(
    Number.isInteger(expected),
    `DAY_MS 换算不出整数小时（${DAY_MS}ms）——这条判据只按「小时」比，`
      + '非整数说明一天的长度换了单位，回来把判据一起改对，别把这条删掉。',
  );

  const drift: string[] = [];
  for (const [rel, what] of Object.entries(PROSE)) {
    const text = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
    const found = [...text.matchAll(DAY_IN_PROSE)].map((hit) => Number(hit[1]));

    assert.ok(
      found.length > 0,
      `${rel} 里找不到「一天 N 个世界小时」这句话了（${what}）。`
        + '这句话没了，这条判据就失去对象。两种可能：句子被改写了，或者这个长度'
        + '换了说法。两种都该回来看——回来把 DAY_IN_PROSE 改对，别把这条删掉。'
        + '（`docs/iterations/README.md` 点名过这两处散文，少了任何一处都该知道。）',
    );

    for (const hours of found) {
      if (hours !== expected) {
        drift.push(`${rel} 写 ${hours} 个世界小时，而 DAY_MS 是 ${expected} 小时`);
      }
    }
  }

  assert.deepEqual(
    drift,
    [],
    `散文与代码对「一天有多长」说法不一致：${drift.join('；')}。`
      + '代码那三处由 memory-day.test.ts 守着，改 DAY_MS 它会先红；这一条红说明'
      + '**代码没动而话被改错了**。两种处置：把散文改回与代码一致，或者（如果新的'
      + '长度是刻意定的）连 DAY_MS 一起改——那 memory-day.test.ts 会拦，'
      + 'docs/SPEC_V2.md 与 docs/iterations/README.md 也得跟着改。',
  );
});
