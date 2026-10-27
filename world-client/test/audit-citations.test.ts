/**
 * 引用存在性审计自己也得是被守住的那一个。
 *
 * 一个查不出问题的守卫比没有守卫更糟：它会一直绿灯，而人以为自述为真。
 * 所以这里拿一份临时目录当假仓库，把该开口的每种各造一个，看它是不是真的开口；
 * 再把不该开口的也各造一个——误报一样毁掉一个守卫，只是毁得慢一点。
 *
 * 假仓库里的坏路径**一律拼出来，不写死**：本文件的源码也在审计的扫描范围里
 * （`world-client/test`），写死了它会审到自己头上，于是「真仓库 0 处」那条永远红。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditCitations } from '../scripts/audit-citations.ts';

/** 拼一个不存在的文档路径。写死会被本脚本自己审到。 */
function phantom(): string {
  return ['docs', 'NOPE', 'NOT', 'REAL'].join('/') + '.md';
}

/** 拼一个**存在**的文档路径。同理不能写死：本文件也在扫描范围里。 */
function selfDoc(): string {
  return ['docs', 'd'].join('/') + '.md';
}

/** 一份够用的假仓库：一份文档 + 两个源文件，分处不同深度。 */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pwe-cite-'));
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(path.join(root, 'world-client', 'src', 'world'), { recursive: true });
  mkdirSync(path.join(root, 'world-client', 'src', 'render'), { recursive: true });
  writeFileSync(
    path.join(root, 'world-client', 'src', 'world', 'setup.ts'),
    'export const setup = 1;\n',
    'utf8',
  );
  writeFileSync(
    path.join(root, 'world-client', 'src', 'render', 'bake.ts'),
    'export const bake = 1;\n',
    'utf8',
  );
  return root;
}

/** 往假仓库的文档里写一句话，然后审它。 */
function auditDoc(root: string, body: string) {
  writeFileSync(path.join(root, 'docs', 'd.md'), `${body}\n`, 'utf8');
  return auditCitations({ root });
}

test('引一个不存在的文档，它开口', () => {
  const root = fixture();
  try {
    const bad = auditDoc(root, `依据见 \`${phantom()}\`。`);
    assert.equal(bad.findings.length, 1, '不存在的文档必须报出来');
    assert.equal(bad.findings[0]!.token, phantom());
    assert.equal(bad.findings[0]!.file, 'docs/d.md');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('四种写得出来的真引用，它不开口', () => {
  const root = fixture();
  try {
    // 1. 仓库根相对；2. 模块内相对（文档在 docs/ 里写 src 下的路径）；
    // 3. 裸文件名；4. 从引用者逐级往上。
    const good = auditDoc(
      root,
      [
        `\`${selfDoc()}\` 自己。`,
        '`world/setup.ts` 说的是 `world-client/src/world/setup.ts`。',
        '裸文件名 `bake.ts` 也在仓里。',
        '`render/bake.ts` 从 src 出发能找到。',
      ].join('\n'),
    );
    assert.deepEqual(good.findings, [], '四种真引用一处都不该报');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('六种不该受查的形状，它不当引用', () => {
  const root = fixture();
  try {
    const skipped = auditDoc(
      root,
      [
        '没有已知后缀：`ART_SPEC`、`MOON_PHASES`。',
        '含空白的命令行：`FEED=1 node scripts/smoke.mjs`。',
        'glob：`docs/*.md`。',
        '仓外：`~/Downloads/x.md`。',
        'URL 路由：`/api/memory/entry/x.md`。',
        '裸后缀：`.ts` 与 `.test.ts`。',
      ].join('\n'),
    );
    assert.deepEqual(skipped.findings, [], '六种形状一处都不该报');
    // 跳过次数得真的报得出来——报不出来的判据等于没有判据。
    assert.equal(skipped.skips.get('没有已知后缀'), 2);
    assert.equal(skipped.skips.get('含空白（命令行/子命令，不是引用）'), 1);
    assert.equal(skipped.skips.get('含 glob 或 shell 元字符'), 1);
    assert.equal(skipped.skips.get('以 ~ 开头（仓外）'), 1);
    assert.equal(skipped.skips.get('以 / 开头（URL 路由/站点根）'), 1);
    assert.equal(skipped.skips.get('裸后缀'), 2);
    // 一样都没受查。
    assert.equal(skipped.checked, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** 拼出那个被白名单按文件赦免的幽灵名。写死会被本文件自己审到——本文件的源码
 *  也在审计的扫描范围里，而它不在那个 token 的白名单文件清单中。 */
function ghostName(): string {
  return ['night', 'ts'].join('.');
}

test('白名单按文件放行：同一个 token 换个文件提就报', () => {
  // 这条钉的是白名单**最要紧**的那半。按 token 赦免等于在全仓赦免：
  // 那个幽灵今天在 phase-view.ts 里是一句「这个文件从来不存在」的正确记录，
  // 明天有人在别的文件里拿它当依据，照样绿——那正是这个脚本要防的事。
  const root = fixture();
  try {
    mkdirSync(path.join(root, 'world-client', 'src', 'render'), { recursive: true });
    // 造一个**不在**白名单文件清单里的文件。
    const stray = path.join(root, 'world-client', 'src', 'render', 'elsewhere.ts');
    writeFileSync(
      stray,
      [`/** 沿用 \`${ghostName()}\` 的手法。 */`, 'export const e = 1;', ''].join('\n'),
      'utf8',
    );
    const r = auditCitations({ root });
    const hit = r.findings.find((f) => f.token === ghostName());
    assert.ok(hit !== undefined, '幽灵名出现在白名单外的文件里，必须报出来');
    assert.equal(hit.file, 'world-client/src/render/elsewhere.ts');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('真仓库今天没有白名单外的引用', () => {
  // 这一条是**会黄的**：谁新写一个指向不存在文件的引用，它当场红。
  // 它黄了不是这条测试坏了，是仓库刚多了一句谎话——去修那句话，别来改这条。
  const real = auditCitations();
  assert.equal(real.findings.length, 0, '真仓库有白名单外的引用，见上方报告');
  // 受查数不能是 0：0 处未解析 + 0 处受查 = 闸门根本没跑，那是另一种绿。
  assert.ok(real.checked > 100, `只受查了 ${real.checked} 处，闸门大概没扫到东西`);
  // 白名单不能是空的：空的白名单配 0 处未解析，通常意味着扫描范围塌了。
  assert.ok(real.known > 0, '白名单内 0 处——要么判据变了，要么扫描范围空了');
});
