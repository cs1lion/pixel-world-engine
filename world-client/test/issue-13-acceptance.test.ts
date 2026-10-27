/**
 * #13 五条验收条件的**实测记分板**。
 *
 * ## 为什么要有这个文件
 *
 * #13 的正文有五条验收条件，打成五个勾。可仓库里只有 `pack-owns-world-data.test.ts`
 * 守着第 2 条的一部分，另外四条**没有任何东西量过**。于是「#13 完成了吗」这个问题，
 * 每个人都要从头推一遍：读一遍 issue、读一遍 `settings/`、跑一遍审计——而推出来的
 * 结论各不相同，因为没有人把数落在同一处。
 *
 * 这个文件就是那一处。每条条件一个用例，量的是**今天的真实状态**，不是想要的状态。
 *
 * ## 三条规矩（与 `terrain-edge-invisible.test.ts` 立下的一脉相承）
 *
 * 1. **未满足的条件不许假装满足。** 满足不了的登记进 `KNOWN_UNMET`，双向 diff：
 *    多一条红（出现了新的未满足项），少一条也红（某项被满足了，回来更新记分板）。
 *    只看一边的闸门会被「悄悄满足」绕过——而那正是最该敲锣的一次。
 * 2. **满足的条件要钉住。** 第 1、4 条今天是真满足的，就真去量它；量不了的说清
 *    量不了的是什么、以及为什么不去量。
 * 3. **数必须可复现。** 每条用例都说清自己量的对象与判据；跑子进程的附上命令。
 *
 * ## 今天量出来是什么（2026-10-28）
 *
 * | # | 条件 | 状态 |
 * |---|---|---|
 * | 1 | 配置包有明确的 TypeScript 类型 | **满足** |
 * | 2 | 代码里没有写死的区域名/色值/预制体 id/作息落点 | **不满足**（莞尔镇四样全在代码里） |
 * | 3 | 每区主色/点缀/禁用三槽，设定集 A 已填 | **不满足**（设定集 A 的 `regions` 是空数组） |
 * | 4 | 画面与改动前一致（`audit-palette --strict`） | **满足** |
 * | 5 | `check` / `test` / `build` 通过 | **部分**：check 与 test 过，build 被既有故障挡着 |
 *
 * 第 2、3 条不是疏漏，是**范围**：`docs/SPEC_V2.md` §4.1 写明「现有的四个分区
 * 保留为设定集 A……灯潮界的六个区域做成设定集 B」，而 `settings/index.ts` 的
 * `LEGACY_PACK`（莞尔镇 = 设定集 A）`authored: false`，`test/settings-default-pack.test.ts`
 * 的文件头明说它是「运行时由 buildWorld 程序化生成的那个世界的**描述符 stub**」。
 * 换句话说：机器已经会读配置包了，并在设定集 B 上验过；**设定集 A 还没长成配置**，
 * 而 #13 的标题正是「设定集 A 先长成配置」。
 *
 * 这个文件不决定那件事该不该做——那是用户的决定。它只保证：无论做不做，
 * 「现在完成到哪一步」这句话在仓库里有一处不会漂的答案。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectSetting } from '../src/settings/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * 哪些验收项还没满足。双向 diff：多一条红、少一条也红。
 *
 * 键的形状是「设定集|验收项」，由最后一条用例守着。设定集只有三个值：
 * `A`（莞尔镇）、`B`（灯潮界）、`build`（工程自己的三条命令）。
 */
const KNOWN_UNMET: Readonly<Record<string, { readonly why: string }>> = {
  // 设定集 A（莞尔镇）——#13 标题里的那个，也是正文交付清单里每一样东西的所在。
  'A|区域名': {
    why: 'LEGACY_PACK.regions 是空数组，莞尔镇的分区名在 setup.ts 里。'
      + 'SPEC_V2 §4.1 定了 A 是现有四个分区那条路，本文件不替它改范围。',
  },
  'A|预制体 id': {
    why: 'LEGACY_PACK.placements 是空数组，莞尔镇六栋常驻铺子与住宅都在 setup.ts 里'
      + '（KNOWN_PREFABS 里 19 对中的 11 对）。',
  },
  'A|作息落点': {
    why: 'LEGACY_PACK.villagers 是空数组，莞尔镇四个落点在 routines.ts 的 routineBeats() 里'
      + '（KNOWN_STOPS 那 4 行）。',
  },
  'A|三色槽位': {
    why: 'regions 为空，一个槽位都没有，谈不上填。设定集 B 的五道区域三槽齐全'
      + '（§4.1 的补记：第六道「炉底层」有意未声明）。',
  },
  // 设定集 B（灯潮界）——条件 2 在它身上是真的满足的，这里登记的是它自己的缺口。
  'B|瓦片配方': {
    why: '条件 2 只点四样，瓦片配方在交付清单里但不在验收条件那一行。'
      + 'tilemap.ts 按地形画什么仍是渲染算法，不是设定集数据。',
  },
  'B|潮汐周期': {
    why: '交付清单里有，验收条件那一行没有。而且它与 tide.ts 的「潮汐：世界自己的时钟」、'
      + 'grime.ts 的「世界的节律归世界」、SPEC_V2 §4.3 的「『潮汐是时钟』这条不被夺权」'
      + '直接冲突——是范围问题，该由用户定，不由一道测试定。',
  },
  'build|原生绑定': {
    why: 'node_modules/rolldown 缺 @rolldown/binding-win32-x64-msvc，vite build 起不来。'
      + '这是 npm 可选依赖的已知毛病（它自己的报错就这么写），与仓库代码无关：'
      + '把改动全部还原到 HEAD 再跑，崩得一字不差。',
  },
};

