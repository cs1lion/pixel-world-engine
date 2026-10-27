/** 痕迹：地点的物质化记忆，以及从痕迹反推出来的推断。
 *
 * 协议第 11 节：place Holder 的记忆是 Trace，由后果规则生成，
 * `consequence(event.kind, intensity, place_type) → TraceSpec`。
 *
 * 补充设计 §1.2 把另一半也定了：**路过的单位看见痕迹，能推断出什么**。
 * 那是一张查表，不是模型推断——「焦痕」永远推成「这里发生过事故」，
 * 不会因为这次路过的是个想象力丰富的人就推成别的。这正是「不允许凭空编造」
 * 在痕迹通道上的落法。
 *
 * 两张表都放在这一个文件里，因为它们必须**互相认得**：能生成哪种痕迹，
 * 就得有那种痕迹的推断。分成两个文件之后，加一种痕迹而忘了加推断的表现是
 * 「地上有东西，但谁也看不懂」——而且不报错。
 */

import type { MemoryKind, Trace, TraceLayer } from './types.ts';

/** 生成痕迹的输入。`intensity` 0..1。 */
export interface ConsequenceInput {
  readonly eventId: string;
  readonly kind: string;
  readonly placeId: string;
  readonly placeType: string;
  readonly intensity: number;
  readonly day: number;
  /** 这一类事在这个地点重复过几次。反复发生会留下磨损。 */
  readonly recurrence: number;
}

/** 一条待落的痕迹规格，还没有 id 与可见度。 */
export interface TraceSpec {
  readonly layerType: TraceLayer;
  readonly intensity: number;
  /** 同一地点同层的同类痕迹会被合并，而不是无限叠加。 */
  readonly mergeKey: string;
}

/**
 * 后果规则：这件事在这个地点留下什么。
 *
 * 返回空数组是正当结果——大部分事件不留痕。留痕要克制：每个地点只有 5 层装饰
 * （补充设计 §3.1），随手给每件事都留一道印子，两天就把地点糊满了，
 * 而痕迹的价值恰恰在于稀少。
 */
export function consequenceOf(input: ConsequenceInput): TraceSpec[] {
  const specs: TraceSpec[] = [];
  const strong = input.intensity >= 0.5;

  if (input.kind === 'workshop_accident' || input.kind === 'conflict') {
    // 事故与冲突：焦痕，或者结构损伤。反复发生转成紧急修补。
    if (input.recurrence >= 2) {
      specs.push({ layerType: 'patch', intensity: input.intensity, mergeKey: 'repair' });
    } else if (strong) {
      specs.push({ layerType: 'scorch', intensity: input.intensity, mergeKey: 'scorch' });
    } else {
      specs.push({ layerType: 'damage', intensity: input.intensity, mergeKey: 'damage' });
    }
  }

  if (input.kind === 'celebration' || input.kind === 'tavern_feast') {
    specs.push({ layerType: 'garland', intensity: input.intensity, mergeKey: 'garland' });
  }

  if (input.kind === 'milestone' || input.kind === 'toponym') {
    // 里程碑刻碑文。碑文是唯一一种高保真痕迹：它绑着一个 event_ref。
    specs.push({ layerType: 'inscription', intensity: Math.max(0.6, input.intensity), mergeKey: 'inscription' });
  }

  // 反复发生：走的人多了就是路。阈值 3 次，低于它只是偶尔经过。
  if (input.recurrence >= 3 && input.placeType !== 'altar') {
    specs.push({
      layerType: 'worn_path',
      intensity: Math.min(1, input.recurrence / 10),
      mergeKey: 'worn',
    });
  }

  return specs;
}

/** 落一条痕迹。id 由调用方给（世界内自增，不用随机数）。 */
export function makeTrace(
  traceId: string,
  input: ConsequenceInput,
  spec: TraceSpec,
): Trace {
  return {
    traceId,
    placeId: input.placeId,
    eventRef: input.eventId,
    layerType: spec.layerType,
    intensity: spec.intensity,
    createdDay: input.day,
    // 新痕迹全可见；风化是日终整理的事（`weatherTrace`），而且**当天不算**：
    // 中午炸的炉子，第二天早上路过的人该看见完整的焦痕，而不是已经掉了一天的。
    visibility: 1,
  };
}

