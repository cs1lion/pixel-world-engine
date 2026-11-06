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

/**
 * 一条踩踏痕。字段与 `WorldSnapshot['trails'][number]` 同名同义。
 *
 * 它是**只增不减**的累积字段（强度 2 起才可见），所以它读的是「冻结那一刻
 * 世界已经走过多少路」，而不是「现在几点」。四钉/五钉都钉不住它：等到 2800ms
 * 再冻，格 (49,36) 就多出一条痕，画面在同一位置差 64px。
 */
export interface TrailPin {
  readonly at: Vec2;
  readonly strength: number;
}

export interface ShotPin {
  readonly nowMs: number | null;
  readonly tideLevel: number | null;
  /** 第五枚钉：空数组 = 不钉角色（默认路径，与只有四钉时逐字节相同）。 */
  readonly actors: readonly ActorPin[];
  /** 第六枚钉：空数组 = 不钉地面痕迹（同上，默认路径不改行为）。 */
  readonly trails: readonly TrailPin[];
}

/** 未钉住：呈现值全部回落到世界快照。 */
export const NO_SHOT_PIN: ShotPin = Object.freeze({
  nowMs: null,
  tideLevel: null,
  actors: Object.freeze([]),
  trails: Object.freeze([]),
});

/** 空角色集合：解钉时复用同一个对象，默认路径不多一次分配。 */
const NO_ACTORS: readonly ActorPin[] = NO_SHOT_PIN.actors;
/** 空痕迹集合，同上。 */
const NO_TRAILS: readonly TrailPin[] = NO_SHOT_PIN.trails;

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

// ------------------------------------------------------------- 第六枚钉：地面痕迹

export function isTrailPinValid(trail: TrailPin): boolean {
  if (typeof trail.at?.x !== 'number' || !Number.isFinite(trail.at.x)) return false;
  if (typeof trail.at?.y !== 'number' || !Number.isFinite(trail.at.y)) return false;
  if (!Number.isInteger(trail.strength) || trail.strength < 1) return false;
  return true;
}

function sameTrail(a: TrailPin, b: TrailPin): boolean {
  return a.at.x === b.at.x && a.at.y === b.at.y && a.strength === b.strength;
}

/**
 * 钉住地面痕迹。非法条目逐条丢弃；空列表等价于解钉。
 *
 * 为什么要钉整张表而不只钉「今天已有的那几条」：痕迹是**只增不减**的，晚冻
 * 45 s 就会多一条。只钉旧的那几条、让新的漏进来，等于没钉。
 */
export function pinTrails(prev: ShotPin, trails: readonly TrailPin[]): ShotPin {
  const clean = trails.filter(isTrailPinValid);
  if (clean.length === 0) return prev.trails.length === 0 ? prev : unpinTrails(prev);
  if (clean.length === prev.trails.length && clean.every((trail, i) => sameTrail(trail, prev.trails[i]!))) {
    return prev;
  }
  return { ...prev, trails: clean };
}

/** 只解地面痕迹这一枚：时刻、潮位、角色保持钉住。 */
export function unpinTrails(prev: ShotPin): ShotPin {
  if (prev.trails.length === 0) return prev;
  return { ...prev, trails: NO_TRAILS };
}

/**
 * 把痕迹钉覆盖到渲染用的那份快照上。空钉时原样返回（默认路径零拷贝），
 * 否则返回浅拷贝，世界快照本身一个字节不动。
 */
export function pinnedTrailsOf(pin: ShotPin, snapshot: WorldSnapshot): WorldSnapshot {
  if (pin.trails.length === 0) return snapshot;
  return { ...snapshot, trails: pin.trails };
}

// --------------------------------------------------- 渲染输入全集（不是又补一枚钉）

/**
 * 渲染读到的世界字段登记表。
 *
 * 为什么要有这张表：`trails` 是「冻结哪一刻没定义清楚」暴露出来的第二个洞——
 * 补完它还会有下一个。与其等下一个，不如把 `WorldSnapshot` 的每个字段一次性
 * 定性：**画面上读它吗、它随世界时刻变吗、怎么处置**。守卫测试拿真实快照
 * 的键与这张表对账，将来 `types.ts` 加了新字段而这里没登记，直接判红。
 *
 * `pin`  = 已并进 shot pin（`pinKey` 指向 `ShotPin` 上的那一格）；
 * `stable` = 画面读它，但它不随世界时刻变（证据：三档冻结快照逐字段 diff 为 0），
 *            因此「冻在哪一刻」不影响它，无需再钉；
 * `dom`   = 绘制路径不读，只进 DOM / 神谕 / 日报（证据：整组置空后像素 0 差）。
 *
 * ⚑ `stable` **不是通用结论，只对本场景成立**。它由「本夹具的机器状态」背书：
 * 工位全 idle、无在建、无道具/氛围实体。语义上会随世界时刻走的字段一旦在别的
 * 场景变成非空/在产（典型：`workstations[].progress`、`constructions[].remainingMs`），
 * **必须钉**，不能继续拿 stable 当免钉理由。守卫测试只保证字段被登记，不保证
 * 登记时的前提永远成立——换场景必须重新跑三档快照 diff。
 */
export type RenderInputHandling = 'pin' | 'stable' | 'dom';

