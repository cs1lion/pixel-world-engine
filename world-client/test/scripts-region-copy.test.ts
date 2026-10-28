/**
 * `scripts/` 里不许有第二份手抄的区域名清单。
 *
 * ## 为什么单查这一样
 *
 * `pack-owns-world-data.test.ts` 扫的是 `src/`（产品代码），明写不扫 `scripts/`
 * 与 `test/`。那是对的：`test/` 是夹具，本该引用设定集的数据；`scripts/` 是工具，
 * 其中 `audit-palette.mjs` 那一份 24 色正是它自己要审的东西。
 *
 * 但 `scripts/check-dengchao.mjs` 是**例外**，它值得例外的原因值得说清：
 *
 *      ['渡口站台', '浅滩轨道', '叠浪楼', '灯街', '积尘滩'].every((name) => labels.includes(name))
 *
 * 它只查「这五个**都在**」。于是包里添第六道区域时它一声不响，静默少查一项；
 * 改一个名字时它才红。**「只在」与「都在」不是同一句话。** 那一处已经由
 * `pack-owns-world-data.test.ts` 最后一条测试双向钉住了（名单与包里的区域名
 * 一模一样，多一个红、少一个也红）。
 *
 * 可钉住一处不等于防住一类。所以这一条把**类**守住：`scripts/` 里凡是引用到
 * 两个以上区域名的，只能有已知的那一份。多出第二份就红——红的时候该做的是让
 * 它跟 `check-dengchao.mjs` 一样被双向钉住，或者干脆从包里读，不是把这条改绿。
 *
 * ## 为什么阈值是「两个以上」而不是「一个以上」
 *
 * 脚本里提**一个**区域名（「跳到渡口站台，看那儿有没有人」）是普通的场景步骤：
 * 区域改名时它的选择器会失败，**会响**。会响的破坏不需要这一条。
 *
 * 手抄**一份清单**才是静默的那类：清单只被用来查「在不在」，多出来的项没人管。
 * 一份清单至少得有两个名字，所以阈值取二。这个阈值是推断，不是实测——实测只能
 * 告诉你今天有几份（一份），没法告诉你第二份长什么样。所以阈值放宽到二：
 * 宁可漏掉一份只抄一个名字的清单，也不要为一个正常的场景步骤报警。
 *
 * ## 现状（2026-10-28 实扫，28 个脚本文件）
 *
 * 逐个扫过 `scripts/*.mjs` 与 `scripts/*.ts`，命中区域名的只有
 * `check-dengchao.mjs` 一处（5 个名字全在同一行）。其余脚本的世界数据引用分三种，
 * 都不在这一条的判据里：
 *
 * - `audit-palette.mjs` 那一份 24 色——它**就是**审色板的工具，那是它的输入。
 *   （2026-10-28 补记：这句原来读起来像「所以它不用被守」。**那一份是承重的**：
 *   `outOfBudget()` 拿它筛色，筛出来多少就是 `--strict` 的退出码。已由
 *   `palette-budget.test.ts` 末尾两条补上——它那份多一个 `WORLD` 里没有的色值，
 *   代码里正在用的色就被它当成预算内，而那一版全套绿。别再把这两句读成赦免。）
 * - `palette-capture.mjs` / `palette-serve.mjs` 里的单个色值——同上，取色工具。
 * - `accept-live.mjs` / `smoke.mjs` / `smoke-ego.mjs` / `check-creation.mjs` /
 *   `capture-palette.mjs` 里的预制体 id（`workshop_plot` / `waiting_shelter`）——
 *   那是**点名一个合法 id 去驱动验收**。id 一旦失效，建造就失败、断言就红，
 *   会响。其中 `accept-live.mjs` 那处还是好范式：注释明写「不钉总数」，
 *   断言按「含灯潮界的、不含默认世界的」来写。
 *
 * 换句话说：这一条今天是**空的**（已知清单里那一处已被另一条测试管着）。
 * 空判据不等于没用——它守的是"第二份不许出现"，而那只在未来有意义。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';

const SCRIPTS = new URL('../scripts/', import.meta.url);

/** 引用到两个以上区域名的脚本 → 为什么可以破例。双向 diff。 */
const KNOWN_REGION_COPIES: Readonly<Record<string, { readonly why: string }>> = {
  'check-dengchao.mjs': {
    why: '浏览器冒烟验收，验「五个区域标签真的画在 DOM 上」。那份名单由 '
      + 'pack-owns-world-data.test.ts 最后一条测试双向钉住（与包里的区域名一模一样），'
      + '所以这一处破例是有担保的，不是没人管。',
  },
};

