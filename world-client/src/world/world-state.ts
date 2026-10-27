/** 世界的自我描述：把原始快照归纳成「世界现在长什么样」。
 *
 * 为什么需要：造物主要做选择，得先看得见世界。原始快照里有建筑数组、任务数组，
 * 但「哪类活还没有郊野铺子」「郊野还剩多少空地」这样的判断，不该让造物主自己
 * 从数组里数——那是把领域知识散到调用方去。
 *
 * 这里是**只读归纳**：不改世界，不另存真相，全部从快照推导。
 * 与 `report.ts` 同一个原则：能派生的不落档。
 */

import { LARGE_ALTAR, LARGE_WORLD_SPEC, WILD_PREFABS } from './setup.ts';
import { BIOME_RADII } from './biomes.ts';
import { TASK_PROFILES, WORKSHOP_TASKS } from './tasks.ts';
import type { GridPoint, TaskKind, WorldSnapshot } from './types.ts';

/**
 * 一块分区矩形离祭坛**最近**的那一点的距离（单位：格）。
 *
 * 分区是轴对齐矩形，所以最近点就是把两个轴各自夹进矩形范围，不必遍历格子。
 */
function nearestDistance(
  zone: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  altar: GridPoint,
): number {
  const dx = Math.max(zone.x - altar.x, 0, altar.x - (zone.x + zone.w - 1));
  const dy = Math.max(zone.y - altar.y, 0, altar.y - (zone.y + zone.h - 1));
  return Math.hypot(dx, dy);
}

/**
 * 郊野可建面积的估算基数：整块都落在工坊环**之外**的分区矩形，合计多少格。
 *
 * 这里原来写死 `384`，而 `LARGE_WORLD_SPEC` 的四块郊野分区是 9×8×4 = **288**。
 * 384 = 288×4/3，多出的正好是三分之一。
 *
 * **这个数从落地那天起就是错的，不是「后来没跟着改」。** 我第一版注释写的是
 * 「分区矩形的尺寸改过，这个数没跟着改」——那句话是我编的：`LARGE_WORLD_SPEC`
 * 那一块在 `setup.ts` 全部 8 个 commit 里逐字节相同（`3bc504d8`），384 和四块
 * 矩形出生在同一个 commit（`996cbd3`），谁都没动过。真相更简单也更难看：
 * 它一开始就没对过。写「跟不上规格」会把一个从头的错讲成一次漂移，而漂移听起来
 * 像意外，从头的错是没核过——这两件事该分开说。
 *
 * 它唯一的闸是 `test/world-state.test.ts` 的 `wildFree >= 0`，那条对 384 和 288
 * 一样绿。所以改成从规格算：改分区与改基数变成同一件事。
 *
 * 「哪块算郊野」用**离祭坛的距离**判，和 `biomeAt` 同一把尺：整块分区都在
 * `BIOME_RADII.craftRing` 之外。不按尺寸认（`w === 9`）——按尺寸认，将来谁把
 * 郊野块改成 10×8 它就又错一次，而且错得和这次一样安静。
 *
 * 这**仍是估算**，不是精确槽位数：铺子要整块落在分区里、要留白、要躲开门，
 * 那些只有网格知道，而归纳层不持有网格（`summarizeWorld` 里那段说的是这件事）。
 * 基数错了是另一回事——那不再是估算偏乐观，是估算的对象不存在。
 *
 * 但基数对了**不等于**估得准，现在还差一点：`wildFree` 数的是「还能建几栋」，
 * 而能建的那个东西（`workshop_plot`）是 `zone: 'industry'`，于是四块郊野分区里
 * 只有 industry 那一块（`18,18` 的 9×8 = 72 格）够得着，另外三块它进不去。那 72
 * 格里有 36 格已经被 gear_tower 占了。实测今天还能再建 **3** 栋
 * （落点 23,19 / 18,23 / 18,19，都在郊野圈里），而公式给 4。
 * 也就是说 384 那版多报 3 栋，现在这版多报 1 栋——方向对了，没到底。
 * 要到底得让基数跟着「能建什么」走，那是另一笔，不在这一笔里。
 */
const WILD_ZONE_AREA = LARGE_WORLD_SPEC.zones
  .filter((zone) => nearestDistance(zone, LARGE_ALTAR) > BIOME_RADII.craftRing)
  .reduce((sum, zone) => sum + zone.w * zone.h, 0);

/** 某一类活的铺子覆盖情况。 */
export interface KindCoverage {
  readonly kind: TaskKind;
  readonly town: number;
  readonly wild: number;
  readonly total: number;
}

export interface WorldState {
  readonly buildings: {
    readonly total: number;
    readonly town: number;
    readonly wild: number;
  };
  /** 每类长活的铺子覆盖。顺序与 `WORKSHOP_TASKS` 一致。 */
  readonly taskKinds: readonly KindCoverage[];
  readonly space: {
    /** 郊野已建的铺子数。 */
    readonly wildBuilt: number;
    /** 郊野还能建几栋（按分区里剩余的可建格估算，不是精确槽位）。 */
    readonly wildFree: number;
  };
  readonly activity: {
    readonly total: number;
    readonly busy: number;
    readonly idle: number;
  };
  /**
   * 缺口：造物主该补什么。
   *
   * 只列**确定缺的**：某类活没有郊野铺子。不猜「应该再多一栋」——
   * 那是审美判断，不该由归纳层替造物主做。
   */
  readonly gaps: {
    readonly missingWild: readonly TaskKind[];
  };
}

