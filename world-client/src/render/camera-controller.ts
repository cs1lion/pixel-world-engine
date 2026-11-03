/** 三模相机：自由平移、锁定跟随、自动导播。
 *
 * 为什么需要三种而不是一种：这是挂在桌面上陪你干活的窗口，不是游戏。
 * 你可能正在看工坊，也可能只是在打字、完全不看它。相机必须自己知道该看哪。
 *
 * 两条硬约束：
 *   1. **缩放只能取阶梯值**。连续浮点缩放会让像素块的边缘出现摩尔纹——
 *      16px 的图块在四个档位（1 / 1.5 / 2 / 3）下是 16 / 24 / 32 / 48px，
 *      都是整数；取 1.13 就是 18.08px，边落在像素中间，看起来像糊了。
 *      （这一行原来写「1.13 倍缩放后每条边落在半个像素上」——16×1.13 = 18.08，
 *      不是 18.5。「半个像素」是我手打的，按不出来。）
 *   2. **必须锁在世界边界内**。否则镜头会飘到世界外，露出空白背景。
 */

import Phaser from 'phaser';
import {
  DIRECTOR_DWELL_MS,
  DIRECTOR_IDLE_MS,
  ZOOM_STEPS,
  clampScroll,
  createDirectorClock,
  scrollForOrigin,
  scrollForZoomAnchor,
  stepZoomIndex,
  viewOriginOf,
} from './camera-math.ts';

export type CameraMode = 'free' | 'follow' | 'director';

export interface CameraController {
  readonly mode: () => CameraMode;
  /** 拖拽平移：按屏幕像素位移移动镜头。 */
  panBy(dx: number, dy: number): void;
  /** 平滑移到世界坐标。 */
  panTo(x: number, y: number, durationMs?: number): void;
  /** 阶梯缩放：direction 为正放大，为负缩小。 */
  zoomStep(direction: 1 | -1): number;
  /**
   * 阶梯缩放，但以屏幕点 `(screenX, screenY)` 为锚。
   *
   * 捏合缩放走这条：两指中点下的世界坐标在换档前后不动，玩家才觉得是
   * 「放大了手指之间那块」，而不是「画面被拽走」。档位与范围仍是
   * `ZOOM_STEPS` 那一套，与滚轮共用，不另造连续倍率。
   */
  zoomStepAt(direction: 1 | -1, screenX: number, screenY: number): number;
  readonly zoom: () => number;
  /** 跟随某个对象（通常是角色）。传 null 回到自由模式。 */
  follow(target: Phaser.GameObjects.GameObject | null): void;
  /**
   * 有没有可跟随的目标。
   *
   * 「跟随」按钮在没跟过任何人时该是 disabled——按了不动的按钮比没有按钮更糟。
   * 用户自己拖走镜头不算丢掉目标，所以拖完这个仍然为真。
   */
  canFollow(): boolean;
  /**
   * 松开跟随，但**记住**跟的是谁。
   *
   * 与 `follow(null)` 的差别只在这一点：那个把目标也忘了，于是「跟随」按钮
   * 跟着变成 disabled。关掉村民面板只是不想再跟，不是不想再跟**她**。
   */
  releaseFollow(): void;
  /** 打开自动导播；`candidates` 返回当前值得看的世界坐标。 */
  enableDirector(candidates: () => readonly { x: number; y: number }[]): void;
  disableDirector(): void;
  /**
   * 显式切到某个模式。三个按钮走这条。
   *
   * `'follow'` 用**上一次**的跟随目标；一次都没跟过就不动（按钮那边是 disabled）。
   * `'director'` 立刻接管，不等闲置计时——按了按钮还要等 15 秒是说不通的。
   * `'free'` 会把导播整个关掉，之后不会再自己接管。
   */
  setMode(mode: CameraMode): void;
  /**
   * 世界刚发生一件事，落点在这儿。
   *
   * **只有已经处在导播时才理会**：自由与跟随模式下绝不抢镜头——玩家正看着
   * 某处，一次潮水掉头不该把画面拽走。导播下它会打断当前的轮转，立刻过去，
   * 并吃掉这一档（不然刚落地又被轮转切走）。
   */
  notifyEvent(point: { readonly x: number; readonly y: number }): void;
  /** 每帧调用：处理闲置计时与导播切换。 */
  update(deltaMs: number): void;
  /** 用户有任何输入时调用：重置闲置计时并退出导播。 */
  notifyInput(): void;
  /** 当前视野在世界里的矩形，给小地图画白框。 */
  viewportRect(): { x: number; y: number; width: number; height: number };
}

export interface CameraOptions {
  /** 初始缩放档位。省略就是 2 倍。设定集地图比旧镇大得多，它要 1 倍起。 */
  readonly zoomIndex?: number;
}

