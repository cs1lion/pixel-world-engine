/** 小人动画采样：12fps，帧号只由 simulation 时间（`WorldSnapshot.now`）决定。
 *
 * 为什么单独一个文件：这里的逻辑必须是纯函数，测试能直接用 node 加载；
 * `villager.ts` 引了 Phaser，在 node 下加载不了，所以把“帧号/整数像素”摘出来。
 *
 * 纪律：
 *   - 帧号 = floor(now / (1000/12)) % 帧数，与 rAF、帧率、掉帧都无关；
 *   - 所有偏移都是整数像素，没有逐帧浮点晃动；
 *   - 只做姿态，不新增颜色、不 tint、不改仿真。
 */

import type { VillagerMode } from '../world/types.ts';
import { LAMP_DRY } from '../world/lampoil.ts';

export const ANIM_FPS = 12;
export const FRAME_MS = 1000 / ANIM_FPS;

/** 待机 2 帧：呼吸一上一下（整数像素）。 */
export const IDLE_FRAMES = 2;
/** 走路 4 帧：左右脚交替前伸 + 1px 起伏。 */
export const WALK_FRAMES = 4;

export interface VillagerPose {
  /** 当前帧号（0..frameCount-1）。 */
  readonly frame: number;
  readonly frameCount: number;
  /** 整体上下偏移，整数像素（呼吸/走路起伏/行礼）。 */
  readonly offsetY: number;
  /** 左脚前伸，整数像素（-1/0/1）。 */
  readonly footLeft: number;
  /** 右脚前伸，整数像素（-1/0/1）。 */
  readonly footRight: number;
}

/** simulation 时间 → 12fps 的步号。负数也能稳定回绕。 */
export function animStep(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  return Math.floor(nowMs / FRAME_MS);
}

/** simulation 时间 + 帧数 → 帧号。同一时间必得同一帧号，与渲染时机无关。 */
export function animFrame(nowMs: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  const step = animStep(nowMs);
  return ((step % frameCount) + frameCount) % frameCount;
}

/** 整数像素取整：位置只允许整数像素，禁止子像素抖动。
 *
 * `Math.round(-0.5)` 会返回 `-0`（`Object.is(-0, 0) === false`，`strictEqual` 会红），
 * 这里把 `-0` 归一成 `0`；两种写法在像素上是同一个值。
 */
export function pixelAt(worldPx: number): number {
  const rounded = Math.round(worldPx);
  return rounded === 0 ? 0 : rounded;
}

const IDLE_POSES: readonly Omit<VillagerPose, 'frame' | 'frameCount'>[] = [
  { offsetY: 0, footLeft: 0, footRight: 0 },
  { offsetY: 1, footLeft: 0, footRight: 0 },
];

const WALK_POSES: readonly Omit<VillagerPose, 'frame' | 'frameCount'>[] = [
  { offsetY: 0, footLeft: 1, footRight: 0 },
  { offsetY: 1, footLeft: 0, footRight: 1 },
  { offsetY: 0, footLeft: -1, footRight: 0 },
  { offsetY: 1, footLeft: 0, footRight: -1 },
];

/** 表情/动作本身带的整数偏移：行礼下蹲 2px、交付前倾 1px。 */
function modeLift(mode: VillagerMode): number {
  if (mode === 'saluting') return -2;
  if (mode === 'delivering') return -1;
  return 0;
}

/**
 * 某一时刻的姿态。纯函数：同参数 → 同结果，不读时钟、不写外部状态。
 *
 * `walking` 是快照里那个派生字段（`VillagerSnapshot.walking`），不是 mode。
 * 曾经这儿自己列了一张「哪些 mode 算在走」的表（`isWalkingMode` =
 * `toWork|toAltar|sheltering`），于是走作息环线的人——她的 mode 是 `'idle'`——
 * 一路在滑，腿上放的还是站着的那两帧；举急件的那位（`'bearingDecree'`）同理。
 * **表会漏，路不会**：走路这件事由 `path` 说，不由 mode 说。
 */
