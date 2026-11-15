/**
 * 视听反馈渲染层（sensory Phase 2）：神谕金色像素光柱与 2 逻辑拍行礼状态机。
 *
 * 两样东西都**只由世界/评测时钟推进，不碰 `Date.now()` / `Math.random()`**：
 *   - 行礼倒计时（`saluteTicksRemaining`）按逻辑拍递减，第 2 拍归零后释放寻路；
 *   - 金色像素光柱按固定 `durationTicks` 持续 2 拍，归零后熄灭。
 * 画面层只是把这两个状态落到渲染，不决定状态。
 */
import { WORLD } from '../world/palette-data.ts';

export interface OracleBeamFxSpec {
  readonly kind: 'oracle-beam';
  readonly worldX: number;
  readonly worldY: number;
  readonly colorHex: number;
  readonly durationTicks: number;
  readonly widthPx: number;
}

/** 金色像素光柱：神谕/面板动作触发，持续 2 逻辑拍。 */
export function createOracleBeamSpec(worldX: number, worldY: number): OracleBeamFxSpec {
  return {
    kind: 'oracle-beam',
    worldX,
    worldY,
    colorHex: WORLD.amber,
    durationTicks: 2,
    widthPx: 14,
  };
}

/** 光柱状态：从关到开，按固定拍推进到时长，到期熄灭。 */
export class OracleBeamFx {
  private readonly spec: OracleBeamFxSpec;
  private active = false;
  private tick = 0;

  constructor(spec: OracleBeamFxSpec) {
    this.spec = spec;
    this.active = false;
    this.tick = 0;
  }

  /** 触发光柱（从第 0 拍开始）。 */
  begin(): void {
    this.active = true;
    this.tick = 0;
  }

  /** 推进若干逻辑拍；到时长后熄灭。 */
  advance(tickDelta = 1): void {
    if (!this.active) return;
    this.tick += tickDelta;
    if (this.tick >= this.spec.durationTicks) {
      this.active = false;
      this.tick = 0;
    }
  }

  isActive(): boolean {
    return this.active;
  }
}

export interface OracleSaluteState {
  readonly saluteTicksRemaining: number;
  readonly isSaluting: boolean;
  readonly actionBobPhase: number;
}

/** 接到神谕/面板动作：锁定 2 逻辑拍行礼。 */
export function beginOracleSalute(): OracleSaluteState {
  return { saluteTicksRemaining: 2, isSaluting: true, actionBobPhase: 1 };
}

/** 行礼按逻辑拍递减；归零后释放寻路。 */
export function stepOracleSalute(state: OracleSaluteState): OracleSaluteState {
  if (state.saluteTicksRemaining <= 0) {
    return { saluteTicksRemaining: 0, isSaluting: false, actionBobPhase: 0 };
  }
  const nextRemaining = state.saluteTicksRemaining - 1;
  return {
    saluteTicksRemaining: nextRemaining,
    isSaluting: nextRemaining > 0,
    actionBobPhase: nextRemaining > 0 ? state.actionBobPhase + 1 : 0,
  };
}
