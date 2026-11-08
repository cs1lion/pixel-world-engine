/** 日常作息：没活干的时候她去哪、待多久。
 *
 * 这里是"世界不惩罚你"的那一半——她过日子不花 token，也不因为你没来而退化。
 * 纯函数决定下一个落点，模拟层只负责走过去。
 */

import type { GridPoint, PlacedBuilding } from './types.ts';
import { hasEnvironment, type EnvironmentFlag, type EnvironmentFrame } from './environment.ts';
import type { SiteId } from './timetable.ts';
import { PACE } from './pace.ts';
// 场所开关从 EnvironmentFrame 的 flag 读：同一刻只有一份读数，不在这里按相位再算一次。

export type RoutineId = 'altar' | 'garden' | 'market' | 'river' | 'promenade' | 'courtyard' | 'shelter';

export interface RoutineBeat {
  readonly id: RoutineId;
  readonly label: string;
  /**
   * 赶路时牌子说的那句。**与 `label` 成对，缺一个就是假话。**
   *
   * `label` 说她到了之后在做什么，`going` 说她此刻正往哪儿去。只挂 `label`
   * 的那一版，在路上的拍多于站着带牌子的拍（`test/routine-going-label.test.ts`
   * 钉的就是这一条，判据就一句 `moved > stillLabelled`），于是牌子有字的那
   * 些拍全在演「她已经站在那儿了」——而她的坐标正在动。
   *
   * 同一个文件里的 `sheltering` 早就这么分了：出发挂「跑向屋檐下躲雨」，
   * `path` 空掉那一刻换成「在屋檐下看雨」。作息这条路当初漏了。
   *
   * **必填**，让「新落点忘了配赶路那句」在类型上就过不去。设定集的落点没有
   * 目的地名字（`SettingRoutineStop` 只有坐标），那边由 `routineProfiles`
   * 统一填「赶路」——`villager-words.ts` 的 `toWork` 没场地时也是这么说的。
   */
  readonly going: string;
  readonly target: GridPoint;
  readonly dwellMs: number;
  readonly tide?: 'low' | 'high';
  /**
   * 这一拍属于哪个场所。场所关着时退回锚点，与潮汐条件不成立时同一条口径。
   *
   * 「开不开」不在作息里判：`environment.ts` 已经从 `siteStateAt` 折成 flag，
   * 这里只读 flag——同一刻只有一份读数。
   */
  readonly site?: SiteId;
}

/**
 * 一圈日常：祭坛 → 农田边 → 河湾 → 街口 → 早市摊子 → 回祭坛。不涉及铺子，
 * 铺子只在干活时进。
 *
 * 河湾那一拍是**真的出门**，不是又换一块牌子：镇北那片泥滩就在这条路线边上，
 * 走过去、站住、再回街口。它顺带让「白天镇子上有人走动」这件事有了密度——
 * 原来四拍一圈、夜里还得睡，非安静段的离场率只有 1.09 次/世界小时；补上河湾
 * 与市面这两拍、并把落点收拢成一条不打折的环线之后，实测 1.23 次/世界小时
 * （`func-daily-l2.test.ts`）。是白天真的更忙，不是把夜里重新叫醒。
 *
 * 停留时长从 `pace.ts` 的 `PACE.dwellMinMs` 起算：一站 20–40 世界分钟
 * （倍率 60 下是现实里的 20–40 秒）。六拍都取区间下沿 20 分钟——离场率的
 * 分母是 22 个世界小时，而 22:00–05:00 已改成睡觉，白天必须站得短一些才
 * 撑得起「镇子在动」。
 */
