/** 唯一的 Phaser 场景。它只做三件事：把逻辑 tick 起来、把快照画出来、把输入转成命令。
 *
 * 世界逻辑全在 src/world/ 里，与 Phaser 无关；这里不判断"该不该开工"。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import { cellPlaceId, footfallPlace, type FootfallDoor } from '../world/ambient.ts';
import { drawGroundDecals } from '../render/decal.ts';
import { Simulation, type MiracleKind, type NewBuilding } from '../world/simulation.ts';
import type {
  CommandResult,
  GridPoint,
  OracleRecord,
  PrefabBlueprint,
  Vec2,
  Weather,
  WorldProp,
  WorldSnapshot,
} from '../world/types.ts';
import { beginPinchZoom, pinchZoomStep, type PinchZoomState } from '../render/pinch-zoom.ts';
import { villagerAtCell } from '../world/types.ts';
import { excerptBlockedQuestion } from '../world/types.ts';
import { placeBlueprint, type BuiltWorld } from '../world/setup.ts';
import { tokenNameOf } from '../world/palette-data.ts';
import { paletteFor, terrainFor, type WorldPalette } from '../world/theme.ts';
import { DAY_MS } from '../world/memory/config.ts';
import { MemoryRuntime } from '../world/memory/runtime.ts';
import { archiveMemoryText, type VillagerArchive } from '../world/villager-archive.ts';
import type { LandmarkEvent } from '../world/memory/landmark.ts';
import { SceneHistory, type RewindResult } from '../world/history/scene-history.ts';
import { createIdbHistoryStore } from '../world/history/store.ts';
import { observationOf } from '../world/memory/observe.ts';
import { memoryVoice } from '../world/memory/voice.ts';
import type { OracleApi } from '../ui/oracle-panel.ts';
import type { ClockStatusView, CreatorChecksView, DebugOracle } from '../ui/debug-panel.ts';
import type { ClockAlignOracle, ClockAlignmentView } from '../ui/clock-align.ts';
import {
  LONG_PRESS_MS,
  anchorCellOf,
  buildUnitStatus,
  longPressShouldFire,
  screenAnchorForCell,
  unitAtCell,
  type UnitMemoryReader,
  type UnitRef,
  type UnitStatusContent,
  type UnitStatusOracle,
  type UnitStatusView,
  type UnitStatusWorld,
} from '../ui/unit-status.ts';
import type { SaveOracle } from '../ui/save-store.ts';
import type { CameraOracle } from '../ui/camera-bar.ts';
import type { VillagerMemoryView, VillagerOracle } from '../ui/villager-panel.ts';
import type { SteleOracle, SteleView } from '../ui/stele-panel.ts';
import type { BuildingActivity, BuildingOracle, BuildingPanelView } from '../ui/building-panel.ts';
import { STELE_MAX_LINES, steleLines } from '../world/memory/stele.ts';

/**
 * 场景挂在 `window.Oracle` 上的那一面，每边消费者各要一个子集。
 *
 * 神谕面板要 `OracleApi`，调试面板要 `DebugOracle`，存档导入导出要 `SaveOracle`，
 * 取景按钮要 `CameraOracle`，村民面板要 `VillagerOracle`，碑与楼面板各要一个。
 * 没有一个子集是全的，
 * 所以挂载时按交集核一遍——见 `registerOracleApi()` 末尾。这些接口原先都只有
 * 消费侧一份声明，生产侧是推断，两边各写一次 `as unknown as`，中间没人对账。
 */
type OracleSurfaces = OracleApi &
  DebugOracle &
  SaveOracle &
  CameraOracle &
  VillagerOracle &
  SteleOracle &
  BuildingOracle &
  ClockAlignOracle &
  UnitStatusOracle;
import { drawTerrain } from '../render/tilemap.ts';
import { createBuilding, drawBuildingDecals, updateBuilding, type BuildingView } from '../render/buildings.ts';
import {
  createVillager,
  drawVillagerGroundShadow,
  updateVillager,
  VILLAGER_H,
  VILLAGER_W,
  villagerDepthAt,
  villagerFootAt,
  type VillagerView,
} from '../render/villager.ts';
import {
  GROUND_SHADOW_DEPTH,
  GROUND_SHADOW_MOTION_ON,
  groundShadowAt,
  type GroundShadowMotion,
} from '../world/ground-shadow.ts';
import { pinVillagers } from '../render/villager-pin.ts';
import { LAMP_MOTION_ON, ignitionSchedule, type LampMotion } from '../world/lamp-motion.ts';
import { STALL_MOTION_ON, type StallMotion } from '../world/stall-motion.ts';
import { BANNER_MOTION_ON, type BannerMotion } from '../world/banner-motion.ts';
import { SMOKE_MOTION_ON, type SmokeMotion } from '../world/smoke-motion.ts';
import { legacyLookFor, resolveLook } from '../world/villager-look.ts';
import { createWorldOverlay, type WorldOverlay } from '../render/world-overlay.ts';
import { createAccentEmitter, ensureAccentTextures, type AccentEmitter } from '../render/smoke.ts';
import { createWeatherView, type WeatherView } from '../render/weather.ts';
import { createWeatherFogView, type WeatherFogView } from '../render/weather-fog-view.ts';
import { createWeatherStallsView, type WeatherStallsView } from '../render/weather-stalls.ts';
import { FOG_VISIT_CELLS, stallsPackedFor } from '../world/weather-effects.ts';
import { weatherWitnessGroups, type WeatherHabitEntry } from '../world/weather-witness.ts';
import { WEATHER_LABEL } from '../world/weather.ts';
import { createTideView, type TideView } from '../render/tide-view.ts';
import { createHarborView, harborSiteOf, type HarborView } from '../render/harbor-view.ts';
import { withinHarborWitnessRange } from '../world/harbor.ts';
import { createPhaseView, type PhaseView } from '../render/phase-view.ts';
import { createAmbienceView, type AmbienceView } from '../render/ambience-view.ts';
import { createGhostView, type GhostView } from '../render/ghost.ts';
import {
  createCameraController,
  type CameraController,
  type CameraMode,
} from '../render/camera-controller.ts';
import { createMinimapView, type MinimapView } from '../render/minimap.ts';
import { createFogView, type FogView } from '../render/fog-view.ts';
import { bakeLayer, type BakedLayer } from '../render/bake.ts';
import {
  FRAME_CLAMP_MS,
  paceFrame,
  shouldAnimateAt,
  shouldAdvanceFrame,
  targetFpsFor,
} from '../render/eco-mode.ts';
import {
  DEFAULT_FAST_TIME_SCALE,
  DEFAULT_UTC_OFFSET_MINUTES,
  OFFLINE_SETTLE_MAX_DAYS,
  RealClock,
  msSinceLocalMidnight,
  resolveClockSelection,
  type ClockMode,
} from '../world/real-clock.ts';
import {
  formatClockCatchUp,
  readClockBaseline,
  writeClockBaseline,
  type BaselineStorage,
  type ClockCatchUp,
} from '../world/real-clock-baseline.ts';
import {
  clearClockAlignment,
  clockAlignmentAvailable,
  formatBoundaryClock,
  formatDuration,
  inspectClockAlignment,
  mayAlignClock,
  readClockAlignment,
  writeClockAlignment,
  ClockAlignmentGate,
  type ClockAlignmentProbe,
  type ClockAlignmentRecord,
} from '../world/clock-alignment.ts';
import { fogAt } from '../world/fog.ts';
import { awaitingDecree } from '../world/decree.ts';
import { describeWorldState, summarizeWorld } from '../world/world-state.ts';
import { CreatorEngine, type CreatorWorldView } from '../creator/engine.ts';
import {
  freezeCreatorView,
  landingReachable,
  verifyCreationReplay,
  type LandedCreation,
} from '../creator/landing.ts';
import { checkLandedBuilding, creationCoverage } from '../creator/business-rules.ts';
import {
  buildCreationRecord,
  buildLandingRecord,
  buildObservationRecord,
  creationVerdict,
  evaluateLandingGates,
  evaluateProposalGates,
  ladderSnapshot,
  landingFingerprint,
  newRecordId,
  observationDueDay,
  observationOf as ledgerObservationOf,
  passiveLadderSnapshot,
  proposalFingerprint,
  type CreationOrigin,
  type LedgerRecord,
  type RejectionReason,
} from '../creator/ledger.ts';
import {
  createCreationLedgerClient,
  createCreationLedgerOutbox,
  type CreationLedgerOutbox,
} from '../creator/ledger-client.ts';
import { createLocalStorageLedgerQueue } from '../creator/ledger-queue.ts';
import type { CreationPlan } from '../world/creator-schema.ts';
import {
  biomeRingAllows,
  checkPlacement,
  hintFor,
  isWildSide,
} from '../world/setup.ts';
import { parsePhaseParam, phaseAt, type PhaseId } from '../render/day-phase.ts';
import { createDecorView, type DecorView } from '../render/decor.ts';
import { composeReport, type DailyReport } from '../world/report.ts';
import { villagerModeLabel } from '../world/villager-words.ts';
import { describePropSource } from '../world/faith.ts';
import { createLazyAnimalese, type Animalese } from '../audio/animalese.ts';
import { toWorldCommand, type AgentToWorld } from '../world/bridge.ts';
import { FeedClient } from '../world/feed.ts';
import { createEventsClient, type EventsClient } from '../world/events-client.ts';
import {
  createMemoryClient,
  createMemoryOutbox,
  type MemoryClient,
  type MemoryDraft,
  type MemoryOutbox,
} from '../world/memory-client.ts';
import type { WorldChange } from '../world/world-changes.ts';
import { createIntentClient } from '../world/intent-client.ts';
import { SaveStore } from '../ui/save-store.ts';
import type { WorldSave } from '../world/save.ts';
import { CURRENT_SCHEMA_VERSION } from '../world/save.ts';
import type { SettingPack } from '../settings/types.ts';
import { createSettingScenery, type SettingSceneryView } from '../render/setting-scenery.ts';
import { routineProfiles, selectSetting } from '../settings/index.ts';

export interface ScenePayload {
  readonly world: BuiltWorld;
  readonly blueprints: ReadonlyMap<string, PrefabBlueprint>;
  readonly villagerName: string;
  readonly saveStore?: SaveStore;
  readonly save?: WorldSave | null;
  readonly saveNotice?: string | null;
  readonly pack?: SettingPack;
}

const LOGIC_STEP_MS = 100;
/**
 * 一帧最多跑几步。帧预算，不是世界时间的闸——那个是 `FRAME_CLAMP_MS`。
 *
 * 两个数是**不同的事**，别合并：`FRAME_CLAMP_MS`（250ms）决定「世界最多
 * 承认过了多久」，这一步决定「一步最多跑几次，免得一帧卡死」。
 * `paceFrame` 先按前者收池子，再按后者跑，所以前者是紧的那道。
 * 由 `test/frame-pace.test.ts` 钉着两者的关系（这里必须 ≥ 3，否则它会抢先
 * 于 `FRAME_CLAMP_MS` 生效，世界的走慢就变成帧预算说了算）。
 */
const MAX_STEPS_PER_FRAME = 5;
const ALTITUDE = 1000;
/**
 * 地标痕迹那一层的深度。
 *
 * 地形烘焙在 -10（`drawTerrain` 的 `bakeLayer` 参数），而楼、道具、人全在
 * `ALTITUDE = 1000` 以上按行排。地标上的痕迹是**地上**的东西：浮在地形之上、
 * 压在一切立着的东西之下，所以取两者之间。
 */
const GROUND_DECAL_DEPTH = -5;

/** 默认的游玩时间驱动里点对齐入口时的说明：这回事只属于真实时钟模式。 */
const CLOCK_ALIGN_REAL_ONLY = '日界对齐只在真实时钟模式（?clock=real）下可用';

interface BuildingEntry {
  readonly building: BuiltWorld['buildings'][number];
  readonly view: BuildingView;
  readonly emitter: AccentEmitter;
}

/**
 * 一次已经入队、但还没落地的造物。**观测要等到 `building.built` 之后再做**。
 *
 * `recompute` 是落地前捕获的输入：手动造物重跑同一次 `proposeCreation(request)`，
 * 外环提议重跑 `planCreation(落地前的 view)`。落地后再重算，「已有哪些模板」
 * 已经变了，比出来的不是同一件事。
 */
interface PendingCreationObservation {
  readonly plan: CreationPlan;
  readonly day: number;
  readonly traceable: boolean;
  readonly recompute: () => CreationPlan | null;
  /** 账本里的那条 creation 记录 id；落地记录与观测记录都挂回它。 */
  readonly proposalId: string;
  readonly displayName: string;
  readonly origin: CreationOrigin;
  /** 提案那一刻的上游事件游标，写进回放指纹的事件区间。 */
  readonly eventFrom: number;
}

/**
 * 等第 7 个世界日再结算的观测。
 *
 * 只记**已经落地**的造物：没落地的东西没有「被拆」可言。
 */
interface PendingLedgerObservation {
  readonly proposalId: string;
  readonly buildingId: string;
  readonly dueDay: number;
  readonly expected: {
    readonly prefabId: string;
    readonly origin: GridPoint;
    readonly door: GridPoint;
  };
  readonly displayName: string;
}

export class SandboxScene extends Phaser.Scene {
  private world!: BuiltWorld;
  private pack: SettingPack | null = null;
  private settingScenery: SettingSceneryView | null = null;
  private blueprints!: ReadonlyMap<string, PrefabBlueprint>;
  private sim!: Simulation;
  /**
   * 最新一帧的世界现状。**迷雾也只认这一份**（`snapshot.fog`）。
   *
   * 视图与建造闸、神迹闸读同一个数，不再在渲染层另盖一次。曾经这里盖过：
   * `visibleFog()` 拿 `wholeGridRadius(this.world.grid)` 把半径改掉，于是快照说 38、
   * 视图说 168、神迹闸还说 38——屏幕上一片雾都没有，玩家把树种到 58 格外，
   * 回过来的却是「那里还没长出来」。判据收进世界（`Simulation.visibleFog`）之后
   * 三个数合成一个，这类分家就没有地方可发生了。
   */
  private snapshot!: WorldSnapshot;
  /**
   * **游玩时间驱动（默认）**的倍率。`?speed=0.5` 放慢，`?speed=12` 加速，
   * `?speed=1` 1:1。默认倍率 6，一世界日约 4 小时真实时间；关页面即冻结，
   * 重开从存档断点继续，永不补算。
   */
  private timeScale = DEFAULT_FAST_TIME_SCALE;
  /**
   * 时钟模式。**默认是游玩时间驱动**：`timeScale` 放大喂给 `Simulation`
   * 的步长，页面开着才走，关页面不积累任何世界时间。显式 `?clock=real`
   * 才切到真实时钟（1:1、日界本地 00:00、跨会话补算与日界对齐只属于它，
   * 见 `world/real-clock.ts`）。
   */
  private clockMode: ClockMode = 'accelerated';
  private realClock: RealClock | null = null;
  private realClockOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES;
  /**
   * `?now=` 调试开局时刻（世界分钟，00:00 起算）。只认 `?debug=1` 那一层，
   * 只对新世界生效；`undefined` = 照旧从 0 点开局（或真实时钟按本地时刻锚）。
   */
  private debugInitialNow: number | undefined;
  /** 真实时钟的可见提示：回拨暂停。进状态行，不写控制台了事。 */
  private clockNotice: string | null = null;
  /**
   * 上一次补算的结果。**常驻**到下一次补算或下一次造物，不再只活一帧。
   * `null` = 这个会话没有补算过。
   */
  private clockReport: ClockCatchUp | null = null;
  /** 跨会话基线最近一次写入的墙钟时刻；5 秒节流，避免每帧写 localStorage。 */
  private lastClockBaselineWriteAt = 0;
  /** 老档日界对齐：玩家的「暂不 / 已对齐」决定，独立键，不进存档。 */
  private clockAlignRecord: ClockAlignmentRecord | null = null;
  private clockAlignGate = new ClockAlignmentGate();
  private clockAlignNotice: string | null = null;
  /** 单位状态菜单：同一时间只有一个选择；只读，不暂停时间。 */
  private unitStatusSelection: UnitRef | null = null;
  private lastUnitStatus: UnitStatusView | null = null;
  private readonly unitStatusListeners = new Set<(view: UnitStatusView | null) => void>();
  /** 右键/长按开的是记忆/楼志面板；左键开的仍是状态菜单。 */
  private longPressTimer: number | null = null;
  private longPressRef: UnitRef | null = null;
  /** 按下时指针所在的格：500ms 后要按同一格重查，世界会自己动。 */
  private longPressCell: { readonly x: number; readonly y: number } | null = null;
  /** 右键或长按已经处理过这次按下，抬手时不要再开状态菜单。 */
  private suppressClickUp = false;
  private contextMenuListener: ((event: Event) => void) | null = null;
  private readonly villagerViews = new Map<string, VillagerView>();
  /** 人物脚下的日照投影层（depth 3.1，见 `world/ground-shadow.ts`）。 */
  private groundShadowLayer!: Phaser.GameObjects.Graphics;
  /** 人物/摊位落地投影开关；`debugGroundShadows` 写这个口子。 */
  private groundShadowMotion: GroundShadowMotion = GROUND_SHADOW_MOTION_ON;
  /**
   * 调试摆位：id → 固定格。只影响这一帧的画，不写世界。
   * 见 `render/villager-pin.ts` 与 `debugPinVillager`。
   */
  private readonly pinnedVillagers = new Map<string, Vec2>();
  /**
   * 调试灯态：`debugForceLamps` 写这里，`null` = 交回世界时钟判。
   * 只改画面，不改 `lampStreetLitAt` 的判据本身。
   */
  private forcedLamps: boolean | null = null;
  /** 灯柱/灯串的三支动态开关；缺省全开，证据脚本逐支关掉取对照。 */
  private lampMotion: LampMotion = LAMP_MOTION_ON;
  /** 摊位两支动态开关（棚布/盖布摆动、火光跳动）；缺省全开。 */
  private stallMotion: StallMotion = STALL_MOTION_ON;
  /** 幌布两支动态开关（布身摆动、沿墙投影）；缺省全开。 */
  private bannerMotion: BannerMotion = BANNER_MOTION_ON;
  /** 烟的分段漂移开关；缺省全开。 */
  private smokeMotion: SmokeMotion = SMOKE_MOTION_ON;
  /**
   * 藏掉湾面低雾（缺省不藏）。只为证据隔离：那三条雾按世界时刻横移，
   * 会在「烟关掉、世界走 2 秒」的对照里留下一条 420×5 的像素差——不是烟。
   */
  private hideBayMist = false;
  /**
   * 调试用：把「摊子已盖」这一态钉死（`null` = 交回天气与记忆）。
   * 雨幕由帧间隔驱动，世界冻住时它仍会动；要量盖布的像素差，
   * 就把天气留在晴天、只钉「已盖」这一态，画面里才只有布在动。
   */
  private forcedPacked: boolean | null = null;
  /**
   * 世界时间冻住：不推进模拟，渲染循环照跑。
   * 用来证明「世界时间不推进 → 动画不推进」，而不是把 rAF 一起停掉。
   */
  private holdWorld = false;
  /**
   * 调试用：把**渲染**用的潮位钉死（`null` = 交回快照）。
   * 只压过画面，不改世界里的潮汐；证据脚本要在同一片地面上量 t / t+1s，
   * 不能让它被「这一秒潮水又涨了一点」搅进来。
   */
  private pinnedTide: number | null = null;
  private overlay: WorldOverlay | null = null;
  private weatherView!: WeatherView;
  private tideView!: TideView;
  /** 渡口的木栈/灯影/船。没有 `ferry` 地域的图不创建，保持 null。 */
  private harborView: HarborView | null = null;
  /** 天气雾：图内雾团 + 压暗。只在有雾时显示，由世界层的密度开关量驱动。 */
  private weatherFogView: WeatherFogView | null = null;
  /** 雨天的摊子盖布。没有摊子的图不创建，保持 null。 */
  private weatherStallsView: WeatherStallsView | null = null;
  /** 灯街摊位的格子（设定集给的）。天气目击按它分组，记忆习惯按它找摊子。 */
  private stallCells: readonly GridPoint[] = [];
  private phaseView!: PhaseView;
  /** 白天的鸟、黄昏的蝙蝠。纯画面，不占快照、不进存档。 */
  private ambienceView!: AmbienceView;
  private nightKeyListener: ((event: KeyboardEvent) => void) | null = null;
  private creationKeyListener: ((event: KeyboardEvent) => void) | null = null;
  /** 真实时间推进用的定时器；?time= 固定某刻时不启动。 */
  private phaseTimer: number | null = null;
  private decor!: DecorView;
  private entries: BuildingEntry[] = [];
  private accumulator = 0;
  private tick = 0;
  private villagerName = '莞尔';
  private lastStatus = '';
  /**
   * 上一次**说出口的**结果。null 表示还没说过。
   *
   * 与 `lastStatus` 做同一件事：订阅来晚了，把最后那一句补给它。`onStatus`
   * 一直这么做，`onResult` 从前不做——于是场景挂上与界面订阅之间那段时间里
   * 产生的结果**整条丢掉**。用户点的按钮就在那个窗口里的话，世界照办，
   * 屏上一个字都不显示。
   *
   * 只记有话可说的那些：轮询每次失败都带一个空结果过来（见 `simulation.ts`
   * 的 `syncEvents`），补一句空话等于没补。
   */
  private lastReply: CommandResult | null = null;
  private lastRoadCount = -1;
  /** 造物模式会话。null 表示不在造物模式里。 */
  private creation: { readonly prefabId: string; ghostAt: GridPoint | null } | null = null;
  private ghost!: GhostView;
  private cameraCtl!: CameraController;
  private minimap: MinimapView | null = null;
  private fogView: FogView | null = null;
  private focusListener: (() => void) | null = null;
  /** 诊断用：场景 update 被调用过多少次。降频是否生效看它。 */
  private updateCount = 0;
  /** 真正推进了世界的帧数。降频是否生效看它。 */
  private advanceCount = 0;
  /** 省电模式：窗口不在前台时为 true，渲染与逻辑都按 `minFrameIntervalMs` 跳帧。 */
  private backgroundMode = false;
  /** 两帧之间的最小间隔（毫秒）。前台为 1000/60，后台为 1000/12。 */
  private minFrameIntervalMs = 1000 / 60;
  /** 上次真正推进世界的时刻（Phaser 的 time 参数）。 */
  private lastAdvanceAt = 0;
  private terrainLayer!: BakedLayer;
  /** 拖拽平移的起点（屏幕坐标）；null 表示没在拖。 */
  private dragFrom: { x: number; y: number } | null = null;
  /** 这一回按下之后指针挪过没有。挪过了就是拖镜头，没挪过才算点一下。 */
  private pressMoved = false;
  /**
   * 屏幕上的触屏手指，按 Phaser 的 `pointer.id` 记。
   *
   * 捏合要的是「两根手指同时在哪」，而 `pointermove` 是**逐指**派发的——只看
   * 一根手指的位移，分不清它是拖图还是在缩放。
   */
  private readonly touches = new Map<number, { x: number; y: number }>();
  /** 捏合会话；`null` = 没有两指手势在进行（两指都抬起后才清）。 */
  private pinch: PinchZoomState | null = null;
  /** 这一帧有捏合位移待结算（见 `settlePinch`）。 */
  private pinchPending = false;
  private lastConstructionKey = '';
  private readonly lastBubbles = new Map<string, string | null>();
  private readonly animalese: Animalese = createLazyAnimalese();
  private feedClient: FeedClient | null = null;
  /** 回写用。与 feed 共用一个 client（同一个服务端），但方向相反。 */
  private eventsClient: EventsClient | null = null;
  /**
   * 把世界观测到的事写回服务端 `memory/`。
   *
   * 只在 `connectFeed()` 里建：`?feed=off` 时没有服务端，也就没有可写的编年史。
   * 出队器攒着，**跟着自动存档那条节流走**（`maybeAutoSave` 成功之后才交一条），
   * 不是每拍一次——写记忆是落文件，拿磁盘当日志没有意义。
   */
  private memoryClient: MemoryClient | null = null;
  private memoryOutbox: MemoryOutbox | null = null;
  /**
   * 外环：造物主引擎。**这次它真的在生产路径上**。
   *
   * 场景把世界现状喂给它（`creatorWorldView()`），它产出的计划经
   * `Simulation.enqueue` 落地——与玩家在造物模式里点出来的走同一条通道，
   * 没有第二套写世界的入口。世界日结束时它也在这里结算（`closeWorldDay`）。
   *
   * 没有设定集（莞尔镇）时用默认包：`selectSetting('')` 返回的就是它。
   */
  private creator: CreatorEngine | null = null;
  /**
   * 等落地之后再结算的造物观测。键是 `instanceId`，由既有的
   * `building.built` 回写（`onChange`）触发结算——不另开定时器或轮询。
   */
  private readonly pendingCreationObservations = new Map<string, PendingCreationObservation>();
  /**
   * 造物账本的外挂日志（提案 B）。**不进 v5 存档**：写面是服务端
   * `data/creation-ledger/<worldId>.jsonl`，只追加；读面见 `ledger-client.ts`。
   *
   * 出队器与记忆同形：入队立刻试一次，失败留在队里，下一次自动存档再试。
   */
  private creationLedger: CreationLedgerOutbox | null = null;
  private ledgerWorldId = 'default';
  private ledgerSeed = 'default';
  /** 等第 7 个世界日结算的观测。键是建筑 instanceId。 */
  private readonly pendingLedgerObservations = new Map<string, PendingLedgerObservation>();
  /** 世界发过 `building.removed` 的实例。观测据此区分「被拆」与「下落不明」。 */
  private readonly removedBuildingIds = new Set<string>();
  /**
   * 内环：记忆与传播。世界每拍交一份处境给它，跨日时它关账。
   *
   * 单独一个对象而不是长在 `Simulation` 里：世界只管自己的事（任务、天气、
   * 潮汐），记忆是**关于**这些事的第二层。把它塞进固定步长里，等于让世界
   * 每 100ms 顺手整理一次自己的记忆。
   */
  private memory!: MemoryRuntime;
  /** 记忆层的观察编号。与日志里的 id 不是一回事——这里只需要自己内部唯一。 */
  private memoryEventSerial = 0;
  /**
   * 上一次「看某个村民」读出来的那几句。
   *
   * 与 `lastReply` / `lastStatus` 同一个道理：面板订阅得比场景挂载晚，那段时间里
   * 产生的读数不能整条丢掉。只留最后一份——面板同时只显示一个人。
   */
  private lastVillagerMemory: VillagerMemoryView | null = null;
  private readonly villagerMemoryListeners = new Set<(view: VillagerMemoryView | null) => void>();
  /**
   * 上一次「点碑」摆出来的那几行。
   *
   * 与 `lastVillagerMemory` 同一个道理：面板订阅得比场景挂载晚，那段时间里
   * 产生的读数不能整条丢掉。只留最后一份——面板同时只显示一块碑。
   */
  private lastSteleView: SteleView | null = null;
  private readonly steleListeners = new Set<(view: SteleView | null) => void>();
  /**
   * 楼面板此刻摆的是哪一栋，以及摆出去的那一份视图。
   *
   * 与碑不同，楼面板**会自己更新**：`toponym.changed` 落地时，开着的那一栋
   * 要当场换成新名字（协议 §11 的历史链就是给这个时候读的）。所以要记住
   * 「现在开的是谁」，而不是只记住最后一份视图。
   */
  private lastBuildingView: BuildingPanelView | null = null;
  private readonly buildingListeners = new Set<(view: BuildingPanelView | null) => void>();
  private readonly cameraModeListeners = new Set<(mode: CameraMode) => void>();
  /** 上一次广播出去的镜头模式。导播是闲置后自己接管的，没有它就没有变化可广播。 */
  private lastCameraMode: CameraMode = 'free';
  /** 今天已经看过哪几栋楼（`villager\u0000building`）。跨日清空。 */
  private seenToday = new Set<string>();
  private seenDay = -1;
  /** 上一拍还站着的楼。用来认出这一拍少掉的那几栋。 */
  private placeHolders = new Set<string>();
  /**
   * 每栋楼上一次画出去的痕迹单子的指纹。
   *
   * 痕迹一天才风化一次、出事才添一道，每拍重画是白烧；而按指纹跳过重画，
   * 又不会漏掉「今天风化了一格」——`visibility` 就在指纹里。
   */
  private decalSignatures = new Map<string, string>();
  /**
   * 不归楼的作息落点：设定集里它们登记成地点 Holder，痕迹画在地上。
   *
   * 由 `syncLandmarks` 从 `pack` 算出来，楼一栋都不建时它也不会变——
   * 地标不是谁盖的，是人走出来的。
   */
  private landmarkCells: { readonly x: number; readonly y: number }[] = [];
  /**
   * 已经没有楼、但原地还留着痕迹的地方（拆掉的那几块地）。
   *
   * **楼拆了不是「什么都没有了」**：记忆层还留着它的痕迹与坐标，这里把它们
   * 当废墟画在地上。这个表由 `syncBuildings` 每拍按「还站着的楼」与
   * `memory.placeWithTraces()` 求差得出，渲染路径与地标共用 `placeHints`
   * 那一张单子、同一道闸（`traceExposedLayers`）。
   */
  private ruinPlaces: { readonly placeId: string; readonly at: { readonly x: number; readonly y: number } }[] = [];
  /**
   * 只读回溯的记录器。`null` = 这个浏览器没有 IndexedDB，或还没接上。
   *
   * **它不在关账主路径上**：`capture()` 只拿住当天的快照对象并把差分排进队列；
   * 序列化与写库在队列里跑。关一天账时多出来的开销是一份 `toSnapshot()`
   * 与一份 `toSave()`，没有整档 `JSON.stringify`。
   */
  private history: SceneHistory | null = null;
  /** 已经记到哪一天（`-1` = 还没记过）。用来判「连续」还是「断了几天」。 */
  private lastHistoryDay = -1;
  /** 历史层降级的原因；进状态行，不吞掉。 */
  private historyNotice: string | null = null;
  /** 每块地标上一次画出去的痕迹单子的指纹，与 `decalSignatures` 同一个理由。 */
  private groundSignatures = new Map<string, string>();
  private groundLayer?: Phaser.GameObjects.Graphics;
  /**
   * 这一局画面上该用的 24 色：设定集给了就整套换成它的，没给就是莞尔镇的。
   *
   * 痕迹、地形、楼、人都得读同一份。`tilemap.ts` 早就这么做了
   * （`theme?.palette ?? paletteFor()`）；痕迹那一层 2026-11-02 才跟上——
   * 在那之前灯潮界的地上和墙上一直画着莞尔镇的石头色。
   */
  private get palette(): WorldPalette {
    return this.pack?.palette ?? paletteFor();
  }

