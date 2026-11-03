/** 街头活气：两个居民在街上撞见时，世界自己决定这一回是打招呼、让路、
 * 争执，还是一起搭把手。
 *
 * 三条约束，全部是纯函数能钉住的：
 *
 * 1. **确定性**：只吃 `seed`、世界时间、位置与关系读数，不许 `Math.random()`。
 *    同一个种子、同一串步长，走到同一刻就出同一件事。
 * 2. **由位置与关系触发**：距离决定「撞见」，关系读数决定「这一回是哪种」。
 *    没有关系账本的两个人不会当街争执。
 * 3. **限流靠时间槽 + 日账**：一个 10 世界分钟的槽里最多出一件；任意两件之间
 *    至少隔 {@link LIVELY_GAP_MS}；同一对同一个世界日、同一种互动只落一次；
 *    全天最多 {@link LIVELY_DAILY_CAP} 件；同一对的争执按
 *    {@link LIVELY_QUARREL_COOLDOWN_DAYS} 个世界日冷却。跨槽那一拍才判，
 *    与 `ambient.ts` 同一条理由——不是靠计数器。
 *
 * 街头小事（撞翻担子 / 抢水 / 帮忙抬货）另有一个 2 小时的时间槽，且只在
 * 跨槽那一拍判。它们与普通互动共用同一条位置判据，但不共用种类选择；同样
 * 受日上限与同类去重约束。
 */

import { DAY_MS } from './memory/config.ts';
import { seedOf } from './memory/seed.ts';
import { worldHours, worldMinutes } from './pace.ts';
import type { GridPoint } from './types.ts';

export type LivelyKind =
  | 'street_greet'
  | 'street_yield'
  | 'street_quarrel'
  | 'street_together'
  | 'street_tumble'
  | 'street_water'
  | 'street_help';

export interface SocialRelation {
  readonly from: string;
  readonly to: string;
  readonly trust: number;
  readonly warmth: number;
}

/** 记忆层算出来的「见到这个人就别往同一个锚点去」。 */
export interface SocialAvoidance {
  readonly villagerId: string;
  readonly otherId: string;
}

export interface SocialContext {
  readonly relations: readonly SocialRelation[];
  readonly avoid: readonly SocialAvoidance[];
}

export const EMPTY_SOCIAL_CONTEXT: SocialContext = { relations: [], avoid: [] };

/** 一个居民此刻在街上的样子。`free` 指没有接活、没有行礼、没有急件。 */
export interface LivelyVillager {
  readonly id: string;
  readonly name: string;
  readonly cell: GridPoint;
  readonly walking: boolean;
  readonly standing: boolean;
  readonly carrying: boolean;
  readonly free: boolean;
}

/** 调用方（`Simulation`）手里的日账，纯函数只读不写。 */
export interface LivelyHistory {
  /** 这个世界日已经落地几件。 */
  readonly totalToday: number;
  /** 这个世界日已经落地的「pairKey|kind」。 */
  readonly settledToday: readonly string[];
  /** 每对最后一次争执的世界日。 */
  readonly quarrelDays: Readonly<Record<string, number>>;
  /** 每个居民最后一次互动的世界时刻（毫秒）。 */
  readonly lastAt: Readonly<Record<string, number>>;
  /** 这个世界日每个居民已经参与过几次互动。 */
  readonly todayByVillager: Readonly<Record<string, number>>;
}

/** 没有历史时的空账：第一天、第一对。 */
export const EMPTY_LIVELY_HISTORY: LivelyHistory = {
  totalToday: 0,
  settledToday: [],
  quarrelDays: {},
  lastAt: {},
  todayByVillager: {},
};

export interface LivelyInput {
  readonly prevNow: number;
  readonly now: number;
  readonly seed: string;
  readonly villagers: readonly LivelyVillager[];
  readonly relations: readonly SocialRelation[];
  /**
   * 镇子的水边。没有水边的世界给 `null`：井边那一桩小事就不该发生，
   * 也不能编一个「井」出来（见 `simulation.ts` 的 `waterSpotNear`）。
   */
  readonly waterPlace: GridPoint | null;
  /** 日账；省略时当作世界的第一天，只适合单测与预览。 */
  readonly history?: LivelyHistory;
}

export interface LivelyBubble {
  readonly villagerId: string;
  readonly text: string;
}