export function routineBeats(altar: GridPoint, grid: RoutineMap): readonly RoutineBeat[] {
  const garden = grid.nearestWalkable({ x: altar.x - 8, y: altar.y + 4 });
  const promenade = grid.nearestWalkable({ x: altar.x + 8, y: altar.y - 3 });
  // 市面那一拍落在街口往里一格的摊位上，与「在街口站着」不是同一格：同一格
  // 会让她站着不动、这一次出门连一步都没多走，开市就只是换了块牌子。
  const stall = grid.nearestWalkable({ x: altar.x + 9, y: altar.y - 2 });
  // 河湾那一拍落在泥滩边上：`setup.ts` 的 LARGE_WORLD_SPEC 在 (53,30) 附近
  // 铺了一小片湿泥，`nearestWalkable` 会挑到岸上的可走格（不是让人站进泥里）。
  const riverside = grid.nearestWalkable({ x: altar.x + 4, y: altar.y - 4 });
  const dwellMs = PACE.dwellMinMs;
  return [
    { id: 'altar', label: '在祭坛边坐着', going: '去祭坛', target: altar, dwellMs: dwellMs },
    {
      id: 'garden',
      label: '去看了一眼农田',
      going: '去农田边',
      target: garden ?? altar,
      dwellMs: dwellMs,
    },
    {
      id: 'river',
      label: '在河湾看了看水',
      going: '去河湾',
      target: riverside ?? garden ?? altar,
      dwellMs: dwellMs,
    },
    {
      id: 'promenade',
      label: '在街口站着看了一会儿',
      going: '去街口',
      target: promenade ?? altar,
      dwellMs: dwellMs,
    },
    {
      id: 'market',
      label: '在早市摊子前守着',
      going: '去街口赶早市',
      target: stall ?? promenade ?? altar,
      dwellMs: dwellMs,
    },
    {
      id: 'altar',
      label: '回到祭坛等神谕',
      going: '回祭坛',
      target: altar,
      dwellMs: dwellMs,
    },
  ];
}

export interface RoutineMap {
  nearestWalkable(target: GridPoint): GridPoint | null;
}

/**
 * 市面那一拍的说法跟着帧里的场所开关走；闭市时**这一拍整天不存在**。
 *
 * 开市、夜市各是一段真的出门：人离开环线，多走一趟街口的摊位，停 20 分钟
 * 再回到环线上。落点与说法同一份事实——早市说守着摊子，夜市说看摊，闭市
 * 就不说，那一拍直接跳过。四个节点因此不只是四行字：08:00 之后街口多一处
 * 停留（人流密度变了），22:00 之后摊位那一拍消失。
 */
export function withMarketWords(beat: RoutineBeat, frame: EnvironmentFrame): RoutineBeat | null {
  if (beat.id !== 'market') return beat;
  if (hasEnvironment(frame, 'marketOpen')) return beat;
  if (hasEnvironment(frame, 'nightMarket')) {
    return { ...beat, label: '在夜市灯下看摊', going: '去夜市' };
  }
  return null;
}

/** 下雨时她只想去能避雨的地方：最近的门廊。 */
export function shelterTarget(
  buildings: readonly PlacedBuilding[],
  from: GridPoint,
): GridPoint | null {
  let best: GridPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const building of buildings) {
    const distance = Math.abs(building.door.x - from.x) + Math.abs(building.door.y - from.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = building.door;
    }
  }
  return best;
}

/**
 * 按天气与潮汐挑下一拍。
 *
 * `shelterAt` 是下雨时她要躲的那道门，**由调用方给**：本文件不认识建筑，
 * 自己编一个落点就是让牌子说一套、脚走一套。调用方给不出（一栋楼都没有）
 * 时退回锚点，牌子也照锚点说——世界可以在做不到时说「现在不行」，
 * 不能一边说屋檐一边把人放在露天里。
 *
 * 帧里的 `quiet` 是 12:00–14:00 的安静段：不下雨时大家都回锚点坐着，停到
 * `PACE.quietDwellMs`。雨天优先——躲雨是比「正午歇着」更硬的事。
 */
export function routineFor(
  frame: EnvironmentFrame,
  beats: readonly RoutineBeat[],
  index: number,
  shelterAt: GridPoint | null = null,
): RoutineBeat {
  // 暴雨一样躲，只是说法不同——这一档是雨的强度，不是新行为。
  if (hasEnvironment(frame, 'wet')) {
    const storm = frame.weather === 'storm';
    // 落点是那道门；没门才退回锚点，并且连说法一起退回。
    if (shelterAt !== null) {
      return {
        id: 'shelter',
        label: storm ? '缩进屋檐下躲暴雨' : '躲到屋檐下看雨',
        going: storm ? '跑向屋檐下躲暴雨' : '跑向屋檐下躲雨',
        target: shelterAt,
        dwellMs: PACE.dwellDefaultMs,
      };
    }
    const anchor = beats[0]!;
    return {
      id: 'shelter',
      label: storm ? '在祭坛边缩着等暴雨过去' : '在祭坛边看雨',
      // 没门可躲时落点是锚点，所以赶路那句也得说锚点——说屋檐就是一边把她
      // 往祭坛送、一边告诉外面她去了屋檐。
      going: '去祭坛边',
      target: anchor.target,
      dwellMs: PACE.dwellDefaultMs,
    };
  }
  // 安静段：不下雨就回锚点坐着。落点与说法都借锚点那一拍——这不是新玩法，
  // 只是「正午不赶路」；多出来的只有停留时长。
  if (hasEnvironment(frame, 'quiet')) {
    const anchor = beats[0]!;
    return {
      id: anchor.id,
      label: anchor.label,
      going: anchor.going,
      target: anchor.target,
      dwellMs: PACE.quietDwellMs,
    };
  }
  const beat = beats[index % beats.length]!;
  const tide = beat.tide;
  // 潮汐条件不成立的落点，一律退回锚点（beats[0]），并把说法换成锚点那一句。
  //
  // 早先这里只改 label、留着原来的 target：牌子写「沿街」，人照样往浅滩走。
  // 世界可以在做不到时说「现在不行」，但不能一边说一边做别的——
  // 那句话是给外面看的唯一凭据，说谎比不去更糟。
  if (!tideBeatApplies(tide, frame)) return fallbackTo(beats, beat);
  if (!siteBeatApplies(beat.site, frame)) return fallbackTo(beats, beat);
  return beat;
}

