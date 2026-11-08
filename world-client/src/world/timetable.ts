/** 一天的固定时刻表：镇子自己在几点做什么。
 *
 * 与 `ambient.ts` 同一条纪律：**纯函数、零状态**。输入只有「上一拍的世界时刻」
 * 与「这一拍的世界时刻」，输出是这两个时刻之间跨过的节拍。没有游标、没有
 * 「上一次报过什么」，所以它不进存档，读档续跑也不会分叉。
 *
 * 时刻按**世界日的分钟**写（06:00 = 360，22:00 = 1320），不按现实钟点。
 * 加速模式下世界日从 00:00 起算；`?clock=real` 下世界日的零点被锚在本地
 * 00:00（`real-clock.ts`），两种模式下这套时刻都成立。
 *
 * 这一版接**已经做得到的动作**：晨间的打水/点灯两件小事、午间的安静段，
 * 以及市面四个节点（开市 / 收工 / 夜市 / 闭市）。后四个节点不另造玩法：
 * 它们落成 `world.event`，同时由 `marketPhaseAt` 把街口那一拍的**说法**
 * 换成此刻真在做的事（守着早市 / 看夜市 / 只是站着）。说法与行为仍是一份
 * 事实——白天说「守着摊子」，夜里就不说。
 */

import { DAY_MS } from './memory/config.ts';
import { worldMinutes } from './pace.ts';

export type TimetableId =
  | 'lamps_out'
  | 'wash_bridge'
  | 'market_open'
  | 'tea_talk'
  | 'quiet_start'
  | 'quiet_end'
  | 'work_end'
  | 'light_lamps'
  | 'night_market'
  | 'pack_up'
  | 'market_close';

/** 已经接通的每日小事与市面四个节点。其余时刻只写旁白。 */
export type DailyChore =
  | 'water'
  | 'lamp'
  | 'market_open'
  | 'work_end'
  | 'night_market'
  | 'market_close';

/** 市面的三种相位：早市开着、夜市开着、其余时候关着。 */
export type MarketPhase = 'closed' | 'open' | 'night';

export interface TimetableBeat {
  readonly id: TimetableId;
  /** 世界日内的第几分钟（06:00 = 360）。 */
  readonly minuteOfDay: number;
  /** 事件流里读到的那句话。 */
  readonly text: string;
  /**
   * 这一拍要不要落成一条 `world.event`（世界改变 + 记忆条目）。
   * `null` = 只写玩家的日志，不进记忆——其余六件小事还没做，不能假装做了。
   */
  readonly chore: DailyChore | null;
  /**
   * 有人做这件小事时的说法，拼在**当事人名字后面**（「汐去桥边打水……」）。
   * 没有当事人（旁白）时为 `null`。
   */
  readonly choreText: string | null;
}

/** 固定时刻表。顺序即一天里的顺序。 */
export const TIMETABLE: readonly TimetableBeat[] = [
  {
    id: 'lamps_out', minuteOfDay: 5 * 60, text: '天还没亮，值夜的人把街灯一盏盏收起来。',
    // 收灯是「灯亮着」这个渲染谓词回到关：它不是每日小事，也不该凭空多开一种
    // `world.event`。灯街切片读这一拍的时刻与 id，自己决定怎么关灯。
    chore: null, choreText: null,
  },
  {
    id: 'wash_bridge', minuteOfDay: 6 * 60, text: '天亮了，有人去打水。',
    // 具体去哪儿由世界现查：有河湾就去河湾；整张图都没有水边就照实说没找到水。
    // 「桥边」这个旧说法默认镇上有桥，开阔世界里根本没有——说一套做一套。
    chore: 'water', choreText: '去河湾打水，顺手冲了冲河岸',
  },
  {
    id: 'market_open', minuteOfDay: 8 * 60, text: '早市开了，摊子一处处支起来。',
    chore: 'market_open', choreText: null,
  },
  { id: 'tea_talk', minuteOfDay: 10 * 60, text: '茶摊前起了几句闲话。', chore: null, choreText: null },
  { id: 'quiet_start', minuteOfDay: 12 * 60, text: '日头正顶，镇上安静下来。', chore: null, choreText: null },
  { id: 'quiet_end', minuteOfDay: 14 * 60, text: '午后的第一阵脚步声响起来。', chore: null, choreText: null },
  {
    id: 'work_end', minuteOfDay: 17 * 60, text: '收工的钟敲了，街上的活停下来。',
    chore: 'work_end', choreText: null,
  },
  {
    id: 'light_lamps', minuteOfDay: 18 * 60, text: '天色擦黑，街灯一盏盏亮起来。',
    chore: 'lamp', choreText: '把祭坛边的街灯一盏盏点亮',
  },
  {
    id: 'night_market', minuteOfDay: 19 * 60, text: '夜市支起来了，灯下有人走动。',
    chore: 'night_market', choreText: null,
  },
  { id: 'pack_up', minuteOfDay: 21 * 60, text: '摊主开始收摊。', chore: null, choreText: null },
  {
    id: 'market_close', minuteOfDay: 22 * 60, text: '市面闭了，镇子回到安静。',
    chore: 'market_close', choreText: null,
  },
];

