/** 回家：夜里居民真实走进自家门，街上只看见「走到门口、然后消失」。
 *
 * 这一段在世界状态里只留下三样已经存在的东西：`pos` 落进住宅占地、
 * `visible = false`、`routineLabel` 记她在家。**不新增存档字段、不动 v5**：
 * 谁的家由「居民 id + 当前住宅清单」推出来（纯函数），读档后同一份存档
 * 推出同一个人同一个家。
 *
 * 为什么必须走到门口才翻转 `visible`：街角直接消失会让目击者记得一件
 * 没发生过的事（她凭空不见了），而记忆层是按「看得见的事实」记账的。
 * 位置先到门口、再翻牌，外面看到的是「她进屋了」。
 *
 * 这里只放纯函数与常量；真正的行走、翻转与事件由 `Simulation` 调。
 */

import type { GridPoint, PlacedBuilding, ZoneId } from './types.ts';

/** 入夜：市场收摊（22:00）。 */
export const HOME_BEDTIME_MINUTE = 22 * 60;
/** 起床：打水（06:00）。 */
export const HOME_WAKE_MINUTE = 6 * 60;

/** 走路回家时 `routineLabel` 上的字。它同时是「这条路径是不是回家的路」的判据。 */
export const HOME_GOING_LABEL = '回家';
/** 已经进屋。`routineLabel` 落档，所以读档后仍能说出「她在家」。 */
export const HOME_INSIDE_LABEL = '在家里歇下了';

/**
 * 此刻是不是「夜里」。跨午夜：[22:00, 24:00) ∪ [00:00, 06:00)。
 *
 * 判据只看世界时钟的分钟数，不看墙钟——回放同一条轨迹得到同一段夜。
 */
export function isHomeTime(minuteOfDay: number): boolean {
  return minuteOfDay >= HOME_BEDTIME_MINUTE || minuteOfDay < HOME_WAKE_MINUTE;
}

/** 住宅分区。世界不猜「哪栋像家」，用分区自己说的那一栏。 */
const HOME_ZONE: ZoneId = 'living';

/**
 * 当前世界里还立着的住宅，按实例名排序。
 *
 * 排序是为了让「第几个居民住第几栋」跨读档稳定：建筑数组的顺序可能随
 * 建造/拆除变化，实例名不会。
 */
export function homesOf(buildings: readonly PlacedBuilding[]): readonly PlacedBuilding[] {
  return buildings
    .filter((building) => building.zone === HOME_ZONE)
    .slice()
    .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
}

/**
 * 这个居民住哪栋。纯派生，不落档。
 *
 * 规则：`v<n>` 取 n 对住宅数取模；其他 id 用一个固定的字符哈希。住宅没了
 * 就返回 `null`（世界不给她编一个不存在的家）。
 */
export function homeFor(
  villagerId: string,
  homes: readonly PlacedBuilding[],
): PlacedBuilding | null {
  if (homes.length === 0) return null;
  return homes[homeIndexFor(villagerId) % homes.length] ?? null;
}

function homeIndexFor(villagerId: string): number {
  const numbered = /^v(\d+)$/.exec(villagerId);
  if (numbered !== null) return Number(numbered[1]);
  let hash = 0;
  for (let index = 0; index < villagerId.length; index += 1) {
    hash = (hash * 31 + villagerId.charCodeAt(index)) % 1_000_003;
  }
  return hash;
}

/**
 * 屋里的落脚点：占地正中那一格。
 *
 * 用占地而不是门口：`visible = false` 之后她的位置是「她在哪」的事实，
 * 站在门口会让 `insideAt` 判成街上；落在占地里，室内视图才认得出这栋楼
 * 此刻有谁（`insideAt` 按占地判）。
 */
export function insideSpotOf(building: PlacedBuilding): GridPoint {
  return {
    x: building.origin.x + Math.floor(building.footprint.w / 2),
    y: building.origin.y + Math.floor(building.footprint.h / 2),
  };
}

/** 门外目击者读到的那句话。世界自己报的时刻用它，记忆层原样落账。 */
export function homeEntryText(villagerName: string, buildingName: string): string {
  return `${villagerName}走进了${buildingName}，门在身后合上。`;
}
