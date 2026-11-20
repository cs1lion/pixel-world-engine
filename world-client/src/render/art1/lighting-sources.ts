/** 光源表：把「谁在发光」翻成 `WarmLightSource[]`（`?art=1`）。
 *
 * 场景每帧不重建这张表，但它必须在**建筑增减 / 世界重建**后再算一次——
 * 所以判据留在调用方：这里只收三类普通读数（街灯位、驻留建筑位、灯塔位），
 * 不知道 WorldState，也不读快照。写清楚输入形状，是这张表可单测的前提。
 *
 * 为什么街灯要跟着 `setting-scenery` 的灯位：那张表是**渲染层已有的事实**
 * （`lampUnits()` 报出 28 盏的顺序与坐标）。另算一遍灯位就是第二套规则，
 * 两套规则迟早对不上——本项目已经为此修过多次（见 `docs/OPEN_ISSUES.md` G 系列）。
 */

import type { WarmLightSource } from './lighting.ts';

/** 一盏街灯/一份窗光的位置读数（世界像素）。 */
export interface LightAnchor {
  readonly x: number;
  readonly y: number;
  /** `lamp` = 街灯/桥灯，`hall` = 驻留建筑窗口，`beacon` = 灯塔。 */
  readonly kind: 'lamp' | 'hall' | 'beacon';
  /** 同一 kind 内的序号：决定呼吸周期，免得整条街同相闪。 */
  readonly index: number;
}

/** 呼吸周期：街灯 3.4s、窗口 4.8s、灯塔 2.2s。 */
const PERIOD: Record<LightAnchor['kind'], number> = {
  lamp: 3400,
  hall: 4800,
  beacon: 2200,
};

/** 基准强度：街灯亮、窗口弱（夜里跟着亮窗比例再提，见 lighting.ts）、灯塔最亮。 */
const INTENSITY: Record<LightAnchor['kind'], number> = {
  lamp: 0.62,
  hall: 0.4,
  beacon: 0.85,
};

/** 光晕半径（世界像素）：窗口小、街灯中、灯塔能照半条街。 */
const RADIUS: Record<LightAnchor['kind'], number> = {
  lamp: 44,
  hall: 30,
  beacon: 76,
};

/**
 * 挤槽位的优先级：神谕/回溯（3）> 灯塔（2）> 窗口（1）= 街灯（1）。
 *
 * 窗口与街灯同档：两者都按离镜头距离竞争，镜头对着哪栋楼哪扇窗就亮。
 */
const PRIORITY: Record<LightAnchor['kind'], number> = {
  lamp: 1,
  hall: 1,
  beacon: 2,
};

/** 颜色：窗口偏暖橙、街灯标准琥珀、灯塔偏白。 */
const RGB: Record<LightAnchor['kind'], number> = {
  lamp: 0xffc27a,
  hall: 0xffb45e,
  beacon: 0xfff2cf,
};

/**
 * 位置 + kind + 序号 → 一盏会呼吸的灯。
 *
 * 周期按序号**散开**（±14%），不是同相：所有灯一起明灭会读成闪光灯，
 * 而不是「每盏灯各自烧着各自的油」。
 */
export function warmSourceOf(anchor: LightAnchor): WarmLightSource {
  // 周期抖动：序号参与（index*37 % 100），保证同一盏灯每帧拿到同一个周期。
  const jitter = 1 + (((anchor.index * 37) % 100) / 100) * 0.28 - 0.14;
  return {
    x: anchor.x,
    y: anchor.y,
    radius: RADIUS[anchor.kind],
    intensity: INTENSITY[anchor.kind],
    periodMs: Math.round(PERIOD[anchor.kind] * jitter),
    breath: anchor.kind === 'beacon' ? 0.1 : 0.18,
    color: RGB[anchor.kind],
    priority: PRIORITY[anchor.kind],
  };
}

/**
 * 合成整张光源表。同一坐标的灯只留一盏（`kind` 优先、再按序号）：
 * 证据脚本与槽池都按「一坐标一灯」算距离，重影会把容量白白吃空。
 */
export function buildWarmSources(
  anchors: readonly LightAnchor[],
): WarmLightSource[] {
  const byPos = new Map<string, LightAnchor>();
  for (const anchor of anchors) {
    const key = `${anchor.x},${anchor.y}`;
    const existing = byPos.get(key);
    if (existing === undefined || priorityOf(anchor.kind) > priorityOf(existing.kind)) {
      byPos.set(key, anchor);
    }
  }
  return [...byPos.values()].map(warmSourceOf);
}

function priorityOf(kind: LightAnchor['kind']): number {
  return kind === 'beacon' ? 2 : kind === 'hall' ? 1 : 0;
}

/**
 * 把 `setting-scenery` 的街灯读数翻成锚点。
 *
 * 收的是 `{order,x,y,hanging}` 这种普通形状（`lampUnits()` 的原样），
 * 不 import 那个模块：本层只认坐标，渲染层将来改字段也不会牵到这儿。
 */
export function lampAnchorsOf(
  lamps: readonly { readonly order: number; readonly x: number; readonly y: number; readonly hanging: boolean }[],
  /** 只取前 N 盏：夜里真正亮着的那几盏由调用方裁（灯态判据在 `lampStreetLitAt`）。 */
  max: number,
): LightAnchor[] {
  return lamps.slice(0, Math.max(0, max)).map((lamp) => ({
    x: Math.round(lamp.x),
    y: Math.round(lamp.y),
    kind: lamp.hanging ? ('hall' as const) : ('lamp' as const),
    index: lamp.order,
  }));
}

/**
 * 把建筑读数翻成窗口锚点。
 *
 * 一窗一锚：楼左下角起 (10, -8) 与 (w-16, -8) 两个位置，与
 * `buildings.ts#drawWindows` 那两处亮窗的位置同口径（差一个像素就是
 * 「光晕不在窗上」，肉眼最挑得出这个）。
 */
export function hallAnchorsOf(
  buildings: readonly {
    readonly instanceId: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    /** 当下有没有人在里面干活（由快照翻成布尔再递进来）。 */
    readonly active: boolean;
  }[],
): LightAnchor[] {
  const out: LightAnchor[] = [];
  for (const building of buildings) {
    if (!building.active) continue;
    const base = hashIndexOf(building.instanceId);
    out.push({ x: Math.round(building.x + 10), y: Math.round(building.y - building.h * 0.45), kind: 'hall', index: base });
    if (building.w >= 48) {
      out.push({ x: Math.round(building.x + building.w - 16), y: Math.round(building.y - building.h * 0.45), kind: 'hall', index: base + 1 });
    }
  }
  return out;
}

/** 稳定序号：同一栋楼永远同一相，重启不漂（与 `wallSeed` 同思路）。 */
function hashIndexOf(instanceId: string): number {
  let h = 0;
  for (let i = 0; i < instanceId.length; i += 1) {
    h = (h * 31 + instanceId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 97;
}