export function createCameraController(
  scene: Phaser.Scene,
  worldWidth: number,
  worldHeight: number,
  options: CameraOptions = {},
): CameraController {
  const cam = scene.cameras.main;
  cam.setBounds(0, 0, worldWidth, worldHeight);

  // 计时逻辑交给纯函数时钟：规则只写一份，测试也只验一份。
  const clock = createDirectorClock(DIRECTOR_IDLE_MS, DIRECTOR_DWELL_MS);
  /** 跟随模式是相机自己的事，时钟只管"自由 / 导播"。 */
  let following = false;
  /** 上一次跟随的对象。显式的「跟随」按钮没有别的目标可挑，只能用它。 */
  let lastFollowTarget: Phaser.GameObjects.GameObject | null = null;
  let candidates: (() => readonly { x: number; y: number }[]) | null = null;
  /**
   * 这一档已经平移过了没有（`-1` 表示不在导播里）。
   *
   * 原来用的是 `nextCandidate > 0`——那是个只增不减的计数，于是**第二次**
   * 进入导播时它已经大于 0，进入那一帧不会平移，要干等一个 `DIRECTOR_DWELL_MS`
   * 才动。按档位记就没有这个问题：离开导播时复位，再进来一定重新平移。
   */
  let lastPannedIndex = -1;
  /** 刚发生、还没给镜头看的事件落点。只在导播里被消费。 */
  let pendingEvent: { x: number; y: number } | null = null;

  const mode = (): CameraMode => (following ? 'follow' : clock.mode());

  const zoomIndex0 = options.zoomIndex ?? ZOOM_STEPS.indexOf(2);
  let zoomIndex = Math.max(0, Math.min(ZOOM_STEPS.length - 1, zoomIndex0));
  // **必须真的设上去。** 原来只记了档位索引，`cam.zoom` 停在 Phaser 的默认 1：
  // 于是索引说 2 倍、画面是 1 倍，滚轮第一格从 1 跳到 1.5 是「放大」，第二格
  // 直接越过 2 到 3。设定集那支靠连按两次 `zoomStep(-1)` 把画面救回 1 倍，
  // 而默认世界没有这一步，档位一直是分家的。
  cam.setZoom(ZOOM_STEPS[zoomIndex]!);

  return {
    mode,

    panBy(dx, dy) {
      this.notifyInput();
      // 位移要除以缩放：屏幕上拖 10px，缩放到 2 倍时世界只该移动 5px。
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    },

    panTo(x, y, durationMs = 300) {
      this.notifyInput();
      if (durationMs <= 0) {
        // 0 毫秒时 `cam.pan` 不会在这一帧生效，worldView 仍是旧值——
        // overlay 会在开局错位一整个屏幕。这里直接设中心点。
        cam.centerOn(x, y);
        return;
      }
      cam.pan(x, y, durationMs, 'Sine.easeInOut', true);
    },

    zoomStep(direction) {
      this.notifyInput();
      zoomIndex = stepZoomIndex(zoomIndex, direction);
      const next = ZOOM_STEPS[zoomIndex]!;
      // 先按**旧**倍率把 scroll 换算成视野原点，再夹，再按**新**倍率换回 scroll。
      // 直接拿 scrollX 去夹是错的：夹的是原点，两者差半个视野（见 `viewOriginOf`）。
      const originX = viewOriginOf(cam.scrollX, cam.width, cam.zoom);
      const originY = viewOriginOf(cam.scrollY, cam.height, cam.zoom);
      cam.setZoom(next);
      const clamped = clampScroll(originX, originY, worldWidth, worldHeight, cam.width, cam.height, next);
      cam.scrollX = scrollForOrigin(clamped.x, cam.width, next);
      cam.scrollY = scrollForOrigin(clamped.y, cam.height, next);
      return next;
    },

    zoomStepAt(direction, screenX, screenY) {
      this.notifyInput();
      const from = cam.zoom;
      zoomIndex = stepZoomIndex(zoomIndex, direction);
      const next = ZOOM_STEPS[zoomIndex]!;
      // 已经在顶 / 底：不动 scroll。否则每次到顶后继续捏合都会把画面往锚点推一点。
      if (next === from) return from;
      const scrollX = scrollForZoomAnchor(cam.scrollX, cam.width, from, next, screenX);
      const scrollY = scrollForZoomAnchor(cam.scrollY, cam.height, from, next, screenY);
      cam.setZoom(next);
      // 与 `zoomStep` 同一套边界口径：夹的是**视野原点**，再按新倍率换回 scroll。
      const clamped = clampScroll(
        viewOriginOf(scrollX, cam.width, next),
        viewOriginOf(scrollY, cam.height, next),
        worldWidth,
        worldHeight,
        cam.width,
        cam.height,
        next,
      );
      // 取整再落：`roundPixels` 的相机会把 scroll 往下取地板，1e-13 的负数尾巴
      // 会被压掉整整 1 世界px（实测 423.99999999999994 → 423）。
      cam.scrollX = Math.round(scrollForOrigin(clamped.x, cam.width, next));
      cam.scrollY = Math.round(scrollForOrigin(clamped.y, cam.height, next));
      return next;
    },

    zoom: () => cam.zoom,

    follow(target) {
      this.notifyInput();
      if (target === null) {
        cam.stopFollow();
        following = false;
        lastFollowTarget = null;
        return;
      }
      following = true;
      lastFollowTarget = target;
      cam.startFollow(target, true, 0.08, 0.08);
    },

    canFollow: () => lastFollowTarget !== null,

    releaseFollow() {
      if (!following) return;
      cam.stopFollow();
      following = false;
    },

    enableDirector(nextCandidates) {
      // 只登记目标，不立刻接管：导播要等闲置计时到点。
      // 直接切进 director 会和用户抢镜头——他一进来就发现镜头自己在动。
      candidates = nextCandidates;
      clock.enable();
    },

    disableDirector() {
      candidates = null;
      clock.disable();
    },

    setMode(next) {
      if (next === 'follow') {
        if (lastFollowTarget === null) return;
        this.follow(lastFollowTarget);
        return;
      }
      // 没有候选就不动——**而且要在 `notifyInput` 之前判**：按了个不动的按钮，
      // 不该顺手把人从跟随里踢出来。
      if (next === 'director' && candidates === null) return;
      // 先退出跟随（`notifyInput` 会停掉 Phaser 的 follow），再决定时钟。
      this.notifyInput();
      if (next === 'free') {
        clock.disable();
        return;
      }
      clock.enable();
      clock.force();
    },

    notifyEvent(point) {
      // 判 `mode()` 而不是 `clock.mode()`：跟随中镜头归 Phaser 的 startFollow，
      // 此刻哪怕时钟内部已经数到导播，这一帧也不该有第二个人摆镜头。
      if (mode() !== 'director') return;
      pendingEvent = { x: point.x, y: point.y };
    },

    update(deltaMs) {
      // 跟随中什么都不做，并把导播的闲置计时按在 0。
      //
      // 原来没有这一段：`follow()` 只 reset 了一次闲置计时，时钟仍登记着，
      // 于是 15 秒后导播一边平移、Phaser 一边跟随，`mode()` 却还报告 'follow'。
      // 跟随是用户自己挑的目标，不能被闲置计时抢走。松开跟随后，闲置计时
      // 从松开那一刻重新起算——世界照旧会自己接管。
      if (following) {
        clock.notifyInput();
        pendingEvent = null;
        lastPannedIndex = -1;
        return;
      }
      clock.tick(deltaMs);
      if (clock.mode() !== 'director') {
        lastPannedIndex = -1;
        pendingEvent = null;
        return;
      }

      // 事件优先：它比轮转更该被看见。吃掉这一档，免得刚落地又被切走。
      if (pendingEvent !== null) {
        const point = pendingEvent;
        pendingEvent = null;
        lastPannedIndex = clock.targetIndex();
        cam.pan(point.x, point.y, 900, 'Sine.easeInOut', true);
        return;
      }

      const index = clock.targetIndex();
      if (index === lastPannedIndex) return;
      lastPannedIndex = index;

      const list = candidates?.() ?? [];
      if (list.length === 0) return;
      // 用时钟的档位索引取候选，不另记一个计数器：`candidates()` 每帧重新算，
      // 列表长度与顺序都可能变，两个各自递增的计数器迟早指向不同的元素。
      const point = list[index % list.length]!;
      cam.pan(point.x, point.y, 900, 'Sine.easeInOut', true);
    },

    notifyInput() {
      // 四件事都要做。原来只做了最后一件：
      //  - `stopFollow`：否则 `mode()` 说自由、Phaser 还在跟着她走；
      //  - `panEffect.reset`：否则一次 900ms 的导播平移会逐帧盖掉拖拽，
      //    玩家按住拖半天，镜头等平移跑完才跟手；
      //  - 丢掉还没给镜头看的事件、忘掉「这一档平移过」：否则再进导播时，
      //    镜头会先跳到一个已经过时的落点，或者干等一档不动；
      //  - 时钟回自由。
      if (following) cam.stopFollow();
      following = false;
      if (cam.panEffect.isRunning) cam.panEffect.reset();
      pendingEvent = null;
      lastPannedIndex = -1;
      clock.notifyInput();
    },

    viewportRect() {
      const zoom = cam.zoom;
      return {
        // 视野**左上角**在世界里的坐标，不是 `scrollX`——小地图的白框按它画。
        x: viewOriginOf(cam.scrollX, cam.width, zoom),
        y: viewOriginOf(cam.scrollY, cam.height, zoom),
        width: cam.width / zoom,
        height: cam.height / zoom,
      };
    },
  };
}
