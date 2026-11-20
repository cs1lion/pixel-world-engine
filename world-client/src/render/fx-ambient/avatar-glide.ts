/** 点击头像后的平滑阻尼镜头跟随（纯表现层）。
 *
 * 需求：旁观者点左上角头像，镜头**滑过去**而不是瞬移，滑到之后交给既有
 * `CameraController.follow()` 接管。为什么单独一个文件：
 *
 * 1. **判定与运动分开**：点谁、跟谁，是 `village-hud.ts` 已经定的（它调
 *    `followVillager`）；怎么滑过去，才是这里的全部内容。两件事不能长在
 *    一个文件里，否则镜头语义与 UI 选择互相改写。
 * 2. **时间用入参**：`update(deltaMs)` 只吃帧间隔。世界暂停时 delta 照来
 *    （这是画面时刻，不是世界时刻），滑行不中断；回放/钉钟走 `?art=0`，
 *    本层不参与，不欠确定性账。
 * 3. **静止即交棒**：滑到位之后状态机自拆，镜头控制权完整交回
 *    `CameraController`（拖拽/导播/缩放全走原路），本层不常驻镜头。
 *
 * 阻尼公式：临界阻尼弹簧（`position += (target - position) * (1 - exp(-k*dt))`），
 * 帧率无关、永远不超调、2 秒内基本到位——比线性 lerp 自然，比 tween 轻
 * （不用常驻 tween 管理器）。
 */

/** 阻尼常数：越大滑得越快。0.006 ≈ 350ms 内走完 90% 路程。 */
export const DAMPING_K = 0.006;

/** 到位阈值（像素）：差这么多以内就算到了，立即交棒。 */
export const SETTLE_PX = 2;

/** 一次滑行的完整状态；`null` 距离 = 还没开始滑。 */
export interface GlideState {
  readonly x: number;
  readonly y: number;
  readonly targetX: number;
  readonly targetY: number;
}

/**
 * 推进一步。纯函数：状态进、状态出，场景层只持有这一个值。
 *
 * `dtMs` 是这一帧的时长（Phaser `update(time, delta)` 的 delta）。负数与
 * NaN 当 0 处理——脏帧不炸，也不倒退。
 */
export function glideStep(
  state: GlideState,
  dtMs: number,
): { readonly state: GlideState; readonly settled: boolean } {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const k = 1 - Math.exp(-DAMPING_K * dt);
  const x = state.x + (state.targetX - state.x) * k;
  const y = state.y + (state.targetY - state.y) * k;
  return {
    state: { x, y, targetX: state.targetX, targetY: state.targetY },
    settled:
      Math.abs(state.targetX - x) <= SETTLE_PX && Math.abs(state.targetY - y) <= SETTLE_PX,
  };
}

/** 新建一次滑行：起点 = 镜头此刻的位置，终点 = 目标位置。 */
export function beginGlide(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): GlideState {
  return { x: from.x, y: from.y, targetX: to.x, targetY: to.y };
}

/**
 * 场景侧的滑行控制器：把「头像点击」翻译成一次 `CameraController` 兼容的
 * 平滑移动，到位后自动交棒。
 *
 * `scrollOf` 把世界坐标翻成相机 scroll（与 `camera-math.ts` 同一口径，由
 * 调用方递进来——本层不 import 相机表，也不认识 zoom 阶梯）。
 */
export interface CameraGlide {
  /** 发起一次滑行（点头像时调）。已在滑行中则改道，不重置起点。 */
  readonly begin: (worldX: number, worldY: number) => void;
  /** 每帧步进；返回 true 表示「本帧我在控制镜头」，false = 交棒完毕/未激活。 */
  readonly update: (deltaMs: number) => boolean;
  /** 目标是否仍在滑（镜头被人拖走时调用方可以打断）。 */
  readonly active: () => boolean;
  readonly cancel: () => void;
}

export function createCameraGlide(args: {
  /** 世界坐标 → 相机 scroll（与 `camera-math.ts` 同一口径，由调用方递）。 */
  readonly scrollOf: (x: number, y: number) => { readonly x: number; readonly y: number };
  /** 镜头此刻的 scroll：滑行的起点。 */
  readonly currentScroll: () => { readonly x: number; readonly y: number };
  readonly applyScroll: (x: number, y: number) => void;
}): CameraGlide {
  let state: GlideState | null = null;

  return {
    begin(worldX, worldY) {
      const to = args.scrollOf(worldX, worldY);
      if (state !== null) {
        // 改道：保留当前位置，只换终点——连点两个头像时镜头不回跳。
        state = { ...state, targetX: to.x, targetY: to.y };
        return;
      }
      const from = args.currentScroll();
      // 起点与终点已经同点（镜头就在那人脚下）：不建滑行，直接交棒。
      if (
        Math.abs(to.x - from.x) <= SETTLE_PX &&
        Math.abs(to.y - from.y) <= SETTLE_PX
      ) {
        return;
      }
      state = beginGlide(from, to);
    },
    update(deltaMs) {
      if (state === null) return false;
      const next = glideStep(state, deltaMs);
      if (next.settled) {
        // 到位帧吸附到目标：最后一帧不许带着 1.9px 的残差交棒。
        state = null;
        args.applyScroll(next.state.targetX, next.state.targetY);
        return true;
      }
      state = next.state;
      args.applyScroll(next.state.x, next.state.y);
      return true;
    },
    active: () => state !== null,
    cancel() {
      state = null;
    },
  };
}