/** 把快照归纳成世界状态。纯函数，可离线测。 */
export function summarizeWorld(snapshot: WorldSnapshot): WorldState {
  const workshops = snapshot.buildings.filter((b) => b.boundTask !== null);

  const isWild = (prefabId: string): boolean => WILD_PREFABS.has(prefabId);
  const town = workshops.filter((b) => !isWild(b.prefabId)).length;
  const wild = workshops.filter((b) => isWild(b.prefabId)).length;

  const taskKinds: KindCoverage[] = WORKSHOP_TASKS.map((kind) => {
    const ofKind = workshops.filter((b) => b.boundTask === kind);
    const wildCount = ofKind.filter((b) => isWild(b.prefabId)).length;
    return {
      kind,
      town: ofKind.length - wildCount,
      wild: wildCount,
      total: ofKind.length,
    };
  });

  // 郊野还剩多少空地：按已建铺子的占地格数反推。这是估算，
  // 不是精确槽位数——精确值要问网格，而归纳层不持有网格。
  const wildFootprint = snapshot.buildings
    .filter((b) => isWild(b.prefabId))
    .reduce((sum, b) => sum + b.footprint.w * b.footprint.h, 0);

  const busy = snapshot.villagers.filter((v) => v.mode !== 'idle').length;

  return {
    buildings: {
      total: snapshot.buildings.length,
      town,
      wild,
    },
    taskKinds,
    space: {
      wildBuilt: wild,
      // 基数 WILD_ZONE_AREA（288，从 LARGE_WORLD_SPEC 算的，不是写死的）；
      // 减去已占与留白，按 40 格一栋粗估。
      wildFree: Math.max(0, Math.floor((WILD_ZONE_AREA - wildFootprint * 3) / 40)),
    },
    activity: {
      total: snapshot.villagers.length,
      busy,
      idle: snapshot.villagers.length - busy,
    },
    gaps: {
      missingWild: taskKinds.filter((entry) => entry.wild === 0).map((entry) => entry.kind),
    },
  };
}

/**
 * 每类活对应的**郊野**模板 id。
 *
 * 补缺时界面据此决定建哪栋。与 `setup.ts` 的 `WILD_PREFABS` 同源：
 * 那边是"哪些是郊野铺子"，这边是"哪类活该建哪栋"。
 */
export const WILD_PREFAB_OF: Readonly<Record<TaskKind, string>> = {
  code: 'gear_tower',
  research: 'crawler_mine',
  writing: 'ink_mill',
  quick: 'workshop_plot',
};

/**
 * 这座世界**补得上**哪些缺口。
 *
 * 只列补得上的：`WILD_PREFAB_OF` 指的那栋蓝图得真在登记册里。灯潮界七栋楼里
 * 没有 gear_tower / crawler_mine / ink_mill，而三类活它全「缺」——于是界面上
 * 并排三个「补缺：建X铺子」按钮，点下去个个撞一句「没有这份蓝图。」。
 *
 * 世界说得出「缺什么」却说不出「拿什么补」的时候，给一个必然失败的按钮比不给
 * 更糟：那是一句屏上的空头承诺，而用户照着它点了。「说谎比不去更糟」在这里
 * 不是比喻——不去（不建）是世界正当的行为，说谎不是。
 *
 * `missingWild` 本身不改：那一行摘要是句真话（这世界确实没有查资料的郊野铺子）。
 * 要收起来的只是那个承诺。
 */
export function fillableGaps(
  missing: readonly TaskKind[],
  buildable: readonly string[],
): readonly TaskKind[] {
  const have = new Set(buildable);
  return missing.filter((kind) => {
    const prefabId = WILD_PREFAB_OF[kind];
    return prefabId !== undefined && have.has(prefabId);
  });
}

/**
 * 给界面用的一行摘要。
 *
 * 一行说完：镇内几栋、郊野几栋、还剩多少空地、缺什么。
 * 缺什么用纸面说法（「查资料」），不是内部枚举名——这一行是给人看的。
 */
export function describeWorldState(state: WorldState): string {
  const parts: string[] = [
    `镇内 ${state.buildings.town} 栋`,
    `郊野 ${state.buildings.wild} 栋`,
  ];
  // 每类活各几栋：这一行是玩家判断"世界长什么样"的主要依据，
  // 只说总数等于没说——3 栋可能是三类各一栋，也可能是两类各一栋加一栋空的。
  const perKind = state.taskKinds
    .map((entry) => `${TASK_PROFILES[entry.kind].label} 镇内${entry.town} / 郊野${entry.wild}`)
    .join('、');
  parts.push(`（${perKind}）`);
  parts.push(`空地约 ${state.space.wildFree} 栋`);
  if (state.gaps.missingWild.length > 0) {
    const labels = state.gaps.missingWild.map((kind) => TASK_PROFILES[kind].label);
    parts.push(`缺${labels.join('、')}的郊野铺子`);
  }
  return parts.join('　·　');
}