export interface LivelyShift {
  /** 让路的那一位：从当前位置挪开一格。 */
  readonly villagerId: string;
  /** 离谁远一点。落脚格由调用方按可走性挑，这里只给方向语义。 */
  readonly awayFromId: string;
}

export interface LivelyEvent {
  readonly kind: LivelyKind;
  readonly text: string;
  readonly where: GridPoint;
  readonly actorId: string;
  readonly otherId: string;
  readonly bubbles: readonly LivelyBubble[];
  readonly durationMs: number;
  readonly shift?: LivelyShift;
}

/** 10 世界分钟一个槽。现实里约 10 秒。 */
export const LIVELY_SLOT_MS = worldMinutes(10);
/** 街头小事的时间槽：2 世界小时。 */
export const LIVELY_INCIDENT_SLOT_MS = worldHours(2);
/** 撞见 = 切比雪夫距离不超过 2 格。 */
export const LIVELY_CLOSE_CELLS = 2;
/** 低于这个信任读数就主动避开同一个锚点，也够得上当街争执。 */
export const LIVELY_AVOID_TRUST = -0.15;
/**
 * 一个世界日最多落下几件街头互动（普通互动与街头小事合计）。
 *
 * 12 件的理由：6:00–23:00 有 102 个 10 分钟槽，旧行为下约有一半槽会出手，
 * 一天能堆五十来件；12 件再叠上 30 分钟的间隔，至少铺开 5.5 小时，既看得见，
 * 又不会让同一对在同一分钟里连出三条。五个人同场时也只到 12 件，面板不会刷屏。
 */
export const LIVELY_DAILY_CAP = 12;
/**
 * 任意两件街头互动之间最少隔 30 世界分钟。
 *
 * 只靠日上限，五个人同场时十二件会在早晨两小时内连着放完，屏幕上就是一阵
 * 刷屏。30 分钟的世界间隔在 60 倍速下约合 30 秒，十二件铺到上午半天，
 * 既看得见又不会连珠炮。判据取所有居民里最近一次互动的时刻，跨日保留。
 */
export const LIVELY_GAP_MS = worldMinutes(30);
/**
 * 争执冷却：同一对最少隔 3 个世界日才可能再吵一次。
 *
 * 与 `-0.15` 的信任阈值配套：一天两吵会让关系账本一天内被同方向砸两次，
 * 记忆里只剩「又吵了」，看不出第一次为什么结怨。
 */
export const LIVELY_QUARREL_COOLDOWN_DAYS = 3;

/** 一对角色的稳定键：顺序无关，供日账与冷却共用。 */
export function livelyPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 同类去重键：同一对、同一世界日、同一种互动只落一次。 */
export function livelySettledKey(pairKey: string, kind: LivelyKind): string {
  return `${pairKey}|${kind}`;
}

const GREET_DURATION_MS = worldMinutes(2);
const YIELD_DURATION_MS = worldMinutes(2);
const QUARREL_DURATION_MS = worldMinutes(4);
const TOGETHER_DURATION_MS = worldMinutes(4);
const INCIDENT_DURATION_MS = worldMinutes(3);

function slotOf(now: number, slotMs: number): number {
  return Math.floor(now / slotMs);
}

function minuteOfDay(now: number): number {
  const rest = now - Math.floor(now / DAY_MS) * DAY_MS;
  return Math.floor(rest / 60_000);
}

function chebyshev(a: GridPoint, b: GridPoint): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function relationOf(
  relations: readonly SocialRelation[],
  from: string,
  to: string,
): SocialRelation | undefined {
  return relations.find((relation) => relation.from === from && relation.to === to);
}

function pairBubbles(
  a: LivelyVillager,
  b: LivelyVillager,
  first: string,
  second: string,
): readonly LivelyBubble[] {
  return [
    { villagerId: a.id, text: first },
    { villagerId: b.id, text: second },
  ];
}

/**
 * 跨槽那一拍里，镇上可能发生的一件街头互动。
 *
 * 返回空数组是常态：槽没跨、没撞见、或这一槽的哈希没选中。调用方不存游标，
 * 判据只看 `(prevNow, now]` 两头——与 `ambientBetween` 同一种写法。
 */