export function villagerPose(
  mode: VillagerMode,
  walking: boolean,
  nowMs: number,
): VillagerPose {
  const frames = walking ? WALK_POSES : IDLE_POSES;
  const frame = animFrame(nowMs, frames.length);
  const base = frames[frame] as Omit<VillagerPose, 'frame' | 'frameCount'>;
  return {
    frame,
    frameCount: frames.length,
    offsetY: base.offsetY + modeLift(mode),
    footLeft: base.footLeft,
    footRight: base.footRight,
  };
}

// ---------------------------------------------------------------- 关键姿势调度
//
// 这一节是「什么时候用哪一帧」的唯一出口。**帧集本身不变**：走路仍是
// `WALK_POSES` 四张、干活与待机仍是 `IDLE_POSES` 两张；改的是序列编排。
//
// 编排用三样东西表达节奏，全部落在世界拍（1 拍 = 1/12 秒）上：
//   - 预备（intro）：起步/开工前先停在起势帧上，蓄一下；
//   - 关键姿势的 hold（loop 里连续两拍同一帧）：落脚/落铲那一下要停住，
//     否则四帧均匀轮转读成「滑」；
//   - 收招/缓冲（outro）：停步/收工后按上一套动作的最后两拍收尾，再回待机。
//
// 所有帧号仍来自现有帧集，不新增素材、不新增色值。

/** 关键姿势保持拍数。两拍 = 1/6 秒，是「看得出停住」的最小整数拍。 */
export const MOTION_HOLD_BEATS = 2;
/** 预备拍数。 */
export const MOTION_INTRO_BEATS = 2;
/** 收招/缓冲拍数。 */
export const MOTION_OUTRO_BEATS = 2;
/**
 * 打断记录的保鲜期（48 拍 = 4 秒）。超过这个时长再回到同一个活，算重新开工，
 * 重播预备；否则一次上午的打断会黏到下午。
 */
export const MOTION_INTERRUPT_RESUME_BEATS = 48;

export type MotionKind = 'idle' | 'walk' | 'work';

export interface MotionSequence {
  readonly kind: MotionKind;
  /** 起步/开工的预备帧（按拍逐个取）。 */
  readonly intro: readonly number[];
  /** 循环段。同一帧连续出现即 hold。 */
  readonly loop: readonly number[];
  /** 停步/收工的缓冲帧。 */
  readonly outro: readonly number[];
  /** 关键姿势帧号；-1 表示这套动作没有关键姿势。 */
  readonly keyFrame: number;
  /** 关键姿势在循环里连续保持的拍数。 */
  readonly keyHoldBeats: number;
}

/**
 * 三套序列。挑帧的依据只有一条：**旧帧集里哪张最能读成「起势/落定」**。
 *   - walk：2 号是「后脚蹬地」的起势，拿来当预备；0 号是前脚落地，当关键姿势停两拍；
 *     3 号是收步，两拍缓冲后回待机。
 *   - work：0 号（身体直起）当预备，1 号（下压/抬手，动作矩形里 bob=1）停两拍当关键姿势；
 *     收工时 0→1 两拍是「把工具放下」的读感。
 *   - idle：呼吸两帧，不设关键姿势，也不加预备/收招——站着不该有起势。
 */
export const MOTION_SEQUENCES: Readonly<Record<MotionKind, MotionSequence>> = {
  walk: {
    kind: 'walk',
    intro: [2, 2],
    loop: [0, 0, 1, 2, 3],
    outro: [3, 2],
    keyFrame: 0,
    keyHoldBeats: MOTION_HOLD_BEATS,
  },
  work: {
    kind: 'work',
    intro: [0, 0],
    loop: [1, 1, 0],
    outro: [0, 1],
    keyFrame: 1,
    keyHoldBeats: MOTION_HOLD_BEATS,
  },
  idle: {
    kind: 'idle',
    intro: [],
    loop: [0, 1],
    outro: [],
    keyFrame: -1,
    keyHoldBeats: 0,
  },
};

