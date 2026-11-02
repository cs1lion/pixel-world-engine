/** 唯一的 Phaser 场景。它只做三件事：把逻辑 tick 起来、把快照画出来、把输入转成命令。
 *
 * 世界逻辑全在 src/world/ 里，与 Phaser 无关；这里不判断"该不该开工"。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import { cellPlaceId, footfallPlace, type FootfallDoor } from '../world/ambient.ts';
import { drawGroundDecals } from '../render/decal.ts';
import { Simulation, type MiracleKind, type NewBuilding } from '../world/simulation.ts';
import type { CommandResult, GridPoint, OracleRecord, PrefabBlueprint, WorldProp, WorldSnapshot } from '../world/types.ts';
import { villagerAtCell } from '../world/types.ts';
import { excerptBlockedQuestion } from '../world/types.ts';
import { placeBlueprint, type BuiltWorld } from '../world/setup.ts';
import { TERRAIN_COLORS, WORLD, tokenNameOf } from '../world/palette-data.ts';
import type { WorldPalette } from '../world/theme.ts';
import { DAY_MS } from '../world/memory/config.ts';
import { MemoryRuntime } from '../world/memory/runtime.ts';
import { observationOf } from '../world/memory/observe.ts';
import { memoryVoice } from '../world/memory/voice.ts';
import type { OracleApi } from '../ui/oracle-panel.ts';
import type { CreatorChecksView, DebugOracle } from '../ui/debug-panel.ts';
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
  BuildingOracle;
import { drawTerrain } from '../render/tilemap.ts';
import { createBuilding, drawBuildingDecals, updateBuilding, type BuildingView } from '../render/buildings.ts';
import { createVillager, updateVillager, type VillagerView } from '../render/villager.ts';
import { createWorldOverlay, type WorldOverlay } from '../render/world-overlay.ts';
import { createAccentEmitter, ensureAccentTextures, type AccentEmitter } from '../render/smoke.ts';
import { createWeatherView, type WeatherView } from '../render/weather.ts';
import { WEATHER_LABEL } from '../world/weather.ts';
import { createTideView, type TideView } from '../render/tide-view.ts';
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
  DEFAULT_UTC_OFFSET_MINUTES,
  OFFLINE_SETTLE_MAX_DAYS,
  RealClock,
  msSinceLocalMidnight,
} from '../world/real-clock.ts';
import {
  readClockBaseline,
  writeClockBaseline,
  type BaselineStorage,
} from '../world/real-clock-baseline.ts';
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
  /** 世界时钟相对墙钟的倍率。?speed=0.5 放慢，?speed=12 加速，?speed=1 回到实时。 */
  private timeScale = 6;
  /**
   * 时钟模式。默认加速（`timeScale` 生效，服务演示与回归）；`?clock=real`
   * 切到真实时钟：一步固定 `LOGIC_STEP_MS`，`timeScale` 不再作为倍率，
   * 日界按本地 00:00（见 `world/real-clock.ts`）。
   */
  private clockMode: 'accelerated' | 'real' = 'accelerated';
  private realClock: RealClock | null = null;
  private realClockOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES;
  /** 真实时钟的可见提示：回拨暂停、离线合并补算。进状态行，不写控制台了事。 */
  private clockNotice: string | null = null;
  /** 跨会话基线最近一次写入的墙钟时刻；5 秒节流，避免每帧写 localStorage。 */
  private lastClockBaselineWriteAt = 0;
  private readonly villagerViews = new Map<string, VillagerView>();
  private overlay: WorldOverlay | null = null;
  private weatherView!: WeatherView;
  private tideView!: TideView;
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
  private fogView!: FogView;
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
  /** 每块地标上一次画出去的痕迹单子的指纹，与 `decalSignatures` 同一个理由。 */
  private groundSignatures = new Map<string, string>();
  private groundLayer?: Phaser.GameObjects.Graphics;
  /**
   * 这一局画面上该用的 24 色：设定集给了就整套换成它的，没给就是莞尔镇的。
   *
   * 痕迹、地形、楼、人都得读同一份。`tilemap.ts` 早就这么做了
   * （`theme?.palette ?? WORLD`）；痕迹那一层 2026-11-02 才跟上——
   * 在那之前灯潮界的地上和墙上一直画着莞尔镇的石头色。
   */
  private get palette(): WorldPalette {
    return this.pack?.palette ?? WORLD;
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
    return this.pack?.terrainColors[terrain] ?? TERRAIN_COLORS[terrain];
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
    this.cameras.main.setBackgroundColor(this.pack?.palette.ink ?? WORLD.ink);

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
    this.phaseView = createPhaseView(this, worldPx.w, worldPx.h, this.pack?.palette.deepShade);
    this.ambienceView = createAmbienceView(this);
    this.ghost = createGhostView(this);
    this.fogView = createFogView(this, this.world.grid.width, this.world.grid.height);

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
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.creation !== null) return;
      this.dragFrom = { x: pointer.x, y: pointer.y };
      this.pressMoved = false;
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.dragFrom = null;
      // 抬手时没怎么动，才算「点了一下」而不是拖镜头。没有这个区分的话，
      // 每次平移地图都会顺手洗掉路过的那盏灯——玩家只是在看世界。
      if (this.pressMoved) return;
      // 点到人就是「看她」：镜头跟过去，面板读出她记得的事。
      // 其次点碑：镇上认下的事都在那块石头上。
      // 再其次点楼：它叫什么、接过什么活、墙上留着什么。
      // 都不中才退回洗地——四种动作共用一次点击，靠落点上有什么分开。
      // 先比人再比碑：人在碑上站着时，点她应该还是看她。
      if (this.lookAtVillagerAt(pointer)) return;
      if (this.openSteleAt(pointer)) return;
      if (this.lookAtBuildingAt(pointer)) return;
      this.washUnder(pointer);
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.creation !== null || this.dragFrom === null) return;
      if (!pointer.isDown) {
        this.dragFrom = null;
        return;
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
    // 时间倍率：默认 6 倍，潮汐在 2 分钟内走完一轮，肉眼能看见涨落。
    // 截图与回归要精确复现时用 ?speed=1，让世界按实时推进。
    const speed = Number(params.get('speed'));
    if (Number.isFinite(speed) && speed > 0 && speed <= 60) this.timeScale = speed;
    // 真实时钟模式：显式 `?clock=real` 才切。`?speed=` 在这种模式下不再生效——
    // 1:1 是它的定义，留一个能偷偷加速的入口就没人能说它还是真实时钟。
    // 锚点默认 UTC+8；`?utcOffsetMinutes=` 可配，但只影响日界落在几点，不改日长。
    if (params.get('clock') === 'real') {
      const offsetRaw = Number(params.get('utcOffsetMinutes'));
      this.realClockOffsetMinutes =
        Number.isInteger(offsetRaw) && offsetRaw >= -720 && offsetRaw <= 840
          ? offsetRaw
          : DEFAULT_UTC_OFFSET_MINUTES;
      this.clockMode = 'real';
      this.realClock = new RealClock({
        utcOffsetMinutes: this.realClockOffsetMinutes,
        offlineMaxDays: OFFLINE_SETTLE_MAX_DAYS,
      });
      this.timeScale = 1;
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

    if (this.pack?.authored === true) this.settingScenery = createSettingScenery(this, this.pack);
    else this.drawAltar(originX, originY);

    const simDeps = {
      grid: this.world.grid,
      buildings: this.world.buildings,
      altar: this.world.altar,
      villagerName: this.villagerName,
      ...(this.pack?.villagers.length ? {
        villagerNames: this.pack.villagers.map((villager) => villager.name),
        villagerProfiles: routineProfiles(this.pack),
      } : {}),
      // 地域的叫法。喂模型的世界现状要说「叠浪楼要一盏灯」，不说 `bathhouse`。
      // 没有设定集（莞尔镇）时这道门不存在，给张空表与不给等价。
      ...(this.pack === undefined || this.pack === null
        ? {}
        : { regionNames: new Map(this.pack.regions.map((region) => [region.id, region.name])) }),
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
        if (change.change === 'building.built') this.settleCreationObservation(change.instanceId);
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
    const initialNow =
      this.clockMode === 'real'
        ? msSinceLocalMidnight(Date.now(), this.realClockOffsetMinutes)
        : undefined;
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
    // 真实时钟的跨会话补算必须在这里做：记忆已复原、快照已就位，补算走的是
    // 与常规跨日完全同一条 `stepMemory → tickCapped → onVitals` 路径。
    this.restoreRealClockBaseline();
    // 造物引擎进生产路径：世界是场景这一份（不再另建第二份），种子取设定集 id，
    // 时钟取世界时间。三者都由场景给，引擎不自己造兜底。
    const creatorPack = this.pack ?? selectSetting('');
    this.creator = new CreatorEngine(creatorPack, {
      worldSeed: creatorPack.id,
      worldTime: () => this.snapshot.now,
      world: this.world,
    });
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
    this.fogView?.destroy();
    this.feedClient?.stop();
    this.feedClient = null;
    this.eventsClient = null;
    this.memoryClient = null;
    this.memoryOutbox = null;
    this.creator = null;
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
    pool.fillStyle(WORLD.amber, 0.06);
    pool.fillRect(cx - 24, ay + 12, 48, 10);
    pool.fillStyle(WORLD.amber, 0.1);
    pool.fillRect(cx - 18, ay + 14, 36, 6);
    pool.fillStyle(WORLD.warmLight, 0.14);
    pool.fillRect(cx - 12, ay + 16, 24, 3);

    // 石龛：26×26，比旧的 44×44 小一半；底座两级、四柱、小屋顶、蜡烛与供品。
    // 视觉整体向右偏 8px：她站在祭坛点时不会正好挡住龛内的符文。
    const sx = cx + 12;
    const altar = this.add.graphics();
    // 底座第一步（最宽）
    altar.fillStyle(WORLD.stone, 1);
    altar.fillRect(sx - 14, ay + 18, 28, 5);
    altar.fillStyle(WORLD.plaza, 1);
    altar.fillRect(sx - 14, ay + 18, 28, 1);
    altar.fillStyle(WORLD.soil, 1);
    altar.fillRect(sx - 14, ay + 22, 28, 1);
    // 底座第二步
    altar.fillStyle(WORLD.plaza, 1);
    altar.fillRect(sx - 10, ay + 14, 20, 5);
    altar.fillStyle(WORLD.stone, 1);
    altar.fillRect(sx - 10, ay + 18, 20, 1);
    // 四柱：左右各两根，柱头用 trim。
    for (const px of [sx - 12, sx + 9] as const) {
      altar.fillStyle(WORLD.stone, 1);
      altar.fillRect(px, ay + 2, 3, 13);
      altar.fillStyle(WORLD.plaza, 1);
      altar.fillRect(px, ay + 2, 1, 13);
      altar.fillStyle(WORLD.trim, 1);
      altar.fillRect(px - 1, ay + 1, 5, 1);
    }
    // 小屋顶：两坡 + 屋脊，压在柱子上。
    altar.fillStyle(WORLD.timberDark, 1);
    altar.fillRect(sx - 15, ay - 2, 30, 3);
    altar.fillRect(sx - 12, ay - 5, 24, 3);
    altar.fillStyle(WORLD.trim, 1);
    altar.fillRect(sx - 13, ay - 5, 26, 1);
    altar.fillStyle(WORLD.timberDark, 1);
    altar.fillRect(sx - 1, ay - 8, 2, 4);
    // 龛内暗部 + 符文
    altar.fillStyle(WORLD.ink, 1);
    altar.fillRect(sx - 7, ay + 3, 14, 12);
    // 4 角星：竖/横 + 两条斜线，中央 pale 高光。不是“T”。
    altar.fillStyle(WORLD.amber, 0.95);
    altar.fillRect(sx - 1, ay + 5, 2, 8);
    altar.fillRect(sx - 4, ay + 8, 8, 2);
    for (let step = 0; step < 3; step += 1) {
      altar.fillRect(sx - 3 + step, ay + 6 + step, 1, 1);
      altar.fillRect(sx + 2 - step, ay + 6 + step, 1, 1);
      altar.fillRect(sx - 3 + step, ay + 11 - step, 1, 1);
      altar.fillRect(sx + 2 - step, ay + 11 - step, 1, 1);
    }
    altar.fillStyle(WORLD.warmLight, 1);
    altar.fillRect(sx, ay + 8, 1, 1);
    // 两支蜡烛：pale 烛身 + amber 火焰。
    for (const px of [sx - 12, sx + 11] as const) {
      altar.fillStyle(WORLD.pale, 1);
      altar.fillRect(px, ay + 12, 1, 3);
      altar.fillStyle(WORLD.warmLight, 1);
      altar.fillRect(px, ay + 10, 1, 1);
      altar.fillStyle(WORLD.ember, 1);
      altar.fillRect(px, ay + 11, 1, 1);
    }
    // 供品：两块 trim/ember 小布包 + 苔。
    altar.fillStyle(WORLD.trim, 1);
    altar.fillRect(sx - 6, ay + 18, 3, 2);
    altar.fillStyle(WORLD.ember, 1);
    altar.fillRect(sx + 3, ay + 18, 3, 2);
    altar.fillStyle(WORLD.moss, 1);
    for (let i = 0; i < 6; i += 1) {
      altar.fillRect(sx - 12 + i * 5, ay + 22, 2, 1);
    }
    altar.setDepth(ALTITUDE + ay + 24);
  }

  update(time: number, delta: number): void {
    this.updateCount += 1;

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
      const results = this.sim.update(stepMs);
      for (const result of results) {
        this.speak(result);
      }
      this.tick += 1;
      steps += 1;
    }
    this.snapshot = this.sim.snapshot();
    const skippedDays = this.stepMemory(catchUpCap > 0 ? catchUpCap : undefined);
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

    // 结算走既有记忆关账；可读结果在下一笔提交里落成常驻状态。
    this.stepMemory(observed.dayGap > OFFLINE_SETTLE_MAX_DAYS ? OFFLINE_SETTLE_MAX_DAYS : undefined);
    this.persistClockBaseline(true);
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
    readonly meanValence: number;
    readonly meanArousal: number;
    readonly infoEntropy: number;
    readonly isolatedHoldersCount: number;
  }): void {
    const creator = this.creator;
    if (creator === null) return;

    creator.closeWorldDay();
    creator.processDayClosed({
      meanValence: vitals.meanValence,
      meanArousal: vitals.meanArousal,
      infoEntropy: vitals.infoEntropy,
      isolatedHoldersCount: vitals.isolatedHoldersCount,
    });

    if (creator.getFuseDecision('mapper').action !== 'allow') return;
    // 落地前把 view 捕获下来，并把落位许可冻成位图：重跑时不能看见新楼占的格，
    // 否则算出来的是「落地后的下一个位置」，不再是同一份输入。
    const view = this.creatorWorldView();
    const proposal = creator.planCreation(view);
    if (proposal === null) return;
    const frozen = freezeCreatorView(
      view,
      [...this.blueprints.keys()].filter((id) => !view.builtPrefabIds.has(id)),
    );
    const instanceId = this.sim.nextInstanceId(proposal.templateId);
    this.pendingCreationObservations.set(instanceId, {
      plan: proposal,
      day: view.day,
      traceable: true,
      recompute: () => creator.planCreation(frozen),
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
    });
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
   * 地标上的痕迹。
   *
   * 与 `refreshDecals` 同一个入口（`placeHints`）、同一道闸，只是画在地上而不是
   * 墙上。签名没变就不重画——理由与楼那边一样：痕迹一天才风化一次。
   */
  private refreshGroundDecals(): void {
    if (this.memory === undefined) return;
    if (this.landmarkCells.length === 0) return;
    // 先看有没有变。签名里带 `visibility`，所以「今天风化了一格」也算变了。
    let changed = false;
    for (const cell of this.landmarkCells) {
      const placeId = cellPlaceId(cell);
      const signature = this.memory
        .placeHints(placeId)
        .map((hint) => `${hint.traceId}:${hint.visibility.toFixed(3)}`)
        .join('|');
      if (this.groundSignatures.get(placeId) === signature) continue;
      this.groundSignatures.set(placeId, signature);
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
    for (const cell of this.landmarkCells) {
      drawGroundDecals(
        this.groundLayer,
        this.memory.placeHints(cellPlaceId(cell)),
        cell,
        TILE_PX,
        this.palette,
        this.terrainBaseOf(cell),
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

  /** 点到人就看她，返回 true；没点到返回 false，让调用方退回洗地。 */
  private lookAtVillagerAt(pointer: Phaser.Input.Pointer): boolean {
    const villager = this.villagerAt(pointer);
    if (villager === null) return false;
    this.lookAtVillager(villager.id);
    return true;
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
   * 指针底下那一格上有没有楼。有就开面板，返回 true。
   *
   * 命中的是**整块占地**，不只是门：一栋 4×4 的铺子，点它屋顶和点它门口
   * 应该是同一件事。与 `villagerAt` / `openSteleAt` 同一套「世界就是格」的
   * 模型——不给精灵加交互区，那会拦掉拖镜头。
   */
  private lookAtBuildingAt(pointer: Phaser.Input.Pointer): boolean {
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
    this.openBuilding(building.instanceId);
    return true;
  }

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
    let plan: CreationPlan;
    try {
      plan = creator.proposeCreation(request);
    } catch (error) {
      // schema 不过就是玩家的选择有问题：留在模式里，说清哪里不对。
      return {
        ok: false,
        message: error instanceof Error ? error.message : '造物意图不合法。',
      };
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
      day: Math.floor(this.snapshot.now / DAY_MS),
      traceable: true,
      recompute: () => creator.proposeCreation(request),
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
   * 没有 pack（莞尔镇）时回落 `WORLD`——`LEGACY_PACK.palette` 本来就是它，
   * 这条回落与「默认世界用默认色板」是同一件事。
   */
  private worldPalette(): WorldPalette {
    return this.pack?.palette ?? WORLD;
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
    const observation = observationOf(change, `mem_${this.memoryEventSerial}`, {
      atOfHolder: (holderId) => {
        const villager = this.snapshot?.villagers.find((item) => item.id === holderId);
        return villager === undefined ? undefined : { x: villager.pos.x, y: villager.pos.y };
      },
      atOfBuilding: (instanceId) => {
        const building = this.snapshot?.buildings.find((item) => item.instanceId === instanceId);
        return building === undefined ? undefined : { x: building.door.x, y: building.door.y };
      },
      buildingOfTask: (taskId) =>
        this.snapshot?.tasks.find((item) => item.id === taskId)?.buildingId ?? undefined,
    });
    if (observation === null) return;
    this.memory.observe(observation, undefined, at);
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
    const { snapshot } = this;
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
      const colors = style === undefined ? undefined : {
        cloak: this.pack!.palette[style.cloak] ?? WORLD.cloak,
        scarf: this.pack!.palette[style.scarf] ?? WORLD.trim,
        lamp: style.lamp,
      };
      // 色板一路传到小人与灯：第二座镇子换掉 amber / cloak 时，人跟着换。
      updateVillager(view, villager, snapshot.now, 0, 0, ALTITUDE, colors, this.pack?.palette ?? WORLD);
    }
    this.weatherView.update(this.sim.weatherIntensity(), delta);
    this.tideView.update(this.snapshot.tide.level);
    this.settingScenery?.update(this.snapshot.tide.level, this.snapshot.now);
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
    // 读快照里同一个数，这里不再另算。
    this.fogView.update(this.snapshot.fog, this.snapshot.now);

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

    const line = this.statusLine();
    if (line !== this.lastStatus) {
      this.lastStatus = line;
      for (const listener of this.statusListeners) listener(line);
    }
  }

  /** 新落成的楼要补一套视图；按 instanceId 对齐，不假设顺序。 */
  private syncBuildings(): void {
    for (const building of this.snapshot.buildings) {
      if (this.entries.some((entry) => entry.building.instanceId === building.instanceId)) continue;
      this.entries.push({
        building,
        view: createBuilding(this, building, 0, 0),
        emitter: createAccentEmitter(this, building.accent),
      });
    }
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
      g.lineStyle(1, WORLD.trim, 0.85);
      g.strokeRect(x + 1, y + 1, w - 2, h - 2);
      for (let px = x + 4; px < x + w; px += 8) {
        g.lineBetween(px, y + 2, px, y + h - 2);
      }
      g.lineStyle(1, WORLD.trim, 0.6);
      g.lineBetween(x + 1, y + h * progress, x + w - 1, y + h * progress);
      g.fillStyle(WORLD.ink, 0.55);
      g.fillRect(x + 1, y + 1, w - 2, h - 2);
      container.add(g);
      // 施工标签改图标（D5-A）：进度用线，不再画「施工中 xx%」中文。
      const icon = this.add.graphics();
      icon.fillStyle(WORLD.trim, 0.95);
      icon.fillRect(x + w / 2 - 4, y - 10, 9, 3);
      icon.fillRect(x + w / 2 - 1, y - 7, 2, 5);
      icon.fillStyle(WORLD.trim, 0.9);
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
    const weather = WEATHER_LABEL[this.snapshot.weather];
    const saveNote = this.saveNotice === null ? '' : `　　${this.saveNotice}`;
    // 真实时钟的异常与离线补算必须看得见：静默暂停会让人以为世界卡死了。
    const clockNote = this.clockNotice === null ? '' : `　　${this.clockNotice}`;
    if (this.pack?.authored === true) {
      return `${this.pack.name}　${summary}　　${this.snapshot.tide.label}　${weather}　${this.snapshot.feed.connected ? '事件流在线' : '离线生活'}${clockNote}${saveNote}`;
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
    return `${summary}　　${weather}　　${feedLabel}　　上游交付 ${feedDelivered} 单 · 本地交付 ${localDelivered} 单　　神恩 ${faith.points}/${3}${memory}${waiting}${queue}${finishHint}${clockNote}${saveNote}`;
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
}