export function livelyBetween(input: LivelyInput): readonly LivelyEvent[] {
  if (slotOf(input.prevNow, LIVELY_SLOT_MS) === slotOf(input.now, LIVELY_SLOT_MS)) {
    return [];
  }
  const minute = minuteOfDay(input.now);
  // 深夜的街上没有人可撞见。
  if (minute < 6 * 60 || minute >= 23 * 60) return [];

  const slot = slotOf(input.now, LIVELY_SLOT_MS);
  const incidentCrossed =
    slotOf(input.prevNow, LIVELY_INCIDENT_SLOT_MS) !== slotOf(input.now, LIVELY_INCIDENT_SLOT_MS);
  const incidentSlot = slotOf(input.now, LIVELY_INCIDENT_SLOT_MS);

  const history = input.history ?? EMPTY_LIVELY_HISTORY;
  if (history.totalToday >= LIVELY_DAILY_CAP) return [];
  const latest = Object.values(history.lastAt).reduce((max, value) => Math.max(max, value), -Infinity);
  if (input.now - latest < LIVELY_GAP_MS) return [];
  const settled = new Set(history.settledToday);
  const day = Math.floor(input.now / DAY_MS);

  // 候选对先按两个人今天各参与过几次来排（次数少的先来），再看谁最久没
  // 互动，最后按稳定键定序。只按 id 排会让前两个人把一天的额度吃光，
  // 五个人同场时总有人整天零互动。
  const pairs: { a: LivelyVillager; b: LivelyVillager; pairKey: string }[] = [];
  const ordered = [...input.villagers].sort((a, b) => a.id.localeCompare(b.id));
  for (const a of ordered) {
    for (const b of ordered) {
      if (a.id >= b.id) continue;
      if (!a.free || !b.free) continue;
      if (chebyshev(a.cell, b.cell) > LIVELY_CLOSE_CELLS) continue;
      pairs.push({ a, b, pairKey: livelyPairKey(a.id, b.id) });
    }
  }
  pairs.sort((left, right) => {
    const busyLeft = (history.todayByVillager[left.a.id] ?? 0)
      + (history.todayByVillager[left.b.id] ?? 0);
    const busyRight = (history.todayByVillager[right.a.id] ?? 0)
      + (history.todayByVillager[right.b.id] ?? 0);
    const lastLeft = Math.max(
      history.lastAt[left.a.id] ?? -1,
      history.lastAt[left.b.id] ?? -1,
    );
    const lastRight = Math.max(
      history.lastAt[right.a.id] ?? -1,
      history.lastAt[right.b.id] ?? -1,
    );
    return busyLeft - busyRight || lastLeft - lastRight || left.pairKey.localeCompare(right.pairKey);
  });

  for (const { a, b, pairKey } of pairs) {
    const gate = seedOf(input.seed, 'lively-gate', slot, pairKey);
    // 半个槽会出手：再密就变成每十分钟一次，街上像在演同一段戏。
    if (gate % 2 !== 0) continue;

    const ab = relationOf(input.relations, a.id, b.id);
    const ba = relationOf(input.relations, b.id, a.id);
    const trustLow = Math.min(ab?.trust ?? 0, ba?.trust ?? 0);

    if (incidentCrossed) {
      const incident = incidentBetween(input, a, b, minute, incidentSlot, pairKey);
      // 同类只落一次：昨天/今天已经撞过担子，这一槽就不再撞第二次。
      if (incident !== undefined && !settled.has(livelySettledKey(pairKey, incident.kind))) {
        return [incident];
      }
    }

    const pick = seedOf(input.seed, 'lively-kind', slot, pairKey) % 3;
    const where = { x: a.cell.x, y: a.cell.y };

    const quarrelDay = history.quarrelDays[pairKey];
    const quarrelCooled =
      quarrelDay === undefined || day - quarrelDay >= LIVELY_QUARREL_COOLDOWN_DAYS;
    if (
      a.standing && b.standing && trustLow <= LIVELY_AVOID_TRUST
      && quarrelCooled && !settled.has(livelySettledKey(pairKey, 'street_quarrel'))
    ) {
      return [{
        kind: 'street_quarrel',
        text: `${a.name}和${b.name}当街争执了两句。`,
        where,
        actorId: a.id,
        otherId: b.id,
        bubbles: pairBubbles(a, b, '你走路看着点。', '我走得好好的。'),
        durationMs: QUARREL_DURATION_MS,
      }];
    }

    if (a.walking !== b.walking && !settled.has(livelySettledKey(pairKey, 'street_yield'))) {
      const walker = a.walking ? a : b;
      const stander = a.walking ? b : a;
      return [{
        kind: 'street_yield',
        text: `${stander.name}侧身让${walker.name}先过。`,
        where: { x: stander.cell.x, y: stander.cell.y },
        actorId: walker.id,
        otherId: stander.id,
        bubbles: pairBubbles(walker, stander, '多谢。', '您先走。'),
        durationMs: YIELD_DURATION_MS,
        shift: { villagerId: stander.id, awayFromId: walker.id },
      }];
    }

    if (
      a.standing && b.standing && minute >= 8 * 60 && minute < 18 * 60 && pick === 0
      && !settled.has(livelySettledKey(pairKey, 'street_together'))
    ) {
      return [{
        kind: 'street_together',
        text: `${a.name}和${b.name}一起搭手做事。`,
        where,
        actorId: a.id,
        otherId: b.id,
        bubbles: pairBubbles(a, b, '搭把手？', '一起抬。'),
        durationMs: TOGETHER_DURATION_MS,
      }];
    }

    if (a.standing && b.standing && !settled.has(livelySettledKey(pairKey, 'street_greet'))) {
      return [{
        kind: 'street_greet',
        text: `${a.name}与${b.name}碰面，互相问了个好。`,
        where,
        actorId: a.id,
        otherId: b.id,
        bubbles: pairBubbles(a, b, '早啊。', '你也早。'),
        durationMs: GREET_DURATION_MS,
      }];
    }
  }
  return [];
}

