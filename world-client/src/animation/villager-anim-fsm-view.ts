/**
 * 动画状态机 → 渲染的**唯一转接层**（第二版，`?animfsm=1` 开关）。
 *
 * 为什么单独一层：`villager-anim-fsm.ts` 只回答「权重是多少」，它不知道
 * `VillagerMode`、不知道排版、也不认识 Phaser。这里把「状态」翻译成旧渲染层
 * 认识的 `mode / walking / 帧号 / 权重`，并决定**这一帧到底走不走状态机**。
 *
 * 三条纪律：
 *   - 开关缺省关闭：`?animfsm` 不写 / 写 `0` 时 `source === 'legacy'`，
 *     计划里没有层、没有 FSM 状态，帧号原样透传——今天的 157 张基线必须逐字节不变。
 *   - 稳态钉（`ActorPin.settled` 缺省 `true`）不进食过渡：它要求「一层、权重 1、
 *     帧号就是钉住的那个」，与旧系统的 `poseFrame` 路径等价。
 *   - 只有 `settled: false` 或根本没有姿态钉时才接管。过渡时长保持
 *     `villager-anim-fsm.ts` 的 design 值，本层一个数字都不改。
 *
 * 纯函数：不读时钟、不碰 DOM、不 import Phaser；同一输入必得同一计划。
 */

import {
  advanceAnimFsm,
  animIntentOf,
  createAnimFsmState,
  sampleAnimFsm,
  type AnimFsmState,
  type AnimStateId,
} from './villager-anim-fsm.ts';
import { villagerPoseAtFrame, type VillagerPose } from '../render/villager-frames.ts';
import type { VillagerMode } from '../world/types.ts';

/** URL 参数名。只有 `?animfsm` / `?animfsm=1` 算开，其余一律关。 */
export const ANIM_FSM_QUERY = 'animfsm';

export function animFsmEnabledOf(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const value = params.get(ANIM_FSM_QUERY);
  return value === '' || value === '1';
}

/** 这一帧由谁画。`legacy` = 今天的老路径；`settled` = 稳态钉；`fsm` = 状态机接管。 */
export type AnimDrawSource = 'legacy' | 'settled' | 'fsm';

export interface AnimRenderLayer {
  readonly state: AnimStateId;
  /** 该层自己的排版 mode：残影按它原来的动作画，不借用当前 mode。 */
  readonly mode: VillagerMode;
  readonly walking: boolean;
  readonly frame: number;
  readonly weight: number;
  readonly pose: VillagerPose;
}

export interface AnimDrawPlan {
  readonly source: AnimDrawSource;
  /** `legacy` / `settled`：交给旧路径的帧号（未钉住是 `null`）；`fsm`：恒为 `null`。 */
  readonly frame: number | null;
  /** `fsm`：推进后的状态；其余为 `null`（表示没有执行状态机）。 */
  readonly state: AnimFsmState | null;
  /** `fsm`：「当前 → 残影」顺序；其余为空数组。 */
  readonly layers: readonly AnimRenderLayer[];
  /** `fsm`：各层位移的加权和，供伞/怀抱物对齐；其余为 `null`。 */
  readonly offsetY: number | null;
}

export interface VillagerDrawInput {
  readonly enabled: boolean;
  readonly mode: VillagerMode;
  readonly walking: boolean;
  /** 动画采样时刻（已含灯油量化）。状态机不自己读时钟。 */
  readonly nowMs: number;
  /** 第五枚钉子给的帧号；`null` = 没钉。 */
  readonly pinnedFrame: number | null;
  /** 钉子是否要求稳态。`null` = 没有姿态钉；`true`/缺省 = 稳态。 */
  readonly settled: boolean | null;
  /** 上一帧的状态机状态；首次为 `null`。 */
  readonly prev: AnimFsmState | null;
}

/**
 * 选择这一帧的画法。**开关关闭时必须在第一行返回**：那之后的一切（推进状态、
 * 算权重、采样）都不该发生，否则「关闭 = 不接管」就成了口头约定。
 */
export function animDrawSourceOf(
  enabled: boolean,
  pinnedFrame: number | null,
  settled: boolean | null,
): AnimDrawSource {
  if (!enabled) return 'legacy';
  if (pinnedFrame !== null && settled !== false) return 'settled';
  return 'fsm';
}

/** 状态 → 排版 mode。只认三个有动作叠加的；其余都按站立（lift 由帧表给 0）。 */
export function animStateModeOf(state: AnimStateId): VillagerMode {
  switch (state) {
    case 'salute':
      return 'saluting';
    case 'work':
      return 'working';
    case 'deliver':
      return 'delivering';
    default:
      return 'idle';
  }
}

export function villagerDrawPlanOf(input: VillagerDrawInput): AnimDrawPlan {
  const source = animDrawSourceOf(input.enabled, input.pinnedFrame, input.settled);
  if (source !== 'fsm') {
    return { source, frame: input.pinnedFrame, state: null, layers: [], offsetY: null };
  }

  const intent = animIntentOf(input.mode, input.walking);
  const base = input.prev ?? createAnimFsmState(intent, input.nowMs);
  const state = advanceAnimFsm(base, intent, input.nowMs);
  const sample = sampleAnimFsm(state, input.nowMs);

  const layers: AnimRenderLayer[] = sample.layers.map((layer) => {
    const layerMode = animStateModeOf(layer.state);
    const layerWalking = layer.state === 'walk';
    return {
      state: layer.state,
      mode: layerMode,
      walking: layerWalking,
      frame: layer.frame,
      weight: layer.weight,
      pose: villagerPoseAtFrame(layerMode, layerWalking, layer.frame),
    };
  });

  return { source, frame: null, state, layers, offsetY: sample.offsetY };
}
