/** `smoke-ego.mjs` 与 `smoke.mjs` 的对应关系：把文件头那句「对应关系靠标签正文」
 *  从散文变成闸。
 *
 * 为什么这条值得存在（2026-10-28，改文件头时量出来的）：
 * - `smoke-ego.mjs` 的 `S-L<n>` 标签原来是 `smoke.mjs` 的**行号**，
 *   `smoke.mjs` 一路长行之后几乎全漂，而没有任何闸门盯着它。
 * - 真正当得住的键是**标签正文**：绝大多数今天一字不差存在于 `smoke.mjs`
 *   的引号串里。少数几条对不上，来路是上游改了名/删了 check 而这里静悄悄
 *   留着旧话（如「离线模式在快照里标成离线 Mock」——今天的
 *   `smoke.mjs` 只剩「状态行标出上游离线、只剩本地活」），或从来只是分组名。
 * - 对得上的条数是一个**会被悄悄磨掉的数**：上游再改一个标签名，这里不响，
 *   读文件头的人还以为对应关系没动。所以冻在 `FROZEN_MATCHED`。与
 *   `audit-references.test.ts` 的 FROZEN 同一做法：红的时候人来核，
 *   核完改数并在提交说明里写下那一处为什么对不上——别放宽匹配本身。
 *   本文件正文不报「今天对上了多少条」——报的是这个常数与红起来的数，
 *   复算命令跑一遍就是当次真数（与 `prose-numbers.ts` 同一条规矩）。
 *
 * 判据的口径（两边都用「单行引号串」，不解析 `check(` 的跨行表达式——
 * 那是当初把「一一对应」量错的根源，别再犯）：
 * - `smoke-ego.mjs` 侧：`'S-L<n> <正文>'` 形式的断言标签，正则就是文件自己的约定。
 * - `smoke.mjs` 侧：所有 `'...'` 单行引号串的集合。标签在里面就算对上。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const EGO = readFileSync(new URL('../scripts/smoke-ego.mjs', import.meta.url), 'utf8');
const SMOKE = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8');

/** 今天对得上的标签数。2026-10-28 实测 95 / 109；见文件头注释。 */
const FROZEN_MATCHED = 95;

test('标签正文对得上 smoke.mjs 的不低于冻结数（上游改名会在这儿红）', () => {
  const egoLabels = [...EGO.matchAll(/'(S-L\d+)\s+([^']+)'/g)].map((m) => ({
    tag: m[1],
    text: m[2],
  }));
  assert.ok(egoLabels.length > 100, `只抽到 ${egoLabels.length} 个标签，正则与文件约定脱节了`);

  const smokeQuoted = new Set([...SMOKE.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]));
  const unmatched = egoLabels.filter((l) => !smokeQuoted.has(l.text));
  const matched = egoLabels.length - unmatched.length;

  assert.ok(
    matched >= FROZEN_MATCHED,
    `标签正文只对上 ${matched}/${egoLabels.length}，低于冻结的 ${FROZEN_MATCHED}。`
    + `\n多出来的对不上：\n${unmatched.map((u) => `  ${u.tag} 「${u.text}」`).join('\n')}`
    + `\n来路只有两种：上游把那个 check 改名/删了（本文件该跟着改或注明它没了），`
    + `或者这里新加断言时标签敲错了。人来核，核完改 FROZEN_MATCHED 并写下原因。`,
  );
});

test('SHOT_DIR 由本文件位置推出且自己保证存在（写死过一次，证据失踪过）', () => {
  // 原来写死 `D:/project/neurosama/tmp/wt-pixel-world/...`：那个 worktree 已不存在，
  // 跑一次的后果不是报错而是 11 张截图写到别处，本仓 eval/screens 里一张都没有。
  // 头注释里讲历史时还会提到那个旧路径——所以这里查的是**那一行赋值本身**。
  const decl = EGO.match(/^const SHOT_DIR = (.+);$/m);
  assert.ok(decl !== null, '找不到 `const SHOT_DIR = …;` 这一行，文件头的说法要跟着改');
  assert.match(
    decl[1],
    /^resolve\(import\.meta\.dirname, '\.\.', 'eval', 'screens'\)$/,
    'SHOT_DIR 必须由本文件位置推出，不许写死绝对路径',
  );
  assert.ok(
    /mkdirSync\(SHOT_DIR, \{ recursive: true \}\)/.test(EGO),
    '`shot()` 的注释写着「这里自己保证」——得真有 mkdirSync 撑着，不然那句又是假话',
  );
});
