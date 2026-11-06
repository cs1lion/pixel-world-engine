/**
 * 引擎无关的村民动画状态机（第一版，**尚未接管渲染**）。
 *
 * 为什么放在 `src/animation/` 而不是 `src/world/`：
 *   - `src/world/` 是确定性仿真内核，它回答「世界怎么了」；动画回答「这一帧画成
 *     什么样」。把动画塞进 world 会让「无渲染也能跑世界」这条边界变糊，也会让
 *     存档与快照看起来应该有动画字段。
 *   - `src/animation/` 与 `src/render/` 平级：上不依赖 Phaser，下不写世界状态，
 *     任何引擎（或截图夹具）都能直接调用。
 *
 * 纪律（与世界内核同一条）：
 *   - 不 import phaser、不碰 DOM；
 *   - 不读 `Date.now` / `performance.now` / `Math.random`；
 *   - 时间一律由调用方传入，同一个输入必得同一个输出。
 *
 * 第一版只做「状态迁移 + 混合权重」。渲染继续走
 * `world-client/src/render/villager-frames.ts` 的旧路径；两者的稳态输出由
 * `world-client/test/anim-fsm.test.ts` 逐字段对齐，接入前先证明它没有走样。
 */

import type { VillagerMode } from '../world/types.ts';

/** 与 `villager-frames.ts` 同一个采样率。这里不 import 渲染层，测试负责对齐。 */
export const ANIM_FPS = 12;
export const FRAME_MS = 1000 / ANIM_FPS;

export type AnimStateId = 'idle' | 'walk' | 'salute' | 'work' | 'deliver';

export const ANIM_STATE_IDS: readonly AnimStateId[] = [
  'idle',
  'walk',
  'salute',
  'work',
  'deliver',
];

/** 单个状态的一帧姿态：全是整数像素。 */
export interface AnimFramePose {
  readonly offsetY: number;
  readonly footLeft: number;
  readonly footRight: number;
}

interface BaseFrame {
  readonly offsetY: number;
  readonly footLeft: number;
  readonly footRight: number;
}

/** 待机 2 帧：呼吸一上一下。与 `villager-frames.ts` 的 `IDLE_POSES` 同值。 */
const IDLE_FRAMES: readonly BaseFrame[] = [
  { offsetY: 0, footLeft: 0, footRight: 0 },
  { offsetY: 1, footLeft: 0, footRight: 0 },
];

/** 走路 4 帧：左右脚交替前伸 + 1px 起伏。与 `WALK_POSES` 同值。 */
const WALK_FRAMES: readonly BaseFrame[] = [
  { offsetY: 0, footLeft: 1, footRight: 0 },
  { offsetY: 1, footLeft: 0, footRight: 1 },
  { offsetY: 0, footLeft: -1, footRight: 0 },
  { offsetY: 1, footLeft: 0, footRight: -1 },
];

export interface AnimStateSpec {
  readonly id: AnimStateId;
  readonly frameCount: number;
  readonly loopMs: number;
  /** 动作本身带的整体像素偏移（叠在帧偏移上）。 */
  readonly liftY: number;
  readonly description: string;
}

const STATE_LIFT: Readonly<Record<AnimStateId, number>> = {
  idle: 0,
  walk: 0,
  // 行礼下蹲 2px；交付前倾 1px。与 `villager-frames.ts` 的 `modeLift` 同值。
  salute: -2,
  work: 0,
  deliver: -1,
};

export const ANIM_STATES: readonly AnimStateSpec[] = [
  {
    id: 'idle',
    frameCount: IDLE_FRAMES.length,
    loopMs: Math.round(IDLE_FRAMES.length * FRAME_MS),
    liftY: STATE_LIFT.idle,
    description: '站着呼吸：2 帧，整体上下 1px。',
  },
  {
    id: 'walk',
    frameCount: WALK_FRAMES.length,
    loopMs: Math.round(WALK_FRAMES.length * FRAME_MS),
    liftY: STATE_LIFT.walk,
    description: '走路步态：4 帧，左右脚交替前伸，整体 1px 起伏。',
  },
  {
    id: 'salute',
    frameCount: IDLE_FRAMES.length,
    loopMs: Math.round(IDLE_FRAMES.length * FRAME_MS),
    liftY: STATE_LIFT.salute,
    description: '行礼：待机两帧 + 下沉 2px；抬手像素由排版层按 mode 叠加。',
  },
  {
    id: 'work',
    frameCount: IDLE_FRAMES.length,
    loopMs: Math.round(IDLE_FRAMES.length * FRAME_MS),
    liftY: STATE_LIFT.work,
    description: '干活：待机两帧 + 手持工具每两帧上下 1px。',
  },
  {
    id: 'deliver',
    frameCount: IDLE_FRAMES.length,
    loopMs: Math.round(IDLE_FRAMES.length * FRAME_MS),
    liftY: STATE_LIFT.deliver,
    description: '交付：待机两帧 + 下沉 1px；双手纸片每两帧上下 1px。',
  },
];

