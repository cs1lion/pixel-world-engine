/** 日常作息：没活干的时候她去哪、待多久。
 *
 * 这里是"世界不惩罚你"的那一半——她过日子不花 token，也不因为你没来而退化。
 * 纯函数决定下一个落点，模拟层只负责走过去。
 */

import type { GridPoint, PlacedBuilding, Weather } from './types.ts';

export type RoutineId = 'altar' | 'garden' | 'promenade' | 'shelter';

export interface RoutineBeat {
  readonly id: RoutineId;
  readonly label: string;
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
    { id: 'altar', label: '在祭坛边坐着', target: altar, dwellMs: DWELL_MS },
    {
      id: 'garden',
      label: '去看了一眼农田',
      target: garden ?? altar,
      dwellMs: DWELL_MS * 1.4,
    },
    {
      id: 'promenade',
      label: '在街口站着看了一会儿',
      target: promenade ?? altar,
      dwellMs: DWELL_MS,
    },
    { id: 'altar', label: '回到祭坛等神谕', target: altar, dwellMs: DWELL_MS },
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

export function routineFor(
  weather: Weather,
  beats: readonly RoutineBeat[],
  index: number,
  tideLevel = 0,
): RoutineBeat {
  // 暴雨一样躲，只是说法不同——这一档是雨的强度，不是新行为。
  if (weather === 'rain' || weather === 'storm') {
    const altar = beats[0];
    return {
      id: 'shelter',
      label: weather === 'storm' ? '缩进屋檐下躲暴雨' : '躲到屋檐下看雨',
      target: altar.target,
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
  if (tide === 'low' && tideLevel > 0.34) return fallbackTo(beats, beat);
  if (tide === 'high' && tideLevel < 0.6) return fallbackTo(beats, beat);
  return beat;
}

/** 退回锚点：借锚点的 id、label、target，只保留原落点的停留时长。 */
function fallbackTo(beats: readonly RoutineBeat[], beat: RoutineBeat): RoutineBeat {
  const anchor = beats[0]!;
  return { id: anchor.id, label: anchor.label, target: anchor.target, dwellMs: beat.dwellMs };
}
