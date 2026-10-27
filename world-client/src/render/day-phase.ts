/** 一天四刻：只决定怎么打光，不决定世界怎么运转。
 *
 * 这一层是纯函数，不碰 Phaser，也不读世界状态。`Simulation` 永远不调用它——
 * 时辰只喂渲染层，否则固定步长与确定性回放就不再成立（ADR_WORLD_ALIVE §2）。
 *
 * 四刻不是「四档压暗浓度」。实测只改浓度时，晨与昏只差 3.43 luma、1.3% 像素，
 * 屏幕上分不出来。所以每刻同时改三样：压暗的色与浓、亮光的强度、内容态
 * （亮窗数量、屋脊受光、贴地雾带、萤火）。依据见 proto/day-phase.html 与 ADR 附录 A。
 */

import { WORLD } from '../world/palette-data.ts';
import type { Weather } from '../world/types.ts';

export type PhaseId = 'dawn' | 'noon' | 'dusk' | 'night';

/** 一天的顺序。用于判断「下一拍该往哪一刻走」。 */
export const PHASE_ORDER: readonly PhaseId[] = ['dawn', 'noon', 'dusk', 'night'];

export interface PhaseRecipe {
  readonly label: string;
  /** 压暗层的颜色：每刻不同，冷暖是四刻可辨的主要来源。 */
  readonly dimColor: number;
  /** 压暗浓度 0..1。 */
  readonly dim: number;
  /** 窗、门、灯、祭坛的暖光强度倍数。 */
  readonly glow: number;
  /** 亮着的窗数（0 或 2）。白天不亮灯，黄昏与夜里亮。 */
  readonly litWindows: number;
  /** 屋脊与檐口的受光强度。黄昏独有，用来把黄昏和正午分开。 */
  readonly ridge: number;
  /** 贴地雾带高度（像素）与浓度。晨雾独有。 */
  readonly mistBand: number;
  readonly mist: number;
  /** 萤火只在夜里出现，且下雨时隐藏。 */
  readonly fireflies: boolean;
}

/**
 * 四刻配方。颜色全部取自现有 24 色，不新增第 25 色。
 *
 * 为什么黄昏用 `ink` 而不是 `ember`：暖色叠在草地上会**提亮**画面，
 * 用 ember 压暗会让黄昏比正午还亮，那是错的。`ink` 是 24 色里唯一暗且偏暖的一档。
 */
export const PHASES: Readonly<Record<PhaseId, PhaseRecipe>> = {
  dawn: {
    label: '晨雾',
    dimColor: WORLD.cloakDark,
    // 晨光比正午暗一档，但要留住「天亮着」的读感，所以不超过 0.2。
    dim: 0.2,
    glow: 0.25,
    litWindows: 0,
    ridge: 0,
    mistBand: 96,
    mist: 0.5,
    fireflies: false,
  },
  noon: {
    label: '正午',
    dimColor: WORLD.deepShade,
    dim: 0,
    glow: 0,
    litWindows: 0,
    ridge: 0,
    mistBand: 0,
    mist: 0,
    fireflies: false,
  },
  dusk: {
    label: '黄昏',
    dimColor: WORLD.ink,
    // 0.08 太轻：视野里没有建筑时，黄昏与正午几乎一样（实测 0.6%）。
    // 提到 0.16 仍明显轻于夜（0.46），但足够让两刻分开。
    dim: 0.16,
    glow: 1.2,
    litWindows: 2,
    ridge: 0.55,
    mistBand: 0,
    mist: 0,
    fireflies: false,
  },
  night: {
    label: '夜',
    dimColor: WORLD.deepShade,
    dim: 0.46,
    glow: 1,
    litWindows: 2,
    ridge: 0,
    mistBand: 0,
    mist: 0,
    fireflies: true,
  },
};

