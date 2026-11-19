/** 画布点中村民时，弹出在她脚下的轻量快捷条。
 *
 * 大侧边栏（村民记忆面板）要为「认真聊」准备的；可最常见的五个动作——
 * 派活、给东西、问一句、跟随、看资料——不该为它们反复开合那扇大门。
 * 点到她，脚下一条小栏，五个动作伸手就到，做完即收。
 *
 * 纪律照旧：
 *
 * 1. **中文不进 canvas**：条是 DOM，挂在 `#world-overlay` 里，跟着
 *    世界坐标投影走——她走路，条跟着她脚下挪（`labels.ts` 那套纯数学，
 *    与名字/气泡同一根公式，不另写一遍）。
 * 2. **不碰仿真**：五个动作全走场景已有的写口（`villagerAction` 排队、
 *    `followVillager` 只动镜头、`inspectVillager` 开只读状态菜单），
 *    这里没有一条直接改世界。
 * 3. **`?art=0` 下一张图都不请求**：五个按钮都是运行时建的文字按钮。
 */

import type { VillagerSnapshot, WorldSnapshot } from '../world/types.ts';
import type { CameraLike, OverlayPoint, OverlayViewport } from '../render/labels.ts';
import { overlayViewportOf, projectWorldToOverlay, snapToDevicePixel } from '../render/labels.ts';
import { groundY } from '../render/ground.ts';
import { TILE_PX } from '../world/setup.ts';

/** 脚下滑条比脚底低多少世界像素：贴在脚边，不压住她的小人。 */
export const QUICK_BAR_FOOT_LIFT_PX = 8;

export interface QuickActionSpec {
  /** 场景 `villagerAction` 认得的动作用名；`follow` / `info` 走场景专口。 */
  readonly action: 'dispatch' | 'carry' | 'ask' | 'follow' | 'info';
  readonly text: string;
}

/** 五个动作，顺序即屏幕顺序。文案是 UI 文案，不是世界数据。 */
export const QUICK_ACTIONS: readonly QuickActionSpec[] = [
  { action: 'dispatch', text: '派活' },
  { action: 'carry', text: '给东西' },
  { action: 'ask', text: '问一句' },
  { action: 'follow', text: '跟随' },
  { action: 'info', text: '资料' },
];

/**
 * 快捷条在她脚下的锚点（overlay 本地坐标）。
 *
 * 与 `labels.ts` 的名字锚点同一套投影：脚底世界坐标取
 * `(pos.x + 0.5) * TILE_PX` 与 `groundY(pos.y)`，再往下让出 `QUICK_BAR_FOOT_LIFT_PX`。
 */
export function quickBarAnchor(
  villager: VillagerSnapshot,
  viewport: OverlayViewport,
): OverlayPoint {
  return projectWorldToOverlay(
    (villager.pos.x + 0.5) * TILE_PX,
    groundY(villager.pos.y) + QUICK_BAR_FOOT_LIFT_PX,
    viewport,
  );
}

/** 场景要供给的那一面：画布与相机，够算投影了。 */
export interface QuickBarSceneLike {
  readonly game: { readonly canvas: HTMLCanvasElement };
  readonly cameras: { readonly main: CameraLike };
}

export interface QuickBarOracle {
  /** 只读快照：摆条时要拿她此刻的可见性与坐标。 */
  readonly view: () => WorldSnapshot;
  /** 派活 / 给东西 / 问一句：排队，下一拍结算（与村民面板同一条纪律）。 */
  readonly villagerAction: (action: string, villagerId: string) => void;
  /** 镜头锁住她，不开面板。 */
  readonly followVillager: (villagerId: string) => void;
  /** 开她的只读状态菜单（「资料」）。 */
  readonly inspectVillager: (villagerId: string) => void;
}

export interface QuickBarHandle {
  /** 某人脚下弹出条。id 不在场（走了/被拆了）就保持收起。 */
  readonly show: (villagerId: string) => void;
  readonly hide: () => void;
  /** 每拍调用：她走了，条跟着挪；她不见了，条收起。 */
  readonly sync: (snapshot: WorldSnapshot) => void;
  readonly dispose: () => void;
}

export interface QuickBarOptions {
  readonly scene?: QuickBarSceneLike;
  /** 测试可注入一个固定落点，跳过投影数学。 */
  readonly readPlacement?: (villager: VillagerSnapshot) => OverlayPoint | null;
}

