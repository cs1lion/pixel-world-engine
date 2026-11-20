/** 固定容量的**灯槽池**（`art1/lighting.ts` 的实现内核）。
 *
 * 为什么不是「一灯一对象、按世界现建现删」：Phaser 4 的可见灯数上限是
 * `renderer.config.maxLights`（缺省 **10**，见 dist 里 `GetValue(renderConfig,
 * 'maxLights', 10, config)`），超过它按「离镜头远近」裁灯；而街上单是街灯
 * 就有 28 盏（`setting-scenery.ts` 的 `lampCount`），再加窗口、神谕、回溯——
 * 全建出来既超预算又会被裁掉，观感还不稳定。
 *
 * 所以：**槽位数一次建满、永不增删**，每帧只决定「谁进哪个槽」。
 * 增删 Light 对象会牵动 `lights` 数组与管线，换位置与强度则是普通赋值。
 *
 * 本模块只在 WebGL 下被 `lighting.ts` 使用；Canvas/无头环境根本不会建它。
 */

import { WARM_LIGHT_RGB, warmLightIntensity, type WarmLightSource } from './lighting.ts';

/** LightsManager 在本层用到的成员（4.x 的实面，逐项对过 dist）。 */
export interface LightsManagerLike {
  readonly lights: readonly unknown[];
  readonly maxLights: number;
  enable(): unknown;
  disable(): unknown;
  setAmbientColor(rgb: number): unknown;
  addLight(
    x?: number,
    y?: number,
    radius?: number,
    rgb?: number,
    intensity?: number,
  ): LightLike;
}

/** 一盏灯在本层用到的可写面。 */
export interface LightLike {
  x: number;
  y: number;
  radius: number;
  setIntensity(intensity: number): unknown;
  setColor(rgb: number): unknown;
  setRadius(radius: number): unknown;
}

/**
 * 离镜头近的优先。
 *
 * `priority` 给同距离的灯分档：神谕/回溯这类「正在发生的事」不能被一盏
 * 同样近的街灯挤掉。数值越大越优先。
 */
export interface LightRequest {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly rgb: number;
  /** 0..1 强度；0 表示这一帧不该亮。 */
  readonly intensity: number;
  readonly priority: number;
}

/** 挑选结果：进槽的请求 + 被挤掉的数量（读数量用，别静默丢）。 */
export interface LightSelection {
  readonly taken: readonly LightRequest[];
  readonly dropped: number;
}

/**
 * 从请求里挑出容量内的一批：先按 priority 降序，再按离镜头距离升序。
 *
 * 纯函数，可单测——「谁被照亮」这件事一旦写进渲染循环就只能靠肉眼。
 */
export function selectLights(
  requests: readonly LightRequest[],
  focus: { readonly x: number; readonly y: number },
  capacity: number,
): LightSelection {
  const lit = requests.filter((request) => request.intensity > 0);
  const ranked = [...lit].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (
      squaredDistance(a.x, a.y, focus.x, focus.y) - squaredDistance(b.x, b.y, focus.x, focus.y)
    );
  });
  const cap = Math.max(0, capacity);
  return { taken: ranked.slice(0, cap), dropped: Math.max(0, ranked.length - cap) };
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * 灯槽池：`slots.length === capacity`，一次建满。
 *
 * 每帧 `apply` 把选中的请求写进槽位、其余槽位置空（强度 0 + 隐藏），
 * 所以 `lights` 数组长度恒定。
 */
export class LightPool {
  private readonly slots: readonly LightLike[];
  private readonly manager: LightsManagerLike;
  /** 上一帧被挤掉的灯数（`renderStats` 与无头冒烟读它）。 */
  private lastDropped = 0;

  private constructor(manager: LightsManagerLike, capacityHint: number) {
    this.manager = manager;
    manager.enable();
    // 容量在 enable **之后**读：`maxLights` 要 enable 时才从 renderer 配置
    // 里填（没填是 -1），先读会拿到 -1 退回缺省 10。
    const capacity = manager.maxLights > 0 ? manager.maxLights : Math.max(1, capacityHint);
    const created: LightLike[] = [];
    for (let i = 0; i < capacity; i += 1) {
      // 空槽停在原点、强度 0：它存在但不进画面（见类注释的「空槽口径」）。
      const light = manager.addLight(0, 0, 8, WARM_LIGHT_RGB, 0);
      created.push(light);
    }
    this.slots = created;
  }

  /** 按渲染器的 `maxLights` 建池（拿不到就按缺省 10）。 */
  static create(manager: LightsManagerLike): LightPool {
    return new LightPool(manager, 10);
  }

  get capacity(): number {
    return this.slots.length;
  }

  /** 上一帧没挤进槽位的灯数。 */
  get dropped(): number {
    return this.lastDropped;
  }

  setAmbient(rgb: number): void {
    this.manager.setAmbientColor(rgb);
  }

  /**
   * 把这一帧的请求写进槽位。
   *
   * `focus` 是镜头中心（世界像素）：距离按它算，不是按世界中心——
   * 玩家看哪儿，哪儿的灯才该亮。
   */
  apply(requests: readonly LightRequest[], focus: { readonly x: number; readonly y: number }): void {
    const picked = selectLights(requests, focus, this.slots.length);
    this.lastDropped = picked.dropped;
    for (let i = 0; i < this.slots.length; i += 1) {
      const slot = this.slots[i]!;
      const request = picked.taken[i];
      if (request === undefined) {
        // 空槽口径：强度归零即可。渲染侧对强度 0 的灯不贡献光量，
        // 而  的可见性不在本层用到的 API 面上（见 ），
        // 所以这里不假设  存在。
        slot.setIntensity(0);
        continue;
      }
      slot.x = request.x;
      slot.y = request.y;
      slot.setRadius(request.radius);
      slot.setColor(request.rgb);
      slot.setIntensity(request.intensity);
    }
  }

  /**
   * 把暖光源翻成请求：窗口（`intensity < 0.5`）优先级低于街灯——
   * 28 盏街灯挤满槽位时，先把远处那些挤掉，别把「正在亮的事」挤掉。
   */
  warmRequests(sources: readonly WarmLightSource[], nowMs: number): LightRequest[] {
    return sources.map((source, index) => ({
      key: `w${index}`,
      x: source.x,
      y: source.y,
      radius: source.radius,
      rgb: source.color ?? WARM_LIGHT_RGB,
      intensity: warmLightIntensity(source, nowMs),
      priority: source.priority ?? (source.intensity < 0.5 ? 0 : 1),
    }));
  }

  destroy(): void {
    for (const slot of this.slots) {
      slot.setIntensity(0);
      // `lights` 是普通数组，按引用摘掉自己建的那些槽。
      const list = this.manager.lights as unknown as LightLike[];
      const at = list.indexOf(slot);
      if (at >= 0) list.splice(at, 1);
    }
    this.manager.disable();
  }
}