/**
 * 街头小事。只在 2 小时槽跨过的那一拍判一次，且用另一条哈希决定要不要出。
 *
 * 方向性在这一步就定下来了：`actorId` 是**动手的那一位**（撞人者 / 抢水者 /
 * 帮忙者），`otherId` 是被撞 / 被抢 / 被帮的那一位。关系账本按这两个方向
 * 各记一笔，不是「在场的所有人两两互写」。
 */
function incidentBetween(
  input: LivelyInput,
  a: LivelyVillager,
  b: LivelyVillager,
  minute: number,
  incidentSlot: number,
  pairKey: string,
): LivelyEvent | undefined {
  const gate = seedOf(input.seed, 'lively-incident', incidentSlot, pairKey) % 3;
  const close = chebyshev(a.cell, b.cell) <= 1;
  const water = input.waterPlace;
  const nearWater = water !== null
    && (chebyshev(a.cell, water) <= 2 || chebyshev(b.cell, water) <= 2);

  // 帮忙抬货：有一方手上带着东西，另一方空着手。先判这一条，因为它是唯一
  // 一条好事——被其余两条盖掉的话，镇子上就只剩坏事可记。
  const carrier = a.carrying ? a : b.carrying ? b : undefined;
  const helper = carrier === undefined ? undefined : carrier.id === a.id ? b : a;
  if (gate === 0 && carrier !== undefined && helper !== undefined && !carrier.walking) {
    return {
      kind: 'street_help',
      text: `${helper.name}帮${carrier.name}抬了一把货。`,
      where: { x: carrier.cell.x, y: carrier.cell.y },
      actorId: helper.id,
      otherId: carrier.id,
      bubbles: pairBubbles(helper, carrier, '我来搭把手。', '多谢，正抬不动。'),
      durationMs: INCIDENT_DURATION_MS,
    };
  }

  // 抢水：清晨的井边。水里那件事只在这两个小时里有。
  if (gate === 1 && minute >= 5 * 60 && minute < 9 * 60 && nearWater && water !== null) {
    return {
      kind: 'street_water',
      text: `${a.name}和${b.name}在井边抢水。`,
      where: { ...water },
      actorId: a.id,
      otherId: b.id,
      bubbles: pairBubbles(a, b, '这水是我先到的。', '桶都让你碰倒了。'),
      durationMs: INCIDENT_DURATION_MS,
    };
  }

  // 撞翻担子：一个在赶路，另一个近得能撞上。
  if (gate === 2 && close && a.walking !== b.walking) {
    const walker = a.walking ? a : b;
    const stander = a.walking ? b : a;
    return {
      kind: 'street_tumble',
      text: `${walker.name}撞翻了${stander.name}的担子。`,
      where: { x: stander.cell.x, y: stander.cell.y },
      actorId: walker.id,
      otherId: stander.id,
      bubbles: pairBubbles(walker, stander, '哎呀，担子翻了。', '看着点路。'),
      durationMs: INCIDENT_DURATION_MS,
    };
  }

  return undefined;
}
