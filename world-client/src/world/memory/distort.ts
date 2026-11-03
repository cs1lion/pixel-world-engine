/**
 * 记错：记忆层的偏差，不是断言的造假。
 *
 * 协议里「转述只能丢细节、放大情绪，方向不能变」管的是**断言**（`retell`）。
 * 这一层管的是**个人的记忆条目**：同一件事，不同的人记成不同的样子是常态。
 * 偏差只改记忆条目的内容，并留下 `bias` 标记；`eventRefs` 始终指向真实事件，
 * 所以「他记错了」仍然可以回到事件日志核对——不是把事实换成编造。
 *
 * 四个类型对应第一版要能说清的四类错法：
 * - `detail-substitution`：细节被替换（地点变成说不出名字的地方）；
 * - `causal-mismatch`：因果记反（在句尾留下标记，不重写原句）；
 * - `time-shift`：时间错位（记成半天后）；
 * - `wrong-person`：张冠李戴（参与者记成了「某人」）。
 */

import { DAY_MS } from './config.ts';
import type { MemoryBias, MemoryContent } from './types.ts';

export type { MemoryBias };

export const MEMORY_BIASES: readonly MemoryBias[] = [
  'detail-substitution',
  'causal-mismatch',
  'time-shift',
  'wrong-person',
];

export interface Distorted {
  readonly content: MemoryContent;
  readonly bias: MemoryBias;
}

/** 施加一种偏差。纯函数：同一份输入永远得到同一份输出（回放要能重现）。 */
export function misremember(content: MemoryContent, bias: MemoryBias): Distorted {
  switch (bias) {
    case 'detail-substitution':
      return {
        bias,
        content: { ...content, where: '某个地方', detailLevel: 1 },
      };
    case 'causal-mismatch':
      return {
        bias,
        content: { ...content, what: `${content.what}（因果记反了）` },
      };
    case 'time-shift':
      return {
        bias,
        content: { ...content, when: content.when + DAY_MS / 2 },
      };
    case 'wrong-person':
      return {
        bias,
        content: { ...content, who: ['某人'], detailLevel: Math.min(1, content.detailLevel) },
      };
  }
}

/**
 * 这条记忆要不要记错、记成哪一类。
 *
 * 确定性：同一个 `eventRef + holderId` 永远得到同一个答案，存档回放不会
 * 因为换台机器就从「记对」变成「记错」。`every = 7` 是第一版的粗阈值，
 * 意味着大约七分之一的「听来的」记忆会带一种偏差。
 */
export function biasFor(eventRef: string, holderId: string, every = 7): MemoryBias | null {
  if (every <= 0) return null;
  let hash = 0;
  for (const char of `${eventRef}\u0000${holderId}`) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  }
  if (hash % every !== 0) return null;
  return MEMORY_BIASES[hash % MEMORY_BIASES.length] ?? null;
}
