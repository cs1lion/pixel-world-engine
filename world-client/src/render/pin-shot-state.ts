/**
 * 截图呈现态夹具（纯逻辑，无 Phaser 依赖）。
 *
 * `SandboxScene` 把这几个值只用在「画什么」上：呈现时刻、潮位、昼夜层的入参、
 * 以及**每个角色这一帧要画成什么样**。世界快照、判据、存档一概不读它。
 * 抽成纯函数是为了能单测那些分支——场景本身在 Node 里造不出来（Phaser 是空壳）。
 *
 * 为什么有第五枚钉子（角色位置与姿态）：
 * 前四枚（时刻 / 潮位 / 相机 / 缩放）钉得住「世界在哪一刻」，钉不住「那一刻
 * 谁站在哪」。同一套四钉、同一份代码，只把冻结前的等待从 1200ms 改成 2800ms，
 * 角色就走了不同的路、换了不同的作息目标，画面在居民区差 4.55%。也就是说
 * 三跑 0 差是「等站定」等来的，不是钉出来的。第五枚把角色**画什么**钉死，
 * 等待时长才不再进入画面。
 */

import type { Facing, Vec2, VillagerMode, WorldSnapshot } from '../world/types.ts';

/** 一个角色这一帧要画成的样子。字段与 `VillagerSnapshot` 同名同义，只多一个 `frame`。 */
export interface ActorPin {
  readonly id: string;
  /** 格坐标（与世界快照的 `villager.pos` 同一口径，允许小数）。 */
  readonly pos: Vec2;
  readonly facing: Facing;
  /** 姿态升降（行礼下蹲 / 交付前倾）由 mode 决定，所以 mode 必须一起钉。 */
  readonly mode: VillagerMode;
  /** 决定取两帧待机还是四帧步态；帧数随之固定。 */
  readonly walking: boolean;
  /** 姿态帧号（0..frameCount-1）。钉住后不再由时刻与灯油重算。 */
  readonly frame: number;
  readonly visible: boolean;
}

export interface ShotPin {
  readonly nowMs: number | null;
  readonly tideLevel: number | null;
  /** 第五枚钉：空数组 = 不钉角色（默认路径，与只有四钉时逐字节相同）。 */
  readonly actors: readonly ActorPin[];
}

/** 未钉住：呈现值全部回落到世界快照。 */
export const NO_SHOT_PIN: ShotPin = Object.freeze({
  nowMs: null,
  tideLevel: null,
  actors: Object.freeze([]),
});

/** 空角色集合：解钉时复用同一个对象，默认路径不多一次分配。 */
const NO_ACTORS: readonly ActorPin[] = NO_SHOT_PIN.actors;

const FACINGS: readonly Facing[] = ['up', 'down', 'left', 'right'];

/**
 * 钉住呈现态。非有限值整条不生效（与 `SandboxScene` 原来的早退一致）：
 * 两路是同一帧的一对口径，只钉一半会让画面读成「按 A 时刻算的潮位」。
 *
 * 第五枚钉不在时保留原有的角色钉（`pinShotState` 不该顺手把 `pinActors`
 * 刚钉好的角色抹掉）。
 */
export function pinShot(prev: ShotPin, nowMs: number, tideLevel: number): ShotPin {
  if (!Number.isFinite(nowMs) || !Number.isFinite(tideLevel)) return prev;
  if (nowMs === prev.nowMs && tideLevel === prev.tideLevel) return prev;
  return { ...prev, nowMs, tideLevel };
}

/** 解钉：回到「全部读快照」。角色也一起解（`unpinShotState()` 无参复原）。 */
export function unpinShot(): ShotPin {
  return NO_SHOT_PIN;
}

