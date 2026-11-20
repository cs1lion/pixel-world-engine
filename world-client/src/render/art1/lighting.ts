/** `?art=1` 的光照层：Phaser 灯光 + 无头/Canvas 安全降级。
 *
 * 为什么是「加一层光照」而不是「改一遍地形」：黄昏蓝调、雨夜压暗、窗口暖光
 * 呼吸这类东西本质是**每帧改环境量**，画进烘焙贴图就得每帧重烘（预算不允许），
 * 用灯光则是渲染器的一次 uniform 更新，画面里一个绘制指令都不多。
 *
 * **无头/Canvas 安全**：`setLighting` 与 LightsManager 的着色在 Phaser 4 是
 * WebGL-only（见 dist 里的 `@webglOnly` 标注与 `runLightPipeline` 的
 * `lightManager.active` 早退）。这一层因此先问 `lightsSupported`：不支持就
 * 整个降级成空转——既不报错，也不往显示列表塞东西，`?art=1` 在无头环境
 * 仍然是「有图集、没灯光」的可跑画面。
 *
 * **不碰世界**：光源、时相、天气全是调用方递进来的读数；本模块不 import
 * `src/world/`，也不写 WorldState。视觉时间用调用方给的 `nowMs`（Phaser 的
 * time 参数），这样钉钟与回放时暖光呼吸也停在同一刻。
 *
 * 颜色不受 24 色板预算约束（`scripts/audit-palette.mjs` 的 `art1/` 放行，
 * 见 `docs/adr/ADR_PRESENTATION_GATE_LAYERS.md`）：光是加色，用色板里的
 * 实色反而会被压成灰。
 */

import Phaser from 'phaser';

import { LightPool, type LightRequest } from './lighting-pool.ts';

/** 一个暖光点：路灯、灯塔、驻留建筑的窗口。世界像素坐标。 */
export interface WarmLightSource {
  readonly x: number;
  readonly y: number;
  /** 半径（世界像素）。 */
  readonly radius: number;
  /** 基准强度 0..1：呼吸波在它上下浮动。 */
  readonly intensity: number;
  /** 呼吸周期（毫秒）；不同灯用不同周期，才不会整条街一起闪。 */
  readonly periodMs: number;
  /** 呼吸幅度 0..1（叠加在 intensity 上）。 */
  readonly breath?: number;
  /**
   * 挤槽位时的优先级（越大越优先）。缺省按强度分档：暗的（窗口）低于亮的（街灯）。
   *
   * 为什么要显式给：街灯有 28 盏而槽位只有 10 个，窗口若与街灯同档按距离竞争，
   * 夜里会永远被挤掉——而窗光恰恰是「这屋里有人」的读数。调用方按 kind 给。
   */
  readonly priority?: number;
  /** 色相：暖光默认琥珀，灯塔可以偏白。0xRRGGBB。 */
  readonly color?: number;
}

/** 环境光意图：由时相 + 天气翻成「底色是什么、压暗到什么程度」。 */
export interface AmbientTint {
  readonly rgb: number;
  readonly strength: number;
}

/** 一帧的输入读数（全部由场景层提供，本层不做判据）。 */
export interface LightingFrame {
  readonly nowMs: number;
  readonly phase: 'dawn' | 'noon' | 'dusk' | 'night';
  /** 0..1：雨/暴风雨的强度，来自 `sim.weatherIntensity()`。 */
  readonly weatherIntensity: number;
  readonly raining: boolean;
  /** 驻留建筑里当下亮着窗的比例 0..1（夜里才起作用）。 */
  readonly litWindows: number;
  /** 神谕光柱是否正在持续中（真则祭坛上多一束金光）。 */
  readonly oracleActive: boolean;
  readonly oracleX: number;
  readonly oracleY: number;
  /** 时间回溯：脚下金光跟着谁（传镜头中心即可）。 */
  readonly rewindActive: boolean;
  readonly focusX: number;
  readonly focusY: number;
}

/** 光照视图：场景持有；不支持时所有方法是空转。 */
export interface ArtLightingView {
  /** 降级与否：false 表示这一页根本没启用灯光。 */
  readonly enabled: () => boolean;
  readonly update: (frame: LightingFrame) => void;
  readonly destroy: () => void;
}

/** 灯光是否可用：WebGL 渲染器 + LightsManager 插件在位 + `?art=1`。 */
export function lightsSupported(scene: Phaser.Scene): boolean {
  const renderer = scene.game?.renderer as { type?: number } | undefined;
  // Phaser.Renderer.WEBGL = 2（4.x 没在顶层挂常量，值级写死并在此说明）。
  if (renderer?.type !== 2) return false;
  return (scene.lights as unknown) !== undefined;
}

/** 默认暖光色（琥珀）与冷光色（黄昏蓝）。见文件头：光的颜色不进色板口径。 */
export const WARM_LIGHT_RGB = 0xffc27a;
export const COOL_DUSK_RGB = 0x3a5c8f;
export const REWIND_GOLD_RGB = 0xffd36b;

/**
 * 时相 + 天气 → 环境光。黄昏偏蓝、雨夜压暗，正午几乎不提色。
 *
 * 纯函数：可单测，也让「环境光只是这两件事的函数」这句话有个可查的形状。
 */