/**
 * 转移时长表：**任意两个不同状态之间都有显式时长**，共 20 条。
 *
 * ⚠️ 全部是**设计初始值，未经验证**。现有系统本来就没有过渡（切表是突变），
 * 所以这些数字不是从既有行为推导出来的，也不是已定契约；第二版接入时必须用
 * 截图对照逐条校准，校准前只当作占位。
 *
 * 世界侧常量 `SALUTE_MS=700`、`DELIVER_MS=1400`、`estimateMs` 决定的是
 * 「在某个状态停留多久」，不是「交叉淡入多久」。本表 **没有一条** 由它们推出；
 * 下表 `source` 字段一律是 `design`，便于以后区分「推导值」与「设计值」。
 *
 * 取值原则（设计层面，不是观测结论）：动作差越大、越要「收住」，淡入淡出越长；
 * 同为循环的代换（走 ↔ 站）最短。所有值落在 90–220ms 这一带——短到不会被误读
 * 成新动作，长到 12fps 下至少跨过一整帧。
 */
export const ANIM_TRANSITION_MS: Readonly<
  Record<AnimStateId, Readonly<Record<AnimStateId, number>>>
> = {
  idle: { idle: 0, walk: 120, salute: 90, work: 150, deliver: 180 },
  walk: { idle: 140, walk: 0, salute: 160, work: 150, deliver: 200 },
  salute: { idle: 120, walk: 180, salute: 0, work: 160, deliver: 200 },
  work: { idle: 140, walk: 180, salute: 160, work: 0, deliver: 220 },
  deliver: { idle: 160, walk: 200, salute: 160, work: 200, deliver: 0 },
};

/** 转移时长的来源。`design` = 凭设计填的占位值；`world-constant` = 由世界常量推出。 */
export type AnimDurationSource = 'design' | 'world-constant';

/**
 * 世界常量只决定状态停留时长，不决定交叉淡入时长，所以这里没有推导值。
 * 第二版若把某条时长改成由 `SALUTE_MS` / `DELIVER_MS` / `estimateMs` 推出，
 * 必须把对应行改成 `world-constant` 并在文档里写明算式。
 */
export const ANIM_DURATION_SOURCE: AnimDurationSource = 'design';

/** 进入某个状态意味着世界里发生了什么。条件表只说明「什么时候是它」。 */
const TARGET_CONDITION: Readonly<Record<AnimStateId, string>> = {
  idle: '意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。',
  walk: '意图为 walk：walking=true（脚下还有没走完的路）。',
  salute: '意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。',
  work: '意图为 work：mode=working（原地短活，或已到铺子开工）。',
  deliver: '意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。',
};

export interface AnimTransitionSpec {
  readonly from: AnimStateId;
  readonly to: AnimStateId;
  readonly durationMs: number;
  readonly condition: string;
  /** 时长来源；第一版全部是 `design`（未验证初始值）。 */
  readonly source: AnimDurationSource;
}

function buildTransitions(): readonly AnimTransitionSpec[] {
  const out: AnimTransitionSpec[] = [];
  for (const from of ANIM_STATE_IDS) {
    for (const to of ANIM_STATE_IDS) {
      if (from === to) continue;
      out.push({
        from,
        to,
        durationMs: ANIM_TRANSITION_MS[from][to],
        condition: `${TARGET_CONDITION[to]}（从 ${from} 打断）`,
        source: ANIM_DURATION_SOURCE,
      });
    }
  }
  return out;
}

/** 可读的状态转移表；`docs/animation/villager-anim-fsm.md` 由它生成。 */
export const ANIM_TRANSITIONS: readonly AnimTransitionSpec[] = buildTransitions();

export function transitionDurationMs(from: AnimStateId, to: AnimStateId): number {
  return ANIM_TRANSITION_MS[from][to];
}

/**
 * 世界快照 → 意图。
 *
 * `toWork` / `toAltar` / `sheltering` / `bearingDecree` 不增加动作，只按
 * `walking` 分流；这与现有渲染的判据（「表会漏，路不会」）一致。
 */