/** 动作类别的判据与旧代码同源：走路看脚下那条路，干活看 mode。 */
export function motionKindOf(mode: VillagerMode, walking: boolean): MotionKind {
  if (walking) return 'walk';
  if (mode === 'working') return 'work';
  return 'idle';
}

export interface MotionFrame {
  readonly kind: MotionKind;
  /** 帧集内的帧号。 */
  readonly frame: number;
  readonly frameCount: number;
  /** 这一拍是不是「与上一拍同一帧」。 */
  readonly hold: boolean;
  /** 这一拍是不是关键姿势。 */
  readonly keyPose: boolean;
  /** 在整套序列里的拍号（预备为负偏移，循环从 0 起）。 */
  readonly phaseBeat: number;
}

function sequenceFrame(kind: MotionKind, phaseBeat: number, previousFrame: number | null): MotionFrame {
  const sequence = MOTION_SEQUENCES[kind];
  const intro = sequence.intro;
  const loop = sequence.loop;
  const outro = sequence.outro;
  let frame: number;
  if (phaseBeat < 0) {
    // 负拍号是收招段：`-1` 取 outro 最后一帧，`-outro.length` 取第一帧。
    frame = outro[Math.max(0, outro.length + phaseBeat)] ?? loop[0] ?? 0;
  } else if (phaseBeat < intro.length) {
    frame = intro[phaseBeat] as number;
  } else {
    const index = phaseBeat - intro.length;
    frame = loop[index % loop.length] as number;
  }
  return {
    kind,
    frame,
    frameCount: kind === 'walk' ? WALK_FRAMES : IDLE_FRAMES,
    hold: previousFrame !== null && previousFrame === frame,
    keyPose:
      sequence.keyFrame >= 0 &&
      frame === sequence.keyFrame &&
      phaseBeat >= intro.length,
    phaseBeat,
  };
}

/**
 * 有状态的序列播放器：一个村民一个，只活在渲染层。
 *
 * 状态只由世界拍推进：同一串快照、同一串拍号 → 同一串帧号。渲染掉帧不会
 * 改写世界，只会让「检测到起步的那一拍」晚一点；这一点在
 * `docs/evidence/animation-express/PROGRESS.md` 里如实记着。
 */
export class MotionTracker {
  private kind: MotionKind | null = null;
  private phaseBeat = 0;
  /** 收招段播完后要切到的动作；`null` 表示没有挂起的切换。 */
  private pendingKind: MotionKind | null = null;
  /** 被别的动作打断时记下的「原拍」：回来时从这一拍续上，不重新起势。 */
  private interrupted: { readonly kind: MotionKind; readonly loopPhase: number; readonly beat: number } | null =
    null;
  private lastBeat = -1;
  private lastFrame: number | null = null;
  private lastSample: MotionFrame | null = null;

