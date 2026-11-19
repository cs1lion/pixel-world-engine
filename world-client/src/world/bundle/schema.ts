/**
 * WorldBundle v1 —— 通用、题材无关的世界契约。
 *
 * 这份 Schema 描述的是「一个世界开局前长什么样」，与具体设定集解耦：
 * 灯潮界、莞尔镇或任何一本新设定集，都只是它的一个合法实例。
 * 资料编译器（`server/compiler/`）把小说设定 / 历史剧本 / 项目文档
 * 编译成这份 JSON，世界内核再按它开工。
 *
 * 设计约束（与 `src/world` 其余文件同一条 purity 契约）：
 * - 纯值对象 + 常量，不读 `Date.now()`、不摇 `Math.random()`；
 * - 不 import 渲染层（`render/`）与界面层（`ui/`），也不 import `settings/`
 *   ——世界内核在下，设定集在上，方向不能反。
 *
 * 字段口径：
 * - `meta`：身份与确定性种子。`seed` 是世界自己时钟的起点，同种子必回放同世界。
 * - `climate`：气候闭集 + 天气权重。权重非负、有限、至少一个大于 0；
 *   不要求和为 1——权重本就该支持「没写出来的天气就是不会下」。
 * - `grid`：世界尺寸。分区矩形不得越出它。
 * - `regions`：语义分区（边界 + 标签）。重叠允许，后声明者盖先声明者，
 *   与设定集地域的绘制顺序同一条规矩。
 * - `prefabs`：复用既有 `PrefabBlueprint` 的几何口径：
 *   `footprint` / `clearMargin` / `door` / `workSpots`。门必须在占地外
 *   （人得进得去），工位必须在占地内（站着干活）。
 * - `cast`：动态 N 位居民。彻底解除 7 人固定编制——人数是资料里读出来的，
 *   契约只管「每一位合法」，不管「一共几位」。
 * - `phases`：可选剧本阶段事件（倒计时 / 气候切换 / 投票 / 危机触发条件）。
 */

import type { GridPoint, Weather } from '../types.ts';

/** 契约版本号。模型输出与校验器都对这一位负责；改口径就升它。 */
export const WORLD_BUNDLE_SCHEMA_VERSION = 1;

/** 气候闭集。题材无关的三档：温带 / 热带 / 极地。 */
export const CLIMATE_IDS = ['temperate', 'tropical', 'arctic'] as const;
export type ClimateId = (typeof CLIMATE_IDS)[number];

/** 天气闭集，直接复用世界内核的 `Weather`，不另造词表。 */
export const WEATHER_IDS: readonly Weather[] = ['clear', 'rain', 'storm', 'fog'];

/** 剧本阶段事件的四种触发形态。 */
export const PHASE_KINDS = ['countdown', 'climate', 'vote', 'crisis'] as const;
export type PhaseKind = (typeof PHASE_KINDS)[number];

/** 声线参数的安全区间（见 `WorldBundleVoiceProfile`）。 */
export const VOICE_PITCH_MIN = 0;
export const VOICE_PITCH_MAX = 1;
export const VOICE_TEMPO_MIN = 0.5;
export const VOICE_TEMPO_MAX = 2;
export const VOICE_WARMTH_MIN = 0;
export const VOICE_WARMTH_MAX = 1;

/** 居民关系参数的安全区间。trust / warmth / familiarity 取 0..1，debt 取 -1..1。 */
export const RELATION_MIN = 0;
export const RELATION_MAX = 1;
export const RELATION_DEBT_MIN = -1;
export const RELATION_DEBT_MAX = 1;

export interface WorldBundleMeta {
  readonly id: string;
  readonly title: string;
  readonly loreSummary: string;
  /** 世界时钟种子：非负整数，落到 32 位有符号整数上限内。 */
  readonly seed: number;
}

export interface WorldBundleClimate {
  readonly kind: ClimateId;
  /** 每种天气的权重；未列出的天气恒为 0。 */
  readonly weatherWeights: Readonly<Record<Weather, number>>;
}

export interface WorldBundleGrid {
  readonly width: number;
  readonly height: number;
}

export interface WorldBundleRegion {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** 语义标签（如「渡口」「呼吸段」）；只展示，不参与判定。 */
  readonly tags: readonly string[];
}

export interface WorldBundlePrefab {
  readonly id: string;
  readonly footprint: { readonly w: number; readonly h: number };
  /** 四周必须留出的空地格数，防贴脸。 */
  readonly clearMargin: number;
  /** 门口相对原点的偏移；必须在占地外。 */
  readonly door: GridPoint;
  /** 干活时站的位置（相对原点偏移）；必须在占地内，且至少一个。 */
  readonly workSpots: readonly GridPoint[];
}

/**
 * 声线画像：只描述「听起来像谁」，不触发任何发声动作。
 * 三个参数都落在安全区间内，渲染层拿去插值，世界层不解释它。
 */
export interface WorldBundleVoiceProfile {
  /** 音高，0..1。 */
  readonly pitch: number;
  /** 语速倍率，0.5..2。 */
  readonly tempo: number;
  /** 音色暖度，0..1。 */
  readonly warmth: number;
}

export interface WorldBundleRelation {
  /** 指向同一份 cast 里的另一位居民 id；不允许悬空。 */
  readonly to: string;
  readonly trust: number;
  readonly warmth: number;
  /** 欠债可正可负：-1..1。 */
  readonly debt: number;
  readonly familiarity: number;
}

export interface WorldBundleCastMember {
  readonly id: string;
  readonly name: string;
  /** 一句话人设，编译器和展示层共用。 */
  readonly persona: string;
  readonly initialRelations: readonly WorldBundleRelation[];
  readonly voiceProfile: WorldBundleVoiceProfile;
}

export interface WorldBundlePhase {
  readonly id: string;
  readonly label: string;
  readonly kind: PhaseKind;
  /** countdown：多少世界拍后触发；正整数。 */
  readonly afterTicks?: number;
  /** climate：切到哪一档气候；必须落在 CLIMATE_IDS 里。 */
  readonly toClimate?: ClimateId;
  /** vote / crisis：触发条件的人类可读描述；非空串。 */
  readonly condition?: string;
}

export interface WorldBundle {
  readonly schemaVersion: number;
  readonly meta: WorldBundleMeta;
  readonly climate: WorldBundleClimate;
  readonly grid: WorldBundleGrid;
  readonly regions: readonly WorldBundleRegion[];
  readonly prefabs: readonly WorldBundlePrefab[];
  readonly cast: readonly WorldBundleCastMember[];
  /** 省略或空数组都表示「没有剧本阶段，世界自己过日子」。 */
  readonly phases?: readonly WorldBundlePhase[];
}