export function animIntentOf(mode: VillagerMode, walking: boolean): AnimStateId {
  switch (mode) {
    case 'saluting':
      return 'salute';
    case 'working':
      return 'work';
    case 'delivering':
      return 'deliver';
    default:
      return walking ? 'walk' : 'idle';
  }
}

function frameCountOf(state: AnimStateId): number {
  return state === 'walk' ? WALK_FRAMES.length : IDLE_FRAMES.length;
}

function liftOf(state: AnimStateId): number {
  return STATE_LIFT[state];
}

/** simulation 时间 → 12fps 步号。负数也能稳定回绕。 */
export function animStep(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  return Math.floor(nowMs / FRAME_MS);
}

/** simulation 时间 + 状态 → 帧号。同一时刻必得同帧，与渲染时机无关。 */
export function animFrameAt(state: AnimStateId, nowMs: number): number {
  const count = frameCountOf(state);
  const step = animStep(nowMs);
  return ((step % count) + count) % count;
}

/** 某状态某帧的整数像素姿态（含动作自带的整体偏移）。 */
export function animFramePose(state: AnimStateId, frame: number): AnimFramePose {
  const frames = state === 'walk' ? WALK_FRAMES : IDLE_FRAMES;
  const raw = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  const index = ((raw % frames.length) + frames.length) % frames.length;
  const base = frames[index] as BaseFrame;
  return {
    offsetY: base.offsetY + liftOf(state),
    footLeft: base.footLeft,
    footRight: base.footRight,
  };
}

/** 一条正在淡出的残影。权重从 `startWeight` 线性降到 0。 */
export interface AnimFade {
  readonly state: AnimStateId;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly startWeight: number;
}

/**
 * 残影的目标上限。正常的一次打断只有 1 条残影（画面 = 旧状态 + 新状态，两两混合）。
 */
export const MAX_RESIDUAL_LAYERS = 4;

/**
 * 允许丢弃残影的**权重下限**。只有权重低于它才允许丢；高于它时宁可多保留一层，
 * 也不丢——丢高权重会让画面直接跳一下。
 *
 * 0.12 的取值理由：12fps 下，权重 0.12 的残影在 1–2px 姿态差上贡献不到半像素；
 * 它低于「两两混合」里最小可辨认分量（0.25），也不至于让残影永远清不掉。
 */
export const MIN_DROPPABLE_RESIDUAL_WEIGHT = 0.12;

/**
 * 残影的硬上限（安全阀）。超过它时必然要丢一条；由于权重和不超过 1，
 * 13 条残影里最轻的一条 ≤ 1/13 ≈ 0.077，必定低于 0.12——所以「被迫丢弃」也
 * 永远不会丢到高权重的那条。
 */
export const HARD_RESIDUAL_LAYER_CAP = 12;

/** 调用方持有的状态值。纯数据，可以安全地深拷贝、存档、跨引擎传递。 */
export interface AnimFsmState {
  readonly current: AnimStateId;
  /** 进入当前状态的时刻（诊断/接入对照用，不参与权重）。 */
  readonly enteredAtMs: number;
  readonly fades: readonly AnimFade[];
}