  /** 第 `beat` 拍的动作帧。同一拍重复调用返回同一个结果（冻结帧不抖）。 */
  sample(mode: VillagerMode, walking: boolean, beat: number): MotionFrame {
    if (beat === this.lastBeat && this.lastSample !== null) return this.lastSample;
    const desired = motionKindOf(mode, walking);
    // 拍号只前进不后退。渲染跳过的拍按「最多补 8 拍」推进，防止长时间
    // 后台后一帧里把整段序列瞬移过去。
    const delta = this.lastBeat < 0 ? 1 : Math.max(1, Math.min(8, beat - this.lastBeat));

    if (this.kind === null) {
      this.kind = desired;
      this.phaseBeat = 0;
    } else if (this.pendingKind !== null) {
      // 正在播上一套动作的收招段。
      this.phaseBeat += delta;
      if (this.phaseBeat >= 0) {
        this.kind = this.pendingKind;
        this.pendingKind = null;
        this.phaseBeat = 0;
      }
    } else if (desired !== this.kind) {
      if (
        this.interrupted !== null &&
        this.interrupted.kind === desired &&
        beat - this.interrupted.beat <= MOTION_INTERRUPT_RESUME_BEATS
      ) {
        // 原动作回来了：跳过重播预备，直接从被记下的那一拍续上。
        this.kind = desired;
        this.phaseBeat = MOTION_SEQUENCES[desired].intro.length + this.interrupted.loopPhase;
        this.interrupted = null;
      } else {
        // 只有「干活」算被任务打断；起步/停步不算，停步后重新起步仍要预备。
        if (this.kind === 'work' && this.interrupted === null) {
          this.interrupted = { kind: this.kind, loopPhase: this.loopPhaseOf(this.kind), beat };
        }
        const outro = MOTION_SEQUENCES[this.kind].outro;
        if (outro.length > 0) {
          this.pendingKind = desired;
          this.phaseBeat = -outro.length;
        } else {
          this.kind = desired;
          this.phaseBeat = 0;
        }
      }
    } else {
      this.phaseBeat += delta;
      if (this.interrupted !== null && this.interrupted.kind === this.kind) {
        this.interrupted = null;
      }
    }

    const sample = sequenceFrame(this.kind, this.phaseBeat, this.lastFrame);
    this.lastBeat = beat;
    this.lastFrame = sample.frame;
    this.lastSample = sample;
    return sample;
  }

  private loopPhaseOf(kind: MotionKind): number {
    const intro = MOTION_SEQUENCES[kind].intro.length;
    const loop = MOTION_SEQUENCES[kind].loop.length;
    if (loop === 0) return 0;
    const index = this.phaseBeat - intro;
    return ((index % loop) + loop) % loop;
  }

  /** 当前这一拍的帧（只读，供调试口与证据脚本）。还没采过样时为 null。 */
  current(): MotionFrame | null {
    return this.lastSample;
  }
}

/**
 * 某一时刻的姿态（带序列调度）。`tracker === null` 时退化成「只看世界拍的循环」，
 * 供纯函数证据脚本逐拍比对；渲染路径始终有 tracker。
 */
export function villagerMotionPose(
  mode: VillagerMode,
  walking: boolean,
  nowMs: number,
  tracker: MotionTracker | null,
): VillagerPose {
  const kind = motionKindOf(mode, walking);
  let frame: number;
  if (tracker === null) {
    const loop = MOTION_SEQUENCES[kind].loop;
    frame = loop[animStep(nowMs) % loop.length] as number;
  } else {
    frame = tracker.sample(mode, walking, animStep(nowMs)).frame;
  }
  const frames = kind === 'walk' ? WALK_POSES : IDLE_POSES;
  const base = frames[frame % frames.length] as Omit<VillagerPose, 'frame' | 'frameCount'>;
  return {
    frame,
    frameCount: frames.length,
    offsetY: base.offsetY + modeLift(mode),
    footLeft: base.footLeft,
    footRight: base.footRight,
  };
}

/**
 * 灯油余量 → 画面上取样的时间。
 *
 * 设定里「灯暗时角色发灰、动作变慢」是**观感**，不是世界规则：角色该走多快由
 * simulation 决定。所以这里只把动画采样的时刻向后拖，位置、寻路、任务一概不碰。
 * 油干时隔 4 帧取一次样（约 3fps），看得出疲惫；油量正常时原样返回，不改变
 * 已验证的 12fps 动作。
 *
 * 阈值 `LAMP_DRY` 住在 `world/lampoil.ts`：它是油量的属性，不是采样的属性。
 * 这个文件在渲染层，往世界层借一个常量比在这儿再抄一份强。
 */
export function lampAnimationTime(lampOil: number, nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  if (!(lampOil < LAMP_DRY)) return nowMs;
  return Math.floor(nowMs / 400) * 400;
}