export function bindVillagerQuickBar(
  getApi: () => QuickBarOracle | undefined,
  options: QuickBarOptions = {},
): QuickBarHandle {
  const root = document.querySelector<HTMLElement>('#world-overlay');
  if (root === null) {
    return { show: () => {}, hide: () => {}, sync: () => {}, dispose: () => {} };
  }

  const bar = document.createElement('div');
  bar.id = 'villager-quick-bar';
  bar.className = 'villager-quick-bar';
  bar.hidden = true;
  const buttons = new Map<string, HTMLButtonElement>();
  for (const spec of QUICK_ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-action';
    button.dataset.action = spec.action;
    button.textContent = spec.text;
    bar.append(button);
    buttons.set(spec.action, button);
  }
  root.append(bar);

  let currentId: string | null = null;

  const placement = options.readPlacement
    ?? ((villager: VillagerSnapshot): OverlayPoint | null => {
      const scene = options.scene;
      if (scene === undefined) return null;
      const canvas = scene.game.canvas as HTMLCanvasElement;
      const canvasRect = canvas.getBoundingClientRect();
      // 投影参数与名字/气泡同一把尺（`overlayViewportOf`）；要不要除缩放，
      // 是 `place` 那一段的事，这里只算世界坐标在画布口径下的位置。
      const viewport = overlayViewportOf(scene.cameras.main, canvasRect, canvas);
      return quickBarAnchor(villager, viewport);
    });

  const place = (villager: VillagerSnapshot): void => {
    const point = placement(villager);
    if (point === null) {
      bar.hidden = true;
      return;
    }
    // 以下与 `world-overlay.ts` 的 `place` 同一套：overlay 被同步成与 canvas
    // 同尺寸（可能处在被 CSS transform 缩放的 stage 里），先把「缩放后的
    // CSS 像素」折回 overlay 本地坐标。缩放取 transform 矩阵的真实值，
    // 不用 rect 相除反推——理由写在 `world-overlay.ts` 的 `readStageScale`。
    const stage = root.parentElement ?? root;
    // 假 DOM 没有这两样（getBoundingClientRect / getComputedStyle）：单测里
    // 注了 readPlacement，投影数学被跳过，这两处按「没缩放、没有矩形」兜底。
    const stageRect = typeof stage.getBoundingClientRect === 'function'
      ? stage.getBoundingClientRect()
      : { width: 0 };
    const transform = typeof getComputedStyle === 'function' ? getComputedStyle(stage).transform : 'none';
    let rootScale = 1;
    const matched = transform === 'none' ? null : /matrix\(([^)]+)\)/.exec(transform);
    if (matched !== null) {
      const scale = Number.parseFloat(matched[1]!.split(',')[0] ?? '');
      if (Number.isFinite(scale) && scale > 0) rootScale = scale;
    }
    const dpr = typeof window === 'undefined' ? 1 : (window.devicePixelRatio || 1);
    // 先把「画布 CSS 像素」折回 overlay 本地坐标，与名字/气泡同一除数。
    const x = snapToDevicePixel(point.x, dpr) / rootScale;
    const y = snapToDevicePixel(point.y, dpr) / rootScale;
    const overlayWidth = stageRect.width / rootScale;
    const barWidth = typeof bar.offsetWidth === 'number' ? bar.offsetWidth : 0;
    const left = Math.min(Math.max(x, 2), Math.max(2, overlayWidth - barWidth - 2));
    bar.style.left = `${left}px`;
    bar.style.top = `${y}px`;
    bar.hidden = false;
  };

  const hide = (): void => {
    currentId = null;
    bar.hidden = true;
  };

  const show = (villagerId: string): void => {
    currentId = villagerId;
    const api = getApi();
    if (api === undefined) return;
    const villager = api.view().villagers.find((item) => item.id === villagerId);
    if (villager === undefined || !villager.visible) {
      hide();
      return;
    }
    place(villager);
  };

  const sync = (snapshot: WorldSnapshot): void => {
    if (currentId === null) return;
    const villager = snapshot.villagers.find((item) => item.id === currentId);
    if (villager === undefined || !villager.visible) {
      hide();
      return;
    }
    place(villager);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || bar.hidden) return;
    hide();
  };

  for (const spec of QUICK_ACTIONS) {
    const button = buttons.get(spec.action);
    button?.addEventListener('click', () => {
      const api = getApi();
      const id = currentId;
      if (api === undefined || id === null) return;
      if (spec.action === 'follow') {
        api.followVillager(id);
      } else if (spec.action === 'info') {
        api.inspectVillager(id);
      } else {
        api.villagerAction(spec.action, id);
      }
      hide();
    });
  }

  document.addEventListener('keydown', onKey);

  return { show, hide, sync, dispose: () => document.removeEventListener('keydown', onKey) };
}