/**
 * 这道痕迹一天掉多少可见度。**按层定，不按全局一个数**。
 *
 * 协议第 11 节把 `visibility_decay` 列为 Trace 自己的字段，补充设计 §3.1 的
 * 定稿表也没有给过这一行的数——因为它本来就不是一个全局旋钮：一场庆典的
 * 花环撑不过两天，一块刻进石头的碑文该比在场所有人都活得久。用同一个速率
 * 冲掉所有痕迹，等于说「焦痕和碑文一样容易忘」，而那正是痕迹通道想区分的
 * 那件事。
 *
 * 取值口径：**活几天**。`0.1` 是十天掉光，`0.02` 是五十天。都按世界日算。
 *
 * | 层 | 一天 | 大约撑 | 为什么 |
 * | --- | --- | --- | --- |
 * | `garland` | 0.30 | 3 天 | 花会枯。这是唯一一种「几天后必然看不见」的痕迹。 |
 * | `damage` | 0.12 | 8 天 | 坏掉的东西要么被修，要么被习惯。 |
 * | `scorch` | 0.10 | 10 天 | 焦痕能扫，但扫不干净。 |
 * | `patch` | 0.06 | 17 天 | 补丁比伤痕耐看——修好了就少有人再提。 |
 * | `worn_path` | 0.03 | 33 天 | 路是走出来的，也靠走维持；没人走了才慢慢长草。 |
 * | `inscription` | 0.01 | 100 天 | 碑文是石头上的字。它几乎不风化。 |
 *
 * 这张表与 `INFERENCE_TABLE` 一样是「材料的事」，所以放在 `traces.ts` 而不是
 * `config.ts`：加一种痕迹要同时回答「它说明什么」与「它能撑多久」，两件事
 * 分开写，早晚会有一边被忘掉。
 */
const VISIBILITY_DECAY: Readonly<Record<TraceLayer, number>> = {
  garland: 0.3,
  damage: 0.12,
  scorch: 0.1,
  patch: 0.06,
  worn_path: 0.03,
  inscription: 0.01,
};

/**
 * 风化一天：可见度按层衰减，**记录不删**。
 *
 * 协议第 11 节那条「风化只降低可见度，不删除记录」是这一行唯一的规矩。
 * 于是这里连 `visibility` 到 0 的痕迹都原样留着——它不再出现在
 * `exposedTraces` 里（那里按 `visibility > 0` 过滤），但仍然挂在 place Holder
 * 的记忆上，仍然带着 `eventRef`。删掉它等于让世界忘掉「这里曾经发生过什么」，
 * 而地点 Holder 的定义就是「不遗忘，只被覆盖或风化」。
 *
 * 已经到 0 的直接返回原对象：不是优化，是**不要再往下减成负数**。负数会让
 * 「快风化的」排到「已经看不见的」后面，两个都该看不见的东西之间还比出个高低。
 */
export function weatherTrace(trace: Trace): Trace {
  if (trace.visibility <= 0) return trace;
  const rate = VISIBILITY_DECAY[trace.layerType];
  return { ...trace, visibility: Math.max(0, trace.visibility - rate) };
}

/** 这个地点此刻**显式暴露**哪几层痕迹。
 *
 * 补充设计 §3.2 A：每个建筑最多显式暴露前 3 个高强度 Trace。按
 * `intensity × visibility` 排序取前 N——强度与残存可见度都算，因为一道
 * 快被雨冲平的焦痕不该压过昨天刚补的补丁。
 *
 * 同 `mergeKey` 的只留一条（由调用方在落痕时合并），这里不重复做。
 */
export function exposedTraces(traces: readonly Trace[], limit: number): Trace[] {
  return [...traces]
    .filter((trace) => trace.visibility > 0)
    .sort((a, b) => {
      const scoreA = a.intensity * a.visibility;
      const scoreB = b.intensity * b.visibility;
      if (scoreA !== scoreB) return scoreB - scoreA;
      // 同分按 id 排：排序必须确定，否则回放出来的「路过者先看见哪一道」会变。
      return a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0;
    })
    .slice(0, limit);
}

/**
 * 从痕迹推断出来的东西。补充设计 §1.2 那张表。
 *
 * `detailLevel` 全是 1（缺省 who）——推断出来的记忆不该比看见的人更详细。
 * `confidence` 是这张表的核心：焦痕只有 0.35，碑文 0.90。路过者据此决定
 * 要不要去打听，而传播链据此决定每跳掉多少。
 *
 * `kind` 也是表里的一列，不是这里现编的：§1.2 第三行「磨损小径 / 固定座位」
 * 的初始字段特征写着 `kind: habit`。原先这一列根本没接——所有推断记忆一律
 * 落 `kind: 'episodic'`，于是 `MemoryKind` 声明的五个种类里只有两个被写出过，
 * `budget.impression`（32 条）与 `limitFor('impression')` 也一直是死的。
 */