/** 每刻的起止小时（本地时间，左闭右开）。凌晨 5 点前仍算昨夜。 */
const BOUNDARIES: readonly { readonly phase: PhaseId; readonly fromHour: number }[] = [
  { phase: 'night', fromHour: 0 },
  { phase: 'dawn', fromHour: 5 },
  { phase: 'noon', fromHour: 9 },
  { phase: 'dusk', fromHour: 17 },
  { phase: 'night', fromHour: 20 },
];

/**
 * 本地时刻 → 相位。纯函数：同样的 epoch 毫秒永远得到同一刻。
 *
 * 用本地时间是因为这个世界的规则是「跟着你的作息走」，不是 UTC。
 */
export function phaseAt(epochMs: number): PhaseId {
  if (!Number.isFinite(epochMs)) return 'noon';
  const hour = new Date(epochMs).getHours();
  let current: PhaseId = 'night';
  for (const boundary of BOUNDARIES) {
    if (hour >= boundary.fromHour) current = boundary.phase;
  }
  return current;
}

/** 解析 URL 里的时相参数。认不出就返回 null，让调用方退回真实时间。 */
export function parsePhaseParam(raw: string | null): PhaseId | null {
  if (raw === null) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'dawn' || value === 'morning') return 'dawn';
  if (value === 'noon' || value === 'day') return 'noon';
  if (value === 'dusk' || value === 'evening') return 'dusk';
  if (value === 'night') return 'night';
  return null;
}

/**
 * 这一刻该不该画萤火虫：开着萤火虫的那几刻、且天上没有云。
 *
 * **放在这个文件而不是 `phase-view.ts`，是为了让它能被测试跑到红。** 条件原来写在
 * `drawFireflies` 里，而那个函数长在一个 import Phaser 的模块里——node 下一 import
 * 就 `window is not defined`（实测：往 `day-phase.test.ts` 里加一句
 * `import ... from '../src/render/phase-view.ts'`，整个文件直接崩，一条用例都跑不到）。
 * 本文件不碰 Phaser，测试已经在跑了，所以门放这儿。
 *
 * ADR_WORLD_ALIVE §6 的「一处已经补上的缺口」记的就是这件事：「暴雨天不该有萤火」
 * 原来**没有用例**。（这句原来写的是「§6 缺口 2」——2026-10-27 把萤火那条移出 §6 的
 * 编号列表、改成不带号的一段，那个节号当场指向不存在的东西，而没有任何机关会红：
 * 引用审计只认「文件.ts:NNN」，节号它根本不查。所以这里指名那一段，不叫它的号。）
 * `src/world/weather.ts` 的注释自己也写着「想让它真的会红，得先给 `phase-view` 的
 * 萤火虫条件补一条用例」——现在补上了，那条注释里「没有测试守着」的说法要跟着改。
 *
 * 判据是两条，各管一半：
 *   - `view.fireflies`：配方说这一刻有没有萤火虫（今天只有夜里有）。**运行时调用方
 *     传进来的是插值后的 `Blend`，不是 `PhaseRecipe`**——黄昏往夜里过渡时它也跟着
 *     渐变，所以黄昏前半没有、后半才有，不是一到黄昏就整群出现。参数因此收一个
 *     只要 `{fireflies}` 的形状：收 `PhaseRecipe` 调用方过不了类型，收 `Blend`
 *     测试又拿不到一份现成的配方。
 *   - `weather === 'clear'`：暴雨天也没有。写 `=== 'clear'` 而不是列举两种雨——
 *     再添一档天气时这里不必再改（`src/world/weather.ts` 记着这条承诺的来路）。
 *     萤火虫是「晴天夜里」的装饰，**不是天气系统的一个例外**——所以这道门长在
 *     渲染层，不长在天气状态机里。
 *
 * 只 import 了 `Weather` 这个**类型**：不读世界状态，只是拿一个枚举词来比。
 * 本文件「不碰 Phaser、不读世界状态」的约定因此仍然成立。
 */
export function firefliesVisible(view: { readonly fireflies: boolean }, weather: Weather): boolean {
  return view.fireflies && weather === 'clear';
}