export interface RenderInputEntry {
  readonly field: keyof WorldSnapshot;
  /** 哪个绘制函数读它（`-` = 绘制路径不读）。 */
  readonly reader: string;
  readonly handling: RenderInputHandling;
  /** `handling === 'pin'` 时，对应 `ShotPin` 上的格子。 */
  readonly pinKey?: keyof ShotPin;
  readonly note: string;
}

export const RENDER_INPUT_TABLE: readonly RenderInputEntry[] = Object.freeze([
  { field: 'now', reader: 'presentedNowOf / phaseInputOf / weatherView', handling: 'pin', pinKey: 'nowMs', note: '呈现时刻：昼夜、鸟、灯、潮都由它派生' },
  { field: 'tide', reader: 'sim.environment() → tideView / settingScenery', handling: 'pin', pinKey: 'tideLevel', note: '画面读 env.tideLevel（= tide.level），经 shot pin 覆写' },
  { field: 'villagers', reader: 'updateVillager / drawVillagerGroundShadow / overlay.sync', handling: 'pin', pinKey: 'actors', note: '钉 pos/facing/mode/walking/frame/visible；子字段 bubble 只进 DOM、lampOil 是凭证' },
  { field: 'trails', reader: 'decor.syncTrails', handling: 'pin', pinKey: 'trails', note: '只增不减的累积字段：晚冻 45 s 就多一条' },
  { field: 'villager', reader: '-', handling: 'dom', note: '兼容字段（= villagers[0]），绘制路径不读' },
  { field: 'buildings', reader: 'syncBuildings / updateBuilding / refreshDecals', handling: 'stable', note: '楼是静态陈设：三档快照全等' },
  { field: 'startupBuildingIds', reader: '-', handling: 'dom', note: '只用于「这栋楼是不是这次造的」的日报口径' },
  { field: 'workstations', reader: 'updateBuilding / 烟囱发射器 / phase-view（在产亮窗）', handling: 'stable', note: '⚑ 仅因本场景 11 个工位全 idle 才 stable（三档快照全等）。在产时 progress 随时刻走，**必须钉**' },
  { field: 'constructions', reader: 'decor.syncScaffolds / drawScaffolds（remainingMs/totalMs）', handling: 'stable', note: '⚑ 仅因本场景无在建才 stable（空表无可比）。在建时 remainingMs 随时刻走，**必须钉**' },
  { field: 'props', reader: 'decor.syncProps', handling: 'stable', note: '地上的小物件：三档全等' },
  { field: 'critters', reader: 'decor.syncCritters', handling: 'stable', note: '氛围实体：本夹具 0' },
  { field: 'roads', reader: 'decor.redrawRoads', handling: 'stable', note: '石板路是静态陈设：三档全等' },
  { field: 'fog', reader: 'fogView（设定集图为 null）/ refreshRuins', handling: 'stable', note: '设定集图整张已探明，半径不变' },
  { field: 'harbor', reader: 'harborView.update', handling: 'stable', note: '本夹具 harbor=null（无渡口）' },
  { field: 'tasks', reader: '-', handling: 'dom', note: '状态行 / 队列 / 气泡文案' },
  { field: 'pending', reader: '-', handling: 'dom', note: '待派发神谕列表，只进 DOM' },
  { field: 'oracle', reader: '-', handling: 'dom', note: '神谕石板，只进 DOM' },
  { field: 'events', reader: '-', handling: 'dom', note: '事件流，只进 DOM' },
  { field: 'altar', reader: 'phase-view（祭坛光晕锚点 snapshot.altar.x/y）', handling: 'stable', note: '镇心坐标，世界运行时也恒定；置空会直接抛 null.x（已实测）' },
  { field: 'weather', reader: 'phase-view（firefliesVisible(snapshot.weather)）；statusLine 也读（DOM）', handling: 'stable', note: '晴天；三档冻结时刻同值。画面侧的雨幕/雾幕走 sim.weatherIntensity()，不走这个字段' },
  { field: 'faith', reader: '-', handling: 'dom', note: '状态行读数' },
  { field: 'deliveries', reader: '-', handling: 'dom', note: '状态行读数' },
  { field: 'deliveriesByVillager', reader: '-', handling: 'dom', note: '日报读数' },
  { field: 'deliveryFailures', reader: '-', handling: 'dom', note: '日报读数' },
  { field: 'feed', reader: 'statusLine（DOM）', handling: 'dom', note: '上游连接状态，只进 DOM' },
]);

/**
 * 守卫：快照上出现了登记表里没有的字段 → 返回它们的名字（非空即判红）。
 *
 * 这条测试防的是**未来**：现在它是绿的，不代表它对；它保证的是
 * 「下一次 types.ts 加字段时，必须先回答『画面读不读、要不要钉』」。
 */
export function unregisteredRenderFields(snapshot: object): string[] {
  const known = new Set<string>(RENDER_INPUT_TABLE.map((entry) => entry.field));
  return Object.keys(snapshot).filter((key) => !known.has(key));
}

/** 守卫另一半：登记表里的字段必须真的存在于快照上（防止改名/删除后留死条目）。 */
export function missingRenderFields(snapshot: object): string[] {
  const present = new Set(Object.keys(snapshot));
  return RENDER_INPUT_TABLE.map((entry) => entry.field).filter((field) => !present.has(field));
}