test('scripts/ 里手抄区域名清单的，只有 KNOWN_REGION_COPIES 里那一处', () => {
  const regions = DENGCHAO_RAW.regions.map((r) => r.name);
  assert.ok(regions.length >= 2, '包里的区域名少于两个——这一条的判据失去意义，回来重写它');

  // 只认引号里的区域名。注释里提到两个区域不算手抄清单——那是散文。
  const scripts: string[] = [];
  for (const file of readdirSync(SCRIPTS)) {
    if (!/\.(mjs|ts)$/.test(file)) continue;
    const text = readFileSync(new URL(file, SCRIPTS), 'utf8');
    const named = regions.filter((name) => text.includes(`'${name}'`) || text.includes(`"${name}"`));
    if (named.length >= 2) scripts.push(file);
  }

  const appeared = scripts.filter((f) => !(f in KNOWN_REGION_COPIES));
  assert.deepEqual(
    appeared,
    [],
    `这些脚本各自手抄了 ${regions.length >= 2 ? '两个以上' : ''}区域名：${appeared.join('、')}。`
      + '一份只被用来查「在不在」的清单，会在包里添区域时静默少查一项。'
      + '让它跟 check-dengchao.mjs 一样被双向钉住（名单与包里一模一样），'
      + '或者改成从包里读——别把这条改绿。',
  );

  const gone = Object.keys(KNOWN_REGION_COPIES).filter((f) => !scripts.includes(f));
  assert.deepEqual(
    gone,
    [],
    `这些脚本已经不手抄区域名了，KNOWN_REGION_COPIES 里的记录过期了，删掉对应行：${gone.join('、')}`,
  );
});

/**
 * 那一处破例仍然是被钉住的那一种，且**兜着它的那条测试还在**。
 *
 * ## 这一条**不**防什么（2026-10-28 实测，不是推理）
 *
 * 它**不防「清单被削弱」**。把五个名字改成三个，这一条照样全绿——`.every(...)`
 * 的形状还在，判据只认形状。实测：改完跑这一条 2/2 过。
 *
 * 削弱由 `pack-owns-world-data.test.ts` 那条双向钉住的测试兜着，同样改法下它红
 * （实测）。所以这一处破例是有担保的——但担保在**另一个文件里**，这正是本条要
 * 钉的东西：那条测试被删掉、被改名、或者不再拿名单跟包里比的时候，本文件的
 * KNOWN 表一声不响，而它已经不再有担保了。
 *
 * 顺带也防**形状被换掉**：有人把那句重写成 `labels.length === 5` 之类，
 * 双向 diff 可能还在（五个名字仍在文件里），而它已经不再钉名单了。
 *
 * （第一版这一条的注释写的是「明天有人把清单改成『只查前三个』……它会红」。
 *   **那句话是假的**，实测改完它没红。已按实测改写——又把功劳安错了地方。）
 */
test('那一处破例仍然是被钉住的那一种，且兜着它的测试还在', () => {
  const script = readFileSync(new URL('check-dengchao.mjs', SCRIPTS), 'utf8');
  assert.match(
    script,
    /\.every\(\(name\)\s*=>\s*labels\.includes\(name\)\)/,
    'check-dengchao.mjs 里那句「五个区域标签都在」的写法找不到了。'
      + '它换写法的那一刻，pack-owns-world-data.test.ts 那条双向钉住它的测试也会红——'
      + '先去把那一处改对，再回来看 KNOWN_REGION_COPIES 这一行还算不算数。',
  );

  // 担保在另一个文件里，所以把担保本身钉住：那份文件里得还有一条测试，
  // 既认得这个锚点、又拿名单跟包里的区域名比。
  const backing = readFileSync(new URL('../test/pack-owns-world-data.test.ts', import.meta.url), 'utf8');
  assert.match(
    backing,
    /test\('[^']*check-dengchao\.mjs[^']*'/,
    'pack-owns-world-data.test.ts 里那条钉住 check-dengchao.mjs 的测试不见了'
      + '（改名或删掉）。本文件的 KNOWN_REGION_COPIES 全靠它担保——它没了，'
      + '这一行破例就没人管了。要么把它找回来，要么把 KNOWN_REGION_COPIES 里那一行删掉。',
  );
  assert.match(
    backing,
    /\.every\(\(name\)\s*=>\s*labels\.includes/,
    'pack-owns-world-data.test.ts 里认不出那个锚点了——它改成别的写法之后，'
      + 'check-dengchao.mjs 那份名单不再被双向钉住。',
  );
});

/**
 * ## 变异记录（2026-10-28，逐个跑过）
 *
 * | 变异 | 结果 |
 * |---|---|
 * | `scripts/` 里多一个手抄两个区域名的文件 | 第一条红，点名到文件 |
 * | `check-dengchao.mjs` 的清单削成只剩一个名字 | 第一条 `gone` 红 |
 * | `check-dengchao.mjs` 的清单削成三个名字 | 第二条**不红**（只认形状）——已写进注释 |
 * | 同上，换个文件看 | `pack-owns-world-data.test.ts` 第 9 条红，担保成立 |
 * | 删掉 `pack-owns-world-data.test.ts` 里那条测试 | 第二条红（担保没了） |
 *
 * 第三行是这一条的**已知边界**，不是漏验：它摆在这儿是为了让下一个人别再把
 * 「它会红」这种话安到它头上。
 */