/**
 * 场所 → 环境帧 flag（**任一命中即算开**）。
 *
 * 表里没有的场所当场 throw，空表也 throw——空数组是「永不开的静默门」，
 * 配置写错时没人会发现，所以装载期就拦掉。
 *
 * 集市是两态：午后（`marketOpen`）与入夜灯笼点亮（`nightMarket`），两个 flag
 * 都算开；`some` 的语义与顺序无关，不许写成「取第一个」。
 */
export const SITE_FLAGS: Readonly<Record<string, readonly EnvironmentFlag[]>> = {
  market: ['marketOpen', 'nightMarket'],
  courtyard: ['courtyardOpen'],
  workshop: ['workshopOpen'],
};

// 装载期校验：空数组就是永不开的门，直接 throw，不留到运行期变成「没人去」。
for (const [site, flags] of Object.entries(SITE_FLAGS)) {
  if (flags.length === 0) throw new Error(`场所 ${site} 的开关是空表`);
}

/**
 * 这一拍的场所此刻开着吗。
 *
 * 与 `tideBeatApplies` 并列的第二条「现在去得了吗」。两个都只读帧 flag：
 * 场所的时段在 `SITE_TABLE`，折成 flag 的是 `environment.ts`，这里不按分钟再判。
 * 场所没登记就 throw——否则新加的场所会悄悄退回锚点，牌子还写着花径。
 */
export function siteBeatApplies(site: SiteId | undefined, frame: EnvironmentFrame): boolean {
  if (site === undefined) return true;
  const flags = SITE_FLAGS[site];
  if (flags === undefined) throw new Error(`环境帧里没有场所 ${site} 的开关`);
  if (flags.length === 0) throw new Error(`场所 ${site} 的开关是空表`);
  return flags.some((flag) => frame.flags.has(flag));
}

/**
 * 一个作息落点的潮汐条件此刻成立吗。
 *
 * 这是 `src/` 下**唯一**判定「现在去得了吗」的地方。`Simulation` 的快进判定也走
 * 这儿，不另写一份字面量——两处各写一遍时，改一处忘另一处，世界就会一边说
 * 「现在不行」一边把她送过去。两个门槛收在 `tide.ts`（`TIDE_LOW_MAX` /
 * `TIDE_HIGH_MIN`），由 `environment.ts` 折成 `lowTide` / `highTide` 两个 flag；
 * 这里只读 flag，不再读潮位数字，调用处也不许再写一遍。
 *
 * （`test/routine-tide-single-source.test.ts` 也 import 它，但那是为了验「没有
 *   第三份」，不是为了判行为。所以「全仓唯一」在字面上是假的，写 `src/` 下唯一。）
 *
 * 没写 `tide` 的落点恒真：它不挑潮位。
 */
export function tideBeatApplies(tide: RoutineBeat['tide'], frame: EnvironmentFrame): boolean {
  if (tide === 'low') return frame.flags.has('lowTide');
  if (tide === 'high') return frame.flags.has('highTide');
  return true;
}

/** 退回锚点：借锚点的 id、label、going、target，只保留原落点的停留时长。 */
function fallbackTo(beats: readonly RoutineBeat[], beat: RoutineBeat): RoutineBeat {
  const anchor = beats[0]!;
  return {
    id: anchor.id,
    label: anchor.label,
    going: anchor.going,
    target: anchor.target,
    dwellMs: beat.dwellMs,
  };
}
