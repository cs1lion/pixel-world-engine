/**
 * 听见：一条声音能传到哪里。
 *
 * 与「看见」（`perception.ts`）分开算，因为两者不是同一条通道：
 * 视线要求两点之间没有墙，声音则是「距离越远越轻、隔墙更轻」。
 * 第一版把墙体当硬阻挡（与视线共用 `hasLineOfSight`），距离按声音类型给半径；
 * 阈值都写在 `SOUND_RADIUS`，调整它们是改数字，不是改规则。
 *
 * **室内仍然是硬的**：屋里的声音只有同一个房间里的人听得见。这与室内事件
 * 只有同房间目击者是同一条世界设定（见 `perception.ts` 的文件头）。
 */

import type { GridPoint } from '../types.ts';
import type { MemoryConfig } from './config.ts';
import { distance, hasLineOfSight, type OcclusionGrid, type Perceiver } from './perception.ts';

export type SoundKind = 'speech' | 'work' | 'impact' | 'miracle';

/**
 * 每种声音的传播半径（格）。
 *
 * - `speech`：平常说话，只够近处几个人听见；
 * - `work`：干活的声音，比说话远一点；
 * - `impact`：拆楼、雷声这类，传得最远的日常声音；
 * - `miracle`：神迹，全村的尺度，但仍有上限。
 */
export const SOUND_RADIUS: Readonly<Record<SoundKind, number>> = {
  speech: 6,
  work: 8,
  impact: 12,
  miracle: 20,
};

/** 一条世界事件对应哪种声音。未知类型按「干活」算，不假装是神迹。 */
export function soundKindOf(eventKind: string): SoundKind {
  switch (eventKind) {
    case 'task_done':
    case 'milestone':
    case 'routine_done':
    case 'work_output':
      return 'work';
    case 'conflict':
      return 'impact';
    case 'weather_anomaly':
      return 'impact';
    case 'celebration':
      return 'miracle';
    default:
      return 'speech';
  }
}

export interface SoundSource {
  readonly placeId: string;
  readonly at: GridPoint;
  readonly indoor: boolean;
  readonly kind: SoundKind;
}

export interface HearingInput {
  readonly sound: SoundSource;
  readonly perceivers: readonly Perceiver[];
  readonly grid: OcclusionGrid;
  readonly config: MemoryConfig;
}

/**
 * 谁会听见这条声音。按输入顺序返回、去重。
 *
 * 规则：
 * 1. 室内声音：只有同房间的人听见；屋外的人听不见（与室内事件同一设定）。
 * 2. 距离：超过该声音类型的半径就听不见。
 * 3. 墙：视线不通就听不见（第一版把墙体当硬阻挡）。
 */
export function heardBy(input: HearingInput): string[] {
  const { sound, perceivers, grid, config } = input;
  const radius = SOUND_RADIUS[sound.kind];
  const heard: string[] = [];
  const seen = new Set<string>();
  for (const perceiver of perceivers) {
    if (seen.has(perceiver.holderId)) continue;
    if (!hears(perceiver, sound, grid, config, radius)) continue;
    seen.add(perceiver.holderId);
    heard.push(perceiver.holderId);
  }
  return heard;
}

/** 单个观察者听不听得见。 */
export function hears(
  perceiver: Perceiver,
  sound: SoundSource,
  grid: OcclusionGrid,
  config: MemoryConfig,
  radius = SOUND_RADIUS[sound.kind],
): boolean {
  if (sound.indoor) return perceiver.inside === sound.placeId;
  if (distance(perceiver.at, sound.at) > radius) return false;
  if (!config.occlusion) return true;
  return hasLineOfSight(perceiver.at, sound.at, grid);
}
