/** 烟的动态层：主楼烟囱与炉底烟囱的烟，从"整柱平移"改成"分段漂移 + 消散"。
 *
 * 与灯街、摊位同一套口径：**只读世界时刻**，表驱动整数动画，不读墙钟、不存上一帧。
 *
 * 三个烟团一段比一段跑得快（15 / 10 / 7 世界秒一拍），越往上越宽、越淡——
 * 这就是"至少两段不同速度"与"消散"。三段的横漂上限也不同（2 / 4 / 6 px），
 * 所以柱子不会整体平移，而是边升边散。
 *
 * 烟画在**楼体之下**（详见 `setting-scenery.ts` 的分层注释）：楼体不透明的像素会盖住烟，
 * 烟因此不可能盖住楼体轮廓，也不可能"穿过"一面墙跑到墙前面去。
 */

export interface SmokeMotion {
  readonly drift: boolean;
}

export const SMOKE_MOTION_ON: SmokeMotion = { drift: true };

export const SMOKE_MOTION_OFF: SmokeMotion = { drift: false };

/** 每一拍的世界毫秒数（`worldSeconds(15)` = 15000 世界毫秒）。 */
const worldSeconds = (seconds: number): number => Math.round(seconds * 1000);

/** 横漂表：0..6 走一趟再回来，换算成各段的像素上限。 */
const DRIFT = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
/** 竖向抖动：-1..1 像素，让每一拍不是"整段上移一格"。 */
const WOBBLE = [0, 0, 1, 1, 0, -1, 0, 1, 0, -1, 0, 1];
/** 消散：同段在不同拍上浓淡起伏，读成"烟在散"。 */
const FADE = [1, 0.86, 0.72, 0.9, 0.76, 1, 0.66, 0.88, 0.7, 0.94, 0.64, 0.82];

interface SmokeSegment {
  readonly stepMs: number;
  /** 横漂上限（像素）。 */
  readonly sway: number;
  /** 离烟囱口的升高（像素，向上为正）。 */
  readonly rise: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
}

/** 三段：近口慢而浓、中段快一档、上段最快也最淡。 */
const SEGMENTS: readonly SmokeSegment[] = [
  { stepMs: worldSeconds(15), sway: 2, rise: 4, width: 6, height: 7, alpha: 0.16 },
  { stepMs: worldSeconds(10), sway: 4, rise: 12, width: 10, height: 8, alpha: 0.12 },
  { stepMs: worldSeconds(7), sway: 6, rise: 20, width: 14, height: 8, alpha: 0.08 },
];

export interface SmokePuff {
  readonly dx: number;
  readonly dy: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
}

/** 每段一拍的世界毫秒数：15 / 10 / 7 秒，一段比一段快。 */
export function smokeSegmentStepMs(segment: number): number {
  return SEGMENTS[segment]?.stepMs ?? 0;
}

const beat = (worldNow: number, stepMs: number, offset: number, length: number): number => {
  const raw = Math.floor(worldNow / stepMs) + offset;
  return ((raw % length) + length) % length;
};

const pose = (segment: SmokeSegment, index: number): SmokePuff => {
  const drift = DRIFT[index] ?? 0;
  return {
    dx: Math.round((drift / 6) * segment.sway),
    dy: -segment.rise + (WOBBLE[index] ?? 0),
    // 漂得越远、摊得越宽：消散的形状，不只是位置在动。
    width: segment.width + (drift >= 4 ? 1 : 0),
    height: segment.height,
    alpha: segment.alpha * (FADE[index] ?? 1),
  };
};

/** 三个烟团的位置/大小/浓度。`order` 是烟囱的次序，错开相位免得两根烟囱同手同脚。 */
export function smokePuffsAt(worldNow: number, order: number): readonly SmokePuff[] {
  return SEGMENTS.map((segment, i) => {
    const index = beat(worldNow, segment.stepMs, order * 5 + i * 3, DRIFT.length);
    return pose(segment, index);
  });
}

/** 关掉漂移时的固定姿态：仍有烟，但海面一样静——t 与 t+Ns 的帧差必须是 0。 */
export function smokePuffsStill(): readonly SmokePuff[] {
  return SEGMENTS.map((segment) => pose(segment, 0));
}
