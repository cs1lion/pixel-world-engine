/** 默认行为规则表：**登记顺序就是优先级**。
 *
 * 五条规则，前三段与旧链逐字相同，后两条是需求层：
 *
 *   1. `verification` —— 心里存着疑，先去现场看看；
 *   2. `pre-cover`    —— 昨天淋过雨（记忆未淡）、今天过了 13:00，先把摊布盖上；
 *   3. `sleep`        —— 熬不住就睡（第二版）；睡着时每拍都命中，醒了才让位；
 *   4. `eat`          —— 饿了去吃一口（阈下不命中）；
 *   5. `routine`      —— 没别的事时按作息走，也是兜底。
 *
 * 为什么 `sleep` 排在 `eat` 之前：睡着的人不该被饥饿拽起来走一趟。两条都跨阈时
 * 「先睡，睡醒再吃」；睡醒那一拍 `sleep` 返回 null，同一拍就轮到 `eat` / `routine`，
 * 不用另加一个「醒来」分支。
 *
 * 两条「路由」在这一层成为登记项：
 *   - `pre-cover` 是规则：条件全在旧 `preCoverHabit` 里，原样搬来；
 *   - `avoid` 是 **候选过滤**，不是目标生产者——它决定「这个落点去不去」，
 *     命中后同一拍还要继续试下一拍。把它硬塞成 `Goal | null` 会让「同一拍
 *     再试下一拍」消失，那是改行为。所以它登记在 `ROUTINE_GUARDS` 里，
 *     语义、计数与 20 世界秒的重试间隔都和旧 `avoiding` 逐字相同。
 */

import type { GridPoint } from './types.ts';
import type { BehaviorRule } from './behavior.ts';

export const VERIFICATION_RULE: BehaviorRule = {
  id: 'verification',
  match: (ctx) => ctx.verificationGoal(),
};

export const PRE_COVER_RULE: BehaviorRule = {
  id: 'pre-cover',
  match: (ctx) => ctx.preCoverGoal(),
};

export const ROUTINE_RULE: BehaviorRule = {
  id: 'routine',
  match: (ctx) => ctx.routineGoal(),
};

/** 饿了：跨过阈值才轮得到它。排在作息之前——饿着没法安心过日子。 */
export const EAT_RULE: BehaviorRule = {
  id: 'eat',
  match: (ctx) => ctx.eatGoal(),
};

/**
 * 熬不住：跨过疲劳阈值就地睡下，睡着时每拍保持，衰减到 0 才醒。
 *
 * 排在 `eat` 之前：睡着的人不该被饥饿拽起来。醒的那一拍它返回 null，
 * 同一拍继续问 `eat` / `routine`——「醒来回正常」不需要第二个分支。
 */
export const SLEEP_RULE: BehaviorRule = {
  id: 'sleep',
  match: (ctx) => ctx.sleepGoal(),
};

/**
 * 定时夜休：21:00 回锚点歇下、22:00–05:00 睡、05:20 动身去水边（main 的 `ec42e91`）。
 *
 * 排在疲劳睡**之后**：两套睡眠共存时，疲劳先跨阈就地睡的那一段归它独占；
 * 没跨阈的夜里才轮到这条。设定集自带作息的世界（`hasExplicitRoutine`）里
 * 这条不命中——那份作息就是全部日常，引擎不替它加一张床。
 */
export const REST_RULE: BehaviorRule = {
  id: 'rest',
  match: (ctx) => ctx.restGoal(),
};

/** 默认顺序 = 旧链顺序 + 需求层两条：睡在吃前，都在作息前（不命中时逐字等价）。 */
export const DEFAULT_BEHAVIOR_RULES: readonly BehaviorRule[] = [
  VERIFICATION_RULE,
  PRE_COVER_RULE,
  SLEEP_RULE,
  REST_RULE,
  EAT_RULE,
  ROUTINE_RULE,
];

/**
 * 候选过滤能问的东西。判据（离「不想见的人」多近）留在 `Simulation`，
 * 这里只决定「跳过与否」以及照旧记一笔对照读数。
 */
export interface RoutineGuardContext {
  readonly villagerId: string;
  /** 命中的「不想见的人」；没有就是 `null`。纯判据，不记账。 */
  avoidedOther(target: GridPoint): string | null;
  /** 命中一次记一笔（累计、按人、按对），与旧 `avoidsAnchor` 相同。 */
  noteAvoided(otherId: string): void;
  /** 这一拍不去，下一次最早何时再挑。旧 `avoiding` 写死 20 世界秒。 */
  retryLater(delayMs: number): void;
}

export interface RoutineGuard {
  readonly id: string;
  /** 返回 true = 这个候选落点跳过，同一拍继续试下一拍。 */
  skip(target: GridPoint, ctx: RoutineGuardContext): boolean;
}

/** trust < −0.15 的「不想见某人」：近了就换一拍。 */
export const AVOIDANCE_GUARD: RoutineGuard = {
  id: 'avoid',
  skip: (target, ctx) => {
    const other = ctx.avoidedOther(target);
    if (other === null) return false;
    ctx.noteAvoided(other);
    // 避开不是发呆：这一拍不去，下一拍还会重挑。给一个 20 世界秒的重试间隔，
    // 否则一拍的 `for` 走完就回到 `stepIdle`，同一个落点会被每 100ms 重算一次，
    // 对照读数会变成「逻辑步数」而不是「跳过几拍」。
    ctx.retryLater(20_000);
    return true;
  },
};

export const ROUTINE_GUARDS: readonly RoutineGuard[] = [AVOIDANCE_GUARD];