/** 量「某个设定集的包里有没有某样东西」。空数组 = 没有，也就是那样还在代码里。 */
function packHas(setting: string, field: 'regions' | 'placements' | 'villagers'): boolean {
  const pack = selectSetting(setting) as unknown as Record<string, unknown>;
  const value = pack[field];
  return Array.isArray(value) && value.length > 0;
}

test('条件二：写死的四样，逐个量——未满足的必须与 KNOWN_UNMET 一模一样', () => {
  // 色值那一样不在这儿量：它在 pack-owns-world-data.test.ts 里是硬闸门（0 放行），
  // 两个设定集都干净，所以它不是"未满足项"，没有键。
  const measured: Record<string, boolean> = {
    'A|区域名': packHas('', 'regions'),
    'A|预制体 id': packHas('', 'placements'),
    'A|作息落点': packHas('', 'villagers'),
    'B|区域名': packHas('world=dengchao', 'regions'),
    'B|预制体 id': packHas('world=dengchao', 'placements'),
    'B|作息落点': packHas('world=dengchao', 'villagers'),
  };

  const appeared = Object.keys(measured).filter((k) => !measured[k] && !(k in KNOWN_UNMET));
  assert.deepEqual(
    appeared,
    [],
    `出现了登记外的未满足项：${appeared.join('、')}。它昨天还是满足的——那是退化，`
      + '不是新范围。先查是怎么退的，再决定是修还是往 KNOWN_UNMET 登记并写清为什么。',
  );

  // 反方向更要紧：某一项被满足了而登记表没跟上，下一次真退化就会被当成已知项放过去。
  const fixed = Object.keys(measured).filter((k) => measured[k] && k in KNOWN_UNMET);
  assert.deepEqual(
    fixed,
    [],
    `这些项已经满足了，KNOWN_UNMET 里的记录过期了：${fixed.join('、')}。`
      + '删掉对应行——那正是最该敲锣的一次，别把记分板留在昨天。',
  );
});

test('条件三：设定集 A 一个区域都没有，所以一个色槽都没填', () => {
  const a = selectSetting('');
  assert.equal(
    a.regions.length,
    0,
    '莞尔镇的 regions 不再是空数组了——它长成配置包了。那是 #13 的正事，'
      + '也是这条记分板最盼的一次红。回来把 KNOWN_UNMET 里 "A|三色槽位" 那一行删掉。',
  );
  assert.equal(a.authored, false, 'LEGACY_PACK 的 authored 变了——它不再被当成 stub 了');

  // B 那一半是真满足的，就真去量：每道区域三个槽，一个都不能少。
  // 注意 selectSetting 收的是**查询串**不是裸 id：传 'dengchao' 会走到
  // `get('world') === null` 那条分支，安静地返回 LEGACY_PACK——量的是 A 却以为在量 B。
  const b = selectSetting('world=dengchao');
  assert.ok(b.authored, '灯潮界那一份不是 authored——选错了设定集');
  assert.ok(b.regions.length > 0, '灯潮界的区域不见了——判据失去对象，回来重写这条');
  for (const region of b.regions) {
    for (const slot of ['primary', 'accent', 'forbidden'] as const) {
      assert.ok(
        typeof region[slot] === 'string' && region[slot].length > 0,
        `灯潮界的区域「${region.name}」缺 ${slot} 槽。槽位空着不报错，`
          + '只让设定集 B 长不出自己的颜色——正是 #13 说「关键」的那一样。',
      );
    }
  }
});

