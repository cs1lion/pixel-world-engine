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

/** 场所身份：复用 `placeId` 的内容表 key，不做闭集枚举。 */
export type SiteId = string;

/**
 * 场所里允许做的活动：闭集，四个词。
 *
 * - `trade` / `work` / `rest` 有设定集依据（饮食街 / 工坊 / 花径坐下）；
 * - `stroll` 是**引擎取值**（设定集没有「走看」这个词）。
 *
 * `gather` / `perform` 刻意不收：设定集没有对应内容，也没有消费方。
 * 预留会让**写错的词**看起来合法——闭集的价值就是写错就 throw。
 */
export type ActivityId = 'trade' | 'work' | 'rest' | 'stroll';

/** 一条营业时段。左闭右开，分钟口径与世界日一致；`closed` 由「不命中任何带」派生。 */
export interface SiteBand {
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly phase: Exclude<MarketPhase, 'closed'>;
}

/**
 * 场所的静态内容：只有身份、种类、时段与允许的活动，没有任何运行时状态。
 *
 * `activities` **省略 = 这个场所不承载活动**（纯门场所），查询一律 false；
 * 写成空数组则在装载期 throw——写了空清单像是「想列却漏了」，省略才是表态。
 * 与 `SITE_FLAGS` 空表同一条口径：静默失效比报错难查。
 */
export interface SiteDef {
  readonly id: SiteId;
  readonly kind: SiteKind;
  readonly bands: readonly SiteBand[];
  readonly activities?: readonly ActivityId[];
}

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
const QUIET_END_MINUTE = beatMinute('quiet_end');
const NIGHT_MARKET_MINUTE = beatMinute('night_market');
const MARKET_CLOSE_MINUTE = beatMinute('market_close');

/**
 * 三条门控行：街口摊位、西侧草地口袋的花径、三处工坊。
 *
 * 时刻全部引用上面从 `TIMETABLE` 派生的常量，**不在这里另写一遍**；时刻表仍是
 * 单一事实源。花径的开放时段是内容决定（设定集没给数字），这里取「安静段结束」
 * 到「收工」这一段——两端仍然是时刻表的 `quiet_end` / `work_end`，作息那边
 * 只读 `siteStateAt` 折出来的 flag，不另写一套时间判断。
 *
 * **`workshop` 只做门，不做落点**：落点在包里的 `sites`（id = 建筑的 `instanceId`），
 * 与花径那条 `courtyard` 的用法对称。
 *
 * **这张表是 kind 的唯一事实源**：`SITE_KINDS` 由它派生，`siteDefOf(kind)` 也查它。
 * 表里加一个 kind，闭集就自动多一个；包里写了表里没有的 kind，装载期 throw。
 */
export const SITE_TABLE = [
  {
    id: 'market',
    kind: 'market',
    bands: [
      { fromMinute: MARKET_OPEN_MINUTE, toMinute: WORK_END_MINUTE, phase: 'open' },
      { fromMinute: NIGHT_MARKET_MINUTE, toMinute: MARKET_CLOSE_MINUTE, phase: 'night' },
    ],
    // 饮食街：交易有据；「在摊位间走一遍」是引擎取值。
    activities: ['trade', 'stroll'],
  },
  {
    id: 'courtyard',
    kind: 'courtyard',
    // 花径 14:00–17:00 开放：安静段结束开门，收工关门。
    bands: [{ fromMinute: QUIET_END_MINUTE, toMinute: WORK_END_MINUTE, phase: 'open' }],
    // 花径「坐下」有据（p110–111）；走看是引擎取值。
    activities: ['rest', 'stroll'],
  },
  {
    id: 'workshop',
    kind: 'workshop',
    // 工坊 06:00–17:00：打水开门、收工关门。
    // ⚠ 这是**引擎约定、无设定集依据**：设定集只给了「白天斜射阳光」（且只对锅炉房），
    // 大浴场清洗那页连时间描述都没有，更没有任何钟点。两端只是复用时刻表的
    // `wash_bridge` / `work_end`，不是还原。
    bands: [{ fromMinute: WATER_MINUTE, toMinute: WORK_END_MINUTE, phase: 'open' }],
    // 三处工坊只做活。
    activities: ['work'],
  },
] as const;

/**
 * 场所种类：由 `SITE_TABLE` 派生，不另写一份字面量。
 *
 * **`kind` 是门控种类，不是外观种类**：它只决定「这个场所按哪套时段开关」，
 * 不许拿它做绘制分支（外观走 `SettingScenery['kind']`）。同名不代表同一件事。
 *
 * 只收真实内容。设定集只有庭院 / 花径 / 桥头前庭，没有城市公园；`park`
 * 从未有消费方，这里直接不收。`workshop` 是三处工坊（锅炉房 / 大浴场清洗；
 * 配膳间本包没有建筑，见 `docs/OPEN_ISSUES.md` O3）共用的门控种类。
 */