/** 世界日的第几分钟。负数时刻也稳定（`floor` 而不是截断）。 */
export function minuteOfDay(worldNow: number): number {
  if (!Number.isFinite(worldNow)) return 0;
  const day = Math.floor(worldNow / DAY_MS);
  return Math.floor((worldNow - day * DAY_MS) / worldMinutes(1));
}

/** 12:00–14:00：安静段（左闭右开，与时刻表的边界同一条口径）。 */
export function isQuietAt(worldNow: number): boolean {
  const minute = minuteOfDay(worldNow);
  return minute >= 12 * 60 && minute < 14 * 60;
}

/** 某一拍在一天里的分钟数。只读时刻表，不在别处再抄一遍字面量。 */
function beatMinute(id: TimetableId): number {
  const beat = TIMETABLE.find((item) => item.id === id);
  if (beat === undefined) throw new Error(`时刻表里没有 ${id}`);
  return beat.minuteOfDay;
}

const PACK_UP_MINUTE = beatMinute('pack_up');
const LAMPS_OUT_MINUTE = beatMinute('lamps_out');
const WATER_MINUTE = beatMinute('wash_bridge');
const MARKET_OPEN_MINUTE = beatMinute('market_open');
const WORK_END_MINUTE = beatMinute('work_end');
const NIGHT_MARKET_MINUTE = beatMinute('night_market');
const MARKET_CLOSE_MINUTE = beatMinute('market_close');

/**
 * 21:00–05:00：该回锚点了。
 *
 * 从收摊那一拍起往家走，22:00 闭市时人已经在锚点上睡着——这样 22:00 之后
 * 一步都不必走。走到 05:00 收灯才醒。
 */
export function isEveningAt(worldNow: number): boolean {
  const minute = minuteOfDay(worldNow);
  return minute >= PACK_UP_MINUTE || minute < LAMPS_OUT_MINUTE;
}

/** 22:00–05:00：睡着的时段。说法与「回锚点」分开，但落点相同。 */
export function isAsleepAt(worldNow: number): boolean {
  const minute = minuteOfDay(worldNow);
  return minute >= MARKET_CLOSE_MINUTE || minute < LAMPS_OUT_MINUTE;
}

/** 05:00–06:00：收灯之后、打水之前的那一小段。 */
export function isDawnAt(worldNow: number): boolean {
  const minute = minuteOfDay(worldNow);
  return minute >= LAMPS_OUT_MINUTE && minute < WATER_MINUTE;
}

/**
 * 某个场所此刻开着的是哪一场。
 *
 * 这是「场所的状态 = 世界时刻的纯函数」的最小形态：输入只有世界时刻，不看帧号、
 * 不看调用次数，所以同一世界时刻必得同一状态，读档续跑不会分叉，也不需要往
 * 存档里加「今天开没开」的字段。
 *
 * 这一版只有一个按时段开闭的场所（街口摊位），因此**不留 site 维度**——加一个
 * 没有第二个成员的 keyed 表只是把「一个常量」包装成「一个接口」。真要有第二个
 * 场所时再加 keyed 表，未知 key 直接 throw（与 `beatMinute` 同一条口径），
 * 不许 `?? 'closed'`。
 *
 * 早市 08:00–17:00，夜市 19:00–22:00，其余关着。边界左闭右开。
 */
export function siteOpenAt(worldNow: number): MarketPhase {
  const minute = minuteOfDay(worldNow);
  if (minute >= NIGHT_MARKET_MINUTE && minute < MARKET_CLOSE_MINUTE) return 'night';
  if (minute >= MARKET_OPEN_MINUTE && minute < WORK_END_MINUTE) return 'open';
  return 'closed';
}

/** 旧名字，行为与 `siteOpenAt` 逐字相同。保留只为兼容现有调用方。 */
export function marketPhaseAt(worldNow: number): MarketPhase {
  return siteOpenAt(worldNow);
}

/** 某一拍在一天里的毫秒偏移。 */
function offsetOf(beat: TimetableBeat): number {
  return worldMinutes(beat.minuteOfDay);
}

/**
 * `(prevNow, now]` 之间跨过的节拍。
 *
 * 跨日也照付：把两头各自截到当天的范围内，逐日走。步长是 6 世界秒（倍率 60
 * 下的一拍），所以正常情况下一次最多跨过一个节拍；跨日那条分支只在大步长
 * （如真实时钟的离线补算之后的第一次 update）才用得上，不补中间那几天。
 */
export function beatsBetween(prevNow: number, now: number): readonly TimetableBeat[] {
  if (!(now > prevNow)) return [];
  const hits: TimetableBeat[] = [];
  const firstDay = Math.floor(prevNow / DAY_MS);
  const lastDay = Math.floor(now / DAY_MS);
  for (let day = firstDay; day <= lastDay; day += 1) {
    const dayStart = day * DAY_MS;
    const from = Math.max(prevNow - dayStart, 0);
    const to = Math.min(now - dayStart, DAY_MS);
    for (const beat of TIMETABLE) {
      const at = offsetOf(beat);
      if (at > from && at <= to) hits.push(beat);
    }
  }
  return hits;
}
