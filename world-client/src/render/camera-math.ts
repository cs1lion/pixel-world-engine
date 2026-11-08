/** 相机的纯数学：缩放档位与边界夹取。不 import Phaser，可离线测。
 *
 * 抽出来的理由：这些是"会不会出现像素撕裂""镜头会不会飘出世界"的判定，
 * 必须能脱离浏览器反复验算；塞进场景里就只能靠肉眼。
 */

/** 允许的缩放档位。全是整数或半整数，保证像素对齐。 */
export const ZOOM_STEPS: readonly number[] = [1, 1.5, 2, 3];

/** 自动导播：多久没碰鼠标就接管。 */
export const DIRECTOR_IDLE_MS = 15_000;
/** 导播每次停留多久再切下一个目标。 */
export const DIRECTOR_DWELL_MS = 12_000;

/** 把档位索引夹在合法范围内。 */
export function stepZoomIndex(index: number, direction: 1 | -1): number {
  return Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + direction));
}

export function zoomAtStep(index: number): number {
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index))]!;
}

/**
 * 相机 scroll 与「视野左上角在世界里的坐标」之间的换算。
 *
 * Phaser 的 `worldView.x = scrollX + width/2 - width/(2*zoom)`：scroll 是**镜头中心**
 * 的滚动量，而视野左上角要减掉半个视野。只有 `zoom === 1` 时两者相等——
 * 480 宽的画布在 2 倍下差 120 世界像素。
 *
 * 这个差是 `world-overlay.ts` 里名字与气泡错位的根因：那一处一直把 `scrollX`
 * 当原点传下去，于是放大到 2 倍时整层 DOM 文字偏了半个画布。改成用这个函数
 * 现算，而不是改用 `camera.worldView`——后者由相机的 preRender 更新，而场景
 * 的 update 在它之前跑，开局第一帧会拿到 (0,0)。
 */
export function viewOriginOf(scroll: number, viewportSize: number, zoom: number): number {
  return scroll + viewportSize / 2 - viewportSize / (2 * zoom);
}

/** `viewOriginOf` 的反函数：要把视野原点摆到 `origin`，scroll 该是多少。 */
export function scrollForOrigin(origin: number, viewportSize: number, zoom: number): number {
  return origin - viewportSize / 2 + viewportSize / (2 * zoom);
}

/**
 * 换倍率时把**屏幕上某一点下的世界坐标**钉住：捏合缩放以两指中点为锚。
 *
 * 不好用 `scrollForOrigin` 硬凑：那个函数守的是视野原点（左上角），而捏合要守的
 * 是两指中间那一点。屏幕 `screen` 处的世界坐标是
 * `scroll + size/2 - size/(2z) + screen/z`；让它在新倍率下相等，解出新的 scroll。
 *
 * 只在**世界边界内**才等价：夹到边界时锚点不得不漂，这是边界本身的性质，
 * 不是算错（`camera-controller.ts` 换完 scroll 仍要夹一次）。
 */
export function scrollForZoomAnchor(
  scroll: number,
  viewportSize: number,
  fromZoom: number,
  toZoom: number,
  screen: number,
): number {
  // 展开后的等价式：`(1/to - 1/from) * (size/2 - screen)`。
  // 不写成 `size/(2to) - size/(2from) + screen/from - screen/to`——那四项各自
  // 带舍入，中间锚点（screen = size/2）本该正好抵消，实测却算出 423.99999999999994，
  // 再被 `roundPixels` 的地板压成 423，凭空漂 1 世界px。写成差值形式，
  // 中点处是严格的 0。
  return scroll + (1 / toZoom - 1 / fromZoom) * (viewportSize / 2 - screen);
}

