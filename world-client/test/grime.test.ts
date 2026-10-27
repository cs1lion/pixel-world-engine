import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRIME_FILL_MS,
  GRIME_FULL,
  grimeAfter,
  landProp,
  revealFor,
} from '../src/world/grime.ts';
import type { WorldProp } from '../src/world/types.ts';

/**
 * 清洗即还原（SPEC_V2 §4.6）的纯函数半边。
 *
 * 这一层是世界自己的账：污浊度怎么攒、露话怎么选、一件摆件落地时是什么样子。
 * 它不读墙钟、不碰网格、不知道命令——所以能离线单测，而 `simulation.ts`
 * 里那条「三个新状态位不许读墙钟」的扫描（`purity.test.ts` 的 OWNERS）
 * 也罩得住它。
 *
 * 另一半（`cleanProp` 命令怎么进世界）在 `simulation.ts` 的命令入口上测，
 * 见 `grime-command.test.ts`。
 */

function prop(patch: Partial<WorldProp> = {}): WorldProp {
  return {
    id: 'prop-0',
    kind: 'lamp',
    at: { x: 4, y: 4 },
    label: '一盏路灯',
    sourceTaskKind: 'code',
    sourceTaskId: 't1',
    sourceSummary: '写个爬虫',
    grime: 0,
    reveal: null,
    ...patch,
  };
}

// ------------------------------------------------------------ 攒脏

test('污浊度按世界时间攒，攒满就停在 1，不溢出去', () => {
  // 0..1 是个画画的量：渲染层按它定噪点的浓淡。溢出去的部分没有任何用处，
  // 而浮点累加攒到 1.0000000002 是必然的——所以这里必须夹住。
  assert.equal(grimeAfter(0, 0), 0, '一拍没走就还是干净的');
  assert.equal(grimeAfter(0, GRIME_FILL_MS / 4), 0.25, '走过四分之一的路程');
  assert.equal(grimeAfter(0, GRIME_FILL_MS), GRIME_FULL, '走满了就满');

  const over = grimeAfter(0, GRIME_FILL_MS * 10);
  assert.equal(over, GRIME_FULL, '走过十倍也还是 1，不是 10');

  const fromFull = grimeAfter(GRIME_FULL, GRIME_FILL_MS);
  assert.equal(fromFull, GRIME_FULL, '已经满了就停在满上');
});

test('洗干净之后照旧往回攒：洗干净是一个时刻，不是永久状态', () => {
  // 这一条是「清洗即还原」这个名字的另一半。只落不攒的话，洗过一次就永远干净，
  // 那 `grime: 0..1` 该是个布尔——而这个字段是数，渲染层要拿它渐变。
  const washed = 0;
  assert.equal(grimeAfter(washed, GRIME_FILL_MS / 2), 0.5, '半个周期又脏回去一半');
  assert.equal(grimeAfter(washed, GRIME_FILL_MS * 3), GRIME_FULL, '三个周期足够再攒满');
});

test('一步攒多少只由走了多久决定，与从哪儿起步无关', () => {
  // 线性是这条规则的全部内容。换成别的曲线（比如越脏攒得越快）会让同一个
  // 存档在不同时长下走出不同的形状，而这里没有任何理由要那种复杂。
  const step = GRIME_FILL_MS / 10;
  let grime = 0;
  const seen: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    grime = grimeAfter(grime, step);
    seen.push(Number(grime.toFixed(6)));
  }
  assert.deepEqual(seen, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
});

// ------------------------------------------------------------ 露话

test('池子里一件都没有时没有露话：不编', () => {
  // 设定集没给话，这个世界就没有话可露。硬造一句就是引擎在编设定集的内容。
  assert.equal(revealFor(undefined, 0), null, '连池子都没给');
  assert.equal(revealFor([], 3), null, '给了个空池子');
});

test('露话按序从池子里取，取完回头：同一个存档回放出同一句', () => {
  const pool = ['甲', '乙', '丙'];
  assert.equal(revealFor(pool, 0), '甲', '第一件');
  assert.equal(revealFor(pool, 1), '乙');
  assert.equal(revealFor(pool, 2), '丙', '池子用完了');
  assert.equal(revealFor(pool, 3), '甲', '回头，不越界');
  assert.equal(revealFor(pool, 7), '乙', '第七件——按余数，不按第几圈');
});

// ------------------------------------------------------------ 落地

test('一件带露话的摆件落地就是脏的：话在脏底下，不在明面上', () => {
  // 「洗到干净才露出来的那句话」（GLOSSARY 的露话条）。落地就干净的话，
  // 那句话打一开始就看得见——「洗到 0 才露出」成了句空话，
  // 而清洗这个动作也变得测不出来：洗之前与洗之后一个样。
  const landed = landProp(prop(), ['井底下压着一句话'], 0);
  assert.equal(landed.grime, GRIME_FULL, '刚落地是脏的');
  assert.equal(landed.reveal, '井底下压着一句话', '话已经在那儿了，只是看不见');
});

test('一件没有露话的摆件落地是干净的：没有什么要盖，就不攒脏', () => {
  // 污浊度是**盖住露话的那层东西**。设定集没给话，这件摆件就没有什么可盖——
  // 给它攒脏只会得到一个「洗了也不怎样」的物件，那是噪音不是意思。
  // 莞尔镇（默认设定集）一句话都没给，所以它世界里一件摆件都不脏。
  const bare = landProp(prop(), undefined, 0);
  assert.equal(bare.grime, 0, '没有露话就不脏');
  assert.equal(bare.reveal, null, '也没有话');

  const empty = landProp(prop(), [], 5);
  assert.equal(empty.grime, 0, '空池子等于没给');
});

test('落地不改别的字段：来源、位置、名字原样带着', () => {
  // `landProp` 只动 grime 与 reveal 两个槽。多改一个字段，将来就有一处
  // 「摆件怎么凭空换了名字」的怪事，而它的源头在这里。
  const before = prop();
  const landed = landProp(before, ['一句话'], 0);
  assert.equal(landed.id, before.id);
  assert.equal(landed.kind, before.kind);
  assert.equal(landed.at, before.at, '位置是同一个对象，没有被复制走');
  assert.equal(landed.label, before.label);
  assert.equal(landed.sourceSummary, before.sourceSummary);
  assert.deepEqual(Object.keys(landed).sort(), Object.keys(before).sort(), '不多一个槽也不少一个槽');
});

test('露话按摆件的序数取：第七件摆件配第七句话，不是第一句', () => {
  // 序数是「它落地时世界上已经有几件」。同一个存档读回来件数一样，
  // 所以这句话跨存档稳定——这是它能进存档的前提。
  const pool = ['甲', '乙'];
  assert.equal(landProp(prop(), pool, 0).reveal, '甲');
  assert.equal(landProp(prop(), pool, 1).reveal, '乙');
  assert.equal(landProp(prop(), pool, 2).reveal, '甲');
});
