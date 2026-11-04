/**
 * 过渡与打断回位的**渲染层状态机**（第二步）。
 *
 * 边界：
 * - 这里只改「画出来的样子」，世界、存档、记忆一律不读不写；三枚 sha256 与
 *   事件数因此与改造前逐字相同。
 * - 时长全部用世界拍表达（1 拍 = 1/12 秒），不碰 `Date.now`/`performance.now`/
 *   `Math.random`；同一世界拍两次采样逐字段相同。
 * - 有验收开关：`setAnimationTransitions(false)` 时立刻切到终态、不播过渡，
 *   循环段仍按世界拍取帧，冻结帧重复截图 0 差异。
 *
 * 本步覆盖：转身、进场/离场（淡入淡出）、被任务打断后回原拍。
 * **不覆盖上下楼**：世界快照里没有楼层/楼梯字段（`src/world` 下 grep
 * `floor|stairs|level|upstairs` 无命中），没有输入源就不假装有过渡。
 */

import type { VillagerSnapshot } from '../world/types.ts';

/** 转身时长：2 拍。第 0 拍仍朝旧方向，第 1 拍转到新方向。 */
export const TURN_BEATS = 2;
/** 进场/离场时长：3 拍，alpha 三档 0/0.5/1。 */
export const DOOR_BEATS = 3;

let transitionsEnabled = true;

/** 验收开关。关掉后所有过渡立即落终态，且不产生新的帧号。 */
export function setAnimationTransitions(on: boolean): void {
  transitionsEnabled = on;
}

export function animationTransitionsOn(): boolean {
  return transitionsEnabled;
}

export interface FacingSample {
  readonly facing: VillagerSnapshot['facing'];
  /** 转身时朝新方向让出的 1px，读成重心的转移，不是位移。 */
  readonly offsetX: number;
  readonly turning: boolean;
}

export interface VisibilitySample {
  readonly visible: boolean;
  readonly alpha: number;
  readonly transitioning: boolean;
}

type Facing = VillagerSnapshot['facing'];

const leanOf = (facing: Facing): number => {
  if (facing === 'right') return 1;
  if (facing === 'left') return -1;
  return 0;
};

/**
 * 一个村民一个实例，只活在渲染层。
 */
export class VillagerTransition {
  private facing: Facing | null = null;
  private turnStart = 0;
  private turnFrom: Facing = 'down';
  private turnTo: Facing = 'down';

  private visible: boolean | null = null;
  private doorStart = 0;
  private doorFrom = true;
  private doorTo = true;

  /** 朝向过渡：目标一变就起算，固定 `TURN_BEATS` 拍。 */
  sampleFacing(facing: Facing, beat: number): FacingSample {
    if (!transitionsEnabled) {
      this.facing = facing;
      return { facing, offsetX: 0, turning: false };
    }
    if (this.facing === null) {
      this.facing = facing;
      this.turnFrom = facing;
      this.turnTo = facing;
      this.turnStart = beat;
    } else if (facing !== this.facing) {
      this.turnFrom = this.turnTo;
      this.turnTo = facing;
      this.turnStart = beat;
      this.facing = facing;
    }
    const elapsed = beat - this.turnStart;
    if (this.turnFrom === this.turnTo) {
      return { facing: this.turnTo, offsetX: 0, turning: false };
    }
    const turning = elapsed < TURN_BEATS - 1;
    if (!turning) return { facing: this.turnTo, offsetX: 0, turning: false };
    return {
      facing: this.turnFrom,
      offsetX: leanOf(this.turnTo),
      turning: true,
    };
  }

  /** 进场/离场：目标一变就起算，固定 `DOOR_BEATS` 拍淡入淡出。 */
  sampleVisible(visible: boolean, beat: number): VisibilitySample {
    if (!transitionsEnabled) {
      this.visible = visible;
      return { visible, alpha: 1, transitioning: false };
    }
    if (this.visible === null) {
      this.visible = visible;
      this.doorFrom = visible;
      this.doorTo = visible;
      this.doorStart = beat;
    } else if (visible !== this.visible) {
      this.doorFrom = this.doorTo;
      this.doorTo = visible;
      this.doorStart = beat;
      this.visible = visible;
    }
    if (this.doorFrom === this.doorTo) {
      return { visible: this.doorTo, alpha: 1, transitioning: false };
    }
    const elapsed = beat - this.doorStart;
    if (elapsed >= DOOR_BEATS - 1) {
      return { visible: this.doorTo, alpha: 1, transitioning: false };
    }
    const progress = elapsed / (DOOR_BEATS - 1);
    const alpha = this.doorTo ? progress : 1 - progress;
    return { visible: true, alpha, transitioning: true };
  }
}