  /**
   * 这一格地形铺的底色——痕迹带靠它避开「和自己脚下同色」。
   *
   * 口径与 `tilemap.ts` 的 `drawTerrain` 那一行**必须一样**：
   * `theme?.terrainColors[terrain] ?? TERRAIN_COLORS[terrain]`。两处各写一遍
   * 就是本仓记过的那个病，所以这里照抄同一句、并在注释里指回去。
   */
  private terrainBaseOf(cell: { readonly x: number; readonly y: number }): number {
    const tile = this.world.grid.at(cell);
    // 格外的坐标：`drawTerrain` 那边也是 `if (cell === undefined) continue`，
    // 不画。这里给草地色，只为了让「同色」这条判据有个落点——画不画得出东西
    // 由 `landmarkCells` 决定，那些格子一定在图里。
    const terrain = tile === undefined ? 'grass' : tile.terrain;
    return this.pack?.terrainColors[terrain] ?? terrainFor()[terrain];
  }
  private saveStore!: SaveStore;
  private loadedSave: WorldSave | null = null;
  private saveNotice: string | null = null;
  private lastSaveKey = '';
  private lastSaveAt = Number.NEGATIVE_INFINITY;
  private onPageHide: (() => void) | null = null;
  private readonly resultListeners = new Set<(result: CommandResult) => void>();
  private readonly statusListeners = new Set<(line: string) => void>();
  private readonly bubbleListeners = new Set<(text: string) => void>();

  /** 测试与 UI 都能读到同一份报纸；它从快照推导，不另存。 */
  report(): DailyReport {
    return composeReport(this.snapshot);
  }

  constructor() {
    super({ key: 'SandboxScene' });
  }

  init(payload: ScenePayload): void {
    this.world = payload.world;
    this.pack = payload.pack ?? null;
    this.blueprints = payload.blueprints;
    this.villagerName = payload.villagerName;
    this.loadedSave = payload.save ?? null;
    this.saveNotice = payload.saveNotice ?? null;
    this.saveStore =
      payload.saveStore ??
      new SaveStore({
        onWarning: (message) => {
          this.saveNotice = message;
        },
      });
  }

