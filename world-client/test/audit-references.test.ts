/**
 * 行号引用审计自己也得是被守住的那一个。
 *
 * 一个查不出问题的守卫比没有守卫更糟：它会一直绿灯，而人以为自述为真。
 * 所以这里拿一份临时目录当假仓库，把五种坏引用各造一个，看它是不是真的开口。
 * 哪天它闭上了嘴，这些条会红。
 *
 * 也钉住它**不**乱开口：指着注释、网址里的端口、「第 12 行」这种行文，
 * 都得放行——误报一样毁掉一个守卫，只是毁得慢一点。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditReferences, invisibleNameRefs } from '../scripts/audit-references.ts';

/** 一份够用的假仓库：两个源文件 + 一份文档。 */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-refs-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(path.join(root, 'world-client', 'src'), { recursive: true });
  mkdirSync(path.join(root, 'world-client', 'test'), { recursive: true });
  writeFileSync(
    path.join(root, 'world-client', 'src', 'a.ts'),
    ['export function one(): number {', '  return 1;', '}', '', '// 一段注释', 'export function two(): number {', '  return 2;', '}', ''].join('\n'),
    'utf8',
  );
  writeFileSync(path.join(root, 'world-client', 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
  return root;
}

function doc(root: string, body: string): void {
  writeFileSync(path.join(root, 'docs', 'd.md'), body, 'utf8');
}

/**
 * 拼一个 `file:line` 引用。
 *
 * 不把坏行号直接写在源码里：审计脚本扫 `world-client/test`，那是它自己的
 * 一份测试数据，不是仓库的自述——写死了它会审到自己头上，于是「真仓库
 * 0 处存疑」那条永远红。拼出来，源码里就没有那个形状。
 */
function ref(file: string, from: number, to?: number): string {
  return `\`${file}:${from}${to === undefined ? '' : `-${to}`}\``;
}

/** 省略文件名的续引：`` `:99` ``。 */
function bare(from: number, to?: number): string {
  return `\`:${from}${to === undefined ? '' : `-${to}`}\``;
}

const WHY_OF = (findings: readonly { readonly where: string; readonly why: string }[], line: number): string =>
  findings.find((f) => f.where === `docs${path.sep}d.md:${line}`)?.why ?? '';

test('指到文件外、指到空行、指到不存在的文件，三样都开口', () => {
  const root = fixture();
  try {
    doc(
      root,
      [
        `越界：${ref('a.ts', 99)}。`,
        `不存在：${ref('nope.ts', 3)}。`,
        `空行：${ref('a.ts', 4)}。`,
        '',
      ].join('\n'),
    );
    const { findings } = auditReferences({ root });
    assert.match(WHY_OF(findings, 1), /越界/, '行号超出文件长度要说出来');
    assert.match(WHY_OF(findings, 2), /找不到这个文件/, '指到一个没有的文件要说出来');
    assert.match(WHY_OF(findings, 3), /没有代码/, '指着空行等于什么都没指');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('指着注释是正当的：ADR 引的就是注释的原文', () => {
  const root = fixture();
  try {
    doc(root, `引一段注释——「一段注释」（${ref('a.ts', 5)}）。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '注释不是真空，指着它不该被当成指错了');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * 这条钉住的是一个**盲区**，不是一个守卫。
 *
 * `5248611` 上 `smoke-ego.mjs` 引的 SandboxScene.ts 第 852 行想说
 * `const due = …` 那个分支，而那一行是 `* 导播要看的地方。`——一句讲别的事的注释。
 * `hasCode()` 只判「不是空行、不只是括号」，注释行有汉字，过得和有代码的行一样顺，
 * 所以这次漂移一次都没响过。（`c716a4a` 的提交信息说它「落到一段空行上，审计响了
 * 一声」——两句都是假的，`44ba17e` 里更正过。）
 *
 * 同一次修复里（`44ba17e`）simulation.ts 第 2393 行漂到第 2444 行，更安静：
 * 落点是一行**有代码**的别行，`hasCode()` 照样放行。那一种要名字挨着坐标才查得动
 * （`CALL_REF`），这里管不了。
 *
 * 想闭上它，可判据立不住。「引了原话」与「顺带提一句名字」在正文里是同一个形状：
 * 「每个模板都过同一个 `prefab()` 助手、boundTask 硬编码 null」后面跟着 a.ts 第 5 行
 * 的坐标时，`prefab()` 是顺带一提，坐标说的是 boundTask——这一句是正当的，而这个
 * 仓库的自述里通篇都是。要分辨两者，得读懂句子。机器读不懂，就不该由脚本假装能判：
 * 假判一次，这个守卫就被人整个不信了。
 *
 * 所以这里钉住「今天它放行」。哪天它忽然开口了，先回来看这一条：是误报，
 * 还是真的有了立得住的判据。
 */
test('落点只有注释又没引原话：今天查不出来——这条钉住盲区', () => {
  const root = fixture();
  try {
    // 正文说的是一个**代码里的东西**（`const due` 那个分支），而坐标落在
    // a.ts 第 5 行——那一行是 `// 一段注释`，讲的是别的事。这正是 `5248611`
    // 上 smoke-ego.mjs 那一处的形状。**注意别把这段正文写成「引一段注释」**：
    // 「一段注释」四个字就是第 5 行的原话，写上去这一条就退化成上面那条
    // 「指着注释是正当的」了——两者断言一样，差别全在正文引没引原话。
    doc(root, `const due 那个分支（${ref('a.ts', 5)}），理由写在设计笔记里。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '这一处今天就该放行；改了行为，先确认不是误报');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('裸文件名撞上多个文件时报出来，还列出候选', () => {
  const root = fixture();
  try {
    writeFileSync(path.join(root, 'world-client', 'test', 'a.ts'), 'export const dup = 1;\n', 'utf8');
    doc(root, `撞车：${ref('a.ts', 1)}。\n`);
    const { findings } = auditReferences({ root });
    const why = WHY_OF(findings, 1);
    assert.match(why, /撞上 2 个文件/, '两个同名文件不该由脚本挑一个');
    assert.match(why, /world-client.src.a\.ts/, '候选要列出来，人才知道挑哪个');
    assert.match(why, /world-client.test.a\.ts/, '两个候选都要列');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('网址里的端口与「第 12 行」这种行文不算指针', () => {
  const root = fixture();
  try {
    doc(root, '见 http://example.com/a.ts:8080 与 a.ts 第 3 行的说明。\n');
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '两者都没有坐标，不该占一个存疑名额');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('网址和真引用在同一行时，真引用照样要查', () => {
  // 这一条钉的是**逐处判**，不是逐行判。曾按行判：一行里出现网址就把整行
  // 跳过，于是「留白环见 grid.ts:NNN（背景见 https://…）」这种句子里
  // 真的那一处被一起放过——代码挪走、行号烂掉，CI 全绿。那正是这个脚本
  // 存在的理由所不容的一种沉默，比误报糟得多。
  const root = fixture();
  try {
    doc(root, `留白环见 ${ref('a.ts', 99)}，背景见 https://example.com/a.ts:8080 。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 1, '那一行里只有一处是坐标，该查的就是它');
    assert.match(WHY_OF(findings, 1), /越界/, '网址旁边的真引用越界了要被查出来');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('「第 12 行」这种行文旁边有真引用时，也不许把真引用放过', () => {
  // 同一处毛病的另一半：行文（「a.ts 第 3 行」）没有冒号，本来就不是指针；
  // 可它不该顺带替同一行的真引用免检。
  const root = fixture();
  try {
    doc(root, `a.ts 第 3 行是入口；越界的那处见 ${ref('a.ts', 99)}。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 1, '行文不算指针，可真引用算');
    assert.match(WHY_OF(findings, 1), /越界/, '行文旁边的真引用越界了要被查出来');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------- 省略文件名的续引也得查

test('同一个文件连指几行时，省略文件名的那几处也要查', () => {
  // 「调用在 `setup.ts:NNN`、`:NNN`，定义在 `:NNN`」这种写法在 ADR 里到处是。
  // 曾只有第一处带文件名的被查，后面几处完全没人管——于是
  // `terrain-edge-visibility.test.ts` 里那个指向不存在文档的第 218 行
  // 一直绿着。这一条钉住续引也在查。
  //
  // （顺带：本文件的注释里不写「:数字」这种白板续引。写了它就会接上同一段里
  // 最近的那个文件，被当成一处真引用去查——这个守卫连自己的注释一起审。
  // 所以上面那个例句用 `NNN`：`setup.ts` 每长一行，真行号就烂一行，而烂的
  // 是文档自己——那正是这条纪律要省掉的那种红。）
  const root = fixture();
  try {
    doc(root, `调用在 ${ref('a.ts', 1)}，定义在 ${bare(99)}。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 2, '一行里那两处都是指针，该查两处');
    assert.match(WHY_OF(findings, 1), /越界/, '省略文件名的续引越界了要被查出来');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('续引写在下一行、同一个段落里，也算数', () => {
  const root = fixture();
  try {
    doc(root, `调用在 ${ref('a.ts', 1)}，\n定义在 ${bare(99)}。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 2, '同一段里跨一行也接得上');
    assert.match(WHY_OF(findings, 2), /越界/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('空行一断就忘：新的一段开头出现 `:99` 不是指针', () => {
  // 反方向也得钉。跨段或跨文件接着带，会把一个毫不相干的第 218 行
  // 安到旁边那个文件头上——那是误报，而误报一样毁掉一个守卫。
  const root = fixture();
  try {
    doc(root, `调用在 ${ref('a.ts', 1)}。\n\n另一段：${bare(99)}。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 1, '空行之后没有可接的文件，那处不算指针');
    assert.equal(findings.length, 0, '不该把一个孤立的白板续引当成越界');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('代码里的键值对不是续引：少了前引号这个条件就会误报', () => {
  // `width: 64`、`` `width: 64` `` 都长得像。前引号紧跟冒号是硬条件，
  // 否则一段里随便一句配置都会被抓去查行号。
  const root = fixture();
  try {
    doc(root, `见 ${ref('a.ts', 1)}；配置里 width: 64 与 \`height: 32\` 都不是指针。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 1, '只有带文件名的那一处是指针');
    assert.equal(findings.length, 0, '键值对不该被当成越界的续引');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('真仓库现在是干净的：0 处存疑', () => {
  // 这一条是那道真正的闸门。它不换 root，审的就是这个 checkout——
  // 谁改代码挪走了函数，这里当场红，而不是等某个后人在文档里照着错的行号改错地方。
  const { checked, findings } = auditReferences();
  assert.ok(checked > 50, `该查到几十处引用，只查到 ${checked}——扫描范围是不是缩了`);
  assert.deepEqual(
    findings.map((f) => `${f.where}  ${f.ref} —— ${f.why}`),
    [],
    '仓库里有没有哪处行号引用对不上了',
  );
});

// ---------------------------------------------- 「那东西就在这儿」也得真的是它

test('写着「这东西在那儿」的引用，那儿得有那样东西', () => {
  // 前四样只查「行号自己烂没烂」：越界、空行、文件不存在。可还有一种烂法
  // 它们一句都说不出来——行号还在文件里、那段也有代码，只是那段是**别的**。
  // 实测样本：`scatterToShelter` 的定义挪走之后，它引的那行是讲潮位的注释，
  // 而 CI 全绿。这一条钉住那种。
  const root = fixture();
  try {
    doc(root, `搬走的是 two()（${ref('a.ts', 1)}）。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 2, '同一行里两处都是指针');
    const why = WHY_OF(findings, 1);
    assert.match(why, /附近没有 two/, '名字写在坐标旁边，那儿就得有那个名字');
    assert.match(why, /a\.ts:1/, '报出来时要带上到底指的哪儿');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('带着名字的引用指到文件外、指到不存在的文件：报一遍，不是两遍', () => {
  // 一次真事的回归。第五样那段原来自己也 push 一份，可 `REF` 不要求坐标前面
  // 有名字——越界、文件不存在这两种它早就报过了，`where` 与 `why` 一字不差。
  // 实测同一条错在报告里出现两遍（同一行、同一句），读的人以为有两处。
  // 这一条钉「只报一次」：既是别重复，也是前四样那两样确实还在此处生效。
  const root = fixture();
  try {
    doc(
      root,
      [
        `越界：two()（${ref('a.ts', 99)}）。`,
        `不存在：two()（${ref('nope.ts', 3)}）。`,
        '',
      ].join('\n'),
    );
    const { findings } = auditReferences({ root });
    assert.match(WHY_OF(findings, 1), /越界/, '带着名字也拦得住行号越界');
    assert.match(WHY_OF(findings, 2), /找不到这个文件/, '带着名字也拦得住文件不存在');
    assert.equal(
      findings.filter((f) => f.where.endsWith(':1')).length,
      1,
      '同一处错只报一次，别让读报告的人以为有两处',
    );
    assert.equal(
      findings.filter((f) => f.where.endsWith(':2')).length,
      1,
      '不存在的文件同理',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('顺带提一句名字不算报位置：坐标说的多半是另一件事', () => {
  // 反方向也得钉。ADR 里「每个模板都过同一个 prefab() 助手、boundTask 硬编码
  // null（pack.ts:14）」这种句子，prefab() 是顺带提的，坐标说的是 boundTask。
  // 隔开半句去认领一个坐标，就是把一句真话说成疑点——而误报一样毁掉一个守卫。
  const root = fixture();
  try {
    doc(root, `每个模板都过同一个 prefab() 助手、boundTask 硬编码 null（${ref('a.ts', 5)}）。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '顺带提的名字不该被当成一处坐标声明');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('坐标两头都带反引号的那种写法也在查：仓库里主流是它', () => {
  // 一次真事的回归。这条判据第二版把可选反引号只放在坐标**前面**，于是它只认
  // 「名字带一对括号、坐标两头都裸」那一种；而仓库里真正主流的是代码Span的
  // 收反引号排在名字后面、坐标自己又带一对反引号——ADR 通篇如此。漏掉的
  // 表现不是少查几处，是这条判据对全仓绝大多数引用**静默失效**：行号烂了、
  // 名字对不上，CI 照绿。而它存在的全部理由就是不让那种沉默发生。
  const root = fixture();
  try {
    doc(root, `搬走的是 \`two()\`（${ref('a.ts', 1)}）。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 2, '这一处得真被当成指针：名字那处 + 坐标那处');
    const why = WHY_OF(findings, 1);
    assert.match(why, /附近没有 two/, '名字写在坐标旁边，那儿就得有那个名字');
    assert.match(why, /a\.ts:1/, '报出来时要带上到底指的哪儿');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('坐标两头都带反引号而指对了：不该开口', () => {
  // 上一条的对照。收紧了正则就多认一批引用，认错了方向会把一堆正当的引用
  // 审成疑点——那一样毁掉一个守卫。
  const root = fixture();
  try {
    doc(root, `搬走的是 \`two()\`（${ref('a.ts', 6)}）。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, `指对了就不该报：${findings.map((f) => f.why).join(' / ')}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('顺带提一句名字，坐标也带反引号，照样不算报位置', () => {
  // 收紧不能把反方向那条一起弄坏：隔开半句仍然是隔开半句，与带不带反引号无关。
  const root = fixture();
  try {
    doc(root, `每个模板都过同一个 \`prefab()\` 助手、boundTask 硬编码 null（${ref('a.ts', 5)}）。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '隔开半句不该认领坐标，带上反引号也不该');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('一排名字并列，最后那一个挨着坐标：它算报位置', () => {
  // 一个**已知的边界**，钉在这儿是为了让它是个决定，不是个意外。
  //
  // 「`one()`、`two()`、`three()`」后面跟一个坐标，这种写法收紧后的正则认最后
  // 那一个（`three`）——它与坐标之间只隔一个括号，正是「挨着才算报位置」
  // 这条规则本身。可这句话也可能是在说「这三个大致都在那一带」。
  //
  // 两种读法都讲得通，所以这里不判谁对，只钉住现在的行为，并把代价写清楚：
  // 万一将来它被当成误报，改的是这条测试，不是悄悄改正则。
  //
  // （注释里不写「文件名:数字」的字面形状，理由同文件开头：这个守卫连自己的
  //   测试数据一起审，写死了它就把自己审成红的。）
  const root = fixture();
  try {
    doc(root, `一排：\`one()\`、\`two()\`、\`three()\`（${ref('a.ts', 6)}）。\n`);
    const { checked, findings } = auditReferences({ root });
    assert.equal(checked, 2, '这一处得被当成指针');
    const why = WHY_OF(findings, 1);
    // 夹具里 three 不存在，所以按现在的规则它该开口。
    assert.match(why, /附近没有 three/, '挨着坐标的那一个算在报位置');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('坐标偏几行还算数：引的常是函数上面那段注释', () => {
  // 夹具里 `two` 的定义在第六行，可它上面第五行是段注释。ADR 经常引的就是那段
  // 注释的原文，而注释里不一定再写一遍函数名。所以容许偏几行，不是逐字对齐。
  // （这条注释里因此不写「文件名:数字」——这个守卫连自己的测试数据一起审，
  //   而真实仓库里没有那个文件。）
  const root = fixture();
  try {
    doc(root, `见 two()（${ref('a.ts', 5)}）。\n`);
    const { findings } = auditReferences({ root });
    assert.equal(findings.length, 0, '偏几行落在同一个函数上，不该报');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('盲区是数得出来的：CALL_REF 看不见的那批，今天冻在这儿', () => {
  // `CALL_REF` 有个盲区：名字挨着坐标，可名字后面跟的是**全角括号**而不是
  // `()`。那批引用它一律不查——行号烂了、名字对不上，CI 照绿。
  //
  // 这个盲区原先只在 `audit-references.ts` 的注释里写着一个数（「8 处」）。
  // 而那个数是手写的，会漂：2026-10-27 拿放宽后的正则重数，实际 9 处，多出来
  // 的正是那段注释自己举的两个例子——它一边举例一边在六行之下写着「本文件的
  // 注释里因此不写那种形状的示例」，自相矛盾。把例子改成语义描述之后剩 7 处。
  //
  // 所以数不写在注释里，写在这儿：**集合冻死**，多一处少一处都红。来的人
  // 被迫看一眼这一批，而不是继续读一个没人核过的数。
  //
  // 只冻「哪儿、哪个名字」，不冻坐标：坐标烂没烂是 `auditReferences` 的事，
  // 这条只管盲区的边界。坐标的真假由下面那个循环查——每一处都得在落点附近
  // 找得到那个名字，找不到就红。原注释说「那几处今天恰好都是对的」，
  // 那句话从此是查过的，不是顺口说的。
  // 存成三元组而不是拼好的字符串：拼好了源码里就多出一个「Markdown 文件名
  // 加冒号加行号」的形状，而这个守卫连自己的测试数据一起审——它会把那一处
  // 也当成一处引用去查，「真仓库 0 处存疑」那条的计数随之漂（实测漂了 5 处）。
  // 拆开写，源码里就没有那个形状。
  const FROZEN: readonly (readonly [string, number, string])[] = [
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 14, 'validateCoverage'],
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 14, 'assertWorldInvariants'],
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 14, 'assertWorldInvariants'],
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 15, 'buildSettingWorld'],
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 27, 'WORKSHOP_TASKS'],
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 43, 'validateCoverage'],
    ['docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md', 47, 'placeFromPlan'],
  ];
  const seen = invisibleNameRefs().map((entry) => {
    const [file, line, ...rest] = entry.where.split(':');
    return [file ?? '', Number(line), entry.name, ...rest] as const;
  });
  assert.deepEqual(
    seen.map((row) => row.slice(0, 3)),
    [...FROZEN],
    'CALL_REF 的盲区变了。多出来的每一处都得人工核一遍：名字对不对得上坐标。\n' +
      '核完了把它加进上面那个清单——别为了让测试绿就把 CALL_REF 放宽，\n' +
      '放宽会误报（全角括号在中文里就是普通括注），理由见 audit-references.ts。',
  );
  for (const entry of invisibleNameRefs()) {
    assert.ok(
      entry.nameNearby,
      `${entry.where} 的 ${entry.name} 在 ${entry.target} 附近找不到——这处盲区引用本身是烂的，\n` +
        '只是 CALL_REF 看不见它。修掉它，再从上面那个清单里删掉。',
    );
  }
});