export type SiteKind = (typeof SITE_TABLE)[number]['kind'];

/** 场所种类的运行时清单：直接从表里取，顺序即表的顺序。 */
export const SITE_KINDS: readonly SiteKind[] = SITE_TABLE.map((site) => site.kind);

const SITE_KIND_SET: ReadonlySet<string> = new Set(SITE_KINDS);

/** 这个字符串是不是闭集里的 kind。 */
export function isSiteKind(kind: string): kind is SiteKind {
  return SITE_KIND_SET.has(kind);
}

/** 闭集之外的 kind 直接 throw，与 `siteStateAt` 未知 id 同一条口径。 */
function requireSiteKind(kind: string, where: string): SiteKind {
  if (!isSiteKind(kind)) {
    throw new Error(`${where} 的 kind ${kind} 不在 SITE_KINDS 里`);
  }
  return kind;
}

const SITE_BY_ID = new Map<SiteId, SiteDef>(SITE_TABLE.map((site) => [site.id, site]));
const SITE_BY_KIND = new Map<string, SiteDef>(SITE_TABLE.map((site) => [site.kind, site]));

/**
 * 按种类取那一行门控内容。表里没有就 throw。
 *
 * 与 `siteStateAt` 未知 id 同一条口径：`?? closed` 会把「表里没有」静默成
 * 「今天关着」，那种错最难查——牌子写着去花径，人永远不去。
 */
export function siteDefOf(kind: SiteKind): SiteDef {
  const def = SITE_BY_KIND.get(kind);
  if (def === undefined) throw new Error(`场所种类 ${kind} 没有门控行`);
  return def;
}

// 装载期校验：表里出现闭集之外的 kind、一个 kind 两行、或空活动清单，都在这里 throw。
// 空清单是「想列却漏了」，与 `SITE_FLAGS` 空表同一条——不留到运行期变成「没人做」。
for (const site of SITE_TABLE) {
  requireSiteKind(site.kind, `SITE_TABLE/${site.id}`);
  const activities = site.activities as readonly ActivityId[] | undefined;
  if (activities !== undefined && activities.length === 0) {
    throw new Error(`场所 ${site.id} 的活动清单是空表`);
  }
}
if (new Set(SITE_KINDS).size !== SITE_TABLE.length) {
  throw new Error('SITE_TABLE 里一个 kind 只能有一行（`siteDefOf` 按 kind 取行）');
}

/**
 * 这个场所此刻允不允许做这件事：门开着 ∧ 词在这一行的清单里。
 *
 * **只读 `bands` 与 `activities`，不读 `kind`**：同一种 kind 的两行可以给不同清单，
 * 所以实现里不许出现 `kind === 'market'` 这种分支（`test/site-activities.test.ts`
 * 拿「同 kind 不同清单」的探针当反例钉住）。
 *
 * 纯函数：输入只有静态内容与世界时刻，不落人物状态、不写存档，回放不出分叉。
 * 没写 `activities` 的场所（纯门）一律 false，不 throw——省略是表态，不是写错。
 */
export function activityAllowedAt(site: SiteDef, activity: ActivityId, now: number): boolean {
  const allowed = site.activities;
  if (allowed === undefined || !allowed.includes(activity)) return false;
  return sitePhaseOf(site, now) !== 'closed';
}

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
 * 这是「场所的状态 = 世界时刻的纯函数」的形态：输入只有 `SiteDef` 与
 * 世界时刻，不看帧号、不看调用次数，所以同一世界时刻必得同一状态，读档
 * 续跑不会分叉，也不需要往存档里加「今天开没开」的字段。`kind` 不参与
 * 相位判断——庭院与集市共用这一条循环，只换 `bands` 数据；但闭集之外的
 * kind 在这里 throw，不当成「今天关着」。
 */
export function sitePhaseOf(site: SiteDef, worldNow: number): MarketPhase {
  requireSiteKind(site.kind, `场所 ${site.id}`);
  const minute = minuteOfDay(worldNow);
  for (const band of site.bands) {
    if (minute >= band.fromMinute && minute < band.toMinute) return band.phase;
  }
  return 'closed';
}

/**
 * 按场所 id 查静态内容表，再投影成相位。
 *
 * 未知 id 直接 throw（与 `beatMinute` 同一条口径），不许 `?? 'closed'`
 * 把「表里没有」静默成「今天关着」。
 */
export function siteStateAt(siteId: SiteId, worldNow: number): MarketPhase {
  const site = SITE_BY_ID.get(siteId);
  if (site === undefined) throw new Error(`SITE_TABLE 里没有场所 ${siteId}`);
  return sitePhaseOf(site, worldNow);
}

/** 街口摊位的旧入口：委托到 `siteStateAt('market')`，行为逐字不变。 */
export function siteOpenAt(worldNow: number): MarketPhase {
  return siteStateAt('market', worldNow);
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
