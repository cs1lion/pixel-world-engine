/**
 * 台阶航段生成器（纯几何：不 import Phaser，也不看调色板）。
 *
 * 为什么要有这一层：街面石阶（4 级）与渡口踏步（3 级）原来是两段各自写死的
 * `for (step = 0; step < N; step += 1)`——坐标、级数、每级高都散在绘制函数里，
 * 改一级就得去读两处循环。这一层只回答「台阶在哪、几级、每级多大、总高差多少」，
 * 画什么颜色、压哪条亮边仍由各自的绘制函数决定。
 *
 * 两处调用的形制差异用一个参数表达：渡口踏步每向东下一级就向左收 3px（右沿钉在
 * 堤头不动），街面石阶不内缩。`run` 就是每级的内缩量，`insetSide` 是收哪一侧。
 *
 * 锚点（`topY` / `footY`）现在还没有消费方（阶段 2 的分层高度才要用它把人物、
 * 灯笼挂到某一级的阶面上），但**先写进类型并单测**：等有人要消费时再补一套
 * 「台阶画到哪」的口径，等于要重画一遍。
 */

export type StairInsetSide = 'left' | 'right';

export interface StairFlightParams {
  /** 第一级踏步的左上角。 */
  readonly x: number;
  /** 第一级踏步的顶边（= 航段最高处的阶面）。 */
  readonly y: number;
  /** 第一级踏步的宽度；有内缩时逐级变窄。 */
  readonly width: number;
  /** 级数（≥1）。 */
  readonly treads: number;
  /** 每级高度，同时也是每级踏步的厚度（≥1）。 */
  readonly rise: number;
  /** 每级向收分一侧内缩的像素（≥0，缺省 0 = 直上直下）。 */
  readonly run?: number;
  /** 收分方向：`left` = 左沿逐渐右移、右沿不动（渡口踏步）；缺省 `left`。 */
  readonly insetSide?: StairInsetSide;
}

export interface StairTread {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** 这一级的阶面边线（= `y`）。 */
  readonly topY: number;
  /** 这一级的落脚边线（= `y + height`）。 */
  readonly footY: number;
}

export interface StairFlight {
  readonly x: number;
  readonly y: number;
  /** 第一级的宽度（不是整体包围盒宽度）。 */
  readonly width: number;
  readonly treads: readonly StairTread[];
  /** 航段最高的阶面（首级顶边）。 */
  readonly topY: number;
  /** 航段最低的落脚线（末级底边）。 */
  readonly footY: number;
  /** 总高差 = `footY - topY` = 级数 × 每级高。 */
  readonly totalRise: number;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`stairFlight: ${name} 必须是有限数（收到 ${value}）`);
}

function assertIntegerAtLeast(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`stairFlight: ${name} 必须是 ≥${min} 的整数（收到 ${value}）`);
  }
}

/**
 * 生成一段台阶：自上而下逐级给出踏步矩形与上/下边线锚点。
 *
 * 内缩只改**其中一条边**，另一条边保持 `x` 或 `x + width`——渡口踏步就是这样
 * 钉在堤头的。收分到宽度 ≤ 0 直接抛，不画负宽度的台阶。
 */
export function stairFlight(params: StairFlightParams): StairFlight {
  const { x, y, width, treads, rise } = params;
  const run = params.run ?? 0;
  const insetSide = params.insetSide ?? 'left';
  assertFinite('x', x);
  assertFinite('y', y);
  assertFinite('width', width);
  assertIntegerAtLeast('treads', treads, 1);
  assertIntegerAtLeast('rise', rise, 1);
  assertIntegerAtLeast('run', run, 0);
  if (width <= 0) throw new Error(`stairFlight: width 必须 > 0（收到 ${width}）`);

  const lastWidth = width - run * (treads - 1);
  if (lastWidth <= 0) {
    throw new Error(
      `stairFlight: ${treads} 级、每级内缩 ${run}px 会把第一级宽 ${width}px 收成 ${lastWidth}px`,
    );
  }

  const list: StairTread[] = [];
  for (let index = 0; index < treads; index += 1) {
    const treadX = insetSide === 'left' ? x + run * index : x;
    const treadWidth = width - run * index;
    const treadY = y + rise * index;
    list.push({
      index,
      x: treadX,
      y: treadY,
      width: treadWidth,
      height: rise,
      topY: treadY,
      footY: treadY + rise,
    });
  }

  return {
    x,
    y,
    width,
    treads: list,
    topY: y,
    footY: y + treads * rise,
    totalRise: treads * rise,
  };
}
