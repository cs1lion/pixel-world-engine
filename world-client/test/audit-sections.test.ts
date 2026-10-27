import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSections, SCAN_ROOTS, scanFiles } from '../scripts/audit-sections.ts';

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

/** 三份文档，每个夹具都要。 */
function writeDocs(root: string): void {
  mkdirSync(path.join(root, 'docs', 'adr'), { recursive: true });
  writeFileSync(path.join(root, 'docs', 'SPEC.md'), SPEC, 'utf8');
  writeFileSync(path.join(root, 'docs', 'SPEC_V2.md'), SPEC_V2, 'utf8');
  writeFileSync(path.join(root, 'docs', 'adr', 'ADR_SAVE.md'), ADR_SAVE, 'utf8');
}

/** 造一座临时仓库：committed 列哪些文件，notes.md 放待扫的正文。 */
function fixture(notes: readonly string[]): {
  root: string;
  files: string[];
  scan: string[];
  cleanup: () => void;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-sec-'));
  writeDocs(root);
  writeFileSync(path.join(root, 'docs', 'notes.md'), notes.join('\n'), 'utf8');
  return {
    root,
    files: ['docs/SPEC.md', 'docs/SPEC_V2.md', 'docs/adr/ADR_SAVE.md', 'docs/notes.md'],
    scan: [path.join(root, 'docs', 'notes.md')],
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * 同上，但待扫的是 `.ts` 里的**注释块**。
 *
 * 为什么要单一个：三个真误报（`villager.ts` 那两处、`audit-sections.ts` 文件头
 * 那一处）全在 `.ts` 的 `/** *\/` 或 `//` 里。拿 `.md` 当夹具的话注释块根本
 * 不存在，「同一个注释块里往上找」那个判据第一行就走不动——于是用它当夹具的
 * 用例对那个变异**全绿**，而它正是为那个变异写的。实测过：`.md` 夹具下装上游标
 * 判据，只有「真仓库是干净的」那条红，专门写的那条不红。
 */
function runInTs(comment: readonly string[]): {
  tokens: string[];
  skips: Map<string, number>;
  checked: number;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-sec-ts-'));
  writeDocs(root);
  mkdirSync(path.join(root, 'src'), { recursive: true });
  const body = ['/**', ...comment.map((line) => ` * ${line}`), ' */', ''].join('\n');
  writeFileSync(path.join(root, 'src', 'notes.ts'), body, 'utf8');
  try {
    const r = auditSections({
      root,
      files: ['docs/SPEC.md', 'docs/SPEC_V2.md', 'docs/adr/ADR_SAVE.md', 'src/notes.ts'],
      scan: [path.join(root, 'src', 'notes.ts')],
    });
    return {
      tokens: r.findings.map((x) => `${x.doc} ${x.token}@${x.line}`),
      skips: new Map(r.skips),
      checked: r.checked,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('文档名贴在 §N 前面，也不代表那句话在拿它当依据', () => {
  // 这一条钉的是一个**反直觉的事实**——我第一版把它写反了，所以留着。
  //
  // `terrain-edges.ts` 里有一行真身：
  //   `ART_STYLE_TARGET` §4.1 第 218 行——那份美术文档不在这个仓库里，
  // 文档名**就贴在 §N 正前面**，而那句话在说那份文档里**没有**什么。
  //
  // 它今天没被报，靠的不是紧贴，是**别名那一步**：ART_STYLE_TARGET 一件都没
  // 入库，`byStem` 里查不到。把同一个形状换成一份**已提交**的文档，紧贴判据
  // 立刻报——所以「紧贴判据结构上不会冤」是假的（`audit-sections.ts` 文件头
  // 那段已按此改写）。
  //
  // 这一条锁的就是这个分界：**换成已提交文档就必须报**。哪天有人给紧贴加一道
  // 「看起来像在记录就不查」的形状判据，这条会红，逼他回去读文件头。
  //
  // 夹具必须是 `.ts` 注释块（`runInTs`）：三个真误报全在那个形状里，拿 `.md`
  // 当夹具的话「注释块往上找」那个判据第一行就走不动，这条会对它全绿。
  const r = runInTs([
    '`docs/adr/ADR_SAVE.md` ' + S + '9 那一节——这里原来引它，后来发现那份文档只有 '
      + S + '1 加一个附录，没有 ' + S + '9。',
  ]);
  // 第一个 §9 前面紧贴着 `docs/adr/ADR_SAVE.md` → 受查 → ADR_SAVE 没有 §9 → 报。
  // 另外两个（§1 与句末那个 §9）前面分别是「那份文档只有」和「没有」→ 裸的。
  assert.deepEqual(r.tokens, ['docs/adr/ADR_SAVE.md ' + S + '9@2']);
  assert.equal(r.skips.get(BARE), 2);
  assert.equal(r.checked, 1);
});

test('记录已删出处的那句话，文档名跑到 §N 后面时一个都不查', () => {
  // 同一条边界的另一侧：文档名在 `§N` **后面**，紧贴判据只认前面，所以整句
  // 一个都不受查。这是 `villager.ts` 那个真身的形状（也是放宽成上游标时
  // 3 处误报里的一处）。
  const r = runInTs([
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

test('SCAN_ROOTS 里每一个根都真的扫到了东西', () => {
  // 这一条防的是**扫描范围静默塌陷**，而它在输出上完全看不出来。
  //
  // 实测过的坑：`GLOSSARY.md` 与 `README.md` 是两个**文件**而不是目录，而
  // `walk()` 只会 `readdirSync`。对着文件调它抛 ENOTDIR，被 walk 开头的 catch
  // 吞掉——于是闸门文件头列着七个根，实际只扫五个，那 2 处引用一处都没算。
  // 上面那条 `checked > 100` 抓不到：少的只有 2，100 那道地板太高。
  //
  // 所以逐个根核，不问总数：目录要扫出它底下的文件，文件要扫到它自己。
  // 塌陷从来不是「少了很多」，是「少了几个而没人知道少了几个」。
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const scanned = new Set(
    scanFiles(root).map((abs) => path.relative(root, abs).split(path.sep).join('/')),
  );
  const missed: string[] = [];
  for (const r of SCAN_ROOTS) {
    let isFile: boolean;
    try {
      isFile = statSync(path.join(root, r)).isFile();
    } catch {
      missed.push(`${r}：这个根在磁盘上不存在，列它等于列一个空头承诺`);
      continue;
    }
    const hit = isFile
      ? scanned.has(r)
      : [...scanned].some((f) => f.startsWith(`${r}/`));
    if (!hit) {
      missed.push(
        isFile
          ? `${r}：它是文件，却被当成目录去 readdirSync，一个字符都没扫`
          : `${r}：是目录，底下一个文件都没扫到`,
      );
    }
  }
  assert.deepEqual(missed, [], 'SCAN_ROOTS 里这些根被悄悄跳过了：\n' + missed.join('\n'));
});
