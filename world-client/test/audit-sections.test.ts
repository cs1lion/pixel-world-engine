import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditSections } from '../scripts/audit-sections.ts';

/**
 * 节号存在性闸门的行为锁。
 *
 * 这个闸门在真仓库上报 0 处——那正是最该被锁的一种状态：一个永远返回空的
 * 闸门与一个干活的闸门，输出一模一样。所以下面一半的用例是**变异测试**：
 * 把错的节号塞进去，问它认不认。不认的就是死闸门。
 *
 * 另一件必须锁的是**误报**：第一版按「整行点名的路径」判，实测 68 处里几乎
 * 全是冤的（一行列着三四份文件时分不清 §N 挂在谁身上；整句引用别处文件头
 * 原文时，路径全是句子的主语）。改成正前方的 token 紧贴 `§` 才判之后才归零。
 * 「引用别处原文」那一形（`ADR_PALETTE_24.md:10` 的真身）单独留一条用例。
 *
 * `§` 一律用 `String.fromCharCode(167)` 拼，不写字面量：本文件在
 * `world-client/test/` 底下，而那儿正是闸门的扫描根，写字面量会让
 * 「真仓库是干净的」那条用例报自己。
 */
const S = String.fromCharCode(167);

const SPEC = ['# SPEC', '## 1. 问题', '### 4.8 可扩展性', '## 5. 测试决策', ''].join('\n');
const SPEC_V2 = ['# SPEC_V2', '### 4.6 三个状态位', '## 8. 未决', ''].join('\n');
// ADR_SAVE 用 `## §1.3 标题` 这种带 § 的标题形状，与 SPEC 系的 `## 1.3` 不同。
const ADR_SAVE = ['# ADR_SAVE', '## ' + S + '1 存档', '## ' + S + '1.3 校验分两层', ''].join('\n');