function safeMs(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 某条残影在 `nowMs` 的权重。导出给单测核对「被丢的那条确实低于下限」。 */
export function residualWeightAt(fade: AnimFade, nowMs: number): number {
  if (fade.durationMs <= 0) return 0;
  const progress = clamp01((nowMs - fade.startedAtMs) / fade.durationMs);
  return fade.startWeight * (1 - progress);
}

function liveFades(fades: readonly AnimFade[], nowMs: number): readonly AnimFade[] {
  return fades.filter((fade) => residualWeightAt(fade, nowMs) > 0);
}

function currentWeightOf(fades: readonly AnimFade[], nowMs: number): number {
  let residual = 0;
  for (const fade of fades) residual += residualWeightAt(fade, nowMs);
  return clamp01(1 - residual);
}

/** 初始状态：直接落在某个意图上，没有淡入。 */
export function createAnimFsmState(intent: AnimStateId, nowMs: number): AnimFsmState {
  return { current: intent, enteredAtMs: safeMs(nowMs), fades: [] };
}

/**
 * 推进一步：`intent` 与当前状态不同时开始一次交叉淡出。
 *
 * 纯函数：不修改 `state`，不读时钟。同一意图重复调用**不会**重新开始过渡
 * （这是「同一意图不抖动」的保证）。
 */
export function advanceAnimFsm(
  state: AnimFsmState,
  intent: AnimStateId,
  nowMs: number,
): AnimFsmState {
  const now = safeMs(nowMs);
  const fades = liveFades(state.fades, now);
  if (intent === state.current) {
    return fades.length === state.fades.length ? state : { ...state, fades };
  }

  // 当前状态的权重整体变成一条残影；新状态从 0 开始淡入。
  // 这样任何时刻权重和都是 1，连续打断也不会跳。
  const outgoing: AnimFade = {
    state: state.current,
    startedAtMs: now,
    durationMs: transitionDurationMs(state.current, intent),
    startWeight: currentWeightOf(fades, now),
  };
  let next: AnimFade[] = [...fades, outgoing];
  if (next.length > MAX_RESIDUAL_LAYERS) {
    let dropIndex = 0;
    let dropWeight = Infinity;
    for (let index = 0; index < next.length; index += 1) {
      const weight = residualWeightAt(next[index] as AnimFade, now);
      if (weight < dropWeight) {
        dropWeight = weight;
        dropIndex = index;
      }
    }
    // 政策：只在「最轻的那条已经低到看不出来」时才丢。否则延长保留——
    // 把两个不同状态合并成一层会丢掉状态身份，硬丢高权重又会直接跳；多画
    // 一层残影比跳一下便宜。硬上限保证被迫丢弃时最轻的一条必然低于下限。
    const forcedByCap = next.length > HARD_RESIDUAL_LAYER_CAP;
    if (forcedByCap || dropWeight < MIN_DROPPABLE_RESIDUAL_WEIGHT) {
      next = next.filter((_, index) => index !== dropIndex);
    }
  }
  return { current: intent, enteredAtMs: now, fades: next };
}

export interface AnimLayerSample {
  readonly state: AnimStateId;
  readonly frame: number;
  readonly frameCount: number;
  readonly weight: number;
  readonly pose: AnimFramePose;
}

export interface AnimSample {
  readonly nowMs: number;
  /** 当前层永远在第一位（可能权重为 0，表示新状态刚开始淡入）。 */
  readonly layers: readonly AnimLayerSample[];
  /** 各层 `pose.offsetY` 的加权和，四舍五入到整数像素。 */
  readonly offsetY: number;
  /** 预留：需要整体位移时用它；第一版恒为 0。 */
  readonly anchor: { readonly x: number; readonly y: number };
}

function pixelAt(value: number): number {
  const rounded = Math.round(value);
  // `Math.round(-0.5)` 是 `-0`；像素上等价，但 `Object.is(-0, 0)` 为 false。
  return rounded === 0 ? 0 : rounded;
}

function layerOf(state: AnimStateId, weight: number, nowMs: number): AnimLayerSample {
  const frame = animFrameAt(state, nowMs);
  return {
    state,
    frame,
    frameCount: frameCountOf(state),
    weight,
    pose: animFramePose(state, frame),
  };
}

/**
 * 采样：状态 + 世界时刻 → 当前帧、各层权重、加权位移。
 *
 * 权重语义：当前层 = `1 - Σ 残影`；每条残影 = `startWeight × (1 - 进度)`。
 * 残影按「新→旧」排列，当前层恒在第一。稳态时只有一层（权重 1）。
 */
export function sampleAnimFsm(state: AnimFsmState, nowMs: number): AnimSample {
  const now = safeMs(nowMs);
  const fades = liveFades(state.fades, now);
  const currentWeight = currentWeightOf(fades, now);
  const layers: AnimLayerSample[] = [layerOf(state.current, currentWeight, now)];

  const sorted = [...fades].sort((a, b) => {
    if (b.startedAtMs !== a.startedAtMs) return b.startedAtMs - a.startedAtMs;
    return b.startWeight - a.startWeight;
  });
  for (const fade of sorted) {
    const weight = residualWeightAt(fade, now);
    if (weight <= 0) continue;
    layers.push(layerOf(fade.state, weight, now));
  }

  let offset = 0;
  for (const layer of layers) offset += layer.weight * layer.pose.offsetY;
  return {
    nowMs: now,
    layers,
    offsetY: pixelAt(offset),
    anchor: { x: 0, y: 0 },
  };
}

/**
 * 状态图的可读版本（Markdown）。`docs/animation/villager-anim-fsm.md` 原样保存
 * 这份输出，测试逐字比对，防止文档与代码分叉。
 */
export function animGraphMarkdown(): string {
  const lines: string[] = [];
  lines.push('# 村民动画状态机 · 状态与转移');
  lines.push('');
  lines.push(
    '> 本文件由 `world-client/scripts/export-anim-graph.ts` 从 `villager-anim-fsm.ts` 生成；手改会在单测里变红。',
  );
  lines.push('');
  lines.push('## 边界：只做组合与转移，不产生新动作');
  lines.push('');
  lines.push('- 覆盖的 5 个状态只对应**现有画面**：idle / walk / salute / work / deliver。');
  lines.push(
    '- 「跑」「坐」「挥手」这类动作**没有对应的帧序列与排版数据**，状态机不产生新帧，也不负责把它画出来。',
  );
  lines.push('- 新增一个动作，六样东西要一起补：');
  lines.push('  1. 帧序列（`villager-frames.ts` 的 12fps 采样表）；');
  lines.push('  2. 排版数据（`villager-layout.ts` 里该 mode 的像素叠加）；');
  lines.push('  3. 世界状态（`VillagerMode` 及触发、结束条件）；');
  lines.push('  4. 本模块的状态；');
  lines.push('  5. 转移（下表 20 个方向里的新增行）；');
  lines.push('  6. 时长（初始值，未验证）与单测。');
  lines.push('- 状态机真正解决的是「动作之间的组合与打断」，不解决「多一个动作」。');
  lines.push('');
  lines.push('## 状态');
  lines.push('');
  lines.push('| 状态 | 帧数 | 循环时长 | 动作位移 | 说明 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const state of ANIM_STATES) {
    lines.push(
      `| ${state.id} | ${state.frameCount} | ${state.loopMs}ms | ${state.liftY}px | ${state.description} |`,
    );
  }
  lines.push('');
  lines.push('## 转移');
  lines.push('');
  lines.push('任意两个不同状态之间都有显式时长；下表 20 条覆盖全部打断方向。');
  lines.push('');
  lines.push(
    '⚠️ 所有时长都是**设计初始值，未经验证**。现有系统没有过渡（切表是突变），这些数字不是从既有行为推导出来的，也不是已定契约；第二版接入时以截图对照逐条校准。',
  );
  lines.push(
    '世界常量 `SALUTE_MS=700`、`DELIVER_MS=1400`、`estimateMs` 决定的是「停留多久」，不是「淡入淡出多久」；本表没有一条由它们推出（来源列全部是 design）。',
  );
  lines.push('');
  lines.push('| 从 | 到 | 时长 | 来源 | 条件 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const transition of ANIM_TRANSITIONS) {
    const sourceLabel = transition.source === 'design' ? 'design（未验证）' : 'world-constant';
    lines.push(
      `| ${transition.from} | ${transition.to} | ${transition.durationMs}ms | ${sourceLabel} | ${transition.condition} |`,
    );
  }
  lines.push('');
  lines.push('## 混合权重');
  lines.push('');
  lines.push('- 当前层权重 = `1 - Σ残影权重`；残影权重 = `startWeight × (1 - 进度)`。');
  lines.push('- 稳态只有一层；一次打断是两两混合；连续打断时残影目标上限为 4 条。');
  lines.push(
    `- 超过 4 条时，只有最轻残影的权重低于 ${MIN_DROPPABLE_RESIDUAL_WEIGHT} 才允许丢弃；高于它时改为**延长保留**（最多 ${HARD_RESIDUAL_LAYER_CAP} 条硬上限）。`,
  );
  lines.push(
    '- 延长保留的理由：把两个不同状态合并成一层会丢掉身份，硬丢高权重又会直接跳；多画一层残影比跳一下便宜。',
  );
  lines.push(
    `- 硬上限保证被迫丢弃时最轻的一条 ≤ 1/13 ≈ 0.077 < ${MIN_DROPPABLE_RESIDUAL_WEIGHT}，所以任何被丢的残影都低于下限；权重和恒为 1（浮点误差除外）。`,
  );
  lines.push('- 同一意图重复调用不会重新开始过渡。');
  lines.push('');
  lines.push('## 采样');
  lines.push('');
  lines.push('- 12fps：`frame = floor(now / (1000/12)) % frameCount`。');
  lines.push('- `now` 是世界时刻，由调用方传入；不读真实时钟、不用随机数。');
  lines.push('- 姿态偏移全是整数像素；跨层加权后再四舍五入到整数。');
  lines.push('');
  return lines.join('\n');
}
