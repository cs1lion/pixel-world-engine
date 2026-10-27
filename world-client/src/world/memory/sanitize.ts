/** 隐喻脱敏编译器：上游的隐私动作在进入世界之前，被编译成本土叙事。
 *
 * 补充设计 §1.3，落实协议第 14、15 节。上游 Personal Agent 的一条动作带着
 * `visibility = private_to_player` 来到边界网关，**在这里销毁一切真实文件名、
 * 人名与业务文本**，只留下 `[任务拓扑类型 + 耗时/重试次数 + 最终状态]`，
 * 编译成一条 `visibility = sanitized` 的世界事件。
 *
 * 这是整个内环唯一允许「翻译」的地方，而它翻译的**不是意思，是形状**：
 *
 * - 输入只有五个结构化的量：`kind`（拓扑类型）、`retries`、`elapsedMs`、
 *   `status`、以及一个粗粒度 `difficulty`；
 * - 输出是一条世界事件，`outcome` 里没有任何上游字段；
 * - 中间**没有**任何一处能塞进自由文本。想塞也塞不进去，因为签名里没有字符串。
 *
 * 最后一条是刻意的：如果这个函数收一个 `detail: string` 参数，那么「脱敏」
 * 就成了调用方的自觉，而自觉不是一道闸。这里能做的只有查表。
 *
 * **不在这张表里的拓扑一律拒收**，不猜。一条上游动作想进世界，必须先有
 * 一个对应关系；加一个对应关系是一次显式的、看得见的改动，而不是一个
 * 默认分支。
 */

import type { EventVoice, Visibility } from './types.ts';

/**
 * 上游动作的拓扑类型。**这是白名单**，不是提示。
 *
 * 名字描述的是「这次工作流的形状」，不是业务内容：检索、执行、等待授权、
 * 通过、打回。它们与具体项目无关，因此换一个上游也不会变。
 */
export type UpstreamTopology =
  | 'retrieve'
  | 'execute'
  | 'awaiting_human'
  | 'human_approved'
  | 'human_rejected';

/** 最终状态。只收这三种，没有第四种。 */
export type UpstreamStatus = 'ok' | 'retrying' | 'blocked';

/** 难度档。粗粒度，防止用「耗时」反推业务体量。 */
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * 边界网关收下的东西。
 *
 * 全是数值与枚举。**没有一个字符串字段可以承载业务文本**——这是这条
 * 接口的要点，不是巧合。
 */
export interface UpstreamAction {
  readonly topology: UpstreamTopology;
  readonly status: UpstreamStatus;
  readonly retries: number;
  readonly elapsedMs: number;
  readonly difficulty: Difficulty;
}

/** 编译出来的一条世界事件。`visibility` 恒为 `sanitized`。 */
export interface CompiledEvent {
  readonly kind: string;
  readonly placeId: string;
  readonly outcome: Readonly<Record<string, string | number>>;
  readonly visibility: Visibility;
  /** 给显著度用的重要度提示。由拓扑与重试次数派生，不由上游给。 */
  readonly importanceHint: number;
}

/**
 * 编译。
 *
 * 表在 `COMPILE_TABLE` 里，一行一种拓扑。返回 `null` 表示这条动作不该进世界
 * （比如一次顺利的检索没有戏剧性，编成事件只会给世界添噪音）。
 *
 * 「顺利的检索也要进世界」曾经是一个诱惑：哨塔的物资痕迹看起来很有画面。
 * 但事件是唯一真相，一条被编出来的事件会长期留在日志里，而它对应的
 * 上游动作可能只是一次成功的 `GET`。**世界宁可安静**。
 */
export function compile(action: UpstreamAction): CompiledEvent | null {
  const row = COMPILE_TABLE[action.topology];
  if (row === undefined) return null;
  const retries = Math.max(0, Math.floor(action.retries));
  return row(action, retries);
}

type Row = (action: UpstreamAction, retries: number) => CompiledEvent | null;