  create(): void {
    const originX = 0;
    const originY = 0;
    this.cameras.main.setBackgroundColor(this.pack?.palette.ink ?? paletteFor().ink);

    // 地形烘焙成一张纹理：Graphics 每帧都要重算整条 commandBuffer，而地形画完
    // 就不再变。只在开局画一次，之后每帧只贴一个 quad。
    // 这里原来还写着「每帧要 51 万条绘制指令，可见区域只占世界 12.5%」——两个数
    // 都没有出处（可见区域实测是 8.7%），理由不靠它们也成立，详见 `bake.ts`。
    this.terrainLayer = bakeLayer(
      this,
      `world-terrain-${this.pack?.id ?? 'default'}`,
      this.world.grid.width * TILE_PX,
      this.world.grid.height * TILE_PX,
      -10,
      // 传祭坛坐标：地表细节按群落配方分化，镇内与郊野长得不一样。
      (g) => drawTerrain(this, this.world.grid, originX, originY, g, this.world.altar, this.pack ?? undefined),
    );
    ensureAccentTextures(this);
    this.decor = createDecorView(this, originX, originY);
    this.decor.redrawRoads([]);

    this.entries = this.world.buildings.map((building) => ({
      building,
      view: createBuilding(this, building, originX, originY),
      emitter: createAccentEmitter(this, building.accent),
    }));
    // 覆盖层按**世界**尺寸建，不是画布尺寸：大世界里镜头只是世界的一小块。
    const worldPx = {
      w: this.world.grid.width * TILE_PX,
      h: this.world.grid.height * TILE_PX,
    };
    this.weatherView = createWeatherView(this, worldPx.w, worldPx.h);
    this.tideView = createTideView(this, this.world.grid, originX, originY, this.pack?.palette);
    const harborSite = harborSiteOf(this.pack);
    if (this.pack !== undefined && this.pack !== null && harborSite !== null) {
      this.harborView = createHarborView(this, this.pack, harborSite, originX, originY);
    }
    this.phaseView = createPhaseView(this, worldPx.w, worldPx.h, this.pack?.palette.deepShade);
    this.ambienceView = createAmbienceView(this);
    this.ghost = createGhostView(this);
    // 设定集（authored）的整张图都是「已经到过的地方」：`visibleFog()` 的揭示半径
    // 已经盖满全图，雾体本身一格都不画；而边缘雾团仍沿那个半径绕圈，圆心天然落在
    // 图外——屏幕上什么也看不到，审计却数得出「14 团全在图外」。
    // 既然这张图没有「没去过」的暗角，就不建探索迷雾视图。旧镇照旧。
    this.fogView =
      this.pack?.authored === true
        ? null
        : createFogView(this, this.world.grid.width, this.world.grid.height);
    // 天气雾与探索迷雾是两套：前者的团全部在图内，后者负责「没去过」的暗角。
    this.weatherFogView = createWeatherFogView(this, this.world.grid, this.pack?.id ?? 'wandong');
    if (this.pack !== undefined && this.pack !== null) {
      this.weatherStallsView = createWeatherStallsView(this, this.pack);
      // 摊子格由设定集给：天气目击按最近的摊子分 6 格一组，记忆习惯也回这张摊子。
      this.stallCells = this.pack.scenery
        .filter((item) => item.kind === 'stall')
        .map((item) => item.at);
    }

    // 相机：锁在世界边界内，初始对准祭坛。
    //
    // 设定集地图比旧镇大得多：默认 2 倍只能看到约 15×10 格，开局只露出叠浪楼一角，
    // 读不出"这是渡口—灯街—叠浪楼连成的一条世界"。放到 1 倍，首屏能同时看到楼、
    // 街与灯；想细看仍可滚轮放大。
    //
    // 这里给的是**初始档位**，不是连按两次缩小：那两拍会把索引和 Phaser 的实际
    // 缩放一起改，而默认世界（`authored:false`）没有这一步——索引说 2 倍、画面
    // 停在 1 倍，滚轮第一格就成了「放大」。档位现在在构造函数里真的设上去。
    this.cameraCtl = createCameraController(
      this,
      worldPx.w,
      worldPx.h,
      this.pack?.authored === true ? { zoomIndex: 0 } : {},
    );
    // 开局对准祭坛。放在下一帧做：Phaser 在 create() 结束后的首次 preRender
    // 会用 setBounds 重新夹取镜头，那时 camera.width 才是最终值；
    // 在 create() 里直接 centerOn 会被这次夹取推回左上角。
    const focusX = this.world.altar.x * TILE_PX;
    const focusY = this.world.altar.y * TILE_PX;
    this.time.delayedCall(0, () => this.cameraCtl.panTo(focusX, focusY, 0));
    // 自动导播：闲置 15 秒后接管，有活看正在忙的人，没活看祭坛。
    // 这里只是**登记**目标列表，真正进入导播要等闲置计时到点——
    // 用户一拖一缩就退出，不会跟人抢镜头。
    this.cameraCtl.enableDirector(() => this.directorTargets());

    const minimapHost = document.querySelector<HTMLDivElement>('#minimap');
    if (minimapHost !== null) {
      this.minimap = createMinimapView(minimapHost, worldPx.w, worldPx.h);
      this.minimap.paintTerrain(this.world.grid, this.pack?.terrainColors);
      minimapHost.addEventListener('pointerdown', (event: PointerEvent) => {
        const point = this.minimap?.toWorld(event.clientX, event.clientY);
        if (point === null || point === undefined) return;
        this.cameraCtl.panTo(point.x, point.y, 300);
      });
    }

    // 拖拽平移与滚轮缩放。造物模式优先：那时拖拽不移动镜头。
    // 桌面右键直接开记忆/楼志；浏览器菜单必须压掉，否则右键先弹系统菜单。
    this.contextMenuListener = (event: Event): void => {
      event.preventDefault();
    };
    this.game.canvas.addEventListener('contextmenu', this.contextMenuListener);

    // Phaser 默认只分一个触屏 pointer，第二根手指落下根本没有对象接。
    // 捏合要两根，所以在这里补一个（`InputManager.addPointer` 的上限是 10，够用）。
    this.input.addPointer(1);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.creation !== null) return;
      if (pointer.wasTouch) this.touches.set(pointer.id, { x: pointer.x, y: pointer.y });
      // 右键 = 上下文面板，不参与拖镜头，也不在抬手时开状态菜单。
      if (pointer.rightButtonDown()) {
        this.suppressClickUp = true;
        this.openContextPanelAt(pointer);
        return;
      }
      // 第二根手指落下 = 捏合：这一下既不是长按，也不是拖图或单击。
      if (this.beginPinchIfTwo()) return;
      this.suppressClickUp = false;
      this.dragFrom = { x: pointer.x, y: pointer.y };
      this.pressMoved = false;
      this.beginLongPress(pointer);
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      // 捏合结束时两根手指的抬手都必须被吃掉：否则先抬的那根会被当成一次单击，
      // 在「缩放完」的瞬间开出一个面板。
      const pinching = this.pinch !== null;
      // 抬起前先把最后一拍位移结算掉：一次快速的「拉开即松手」可能整段落在
      // 一帧之内，等 update 就来不及了（那时手指已经不在册）。
      if (pinching) this.settlePinch();
      if (pointer.wasTouch) {
        this.touches.delete(pointer.id);
        if (this.touches.size === 0) {
          this.pinch = null;
          this.pinchPending = false;
        }
      }
      const suppress = this.suppressClickUp || pinching;
      this.suppressClickUp = false;
      this.cancelLongPress();
      this.dragFrom = null;
      if (suppress) return;
      // 抬手时没怎么动，才算「点了一下」而不是拖镜头。没有这个区分的话，
      // 每次平移地图都会顺手洗掉路过的那盏灯——玩家只是在看世界。
      if (this.pressMoved) return;
      // 点到人就是「看她」：镜头跟过去，面板读出她记得的事。
      // 其次点碑：镇上认下的事都在那块石头上。
      // 再其次点楼：它叫什么、接过什么活、墙上留着什么。
      // 都不中才退回洗地——四种动作共用一次点击，靠落点上有什么分开。
      // 先比人再比碑：人在碑上站着时，点她应该还是看她。
      // 单位状态菜单：点人 / 点楼各开一次，只读、不暂停世界。
      // 碑仍排在「人」之后、「楼」之前（原来那条优先级不动）。
      if (this.openVillagerStatusAt(pointer)) return;
      if (this.openSteleAt(pointer)) {
        this.dismissUnitStatus();
        return;
      }
      if (this.openBuildingStatusAt(pointer)) return;
      // 点空白：三种单位面板一起收，行为与 Esc / 关闭按钮一致。
      this.dismissUnitStatus();
      this.closeVillagerPanel();
      this.closeBuildingPanel();
      this.washUnder(pointer);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.creation !== null) return;
      if (pointer.wasTouch && this.touches.has(pointer.id)) {
        this.touches.set(pointer.id, { x: pointer.x, y: pointer.y });
        // 两指手势期间不走单指路径：捏合已经在改镜头，再叠加一次平移就成双份位移。
        if (this.applyPinch()) return;
      }
      if (this.dragFrom === null) return;
      if (!pointer.isDown) {
        this.dragFrom = null;
        return;
      }
      // 长按期间指针移出原来的单位就取消；仍在他身上则继续等 500ms。
      if (this.longPressRef !== null) {
        const current = this.unitRefAt(pointer);
        if (
          current === null
          || current.kind !== this.longPressRef.kind
          || current.id !== this.longPressRef.id
        ) {
          this.cancelLongPress();
        }
      }
      const dx = pointer.x - this.dragFrom.x;
      const dy = pointer.y - this.dragFrom.y;
      this.dragFrom = { x: pointer.x, y: pointer.y };
      // 判「移动过」而不是判移动距离：一格以内的抖动照样是拖动，
      // 而拖动与点击的分界本来就该是「有没有挪过」。
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) this.pressMoved = true;
      this.cameraCtl.panBy(dx, dy);
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (this.creation !== null) return;
      this.cameraCtl.zoomStep(dy > 0 ? -1 : 1);
    });
    // 时相来源：?time= 显式指定（截图与调试用）> ?night=1（旧入口，等价于夜）> 真实本地时间。
    const params = new URLSearchParams(window.location.search);
    // 时钟入口：**默认是游玩时间驱动**，页面开着按倍率推进，关页面即冻结，
    // 重开从存档断点继续，永不补算。真实时钟必须显式 `?clock=real`——它保留
    // 1:1 步长、本地日界、跨会话补算与老档日界对齐；`?clock=fast`（或只给
    // `?speed=`）继续表示加速模式（历史入口，截图与回归一直这么用）。
    // `?clock=real` 压过 `?speed=`——1:1 是真实时钟的定义，留一个能偷偷加速的
    // 入口就没人能说它还是真实时钟。锚点默认 UTC+8；`?utcOffsetMinutes=` 可配，
    // 但只影响日界落在几点，不改日长。
    // 调试开局时刻：`?now=<0..1439>` 世界分钟（00:00 起算）。只在 `?debug=1`
    // 那一层生效，且只对新世界有效——读档的 `world.now` 是它自己的事实，不重锚。
    // 存在的理由：默认 00:00 属于夜间休息，居民那时本来就不该走动；回归脚本
    // 要验「没人管的时候她会自己走动」，就得把场景显式放到白天，而不是放宽断言。
    this.debugInitialNow =
      params.get('debug') === '1' || params.get('debug') === ''
        ? parseMinuteOfDay(params.get('now'))
        : undefined;
    const selection = resolveClockSelection(params);
    this.clockMode = selection.mode;
    this.realClockOffsetMinutes = selection.utcOffsetMinutes;
    this.timeScale = selection.timeScale;
    if (selection.mode === 'real') {
      this.realClock = new RealClock({
        utcOffsetMinutes: this.realClockOffsetMinutes,
        offlineMaxDays: OFFLINE_SETTLE_MAX_DAYS,
      });
    }
    const forced = parsePhaseParam(params.get('time'));
    const legacyNight = params.get('night') === '1';
    const initialPhase: PhaseId = forced ?? (legacyNight ? 'night' : phaseAt(Date.now()));
    this.phaseView.setPhase(initialPhase);
    if (forced !== null || legacyNight) {
      this.phaseView.setAutoAdvance(false);
    }

    // 定时器**无条件创建**，由 `isAutoAdvancing()` 决定要不要真的切换。
    //
    // 早先只在「没有 ?time=」时创建它，于是从 ?time= 进入后再调 setAutoPhase，
    // 标志变 true 却没有定时器在跑——「交还给真实时间」是个空承诺。
    // 15 秒对一次表，不是 60 秒：相位边界是整点，60 秒的粒度意味着最多晚
    // 一分钟才切，而切换本身只有 900ms 渐变——用户会在 17:00 后还看着正午。
    // 15 秒的代价可以忽略（一次 Date.now 与一次比较）。
    this.phaseTimer = window.setInterval(() => {
      if (!this.phaseView.isAutoAdvancing()) return;
      this.phaseView.setPhase(phaseAt(Date.now()));
    }, 15_000);
    this.nightKeyListener = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'n') return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      // N 键在黄昏/夜之间切换，保留旧的「按 N 看夜景」习惯。
      this.phaseView.setPhase(
        this.phaseView.currentPhase() === 'night' ? 'dusk' : 'night',
      );
      this.phaseView.setAutoAdvance(false);
    };
    window.addEventListener('keydown', this.nightKeyListener);

    // 造物模式的指针与键盘。指针只在造物模式里有用，所以这里不注册常驻
    // 监听器，而是在 beginCreation 里挂、endCreation 里摘——避免平时每帧
    // 做一次无意义的坐标换算。
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.creation === null) return;
      // 用 worldX/worldY 而不是 positionToCamera：造物模式暂停了 update，
      // 相机矩阵可能停在上一帧，换算出来的世界坐标会偏。worldX 是事件派发时
      // 由输入插件按当前相机算好的。
      this.hoverCell({
        x: Math.floor(pointer.worldX / TILE_PX),
        y: Math.floor(pointer.worldY / TILE_PX),
      });
    });
    // 用 DOM 层的 keydown 而不是 Phaser 的键盘插件：Phaser 只在自己获得焦点时
    // 派发按键，而页面里输入框、按钮都可能抢焦点，造物模式会因此"回车没反应"。
    // 这里与 N 键用同一套判定：输入框里打字不算。
    this.creationKeyListener = (event: KeyboardEvent): void => {
      if (this.creation === null) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'Enter') {
        // 焦点常在按钮上（刚点完「造物模式」）。此时浏览器的默认行为是
        // 再点一次那个按钮，于是模式刚确认又重新打开。必须在这里拦掉：
        // 造物模式下回车只表示「就建在这里」。
        event.preventDefault();
        (target as HTMLElement | null)?.blur?.();
        const result = this.confirmCreation();
        if (!result.ok) this.publishCreationHint(result.message);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.cancelCreation();
      }
    };
    // 捕获阶段先拦：按钮的默认点击发生在冒泡之后，冒泡阶段拦住也晚了。
    window.addEventListener('keydown', this.creationKeyListener, true);

    if (this.pack?.authored === true) this.settingScenery = createSettingScenery(this, this.pack, ALTITUDE);
    else this.drawAltar(originX, originY);
    this.groundShadowLayer = this.add.graphics().setDepth(GROUND_SHADOW_DEPTH);

    const simDeps = {
      grid: this.world.grid,
      buildings: this.world.buildings,
      altar: this.world.altar,
      villagerName: this.villagerName, worldSeed: this.pack?.id ?? 'wandong',
      // 按种子排天：晴/雨/雾每 4 世界小时一槽。槽号与种子决定序列，
      // 与帧率、墙钟无关；纯逻辑测试不传这一项，行为保持旧样。
      // 只给设定集（灯潮界）开：旧镇的开场是晴，居民从街面起手；
      // 让种子在开局就压一场雨会把那条基线整个改写（冒烟闸钉着「开场晴」）。
      weatherCycle: this.pack?.authored === true,
      // 记忆进行为也只给设定集开：昨天淋过雨的人今天 13:00 提前盖布。
      // 摊子格是设定集的事实，引擎不自己编坐标。
      weatherHabit: this.pack?.authored === true,
      stallsAt: this.stallCells,
      ...(this.pack?.villagers.length ? {
        villagerNames: this.pack.villagers.map((villager) => villager.name),
        villagerProfiles: routineProfiles(this.pack),
      } : {}),
      // 地域的叫法。喂模型的世界现状要说「叠浪楼要一盏灯」，不说 `bathhouse`。
      // 没有设定集（莞尔镇）时这道门不存在，给张空表与不给等价。
      ...(this.pack === undefined || this.pack === null
        ? {}
        : { regionNames: new Map(this.pack.regions.map((region) => [region.id, region.name])) }),
      // 渡口落点：给 `Simulation` 一句「这张图有渡口」，它才会按世界时间报船班。
      // 地点取渡口地域中心，用于面板的「渡口」与可达性；莞尔镇没有 ferry，不给。
      ...(harborSite === null
        ? {}
        : {
            harborAt: {
              x: harborSite.x + Math.floor(harborSite.w / 2),
              y: harborSite.y + Math.floor(harborSite.h / 2),
            },
          }),
      // 露话池（SPEC_V2 §4.6）。设定集一份都没给时这项整个不出现——
      // 于是那本世界里没有一件摆件会脏，也没有一句编出来的话。
      ...(this.pack?.propReveals !== undefined
        ? { propReveals: this.pack.propReveals }
        : {}),
      // 设定集铺开的地图：迷雾整张掀掉。快照、建造闸、神迹闸因此是同一个数，
      // 不会出现「屏幕没雾、闸说没长出来」。莞尔镇是 undefined，等同 false。
      ...(this.pack?.authored === true ? { authored: true } : {}),
      // 世界做过的事记回日志。写不进去只是这一条没记上，世界照常过日子。
      onChange: (change: WorldChange, at: number): void => {
        const client = this.eventsClient;
        if (client !== null) {
          // 日志先写，拿到 id 才谈记忆：`POST /api/memory/write` 要的 `evidence`
          // 是日志里的事件 id，没有那一条就没有依据可引。
          void client.record(change, at).then((result) => {
            if (result.ok) this.queueMemory(change, at, result.id);
          });
        }
        this.remember(change, at);
        this.focusCameraOn(change);
        // 落地之后的观测接在这一条既有的回写之后：楼已经进了 `Simulation`
        // 的账本、网格也已经占格，可达性与回放才判得准。不另开一条通道。
        if (change.change === 'building.built') {
          // 下一次造物就把补算提示收掉：它是「上次离线发生了什么」，不是常驻广告。
          this.clockReport = null;
          // 造物引擎的提议在入队时就登记了；神谕/调试入口没有登记，
          // 落地这一刻补记一条来源为 oracle/world 的账。
          const wasPending = this.pendingCreationObservations.has(change.instanceId);
          this.settleCreationObservation(change.instanceId);
          if (!wasPending) this.recordUnplannedLanding(change.instanceId);
        }
        if (change.change === 'building.removed') {
          // 7 日观测要区分「被拆」与「下落不明」：只有真发过拆除事件才算前者。
          this.removedBuildingIds.add(change.instanceId);
        }
      },
      // 造物神谕（「建一间书阁」）要靠它把词换成模板。
      blueprints: this.blueprints,
      // 规则认不出的话才问模型。没有 Key 时它会 503，世界照样离线可用。
      intentModel: createIntentClient(() => this.blueprints, {
        worldSize: { width: this.world.grid.width, height: this.world.grid.height },
      }),
      worldSize: { width: this.world.grid.width, height: this.world.grid.height },
      spawnBuilding: (
        prefabId: string,
        instanceId: string,
        at?: GridPoint,
        source?: { readonly taskId: string; readonly summary: string },
      ): NewBuilding | null => {
        const blueprint = this.blueprints.get(prefabId);
        if (blueprint === undefined) return null;
        return placeBlueprint(
          this.world.grid,
          blueprint,
          instanceId,
          this.world.altar,
          at,
          source,
        );
      },
    };
    // 记忆世界先立起来：`simDeps.onChange` 会往里写，世界一开跑就会回调。
    //
    // 心电图的出口是**回写日志**——这是内环唯一被允许的对外广播
    // （补充设计 §0）。它不回到世界：世界不读自己抛出去的体检报告。
    this.memory = new MemoryRuntime({
      worldId: this.pack?.id ?? 'world',
      // 遮挡网格：不给的话「谁能看见一件事」就只能按 actors 算，而
      // 神迹、新楼、拆楼、天气这几种改变的 actors 是空的——那就没人记得。
      // `WorldGrid` 只要 `isWalkable` 就满足 `OcclusionGrid`，直接递。
      occlusion: this.world.grid,
      // 真实室内判定：人在楼体占地里就是「在屋里」。感知层因此能分清
      // 屋里交活（同房间才看见）与门口起楼（室外八格可见）。每拍现算，
      // 人走动不需要额外同步。
      insideAt: (point) => this.buildingIdAt(point),
      placeIndoor: (placeId) =>
        this.snapshot?.buildings.some((building) => building.instanceId === placeId) ?? false,
      // 记忆层的事件出口（写日志用）。**只开 `legend.formed` 一种**：
      // `MemoryEventKind` 那 17 个里 16 个有发出方，一次全开就是 16 种新载荷、
      // 16 个服务端校验函数——那是另一笔工作。这里开的这一条，是「传说变成
      // 世界共识」在那本账上留下的唯一一笔。
      //
      // `?feed=off` 时 `eventsClient` 是 null：传说照旧在记忆里立起来、碑照旧
      // 能读，只是镇志那一条不落。这是诚实的降级，不是失败。
      onEvent: (event) => {
        // 改名（协议 §11）：只有一件事要做——**开着的那一栋当场换名字**。
        //
        // 楼面板是「打开那一刻的快照」，不追着世界跑；而改名恰恰是它存在的
        // 理由，所以这一条单独刷新。别的时候面板不动，与村民面板同一条。
        //
        // 它不进世界回写日志：`WorldChange` 那七个成员里没有地名，也不该为
        // 它加第八个——改名是记忆层的读法，不是世界做成的一件事。
        if (event.kind === 'toponym.changed') {
          const renamed = event.payload as {
            readonly placeId?: unknown;
            readonly old?: unknown;
            readonly new?: unknown;
            readonly eventRef?: unknown;
          };
          // 与 `legend.formed` 同一条：收齐了才动。少一个字段就当没发生，
          // 而不是拿半个载荷去改一个开着的面板。
          if (
            typeof renamed.placeId !== 'string'
            || typeof renamed.old !== 'string'
            || typeof renamed.new !== 'string'
            || typeof renamed.eventRef !== 'string'
          ) {
            return;
          }
          if (this.lastBuildingView?.placeId === renamed.placeId) {
            this.openBuilding(renamed.placeId);
          }
          return;
        }
        if (event.kind !== 'legend.formed') return;
        const payload = event.payload as {
          readonly legendId?: unknown;
          readonly text?: unknown;
          readonly placeId?: unknown;
          readonly reach?: unknown;
          readonly day?: unknown;
        };
        // 载荷形状由 `world.ts` 的 `updateLegends` 写死；这里只收齐了才记，
        // 缺一个字段就整条不记——一条缺字段的「传说」比没有更糟，服务端会拒，
        // 而拒的声音只出现在控制台里。
        if (
          typeof payload.legendId !== 'string'
          || typeof payload.text !== 'string'
          || typeof payload.placeId !== 'string'
          || typeof payload.reach !== 'number'
          || typeof payload.day !== 'number'
        ) {
          return;
        }
        void this.eventsClient?.record(
          {
            change: 'legend',
            legendId: payload.legendId,
            text: payload.text,
            placeId: payload.placeId,
            reach: payload.reach,
            day: payload.day,
          },
          event.at,
        );
      },
      onVitals: (vitals) => {
        // 世界日结束：外环在这里按**真实天数**结算一次，并把心电图喂给导演。
        // 这一步原先没有调用方——`CreatorEngine.processDayClosed` 与
        // `closeWorldDay` 只存在于测试里。现在跨日是它们唯一的事实来源。
        this.stepCreatorDayClosed(vitals);
        // `at` 是关账那一刻的世界时间（第 `day + 1` 天的零点），不是「现在」。
        // 关账发生在跨日那一拍，用它自己的天界时刻，回放才对得上。
        void this.eventsClient?.record(
          {
            change: 'world.vitals',
            day: vitals.day,
            meanValence: vitals.meanValence,
            meanArousal: vitals.meanArousal,
            infoEntropy: vitals.infoEntropy,
            isolatedHoldersCount: vitals.isolatedHoldersCount,
          },
          (vitals.day + 1) * DAY_MS,
        );
      },
    });
    // 有档就重建世界；读档后标未对账，等首个成功读取从头折一遍。
    // 真实时钟模式把新世界的零点锚在本地时间的「今天已过了多久」，这样跨日
    // 恰在本地 00:00，而不是「开局满 24 小时」。读档不重锚：档里的 `now` 是
    // 世界自己的事实，换时钟模式不改写它（`Simulation.fromSave` 会覆盖）。
    // 默认的游玩时间驱动从 0 起算；关页面即冻结，重开从档里的 `now` 继续，
    // 不做任何离线补算。
    let initialNow: number | undefined;
    if (this.debugInitialNow !== undefined) {
      initialNow = this.debugInitialNow * 60_000;
    } else if (this.clockMode === 'real') {
      initialNow = msSinceLocalMidnight(Date.now(), this.realClockOffsetMinutes);
    }
    this.sim =
      this.loadedSave !== null
        ? Simulation.fromSave(this.loadedSave, simDeps)
        : new Simulation(initialNow === undefined ? simDeps : { ...simDeps, initialNow });
    // 记忆段是 v5 新增的位置：世界重建完再喂给记忆适配器，顺序不能反
    // （它要用 `this.world.grid` 算遮挡，而网格已经按存档重放过）。
    // 空串（v4 老档迁移的默认值）读作「没有记忆」，不报警。
    if (this.loadedSave !== null) {
      const memoryText = this.loadedSave.world.memory;
      const restored = this.memory.fromJSON(memoryText);
      if (!restored && memoryText !== '') {
        console.warn('[memory] 存档里的记忆段无法复原，按空记忆继续。');
      }
    }
    // 求证闭环：心里存疑的人会自己出门去现场。世界不问记忆层长什么样，
    // 只问「这个人该去哪」与「他到了，判一下」。
    this.sim.connectVerification({
      probe: (holderId) =>
        this.memory.pendingVerifications(holderId).map((plan) => ({
          placeId: plan.placeId,
          claimId: plan.claimId,
        })),
      settle: (holderId, claimId) => {
        this.memory.settleVerification(holderId, claimId);
      },
    });
    this.snapshot = this.sim.snapshot();
    // 开局档案：五个主要人物先「读到」自己的档案，关系初值一并落账。
    // 读档后重复调用是幂等的；老档里没有档案的，会在这里补一次。
    this.seedCastGenesis();
    // 真实时钟的跨会话补算必须在这里做：记忆已复原、快照已就位，补算走的是
    // 与常规跨日完全同一条 `stepMemory → tickCapped → onVitals` 路径。
    this.restoreRealClockBaseline();
    // 只读回溯的记录器：每天一份字段级补丁，每 30 天一份全量。
    //
    // **从这里开始记，不往前补。** 读档接过来的世界已经走过若干天，
    // 那些天的状态不在这一份进程里——补一份就是编一份。`lastHistoryDay`
    // 从「已经关到的最后一天」起步，之后只记真正在这一局里关掉的天。
    const worldId = this.pack?.id ?? 'world';
    const historyStore = createIdbHistoryStore(worldId);
    if (historyStore === null) {
      this.historyNotice = '回溯不可用：这个浏览器没有 IndexedDB。';
    } else {
      this.history = new SceneHistory({
        worldId,
        store: historyStore,
        onError: (message) => {
          this.historyNotice = `历史写入失败：${message}`;
        },
      });
      this.lastHistoryDay = this.memory.closedThroughDay;
    }
    // 老档日界对齐（main 的单位状态菜单/真实时钟那一支）：入口挂在这儿，
    // 与历史记录器互不相干——一个对齐日界，一个只读回看。
    this.initClockAlignment();
    // 造物引擎进生产路径：世界是场景这一份（不再另建第二份），种子取设定集 id，
    // 时钟取世界时间。三者都由场景给，引擎不自己造兜底。
    const creatorPack = this.pack ?? selectSetting('');
    this.creator = new CreatorEngine(creatorPack, {
      worldSeed: creatorPack.id,
      worldTime: () => this.snapshot.now,
      world: this.world,
    });
    // 造物账本：只增外挂日志。世界 id 与种子都取设定集 id；文件在服务端。
    // 出队器不阻塞世界——服务端不在时，记录留在队里等下一次自动存档。
    this.ledgerWorldId = creatorPack.id;
    this.ledgerSeed = creatorPack.id;
    // 队列落 localStorage（按世界分键）：POST 失败时页面关掉，重开还能补发。
    // 没有 localStorage（隐私模式/配额满）就只剩内存队列，`create…` 会返回 null。
    this.creationLedger = createCreationLedgerOutbox(createCreationLedgerClient(), {
      storage: createLocalStorageLedgerQueue(this.ledgerWorldId),
    });
    // 上次会话没发出去的记录，起来先交一次；失败留着，自动存档再试。
    void this.creationLedger.flush();
    const overlayRoot = document.querySelector<HTMLDivElement>('#world-overlay');
    if (overlayRoot !== null) this.overlay = createWorldOverlay(this, overlayRoot, this.pack?.regions);
    this.lastSaveKey = this.saveStateKey();
    // 省电模式：切到后台就降频。这是常驻窗口能不能长期开着的前提——
    // 用户写代码时如果它还跑满 60fps，笔记本会发烫。
    // 用 visibilitychange 而不是 hasFocus：后者在无头环境与部分浏览器里
    // 不随标签页切换变化（实测切到后台仍报 focused=true）。
    // 页面被遮挡或切走时 visibilityState 一定会变。
    this.focusListener = (): void => {
      const focused = document.visibilityState === 'visible' && document.hasFocus();
      // 不碰 Phaser 的限帧机制：它的 `step` / `stepLimitFPS` 回调在 `start()`
      // 时就绑定死了，运行时切换要 sleep + start，而 sleep 会停掉 raf、
      // start 又因 `started` 标志不重启——实测结果是直接归零。
      // 改成自己控制：记下后台模式与最小帧间隔，在 `update()` 里跳帧。
      this.backgroundMode = !focused;
      this.minFrameIntervalMs = 1000 / targetFpsFor(focused);
    };
    document.addEventListener('visibilitychange', this.focusListener);
    window.addEventListener('focus', this.focusListener);
    window.addEventListener('blur', this.focusListener);
    // 初始状态也按当前焦点设一次。
    this.focusListener();

    this.onPageHide = () => {
      this.saveStore.write(this.sim.toSave(this.memory.toJSON()));
      // 关页面前把「这一刻」也写进时钟基线；否则下一下开会把最后几秒
      // （或整整一个被节流的 5 秒窗）重复算进离线间隔。
      this.persistClockBaseline(true);
      // 账本队列也交一次。失败的发不出去，但至少不是「页面关了才想起来」。
      void this.creationLedger?.flush();
    };
    window.addEventListener('pagehide', this.onPageHide);
    this.registerOracleApi();
    this.connectFeed();
  }

  /**
   * 接上游事件流。连不上不算错误：世界照常过日子，状态行会写明离线。
   * 用 `?feed=off`（旧名 `?ledger=off` 也认）可以显式跑纯沙盒。
   */
  private connectFeed(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get('feed') === 'off' || params.get('ledger') === 'off') return;
    const events = createEventsClient();
    this.eventsClient = events;
    this.memoryClient = createMemoryClient();
    this.memoryOutbox = createMemoryOutbox(this.memoryClient);
    const client = new FeedClient({
      client: events,
      onUpdate: ({ fold, connected }) => {
        this.sim.enqueue({ kind: 'syncEvents', fold, connected });
      },
    });
    this.feedClient = client;
    client.start();
  }

  shutdown(): void {
    // 烘焙的纹理不随场景销毁自动释放，必须手动清：否则热更新或重进场景时
    // 会留下同名旧纹理，下一次 generateTexture 直接复用，画面停在上一版。
    this.terrainLayer?.destroy();
    this.settingScenery?.destroy();
    this.settingScenery = null;
    this.tideView?.destroy();
    this.harborView?.destroy();
    this.harborView = null;
    this.fogView?.destroy();
    this.weatherFogView?.destroy();
    this.weatherFogView = null;
    this.weatherStallsView?.destroy();
    this.weatherStallsView = null;
    this.cancelLongPress();
    if (this.contextMenuListener !== null) {
      this.game.canvas.removeEventListener('contextmenu', this.contextMenuListener);
      this.contextMenuListener = null;
    }
    this.feedClient?.stop();
    this.feedClient = null;
    this.eventsClient = null;
    this.memoryClient = null;
    this.memoryOutbox = null;
    this.creator = null;
    this.creationLedger = null;
    this.pendingCreationObservations.clear();
    this.overlay?.dispose();
    this.overlay = null;
    if (this.nightKeyListener !== null) {
      window.removeEventListener('keydown', this.nightKeyListener);
      this.nightKeyListener = null;
    }
    if (this.phaseTimer !== null) {
      window.clearInterval(this.phaseTimer);
      this.phaseTimer = null;
    }
    if (this.creationKeyListener !== null) {
      window.removeEventListener('keydown', this.creationKeyListener, true);
      this.creationKeyListener = null;
    }
    if (this.focusListener !== null) {
      document.removeEventListener('visibilitychange', this.focusListener);
      window.removeEventListener('focus', this.focusListener);
      window.removeEventListener('blur', this.focusListener);
      this.focusListener = null;
    }
    if (this.onPageHide !== null) {
      window.removeEventListener('pagehide', this.onPageHide);
      this.onPageHide = null;
    }
  }

  private drawAltar(originX: number, originY: number): void {
    const altarPx = this.world.altar;
    const ax = originX + altarPx.x * TILE_PX;
    const ay = originY + altarPx.y * TILE_PX;
    const cx = ax + TILE_PX / 2;

    // 地面光池：先画、depth 压在所有人之下。用 1px 抖动环，不用大半径 alpha 圆。
    const pool = this.add.graphics();
    pool.setDepth(ALTITUDE + ay - 8);
    pool.fillStyle(paletteFor().amber, 0.06);
    pool.fillRect(cx - 24, ay + 12, 48, 10);
    pool.fillStyle(paletteFor().amber, 0.1);
    pool.fillRect(cx - 18, ay + 14, 36, 6);
    pool.fillStyle(paletteFor().warmLight, 0.14);
    pool.fillRect(cx - 12, ay + 16, 24, 3);

    // 石龛：26×26，比旧的 44×44 小一半；底座两级、四柱、小屋顶、蜡烛与供品。
    // 视觉整体向右偏 8px：她站在祭坛点时不会正好挡住龛内的符文。
    const sx = cx + 12;
    const altar = this.add.graphics();
    // 底座第一步（最宽）
    altar.fillStyle(paletteFor().stone, 1);
    altar.fillRect(sx - 14, ay + 18, 28, 5);
    altar.fillStyle(paletteFor().plaza, 1);
    altar.fillRect(sx - 14, ay + 18, 28, 1);
    altar.fillStyle(paletteFor().soil, 1);
    altar.fillRect(sx - 14, ay + 22, 28, 1);
    // 底座第二步
    altar.fillStyle(paletteFor().plaza, 1);
    altar.fillRect(sx - 10, ay + 14, 20, 5);
    altar.fillStyle(paletteFor().stone, 1);
    altar.fillRect(sx - 10, ay + 18, 20, 1);
    // 四柱：左右各两根，柱头用 trim。
    for (const px of [sx - 12, sx + 9] as const) {
      altar.fillStyle(paletteFor().stone, 1);
      altar.fillRect(px, ay + 2, 3, 13);
      altar.fillStyle(paletteFor().plaza, 1);
      altar.fillRect(px, ay + 2, 1, 13);
      altar.fillStyle(paletteFor().trim, 1);
      altar.fillRect(px - 1, ay + 1, 5, 1);
    }
    // 小屋顶：两坡 + 屋脊，压在柱子上。
    altar.fillStyle(paletteFor().timberDark, 1);
    altar.fillRect(sx - 15, ay - 2, 30, 3);
    altar.fillRect(sx - 12, ay - 5, 24, 3);
    altar.fillStyle(paletteFor().trim, 1);
    altar.fillRect(sx - 13, ay - 5, 26, 1);
    altar.fillStyle(paletteFor().timberDark, 1);
    altar.fillRect(sx - 1, ay - 8, 2, 4);
    // 龛内暗部 + 符文
    altar.fillStyle(paletteFor().ink, 1);
    altar.fillRect(sx - 7, ay + 3, 14, 12);
    // 4 角星：竖/横 + 两条斜线，中央 pale 高光。不是“T”。
    altar.fillStyle(paletteFor().amber, 0.95);
    altar.fillRect(sx - 1, ay + 5, 2, 8);
    altar.fillRect(sx - 4, ay + 8, 8, 2);
    for (let step = 0; step < 3; step += 1) {
      altar.fillRect(sx - 3 + step, ay + 6 + step, 1, 1);
      altar.fillRect(sx + 2 - step, ay + 6 + step, 1, 1);
      altar.fillRect(sx - 3 + step, ay + 11 - step, 1, 1);
      altar.fillRect(sx + 2 - step, ay + 11 - step, 1, 1);
    }
    altar.fillStyle(paletteFor().warmLight, 1);
    altar.fillRect(sx, ay + 8, 1, 1);
    // 两支蜡烛：pale 烛身 + amber 火焰。
    for (const px of [sx - 12, sx + 11] as const) {
      altar.fillStyle(paletteFor().pale, 1);
      altar.fillRect(px, ay + 12, 1, 3);
      altar.fillStyle(paletteFor().warmLight, 1);
      altar.fillRect(px, ay + 10, 1, 1);
      altar.fillStyle(paletteFor().ember, 1);
      altar.fillRect(px, ay + 11, 1, 1);
    }
    // 供品：两块 trim/ember 小布包 + 苔。
    altar.fillStyle(paletteFor().trim, 1);
    altar.fillRect(sx - 6, ay + 18, 3, 2);
    altar.fillStyle(paletteFor().ember, 1);
    altar.fillRect(sx + 3, ay + 18, 3, 2);
    altar.fillStyle(paletteFor().moss, 1);
    for (let i = 0; i < 6; i += 1) {
      altar.fillRect(sx - 12 + i * 5, ay + 22, 2, 1);
    }
    altar.setDepth(ALTITUDE + ay + 24);
  }

  update(time: number, delta: number): void {
    this.updateCount += 1;

    // 捏合排在省电跳帧之前：镜头是输入，不该被后台降频拖住。
    // 这里看到的才是两根手指同一时刻的位置（见 `settlePinch` 的注释）。
    this.settlePinch();

    // 省电：后台时按最小间隔跳帧。**跳过的是这一帧的渲染与逻辑推进**。
    // 少的是帧数，不是世界时间——累加器按真实经过的时间补，所以推得粗一些
    // 而不错乱。但补齐有 `FRAME_CLAMP_MS` 的上限：间隔超过它的场合——隐藏
    // 标签页被浏览器压到 1fps——世界会实实在在地走慢，不补齐。
    //
    // 闸门在 `eco-mode.ts`（纯函数）。它保证「一次都没推进过时放过」，
    // 所以下面第一次推进就立得起基准；早先这里自己判，第一次永远判不过，
    // 失焦但仍在合成的窗口里世界一步都不走（实测 advanceCount 恒为 0）。
    if (!shouldAdvanceFrame(this.lastAdvanceAt, time, this.backgroundMode, this.minFrameIntervalMs)) return;
    // 累加的是**上一帧到现在**的真实间隔。第一次推进时 `lastAdvanceAt` 还是 0，
    // 减出来会是页面启动至今的时间，所以那一回拿本帧 delta 兜底。
    const elapsed = this.lastAdvanceAt === 0 ? delta : time - this.lastAdvanceAt;
    this.lastAdvanceAt = time;
    // 真正推进过的帧才计数：`updateCount` 统计的是 Phaser 的调用次数，
    // 跳帧时它仍然每帧加一，看不出降频。
    this.advanceCount += 1;
    // 造物模式暂停世界：幽灵预览期间不该有人走动或收工。
    // 只暂停推进，不清空累加器——退出后不会一次性补跑一大段。
    if (this.creation !== null) {
      this.accumulator = 0;
      this.snapshot = this.sim.snapshot();
      this.renderSnapshot(delta);
      return;
    }
    // 世界时间冻住（调试口子）：不推进模拟，但照常渲染。
    // 证明「世界时间不推进 → 动画不推进」时，不能靠停 rAF——那样连渲染都停了，
    // 证明不了任何东西；这里让每一帧都真画一遍，只是不给它新的世界时刻。
    if (this.holdWorld) {
      this.accumulator = 0;
      this.renderSnapshot(delta);
      this.cameraCtl.update(delta);
      return;
    }
    // 真实时钟：先看墙钟与单调时钟。暂停（回拨）时这一拍一步不走；离线跨了
    // 一大段（超过 `FRAME_CLAMP_MS`）时只推世界时钟，逐日关账交给记忆层，
    // 不把几天压进一帧去补跑行为。
    let paused = false;
    let catchUpCap = 0;
    if (this.clockMode === 'real' && this.realClock !== null) {
      const observed = this.realClock.observe(Date.now(), performance.now());
      if (observed.paused) {
        paused = true;
        this.accumulator = 0;
        this.clockNotice = '真实时钟已暂停：系统墙钟回拨超过 5 分钟';
      } else if (observed.deltaMs > FRAME_CLAMP_MS) {
        this.sim.fastForwardNow(observed.deltaMs);
        this.accumulator = 0;
        this.clockNotice =
          observed.dayGap > 0 ? `真实时钟：离线补算 ${observed.dayGap} 天` : null;
        catchUpCap = observed.dayGap > 0 ? OFFLINE_SETTLE_MAX_DAYS : 0;
      } else {
        this.clockNotice = null;
      }
    }
    // 收池子、跑几步，都在 `paceFrame` 里——纯函数，node 下能单测。
    const pace = paused
      ? { steps: 0, leftover: 0 }
      : paceFrame(this.accumulator, elapsed, LOGIC_STEP_MS, MAX_STEPS_PER_FRAME);
    this.accumulator = pace.leftover;
    let steps = 0;
    while (steps < pace.steps) {
      // 加速模式：倍率只放大「喂给 Simulation 的步长」，不引入第二个时钟——
      // 世界的可回放性仍然只取决于它收到的那串步长。
      // 真实时钟模式：步长恒为 `LOGIC_STEP_MS`，`timeScale` 不参与，
      // 于是墙钟走 1 秒、世界也走 1 秒。
      const stepMs = this.clockMode === 'real' ? LOGIC_STEP_MS : LOGIC_STEP_MS * this.timeScale;
      this.sim.setSocialContext(this.socialContextFromMemory());
      this.sim.setWeatherHabitLedger(this.weatherHabitFromMemory());
      const results = this.sim.update(stepMs);
      for (const result of results) {
        this.speak(result);
      }
      this.tick += 1;
      steps += 1;
    }
    this.snapshot = this.sim.snapshot();
    const skippedDays = this.stepMemory(catchUpCap > 0 ? catchUpCap : undefined);
    // 关过账才记历史。**在 `stepMemory` 之后**：那一拍的记忆整理已经做完，
    // 拿到的才是「这一天结束时的样子」。
    this.captureHistory();
    if (skippedDays > 0) {
      // 合并结算要让人看得见：状态行说清「跳过」多少天，而不是假装逐日都关了账。
      this.clockNotice = `真实时钟：离线合并结算，跳过 ${skippedDays} 天`;
    }
    this.renderSnapshot(delta);
    this.cameraCtl.update(delta);
    this.publishCameraMode();
    this.minimap?.update(this.snapshot, this.cameraCtl.viewportRect());
    // 只在 update() 返回后写档（命令已结算，ADR_SAVE §4）。
    this.maybeAutoSave();
    this.persistClockBaseline();
  }

  /**
   * 把「上次活跃的真实时刻 + 当时的世界时间」写进独立键。
   *
   * 不放进存档：锚点是这台设备的运行环境信息，不是世界的自有事实（见
   * `real-clock-baseline.ts` 文件头）。5 秒节流；`pagehide` 时强制写一次。
   */
  private persistClockBaseline(force = false): void {
    if (this.clockMode !== 'real' || this.realClock === null) return;
    if (this.realClock.isPaused) return;
    const wall = Date.now();
    if (!force && wall - this.lastClockBaselineWriteAt < 5_000) return;
    const storage = this.clockStorage();
    if (storage === null) return;
    const worldId = this.pack?.id ?? 'world';
    const ok = writeClockBaseline(storage, worldId, {
      lastWallMs: wall,
      lastWorldNow: this.sim.snapshot().now,
    });
    if (ok) this.lastClockBaselineWriteAt = wall;
  }

  private clockStorage(): BaselineStorage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  /**
   * 重开页面时按上一次会话的基线补齐离线天数。
   *
   * 复用 `RealClock` 的三条分支：`prime` 旧墙钟 → `observe` 当前墙钟，日界、
   * 回拨、>7 天合并都由同一个 `observe` 判定；世界时间只推给
   * `fastForwardNow`，日界结算仍走 `stepMemory → tickCapped → onVitals`。
   *
   * 没有基线（v1/v4 老档第一次用真实时钟）就 `start` 到现在：不凭空补历史。
   */
  private restoreRealClockBaseline(): void {
    if (this.clockMode !== 'real' || this.realClock === null) return;
    const storage = this.clockStorage();
    const worldId = this.pack?.id ?? 'world';
    const baseline = storage === null ? null : readClockBaseline(storage, worldId);
    const wall = Date.now();
    const mono = performance.now();

    if (baseline === null) {
      this.realClock.start(wall, mono);
      this.persistClockBaseline(true);
      return;
    }

    this.realClock.prime(baseline.lastWallMs, mono);
    const observed = this.realClock.observe(wall, mono);
    if (observed.paused) {
      // 系统时钟回拨 / 基线晚于当前时刻：按既有策略暂停，不静默把世界往前推。
      this.clockNotice = '真实时钟已暂停：系统墙钟回拨超过 5 分钟';
      return;
    }

    // 世界时间的目标值 = 基线世界时间 + 墙钟经过的时间。用目标值减当前存档
    // 的 now，既补上「上一次自动存档到关页面」的差，也不会倒退。
    const targetWorldNow = baseline.lastWorldNow + observed.deltaMs;
    const delta = Math.max(0, targetWorldNow - this.sim.snapshot().now);
    if (delta > 0) this.sim.fastForwardNow(delta);
    this.snapshot = this.sim.snapshot();

    // 结算走既有记忆关账；结果落成常驻状态，不再只活一帧。
    const skipped = this.stepMemory(
      observed.dayGap > OFFLINE_SETTLE_MAX_DAYS ? OFFLINE_SETTLE_MAX_DAYS : undefined,
    );
    if (observed.dayGap > 0) {
      this.clockReport = {
        kind: skipped > 0 ? 'merged' : 'day-by-day',
        days: observed.dayGap,
        skippedDays: skipped,
      };
    }
    this.persistClockBaseline(true);
  }

  /** 读档后初始化日界对齐：恢复「暂不 / 已对齐」决定，并按当前偏移决定要不要提示。 */
  private initClockAlignment(): void {
    // 默认的游玩时间驱动没有墙钟日界：**不检测、不提示、不读记录**。
    // 只有显式 `?clock=real` 才走下面这条路径。
    if (!clockAlignmentAvailable(this.clockMode)) {
      this.clockAlignRecord = null;
      this.clockAlignGate.hide();
      return;
    }
    const storage = this.clockStorage();
    const worldId = this.pack?.id ?? 'world';
    const stored = storage === null ? null : readClockAlignment(storage, worldId);
    this.clockAlignRecord = stored?.kind === 'applied' ? stored : null;
    this.clockAlignGate = new ClockAlignmentGate(
      stored?.kind === 'declined' ? stored.boundaryMs : null,
    );
    this.clockAlignGate.open(this.inspectAlignment());
  }

  private inspectAlignment(): ClockAlignmentProbe {
    return inspectClockAlignment(
      this.sim.snapshot().now,
      Date.now(),
      this.realClockOffsetMinutes,
    );
  }

  /** 对齐当天常驻状态行的一句话；过了这天就不再显示。 */
  private clockAlignmentDayNote(): string | null {
    const record = this.clockAlignRecord;
    if (record === null || record.kind !== 'applied') return null;
    if (this.clockMode !== 'real') return null;
    const currentDay = Math.floor(this.sim.snapshot().now / DAY_MS);
    if (currentDay !== record.dayBefore) return null;
    return `对齐日界，跳过 ${formatDuration(record.deltaMs)}；本日缩短为 ${formatDuration(
      DAY_MS - record.deltaMs,
    )}`;
  }

  private clockAlignmentView(): ClockAlignmentView {
    // 默认模式：连检测都不做。面板据此把维护入口置灰并说明。
    if (!clockAlignmentAvailable(this.clockMode)) {
      return {
        available: false,
        pending: false,
        required: false,
        boundaryLabel: '—',
        offsetMs: 0,
        deltaMs: 0,
        jumpLabel: '—',
        dayLengthAfterLabel: '—',
        aligned: false,
        undoAvailable: false,
        notice: null,
        dayNote: null,
      };
    }
    const probe = this.inspectAlignment();
    const applied = this.clockAlignRecord?.kind === 'applied' ? this.clockAlignRecord : null;
    // 已对齐后当前偏移是 0；读数仍要显示**这次对齐做了多少**，否则撤销入口
    // 会写成「前跳 0 小时 0 分」。
    const deltaMs = applied?.deltaMs ?? probe.deltaMs;
    return {
      available: true,
      pending: this.clockAlignGate.isVisible,
      required: probe.required,
      boundaryLabel: applied === null ? probe.boundaryLabel : formatBoundaryClock(applied.boundaryMs),
      offsetMs: applied === null ? probe.offsetFromMidnightMs : 0,
      deltaMs,
      jumpLabel: formatDuration(deltaMs),
      dayLengthAfterLabel: formatDuration(DAY_MS - deltaMs),
      aligned: applied !== null,
      undoAvailable: applied !== null,
      notice: this.clockAlignNotice,
      dayNote: this.clockAlignmentDayNote(),
    };
  }

  /** 设置/调试面板的「再次检查」：绕过「暂不」，但仍需要偏移超阈值才弹。 */
  private requestClockAlignmentCheck(): ClockAlignmentView {
    if (!clockAlignmentAvailable(this.clockMode)) {
      this.clockAlignGate.hide();
      this.clockAlignNotice = CLOCK_ALIGN_REAL_ONLY;
      return this.clockAlignmentView();
    }
    const probe = this.inspectAlignment();
    this.clockAlignNotice = this.clockAlignGate.reopen(probe)
      ? null
      : '日界已对齐，不需要迁移';
    return this.clockAlignmentView();
  }

  private declineClockAlignment(): ClockAlignmentView {
    if (!clockAlignmentAvailable(this.clockMode)) {
      this.clockAlignNotice = CLOCK_ALIGN_REAL_ONLY;
      return this.clockAlignmentView();
    }
    const probe = this.inspectAlignment();
    if (probe.required) {
      this.clockAlignGate.decline(probe);
      const storage = this.clockStorage();
      if (storage !== null) {
        writeClockAlignment(storage, this.pack?.id ?? 'world', {
          kind: 'declined',
          boundaryMs: probe.boundaryMs,
          wallMs: Date.now(),
        });
      }
      this.clockAlignNotice = '已暂不：日界保持不动';
    }
    return this.clockAlignmentView();
  }

  /**
   * 玩家点「对齐」才执行：世界时钟前跳 `deltaMs`，让下一个日界落在本地 00:00。
   *
   * 不点不动。对齐跳过的这段世界时间不逐拍重放；若跳变跨过日界，仍走既有
   * `stepMemory → dayClosed → onVitals → stepCreatorDayClosed` 结算。
   */
  private applyClockAlignment(): ClockAlignmentView {
    if (!clockAlignmentAvailable(this.clockMode) || this.realClock === null) {
      this.clockAlignNotice = CLOCK_ALIGN_REAL_ONLY;
      return this.clockAlignmentView();
    }
    const probe = this.inspectAlignment();
    if (!mayAlignClock(probe, this.realClock.isPaused)) {
      this.clockAlignGate.hide();
      this.clockAlignNotice = this.realClock.isPaused
        ? '墙钟回拨暂停中，先恢复时钟再对齐'
        : '日界已对齐，不需要迁移';
      return this.clockAlignmentView();
    }

    const fromNow = this.sim.snapshot().now;
    const record: ClockAlignmentRecord = {
      kind: 'applied',
      boundaryMs: probe.boundaryMs,
      deltaMs: probe.deltaMs,
      fromNow,
      toNow: fromNow + probe.deltaMs,
      dayBefore: Math.floor(fromNow / DAY_MS),
      wallMs: Date.now(),
    };
    this.sim.fastForwardNow(probe.deltaMs);
    this.snapshot = this.sim.snapshot();
    // 既有日界结算：跳变若跨过世界日界，不在这里另造一套关账。
    this.stepMemory();
    this.sim.realignAfterClockJump(probe.deltaMs);
    this.snapshot = this.sim.snapshot();
    this.clockAlignRecord = record;
    const storage = this.clockStorage();
    if (storage !== null) writeClockAlignment(storage, this.pack?.id ?? 'world', record);
    this.persistClockBaseline(true);
    this.clockAlignGate.hide();
    this.clockAlignNotice = null;
    return this.clockAlignmentView();
  }

  /**
   * 撤销对齐：把 `now` 放回**对齐前的原值**，相对定时器只回退对齐那一次跳量。
   *
   * 对齐之后世界可能已经正常走了几秒/几分钟；那些时间一并放回原值，才算
   * 「撤销」而不是「把 δ 减掉、留下一个中间值」。定时器只扣 `deltaMs`：
   * 它们从未被正常走的时长改写过。
   */
  private undoClockAlignment(): ClockAlignmentView {
    const record = this.clockAlignRecord;
    if (record === null || record.kind !== 'applied') {
      this.clockAlignNotice = '没有可撤销的对齐';
      return this.clockAlignmentView();
    }
    const rewind = this.sim.snapshot().now - record.fromNow;
    try {
      this.sim.rewindNow(rewind);
    } catch {
      this.clockAlignNotice = '撤销会让世界时钟回到负数，已拒绝';
      return this.clockAlignmentView();
    }
    this.sim.realignAfterClockJump(-record.deltaMs);
    this.snapshot = this.sim.snapshot();
    this.clockAlignRecord = null;
    const storage = this.clockStorage();
    if (storage !== null) clearClockAlignment(storage, this.pack?.id ?? 'world');
    this.persistClockBaseline(true);
    this.clockAlignNotice = '已撤销对齐：世界时钟回到原值';
    return this.clockAlignmentView();
  }

  /**
   * 记忆层跟上世界：对齐处境，跨日就关账。
   *
   * 只在这一拍真的推进过世界时做（`steps > 0` 由 `snapshot.now` 变化体现，
   * 这里不额外判——对齐是幂等的，重复对齐不会多记一条记忆）。
   *
   * 位置每拍都同步：传播要算「两个人隔多远」，而人在走动。不传位置的话，
   * `spreadCandidates` 会把所有人当成不知道在哪，于是**谁都不会说话**——
   * 那比传错位置更糟，因为它是静默的。
   */
  private stepMemory(maxDays?: number): number {
    if (this.memory === undefined) return 0;
    this.memory.syncHolders(
      this.snapshot.villagers.map((villager) => ({
        holderId: villager.id,
        type: 'character' as const,
        at: { x: villager.pos.x, y: villager.pos.y },
      })),
    );
    this.sightsee();
    // 真实时钟离线跨得太多天时只关一次账，并把这笔跳过的天数交回状态行。
    if (maxDays === undefined) {
      this.memory.tick(this.snapshot.now);
      return 0;
    }
    return this.memory.tickCapped(this.snapshot.now, maxDays).skippedDays;
  }

  /**
   * 一个世界日结束时的外环动作：结算天数、喂心电图、在允许时提议一次造物。
   *
   * **不替人点头。** L0–L2 的自治规则是「需要人工确认」，所以这里先问
   * `evaluateFuseDecision`；只有它说 `allow`（L3 抽检未抽中 / 已达 L4）才把
   * 计划放进队列。其余等级只结算、只提议，不改世界。
   */
  private stepCreatorDayClosed(vitals: {
    readonly day: number;
    readonly meanValence: number;
    readonly meanArousal: number;
    readonly infoEntropy: number;
    readonly isolatedHoldersCount: number;
  }): void {
    const creator = this.creator;
    if (creator === null) return;

    // 先结算观测与「还没落地」的账：这两件事只看已经发生的事实，
    // 与今天提不提议无关。
    this.settleDueLedgerObservations(vitals.day);
    this.settleStalePendingCreations(vitals.day);

    creator.closeWorldDay();
    creator.processDayClosed({
      meanValence: vitals.meanValence,
      meanArousal: vitals.meanArousal,
      infoEntropy: vitals.infoEntropy,
      isolatedHoldersCount: vitals.isolatedHoldersCount,
    });

    // 先问熔断（保留 L3 抽检的既有节拍），再算提案；**但被拒不再提前返回**。
    // 以前熔断不放行就不算计划，于是被拒的提议一条都进不了账——那正是最
    // 需要审计的拒绝原因被丢掉了。现在无论允不允许都记一条，世界改不改由
    // 判决决定。
    const decision = creator.getFuseDecision('mapper');
    const view = this.creatorWorldView();
    const proposal = creator.planCreation(view);
    if (proposal === null) return;

    const state = creator.getRoleState('mapper');
    const blueprint = this.blueprints.get(proposal.templateId);
    if (state === undefined || blueprint === undefined) return;

    const gates = evaluateProposalGates({
      origin: 'auto',
      schemaPassed: true,
      placementPassed: true,
      builtPrefabIds: view.builtPrefabIds,
      blueprintCount: this.blueprints.size,
      templateId: proposal.templateId,
      fuseAction: decision.action,
      fuseReason: decision.reason,
      traceable: true,
      schemaDetail: 'planCreation 产出的计划已过白名单形状',
      placementDetail: 'planCreation 只用 canPlace 判过合规的格子',
    });
    const verdict = creationVerdict('auto', gates);
    // 只有真会被放行的提案才领实例号：被拒的提议不该消耗世界的编号水位。
    const instanceId = verdict.verdict === 'accepted'
      ? this.sim.nextInstanceId(proposal.templateId)
      : null;
    // 记录 id 不直接等于 instanceId：读档重开后世界会重发同一串实例号，
    // 而账本的去重键是 recordId——那样会把两条真提案合成一条。落地记录里
    // 仍有 `buildingId`，所以「账本与建筑实例对得上」不靠 id 相等。
    const recordId = instanceId !== null
      ? newRecordId(`${this.ledgerWorldId}:${instanceId}`)
      : newRecordId(`${this.ledgerWorldId}:d${view.day}:${proposal.templateId}`);
    const now = this.sim.snapshot().now;
    const eventFrom = this.sim.snapshot().feed.cursor;
    const creation = buildCreationRecord({
      recordId,
      worldId: this.ledgerWorldId,
      seed: this.ledgerSeed,
      day: view.day,
      at: now,
      templateId: proposal.templateId,
      templateName: blueprint.displayName,
      templateKind: blueprint.zone,
      intentText: null,
      target: proposal.at,
      origin: 'auto',
      gates,
      ladder: ladderSnapshot(state, decision),
      replay: {
        seed: this.ledgerSeed,
        eventFrom,
        eventTo: eventFrom,
        dayFrom: view.day,
        dayTo: view.day,
        fingerprint: proposalFingerprint(this.ledgerSeed, view.day, proposal),
      },
    });
    this.recordLedger(creation);

    if (creation.verdict === 'rejected' || instanceId === null) return;

    // 落地前把 view 捕获下来，并把落位许可冻成位图：重跑时不能看见新楼占的格，
    // 否则算出来的是「落地后的下一个位置」，不再是同一份输入。
    const frozen = freezeCreatorView(
      view,
      [...this.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
    );
    this.pendingCreationObservations.set(instanceId, {
      plan: proposal,
      day: view.day,
      traceable: true,
      recompute: () => creator.planCreation(frozen),
      proposalId: creation.recordId,
      displayName: blueprint.displayName,
      origin: 'auto',
      eventFrom,
    });
    this.sim.enqueue({
      kind: 'build',
      prefabId: proposal.templateId,
      instanceId,
      at: proposal.at,
      source: { taskId: `creator-${proposal.templateId}`, summary: proposal.reason },
    });
  }

  /**
   * 楼真的落地之后，把两项「落位前算不准」的观测补进计数器。
   *
   * - `pathfindingConnected`：拿**落地后的**网格判门口到镇心。
   * - `replayHashConsistent`：用落地前捕获的输入重跑计划，与「计划内容 +
   *   实际落点」比指纹。跑不了（返回 `null`）就不记，留 `null`。
   *
   * 只有 `building.built` 会触发它；被拒的建造没有可取的真实落地结果，
   * 因此什么也不记——不拿预检结论冒充事后判定。
   */
  private settleCreationObservation(instanceId: string): void {
    const pending = this.pendingCreationObservations.get(instanceId);
    if (pending === undefined) return;
    this.pendingCreationObservations.delete(instanceId);

    const creator = this.creator;
    if (creator === null) return;
    const landed = this.landedCreationOf(instanceId);
    if (landed === null) return;

    const replayed = pending.recompute();
    const replay =
      replayed === null
        ? null
        : verifyCreationReplay({
            plan: pending.plan,
            replayed,
            landed,
            day: pending.day,
            blueprints: this.blueprints,
          });
    const pathfindingConnected = landingReachable(this.world, landed);

    // 第二重门禁在这里跑：快照与网格都是落地后的那一份。检查器接口是 Promise，
    // 但我们喂进去的每一项都是同步读，所以只差一个 microtask，不跨帧、不跨日。
    const businessWorld = {
      snapshot: this.sim.snapshot(),
      grid: this.world.grid,
      altar: this.world.altar,
      blueprints: this.blueprints,
    };
    // 覆盖率**在这一刻现算**，不读登记时的缓存：楼已经落地，快照就是落地后的世界。
    // 同一模板拆掉再建也算一次新观测——值可能仍是 1.0，但检查次数会 +1。
    const coverageRate = creationCoverage(businessWorld.snapshot, this.blueprints);
    void checkLandedBuilding(businessWorld, landed).then((business) => {
      // 场景已经换了一个世界（热重载/退出），这次结果不再属于任何引擎。
      if (this.creator !== creator) return;
      creator.submitHumanApproval('mapper', instanceId, true, undefined, {
        coverageRate,
        pathfindingConnected,
        hasCollision: false,
        spatialConstraintSatisfied: true,
        traceable: pending.traceable,
        // 这两项是**落地后**真跑业务规则得到的；`false` 是「查过且没有」。
        hasConflict: business.hasConflict,
        invariantViolated: business.invariantViolated,
        ...(replay === null ? {} : { replayHashConsistent: replay }),
      });

      const now = this.sim.snapshot().now;
      const currentDay = Math.floor(now / DAY_MS);
      const landing = buildLandingRecord({
        proposalId: pending.proposalId,
        worldId: this.ledgerWorldId,
        seed: this.ledgerSeed,
        day: currentDay,
        at: now,
        templateId: pending.plan.templateId,
        landed: true,
        buildingId: landed.instanceId,
        origin: landed.origin,
        door: landed.door,
        gates: evaluateLandingGates({
          origin: pending.origin,
          schemaPassed: true,
          placementPassed: true,
          builtPrefabIds: new Set(
            this.sim.snapshot().buildings.map((building) => building.prefabId),
          ),
          blueprintCount: this.blueprints.size,
          templateId: pending.plan.templateId,
          fuseAction: 'allow',
          fuseReason: '落地后补测，不再问自动放行',
          traceable: pending.traceable,
          actualCoverageRate: coverageRate,
          pathfindingConnected,
          hasCollision: business.hasConflict,
          spatialConstraintSatisfied: true,
          invariantViolated: business.invariantViolated,
          replayHashConsistent: replay,
        }),
        replay: {
          seed: this.ledgerSeed,
          eventFrom: pending.eventFrom,
          eventTo: this.sim.snapshot().feed.cursor,
          dayFrom: pending.day,
          dayTo: currentDay,
          fingerprint: landingFingerprint(
            this.ledgerSeed,
            pending.day,
            pending.plan,
            landed,
          ),
        },
        failure: null,
      });
      this.recordLedger(landing);
      // 第 7 个世界日再回来看它还在不在。只登记真落地的东西。
      this.pendingLedgerObservations.set(landed.instanceId, {
        proposalId: pending.proposalId,
        buildingId: landed.instanceId,
        dueDay: observationDueDay(pending.day),
        expected: {
          prefabId: landed.prefabId,
          origin: landed.origin,
          door: landed.door,
        },
        displayName: pending.displayName,
      });
    });
  }

  /**
   * 神谕/调试入口造出来的楼：落地时补记一条账。
   *
   * 这些入口不经过 `CreatorEngine`，所以提案阶段的门禁没跑过。账本如实写成
   * `origin: 'oracle' | 'world'`，把 schema/placement 标成「落地后倒推」，
   * 不伪造一份提案读数。
   */
  private recordUnplannedLanding(instanceId: string): void {
    const creator = this.creator;
    if (creator === null) return;
    const state = creator.getRoleState('mapper');
    if (state === undefined) return;
    const snapshot = this.sim.snapshot();
    const building = snapshot.buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) return;
    const blueprint = this.blueprints.get(building.prefabId);
    if (blueprint === undefined) return;

    const currentDay = Math.floor(snapshot.now / DAY_MS);
    const proposalId = newRecordId(`${this.ledgerWorldId}:${instanceId}`);
    const builtPrefabIds = new Set(snapshot.buildings.map((item) => item.prefabId));
    const plan: CreationPlan = {
      templateId: building.prefabId,
      at: building.origin,
      palette: building.palette,
    };
    // 来由：世界回写时 `source.taskId` 以 oracle-build- 开头就是神谕入口。
    const origin: CreationOrigin = (building.sourceTaskId ?? '').startsWith('oracle-build-')
      ? 'oracle'
      : 'world';
    const intentText = this.oracleTextFor(building.displayName);
    const creation = buildCreationRecord({
      recordId: proposalId,
      worldId: this.ledgerWorldId,
      seed: this.ledgerSeed,
      day: currentDay,
      at: snapshot.now,
      templateId: building.prefabId,
      templateName: building.displayName,
      templateKind: building.zone,
      intentText,
      target: building.origin,
      origin,
      gates: evaluateProposalGates({
        origin,
        schemaPassed: true,
        placementPassed: true,
        builtPrefabIds,
        blueprintCount: this.blueprints.size,
        templateId: building.prefabId,
        fuseAction: 'not_applicable',
        fuseReason: '这个入口不经过自动放行门禁',
        traceable: true,
        schemaDetail: '落地后倒推：这条指令被解析并建成了',
        placementDetail: '落地后倒推：楼已经在快照里',
      }),
      ladder: passiveLadderSnapshot(state),
      replay: {
        seed: this.ledgerSeed,
        eventFrom: snapshot.feed.cursor,
        eventTo: snapshot.feed.cursor,
        dayFrom: currentDay,
        dayTo: currentDay,
        fingerprint: proposalFingerprint(this.ledgerSeed, currentDay, plan),
      },
    });
    this.recordLedger(creation);

    const landed: LandedCreation = {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    };
    const pathfindingConnected = landingReachable(this.world, landed);
    const businessWorld = {
      snapshot,
      grid: this.world.grid,
      altar: this.world.altar,
      blueprints: this.blueprints,
    };
    const coverageRate = creationCoverage(snapshot, this.blueprints);
    void checkLandedBuilding(businessWorld, landed).then((business) => {
      if (this.creator !== creator) return;
      const landing = buildLandingRecord({
        proposalId,
        worldId: this.ledgerWorldId,
        seed: this.ledgerSeed,
        day: currentDay,
        at: this.sim.snapshot().now,
        templateId: building.prefabId,
        landed: true,
        buildingId: instanceId,
        origin: building.origin,
        door: building.door,
        gates: evaluateLandingGates({
          origin,
          schemaPassed: true,
          placementPassed: true,
          builtPrefabIds,
          blueprintCount: this.blueprints.size,
          templateId: building.prefabId,
          fuseAction: 'not_applicable',
          fuseReason: '这个入口不经过自动放行门禁',
          traceable: true,
          actualCoverageRate: coverageRate,
          pathfindingConnected,
          hasCollision: business.hasConflict,
          spatialConstraintSatisfied: true,
          invariantViolated: business.invariantViolated,
          // 神谕入口没有冻住落地前的 view，回放这一项**没跑**，记 null。
          replayHashConsistent: null,
        }),
        replay: {
          seed: this.ledgerSeed,
          eventFrom: snapshot.feed.cursor,
          eventTo: this.sim.snapshot().feed.cursor,
          dayFrom: currentDay,
          dayTo: currentDay,
          fingerprint: landingFingerprint(this.ledgerSeed, currentDay, plan, landed),
        },
        failure: null,
      });
      this.recordLedger(landing);
      this.pendingLedgerObservations.set(instanceId, {
        proposalId,
        buildingId: instanceId,
        dueDay: observationDueDay(currentDay),
        expected: {
          prefabId: building.prefabId,
          origin: building.origin,
          door: building.door,
        },
        displayName: building.displayName,
      });
    });
  }

  /** 账本入队后立刻试一次；失败留在队里，下一次自动存档再试。 */
  private recordLedger(record: LedgerRecord): void {
    const outbox = this.creationLedger;
    if (outbox === null) return;
    outbox.enqueue(record);
    void outbox.flush();
  }

  /**
   * 第 7 个世界日到了：仍在 / 被拆 / 被改 / 不见了。
   *
   * 观测只读快照与记忆层的读法，不改世界。
   */
  private settleDueLedgerObservations(closedDay: number): void {
    if (this.creationLedger === null) return;
    const snapshot = this.sim.snapshot();
    for (const [instanceId, item] of [...this.pendingLedgerObservations]) {
      if (closedDay < item.dueDay) continue;
      const current = snapshot.buildings.find((building) => building.instanceId === instanceId);
      const toponym = this.memory === undefined ? null : this.memory.placeNamesOf(instanceId);
      const outcome = ledgerObservationOf({
        expected: item.expected,
        current: current === undefined
          ? null
          : {
              prefabId: current.prefabId,
              origin: current.origin,
              door: current.door,
              displayName: current.displayName,
            },
        removed: this.removedBuildingIds.has(instanceId),
        renamedTo: toponym?.name ?? null,
      });
      this.recordLedger(buildObservationRecord({
        proposalId: item.proposalId,
        worldId: this.ledgerWorldId,
        day: closedDay,
        at: snapshot.now,
        dueDay: item.dueDay,
        buildingId: item.buildingId,
        status: outcome.status,
        detail: outcome.detail,
      }));
      this.pendingLedgerObservations.delete(instanceId);
    }
  }

  /**
   * 入队后一个世界日仍未落地的提议：记一条 `landed: false`。
   *
   * 不把它永远留在 `pendingCreationObservations` 里假装还在等——那会让账本
   * 少一条落地结论，而「等」与「没落地」是两件事。
   */
  private settleStalePendingCreations(closedDay: number): void {
    for (const [instanceId, pending] of [...this.pendingCreationObservations]) {
      if (closedDay < pending.day + 1) continue;
      if (this.landedCreationOf(instanceId) !== null) continue;
      this.pendingCreationObservations.delete(instanceId);
      const failure: RejectionReason = {
        gate: 'placement',
        observed: false,
        threshold: '= true',
        kind: 'below_requirement',
        detail: `入队后一个世界日仍未落地（${instanceId}）`,
      };
      const now = this.sim.snapshot().now;
      this.recordLedger(buildLandingRecord({
        proposalId: pending.proposalId,
        worldId: this.ledgerWorldId,
        seed: this.ledgerSeed,
        day: closedDay,
        at: now,
        templateId: pending.plan.templateId,
        landed: false,
        buildingId: null,
        origin: null,
        door: null,
        gates: [],
        replay: {
          seed: this.ledgerSeed,
          eventFrom: pending.eventFrom,
          eventTo: this.sim.snapshot().feed.cursor,
          dayFrom: pending.day,
          dayTo: closedDay,
          fingerprint: proposalFingerprint(this.ledgerSeed, pending.day, pending.plan),
        },
        failure,
      }));
    }
  }

  /** 神谕石板上与这栋楼对得上的原话；对不上就不编一句。 */
  private oracleTextFor(displayName: string): string | null {
    const stone = this.sim.snapshot().oracle;
    for (let index = stone.length - 1; index >= 0; index -= 1) {
      const record = stone[index];
      if (record !== undefined && record.receipt.includes(displayName)) return record.raw;
    }
    return null;
  }

  /** 从 `Simulation` 的当前快照里取那一栋；还没落地就返回 null。 */
  private landedCreationOf(instanceId: string): LandedCreation | null {
    const building = this.sim.snapshot().buildings.find((item) => item.instanceId === instanceId);
    if (building === undefined) return null;
    return {
      instanceId,
      prefabId: building.prefabId,
      origin: building.origin,
      door: building.door,
    };
  }

  /**
   * 喂给造物引擎的世界现状。
   *
   * `canPlace` 用**与手动造物同一套**判据（迷雾 / `checkPlacement` / 群落环），
   * 不另写一条更松的。引擎据此挑落点，落地时再由 `Simulation.build` 走
   * `placeBlueprint` 的同一套校验——两边都过，才不会「提议说行、落地被拒」。
   */
  private creatorWorldView(): CreatorWorldView {
    return {
      day: Math.floor(this.snapshot.now / DAY_MS),
      builtPrefabIds: new Set(this.snapshot.buildings.map((building) => building.prefabId)),
      width: this.world.grid.width,
      height: this.world.grid.height,
      canPlace: (prefabId, at) => {
        const blueprint = this.blueprints.get(prefabId);
        if (blueprint === undefined) return false;
        if (fogAt(at, this.snapshot.fog)) return false;
        if (!checkPlacement(this.world.grid, blueprint, at).ok) return false;
        return biomeRingAllows(prefabId, at, this.world.altar);
      },
    };
  }

  /**
   * 路过的痕迹。
   *
   * 痕迹通道在这之前没有调用方——`lookAtTraces` 只在测试里活着，于是
   * 「地点的物质化记忆」这句话在跑着的世界里是假的。这里把它接上：
   * 村民走到某栋楼跟前，就看一眼那栋楼留下了什么。
   *
   * **每栋楼每人每天只看一次**（`seenToday`）。账本自己现在也认这条性质
   * （`lookAtTraces` 里查过了就不写），所以这道闸不再是唯一一道——它省下
   * 的是每拍在记忆库里扫一遍的开销：一个人站在门口不动，没有它的话
   * 每一拍都要把整本记忆翻个底朝天，就为了得出「这条我早就记过了」。
   *
   * 地点 Holder 也要在名册里，否则 `traceRadius` 那道闸无从判定距离。
   */
  private sightsee(): void {
    if (this.memory === undefined) return;
    const day = Math.floor(this.snapshot.now / DAY_MS);
    if (this.seenDay !== day) {
      this.seenDay = day;
      this.seenToday.clear();
    }
    // 地点 Holder 每次对齐都补一遍：楼会被拆，但痕迹还在原地。
    //
    // `name` 是地名演变的起点（协议 §11）：记忆层拿它当**原名**，改名时
    // 在它后面挂称号。不传的话 `placeNameOf` 恒为 null，改名就永远没有起点。
    // 记忆层只认第一次登记的那个名字——楼名不会变，变的是地名。
    this.syncLandmarks();
    this.memory.syncHolders([
      ...this.snapshot.buildings.map((building) => ({
        holderId: building.instanceId,
        type: 'place' as const,
        at: { x: building.door.x, y: building.door.y },
        name: building.displayName,
      })),
      ...this.landmarkCells.map((cell) => ({
        holderId: cellPlaceId(cell),
        type: 'place' as const,
        at: { x: cell.x, y: cell.y },
        // **不传 `name`。** 作息点的 `label` 是「她在干什么」（「在旧站牌下认路」），
        // 不是地名。拿它当地名，协议 §11 的地名演变会把这个地方改成
        // 「在旧站牌下认路·张灯」——一句动作加一个称号。没有名字就不改名，照实。
      })),
    ]);
    // 拆掉的楼从名册里摘掉。留着的话，一栋不存在的楼会「听得见」任何
    // 发生在原地的传言，而 `spreadCandidates` 会把它当成听众。
    // 摘的是 Holder，不是痕迹——那儿原来有间铺子这件事，还该有人记得。
    const standing = new Set(this.snapshot.buildings.map((building) => building.instanceId));
    for (const placeId of this.placeHolders) {
      if (standing.has(placeId)) continue;
      this.memory.removePlace(placeId);
      // 面板正摆着一栋已经不在了的楼，就收起来。留着的话它会一直说着
      // 一个不存在的地方的活与痕迹——而屏幕上没有任何东西提示你它没了。
      if (this.lastBuildingView?.placeId === placeId) this.closeBuildingPanel();
    }
    this.placeHolders = standing;
    // 楼与地标一起看：只走楼的话，村民天天站在旧站牌上，也永远不知道那条路
    // 是被人踩出来的——痕迹就只剩画面上那几笔，进不了任何人的记忆。
    const places = [
      ...this.snapshot.buildings.map((building) => building.instanceId),
      ...this.landmarkCells.map((cell) => cellPlaceId(cell)),
    ];
    for (const villager of this.snapshot.villagers) {
      for (const placeId of places) {
        const key = `${villager.id}\u0000${placeId}`;
        if (this.seenToday.has(key)) continue;
        const inferred = this.memory.lookAtTraces(villager.id, placeId);
        if (inferred.length === 0) continue;
        this.seenToday.add(key);
      }
    }
  }

  /**
   * 作息落点里**不归楼**的那些，登记成地标。
   *
   * 归楼的落点（2 格内有门）由 `stepAmbient` 把事件记在那栋楼上，痕迹也就落在
   * 楼身上——这里再用同一把尺子（`footfallPlace`）把它们排除掉，否则同一个落点
   * 会有一栋楼和一个地标两个主人，而其中一个永远空着。
   *
   * 只在设定集世界里有：莞尔镇的 `pack` 是 null，一个地标也不登记，行为与从前
   * 逐字节相同。
   */
  private syncLandmarks(): void {
    if (this.pack === null) {
      this.landmarkCells = [];
      return;
    }
    const doorways: FootfallDoor[] = this.snapshot.buildings.map((building) => ({
      instanceId: building.instanceId,
      x: building.door.x,
      y: building.door.y,
    }));
    const cells: { readonly x: number; readonly y: number }[] = [];
    const seen = new Set<string>();
    for (const villager of this.pack.villagers) {
      for (const stop of villager.routine) {
        const key = `${stop.x},${stop.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (footfallPlace(stop, doorways) !== cellPlaceId(stop)) continue;
        cells.push({ x: stop.x, y: stop.y });
      }
    }
    cells.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    this.landmarkCells = cells;
  }

  /**
   * 地上的痕迹：作息落点（地标）与**拆掉的楼留下的废墟**。
   *
   * 与 `refreshDecals` 同一个入口（`placeHints`）、同一道闸，只是画在地上而不是
   * 墙上。签名没变就不重画——理由与楼那边一样：痕迹一天才风化一次。
   *
   * 废墟与地标共用这一层，不是省事：它们都是「地上还留着的东西」，画法也共用
   * `drawGroundDecals`。分成两层的话，同一块地上先有地标、后来立楼、再拆掉，
   * 它的痕迹会在两层之间搬一次家，而画面上不该看得出这次搬家。
   */
  private refreshGroundDecals(): void {
    if (this.memory === undefined) return;
    const places = [
      ...this.landmarkCells.map((cell) => ({ placeId: cellPlaceId(cell), at: cell })),
      ...this.ruinPlaces,
    ];
    if (places.length === 0) return;
    // 先看有没有变。签名里带 `visibility`，所以「今天风化了一格」也算变了。
    let changed = false;
    for (const place of places) {
      const signature = this.memory
        .placeHints(place.placeId)
        .map((hint) => `${hint.traceId}:${hint.visibility.toFixed(3)}`)
        .join('|');
      if (this.groundSignatures.get(place.placeId) === signature) continue;
      this.groundSignatures.set(place.placeId, signature);
      changed = true;
    }
    if (!changed) return;
    if (this.groundLayer === undefined) {
      // 地形烘焙在 -10，道具与人在 1000 以上（`ALTITUDE`）。痕迹是地上的东西：
      // 压在所有立着的东西之下，只浮在地形之上。
      this.groundLayer = this.add.graphics();
      this.groundLayer.setDepth(GROUND_DECAL_DEPTH);
    }
    // **整层重画，不是在旧的上面再叠一遍。** alpha 叠 alpha 会让同一块地
    // 每风化一天就深一格，而风化该让它**变浅**。
    this.groundLayer.clear();
    for (const place of places) {
      drawGroundDecals(
        this.groundLayer,
        this.memory.placeHints(place.placeId),
        place.at,
        TILE_PX,
        this.palette,
        this.terrainBaseOf(place.at),
      );
    }
  }

  /**
   * 墙上的痕迹。
   *
   * 记忆层算、这一层画：`memory.placeHints(楼id)` 是**唯一入口**（补充设计 §10
   * 「表现层只消费 ExpressionHint，不直接读记忆库」）。所以这里不去 `viewOf` 翻
   * `traces`——翻得动，就等于绕开了 `traceExposedLayers` 那道闸。
   *
   * 单子没变就不重画：痕迹一天才风化一次、出事才添一道，每拍重画是白烧。
   * 指纹里带着 `visibility`，所以「今天风化了一格」照样会被画出来。
   */
  private refreshDecals(entry: BuildingEntry): void {
    if (this.memory === undefined) return;
    const hints = this.memory.placeHints(entry.building.instanceId);
    const signature = hints
      .map((hint) => `${hint.traceId}:${hint.visibility.toFixed(3)}`)
      .join('|');
    if (this.decalSignatures.get(entry.building.instanceId) === signature) return;
    this.decalSignatures.set(entry.building.instanceId, signature);
    drawBuildingDecals(entry.view, hints, entry.building, this.palette);
  }

  // ------------------------------------------------------------------ input

  /**
   * 网页与终端共用这一个口子。原话整句交给世界，解析与刻石板都在 `Simulation` 里。
   *
   * 这里只负责投递：认不认得出要等下一拍结算，所以本地只挡空句子，
   * 其余一律投递并返回"已投递"。真正的回执走 `onResult`。
   */
  say(text: string): CommandResult {
    if (text.trim() === '') return { ok: false, message: '说点什么吧。' };
    // 命令不直接改世界，排进队列，由下一个逻辑步统一结算。
    this.sim.enqueue({ kind: 'oracle', raw: text });
    return { ok: true, message: '神谕已投递，随下一拍生效。' };
  }

  dispatch(kind: 'code' | 'research' | 'writing' | 'quick', summary: string): void {
    this.sim.enqueue({ kind: 'dispatch', taskKind: kind, summary });
  }

  /** 人工交付；target 可选（id 或名字），省略时收第一个在干活的人的单。 */
  finish(target?: string): void {
    this.sim.enqueue(target === undefined ? { kind: 'complete' } : { kind: 'complete', target });
  }

  build(prefabId: string): void {
    // 编号由世界发（`nextInstanceId`），不在场景层拿 `buildings.length` 现算：
    // 拆一栋再建一栋会拿到用过的号，旧 id 就指向了新楼。
    this.sim.enqueue({ kind: 'build', prefabId, instanceId: this.sim.nextInstanceId(prefabId) });
  }

  /**
   * 洗一件摆件（SPEC_V2 §4.6 的清洗即还原）。这是玩家对世界做的那一下。
   *
   * 为什么在场景层而不是神谕里：清洗是**摸到东西**的那个动作，不是说一句话。
   * 神谕走 `IntentKind`（模型能说的白名单），而这条与 `setCarries` /
   * `setNameState` 同属客户端命令——服务端收不到，`server/tests/test_rules_schema.py`
   * 钉着这一条。
   *
   * 不判断脏不脏：那是世界的事（`cleanProp` 会照实说「本来就是干净的」）。
   * 场景层先替它拒一遍的话，同一句实话就有两个家，而对不上的那个更早说话。
   */
  wash(propId: string): CommandResult {
    this.sim.enqueue({ kind: 'cleanProp', propId });
    return { ok: true, message: '洗了，随下一拍生效。' };
  }

  /** 世界坐标上有没有一件可洗的摆件。点空白处不该弹出任何回执。 */
  propAtCell(at: GridPoint): WorldProp | null {
    return this.snapshot.props.find((prop) => prop.at.x === at.x && prop.at.y === at.y) ?? null;
  }

  /**
   * 指针底下那格上的摆件，洗掉它。空白处什么也不做。
   *
   * 取格而不是取对象：摆件是 Graphics，命中测试要么给它加交互区（那会拦掉
   * 拖镜头），要么按格反查。按格反查与「这座世界就是格」是同一个模型，
   * 也顺带不会因为缩放级别变化而点空。
   */
  private washUnder(pointer: Phaser.Input.Pointer): void {
    if (this.creation !== null) return;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const at = {
      x: Math.floor(world.x / TILE_PX),
      y: Math.floor(world.y / TILE_PX),
    };
    const prop = this.propAtCell(at);
    if (prop === null) return;
    this.wash(prop.id);
  }

  /**
   * 指针底下那一格上站着的人。没有就是 null。
   *
   * 与 `washUnder` 同一套「世界就是格」的模型：按格反查，不给精灵加交互区——
   * 那会拦掉拖镜头，而拖镜头是这一屏最常用的动作。
   *
   * 判据在 `villagerAtCell` 里（`world/types.ts`），不在这儿现写一遍：那条
   * 判据吃过一次亏——写成 `pos.x === x` 时，站着的人点得到、走着的人永远点不到。
   */
  private villagerAt(pointer: Phaser.Input.Pointer): WorldSnapshot['villagers'][number] | null {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return villagerAtCell(
      this.snapshot.villagers,
      Math.floor(world.x / TILE_PX),
      Math.floor(world.y / TILE_PX),
    );
  }

  /** 指针下的单位（先人后楼），给右键与长按共用。 */
  private unitRefAt(pointer: Phaser.Input.Pointer): UnitRef | null {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return unitAtCell(
      this.unitStatusWorld(),
      Math.floor(world.x / TILE_PX),
      Math.floor(world.y / TILE_PX),
    );
  }

  /**
   * 右键：直接开这个单位的上下文面板（人→记忆，楼→楼志）。
   * 空白处返回 false，什么也不做——右键空白不该报错，也不该洗地。
   */
  private openContextPanelAt(pointer: Phaser.Input.Pointer): boolean {
    const ref = this.unitRefAt(pointer);
    if (ref === null) return false;
    this.openContextPanelForRef(ref);
    return true;
  }

  private openContextPanelForRef(ref: UnitRef): void {
    if (ref.kind === 'villager') this.lookAtVillager(ref.id);
    else this.openBuilding(ref.id);
  }

  /**
   * 第二根触屏手指落下：进入捏合。
   *
   * 返回 `true` 表示这次按下已被捏合吃掉，调用方不要再走长按 / 拖图 / 单击。
   * 单指路径的判据都建立在「一根手指」上；两指时它们全不成立。
   */
  private beginPinchIfTwo(): boolean {
    const pair = this.pinchPair();
    if (pair === null) return false;
    const [a, b] = pair;
    this.cancelLongPress();
    this.suppressClickUp = true;
    this.dragFrom = null;
    this.pressMoved = true;
    // 每次都按当前间距重新起算：第一下是手势开始，中途再落一根也不在旧基准上续。
    this.pinch = beginPinchZoom(Math.hypot(b.x - a.x, b.y - a.y));
    return true;
  }

  /**
   * 捏合中一次指针移动：**只记账，不立刻换档**。
   *
   * Phaser 的 `pointermove` 是**逐指**派发的：一次两指 `touchmove` 会来两拍，
   * 第一拍里只有一根手指到了新位置，另一根还是上一拍的值。拿这种半新半旧
   * 的间距去算中点，锚点就会偏（实测两指 80→200 时中点被算成 228 而不是 240，
   * 画面因此漂 2 世界px）。等这一帧的 `update()` 再看，两指位置才是同一时刻的。
   */
  private applyPinch(): boolean {
    if (this.pinch === null) return false;
    this.pinchPending = true;
    // 手指在画面里动也算用户输入：捏合刚结束，镜头不该被闲置导播接走。
    this.cameraCtl.notifyInput();
    return true;
  }

  /** 每帧开头结算一次捏合：这时两根手指的位置都属于这一拍。 */
  private settlePinch(): void {
    if (!this.pinchPending) return;
    this.pinchPending = false;
    const state = this.pinch;
    if (state === null) return;
    const pair = this.pinchPair();
    // 已经不足两指：手势还没结束（要等全部抬起），这一帧不换档。
    if (pair === null) return;
    const [a, b] = pair;
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const step = pinchZoomStep(state, distance);
    this.pinch = step.state;
    if (step.direction !== 0) {
      this.cameraCtl.zoomStepAt(step.direction, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }

  /** 前两根触屏手指的位置；不足两根返回 null。 */
  private pinchPair(): [
    { readonly x: number; readonly y: number },
    { readonly x: number; readonly y: number },
  ] | null {
    if (this.touches.size < 2) return null;
    const [a, b] = [...this.touches.values()];
    if (a === undefined || b === undefined) return null;
    return [a, b];
  }

  /** 触屏长按：500ms 后开上下文面板；桌面鼠标不走这条。 */
  private beginLongPress(pointer: Phaser.Input.Pointer): void {
    if (!pointer.wasTouch) return;
    this.cancelLongPress();
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const cell = {
      x: Math.floor(world.x / TILE_PX),
      y: Math.floor(world.y / TILE_PX),
    };
    const ref = unitAtCell(this.unitStatusWorld(), cell.x, cell.y);
    if (ref === null) return;
    this.longPressRef = ref;
    this.longPressCell = cell;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      const target = this.longPressRef;
      const origin = this.longPressCell;
      this.longPressRef = null;
      this.longPressCell = null;
      if (target === null || origin === null) return;
      // 指针没动（动了 pointermove 会 cancel），但世界在动：触发前按同一格再查一次。
      // 人走开、换人、离场都不算长按——按下的那一刻已经不能代表此刻。
      const underPointer = unitAtCell(this.unitStatusWorld(), origin.x, origin.y);
      const stillOnTarget = underPointer !== null
        && underPointer.kind === target.kind
        && underPointer.id === target.id;
      if (!longPressShouldFire(LONG_PRESS_MS, stillOnTarget)) return;
      // 长按已处理这次按下：抬手时不再叠开状态菜单。
      this.suppressClickUp = true;
      this.openContextPanelForRef(target);
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressRef = null;
    this.longPressCell = null;
  }

  /** 点到人：开只读状态菜单。命中判据仍是 `villagerAt`。 */
  private openVillagerStatusAt(pointer: Phaser.Input.Pointer): boolean {
    const villager = this.villagerAt(pointer);
    if (villager === null) return false;
    this.openUnitStatus({ kind: 'villager', id: villager.id });
    return true;
  }

  /** 点到楼（整块占地）：开只读状态菜单。 */
  private openBuildingStatusAt(pointer: Phaser.Input.Pointer): boolean {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(world.x / TILE_PX);
    const y = Math.floor(world.y / TILE_PX);
    const building = this.snapshot.buildings.find(
      (item) =>
        x >= item.origin.x
        && x < item.origin.x + item.footprint.w
        && y >= item.origin.y
        && y < item.origin.y + item.footprint.h,
    );
    if (building === undefined) return false;
    this.openUnitStatus({ kind: 'building', id: building.instanceId });
    return true;
  }

  private seedCastGenesis(): void {
    const pack = this.pack;
    if (pack === null) return;
    const byName = new Map(this.snapshot.villagers.map((villager) => [villager.name, villager.id]));
    for (const villager of pack.villagers) {
      const archive = villager.archive;
      if (archive === undefined) continue;
      const holderId = byName.get(villager.name);
      if (holderId === undefined) continue;
      const bonds = archive.bonds.flatMap((bond) => {
        const to = byName.get(bond.to);
        if (to === undefined) return [];
        return [{
          to,
          trust: bond.trust,
          warmth: bond.warmth,
          debt: bond.debt,
          familiarity: bond.familiarity,
        }];
      });
      this.memory.seedGenesis({
        holderId,
        at: villager.at,
        atMs: this.snapshot.now,
        text: archiveMemoryText(villager.name, archive),
        bonds,
      });
    }
  }

  private castArchiveMap(): Readonly<Record<string, VillagerArchive>> {
    const out: Record<string, VillagerArchive> = {};
    const pack = this.pack;
    if (pack === null) return out;
    const byName = new Map(this.snapshot.villagers.map((villager) => [villager.name, villager.id]));
    for (const villager of pack.villagers) {
      if (villager.archive === undefined) continue;
      const id = byName.get(villager.name);
      if (id !== undefined) out[id] = villager.archive;
    }
    return out;
  }

  private unitStatusWorld(): UnitStatusWorld {
    return {
      now: this.snapshot.now,
      altar: this.snapshot.altar,
      villagers: this.snapshot.villagers,
      buildings: this.snapshot.buildings,
      tasks: this.snapshot.tasks,
      workstations: this.snapshot.workstations,
      constructions: this.snapshot.constructions,
      archives: this.castArchiveMap(),
    };
  }

  /** 只读记忆适配：只把面板要的字段拿出去，不把可变世界交给 DOM。 */
  private unitMemoryReader(): UnitMemoryReader {
    return {
      viewOf: (holderId) => {
        const view = this.memory?.viewOf(holderId);
        if (view === null || view === undefined) return null;
        return {
          memories: view.memories.map((entry) => ({
            kind: entry.kind,
            who: entry.content.who,
            valence: entry.content.valence,
            arousal: entry.content.arousal,
            createdDay: entry.createdDay,
            redacted: entry.redacted,
          })),
        };
      },
      bondsOf: (holderId) => this.memory?.bondsOf(holderId) ?? [],
      dayTimelineOf: (holderId, day) => this.dayTimelineWithWhy(holderId, day),
      moodOf: (holderId) => this.memory?.moodOf(holderId) ?? null,
      innerVoiceOf: (holderId) => this.memory?.innerVoiceOf(holderId) ?? null,
    };
  }

  private unitStatusView(): UnitStatusView | null {
    if (this.unitStatusSelection === null) return null;
    const world = this.unitStatusWorld();
    const content = buildUnitStatus(world, this.unitStatusSelection, this.unitMemoryReader());
    if (content === null) return null;
    const cell = anchorCellOf(world, this.unitStatusSelection);
    if (cell === null) return null;
    const viewport = this.cameraCtl.viewportRect();
    const canvasRect = this.game.canvas.getBoundingClientRect();
    // 相机 zoom 只把游戏像素放大；画布内部 480px 还会被 CSS 拉成两倍。
    // 面板锚点必须用「每世界像素 = 多少屏幕像素」的有效倍率，否则偏移半屏。
    const cssScale = canvasRect.width / this.cameras.main.width;
    const pixelsPerWorldPx = this.cameras.main.zoom * cssScale;
    return {
      content,
      anchor: screenAnchorForCell(cell, viewport, pixelsPerWorldPx, canvasRect),
    };
  }

  private openUnitStatus(selection: UnitRef): void {
    // 左键状态菜单与右键/长按的记忆、楼志互斥。
    this.closeVillagerPanel();
    this.closeBuildingPanel();
    this.unitStatusSelection = selection;
    this.publishUnitStatus();
  }

  private publishUnitStatus(): void {
    if (this.unitStatusSelection === null) {
      this.lastUnitStatus = null;
      for (const listener of this.unitStatusListeners) listener(null);
      return;
    }
    const view = this.unitStatusView();
    if (view === null) {
      // 单位不在了（楼拆了/人没了）：收起，不摆一份旧数据。
      this.unitStatusSelection = null;
      this.lastUnitStatus = null;
      for (const listener of this.unitStatusListeners) listener(null);
      return;
    }
    this.lastUnitStatus = view;
    for (const listener of this.unitStatusListeners) listener(view);
  }

  /** 收起状态菜单。只改界面选择，不碰世界，也不暂停。 */
  dismissUnitStatus(): void {
    if (this.unitStatusSelection === null) return;
    this.unitStatusSelection = null;
    this.publishUnitStatus();
  }

  /**
   * 点一个村民：镜头跟住她，并读出她此刻想得起的事。
   *
   * 读的是 `recallForDialogue`（Top-3），**`commit: false`**：面板是读，不是对话。
   * `commit` 会强化、可能变形，还往事件流写 `memory.recalled`——一次点击就改了
   * 世界状态，而且连点能把某条记忆强化得比事实更牢。协议里重构性回忆是留给
   * 真正的交谈的，不给一次点击。
   *
   * `cues: {}` 是有意的：不带地点/人物线索时相关度给中性 0.5，排序实际由近因
   * 与显著度决定，这正是「她现在想得起什么」。归档的条目默认不参与——她不会
   * 无缘无故想起被压下去很久的事。
   */
  lookAtVillager(villagerId: string): void {
    const villager = this.snapshot.villagers.find((item) => item.id === villagerId);
    if (villager === undefined) return;
    // 同一时间只开一个单位面板：记忆面板打开时收掉楼志与状态菜单。
    this.closeBuildingPanel();
    this.dismissUnitStatus();

    const view = this.villagerViews.get(villagerId);
    if (view !== undefined) this.cameraCtl.follow(view.container);

    const nowDay = this.memory?.day ?? 0;
    const lines =
      this.memory === undefined
        ? []
        : memoryVoice(
            this.memory.recallForDialogue(villagerId, {
              cues: {},
              commit: false,
              nowDay,
              seedKey: `villager-panel:${villagerId}`,
            }).hits,
            nowDay,
            // 「从谁听来」的名字从现成的名册上查（`snapshot.villagers`），
            // 不另存一份 id→name。查不到就是 null，面板那边照实说
            // 「从一个不在这张图上的人听来」——楼会被拆、人可能不在场，
            // 那些都是真实状态，而裸 id 既不是名字也不是状态。
            (holderId) =>
              this.snapshot.villagers.find((item) => item.id === holderId)?.name ?? null,
          );
    const next: VillagerMemoryView = { id: villager.id, name: villager.name, lines };
    this.lastVillagerMemory = next;
    for (const listener of this.villagerMemoryListeners) listener(next);
  }

  /**
   * 世界刚发生的事如果有落点，就转手给导播。
   *
   * 只转手，不判断「该不该看」——那个判断在控制器里（只有已经处于导播时才理会），
   * 因为只有它知道镜头现在归谁。自由与跟随模式下这里什么也不会发生。
   */
  private focusCameraOn(change: WorldChange): void {
    if (this.cameraCtl === undefined) return;
    if (change.change === 'world.event') {
      this.cameraCtl.notifyEvent({ x: change.where.x * TILE_PX, y: change.where.y * TILE_PX });
      return;
    }
    if (change.change === 'miracle') {
      this.cameraCtl.notifyEvent({ x: change.at.x * TILE_PX, y: change.at.y * TILE_PX });
    }
  }

  /**
   * 镜头模式变了就广播一次。
   *
   * 必须推、不能靠面板轮询：导播是闲置 15 秒后**自己**接管的，那一刻没有用户
   * 操作、也没有别的状态变化——轮询要等到下一次别的什么发生才跟上，按钮就
   * 一直停在旧的按下态上。
   */
  private publishCameraMode(): void {
    const mode = this.cameraCtl.mode();
    if (mode === this.lastCameraMode) return;
    const left = this.lastCameraMode;
    this.lastCameraMode = mode;
    // 面板与镜头不许各说各的：镜头一旦离开跟随（拖拽、滚轮、小地图、按了
    // 自由/导播），面板就收起。否则屏幕上还摆着「她在想什么」，镜头却已经
    // 不看她了——玩家会以为那几句话是此刻正在发生的事。
    if (left === 'follow' && mode !== 'follow') this.closeVillagerPanel();
    for (const listener of this.cameraModeListeners) listener(mode);
  }

  /** 收起面板。广播 `null` 而不是只藏 DOM：晚订阅的人也不该再看见一个已经关掉的她。 */
  private closeVillagerPanel(): void {
    if (this.lastVillagerMemory === null) return;
    this.lastVillagerMemory = null;
    for (const listener of this.villagerMemoryListeners) listener(null);
  }

  // ------------------------------------------------------------------ 碑

  /**
   * 打开碑：读出此刻立着的传说，排好序，交给面板。
   *
   * 读的是 `MemoryRuntime.legends()`（转发 `world.legendsOf()`），**不调模型、
   * 不改世界**。截断在这一层做而不是在 `steleLines` 里：纯函数返回全部，
   * 测试要能数清总共有几条；面板拿到的是「摆几条 + 还有几条没摆」。
   */
  openStele(): void {
    if (this.memory === undefined) return;
    const all = steleLines(this.memory.legends(), this.memory.day);
    const next: SteleView = {
      lines: all.slice(0, STELE_MAX_LINES),
      hidden: Math.max(0, all.length - STELE_MAX_LINES),
    };
    this.lastSteleView = next;
    for (const listener of this.steleListeners) listener(next);
  }

  /**
   * 收起碑面板。广播 `null` 而不是只藏 DOM——晚订阅的人不该再看见一块
   * 已经关掉的碑。
   *
   * 与村民面板不同，**这里不松镜头**：碑不跟镜头，点了它镜头没动过。
   */
  private closeStelePanel(): void {
    if (this.lastSteleView === null) return;
    this.lastSteleView = null;
    for (const listener of this.steleListeners) listener(null);
  }

  /**
   * 指针底下那一格上有没有碑。有就开面板，返回 true。
   *
   * 碑是 `pack.scenery` 里的一条数据（`kind: 'stele'`），**不占格**——所以它和
   * 「那格上站着的人」不会抢格子，但两者都在同一套「世界就是格」的命中模型里：
   * 先比村民（人在上面），再比碑，两个都不中才退回洗地。
   */
  private openSteleAt(pointer: Phaser.Input.Pointer): boolean {
    const stele = this.pack?.scenery.find((item) => item.kind === 'stele');
    if (stele === undefined) return false;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = Math.floor(world.x / TILE_PX);
    const y = Math.floor(world.y / TILE_PX);
    if (stele.at.x !== x || stele.at.y !== y) return false;
    this.openStele();
    return true;
  }

  // ------------------------------------------------------------------ 楼



  /**
   * 打开一栋楼的面板：名字、接什么活、此刻在干什么、墙上留着什么。
   *
   * 四行四个来源，一个都不新造：名字与历史链读 `MemoryRuntime.placeNamesOf`
   * （协议 §11），活读 `boundTask`，状态读工位快照，痕迹读 `placeHints`——
   * **与画在墙上的那一份同源**（补充设计 §10：表现层只消费 ExpressionHint）。
   *
   * 面板是**打开那一刻的快照**，与村民面板同一条：点一下看一次，不追着世界跑。
   * 唯一的例外是改名——`toponym.changed` 落地时会把开着的那一栋刷新一遍，
   * 因为「它刚换了名字」正是这块面板存在的理由。
   */
  openBuilding(placeId: string): void {
    const view = this.buildingViewOf(placeId);
    if (view === null) return;
    // 同一时间只开一个单位面板：楼志打开时收掉记忆与状态菜单。
    this.closeVillagerPanel();
    this.dismissUnitStatus();
    this.lastBuildingView = view;
    for (const listener of this.buildingListeners) listener(view);
  }

  /** 收起楼面板。广播 `null`，晚订阅的人不该再看见一个已经关掉的楼。 */
  private closeBuildingPanel(): void {
    if (this.lastBuildingView === null) return;
    this.lastBuildingView = null;
    for (const listener of this.buildingListeners) listener(null);
  }

  /**
   * 一栋楼此刻该读成什么样。楼不在了就是 `null`——**不编一栋出来**。
   *
   * 名字兜底用 `displayName`：记忆层还没登记过这栋楼（刚建起来、或记忆层
   * 没开）时，楼自己的名字仍然是真的，只是还没有历史链。
   */
  private buildingViewOf(placeId: string): BuildingPanelView | null {
    const building = this.snapshot.buildings.find((item) => item.instanceId === placeId);
    if (building === undefined) return null;
    const toponym = this.memory?.placeNamesOf(placeId) ?? null;
    const hints = this.memory?.placeHints(placeId) ?? [];
    const activity: BuildingActivity =
      this.snapshot.workstations.find((station) => station.buildingId === placeId)?.activity.kind
      ?? 'idle';
    // 改名的由头引的是**碑上那句话**（`Legend.variants` 的第一种讲法），不是
    // 事件 id：内部编号上纸面，读起来就是另一件事了。查不到那条传说就照实
    // 只写「第 N 天改成…」，不编一个理由。
    const legends = this.memory?.legends() ?? [];
    return {
      placeId,
      name: toponym?.name ?? building.displayName,
      history: (toponym?.history ?? []).map((entry) => {
        const legend = legends.find((item) => item.eventRefs.includes(entry.fromEventRef));
        return {
          day: entry.day,
          name: entry.name,
          because: legend?.variants[0] ?? null,
        };
      }),
      task: building.boundTask,
      activity,
      traces: hints.map((hint) => ({ layer: hint.layer, visibility: hint.visibility })),
    };
  }

  // -------------------------------------------------------------- 造物模式

  /**
   * 进入造物模式。世界就此暂停，直到确认或取消。
   *
   * 模式只活在场景层：`Simulation` 不知道有这回事，存档里也没有它的位置。
   */
  beginCreation(prefabId: string): CommandResult {
    const blueprint = this.blueprints.get(prefabId);
    if (blueprint === undefined) return { ok: false, message: '没有这份蓝图。' };
    if (this.snapshot.buildings.some((building) => building.prefabId === prefabId)) {
      return { ok: false, message: '这种铺子已经有一栋了。' };
    }
    this.creation = { prefabId, ghostAt: null };
    this.ghost.hide();
    // 把焦点从按钮上拿走：否则回车会被浏览器当成「再点一次那个按钮」，
    // 模式刚确认又重新打开。焦点交给 body，键盘事件才由页面统一处理。
    (document.activeElement as HTMLElement | null)?.blur?.();
    return { ok: true, message: '选个位置：移动指针，回车确认，Esc 取消。' };
  }

  /** 指针移到某格时更新幽灵。不在造物模式里就什么也不做。 */
  hoverCell(cell: GridPoint): void {
    const session = this.creation;
    if (session === null) return;
    const blueprint = this.blueprints.get(session.prefabId);
    if (blueprint === undefined) return;
    this.creation = { ...session, ghostAt: cell };
    const check = this.canPlaceBlueprintHere(blueprint, cell);
    this.ghost.show(cell, blueprint, check.ok);
    this.publishCreationHint(check.ok ? '可以建在这里，回车确认。' : check.message);
  }

  /** 确认施工。没有幽灵位置时拒绝，不猜一个地方。 */
  confirmCreation(): CommandResult {
    const session = this.creation;
    if (session === null) return { ok: false, message: '不在造物模式。' };
    if (session.ghostAt === null) {
      return { ok: false, message: '先把指针移到想建的位置。' };
    }
    const blueprint = this.blueprints.get(session.prefabId);
    if (blueprint === undefined) return { ok: false, message: '没有这份蓝图。' };
    const check = this.canPlaceBlueprintHere(blueprint, session.ghostAt);
    if (!check.ok) {
      // 留在造物模式里让玩家换个位置，并说明为什么这里不行。
      return { ok: false, message: check.message };
    }
    const instanceId = this.sim.nextInstanceId(session.prefabId);
    const creator = this.creator;
    if (creator === null) return { ok: false, message: '造物引擎没有起来。' };

    // 玩家的选择先拼成一份**造物意图**，交给造物引擎过白名单形状校验，
    // 再由 `Simulation.enqueue` 落位。手动造物与外环产出的计划共用这一条通道，
    // 没有第二套写世界的入口。色板是**这套设定集**的，不是全局 24 色表。
    const intentPalette = {
      body: tokenNameOf(blueprint.palette.body, this.worldPalette()),
      roof: tokenNameOf(blueprint.palette.roof, this.worldPalette()),
      trim: tokenNameOf(blueprint.palette.trim, this.worldPalette()),
      window: tokenNameOf(blueprint.palette.window, this.worldPalette()),
    };
    const request = {
      templateId: session.prefabId,
      at: session.ghostAt,
      palette: intentPalette,
      worldSize: { width: this.world.grid.width, height: this.world.grid.height },
    };
    const state = creator.getRoleState('mapper');
    const currentDay = Math.floor(this.snapshot.now / DAY_MS);
    const eventFrom = this.sim.snapshot().feed.cursor;
    const builtPrefabIds = new Set(this.snapshot.buildings.map((item) => item.prefabId));
    let plan: CreationPlan;
    try {
      plan = creator.proposeCreation(request);
    } catch (error) {
      // schema 不过就是玩家的选择有问题：留在模式里，说清哪里不对。
      // 这也是一条**被拒的提案**，账本要记下是哪一项、为什么。
      if (state !== undefined) {
        const synthetic: CreationPlan = {
          templateId: session.prefabId,
          at: session.ghostAt,
          palette: { body: 0, roof: 0, trim: 0, window: 0 },
        };
        this.recordLedger(buildCreationRecord({
          recordId: newRecordId(`${this.ledgerWorldId}:d${currentDay}:manual-schema`),
          worldId: this.ledgerWorldId,
          seed: this.ledgerSeed,
          day: currentDay,
          at: this.sim.snapshot().now,
          templateId: session.prefabId,
          templateName: blueprint.displayName,
          templateKind: blueprint.zone,
          intentText: null,
          target: session.ghostAt,
          origin: 'manual',
          gates: evaluateProposalGates({
            origin: 'manual',
            schemaPassed: false,
            // 落位预检在 schema 之前已经过了；schema 是另一道关，别把它记成落位失败。
            placementPassed: true,
            builtPrefabIds,
            blueprintCount: this.blueprints.size,
            templateId: session.prefabId,
            fuseAction: 'not_applicable',
            fuseReason: '人工确认不走自动放行门禁',
            traceable: false,
            schemaDetail: error instanceof Error ? error.message : '造物意图不合法',
          }),
          ladder: passiveLadderSnapshot(state),
          replay: {
            seed: this.ledgerSeed,
            eventFrom,
            eventTo: eventFrom,
            dayFrom: currentDay,
            dayTo: currentDay,
            fingerprint: proposalFingerprint(this.ledgerSeed, currentDay, synthetic),
          },
        }));
      }
      return {
        ok: false,
        message: error instanceof Error ? error.message : '造物意图不合法。',
      };
    }

    const creationRecordId = newRecordId(`${this.ledgerWorldId}:${instanceId}`);
    if (state !== undefined) {
      const creation = buildCreationRecord({
        recordId: creationRecordId,
        worldId: this.ledgerWorldId,
        seed: this.ledgerSeed,
        day: currentDay,
        at: this.sim.snapshot().now,
        templateId: plan.templateId,
        templateName: blueprint.displayName,
        templateKind: blueprint.zone,
        intentText: null,
        target: plan.at,
        origin: 'manual',
        gates: evaluateProposalGates({
          origin: 'manual',
          schemaPassed: true,
          placementPassed: true,
          builtPrefabIds,
          blueprintCount: this.blueprints.size,
          templateId: plan.templateId,
          fuseAction: 'not_applicable',
          fuseReason: '人工确认不走自动放行门禁',
          traceable: true,
          schemaDetail: '玩家点出来的计划已过白名单形状',
          placementDetail: '迷雾 / 空间 / 群落三道都过了',
        }),
        ladder: passiveLadderSnapshot(state),
        replay: {
          seed: this.ledgerSeed,
          eventFrom,
          eventTo: eventFrom,
          dayFrom: currentDay,
          dayTo: currentDay,
          fingerprint: proposalFingerprint(this.ledgerSeed, currentDay, plan),
        },
      });
      this.recordLedger(creation);
    }

    this.sim.enqueue({
      kind: 'build',
      prefabId: plan.templateId,
      instanceId,
      at: plan.at,
      // 记下来由：这栋楼是你在造物模式里点出来的。纸面据此说得出它的来历。
      source: {
        taskId: `creation-${instanceId}`,
        summary: `在 (${plan.at.x},${plan.at.y}) 建了${blueprint.displayName}`,
      },
    });
    // 人点了头，就是一次真实的人工确认。但**门口连通与回放一致要等落地**：
    // 这里只登记，由 `building.built` 回写触发 `settleCreationObservation`。
    // 落位前那两项算不准（楼还没占格），拿预检结论冒充事后判定就是假观测。
    this.pendingCreationObservations.set(instanceId, {
      plan,
      day: currentDay,
      traceable: true,
      recompute: () => creator.proposeCreation(request),
      proposalId: creationRecordId,
      displayName: blueprint.displayName,
      origin: 'manual',
      eventFrom,
    });
    this.endCreation();
    return { ok: true, message: '动工了。' };
  }

  /**
   * 造物落位校验：迷雾、空间、群落三道。
   *
   * 三处调用（hover / confirm / canPlaceAt）必须共用这一份——
   * 各写一遍就会漏掉其中一条，而漏掉的那条会在真机上表现为
   * 「预览说可以，确认却建到了不该建的地方」。
   */
  private canPlaceBlueprintHere(
    blueprint: PrefabBlueprint,
    cell: GridPoint,
  ): { ok: true } | { ok: false; message: string } {
    if (fogAt(cell, this.snapshot.fog)) {
      return { ok: false, message: '那里还没长出来，先让世界走到那儿。' };
    }
    const check = checkPlacement(this.world.grid, blueprint, cell);
    if (!check.ok) return { ok: false, message: hintFor(check.reason) };

    // 群落：郊野铺子必须在郊野圈，镇内铺子在工坊环内。
    //
    // 规则本体在 `biomeRingAllows`（`setup.ts`），与开局落位的 `accept` 共用一份。
    // 这里原来把这条规则自己写了一遍，而且写错了——见下面第二节。
    //
    // 为什么非得有这一道：`checkPlacement` 只看出界 / 分区 / 占地 / 留白 / 门口，
    // 不知道「郊野」是什么意思。**默认设定集（莞尔镇）的开局世界**里，它判
    // crawler_mine 能落的左上角有 **47** 个，其中 **31** 个在 craftRing(21)
    // 之内，最近的一个在 (56,27)、**12.042** 格。没有这道闸，把幽灵拖进镇子就能
    // 把郊野铺子建进镇子。
    // （ink_mill 52 个 / 圈内 36 个，gear_tower 42 个 / 圈内 26 个，同一个形状。
    //   灯潮界七栋楼里这三栋一栋都没有，所以这组数只对默认设定集成立。）
    //
    // 这里原来还写「实测 crawler_mine 曾被建到 15.5 格的 craftRing」。那个数
    // **复核不了**——它是某次真实对局里指针落点的记录，取决于当时的世界状态。
    // 而且它把问题说窄了：15.5 只是那 31 个圈内槽位中的一个（d=15.524，确实存在，
    // 但只有一个），真正最近的是 12.042。故事留着当动机，承重的数换成能复算的。
    //
    // ## 这段原来自己写了一遍规则，而且写错了
    //
    // 旧代码拿 `WILD_PREFABS.has(blueprint.id)` 认「郊野」，而开局的 `accept` 拿
    // `isWildSide`——后者还含两栋**郊野民居**（homestead_far / homestead_ridge）。
    // 这两栋的 `zone` 是 `living`，与三栋镇内民居同一个分区，`ZONE_DEFAULT` 也是
    // `living`，所以分区那道关拦不住它们。
    //
    // 实测（开局大世界，只数 `checkPlacement` 也判合法、且在 craftRing 内的落点）：
    // 对这两栋民居，开局的 `accept` 放行 **0** 个，而旧代码这道闸放行
    // **186**（homestead_far）/ **240**（homestead_ridge）个。一道声称「与开局
    // 同一套规则」的闸，对郊野民居恰好是反的——它专门放行开局永远不做的落位。
    // 今天 UI 没有「建民居」的入口，所以还没咬人；但 `beginCreation` 收任何
    // prefabId，加个按钮就会踩上。
    //
    // 旧代码还少一条上界（`d <= wilderness`），与 setup 的 accept 不一致。合成
    // 一份之后两边一样了——这条不再是个「记着免得忘」的不对称，而是没有了。
    const wild = isWildSide(blueprint.id);
    if (!biomeRingAllows(blueprint.id, cell, this.world.altar)) {
      return {
        ok: false,
        message: wild ? '这种铺子要建在郊野，离镇子远一点。' : '这种铺子要建在镇子里。',
      };
    }
    return { ok: true };
  }

  /** 取消：世界没有任何变化，恢复推进。 */
  cancelCreation(): CommandResult {
    if (this.creation === null) return { ok: false, message: '不在造物模式。' };
    this.endCreation();
    return { ok: true, message: '取消了，世界没动。' };
  }

  creating(): { readonly prefabId: string; readonly ghostAt: GridPoint | null } | null {
    return this.creation;
  }

  /**
   * 当前世界的 24 色。
   *
   * 色板值归设定集：灯潮界的 `timber` 与莞尔镇的 `timber` 同名不同色。
   * 没有 pack（莞尔镇）时回落 `paletteFor()`——当前激活世界就是莞尔镇，
   * 这条回落与「默认世界用默认色板」是同一件事。
   */
  private worldPalette(): WorldPalette {
    return this.pack?.palette ?? paletteFor();
  }

  private endCreation(): void {
    this.creation = null;
    this.ghost.hide();
    this.publishCreationHint('');
  }

  /**
   * 导播要看的地方。
   *
   * 排序即优先级：正在忙的人 → 正在运转的铺子 → 祭坛 → 其它铺子。
   *
   * 为什么要把空闲铺子也列进来：两个角色都闲在祭坛时，候选只剩祭坛一个点，
   * 导播"接管"了却无处可去，镜头一动不动——看起来像坏了。
   * 有铺子做候选，镜头才会真的在镇子里游走。
   */
  private directorTargets(): readonly { x: number; y: number }[] {
    const targets: { x: number; y: number }[] = [];
    for (const villager of this.snapshot.villagers) {
      if (villager.mode === 'idle') continue;
      targets.push({ x: villager.pos.x * TILE_PX, y: villager.pos.y * TILE_PX });
    }

    const operating: { x: number; y: number }[] = [];
    const idle: { x: number; y: number }[] = [];
    for (const building of this.snapshot.buildings) {
      const station = this.snapshot.workstations.find(
        (item) => item.buildingId === building.instanceId,
      );
      const point = {
        x: (building.origin.x + building.footprint.w / 2) * TILE_PX,
        y: (building.origin.y + building.footprint.h / 2) * TILE_PX,
      };
      if (station?.activity.kind === 'operating') operating.push(point);
      else idle.push(point);
    }
    targets.push(...operating);

    // 祭坛是世界的心跳，空镜头也该回到它。
    targets.push({ x: this.world.altar.x * TILE_PX, y: this.world.altar.y * TILE_PX });
    targets.push(...idle);
    return targets;
  }

  /**
   * 把一个命令结算结果说给所有订阅者，并记住最后那句有话说的。
   *
   * 单独一个漏斗：交付是这个世界最要紧的「发生过的事」，而这里是它到界面的
   * 唯一出口。两处发射（`update` 的结算、造物提示）都走它，补发时也只补一处。
   */
  private speak(result: CommandResult): void {
    if (result.message !== '') this.lastReply = result;
    for (const listener of this.resultListeners) listener(result);
  }

  /**
   * 造物提示。空句什么都不做——**也不占回执那一行**。
   *
   * 占位只发生在真有字可说的时候：玩家把光标挪开时进来的是空句，那时要是占了位，
   * 一个还没回来的模型答复就被闷死了——他什么都还没做错。这条判断写在
   * `Simulation.claimReceipt` 里，不靠这一行的顺序。
   */
  private publishCreationHint(line: string): void {
    this.sim.claimReceipt(line);
    if (line === '') return;
    this.speak({ ok: true, message: line });
  }

  /**
   * 关过账就记一份历史。**连续的一天才记补丁，断了就记全量 + 标缺。**
   *
   * 判据分两半：
   * - 天数连续（`closed - lastHistoryDay === 1`）：上一份快照就是昨天，补丁接得上；
   * - 世界此刻正停在这一天的边界之后（`nowDay - closed <= 1`）：否则这一份
   *   「快照」其实已经是好几天之后的世界了，记下来就是假的。
   * 任一不成立，剩下的天全部标 `missing`——**不近似重建**。
   */
  private captureHistory(): void {
    if (this.history === null || this.memory === undefined) return;
    const closed = this.memory.closedThroughDay;
    if (closed < 0 || closed <= this.lastHistoryDay) return;
    const nowDay = Math.floor(this.snapshot.now / DAY_MS);
    const consecutive = closed - this.lastHistoryDay === 1 && nowDay - closed <= 1;
    if (!consecutive) {
      for (let day = this.lastHistoryDay + 1; day <= closed; day += 1) this.history.markMissing(day);
      this.lastHistoryDay = closed;
      return;
    }
    this.history.capture(closed, {
      day: closed,
      // 世界那段不带记忆字符串：记忆视图由快照单独给（见 `HistoryDoc`）。
      save: this.sim.toSave(''),
      memory: this.memory.toSnapshot(),
    });
    this.lastHistoryDay = closed;
  }

  /** 调试面板的时间轴：这一局里记过的日子（含「没有记录」）。 */
  historyDays(): ReturnType<SceneHistory['days']> {
    return this.history?.days() ?? [];
  }

  /**
   * 点一天，读那一天的只读视图。**不写任何东西**。
   *
   * 返回的是历史层自己的投影（`RewindResult`），不在这里再翻译一遍：
   * 面板要的摘要与回溯 API 要的是同一份东西，少一层映射就少一处漂移。
   */
  async historyRewind(day: number): Promise<RewindResult | null> {
    if (this.history === null) return null;
    return this.history.rewind(day);
  }

  /** 手动存档：立即把当前世界写进单槽。 */
  saveNow(): CommandResult {
    const result = this.saveStore.write(this.sim.toSave(this.memory.toJSON()));
    if (result.ok) {
      this.lastSaveKey = this.saveStateKey();
      this.lastSaveAt = this.snapshot.now;
      this.saveNotice = null;
    }
    return { ok: result.ok, message: result.message };
  }

  /** 清档：只删主槽并停自动存档（防止 pagehide 又写回来）；刷新后从新世界开始。 */
  clearSave(): CommandResult {
    this.saveStore.clear();
    this.saveStore.disableAutoSave();
    return { ok: true, message: '存档已清除，刷新后从新世界开始。' };
  }

  private saveStateKey(): string {
    const deliveries = this.snapshot.deliveries;
    return [
      deliveries.feed,
      deliveries.local,
      this.snapshot.faith.milestones,
      this.snapshot.constructions.length,
      this.snapshot.props.length,
      this.snapshot.tasks.length,
    ].join('|');
  }

  /** 交付/施工/神恩/30s 节流：只在 update 返回后调用（ADR_SAVE §4）。 */
  private maybeAutoSave(): void {
    if (!this.saveStore.isAutoSaveEnabled()) return;
    const changed = this.saveStateKey() !== this.lastSaveKey;
    const due = this.snapshot.now - this.lastSaveAt >= 30_000;
    if (!changed && !due) return;
    const result = this.saveStore.write(this.sim.toSave(this.memory.toJSON()));
    if (!result.ok) {
      this.saveNotice = result.message;
      return;
    }
    this.lastSaveKey = this.saveStateKey();
    this.lastSaveAt = this.snapshot.now;
    // 记忆写回跟着存档那一条节流走：这一拍既然已过「变了 / 满 30s」两道闸，
    // 才轮到交一条。出队器自己还有在途互斥，失败留在队里下一拍再试。
    void this.memoryOutbox?.flush();
    // 账本也搭同一条节流；失败留在队里，下一次造物或自动存档再试。
    void this.creationLedger?.flush();
  }

  /** 外部 Agent 的入口。它和打字、按钮走同一条队列。 */
  feed(message: AgentToWorld): CommandResult {
    this.sim.enqueue(toWorldCommand(message));
    return { ok: true, message: '外部消息已投递。' };
  }

  /**
   * 喂一条上游事件，等价于服务端真的写进了一条日志。
   * 浏览器回归用它验证"事件流与世界连通"，不写服务端。
   */
  pushEvent(event: { kind: string; payload: Record<string, unknown> }): void {
    this.feedClient?.inject(event);
  }

  /**
   * 把一条世界改变排进写回队列（`POST /api/memory/write`）。
   *
   * 只有 `world.event` 进来：它是世界自己发生、带一句话与落点的那一类，
   * 标题与正文都现成；其余改变要么没有话说（潮位、心电图），要么是记忆层的
   * 输出（传说），再记一遍等于自己吃自己。
   *
   * 服务端记忆是**一事一文件**，`title` 上限 60 字且不能跨行——在这里先截，
   * 别指望那边替我们猜。
   */
  private queueMemory(change: WorldChange, at: number, eventId: number): void {
    const outbox = this.memoryOutbox;
    if (outbox === null) return;
    if (change.change !== 'world.event') return;
    const text = change.text.trim();
    if (text === '') return;
    const draft: MemoryDraft = {
      kind: 'event',
      title: text.slice(0, 60),
      body: text,
      at,
      evidence: [eventId],
    };
    outbox.enqueue(draft);
  }

  /**
   * 世界做成了一件事，记忆层记下它。
   *
   * 与世界回写日志同一个入口：日志记一份，记忆记一份，两份说的是同一件事。
   * 没有落点的事件（潮位、心电图）由 `observationOf` 返回 null，这里跳过。
   */
  private remember(change: WorldChange, at: number): void {
    if (this.memory === undefined) return;
    this.memoryEventSerial += 1;
    const lookups = {
      atOfHolder: (holderId: string) => {
        const villager = this.snapshot?.villagers.find((item) => item.id === holderId);
        return villager === undefined ? undefined : { x: villager.pos.x, y: villager.pos.y };
      },
      atOfBuilding: (instanceId: string) => {
        // **先问世界的账本，再问上一帧的快照。** `onChange` 在 `update()` 里面
        // 触发：新楼那一笔已经进了 `buildings`、还没进 `snapshot`；拆楼那一笔
        // 正好相反，已经出了 `buildings`、还在 `snapshot` 里。只查一边的话，
        // 「立楼」或「拆楼」必有一头落空——落空的那一头什么都不记。
        const live = this.sim.buildingById(instanceId);
        const building = live ?? this.snapshot?.buildings.find((item) => item.instanceId === instanceId);
        return building === undefined ? undefined : { x: building.door.x, y: building.door.y };
      },
      buildingOfTask: (taskId: string) =>
        this.snapshot?.tasks.find((item) => item.id === taskId)?.buildingId ?? undefined,
    };
    const observation = observationOf(change, `mem_${this.memoryEventSerial}`, lookups);
    if (observation === null) return;
    // 天气是「落下来」的事，不是广播：只记灯街上 6 格内、还没进屋的人。
    // 镇级那条（actorId: null）已经在 `Simulation.announce` + `log` 里落了；
    // 这里按最近的摊子分组，一组一条，同一个人只入一次账。
    if (change.change === 'weather' && this.stallCells.length > 0) {
      const people = (this.snapshot?.villagers ?? []).map((villager) => ({
        id: villager.id,
        // 快照里的 `pos` 已经是格坐标（`Simulation.cellOf` 用 Math.round），
        // 不是像素；这里别再除 TILE_PX。
        cell: { x: Math.round(villager.pos.x), y: Math.round(villager.pos.y) },
        visible: villager.visible,
      }));
      const groups = weatherWitnessGroups(people, this.stallCells);
      for (const [index, group] of groups.entries()) {
        const item = index === 0
          ? observation
          : observationOf(change, `mem_${(this.memoryEventSerial += 1)}`, lookups, group.at);
        if (item === null) continue;
        this.memory.observe({ ...item, at: group.at }, group.witnesses, at);
      }
      return;
    }
    // 楼的落成/拆除额外带一份位置：地标的一生要靠它把新旧两条记录接上
    // （重建换了实例 id，地块没换）。别的改变没有这一段，照旧。
    const landmark = this.landmarkEventOf(change);
    // 船班播报是镇子级事件：它会进事件日志（`this.events`），也会通过
    // `announce` 落到世界改变里。但**个人记忆只记「看见/在场」的人**——
    // 汽笛不是他们经历的事。码头 12 格内且没躲进屋的人算目击，其余人不入。
    const harborReport = change.change === 'world.event' && change.kind === 'harbor_report';
    const harborSite = harborSiteOf(this.pack);
    const witnesses = harborReport && harborSite !== null
      ? this.snapshot?.villagers
          .filter((villager) => villager.visible && villager.mode !== 'sheltering')
          .filter((villager) => withinHarborWitnessRange(villager.pos, {
            x: harborSite.x + Math.floor(harborSite.w / 2),
            y: harborSite.y + Math.floor(harborSite.h / 2),
          }))
          .map((villager) => villager.id)
      : undefined;
    this.memory.observe(
      landmark === undefined ? observation : { ...observation, landmark },
      witnesses,
      at,
    );
  }

  /**
   * 一条楼相关的改变 → 地标的输入。查不到位置就不产生地标阶段——
   * 「一块地不知道在哪」比「没有这段历史」更糟：废墟会画到空气里。
   *
   * 两个来源都要问：动工那一笔在 `sim.buildingById` 里（新楼还没进快照），
   * 拆楼那一笔在上一帧快照里（楼已经从 `buildings` 里摘掉了）。
   */
  private landmarkEventOf(change: WorldChange): LandmarkEvent | undefined {
    if (change.change !== 'building.built' && change.change !== 'building.removed') return undefined;
    const building =
      this.sim.buildingById(change.instanceId)
      ?? this.snapshot?.buildings.find((item) => item.instanceId === change.instanceId);
    if (building === undefined) return undefined;
    return {
      change: change.change === 'building.built' ? 'built' : 'removed',
      displayName: change.displayName,
      origin: { x: building.origin.x, y: building.origin.y },
      footprint: { w: building.footprint.w, h: building.footprint.h },
    };
  }

  view(): WorldSnapshot {
    return this.snapshot;
  }

  /** 调试面板用：最近 N 条事件（快照只带 12 条）。避开 Phaser.Scene.events 命名。 */
  recentEvents(limit = 50): ReturnType<Simulation['recentEvents']> {
    return this.sim.recentEvents(limit);
  }

  /** 调试面板用：存档状态（只读，不触发写档）。 */
  saveStatus(): {
    readonly schemaVersion: number;
    readonly savedAtWallClock: number | null;
    readonly autoSavePaused: boolean;
  } {
    const meta = this.saveStore.lastSavedMeta();
    return {
      schemaVersion: meta?.schemaVersion ?? CURRENT_SCHEMA_VERSION,
      savedAtWallClock: meta?.savedAtWallClock ?? null,
      autoSavePaused: !this.saveStore.isAutoSaveEnabled(),
    };
  }

  /** 时相是纯渲染态：不写世界、不写事件日志。 */
  setPhase(phase: PhaseId): void {
    this.phaseView.setPhase(phase);
    this.phaseView.setAutoAdvance(false);
  }

  currentPhase(): PhaseId {
    return this.phaseView.currentPhase();
  }

  /** 真实时间此刻对应的刻。用于验证「交还给真实时间」真的落对了。 */
  realPhase(): PhaseId {
    return phaseAt(Date.now());
  }

  /** 是否按真实时间自动推进。 */
  isAutoPhase(): boolean {
    return this.phaseView.isAutoAdvancing();
  }

  /** 恢复按真实时间推进。 */
  setAutoPhase(): void {
    this.phaseView.setAutoAdvance(true);
    this.phaseView.setPhase(phaseAt(Date.now()));
  }

  /** 旧入口保留语义：setNight(true) 等于跳到夜，false 等于回到真实时间。 */
  setNight(enabled: boolean): void {
    if (enabled) this.setPhase('night');
    else this.setAutoPhase();
  }

  /**
   * 在夜与昼之间切换，返回切换后是否为夜。
   *
   * 「离开夜」回到的是真实时间那一刻，而不是写死正午——否则早上按一下会跳到中午，
   * 世界就跟你的作息脱节了。
   */
  toggleNight(): boolean {
    if (this.phaseView.currentPhase() === 'night') {
      this.setAutoPhase();
      return this.phaseView.currentPhase() === 'night';
    }
    this.setPhase('night');
    return true;
  }

  nightEnabled(): boolean {
    return this.phaseView.currentPhase() === 'night';
  }

  private registerOracleApi(): void {
    const api = {
      say: (text: string): CommandResult => this.say(text),
      dispatch: (kind: 'code' | 'research' | 'writing' | 'quick', summary: string): void =>
        this.dispatch(kind, summary),
      finish: (target?: string): void => this.finish(target),
      build: (prefabId: string): void => this.build(prefabId),
      beginCreation: (prefabId: string): CommandResult => this.beginCreation(prefabId),
      hoverCell: (cell: GridPoint): void => this.hoverCell(cell),
      confirmCreation: (): CommandResult => this.confirmCreation(),
      cancelCreation: (): CommandResult => this.cancelCreation(),
      creation: () => this.creating(),
      /**
       * 调试注入：开一条带问题的活，用来验证急件流程。
       * 只供调试面板与浏览器回归用，正常路径不会有调用方。
       */
      injectBlocked: (taskId: string, title: string, question: string): void => {
        this.feedClient?.injectBlocked(taskId, title, question);
      },
      /** 世界状态摘要：界面据此显示"世界缺什么"。 */
      worldState: () => {
        const state = summarizeWorld(this.snapshot);
        return {
          line: describeWorldState(state),
          missingWild: state.gaps.missingWild,
          // 界面据此把「建不出来的铺子」那排按钮收起来。灯潮界的图没有
          // workshop_plot，也没有三类郊野铺子——不告诉界面的话，它会供出
          // 四个点了必然撞一句「没有这份蓝图。」的按钮。
          buildable: [...this.blueprints.keys()],
        };
      },
      /** 当前该呈给用户的急件；没有则为 null。 */
      decree: () => awaitingDecree(this.snapshot),
      /** 省电模式状态：当前帧率上限与焦点。 */
      ecoState: () => ({
        fpsLimit: this.game.loop.fpsLimit,
        hasFpsLimit: this.game.loop.hasFpsLimit,
        /** Phaser 实际渲染帧率：这是降频有没有生效的真正指标。 */
        actualFps: this.game.loop.actualFps,
        updateCount: this.updateCount,
        advanceCount: this.advanceCount,
        backgroundMode: this.backgroundMode,
        minFrameIntervalMs: this.minFrameIntervalMs,
        limitRate: (this.game.loop as unknown as { _limitRate: number })._limitRate,
        hasCallback: (this.game.loop as unknown as { callback?: unknown }).callback !== undefined,
        focused: document.visibilityState === 'visible' && document.hasFocus(),
      }),
      /** 渲染统计：排查性能时看每帧有多少绘制指令。 */
      renderStats: () => {
        const graphics = this.children.list.filter(
          (item) => item.type === 'Graphics',
        ) as Phaser.GameObjects.Graphics[];
        const counts = graphics.map((g) => g.commandBuffer?.length ?? 0);
        return {
          graphicsObjects: graphics.length,
          totalCommands: counts.reduce((sum, n) => sum + n, 0),
          largest: [...counts].sort((a, b) => b - a).slice(0, 5),
        };
      },
      /** 立刻把镜头中心对准世界坐标（不带动画）。小地图跳转与测试都用它。 */
      centerCameraOn: (x: number, y: number): void => this.cameraCtl.panTo(x, y, 0),
      /**
       * 诊断：某个单位此刻记得什么。
       *
       * 走的是 `MemoryRuntime.viewOf`，也就是单位**自己**那扇门——不是全库。
       * 调试口不该是那条「读全局状态」的后门；想看别人记得什么，得问别人。
       * 不传 `holderId` 时给一份摘要：几个人、各记得几条、关到第几天。
       */
      memory: (holderId?: string) => {
        if (this.memory === undefined) return null;
        if (holderId !== undefined) return this.memory.viewOf(holderId);
        return {
          ready: this.memory.ready,
          closedThroughDay: this.memory.closedThroughDay,
          holders: this.snapshot.villagers.map((villager) => {
            const view = this.memory.viewOf(villager.id);
            return {
              holderId: villager.id,
              memories: view?.memories.length ?? 0,
              beliefs: view?.beliefs.length ?? 0,
            };
          }),
        };
      },
      /**
       * 只读时间线：某个角色记得的事，按天/时刻排序，每条带事件 id。
       * 与 `memory()` 同一扇门（`MemoryRuntime.timelineFor` → `viewOf`），
       * 不额外读全局库。
       */
      memoryTimeline: (holderId: string) => {
        if (this.memory === undefined) return [];
        return this.memory.timelineFor(holderId);
      },
      memoryBonds: (holderId: string) => (this.memory?.bondsOf(holderId) ?? []).map((bond) => ({
        to: bond.to,
        trust: bond.trust,
        warmth: bond.warmth,
        debt: bond.debt,
      })),
      memoryMood: (holderId: string) => {
        const mood = this.memory?.moodOf(holderId);
        return mood === null || mood === undefined
          ? null
          : { label: mood.label, valence: mood.valence, arousal: mood.arousal };
      },
      memoryInner: (holderId: string) => {
        const inner = this.memory?.innerVoiceOf(holderId);
        return inner === null || inner === undefined
          ? null
          : { templateId: inner.templateId, text: inner.text };
      },
      openUnitStatusForDebug: (holderId: string) => {
        const villager = this.snapshot.villagers.find((item) => item.id === holderId);
        if (villager === undefined) return false;
        this.openUnitStatus({ kind: 'villager', id: villager.id });
        return true;
      },
      /** 只查询某处能不能建，不改变任何状态。造物模式与测试都用它。 */
      canPlaceAt: (cell: GridPoint): boolean => {
        const session = this.creation;
        if (session === null) return false;
        const blueprint = this.blueprints.get(session.prefabId);
        if (blueprint === undefined) return false;
        return this.canPlaceBlueprintHere(blueprint, cell).ok;
      },
      camera: () => ({
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        zoom: this.cameras.main.zoom,
        width: this.cameras.main.width,
        height: this.cameras.main.height,
        worldViewX: this.cameras.main.worldView.x,
        worldViewY: this.cameras.main.worldView.y,
        mode: this.cameraCtl.mode(),
      }),
      cameraMode: (): CameraMode => this.cameraCtl.mode(),
      setCameraMode: (mode: CameraMode): void => this.cameraCtl.setMode(mode),
      canFollow: (): boolean => this.cameraCtl.canFollow(),
      onCameraMode: (listener: (mode: CameraMode) => void): (() => void) => {
        // 与 `onStatus` / `onResult` 同一个道理：订阅来晚了先把现状补给它。
        listener(this.cameraCtl.mode());
        this.cameraModeListeners.add(listener);
        return () => this.cameraModeListeners.delete(listener);
      },
      lookAtVillager: (villagerId: string): void => this.lookAtVillager(villagerId),
      /**
       * 调试摆位：把某个村民的**画面**钉在固定格上（名字与气泡跟着走），
       * 只改这一帧要画的那份快照，不写世界、不进存档。`cell` 为 null 时解除。
       *
       * 为什么需要它：冻结帧里没有人的路线正好停在「摊位后一格」，而
       * 「站在摊位后应被挡住」这条判据必须有可复现的实拍，不能只有断言。
       * 返回脚底像素与 depth，脚本把读数写在图旁边。
       */
      debugPinVillager: (villagerId: string, cell: GridPoint | null) => {
        if (cell === null) {
          this.pinnedVillagers.delete(villagerId);
          return null;
        }
        const known = this.snapshot.villagers.some((villager) => villager.id === villagerId);
        if (!known) return null;
        this.pinnedVillagers.set(villagerId, { x: cell.x, y: cell.y });
        const foot = villagerFootAt(cell);
        return {
          x: foot.x,
          y: foot.y,
          depth: villagerDepthAt(foot.y, ALTITUDE),
          w: VILLAGER_W,
          h: VILLAGER_H,
        };
      },
      /**
       * 调试灯态：`true` 强制亮、`false` 强制灭、`null` 交回世界时钟。
       * 只压过渲染层的灯态，不改 `lampStreetLitAt` 的时刻判据——证据脚本
       * 要在同一冻结帧里取「灯亮 / 灯灭」两态的同一块地面，靠的就是这个口子。
       */
      debugForceLamps: (on: boolean | null): boolean | null => {
        this.forcedLamps = on;
        return on;
      },
      /**
       * 灯柱/灯串的三支动态开关（渐次点亮、呼吸、风摆）。缺省全开；
       * 关掉哪一支，那一支的 t / t+1s 帧差必须归零，其余两支不受影响。
       */
      debugLampMotion: (patch: Partial<LampMotion>): LampMotion => {
        this.lampMotion = { ...this.lampMotion, ...patch };
        return this.lampMotion;
      },
      /**
       * 摊位两支动态的开关（棚布/盖布摆动、火光跳动）。缺省全开；
       * 关掉哪一支，那一支的 t / t+1s 帧差必须归零，另一支不受影响。
       */
      debugStallMotion: (patch: Partial<StallMotion>): StallMotion => {
        this.stallMotion = { ...this.stallMotion, ...patch };
        return this.stallMotion;
      },
      /** 本帧摊位读数：棚布摆幅、火盆亮度与焰高、盖布摆幅，以及当前是否已盖。 */
      debugStallUnits: () => ({
        weather: this.snapshot.weather,
        packed: this.forcedPacked
          ?? (stallsPackedFor(this.snapshot.weather) || this.sim.preCoveredToday()),
        stalls: this.settingScenery?.stallUnits() ?? [],
        covers: this.weatherStallsView?.coverUnits() ?? [],
      }),
      /** 钉死「摊子已盖」这一渲染态（`null` 交回天气）；只压画面，不改世界。 */
      debugForcePacked: (on: boolean | null): boolean | null => {
        this.forcedPacked = on;
        return on;
      },
      /**
       * 幌布两支动态的开关（布身摆动、沿墙投影）。缺省全开；
       * 关掉投影那一支，同一对时刻的帧差必须归零，布身照摆。
       */
      debugBannerMotion: (patch: Partial<BannerMotion>): BannerMotion => {
        this.bannerMotion = { ...this.bannerMotion, ...patch };
        return this.bannerMotion;
      },
      /** 本帧幌布读数：布身摆幅、抬边、沿墙投影的横移/影长/浓淡。 */
      debugBannerUnits: () => this.settingScenery?.bannerUnits() ?? [],
      /** 烟的分段漂移开关。关掉后烟仍画在原地，但每一帧都是同一姿态。 */
      debugSmokeMotion: (patch: Partial<SmokeMotion>): SmokeMotion => {
        this.smokeMotion = { ...this.smokeMotion, ...patch };
        return this.smokeMotion;
      },
      /** 本帧烟囱读数：起飘高度、每段烟团的位移/宽高/浓度。 */
      debugSmokeUnits: () => this.settingScenery?.smokeUnits() ?? [],
      /**
       * 藏掉湾面低雾。只为证据隔离：低雾也随世界时刻横移，
       * 量「烟关掉后帧差为 0」时先把这条既有环境位移摘出去。
       */
      debugHideBayMist: (hidden: boolean): boolean => {
        this.hideBayMist = hidden;
        return hidden;
      },
      /** 人物 / 摊位落地投影开关。关掉后这一层不画像素，对照帧差必须为 0。 */
      debugGroundShadows: (patch: Partial<GroundShadowMotion>): GroundShadowMotion => {
        this.groundShadowMotion = { ...this.groundShadowMotion, ...patch };
        return this.groundShadowMotion;
      },
      /** 本帧落地投影读数：人物按脚底、摊位按柜台底；长度/浓淡由相位给。 */
      debugGroundShadowUnits: () => {
        const shape = groundShadowAt(this.phaseView.currentPhase());
        const on = this.groundShadowMotion.on;
        // 读数必须和画面对齐：renderSnapshot 用的是 `pinVillagers` 后的快照，
        // 这里若读未钉的 `this.snapshot`，影子画在钉住的位置、读数却是世界位置。
        const snapshot = pinVillagers(this.snapshot, this.pinnedVillagers);
        return {
          on,
          phase: this.phaseView.currentPhase(),
          villagers: snapshot.villagers
            .filter((villager) => villager.visible)
            .map((villager) => {
              const foot = villagerFootAt(villager.pos, 0, 0);
              return {
                id: villager.id,
                x: foot.x,
                y: foot.y,
                dx: on ? shape.dx : 0,
                span: on ? shape.span : 0,
                alpha: on ? shape.alpha : 0,
              };
            }),
          stalls: this.settingScenery?.groundShadowUnits() ?? [],
        };
      },
      /**
       * 证据脚本需要一份确定的雨天：直接下一条 `setWeather`，世界照常走一步。
       * 与玩家说「下雨吧」走的是同一条命令，不另开捷径。
       */
      debugSetWeather: (weather: Weather): Weather => {
        this.sim.enqueue({ kind: 'setWeather', weather });
        if (this.holdWorld) {
          for (const result of this.sim.update(100)) this.speak(result);
          this.snapshot = this.sim.snapshot();
        }
        return this.snapshot.weather;
      },
      /** 世界时间冻住：不推进模拟，渲染循环照跑。验「暂停世界后画面静止」。 */
      debugHoldWorld: (on: boolean): boolean => {
        this.holdWorld = on;
        return on;
      },
      /**
       * 冻住世界时手动推进一格（世界毫秒），下一帧照常渲染。
       * 证据脚本用它把「世界时刻序列」钉死：同一串步长 → 同一串帧。
       */
      debugStepWorld: (ms: number): number => {
        if (!this.holdWorld || !Number.isFinite(ms) || ms <= 0) return this.snapshot.now;
        this.sim.setSocialContext(this.socialContextFromMemory());
        for (const result of this.sim.update(ms)) this.speak(result);
        this.snapshot = this.sim.snapshot();
        return this.snapshot.now;
      },
      /** 逐盏点亮的排期：第一盏/最后一盏的世界时刻，以及此刻亮满了几盏。 */
      debugLampIgnition: () => ignitionSchedule(
        this.snapshot.now,
        this.settingScenery?.lampCount() ?? 0,
        this.phaseView.currentPhase(),
        this.phaseView.isAutoAdvancing(),
      ),
      /** 全街 28 盏的渐次顺序与坐标（按世界 x 从西往东）。 */
      debugLampUnits: () => this.settingScenery?.lampUnits() ?? [],
      /** 把渲染用的潮位钉死（0..1）；`null` 交回快照。只压画面，不改世界。 */
      debugPinTide: (level: number | null): number | null => {
        this.pinnedTide = level === null ? null : Math.min(1, Math.max(0, level));
        return this.pinnedTide;
      },
      /**
       * 藏掉天上的鸟/蝙蝠。只为证据隔离：鸟也由世界时刻驱动，
       * 会在灯街 ROI 上留下像素差；量「灯的三支动态」时要先把它们摘出去，
       * 报告里会注明这一条。
       */
      debugHideAmbience: (hidden: boolean): boolean => {
        this.ambienceView.setHidden(hidden);
        return hidden;
      },
      /**
       * 立面与街灯的像素尺寸。尺子读的就是渲染用的常量（`SettingSceneryMetrics`），
       * 证据脚本拿它画覆盖线与比例，不另抄一份数字；场景未起来时为 `null`。
       */
      debugSettingScale: () => this.settingScenery?.metrics ?? null,
      /**
       * 地面光池这一层此刻的指令数：灯灭时必须为 0，用来证明光池没有残留
       * （截图只能看出「没有暖斑」，看不出「上一帧的椭圆有没有被擦掉」）。
       */
      debugLampPool: (): number => this.settingScenery?.poolCommands() ?? 0,
      onVillagerMemory: (listener: (view: VillagerMemoryView | null) => void): (() => void) => {
        if (this.lastVillagerMemory !== null) listener(this.lastVillagerMemory);
        this.villagerMemoryListeners.add(listener);
        return () => this.villagerMemoryListeners.delete(listener);
      },
      dismissVillager: (): void => {
        // 先收面板再松跟随：`releaseFollow` 会让 `publishCameraMode` 下一帧
        // 发现「离开跟随」，它自己也会收一次——`closeVillagerPanel` 幂等。
        this.closeVillagerPanel();
        this.cameraCtl.releaseFollow();
      },
      openStele: (): void => this.openStele(),
      onStele: (listener: (view: SteleView | null) => void): (() => void) => {
        if (this.lastSteleView !== null) listener(this.lastSteleView);
        this.steleListeners.add(listener);
        return () => this.steleListeners.delete(listener);
      },
      dismissStele: (): void => this.closeStelePanel(),
      lookAtBuilding: (placeId: string): void => this.openBuilding(placeId),
      onBuilding: (listener: (view: BuildingPanelView | null) => void): (() => void) => {
        if (this.lastBuildingView !== null) listener(this.lastBuildingView);
        this.buildingListeners.add(listener);
        return () => this.buildingListeners.delete(listener);
      },
      dismissBuilding: (): void => this.closeBuildingPanel(),
      /**
       * 一栋楼此刻该读成什么样。给脚本与浏览器验收用——与 `stele()` 同一个口子。
       *
       * 它读的是**同一条** `buildingViewOf`，不是另算一份：验收里读到的东西
       * 与面板上摆的东西必须是同一个函数算出来的，否则「面板显示对了」这句话
       * 就没有证据。
       */
      building: (placeId: string): BuildingPanelView | null => this.buildingViewOf(placeId),
      /**
       * 碑上此刻刻着什么。给脚本与浏览器验收用——与 `memory()` 同一个口子。
       *
       * 返回的是**全部**传说（不截断）：验收要看的是「世界立起了几条」，
       * 而面板摆几条是展示的决定。`reach` 与 `formedDay` 一起给，测试能钉住
       * 「第几天立起来、几个人在讲」。
       */
      stele: () => {
        if (this.memory === undefined) return [];
        return steleLines(this.memory.legends(), this.memory.day);
      },
      miracle: (kind: MiracleKind): void => {
        this.sim.enqueue({ kind: 'miracle', miracle: kind });
      },
      feed: (message: AgentToWorld): CommandResult => this.feed(message),
      pushEvent: (event: { kind: string; payload: Record<string, unknown> }): void =>
        this.pushEvent(event),
      onResult: (listener: (result: CommandResult) => void): (() => void) => {
        // 订阅来晚了就补最后那一句，与 `onStatus` 同一个道理：场景挂上与界面
        // 订阅之间那段时间里产生的结果不能整条丢掉。见 `lastReply`。
        if (this.lastReply !== null) listener(this.lastReply);
        this.resultListeners.add(listener);
        return () => this.resultListeners.delete(listener);
      },
      onStatus: (listener: (line: string) => void): (() => void) => {
        if (this.lastStatus !== '') listener(this.lastStatus);
        this.statusListeners.add(listener);
        return () => this.statusListeners.delete(listener);
      },
      report: (): DailyReport => composeReport(this.snapshot),
      slab: (): readonly OracleRecord[] => this.snapshot.oracle,
      view: (): WorldSnapshot => this.view(),
      setPhase: (phase: PhaseId): void => this.setPhase(phase),
      currentPhase: (): PhaseId => this.currentPhase(),
      realPhase: (): PhaseId => this.realPhase(),
      isAutoPhase: (): boolean => this.isAutoPhase(),
      setAutoPhase: (): void => this.setAutoPhase(),
      setNight: (enabled: boolean): void => this.setNight(enabled),
      toggleNight: (): boolean => this.toggleNight(),
      nightEnabled: (): boolean => this.nightEnabled(),
      events: (limit = 50) => this.recentEvents(limit),
      saveStatus: () => this.saveStatus(),
      /** 只读回溯的时间轴：这一局里记过的日子。 */
      historyDays: () => this.historyDays(),
      /** 点某一天，读那一天的场景/角色/时代。只读，不写主档。 */
      historyRewind: (day: number) => this.historyRewind(day),
      /**
       * 真实时钟的只读状态：模式、暂停、提示与最近一次补算。
       * `catchUp` 不再只活在状态行的一帧里；没有 setter。
       */
      clockStatus: (): ClockStatusView => ({
        mode: this.clockMode,
        paused: this.realClock?.isPaused ?? false,
        notice: this.clockNotice,
        catchUp: this.clockReport,
      }),
      /**
       * 单位状态菜单：只读视图与订阅。不提供写入口，也不暂停世界。
       */
      unitStatus: (): UnitStatusContent | null => this.lastUnitStatus?.content ?? null,
      onUnitStatus: (listener: (view: UnitStatusView | null) => void): (() => void) => {
        if (this.lastUnitStatus !== null) listener(this.lastUnitStatus);
        this.unitStatusListeners.add(listener);
        return () => this.unitStatusListeners.delete(listener);
      },
      dismissUnitStatus: (): void => this.dismissUnitStatus(),
      /**
       * 老档日界对齐：提示、暂不、执行、撤销。读 `clockAlignment()` 是只读；
       * 其余四个是玩家动作，只有界面按钮会调，加载与自动存档都不会碰。
       */
      clockAlignment: (): ClockAlignmentView => this.clockAlignmentView(),
      requestClockAlignmentCheck: (): ClockAlignmentView => this.requestClockAlignmentCheck(),
      applyClockAlignment: (): ClockAlignmentView => this.applyClockAlignment(),
      declineClockAlignment: (): ClockAlignmentView => this.declineClockAlignment(),
      undoClockAlignment: (): ClockAlignmentView => this.undoClockAlignment(),
      /**
       * 外环指标窗口的只读计数。**只读**：每次现取一份新对象，不写回外环，
       * 也不提供任何 setter。
       *
       * 计数全来自 `mapper` 这一条角色窗口——日结算与造物结算都记在它上面
       * （`submitHumanApproval('mapper', …)`）。`replayHashChecks` 对应的
       * 底层计数器叫 `replayChecks`，这里换成名门禁比率同一个名字。
       *
       * 外环没起来（世界还没醒来 / 没有设定集）返回 `null`：全 0 会被读成
       * 「外环在、只是还没查过」，而事实是它不存在。
       */
      creatorChecks: (): CreatorChecksView | null => {
        const metrics = this.creator?.getRoleState('mapper')?.metrics;
        if (metrics === undefined) return null;
        return {
          conflictChecks: metrics.conflictChecks,
          invariantChecks: metrics.invariantChecks,
          pathfindingChecks: metrics.pathfindingChecks,
          replayHashChecks: metrics.replayChecks,
          coverageChecks: metrics.coverageChecks,
        };
      },
      saveNow: (): CommandResult => this.saveNow(),
      clearSave: (): CommandResult => this.clearSave(),
      loadSave: (): CommandResult => {
        window.location.reload();
        return { ok: true, message: '正在读档…' };
      },
    };
    // **这一行是「场景真的实现了界面要的那份契约」的唯一检查点。**
    //
    // 两边原来各写一次 `as unknown as`：这边写 `typeof api`（照自己的形状），
    // `main.ts` 那边写 `OracleApi`（照界面要的形状）——中间没有任何东西核对两者
    // 一致。于是世界那头改一个字段名，界面那头读到 `undefined`，而编译器两边都
    // 满意。`ReportApi` 的 `date` → `clock` 就是这么漏的：手抄的形状漂了，
    // 而漂的时候一个人都没红。
    //
    // 三边（神谕面板 / 调试面板 / 存档导入导出）各要一个子集，而这三个子集没有
    // 一个是全的——所以取交集一次核完，缺哪边哪边报。`api` 比交集多的那些字段
    // （`hoverCell`、`camera`、`pushEvent`、`events`……）不受影响：多给不是错。
    const oracle: OracleSurfaces = api;
    (window as unknown as { Oracle: OracleSurfaces }).Oracle = oracle;
  }

  // ----------------------------------------------------------------- render

  private renderSnapshot(delta: number): void {
    // 调试摆位只换这一帧要画的那份快照：身体、名字、气泡一起搬，世界不动。
    const snapshot = pinVillagers(this.snapshot, this.pinnedVillagers);
    this.syncBuildings();
    this.refreshGroundDecals();

    for (const entry of this.entries) {
      const workstation = snapshot.workstations.find(
        (item) => item.buildingId === entry.building.instanceId,
      );
      updateBuilding(this, entry.view, entry.building, workstation, ALTITUDE);
      this.refreshDecals(entry);
      const operating = workstation?.activity.kind === 'operating';
      const broken = workstation?.activity.kind === 'overheating';
      if ((operating || broken) && this.tick % 3 === 0) {
        // 视野外的烟不发射：逻辑照常结算，只是看不见就不必画。
        const chimney = entry.view.chimneyWorld;
        const view = this.cameras.main.worldView;
        if (shouldAnimateAt({ x: chimney.x, y: chimney.y }, view)) {
          const intensity = operating ? 1 + Math.min(2, (workstation?.progress ?? 0) * 2) : 2.5;
          entry.emitter.emitAt(chimney.x, chimney.y, intensity * 0.7);
        }
      }
    }

    if (snapshot.roads.length !== this.lastRoadCount) {
      this.lastRoadCount = snapshot.roads.length;
      this.decor.redrawRoads(snapshot.roads);
    }
    this.decor.syncTrails(snapshot.trails);
    this.decor.syncProps(snapshot.props);
    this.decor.syncCritters(snapshot.critters);
    const constructionKey = snapshot.constructions
      .map((item) => `${item.buildingId}:${Math.ceil(item.remainingMs / 100)}`)
      .join('|');
    if (constructionKey !== this.lastConstructionKey) {
      this.lastConstructionKey = constructionKey;
      this.decor.syncScaffolds(snapshot.constructions);
      this.drawScaffolds(snapshot);
    }

    // 多角色：每个 id 一个渲染实例；updateVillager 内部按 y 设 depth，天然 Y-Sort。
    for (const villager of snapshot.villagers) {
      let view = this.villagerViews.get(villager.id);
      if (view === undefined) {
        view = createVillager(this, 0, 0);
        this.villagerViews.set(villager.id, view);
      }
      const style = this.pack?.villagers.find((item) => item.name === villager.name)?.style;
      // 外观四维与颜色槽由设定集给；莞尔镇没有设定集时按 `v0`/`v1` 取两套旧外观
      // （按 id 不按名字：重名不串外观）。提灯是凭证，不是外观，单独递。
      const look = style === undefined ? legacyLookFor(villager.id) : resolveLook(style);
      const appearance = { look, lamp: style?.lamp === true };
      // 色板一路传到小人与灯：第二座镇子换掉 amber / cloak 时，人跟着换。
      updateVillager(view, villager, snapshot.now, 0, 0, ALTITUDE, appearance, this.pack?.palette ?? paletteFor());
    }
    // 人物脚下的日照投影：独立层 depth 3.1，压在光池之下、人物之下。
    // 只画可见的人；世界暂停时相位不动，影子也不动。
    this.groundShadowLayer.clear();
    if (this.groundShadowMotion.on) {
      const shape = groundShadowAt(this.phaseView.currentPhase());
      for (const villager of snapshot.villagers) {
        if (!villager.visible) continue;
        const foot = villagerFootAt(villager.pos, 0, 0);
        drawVillagerGroundShadow(
          this.groundShadowLayer,
          foot.x,
          foot.y,
          shape,
          this.pack?.palette ?? paletteFor(),
        );
      }
    }
    this.weatherView.update(this.sim.weatherIntensity(), delta);
    this.weatherFogView?.update(this.sim.weatherFogDensity(), this.snapshot.now);
    // 盖布两种来历：现在正在下雨（weather-effects），或记得昨天淋过雨、
    // 今天 13:00 提前盖上了（记忆进行为）。两种都画同一块布。
    const stallsPacked = this.forcedPacked
      ?? (stallsPackedFor(this.snapshot.weather) || this.sim.preCoveredToday());
    this.weatherStallsView?.update(stallsPacked, this.snapshot.now, this.stallMotion);
    const tideLevel = this.pinnedTide ?? this.snapshot.tide.level;
    this.tideView.update(tideLevel);
    if (this.snapshot.harbor !== null) this.harborView?.update(this.snapshot.harbor);
    this.settingScenery?.update(tideLevel, this.snapshot.now, {
      phase: this.phaseView.currentPhase(),
      autoAdvancing: this.phaseView.isAutoAdvancing(),
      litOverride: this.forcedLamps ?? undefined,
      motion: this.lampMotion,
      stalls: this.stallMotion,
      banners: this.bannerMotion,
      smoke: this.smokeMotion,
      groundShadows: this.groundShadowMotion,
      hideBayMist: this.hideBayMist,
      packed: stallsPacked,
    });
    this.phaseView.update(this.snapshot, delta);
    // 鸟与蝙蝠读模拟时刻而不是墙钟：暂停世界时它们也停，不会出现
    // 「世界静止但天上还在飞」的穿帮。
    this.ambienceView.update(
      this.snapshot.now,
      this.phaseView.currentPhase(),
      this.cameras.main.worldView,
    );
    // 设定集地图整张都是「已经到过的地方」：渡口、灯街、积尘滩是一口气铺开的，
    // 留一片迷雾在中间会读成「这里还没长出来」。半径由世界给到盖住整张图，
    // 旧镇的迷雾照旧由世界自己收敛。判据在 `Simulation.visibleFog`，视图与两道闸
    // 读快照里同一个数，这里不再另算。设定集图没有探索迷雾视图（见 `create` 那段）。
    this.fogView?.update(this.snapshot.fog, this.snapshot.now);

    // 气泡一出现就出声；同一个角色的同一句话不重复念。
    for (const villager of snapshot.villagers) {
      const bubble = villager.bubble;
      const last = this.lastBubbles.get(villager.id) ?? null;
      if (bubble !== null && bubble !== last) {
        this.lastBubbles.set(villager.id, bubble);
        this.animalese.speak(bubble);
        for (const listener of this.bubbleListeners) listener(bubble);
      } else if (bubble === null) {
        this.lastBubbles.set(villager.id, null);
      }
    }

    // 动态中文（名字/气泡）走 DOM overlay：按 canvas 实际位置每帧同步（D5-A）。
    this.overlay?.sync(snapshot);
    // 状态菜单开着时每帧重算锚点：镜头缩放/平移后不能错位。内容由 DOM 去重。
    if (this.unitStatusSelection !== null) this.publishUnitStatus();

    const line = this.statusLine();
    if (line !== this.lastStatus) {
      this.lastStatus = line;
      for (const listener of this.statusListeners) listener(line);
    }
  }

  /**
   * 楼与画面按 instanceId 对齐，不假设顺序。
   *
   * 三件事：新落成的补一套视图；**拆掉的把视图销毁**（以前只加不删，楼拆了
   * 画面还留着它）；再把「已经没有楼、但原地还有痕迹」的地方认出来当废墟。
   *
   * 销毁视图不是清理癖：不销毁的话，一栋楼从世界里消失之后，它的墙、它的
   * 招牌、它的痕迹层会一直在屏幕上，而且 `refreshDecals` 还会继续往上面画。
   * 世界的账本说它没了，画面说它还在——两套真相。
   */
  private syncBuildings(): void {
    const standing = new Set(this.snapshot.buildings.map((building) => building.instanceId));
    const gone = this.entries.filter((entry) => !standing.has(entry.building.instanceId));
    if (gone.length > 0) {
      this.entries = this.entries.filter((entry) => standing.has(entry.building.instanceId));
      for (const entry of gone) this.disposeBuilding(entry);
    }
    for (const building of this.snapshot.buildings) {
      if (this.entries.some((entry) => entry.building.instanceId === building.instanceId)) continue;
      this.entries.push({
        building,
        view: createBuilding(this, building, 0, 0),
        emitter: createAccentEmitter(this, building.accent),
      });
    }
    this.refreshRuins(standing);
  }

  /** 拆掉一栋楼留下的画面。三层容器 + 容器外那一层痕迹，一件都不留给 GC 之外的运气。 */
  private disposeBuilding(entry: BuildingEntry): void {
    entry.view.back.destroy(true);
    entry.view.container.destroy(true);
    entry.view.front.destroy(true);
    entry.view.decal.destroy();
    entry.emitter.destroy?.();
    this.decalSignatures.delete(entry.building.instanceId);
  }

  /**
   * 废墟：已经没有楼、但记忆层还留着痕迹的地方。
   *
   * 判据只看「不在还站着的楼里」+「有痕迹」。**不按 Holder 判**：拆楼之后
   * 地点 Holder 已经被摘，正是这一版要修的那个洞。
   */
  private refreshRuins(standing: ReadonlySet<string>): void {
    if (this.memory === undefined) {
      this.ruinPlaces = [];
      return;
    }
    const landmarkIds = new Set(this.landmarkCells.map((cell) => cellPlaceId(cell)));
    this.ruinPlaces = this.memory
      .placeWithTraces()
      .filter((place) => !standing.has(place.placeId) && !landmarkIds.has(place.placeId))
      .map((place) => ({ placeId: place.placeId, at: { x: place.at.x, y: place.at.y } }));
  }

  private drawScaffolds(snapshot: WorldSnapshot): void {
    for (const construction of snapshot.constructions) {
      const container = this.decor.scaffolds.get(construction.buildingId);
      if (container === undefined) continue;
      container.removeAll(true);
      const building = snapshot.buildings.find(
        (item) => item.instanceId === construction.buildingId,
      );
      if (building === undefined) continue;
      const x = building.origin.x * TILE_PX;
      const y = building.origin.y * TILE_PX;
      const w = building.footprint.w * TILE_PX;
      const h = building.footprint.h * TILE_PX;
      const g = this.add.graphics();
      const progress = 1 - construction.remainingMs / construction.totalMs;
      g.lineStyle(1, paletteFor().trim, 0.85);
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      for (let px = x + 4; px < x + w; px += 8) {
        g.lineBetween(px, y + 2, px, y + h - 2);
      }
      g.lineStyle(1, paletteFor().trim, 0.6);
      g.lineBetween(x + 1, y + h * progress, x + w - 1, y + h * progress);
      g.fillStyle(paletteFor().ink, 0.55);
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      container.add(g);
      // 施工标签改图标（D5-A）：进度用线，不再画「施工中 xx%」中文。
      const icon = this.add.graphics();
      icon.fillStyle(paletteFor().trim, 0.95);
      icon.fillRect(x + w / 2 - 4, y - 10, 9, 3);
      icon.fillRect(x + w / 2 - 1, y - 7, 2, 5);
      icon.fillStyle(paletteFor().trim, 0.9);
      icon.fillRect(x + w / 2 - 4, y - 10, 1, 3);
      container.add(icon);
    }
  }

  private statusLine(): string {
    // 多角色摘要：主角色：…　/　助手：…
    const summary = this.snapshot.villagers
      .map((villager) => {
        const task = this.snapshot.tasks.find((item) => item.id === villager.taskId);
        const where = task === null || task === undefined ? null : this.buildingName(task.buildingId);
        // 她那一句怎么说法，全在 `villager-words.ts`：这里只查铺子名字。
        // 原先这张表长在这儿，`idle` 那一支写的是 `routine ?? '在祭坛边闲逛'`——
        // 她没牌子时世界对她位置一无所知，那句话是替世界编的。日报那边同一个
        // 错已经修过（`report.ts` 的 `NOT_SOMEWHERE`），状态行漏了。
        return `${villager.name}：${villagerModeLabel(villager, this.snapshot, task, where)}`;
      })
      .join('　/　');
    // 雾把「能见几格」写进状态行：阈值是同一个常量，居民选择与读数不分家。
    const weather = this.snapshot.weather === 'fog'
      ? `${WEATHER_LABEL[this.snapshot.weather]}（能见 ${FOG_VISIT_CELLS} 格）`
      : WEATHER_LABEL[this.snapshot.weather];
    const saveNote = this.saveNotice === null ? '' : `　　${this.saveNotice}`;
    // 真实时钟的异常与离线补算必须看得见：静默暂停会让人以为世界卡死了。
    // 补算结果常驻到下一次补算/下一次造物；暂停提示每帧刷新。
    const catchUpNote = this.clockReport === null ? '' : formatClockCatchUp(this.clockReport);
    // 对齐当天必须明说「不是卡住了」：跳过多少小时、这一天缩成多长。
    const alignNote = this.clockAlignmentDayNote();
    const clockNotes = [
      this.clockNotice,
      catchUpNote,
      alignNote,
      this.clockAlignNotice,
    ].filter((line): line is string => line !== null && line !== '');

    const clockNote = clockNotes.length === 0 ? '' : `　　${clockNotes.join('　　')}`;
    if (this.pack?.authored === true) {
      const tide = this.snapshot.tide;
      // 渡口的读数必须跟潮位一起出现在状态行：只报「满潮」不够，
      // 要能一眼读到「今天潮位多少、船开没开」。
      const harbor = this.snapshot.harbor === null
        ? ''
        : `　船班${this.snapshot.harbor.boatLabel}（潮位 ${this.snapshot.harbor.level.toFixed(2)}，突堤 ${this.snapshot.harbor.jettyCells} 格）`;
      return `${this.pack.name}　${summary}　　${tide.label} ${tide.level.toFixed(2)}${harbor}　${weather}　${this.snapshot.feed.connected ? '事件流在线' : '离线生活'}${clockNote}${saveNote}`;
    }
    const faith = this.snapshot.faith;
    const { feed: feedDelivered, local: localDelivered } = this.snapshot.deliveries;
    // 离线必须显式标出：状态行不只说"上游离线"，还说现在跑的是本地活。
    const feedState = this.snapshot.feed.connected ? '上游在线' : '上游离线 · 仅本地活';
    // 读档后未对账：明说，且此时上游单只读展示。
    const feedLabel = this.snapshot.feed.reconciled
      ? feedState
      : `读档未对账 · ${feedState}`;
    // 存档提示（坏档/高版本/配额）只写一次即可，这里保持可见直到下次成功写档。
    // blocked_question 只展示，不在世界内回答：完整值留在快照，这里按 60 字符截断。
    const waitingTask = this.snapshot.tasks.find((item) => item.blockedQuestion !== null);
    const waiting =
      waitingTask === undefined || waitingTask.blockedQuestion === null
        ? ''
        : `　　在等你的答复：${excerptBlockedQuestion(waitingTask.blockedQuestion)}`;
    // 排队中的神谕必须在状态行可见，否则跟"被拒"分不出来。
    const queued = this.snapshot.pending;
    const queue =
      queued.length === 0 ? '' : `　　排队 ${queued.length} 条：${queued[0]?.summary ?? ''}`;
    // 省略 target 的「交付」收谁的单：写清对象，免得两个都在干活时靠猜。
    const defaultWorker = this.snapshot.villagers.find(
      (villager) => villager.mode === 'working' && villager.taskId !== null,
    );
    const finishHint =
      defaultWorker === undefined ? '' : `　　默认交付：${defaultWorker.name}的单`;
    // 最近落下的那件摆件写清来路：这是"被记住"在纸面上唯一的具体落点。
    const latestProp = this.snapshot.props[this.snapshot.props.length - 1];
    const memory = latestProp === undefined ? '' : `　　${describePropSource(latestProp)}`;
    const historyNote = this.historyNotice === null ? '' : `　　${this.historyNotice}`;
    return `${summary}　　${weather}　　${feedLabel}　　上游交付 ${feedDelivered} 单 · 本地交付 ${localDelivered} 单　　神恩 ${faith.points}/${3}${memory}${waiting}${queue}${finishHint}${clockNote}${saveNote}${historyNote}`;
  }

  /** 点在谁的占地里。用于 `Perceiver.inside`：进屋/出屋按格算，不靠调用方维护。 */
  private buildingIdAt(point: { readonly x: number; readonly y: number }): string | null {
    const buildings = this.snapshot?.buildings ?? [];
    for (const building of buildings) {
      const { origin, footprint } = building;
      if (
        point.x >= origin.x &&
        point.y >= origin.y &&
        point.x < origin.x + footprint.w &&
        point.y < origin.y + footprint.h
      ) {
        return building.instanceId;
      }
    }
    return null;
  }

  /**
   * 铺子的名字。**查不到就给 null，不把 instanceId 当名字还回去。**
   *
   * 曾经是 `?? id`：楼不在世界上了（拆掉、或别的什么路子让活指向了空气），
   * 状态行就播「莞尔：赶往 scripture_pavilion#3」——一串内部编号被当成地名
   * 念出来，而那儿什么都没有。调用方（`villagerModeLabel`）认得 null，那一支
   * 只说「赶路」：她确实在赶路，只是去处说不准。说不准比说错好。
   */
  private buildingName(id: string | null): string | null {
    if (id === null) return null;
    return this.snapshot.buildings.find((item) => item.instanceId === id)?.displayName ?? null;
  }

  /**
   * 今日时间线加上一句因果：那件事之后，这个人今天真的因为记着它绕开了
   * 对方几拍。数字取自 `Simulation.avoidanceStats()`（运行时读数），
   * 不是从 trust 反推的「可能避开」——没跳过就不写这句。
   */
  private dayTimelineWithWhy(holderId: string, day: number) {
    const entries = this.memory?.dayTimelineFor(holderId, day) ?? [];
    if (day !== Math.floor(this.snapshot.now / DAY_MS)) return entries;
    const avoid = this.sim.avoidanceStats();
    const names = new Map(this.snapshot.villagers.map((villager) => [villager.id, villager.name]));
    const habit = this.sim.weatherHabitFor(holderId);
    return entries.map((entry) => {
      // 记忆真的改了今天的一拍：提前盖布那条，why 指向昨天那场雨。
      // 只有今天真的做了（`preCoveredDay === day`）才写，没做就不编因果。
      // 这里不能按 `entry.kind` 认：时间线上的 `kind` 是记忆种类（`episodic` /
      // `summary`），不是世界事件种类；认那句话就够了。
      if (
        String(entry.what ?? '').includes('提前把摊布盖上') &&
        habit.preCoveredDay === day
      ) {
        // 说清是几天前那场雨：门槛 0.75 让这条习惯最多活两天，
        // 第二天就得说「前天」，不能说成「昨天」。
        const ago = habit.day === null ? 1 : day - habit.day;
        const when = ago === 1 ? '昨天' : ago === 2 ? '前天' : `${ago} 天前`;
        return { ...entry, why: `因为${when}淋了雨，今天提前收摊` };
      }
      const other = entry.actors.find((id) => id !== holderId);
      const beats = other === undefined ? 0 : avoid.byPair[`${holderId}|${other}`] ?? 0;
      if (other === undefined || beats === 0) return entry;
      return {
        ...entry,
        why: `所以今天避开${names.get(other) ?? other}（${beats} 拍）`,
      };
    });
  }

  /**
   * 每帧从关系账本算一遍交下去的社会读数。
   *
   * 这是「记忆反过来影响行为」的唯一接线处：世界不读记忆，读的是这里交下去
   * 的 `trust` / `warmth` 与「躲开谁」。阈值在 `liveliness.ts`，不在这里——
   * 同一个数被两处写死过一次，改一处忘另一处，屏幕上的行为与记忆里的账
   * 就会说两套话。
   *
   * 无记忆（`memory` 尚未构造）时返回空账：世界照旧运行，与从前逐字节相同。
   */
  private socialContextFromMemory(): {
    relations: { from: string; to: string; trust: number; warmth: number }[];
    avoid: { villagerId: string; otherId: string }[];
  } {
    const villagers = this.snapshot?.villagers ?? [];
    const ids = new Set(villagers.map((villager) => villager.id));
    const relations: { from: string; to: string; trust: number; warmth: number }[] = [];
    const avoid: { villagerId: string; otherId: string }[] = [];
    if (this.memory === undefined) return { relations, avoid };
    for (const villager of villagers) {
      for (const bond of this.memory.bondsOf(villager.id)) {
        if (!ids.has(bond.to)) continue;
        relations.push({ from: villager.id, to: bond.to, trust: bond.trust, warmth: bond.warmth });
        if (bond.trust < -0.15) avoid.push({ villagerId: villager.id, otherId: bond.to });
      }
    }
    return { relations, avoid };
  }

  /**
   * 把记忆层里「昨天淋过雨」的账译成世界能用的那一句：谁、当前强度、第几天。
   *
   * 只看**亲眼淋到**、在今天以前、`what` 里带「雨」、且是负价的那几条——雾也是
   * 负价，但「雾里改道」不是收摊的理由，别混进来。一个人有多条时取衰减后最强
   * 的那条。记忆层负责衰减；这里只挑，不改。
   *
   * **`heard` 不算。** 传闻也会在第二天把「雨落下来了」传进没在场的人的记忆里，
   * 但「听说下过雨」不是「自己淋过」——让听说的人也跟着提前盖布，等于把这条
   * 近场规矩又改回广播。所以只认 `sourceMode === 'witnessed'`。
   */
  private weatherHabitFromMemory(): WeatherHabitEntry[] {
    const runtime = this.memory;
    if (runtime === undefined) return [];
    const today = runtime.day;
    const ledger: WeatherHabitEntry[] = [];
    for (const villager of this.snapshot?.villagers ?? []) {
      let best: WeatherHabitEntry | null = null;
      for (const memory of runtime.viewOf(villager.id)?.memories ?? []) {
        if (memory.createdDay >= today) continue;
        if (memory.sourceMode !== 'witnessed') continue;
        // 天气异常在记忆里落的是 `episodic`，靠 `what` 那句话说清是哪一档：
        // 只有「雨落下来了 / 暴雨落下来了」算淋雨，雾不算。
        if (!memory.content.what.includes('雨')) continue;
        if (memory.content.valence >= 0) continue;
        const candidate: WeatherHabitEntry = {
          villagerId: villager.id,
          strength: memory.strength,
          day: memory.createdDay,
        };
        if (best === null || candidate.strength > best.strength) best = candidate;
      }
      if (best !== null) ledger.push(best);
    }
    return ledger;
  }
}

/**
 * `?now=` 的解析：0..1439 的整数世界分钟。
 *
 * 非法值（非数字、负数、超过一天、小数）当作没给——一个坏参数不该把世界
 * 悄悄挪到别的时刻，也不该白屏；回归脚本写错了会看到「还是 00:00」，比
 * 看到一个看似合理的错时刻更容易发现。
 */
function parseMinuteOfDay(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) return undefined;
  return minutes;
}
