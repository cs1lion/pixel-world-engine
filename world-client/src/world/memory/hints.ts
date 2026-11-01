/** 叙事装饰：记忆层交给表现层的唯一一张单子。
 *
 * 补充设计 §10 把话堵在这句上：「**表现层只消费 ExpressionHint，不直接读记忆库**」。
 * 所以 `SandboxScene` 不许伸手去 `viewOf(楼).traces` 里翻痕迹——它只能读这里出去的单子。
 *
 * 这不是洁癖。痕迹的可读性是一道闸（`traceExposedLayers`：一栋楼最多露出
 * 前 3 道，按 `intensity × visibility` 排），推断走 `lookAtTraces`、画面走
 * `placeHints`，两处必须是**同一道闸的同一种读法**。让渲染层自己翻库，那道闸
 * 就分叉成两条，而其中一条没人测——`test/trace-hints.test.ts` 钉的正是这个。
 *
 * 今天这张单子上只有一种东西：**痕迹**（`decal`）。改名不进这张单子——
 * 它不是装饰，是名字本身，读它的是 `placeNameOf`（DOM 面板与 `Oracle`）。
 * 文档里的 `ExpressionHint` 是复数形态，这一层只长出了一种，就只写一种；
 * 将来真需要第二种再加，不先摆一个没人发的空分支。
 */

import type { Trace, TraceLayer } from './types.ts';
import { exposedTraces } from './traces.ts';

/** 一道该画在楼上的痕迹。 */
export interface NarrativeHint {
  readonly type: 'decal';
  /** 画在哪栋楼上（`place:x,y` 或楼实例 id）。 */
  readonly placeId: string;
  readonly traceId: string;
  readonly layer: TraceLayer;
  /** 0..1 的浓淡。 */
  readonly intensity: number;
  /** 0..1 的残存可见度。风化只降这个数，不删记录（协议 §11）。 */
  readonly visibility: number;
}

/**
 * 一个地点此刻该露出来的痕迹。
 *
 * `limit` 是 `config.traceExposedLayers`——**由调用方给**，与 `lookAtTraces`
 * 拿到的是同一个数。写死在这里就等于把闸的值抄了两份。
 *
 * 顺序即 `exposedTraces` 的顺序（`intensity × visibility` 降序，同分按 id），
 * 不重排：谁先被看见谁先画，与推断那边一致。
 */
export function placeHints(traces: readonly Trace[], limit: number): NarrativeHint[] {
  return exposedTraces(traces, limit).map((trace) => ({
    type: 'decal' as const,
    placeId: trace.placeId,
    traceId: trace.traceId,
    layer: trace.layerType,
    intensity: trace.intensity,
    visibility: trace.visibility,
  }));
}