const COMPILE_TABLE: Readonly<Record<UpstreamTopology, Row>> = {
  // 检索成功：斥候出征回来。平静、正向、低显著度。
  retrieve: (action) => {
    if (action.status !== 'ok') {
      return {
        kind: 'expedition_done',
        placeId: 'place_watchtower',
        outcome: { harvest: '空手而归', difficulty: action.difficulty },
        visibility: 'sanitized',
        importanceHint: 0.3,
      };
    }
    return {
      kind: 'expedition_done',
      placeId: 'place_watchtower',
      outcome: { harvest: '发光矿石', difficulty: action.difficulty },
      visibility: 'sanitized',
      importanceHint: 0.35,
    };
  },

  // 执行连续报错重试：工坊炸炉。重试越多越严重。
  execute: (action, retries) => {
    if (action.status === 'ok' && retries === 0) return null;
    return {
      kind: 'workshop_accident',
      placeId: 'place_foundry',
      outcome: { obstacle: '炉温失控', retries },
      visibility: 'sanitized',
      importanceHint: Math.min(0.9, 0.5 + retries * 0.1),
    };
  },

  // 挂起等人类授权：祭坛祈祷。等得越久越紧迫。
  awaiting_human: (action) => ({
    kind: 'oracle_prayer',
    placeId: 'place_altar',
    outcome: {
      wait_ticks: Math.floor(action.elapsedMs / 1000),
      urgency: action.status === 'blocked' ? 'high' : 'normal',
    },
    visibility: 'sanitized',
    importanceHint: 0.4,
  }),

  // 人类准奏：庆典。这是少数值得给高显著度的上游动作——
  // 它对应一次真实的、人做过的决定，而世界里该有一次看得见的回响。
  human_approved: () => ({
    kind: 'celebration',
    placeId: 'place_altar',
    outcome: { blessing: 'golden_seal' },
    visibility: 'sanitized',
    importanceHint: 0.85,
  }),

  // 人类打回：训诫。高唤醒、负效价，当事小人记下一条行为约束。
  human_rejected: () => ({
    kind: 'discipline',
    placeId: 'place_altar',
    outcome: { lesson_id: 'rule_hash' },
    visibility: 'sanitized',
    importanceHint: 0.75,
  }),
};

/**
 * 世界事件 → 断言的内容。
 *
 * 编译之后，事件要变成能传播的说法。这一步在世界侧，不在网关：
 * 网关只负责「这条事件长什么样」，怎么说给村民听是传播层的事。
 * 分开的理由是回放——同一条事件在不同设定集里会有不同的说法，
 * 而网关的产物必须与设定集无关。
 *
 * **这张表是世界侧唯一给上游事件定性的地方。** `ingestUpstream` 把产物
 * 挂进事实的 `voice`，记忆条目与断言都从那儿读——不读的话，上游事件
 * 会落进 `defaultValence` / `defaultArousal` 那两张世界侧的兜底表。那儿
 * 缺的是**唤醒度**那一列：`defaultArousal` 没有 `discipline`（该 0.7）与
 * `oracle_prayer`（该 0.4）两行，兜底给 0.3，于是「高唤醒、负效价」这条
 * 写在 `COMPILE_TABLE` 上的意图，唤醒度那一半在跑着的世界里一次都没实现过。
 *
 * 效价那一半如今是实现的：`defaultValence` 有 `discipline` → -0.6 这一行
 * （原先这条注释说「那张表根本没有这两行」，是把两张兜底表说成了一张）。
 * 逐 kind 的对照见 `world.ts` 的 `EventVoice` 上那张表。
 */
export function claimContentFor(event: CompiledEvent): EventVoice {
  const table: Readonly<Record<string, { what: string; valence: number; arousal: number }>> = {
    expedition_done: { what: '斥候从哨塔那边回来了', valence: 0.3, arousal: 0.3 },
    workshop_accident: { what: '工坊里出了事故，炉子炸了', valence: -0.7, arousal: 0.8 },
    oracle_prayer: { what: '有人在祭坛虔诚祈祷神谕', valence: 0, arousal: 0.4 },
    celebration: { what: '祭坛那边办了一场庆典，神谕准了', valence: 0.8, arousal: 0.6 },
    discipline: { what: '有人在祭坛被训诫了', valence: -0.6, arousal: 0.7 },
  };
  const row = table[event.kind] ?? { what: '发生了一件事', valence: 0, arousal: 0.2 };
  return { ...row, detailLevel: 3 };
}

/**
 * 上游事件里哪些字段**不许**出现在世界里。
 *
 * 这一份清单不参与运行，它是一份可测的声明：测试拿它扫 `claimContentFor`
 * 与 `COMPILE_TABLE` 的产物，确认没有一处泄露。真实业务字段名每换一个上游
 * 就换一批，所以这里只列通用的危险词，具体的靠「签名里没有字符串」这条结构保证。
 */
export const FORBIDDEN_TOKENS: readonly string[] = [
  'filename',
  'file_path',
  'repo',
  'branch',
  'commit',
  'customer',
  'user_id',
  'api_key',
  'token',
  'password',
];