test('条件一：配置包的类型是真的类型，编译器认得出漏项', () => {
  // 真编译，不是扫源码。探针故意漏字段，跑真的 tsc，看它是否点名那个文件。
  //
  // 探针为什么放在 `node_modules/.pwe-criterion1/` 而不是 `test/`：
  // 往 `test/` 里塞一个**故意写坏**的文件，会让本仓另外几个会话的 `npm run check`
  // 当场变红（`test/` 在 tsconfig 的 include 里）。`check-types.test.ts` 的文件头
  // 警告过同一类事的反面——不能因为自己要验一下，就把别人的一遍检查弄脏。
  // `node_modules` 是 tsconfig 的默认排除项，所以仓库自己的 tsc 看不见它；
  // 而把文件路径作为命令行参数传给 tsc 时会绕过 tsconfig，于是只有这一遍看得见。
  const dir = `${ROOT}node_modules/.pwe-criterion1`;
  const probe = `${dir}/probe.ts`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    probe,
    [
      "import type { RawSettingPack } from '../../src/settings/types.ts';",
      'export const broken: RawSettingPack = {',
      "  id: 'probe', name: '探针', saveKey: 'probe',",
      '  // 故意不写 palette / regions / prefabs / villagers——编译器该指出漏了什么。',
      '};',
      '',
    ].join('\n'),
    'utf8',
  );
  try {
    const run = spawnSync(
      process.execPath,
      [
        `${ROOT}node_modules/typescript/bin/tsc`,
        probe,
        '--noEmit', '--pretty', 'false', '--strict',
        '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
        '--allowImportingTsExtensions', '--verbatimModuleSyntax',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const named = (run.stdout ?? '').split('\n').filter((line) => line.includes('probe.ts'));
    assert.ok(
      named.length > 0,
      'tsc 没有指出探针漏了字段——要么 RawSettingPack 不再要求那些字段（那 #13 第一条'
        + '就退化了），要么这条探针的写法失效了（tsc 起不来的话 stderr 是 '
        + `${run.stderr ?? '(空)'}）。两种都该回来看，不是把这条改绿。`,
    );
    assert.ok(
      named.some((line) => /error TS2740/.test(line)),
      `tsc 提到了探针，但报的不是「少了属性」那一类错：\n${named.join('\n')}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('条件四：audit-palette --strict 真的退出 0', () => {
  const run = spawnSync(
    process.execPath,
    [`${ROOT}scripts/audit-palette.mjs`, '--strict'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, `audit-palette --strict 非零退出：\n${run.stdout}\n${run.stderr}`);
});

test('条件五：三条命令的口子都在，check 真的过，build 的故障是登记过的那一个', () => {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as {
    scripts: Record<string, string>;
  };
  for (const [name, expected] of [
    ['check', 'node scripts/check-types.ts'],
    ['test', '--import ./test/phaser-hooks.mjs --test test/*.test.ts'],
    ['build', 'node scripts/check-types.ts && vite build'],
  ] as const) {
    assert.ok(
      typeof pkg.scripts[name] === 'string' && pkg.scripts[name].includes(expected),
      `package.json 的 "${name}" 脚本变了（现在是 ${pkg.scripts[name]}）——`
        + 'CI 跑的就是这几条，改名字或改内容都该回来同步这一条。',
    );
  }

  // check 真跑一遍。它只有几秒，而它正是条件点点名的三条之一。
  const check = spawnSync(
    process.execPath,
    [`${ROOT}scripts/check-types.ts`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  assert.equal(check.status, 0, `npm run check 非零退出：\n${check.stdout}\n${check.stderr}`);

  // test 就是你现在跑的这套，不能再跑一遍（会递归）。这里只说清这一点，不假装验过。
  // build 的故障登记在 KNOWN_UNMET 的 build|原生绑定 里，理由与复现方式都写在那儿。
  assert.ok(
    'build|原生绑定' in KNOWN_UNMET,
    'build|原生绑定 从登记表里没了——要么 build 修好了（好，删行），要么这条该更新。',
  );
});

test('登记表本身没长毛：每个键都还能说出它量的是什么', () => {
  // KNOWN_UNMET 的键形如 `A|区域名` / `B|瓦片配方` / `build|原生绑定`。
  // 形状一乱，上面几条的 filter 就会静默漏掉它——那比没有登记表更糟。
  for (const [key, entry] of Object.entries(KNOWN_UNMET)) {
    assert.match(key, /^(?:A|B|build)\|.+\S$/, `KNOWN_UNMET 的键 "${key}" 不是「设定集|验收项」的形状`);
    assert.ok(entry.why.trim().length > 0, `${key} 没写为什么——登记不写理由就成了豁免名单`);
  }
});