export function ambientTintFor(
  phase: LightingFrame['phase'],
  weatherIntensity: number,
  raining: boolean,
): AmbientTint {
  const base =
    phase === 'dusk' ? { rgb: COOL_DUSK_RGB, strength: 0.55 }
    : phase === 'night' ? { rgb: 0x1e2c52, strength: 0.7 }
    : phase === 'dawn' ? { rgb: 0x6f7fa8, strength: 0.3 }
    : { rgb: 0xffffff, strength: 0.05 };
  const rain = raining ? Math.min(1, weatherIntensity) : 0;
  // 雨天：往深蓝方向压，强度再加一档（夜里雨压得最狠）。
  const strength = Math.min(0.95, base.strength + rain * (phase === 'night' ? 0.25 : 0.18));
  const rgb = rain > 0 ? mixRgb(base.rgb, 0x2b4a72, rain * 0.6) : base.rgb;
  return { rgb, strength };
}

/** 两个 0xRRGGBB 按 t 线性混合。 */
export function mixRgb(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  return (
    ((Math.round(ar + (br - ar) * k) & 0xff) << 16) |
    ((Math.round(ag + (bg - ag) * k) & 0xff) << 8) |
    (Math.round(ab + (bb - ab) * k) & 0xff)
  );
}

/**
 * 一盏灯这一帧的强度：基准 ± 呼吸正弦。
 *
 * `nowMs` 用世界呈现时刻（不是 `Date.now()`）：钉钟/回放时呼吸停在同一相位，
 * 截图比对才连帧一致。
 */
export function warmLightIntensity(source: WarmLightSource, nowMs: number): number {
  const breath = source.breath ?? 0.18;
  const phase = (nowMs % Math.max(1, source.periodMs)) / Math.max(1, source.periodMs);
  const wave = Math.sin(phase * Math.PI * 2);
  return Math.max(0, Math.min(1, source.intensity + wave * breath));
}



/** 一个场景级光照实例：槽池 + 每帧的请求翻译。 */
export interface ArtLightingHandle {
  /** 是否真的启用了（false = 无 WebGL / `?art=0`，update 是空转）。 */
  readonly active: boolean;
  /** 上一帧被槽池挤掉的灯数（证据读数，不静默丢）。 */
  readonly droppedLastFrame: () => number;
  /** 光照读数：槽容量 / 本帧请求数 / 挤掉数。无头冒烟用它证明这一层真在跑。 */
  readonly stats: () => { readonly active: boolean; readonly capacity: number; readonly requests: number; readonly dropped: number };
  readonly update: (frame: LightingFrame, focus: { readonly x: number; readonly y: number }) => void;
  readonly destroy: () => void;
}

/**
 * 场景用的入口：`?art=0` 或 Canvas/无头环境回 `active: false` 的空转壳——
 * 一个灯都不建、`lights` 数组保持原样，基线画面逐字节不变。
 *
 * 灯位来源收的是**取值函数**而不是数组：世界结构（建筑/摆件）会在造物、拆除
 * 之后变化，场景按节流重建那张表；本层每帧取最新的一份、自己不存副本，
 * 也就不会有「光照表与世界差一轮」这种最难查的错。
 */
export function createArtLighting(
  scene: Phaser.Scene,
  /** 灯位来源：每帧取最新一份。世界结构变化时由场景重建这张表（见 `lighting-readings.ts`）。 */
  sourcesOf: () => readonly WarmLightSource[],
  enabled: boolean,
): ArtLightingHandle {
  // 两道闸缺一不可：`enabled`（`?art=0` 基线绝不进来）与 `lightsSupported`
  // （Canvas / 无头环境根本没有灯光管线，建槽只会白白占住 LightsManager）。
  const pool = enabled && lightsSupported(scene)
    ? LightPool.create(scene.lights as unknown as import('./lighting-pool.ts').LightsManagerLike)
    : null;
  if (pool === null) {
    return {
      active: false,
      droppedLastFrame: () => 0,
      stats: () => ({ active: false, capacity: 0, requests: 0, dropped: 0 }),
      update: () => {},
      destroy: () => {},
    };
  }

  /** 本帧进入挑选的请求数（`update` 里写、`stats` 里读）。 */
  let lastRequests = 0;

  return {
    active: true,
    droppedLastFrame: () => pool.dropped,
    stats: () => ({
      active: true,
      capacity: pool.capacity,
      requests: lastRequests,
      dropped: pool.dropped,
    }),
    update(frame, focus) {
      const tint = ambientTintFor(frame.phase, frame.weatherIntensity, frame.raining);
      // 环境光的「强度」用混到黑表达：`setAmbientColor` 只吃颜色。
      pool.setAmbient(mixRgb(0x000000, tint.rgb, tint.strength));

      const sources = sourcesOf();
      const requests: LightRequest[] = pool.warmRequests(sources, frame.nowMs);
      lastRequests = requests.length;
      // 驻留建筑的窗口（基准强度 < 0.5 的灯）夜里跟着亮窗比例走。
      if (frame.phase === 'night') {
        for (let i = 0; i < requests.length; i += 1) {
          const source = sources[i]!;
          if (source.intensity >= 0.5) continue;
          requests[i] = { ...requests[i]!, intensity: requests[i]!.intensity * (0.4 + frame.litWindows * 0.9) };
        }
      }
      // 神谕光柱恒定强度：呼吸会让它读成「世界自己在闪」，不是「有人在回应」。
      if (frame.oracleActive) {
        requests.push({
          key: 'oracle',
          x: frame.oracleX,
          y: frame.oracleY,
          radius: 52,
          rgb: 0xffe6a8,
          intensity: 0.9,
          priority: 3,
        });
      }
      // 回溯金光跟着镜头中心：脚下一团金，不管镜头飘到哪。
      if (frame.rewindActive) {
        requests.push({
          key: 'rewind',
          x: frame.focusX,
          y: frame.focusY,
          radius: 34,
          rgb: REWIND_GOLD_RGB,
          intensity: 0.75,
          priority: 3,
        });
      }
      pool.apply(requests, focus);
    },
    destroy() {
      pool.destroy();
    },
  };
}
