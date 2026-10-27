/** 日常作息：没活干的时候她去哪、待多久。
 *
 * 这里是"世界不惩罚你"的那一半——她过日子不花 token，也不因为你没来而退化。
 * 纯函数决定下一个落点，模拟层只负责走过去。
 */

import type { GridPoint, PlacedBuilding, Weather } from './types.ts';
import { TIDE_HIGH_MIN, TIDE_LOW_MAX } from './tide.ts';

export type RoutineId = 'altar' | 'garden' | 'promenade' | 'shelter';

export interface RoutineBeat {
  readonly id: RoutineId;
  readonly label: string;
  /**
   * 赶路时牌子说的那句。**与 `label` 成对，缺一个就是假话。**
   *
   * `label` 说她到了之后在做什么，`going` 说她此刻正往那儿去。只挂 `label`
   * 的那一版，屏上四分之三的时间都在演「她已经站在那儿了」——而她的坐标
   * 正在动（`test/routine-going-label.test.ts` 钉的就是这一条）。
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
}

const DWELL_MS = 5200;

/** 一圈日常：祭坛 → 农田边 → 街角 → 回祭坛。不涉及铺子，铺子只在干活时进。 */
export function routineBeats(altar: GridPoint, grid: RoutineMap): readonly RoutineBeat[] {
  const garden = grid.nearestWalkable({ x: altar.x - 8, y: altar.y + 4 });
  const promenade = grid.nearestWalkable({ x: altar.x + 8, y: altar.y - 3 });
  return [
    { id: 'altar', label: '在祭坛边坐着', going: '去祭坛', target: altar, dwellMs: DWELL_MS },
    {
      id: 'garden',
      label: '去看了一眼农田',
      going: '去农田边',
      target: garden ?? altar,
      dwellMs: DWELL_MS * 1.4,
    },
    {
      id: 'promenade',
      label: '在街口站着看了一会儿',
      going: '去街口',
      target: promenade ?? altar,
      dwellMs: DWELL_MS,
    },
    {
      id: 'altar',
      label: '回到祭坛等神谕',
      going: '回祭坛',
      target: altar,
      dwellMs: DWELL_MS,
    },
  ];
}

export interface RoutineMap {
  nearestWalkable(target: GridPoint): GridPoint | null;
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
 */
export function routineFor(
  weather: Weather,
  beats: readonly RoutineBeat[],
  index: number,
  tideLevel = 0,
  shelterAt: GridPoint | null = null,
): RoutineBeat {
  // 暴雨一样躲，只是说法不同——这一档是雨的强度，不是新行为。
  if (weather === 'rain' || weather === 'storm') {
    // 落点是那道门；没门才退回锚点，并且连说法一起退回。
    if (shelterAt !== null) {
      return {
        id: 'shelter',
        label: weather === 'storm' ? '缩进屋檐下躲暴雨' : '躲到屋檐下看雨',
        going: weather === 'storm' ? '跑向屋檐下躲暴雨' : '跑向屋檐下躲雨',
        target: shelterAt,
        dwellMs: DWELL_MS,
      };
    }
    const anchor = beats[0]!;
    return {
      id: 'shelter',
      label: weather === 'storm' ? '在祭坛边缩着等暴雨过去' : '在祭坛边看雨',
      // 没门可躲时落点是锚点，所以赶路那句也得说锚点——说屋檐就是一边把她
      // 往祭坛送、一边告诉外面她去了屋檐。
      going: '去祭坛边',
      target: anchor.target,
      dwellMs: DWELL_MS,
    };
  }
  const beat = beats[index % beats.length]!;
  const tide = beat.tide;
  // 潮汐条件不成立的落点，一律退回锚点（beats[0]），并把说法换成锚点那一句。
  //
  // 早先这里只改 label、留着原来的 target：牌子写「沿街」，人照样往浅滩走。
  // 世界可以在做不到时说「现在不行」，但不能一边说一边做别的——
  // 那句话是给外面看的唯一凭据，说谎比不去更糟。
  if (!tideBeatApplies(tide, tideLevel)) return fallbackTo(beats, beat);
  return beat;
}

/**
 * 一个作息落点的潮汐条件此刻成立吗。
 *
 * 这是 `src/` 下**唯一**判定「现在去得了吗」的地方。`Simulation` 的快进判定也走
 * 这儿，不另写一份字面量——两处各写一遍时，改一处忘另一处，世界就会一边说
 * 「现在不行」一边把她送过去。那两个数在 `tide.ts`（`TIDE_LOW_MAX` /
 * `TIDE_HIGH_MIN`），也不许在调用处再写一遍。
 *
 * （`test/routine-tide-single-source.test.ts` 也 import 它，但那是为了验「没有
 *   第三份」，不是为了判行为。所以「全仓唯一」在字面上是假的，写 `src/` 下唯一。）
 *
 * 没写 `tide` 的落点恒真：它不挑潮位。
 */
export function tideBeatApplies(tide: RoutineBeat['tide'], level: number): boolean {
  if (tide === 'low') return level <= TIDE_LOW_MAX;
  if (tide === 'high') return level >= TIDE_HIGH_MIN;
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