export function isActorPinValid(actor: ActorPin): boolean {
  if (typeof actor.id !== 'string' || actor.id.length === 0) return false;
  if (typeof actor.pos?.x !== 'number' || !Number.isFinite(actor.pos.x)) return false;
  if (typeof actor.pos?.y !== 'number' || !Number.isFinite(actor.pos.y)) return false;
  if (!FACINGS.includes(actor.facing)) return false;
  if (typeof actor.mode !== 'string' || actor.mode.length === 0) return false;
  if (typeof actor.walking !== 'boolean') return false;
  if (!Number.isInteger(actor.frame) || actor.frame < 0) return false;
  if (typeof actor.visible !== 'boolean') return false;
  return true;
}

function sameActor(a: ActorPin, b: ActorPin): boolean {
  return (
    a.id === b.id &&
    a.pos.x === b.pos.x &&
    a.pos.y === b.pos.y &&
    a.facing === b.facing &&
    a.mode === b.mode &&
    a.walking === b.walking &&
    a.frame === b.frame &&
    a.visible === b.visible
  );
}

/**
 * 钉住角色。非法条目**逐条丢弃**，合法的照钉：一个人写错不该让整张构图退回
 * 「等站定」。空列表等价于解钉。
 */
export function pinActors(prev: ShotPin, actors: readonly ActorPin[]): ShotPin {
  const clean = actors.filter(isActorPinValid);
  if (clean.length === 0) return prev.actors.length === 0 ? prev : unpinActors(prev);
  if (clean.length === prev.actors.length && clean.every((actor, i) => sameActor(actor, prev.actors[i]!))) {
    return prev;
  }
  return { ...prev, actors: clean };
}

/** 只解角色这一枚：时刻与潮位保持钉住。 */
export function unpinActors(prev: ShotPin): ShotPin {
  if (prev.actors.length === 0) return prev;
  return { ...prev, actors: NO_ACTORS };
}

/** 画面上用的时刻。 */
export function presentedNowOf(pin: ShotPin, snapshotNow: number): number {
  return pin.nowMs ?? snapshotNow;
}

/** 画面上用的潮位。 */
export function presentedTideOf(pin: ShotPin, snapshotTide: number): number {
  return pin.tideLevel ?? snapshotTide;
}

/** 某个角色这一帧钉住的姿态帧号；没钉住返回 `null`（交给原路径按时刻采样）。 */
export function actorFrameOf(pin: ShotPin, id: string): number | null {
  return pin.actors.find((actor) => actor.id === id)?.frame ?? null;
}

/**
 * 把角色钉覆盖到渲染用的那份快照上。
 *
 * 只换**画什么**：位置、朝向、mode、walking、visible 五样。任务、路线、记忆、
 * 存档里那份 `this.snapshot` 一个字节不动；传进来的快照也不改，钉住时返回
 * 一份浅拷贝。空钉或没有一个 id 命中时原样返回（默认路径零拷贝）。
 *
 * `villager` 兼容字段必须与 `villagers[0]` 对齐——旧调用方读的是这一条。
 */
export function pinnedVillagersOf(pin: ShotPin, snapshot: WorldSnapshot): WorldSnapshot {
  if (pin.actors.length === 0) return snapshot;
  let changed = false;
  const villagers = snapshot.villagers.map((villager) => {
    const actor = pin.actors.find((item) => item.id === villager.id);
    if (actor === undefined) return villager;
    changed = true;
    return {
      ...villager,
      pos: actor.pos,
      facing: actor.facing,
      mode: actor.mode,
      walking: actor.walking,
      visible: actor.visible,
    };
  });
  if (!changed) return snapshot;
  return {
    ...snapshot,
    villagers,
    villager: villagers[0] ?? snapshot.villager,
  };
}

/**
 * 昼夜层入参：钉住时给快照一份同值拷贝，免得「按 12:30 算的鸟、按真实时刻
 * 算的暗角」对不上；未钉住时原样返回（默认路径零拷贝，逐字节不变）。
 */
export function phaseInputOf<T extends { now: number }>(pin: ShotPin, snapshot: T): T {
  if (pin.nowMs === null) return snapshot;
  return { ...snapshot, now: pin.nowMs };
}
