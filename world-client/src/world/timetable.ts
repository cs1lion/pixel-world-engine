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
 * 这一版只接**已有的动作**：晨间的打水/点灯两件小事、午间的安静段，以及
 * 市面几个节点的旁白。开市、收工、收摊没有各造一套新玩法——它们先只是镇子
 * 说得出口的时刻，不额外改任何人的状态。
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

/** 两件已经接通的每日小事。其余时刻还没有具体动作，只是旁白。 */
export type DailyChore = 'water' | 'lamp';

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
    id: 'wash_bridge', minuteOfDay: 6 * 60, text: '天亮了，有人去桥边打水，顺手冲了冲桥面。',
    chore: 'water', choreText: '去桥边打水，顺手冲了冲桥面',
  },
  { id: 'market_open', minuteOfDay: 8 * 60, text: '早市开了，摊子一处处支起来。', chore: null, choreText: null },
  { id: 'tea_talk', minuteOfDay: 10 * 60, text: '茶摊前起了几句闲话。', chore: null, choreText: null },
  { id: 'quiet_start', minuteOfDay: 12 * 60, text: '日头正顶，镇上安静下来。', chore: null, choreText: null },
  { id: 'quiet_end', minuteOfDay: 14 * 60, text: '午后的第一阵脚步声响起来。', chore: null, choreText: null },
  { id: 'work_end', minuteOfDay: 17 * 60, text: '收工的钟敲了，街上的活停下来。', chore: null, choreText: null },
  {
    id: 'light_lamps', minuteOfDay: 18 * 60, text: '天色擦黑，街灯一盏盏亮起来。',
    chore: 'lamp', choreText: '把祭坛边的街灯一盏盏点亮',
  },
  { id: 'night_market', minuteOfDay: 19 * 60, text: '夜市支起来了，灯下有人走动。', chore: null, choreText: null },
  { id: 'pack_up', minuteOfDay: 21 * 60, text: '摊主开始收摊。', chore: null, choreText: null },
  { id: 'market_close', minuteOfDay: 22 * 60, text: '市面闭了，镇子回到安静。', chore: null, choreText: null },
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
