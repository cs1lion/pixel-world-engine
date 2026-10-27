/**
 * 牌子什么时候有、什么时候没有——日报与状态行都靠它决定「她在哪儿」。
 *
 * `report.ts` 的 `idleClauses` 与 `villager-words.ts` 的 `idleLabel` 是同一句：
 * 有牌子照牌子说，没牌子才退回去问祭坛。所以「没牌子」发生在哪些拍上，
 * 直接决定纸上那句话是真的还是编的。
 *
 * 这里钉三件事：
 *   1. 没牌子只发生在起手一段，那之后每一拍都有——**不是**「一直有值」；
 *   2. 那段空窗的长度就是 `nextRoutineAt` 的错峰（`1200 + index * 1400`），
 *      两个人不一样长，所以「多少拍有牌子」按人分别说，报不出一个合并数——
 *      `report.ts` 报的 14801 / 13401 就是 16001 减这两个数，这里按人钉住；
 *   3. 空窗里她还在祭坛上——所以「没牌子就说祭坛」这个退路在空窗里是**真的**，
 *      它假的形状要走撤单那条路（`abandonActiveTask`），不是空窗。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { atAltar } from '../src/world/villager-words.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

const TOTAL = 16000;

interface Gap {
  readonly from: number;
  to: number;
}

/** 一遍跑完，把每个村民「没牌子的拍」的极大连续段、以及空窗里在不在祭坛，一次收齐。 */
function survey(): {
  readonly gaps: ReadonlyMap<string, readonly Gap[]>;
  readonly labelled: ReadonlyMap<string, number>;
  readonly offAltarInGap: readonly string[];
} {
  const sim = makeSim();
  const gaps = new Map<string, Gap[]>();
  const labelled = new Map<string, number>();
  const offAltarInGap: string[] = [];
  for (let t = 0; t <= TOTAL; t += 1) {
    const snapshot = sim.snapshot();
    for (const villager of snapshot.villagers) {
      // 「没牌子」就是 `idleLabel` 会退回问祭坛的那一刻：routine 是 null。
      // 判据跟生产同源（那边是 `routine ?? atAltar(...)`），所以这里也别自己
      // 另写一套——另写一套，改的就不是被守的那一个了。
      const hasLabel = villager.routine !== null;
      const own = gaps.get(villager.name) ?? [];
      const open = own.length > 0 ? own[own.length - 1]! : undefined;
      if (!hasLabel) {
        if (open !== undefined && open.to === t - 1) {
          open.to = t;
        } else {
          own.push({ from: t, to: t });
        }
      }
      // 有牌子的一拍既不开新区间、也不延长上一段：极大连续段到此为止。

      gaps.set(villager.name, own);

      // 空窗闭区间是 [from, to]；跑到 t 时最后一段可能还没合上，而上面已经把它
      // 写到 t 了（同一个数组，`some` 读的是写后的状态），所以这里按「t 落在
      // 任一段里」判，不会漏掉正在写的那一拍。
      const inGap = own.some((gap) => t >= gap.from && t <= gap.to);
      if (inGap) {
        if (!atAltar(villager, snapshot)) offAltarInGap.push(`${villager.name}@${t}`);
      } else if (hasLabel) {
        labelled.set(villager.name, (labelled.get(villager.name) ?? 0) + 1);
      }
    }
    sim.update(1);
  }
  return { gaps, labelled, offAltarInGap };
}

const seen = survey();

test('没牌子只发生在起手一段，那之后每一拍都有', () => {
  assert.equal(seen.gaps.size, 2, '夹具：两个村民');
  for (const [name, own] of seen.gaps) {
    assert.equal(own.length, 1, `${name} 该只有一段空窗，实得 ${own.length} 段`);
    assert.equal(own[0]!.from, 0, `${name} 那段该从第 0 拍起`);
    assert.ok(own[0]!.to < TOTAL, `${name} 空窗该在 ${TOTAL} 拍内合上，实得合到 ${own[0]!.to}`);
  }
});

test('空窗长度就是 nextRoutineAt 的错峰：1200 + index * 1400', () => {
  const names = [...seen.gaps.keys()];
  names.forEach((name, index) => {
    const own = seen.gaps.get(name)!;
    const expected = 1200 + index * 1400;
    // 闭区间、from 恒为 0，所以长度就是 to + 1。
    assert.equal(
      own[0]!.to + 1,
      expected,
      `${name} 的空窗该是 ${expected} 拍（index ${index}），实得 ${own[0]!.to + 1} 拍`,
    );
  });
});

test('空窗那一段她还在祭坛上：所以「没牌子就说祭坛」在空窗里是真的', () => {
  // 这一条是 `idleLabel` 那个退路成立的理由。它只在空窗里问——空窗之外
  // 她忙着走自己的作息，问不到祭坛上去。
  assert.deepEqual(seen.offAltarInGap, [], '空窗里有人离开过祭坛——退路就假了');
});

test('合上之后每一拍都有牌子：report.ts 报的 14801 / 13401 就是这么减出来的', () => {
  const names = [...seen.gaps.keys()];
  names.forEach((name, index) => {
    // 空窗是闭区间、from 恒为 0，所以「有牌子的拍」就是剩下的每一拍。
    // 这条同时防前两条退化成「她从第 0 拍起就永远没牌子」也过得去。
    assert.equal(
      seen.labelled.get(name) ?? 0,
      TOTAL + 1 - (1200 + index * 1400),
      `${name} 该在其余每一拍都有牌子（index ${index}）`,
    );
  });
  // 报在纸上的那两个数按人分别钉住：两个人空窗不一样长，合并数没有意义。
  assert.equal(seen.labelled.get('莞尔'), 14801, 'report.ts 说莞尔 14801 拍有牌子');
  assert.equal(seen.labelled.get('阿雾'), 13401, 'report.ts 说阿雾 13401 拍有牌子');
});