/**
 * 夹取**视野原点**（不是 `scrollX`）。
 *
 * `viewportWidth/Height` 是**画布**尺寸（逻辑像素），缩放后覆盖的世界范围是
 * 它除以 zoom。世界比视野小时贴左上，不出现负偏移——否则会看到世界外的空白。
 *
 * **定义域是原点。** 早先 `camera-controller.ts` 的 `zoomStep` 把 `cam.scrollX`
 * 喂进来，两者在 zoom≠1 时差半个视野，于是放大到 2 倍会多露出 120 像素的边界外。
 * `test/camera.test.ts` 那四条数值在原点口径下全部成立，所以那组测试并没有钉住
 * 错误——错的是调用方用错了函数的定义域。
 */
export function clampScroll(
  x: number,
  y: number,
  worldWidth: number,
  worldHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): { x: number; y: number } {
  const spanX = viewportWidth / zoom;
  const spanY = viewportHeight / zoom;
  const maxX = Math.max(0, worldWidth - spanX);
  const maxY = Math.max(0, worldHeight - spanY);
  return {
    x: Math.max(0, Math.min(maxX, x)),
    y: Math.max(0, Math.min(maxY, y)),
  };
}

export type DirectorMode = 'free' | 'director';

/**
 * 平移动画的第 `t`（0..1）步落点：整数世界像素。
 *
 * 曲线是 `Sine.easeInOut`：`-0.5 * (cos(πt) - 1)`，与 `cam.pan` 默认的那条同形。
 * **取整发生在插值之后**——先算浮点落点再 `Math.round`，而不是先取整起终点。
 * 这样 0 与 1 两端仍然是精确的起终点，中间每一步都真的是一个整数像素：
 * 逐帧把 `scroll` 插成浮点再让 `roundPixels` 取整，会出现「两帧停在同一像素、
 * 第三帧跳两格」的顿感，正是要改掉的东西。
 */
export function panCenterAt(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  t: number,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const eased = -0.5 * (Math.cos(Math.PI * clamped) - 1);
  return {
    x: Math.round(fromX + (toX - fromX) * eased),
    y: Math.round(fromY + (toY - fromY) * eased),
  };
}

/**
 * 导播计时：闲置多久接管、接管后多久换一个目标。
 *
 * 抽成纯逻辑是因为这些规则最容易写错，而它们又必须脱离浏览器反复验：
 * 「刚进来就接管」和「用户一动还抢镜头」都是很烦人的行为。
 */
export function createDirectorClock(idleMs: number, dwellMs: number): {
  mode(): DirectorMode;
  enable(): void;
  disable(): void;
  /** 立刻接管，不等闲置计时。显式的「导播」按钮走这条。 */
  force(): void;
  notifyInput(): void;
  tick(deltaMs: number): void;
  targetIndex(): number;
} {
  let registered = false;
  let mode: DirectorMode = 'free';
  let idle = 0;
  let dwell = 0;
  let index = 0;

  return {
    mode: () => mode,
    enable() {
      registered = true;
      idle = 0;
      if (mode === 'director') dwell = dwellMs;
    },
    disable() {
      registered = false;
      if (mode === 'director') mode = 'free';
    },
    force() {
      if (!registered) return;
      mode = 'director';
      dwell = 0;
      idle = 0;
    },
    notifyInput() {
      idle = 0;
      if (mode === 'director') mode = 'free';
    },
    tick(deltaMs) {
      if (mode === 'director') {
        dwell += deltaMs;
        if (dwell >= dwellMs) {
          dwell = 0;
          index += 1;
        }
        return;
      }
      if (!registered) return;
      idle += deltaMs;
      if (idle >= idleMs) {
        mode = 'director';
        // 从 0 起算，不是 `dwellMs`。
        //
        // 原来是 `dwellMs`，意思是「进来立刻切一次」——可控制器本来就会在进入
        // 导播的那一帧挑 `list[0]` 平移过去，而下一帧 dwell 到点又把 index
        // 推一格，于是 `list[0]` 只出现一帧就被 `list[1]` 强制作废。
        // 优先级最高的目标（正在忙的人）恰恰是这一个。从 0 起算，它就能停满
        // 一个完整的 `dwellMs`。
        dwell = 0;
        idle = 0;
      }
    },
    targetIndex: () => index,
  };
}