/** 造一座临时仓库：committed 列哪些文件，notes.md 放待扫的正文。 */
function fixture(notes: readonly string[]): {
  root: string;
  files: string[];
  scan: string[];
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-sec-'));
  mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'SPEC.md'), SPEC, 'utf8');
  writeFileSync(path.join(root, 'docs', 'SPEC_V2.md'), SPEC_V2, 'utf8');
  writeFileSync(path.join(root, 'docs', 'adr', 'ADR_SAVE.md'), ADR_SAVE, 'utf8');
  writeFileSync(path.join(root, 'docs', 'notes.md'), notes.join('\n'), 'utf8');
  return {
    root,
    files: ['docs/SPEC.md', 'docs/SPEC_V2.md', 'docs/adr/ADR_SAVE.md', 'docs/notes.md'],
    scan: [path.join(root, 'docs', 'notes.md')],
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function run(notes: readonly string[]): { tokens: string[]; skips: Map<string, number>; checked: number } {
  const f = fixture(notes);
  try {
    const r = auditSections({ root: f.root, files: f.files, scan: f.scan });
    return {
      tokens: r.findings.map((x) => `${x.doc} ${x.token}@${x.line}`),
      skips: new Map(r.skips),
      checked: r.checked,
    };
  } finally {
    f.cleanup();
  }
}

const BARE = '没点名文档（裸 §N，前面没有一个紧贴的文档 token）';
const NO_ALIAS = '别名在已提交文档里没有对应文件（要人判，不报缺陷）';
const NO_PATH = '点名的路径不在已提交文件里（要人判，不报缺陷）';

/**
 * 期望值也拼，不写字面量：一行「某份文档 + 一个不存在的节号」的断言，
 * **本身就是一处那种引用**，真仓库那条用例会报自己。第一版正是这么翻的车——
 * 闸门在本文件报了两处，两处都是断言里的期望值。那不是误报，是这条用例
 * 自己没守它要守的规矩。所以连说明这段也不写字面量。
 */
const at = (doc: string, sec: string, line: number): string => `${doc} ${S}${sec}@${line}`;

test('节号不存在就报——路径与别名两种形状都报', () => {
  const r = run([
    `依据 \`docs/SPEC.md\` ${S}4.8 写的，对。`,
    `依据 \`docs/SPEC.md\` ${S}99 写的，错。`,
    `依据 \`SPEC_V2\` ${S}4.6 写的，对。`,
    `依据 \`SPEC_V2\` ${S}99 写的，错。`,
  ]);
  assert.deepEqual(r.tokens, [at('docs/SPEC.md', '99', 2), at('docs/SPEC_V2.md', '99', 4)]);
  assert.equal(r.checked, 4);
});

test('带 § 的标题形状也认（ADR_SAVE 的 `## §1.3`）', () => {
  const r = run([
    `\`docs/adr/ADR_SAVE.md\` ${S}1.3 校验分两层，对。`,
    `\`docs/adr/ADR_SAVE.md\` ${S}9 没有这一节，错。`,
  ]);
  assert.deepEqual(r.tokens, [at('docs/adr/ADR_SAVE.md', '9', 2)]);
});

test('整句引用别处原文时不冤——那是第一版 68 处误报的真身', () => {
  // `ADR_PALETTE_24.md:10` 的形状：路径是句子的主语，§N 属于引号里那份不在仓的文档。
  const r = run([
    '`docs/SPEC.md` 的文件头写着「依据 `ART_SPEC` ' + S + '5.3」；`docs/SPEC_V2.md` 也写着。',
  ]);
  assert.deepEqual(r.tokens, []);
  assert.equal(r.skips.get(NO_ALIAS), 1);
  assert.equal(r.checked, 0);
});

test('一行列了多份文件时不冤——§N 挂在谁身上分不清', () => {
  const r = run(['三份 `docs/SPEC.md`、`docs/SPEC_V2.md`、`docs/adr/ADR_SAVE.md` 合起来说 ' + S + '99。']);
  assert.deepEqual(r.tokens, []);
  assert.equal(r.skips.get(BARE), 1);
});

test('三种形状一律不报，且都计进跳过数', () => {
  const r = run([
    `裸引用的 ${S}99 前面没有文档。`,
    `依据 \`ART_SPEC\` ${S}99 写的。`,
    `依据 \`docs/iterations/x.md\` ${S}3.1 写的。`,
  ]);
  assert.deepEqual(r.tokens, []);
  assert.equal(r.skips.get(BARE), 1);
  assert.equal(r.skips.get(NO_ALIAS), 1);
  assert.equal(r.skips.get(NO_PATH), 1);
  assert.equal(r.checked, 0);
});

test('记录「原来挂着这个出处、已删」时不冤——文档名在 §N 后面，不是在依据它', () => {
  // `villager.ts:36` 的形状，也是「同一个注释块里往上找最近点名的文档」那个扩法
  // 3 处误报里 2 处的真身。那句话在说那份文档里**没有**什么，不是拿它当依据；
  // 文档名跑到 §N 后面去了，而紧贴判据只认前面——所以一个都不查。
  // 这一条锁的是「记录被删的引用」与「拿它当依据」在结构上分得开：前者把文档名
  // 放在别处，后者贴在 § 前面。机器判不了语义，但这一维它看得见。
  const r = run([
    // 上一行点着同一份文档：往上扩判据时，这一行就是它要抓的那根稻草。
    '`docs/adr/ADR_SAVE.md` 的文件头写着：',
    '（这里原来写「审计 ' + S + '6.2」——没有那个小节：`docs/adr/ADR_SAVE.md` 只有 '
      + S + '1 加一个附录，没有 ' + S + '6.2。）',
  ]);
  assert.deepEqual(r.tokens, []);
  assert.equal(r.skips.get(BARE), 3);
  assert.equal(r.checked, 0);
});

test('真仓库是干净的，而且扫到了东西（防闸门悄悄塌掉）', () => {
  const r = auditSections();
  assert.deepEqual(r.findings, []);
  // 关掉紧贴判据、退回「整行点名」时，这里会从 121 掉到 209 并报出 68 处误报。
  assert.ok(r.checked > 100, `受查 ${r.checked} 处，扫描像是塌了`);
  assert.ok(r.viaGit, 'git 不可用，「已提交」是拿磁盘冒充的');
  // 该跳的都跳了，而且跳的原因说得出名字——报不出跳过次数的判据等于没有判据。
  assert.ok(r.skips.size >= 2, `只有 ${r.skips.size} 类跳过`);
});
