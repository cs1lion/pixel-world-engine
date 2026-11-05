/**
 * 交付失败：从「世界状态」到「正式事件流」的那一步。
 *
 * 块 4 的失败分支只改了 `TaskRecord.status`、弹了一句气泡、写了一条会滚出
 * 窗口的日志——记忆层什么也收不到。这里把同一件事同时做成两样东西：
 *
 * 1. 一条 `world.event`（`kind = 'delivery_failed'`）：进日志、进记忆、
 *    能被感知与听见；
 * 2. 一行 `DeliveryFailure`：世界自己的事件账，日报的失败数从这里数。
 *
 * 为什么单独一个模块：`simulation.ts` 上还有另一条线在做「回家判成在室内」，
 * 把载荷拼装与文案留在这里，世界只留一个调用点，减少冲突面积。
 */

import type { DeliveryFailure, GridPoint, TaskKind } from './types.ts';
import type { WorldChange } from './world-changes.ts';

/** 失败原因的闭集。当前只有饥饿；加一种要同时改服务端 `FAILURE_REASONS`。 */
export type DeliveryFailureReason = 'hunger';

/**
 * `world.event` 载荷里的 `failure` 子对象。定义放在这里而不是
 * `world-changes.ts`，是为了让「`taskKind` 引用 `types.ts` 的别名」这条
 * 唯一性锚点仍然唯一（`server/tests/test_value_domains.py` 钉着它）。
 */
export interface DeliveryFailurePayload {
  readonly taskId: string;
  readonly taskKind: TaskKind;
  readonly reason: DeliveryFailureReason;
  readonly repeat: boolean;
}

/** 失败发生时世界手上的全部资料。 */
export interface DeliveryFailureInput {
  /** 世界时间（毫秒）。 */
  readonly at: number;
  readonly taskId: string;
  readonly taskKind: TaskKind;
  readonly summary: string;
  readonly workerId: string;
  readonly workerName: string;
  readonly source: 'feed' | 'local';
  /** 有楼用楼实例 id，原地单用 `place:x,y`。 */
  readonly placeId: string;
  readonly where: GridPoint;
  /** 推送前真查一遍事件账得到的值；不是常量。 */
  readonly repeat: boolean;
}

/** 玩家在事件流与气泡里看到的那句话。 */
export function deliveryFailureText(workerName: string, summary: string): string {
  return `${workerName}饿得手抖，${summary}这一趟没送到。`;
}

/** 一条失败 → 一行事件账 + 一条世界改变。两样东西同源，不会各说各话。 */
export function deliveryFailureEventOf(input: DeliveryFailureInput): {
  readonly failure: DeliveryFailure;
  readonly change: WorldChange;
  /** 与 `change.world.event.text` 同一句；调用方写日志时不必再窄化联合类型。 */
  readonly text: string;
} {
  const text = deliveryFailureText(input.workerName, input.summary);
  return {
    text,
    failure: {
      at: input.at,
      taskId: input.taskId,
      summary: input.summary,
      workerId: input.workerId,
      source: input.source,
      reason: 'hunger',
      repeat: input.repeat,
      placeId: input.placeId,
      where: input.where,
    },
    change: {
      change: 'world.event',
      kind: 'delivery_failed',
      text,
      placeId: input.placeId,
      where: input.where,
      actorId: input.workerId,
      failure: {
        taskId: input.taskId,
        taskKind: input.taskKind,
        reason: 'hunger',
        repeat: input.repeat,
      },
    },
  };
}
