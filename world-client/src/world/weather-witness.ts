import type { GridPoint } from './types.ts';

/**
 * 天气事件的「目击」半径。
 *
 * 6 格 = 半条灯街（灯街从西头到东头约 18 格），也正好把「站在摊子边上」和
 * 「站在镇中心/渡口」分开。潮汐那条用的是码头 12 格：码头的消息是**广播**
 * （汽笛全镇听得见），所以只有码头边的人算在场；天气没有喇叭，雨点落在谁
 * 头上、雾漫到谁眼里，只有那半条街内的人说得清。两条半径不是同一个量，
 * 理由见各自注释，别合并成一个「感知半径」。
 */
export const WEATHER_WITNESS_CELLS = 6;

/** 摊子离人超过这个距离，就不算「在灯街上淋到雨」。 */
export const WEATHER_MARKET_CELLS = WEATHER_WITNESS_CELLS;

/** 雨落下来那一刻在场的一个人。`visible` = 没进屋（见 simulation 的 visible 语义）。 */
export interface WeatherPerson {
  readonly id: string;
  readonly cell: GridPoint;
  readonly visible: boolean;
}

/** 一次天气事件落在哪、谁入账。 */
export interface WeatherWitnessGroup {
  readonly at: GridPoint;
  readonly witnesses: readonly string[];
}

/**
 * 把「雨落下来」拆成至多几组：当事人是离某个摊子 ≤6 格且在场的人，
 * 目击者是同一摊位 6 格内的其他人。
 *
 * 为什么按摊位分组而不是全镇一个圆心：灯街是一条长街，六张摊从 x15 铺到
 * x47；用一个街心中点做圆，东段摊主离圆心 18 格，永远进不了账——那正是
 * 「广播」而不是「目击」。按最近的摊子归组，每组各自算 6 格，人数与事件
 * 数量都有界（≤ 村民数），同一个人只入一次账。
 *
 * 纯函数：位置、能见度、摊位坐标都由调用方给，不看时钟、不看天气。
 */
export function weatherWitnessGroups(
  people: readonly WeatherPerson[],
  stalls: readonly GridPoint[],
): readonly WeatherWitnessGroup[] {
  if (stalls.length === 0) return [];
  const covered = new Set<string>();
  const groups: WeatherWitnessGroup[] = [];
  const ordered = [...people].sort((a, b) => a.id.localeCompare(b.id));
  for (const person of ordered) {
    if (covered.has(person.id) || !person.visible) continue;
    const at = nearestStall(person.cell, stalls);
    if (at === null) continue;
    const witnesses = ordered
      .filter((other) => other.visible && !covered.has(other.id))
      .filter((other) => withinWeatherWitnessRange(other.cell, at))
      .map((other) => other.id);
    if (witnesses.length === 0) continue;
    for (const id of witnesses) covered.add(id);
    groups.push({ at, witnesses });
  }
  return groups;
}

/** 最近的摊位（欧氏距离）；超过 `WEATHER_MARKET_CELLS` 就当他不在灯街。 */
export function nearestStall(cell: GridPoint, stalls: readonly GridPoint[]): GridPoint | null {
  let best: GridPoint | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stall of stalls) {
    const distance = Math.hypot(stall.x - cell.x, stall.y - cell.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stall;
    }
  }
  return best !== null && bestDistance <= WEATHER_MARKET_CELLS ? best : null;
}

export function withinWeatherWitnessRange(a: GridPoint, b: GridPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= WEATHER_WITNESS_CELLS;
}

/**
 * 「昨天淋了雨」这条记忆够不够让今天提前收摊。
 *
 * 记忆初写强度是 1（写不写由 salience 决定，写了就是确定的），日终按
 * `decayRate = 0.15` 衰减：1.00 → 0.85 → 0.72 → 0.61。
 *
 * 门槛压 0.75 的结果是**只影响次日**：第 1 天 0.85 过线，第 2 天 0.72
 * 就掉出去。这正合「次日行为改变」的口径——不是一条永久习惯，也不是
 * 当天就没；再往后两天的强度照常往下掉，表里看得见。
 */
export const WEATHER_HABIT_MIN_STRENGTH = 0.75;

/** 提前收摊的那一拍：13:00（世界时间）。午后的雨多在 16:00 那槽，提前 3 小时。 */
export const PRE_COVER_MS = 13 * 60 * 60 * 1000;

/** 提前收摊的那句话：面板、事件日志与记忆共用同一串。 */
export const PRE_COVER_TEXT = '提前把摊布盖上（昨天淋了雨）';

/** 世界给行为层的一条「淋过雨」账：哪个人、初写强度、第几天记的。 */
export interface WeatherHabitEntry {
  readonly villagerId: string;
  readonly strength: number;
  readonly day: number;
}

/**
 * 这条账还够不够让他今天提前收摊。
 *
 * `strength` 是**记忆层当前的强度**——日终 `consolidateHolder` 已经按
 * `decayRate = 0.15` 降过一遍。这里不再按天数乘一次，否则同一天会被
 * 扣两回：昨天 0.46 的账，第 2 天在记忆里已经是 0.39，再按年龄乘就成
 * 0.33，一天的衰减读成两天。
 */
export function habitApplies(entry: WeatherHabitEntry): boolean {
  return entry.strength >= WEATHER_HABIT_MIN_STRENGTH;
}