export interface InferenceSpec {
  readonly what: string;
  readonly detailLevel: number;
  readonly confidence: number;
  readonly valence: number;
  readonly arousal: number;
  /** 后续传播倾向：驱动他去打听，还是只当背景。 */
  readonly spread: 'ask' | 'colleagues' | 'positive' | 'background';
  /** 碑文是唯一一种直接升级成 `read` 的痕迹。 */
  readonly sourceMode: 'inferred' | 'read';
  /** 落成哪种记忆。只有磨损小径是 `habit`，其余都是情景片段。 */
  readonly kind: MemoryKind;
}

/**
 * 痕迹 → 推断。表里没有的层返回 null：看不懂就是看不懂，不猜。
 *
 * 最后一行（碑文）返回 `sourceMode: 'read'`：碑文绑着 event_ref，读它等于
 * 读一条记录，不是推断。协议把这条单列为「高保真转化」。
 */
export function inferenceOf(layer: TraceLayer): InferenceSpec | null {
  return INFERENCE_TABLE[layer] ?? null;
}

const INFERENCE_TABLE: Readonly<Record<TraceLayer, InferenceSpec>> = {
  scorch: {
    what: '此处近期似乎发生过严重的事故或冲突',
    detailLevel: 1,
    confidence: 0.35,
    valence: -0.6,
    arousal: 0.7,
    spread: 'ask',
    sourceMode: 'inferred',
    kind: 'episodic',
  },
  damage: {
    what: '这里好像出过事，东西被弄坏了',
    detailLevel: 1,
    confidence: 0.35,
    valence: -0.6,
    arousal: 0.7,
    spread: 'ask',
    sourceMode: 'inferred',
    kind: 'episodic',
  },
  patch: {
    what: '这里的设施刚经历过抢修',
    detailLevel: 1,
    confidence: 0.4,
    valence: -0.2,
    arousal: 0.4,
    spread: 'colleagues',
    sourceMode: 'inferred',
    kind: 'episodic',
  },
  garland: {
    what: '这里刚刚举办过一场庆典或嘉奖',
    detailLevel: 1,
    confidence: 0.5,
    valence: 0.7,
    arousal: 0.6,
    spread: 'positive',
    sourceMode: 'inferred',
    kind: 'episodic',
  },
  worn_path: {
    what: '最近有人频繁往返于这条路线',
    detailLevel: 1,
    // 0.60，不是 0.3。§1.2 那一行的初始字段特征写的是 `confidence: 0.60`，
    // 原先照抄成了焦痕那一档。差得不多，但它是这条路上**最高**的一档：
    // 一条被走出来的路是反复见过的东西，比一道说不清来由的焦痕可信得多。
    // 顺带把 salience 从 0.18 抬到 0.36——原先它是全表最低，比
    // `T_write`（0.3）还低一截，而 `lookAtTraces` 又不查 `T_write`，
    // 于是「显著性最低的一条」照样写进了记忆。
    confidence: 0.6,
    valence: 0,
    arousal: 0.2,
    spread: 'background',
    sourceMode: 'inferred',
    // §1.2 第三行明写 `kind: habit`，另外两行没写这一列——它们落情景片段。
    // 效果那一栏说它「沉积为对地点繁忙程度的长期印象」：一条路被走出来的
    // 事实不是某一天发生的事，是一次又一次。用 `episodic` 记它，等于把
    // 「这里一直有人来」当成「那天我看见了一道痕」。
    kind: 'habit',
  },
  inscription: {
    what: '碑文上记着一件事',
    detailLevel: 2,
    confidence: 0.9,
    // 碑文继承原事件的效价，由调用方在生成记忆时覆盖。
    valence: 0,
    arousal: 0.4,
    spread: 'background',
    sourceMode: 'read',
    kind: 'episodic',
  },
};

/**
 * 这个地点能留下几层痕迹，超了怎么办。
 *
 * 补充设计 §3.1：每个地点最多 5 层装饰，超限时合并同类痕迹，或覆盖
 * `visibility_decay` 最低的最旧图层。这里做的是后者——合并同类在落痕时按
 * `mergeKey` 已经做过一次，到这里还超，说明是五种不同的痕迹。
 *
 * 返回要**保留**的那些（已按 id 顺序），调用方据此决定丢谁。
 */
export function fitTraceLayers(traces: readonly Trace[], limit: number): Trace[] {
  if (traces.length <= limit) return [...traces];
  const ranked = [...traces].sort((a, b) => {
    const scoreA = a.intensity * a.visibility;
    const scoreB = b.intensity * b.visibility;
    if (scoreA !== scoreB) return scoreB - scoreA;
    // 同分留新的：旧的先让位。
    return b.createdDay - a.createdDay;
  });
  return ranked.slice(0, limit);
}
