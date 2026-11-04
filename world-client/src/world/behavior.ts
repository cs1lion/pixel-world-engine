/** 行为规则与目标队列：一拍「做什么」不再是一条写死的调用链。
 *
 * 原先 `stepIdle` 把顺序钉死成
 * `chaseVerification → preCoverHabit → routine`：想插一条新行为，只能回去改
 * 那一处 `if`，而且顺序是代码位置决定的，不是声明出来的。
 *
 * 这里把它拆成两层：
 *
 *   - `BehaviorRule`：`match(上下文) → 目标 | 空`。注册表按**登记顺序**评估，
 *     第一个命中即产出目标；顺序是表里写着的，两次交换就能证明不是硬编码。
 *   - `GoalQueue`：一拍可以有「当前目标 + 后续目标」，`interrupt` / `resume`
 *     把当前拍记下来再放回去。**默认路径只会 `setCurrent`**，本块没有任何
 *     规则调用打断——接口先有，触发留给后面的块。
 *
 * 纪律：纯结构。`match` 背后仍是原有那三个方法，判据、语句、副作用顺序
 * 逐字不变；这一层只负责「谁先问、问到了就停」。
 */

import type { GridPoint } from './types.ts';

/** 一个目标。字段与旧链记录的那几项一一对应，不多不少。 */
export interface BehaviorGoal {
  /** `verify` / `pre-cover` / `routine` / `quiet`。 */
  readonly kind: string;
  readonly target: GridPoint | null;
  readonly beatId: string | null;
  readonly routineIndex: number | null;
}

/** 命中后连同「是哪条规则下的」一起交出来；规则 id 由注册表盖章。 */
export interface BehaviorOutcome {
  readonly rule: string;
  readonly goal: BehaviorGoal;
}

/**
 * 规则能问的东西。这里刻意只开三个口子：
 * 规则不需要认识村民、楼、记忆，它只问「求证这一拍成立吗 / 盖布这一拍成立吗 /
 * 作息挑到哪一拍」。
 */
export interface BehaviorContext {
  readonly villagerId: string;
  verificationGoal(): BehaviorGoal | null;
  preCoverGoal(): BehaviorGoal | null;
  /** 「饿了，去吃点东西」：需求层第一版只有这一个口子。 */
  eatGoal(): BehaviorGoal | null;
  routineGoal(): BehaviorGoal | null;
}

export interface BehaviorRule {
  readonly id: string;
  match(ctx: BehaviorContext): BehaviorGoal | null;
}

/**
 * 注册表 + 兜底。
 *
 * `fallback` 单独给：空规则集时行为必须仍等于原来的 `routine`（这是硬约束）。
 * 如果 fallback 已经在 `rules` 里，就不再重复评一次。
 */
export class BehaviorPlanner {
  private rules: readonly BehaviorRule[];
  private readonly fallback: BehaviorRule;

  constructor(rules: readonly BehaviorRule[], fallback: BehaviorRule) {
    this.rules = rules;
    this.fallback = fallback;
  }

  /** 运行期换表：新增规则不必改 `Simulation` 的分支，只要把表递进来。 */
  setRules(rules: readonly BehaviorRule[]): void {
    this.rules = rules;
  }

  orderedIds(): readonly string[] {
    return this.rules.map((rule) => rule.id);
  }

  plan(ctx: BehaviorContext): BehaviorOutcome | null {
    for (const rule of this.rules) {
      const goal = rule.match(ctx);
      if (goal !== null) return { rule: rule.id, goal };
    }
    if (this.rules.includes(this.fallback)) return null;
    const goal = this.fallback.match(ctx);
    return goal === null ? null : { rule: this.fallback.id, goal };
  }
}

/**
 * 一拍的目标队列。
 *
 * - `setCurrent`：这一拍选中了什么；
 * - `enqueue`：同一拍里排着的后续目标（默认路径不用）；
 * - `interrupt(reason)`：把当前目标**原样存起来**再清空，记一次打断；
 * - `resume()`：条件消失后把存下的目标放回当前。
 *
 * 打断计数是运行时读数，不进存档。
 */
export class GoalQueue {
  private current: BehaviorGoal | null = null;
  private queued: BehaviorGoal[] = [];
  private suspended: BehaviorGoal | null = null;
  private interrupts = 0;
  private lastReason: string | null = null;

  get currentGoal(): BehaviorGoal | null {
    return this.current;
  }

  get queuedGoals(): readonly BehaviorGoal[] {
    return this.queued;
  }

  get interruptCount(): number {
    return this.interrupts;
  }

  get lastInterruptReason(): string | null {
    return this.lastReason;
  }

  setCurrent(goal: BehaviorGoal | null): void {
    this.current = goal;
  }

  enqueue(goal: BehaviorGoal): void {
    this.queued.push(goal);
  }

  /** 取走下一个排着的目标；没有就返回空。 */
  shift(): BehaviorGoal | null {
    return this.queued.shift() ?? null;
  }

  clear(): void {
    this.current = null;
    this.queued = [];
    this.suspended = null;
    this.lastReason = null;
  }

  /**
   * 打断：把当前目标存进 `suspended` 再清空当前。
   * 没有当前目标时什么也不做（返回 false）——打断不是凭空造一个目标。
   */
  interrupt(reason: string): boolean {
    if (this.current === null) return false;
    this.suspended = this.current;
    this.current = null;
    this.interrupts += 1;
    this.lastReason = reason;
    return true;
  }

  /** 恢复：把打断时存下的目标放回当前。恢复过一次就不再重复恢复。 */
  resume(): boolean {
    if (this.suspended === null) return false;
    this.current = this.suspended;
    this.suspended = null;
    return true;
  }
}
