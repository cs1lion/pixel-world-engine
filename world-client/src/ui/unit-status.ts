/**
 * 单位状态菜单：点一个村民或一栋楼，只读地摆出**状态类**信息。
 *
 * 三条硬边界：
 * 1. **只读、不改世界。** 数据全部来自 `Simulation.snapshot()` 与记忆层的
 *    只读 `viewOf`；面板不持有可变世界状态，也不提供任何写入口。
 * 2. **不暂停时间。** 面板是 DOM 覆盖层，打开它不碰 `Simulation.update`。
 *    真实时钟模式下暂停会打乱日界关账；默认的游玩时间驱动同样不该为了看状态
 *    把世界冻住。
 * 3. **不让角色意识到被观测。** 这里不统计「被看了几次」，也不改行为。
 *
 * 「体况」用已有的情绪读数：近 3 日未被删除记忆的 valence / arousal 均值。
 * 世界没有个体体力字段，就不编一个；灯油明确标成渲染读数。
 */

import type {
  ConstructionSnapshot,
  PlacedBuilding,
  TaskRecord,
  VillagerSnapshot,
  WorkstationSnapshot,
} from '../world/types.ts';
import { TASK_PROFILES } from '../world/tasks.ts';
import { TILE_PX } from '../world/setup.ts';
import { villagerAtCell } from '../world/types.ts';
import { villagerModeLabel } from '../world/villager-words.ts';

export type UnitRef =
  | { readonly kind: 'villager'; readonly id: string }
  | { readonly kind: 'building'; readonly id: string };

/** 只读记忆视图里这一层需要的字段。多给的字段不影响结构赋值。 */
export interface UnitMemoryLine {
  readonly kind: string;
  readonly who: readonly string[];
  readonly valence: number;
  readonly arousal: number;
  readonly createdDay: number;
  readonly redacted: boolean;
}

export interface UnitBondLine {
  readonly to: string;
  readonly trust: number;
  readonly warmth: number;
  readonly debt: number;
}

export interface UnitMoodLine {
  readonly label: string;
  readonly valence: number;
  readonly arousal: number;
}

export interface UnitInnerLine {
  readonly templateId: string;
  readonly text: string;
}

export interface UnitMemoryReader {
  viewOf(holderId: string): { readonly memories: readonly UnitMemoryLine[] } | null;
  /** 方向性关系；省略时退回「印象 N 条」的旧显示。 */
  bondsOf?(holderId: string): readonly UnitBondLine[];
  /** 持久情绪；省略时显示「还没有可读的情绪状态」，不再现算近 3 天。 */
  moodOf?(holderId: string): UnitMoodLine | null;
  /** 面板内心话；只读，不写公开 bubble。 */
  innerVoiceOf?(holderId: string): UnitInnerLine | null;
  /**
   * 某一天的个人时间线。省略时面板不显示「今日」一段——老适配器不需要改。
   * 每格带 `memoryId` / `eventId`，点开能回到记忆条目。
   */
  dayTimelineOf?(holderId: string, day: number): readonly UnitDayTimelineEntry[];
}

export interface UnitDayTimelineEntry {
  readonly memoryId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly day: number;
  /**
   * 记忆条目的 `when` 是**第几天**，不是时刻——别拿它当时钟。
   * 显示用的时刻在 `tick`。
   */
  readonly when: number;
  /**
   * 事件实际发生在第几天。省略时退回 `day`（`createdDay`）——听说来的条目
   * 今天才落账，天序会和时刻（`tick`）对不上。
   */
  readonly atDay?: number | null;
  /**
   * 那天已经走过的毫秒数（事件真实发生的时刻）。查不到事实时省略或给 `null`，
   * 面板写「时刻不明」，不编一个 `00:00`。
   */
  readonly tick?: number | null;
  readonly placeId: string | null;
  readonly actors: readonly string[];
  readonly what: string | null;
  /** 记忆真的改了这一天的行为时，那句因果；没有就省略。 */
  readonly why?: string | null;
}

/** 面板里的一格「今日」：天序 + 时刻 + 事件 + 地点 + 对象，点开对应记忆条目。 */
export interface UnitTimelineLine {
  /** `第 3 天 13:20`；查不到时刻就写 `第 3 天 时刻不明`。 */
  readonly clock: string;
  readonly what: string;
  readonly place: string;
  readonly who: string;
  readonly memoryId: string;
  readonly eventId: string;
  /** 「所以今天避开他」——只在真的因此跳过拍子时出现。 */
  readonly why?: string | null;
}

/** 构造器只需要快照里的这几块，便于测试直接喂最小数据。 */
export interface UnitStatusWorld {
  readonly now: number;
  readonly altar: { readonly x: number; readonly y: number };
  readonly villagers: readonly VillagerSnapshot[];
  readonly buildings: readonly PlacedBuilding[];
  readonly tasks: readonly TaskRecord[];
  readonly workstations: readonly WorkstationSnapshot[];
  readonly constructions: readonly ConstructionSnapshot[];
}

export interface UnitStatusLine {
  readonly key: string;
  readonly value: string;
}

export interface UnitStatusContent {
  readonly kind: UnitRef['kind'];
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly lines: readonly UnitStatusLine[];
  /** 「今天经历过什么」。只对村民有；没有记忆适配器时整段缺席。 */
  readonly today?: readonly UnitTimelineLine[];
}

const CARRY_LABELS: Readonly<Record<string, string>> = {
  scroll: '卷轴',
  stone: '石子',
  paper: '纸片',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** 世界时间写法：`第 3 天 17:42`。只读快照里的 `now`。 */
export function worldClockLabel(now: number): string {
  const day = Math.floor(now / DAY_MS);
  const rest = now - day * DAY_MS;
  const minutes = Math.floor(rest / 60_000);
  const hours = Math.floor(minutes / 60);
  return `第 ${day} 天 ${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function annexOf(villager: VillagerSnapshot, world: UnitStatusWorld): PlacedBuilding | null {
  const x = Math.floor(villager.pos.x);
  const y = Math.floor(villager.pos.y);
  return (
    world.buildings.find(
      (building) =>
        x >= building.origin.x
        && x < building.origin.x + building.footprint.w
        && y >= building.origin.y
        && y < building.origin.y + building.footprint.h,
    ) ?? null
  );
}

function avg(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function moodLines(villagerId: string, _world: UnitStatusWorld, memory: UnitMemoryReader | null): UnitStatusLine[] {
  const mood = memory?.moodOf?.(villagerId) ?? null;
  if (mood === null) return [{ key: '情绪', value: '还没有可读的情绪状态' }];
  return [{
    key: '情绪',
    value: `${mood.label} · 效价 ${mood.valence.toFixed(2)} · 唤醒 ${mood.arousal.toFixed(2)}`,
  }];
}

function debtLabel(debt: number): string {
  if (debt > 0.01) return `我欠他 ${debt.toFixed(2)}`;
  if (debt < -0.01) return `他欠我 ${Math.abs(debt).toFixed(2)}`;
  return '两不相欠';
}

function attitudeLines(
  villager: VillagerSnapshot,
  world: UnitStatusWorld,
  memory: UnitMemoryReader | null,
): UnitStatusLine[] {
  const others = world.villagers.filter((item) => item.id !== villager.id && item.visible);
  if (others.length === 0) return [{ key: '在场者', value: '只有她自己' }];
  const bonds = memory?.bondsOf?.(villager.id);
  if (bonds !== undefined) {
    return others.map((other) => {
      const bond = bonds.find((item) => item.to === other.id);
      if (bond === undefined) {
        return {
          key: `对 ${other.name}`,
          value: '还没有印象 · 信任 0.00 · 亲疏 0.00 · 两不相欠',
        };
      }
      return {
        key: `对 ${other.name}`,
        value: `信任 ${bond.trust.toFixed(2)} · 亲疏 ${bond.warmth.toFixed(2)} · ${debtLabel(bond.debt)}`,
      };
    });
  }
  const lines = memory?.viewOf(villager.id)?.memories ?? [];
  return others.map((other) => {
    const impressions = lines.filter(
      (line) => line.kind === 'impression' && line.who.includes(other.id),
    );
    if (impressions.length === 0) {
      return { key: `对 ${other.name}`, value: '还没有印象' };
    }
    const valence = avg(impressions.map((line) => line.valence)) ?? 0;
    const label = valence >= 0.2 ? '印象不错' : valence <= -0.2 ? '印象不佳' : '印象中性';
    return { key: `对 ${other.name}`, value: `${label}（${impressions.length} 条印象）` };
  });
}

function innerLines(villagerId: string, memory: UnitMemoryReader | null): UnitStatusLine[] {
  const inner = memory?.innerVoiceOf?.(villagerId) ?? null;
  return inner === null ? [] : [{ key: '心里', value: inner.text }];
}

/** 当天时刻写法：`13:20`。`tick` 是当天已走过的毫秒数，不是第几天。 */
function clockOf(tick: number): string {
  const rest = tick - Math.floor(tick / DAY_MS) * DAY_MS;
  const minutes = Math.floor(rest / 60_000);
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * 时间线条目的一格开头：**天序与时刻都写**。
 *
 * 记忆里只存了「第几天」（`content.when`），拿它当时刻会把所有格子都写成
 * `00:00`——那是在骗人。时刻从事实的 `tick` 来；查不到事实就直说「时刻不明」，
 * 不拿午夜顶替。
 */
function dayClockLabel(day: number, tick: number | null | undefined): string {
  return tick === null || tick === undefined
    ? `第 ${day} 天 时刻不明`
    : `第 ${day} 天 ${clockOf(tick)}`;
}

function placeLabel(placeId: string | null, world: UnitStatusWorld): string {
  if (placeId === null) return '地点不明';
  if (placeId.startsWith('place:')) {
    const [x, y] = placeId.slice('place:'.length).split(',');
    return `街上 (${x}, ${y})`;
  }
  return world.buildings.find((item) => item.instanceId === placeId)?.displayName ?? placeId;
}

/**
 * 「今天经历过什么」：一条按时间排的个人时间线，每格带事件、地点、对象，
 * 以及它对应的记忆条目 id。
 *
 * 只读 `dayTimelineOf`；适配器没给就整段缺席，不去猜别人的今天。
 */
function timelineLines(
  villager: VillagerSnapshot,
  world: UnitStatusWorld,
  memory: UnitMemoryReader | null,
): UnitTimelineLine[] {
  const reader = memory?.dayTimelineOf;
  if (reader === undefined) return [];
  const day = Math.floor(world.now / DAY_MS);
  const names = new Map(world.villagers.map((item) => [item.id, item.name]));
  return reader(villager.id, day).map((entry) => {
    const others = entry.actors
      .filter((id) => id !== villager.id)
      .map((id) => names.get(id) ?? id);
    return {
      clock: dayClockLabel(entry.atDay ?? entry.day, entry.tick),
      what: entry.what ?? `${entry.kind}（没有留下说法）`,
      place: placeLabel(entry.placeId, world),
      who: others.length === 0 ? '独自' : `与 ${others.join('、')}`,
      memoryId: entry.memoryId,
      eventId: entry.eventId,
      why: entry.why ?? null,
    };
  });
}

function villagerContent(
  villager: VillagerSnapshot,
  world: UnitStatusWorld,
  memory: UnitMemoryReader | null,
): UnitStatusContent {
  const task = world.tasks.find((item) => item.id === villager.taskId);
  const annex = annexOf(villager, world);
  const venue = annex?.displayName ?? null;
  const modeText = villagerModeLabel(villager, world, task, venue);
  const workstation = task?.buildingId === null || task?.buildingId === undefined
    ? undefined
    : world.workstations.find((item) => item.buildingId === task.buildingId);

  let eta = '—';
  if (task !== undefined && workstation?.activity.kind === 'operating') {
    eta = workstation.activity.determinate
      ? `${Math.max(0, Math.round(workstation.activity.estimateMs - workstation.elapsedMs))} 毫秒`
      : '由上游决定，世界不知道';
  } else if (task !== undefined) {
    eta = '不在计时';
  }

  const carrying = villager.carrying === null ? '空手' : CARRY_LABELS[villager.carrying] ?? villager.carrying;
  const credentials = villager.carries.length === 0 ? '无凭证' : villager.carries.join('、');

  const cell = { x: Math.floor(villager.pos.x), y: Math.floor(villager.pos.y) };
  const where = annex === null ? `格子 (${cell.x}, ${cell.y})` : `格子 (${cell.x}, ${cell.y}) · ${annex.displayName}`;

  const lines: UnitStatusLine[] = [
    { key: '行为', value: modeText },
    {
      key: '目标',
      value: task === undefined ? (villager.routine ?? '没有接活') : `${task.summary}（${task.status}）`,
    },
    { key: '预计', value: eta },
    { key: '位置', value: where },
    ...moodLines(villager.id, world, memory),
    ...innerLines(villager.id, memory),
    { key: '灯油', value: `${villager.lampOil.toFixed(2)}（渲染读数，不是世界状态）` },
    { key: '携带', value: `${carrying} · ${credentials}` },
    ...attitudeLines(villager, world, memory),
  ];

  const today = timelineLines(villager, world, memory);
  return {
    kind: 'villager',
    id: villager.id,
    title: villager.name,
    subtitle: `村民 ${villager.id}`,
    lines,
    ...(today.length === 0 ? {} : { today }),
  };
}

function buildingStatus(
  building: PlacedBuilding,
  world: UnitStatusWorld,
): { readonly status: string; readonly task: TaskRecord | null; readonly workstation: WorkstationSnapshot | undefined } {
  const construction = world.constructions.find((item) => item.buildingId === building.instanceId);
  if (construction !== undefined) {
    return { status: `在建 · 剩余 ${Math.round(construction.remainingMs / 1000)} 秒`, task: null, workstation: undefined };
  }
  const workstation = world.workstations.find((item) => item.buildingId === building.instanceId);
  if (workstation === undefined) return { status: '空置', task: null, workstation };
  const activity = workstation.activity;
  switch (activity.kind) {
    case 'operating': {
      const task = world.tasks.find((item) => item.id === activity.taskId) ?? null;
      return { status: `营业${task === null ? '' : `：${task.summary}`}`, task, workstation };
    }
    case 'cooling':
      return { status: '冷却中', task: null, workstation };
    case 'overheating':
      return { status: '过热', task: null, workstation };
    case 'idle':
      return { status: '空置', task: null, workstation };
  }
}

function buildingLastChange(
  building: PlacedBuilding,
  world: UnitStatusWorld,
  info: { readonly task: TaskRecord | null; readonly workstation: WorkstationSnapshot | undefined },
): UnitStatusLine {
  const completed = world.tasks
    .filter((task) => task.buildingId === building.instanceId && task.completedAt !== null)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
  if (completed !== undefined && completed.completedAt !== null) {
    return {
      key: '最近变化',
      value: `交付「${completed.summary}」 · ${worldClockLabel(completed.completedAt)}`,
    };
  }
  if (info.workstation?.activity.kind === 'operating') {
    return {
      key: '最近变化',
      value: `开工「${info.task?.summary ?? info.workstation.activity.taskId}」 · ${worldClockLabel(info.workstation.activity.startedAt)}`,
    };
  }
  const construction = world.constructions.find((item) => item.buildingId === building.instanceId);
  if (construction !== undefined) {
    const startedAt = world.now - (construction.totalMs - construction.remainingMs);
    return {
      key: '最近变化',
      value: `开工建造 · ${worldClockLabel(startedAt)}`,
    };
  }
  return { key: '最近变化', value: '没有可读的变化记录' };
}

function buildingContent(building: PlacedBuilding, world: UnitStatusWorld): UnitStatusContent {
  const info = buildingStatus(building, world);
  const occupants = world.villagers.filter(
    (villager) =>
      Math.floor(villager.pos.x) >= building.origin.x
      && Math.floor(villager.pos.x) < building.origin.x + building.footprint.w
      && Math.floor(villager.pos.y) >= building.origin.y
      && Math.floor(villager.pos.y) < building.origin.y + building.footprint.h,
  );
  const taskLabel =
    building.boundTask === null
      ? '不接活'
      : TASK_PROFILES[building.boundTask]?.label ?? building.boundTask;
  const lines: UnitStatusLine[] = [
    { key: '状态', value: info.status },
    { key: '当前的活', value: taskLabel },
    { key: '在内的人', value: occupants.length === 0 ? '没有人' : occupants.map((item) => item.name).join('、') },
    buildingLastChange(building, world, info),
    { key: '占地', value: `${building.footprint.w}×${building.footprint.h} · 门 (${building.door.x}, ${building.door.y})` },
  ];
  return {
    kind: 'building',
    id: building.instanceId,
    title: building.displayName,
    subtitle: `${building.zone} · ${building.prefabId}`,
    lines,
  };
}

/**
 * 构造面板内容。找不到单位返回 `null`——面板收起，不编一行占位。
 * 空数据同理：没有村民就返回 `null`。
 */
export function buildUnitStatus(
  world: UnitStatusWorld,
  selection: UnitRef,
  memory: UnitMemoryReader | null = null,
): UnitStatusContent | null {
  if (selection.kind === 'villager') {
    const villager = world.villagers.find((item) => item.id === selection.id);
    return villager === undefined ? null : villagerContent(villager, world, memory);
  }
  const building = world.buildings.find((item) => item.instanceId === selection.id);
  return building === undefined ? null : buildingContent(building, world);
}

/**
 * 屏幕点下的那一格。视野原点由 `CameraController.viewportRect()` 给，不碰 scrollX。
 *
 * `zoom` 是**每世界像素对应多少屏幕像素**：相机 zoom × 画布 CSS 缩放。
 * 画布内部 480px 显示成 960px 再加相机 2 倍时，这个数是 4，不是 2。
 */
export function cellAtScreenPoint(
  screen: { readonly x: number; readonly y: number },
  viewport: { readonly x: number; readonly y: number },
  zoom: number,
  canvas: { readonly left: number; readonly top: number },
): { readonly x: number; readonly y: number } {
  const worldX = viewport.x + (screen.x - canvas.left) / zoom;
  const worldY = viewport.y + (screen.y - canvas.top) / zoom;
  return { x: Math.floor(worldX / TILE_PX), y: Math.floor(worldY / TILE_PX) };
}

/** 一格中心的屏幕坐标。命中测试用这个，避开格子边界上的浮点误差。 */
export function screenHitPointForCell(
  cell: { readonly x: number; readonly y: number },
  viewport: { readonly x: number; readonly y: number },
  zoom: number,
  canvas: { readonly left: number; readonly top: number },
): { readonly x: number; readonly y: number } {
  return {
    x: canvas.left + ((cell.x + 0.5) * TILE_PX - viewport.x) * zoom,
    y: canvas.top + ((cell.y + 0.5) * TILE_PX - viewport.y) * zoom,
  };
}

/** 一格在屏幕上的锚点：格子的上边中点。面板挂在它上方。 */
export function screenAnchorForCell(
  cell: { readonly x: number; readonly y: number },
  viewport: { readonly x: number; readonly y: number },
  zoom: number,
  canvas: { readonly left: number; readonly top: number },
): { readonly x: number; readonly y: number } {
  return {
    x: canvas.left + ((cell.x + 0.5) * TILE_PX - viewport.x) * zoom,
    y: canvas.top + (cell.y * TILE_PX - viewport.y) * zoom,
  };
}

/** 面板锚点用哪一格：村民取脚下，楼取屋顶中点。 */
export function anchorCellOf(world: UnitStatusWorld, selection: UnitRef): { readonly x: number; readonly y: number } | null {
  if (selection.kind === 'villager') {
    const villager = world.villagers.find((item) => item.id === selection.id);
    if (villager === undefined) return null;
    return { x: Math.floor(villager.pos.x), y: Math.floor(villager.pos.y) };
  }
  const building = world.buildings.find((item) => item.instanceId === selection.id);
  if (building === undefined) return null;
  return {
    x: building.origin.x + Math.floor(building.footprint.w / 2),
    y: building.origin.y,
  };
}

export interface UnitStatusView {
  readonly content: UnitStatusContent;
  /** 面板锚点的屏幕坐标（fixed 定位）。跟随镜头缩放/平移。 */
  readonly anchor: { readonly x: number; readonly y: number };
}

export interface UnitStatusOracle {
  /** 订阅当前菜单；晚订阅的人会先拿到现状（与村民/楼面板同一条）。 */
  onUnitStatus(listener: (view: UnitStatusView | null) => void): () => void;
  /** Esc / 点空白。只收起面板，不改世界，也不暂停。 */
  dismissUnitStatus(): void;
  /** 只读视图，给浏览器验收与脚本读同一份数据。 */
  unitStatus(): UnitStatusContent | null;
}

/** 绑定 DOM：菜单只读渲染，锚点每帧由场景通过 `onUnitStatus` 推过来。 */
export function bindUnitStatusPanel(oracle: () => UnitStatusOracle | undefined): {
  readonly dispose: () => void;
} {
  const panel = document.querySelector<HTMLElement>('#unit-status');
  const title = document.querySelector<HTMLElement>('#unit-status-title');
  const subtitle = document.querySelector<HTMLElement>('#unit-status-subtitle');
  const body = document.querySelector<HTMLElement>('#unit-status-body');
  const close = document.querySelector<HTMLButtonElement>('#unit-status-close');
  if (!panel || !title || !subtitle || !body) return { dispose: () => {} };

  let unsubscribe: (() => void) | null = null;
  let api: UnitStatusOracle | null = null;

  const render = (view: UnitStatusView | null): void => {
    if (view === null) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    title.textContent = view.content.title;
    subtitle.textContent = view.content.subtitle;
    const rows: HTMLElement[] = view.content.lines.map((line) => {
      const row = document.createElement('div');
      row.className = 'unit-status-row';
      const key = document.createElement('span');
      key.className = 'unit-status-key';
      key.textContent = line.key;
      const value = document.createElement('span');
      value.className = 'unit-status-value';
      value.textContent = line.value;
      row.append(key, value);
      return row;
    });
    const today = view.content.today ?? [];
    if (today.length > 0) {
      const section = document.createElement('details');
      section.className = 'unit-status-today';
      section.open = true;
      const summary = document.createElement('summary');
      summary.textContent = `今日 ${today.length} 件`;
      section.append(summary);
      for (const entry of today) {
        const item = document.createElement('details');
        item.className = 'unit-status-today-item';
        const head = document.createElement('summary');
        head.textContent = `${entry.clock} · ${entry.what}`;
        const detail = document.createElement('div');
        detail.className = 'unit-status-today-detail';
        detail.textContent = `${entry.place} · ${entry.who}`
          + `${entry.why === null || entry.why === undefined ? '' : ` · ${entry.why}`}`
          + ` · 记忆 ${entry.memoryId} · 事件 ${entry.eventId}`;
        item.append(head, detail);
        section.append(item);
      }
      rows.push(section);
    }
    body.replaceChildren(...rows);
    panel.style.left = `${Math.round(view.anchor.x)}px`;
    panel.style.top = `${Math.round(view.anchor.y)}px`;
  };

  const attach = (): void => {
    const next = oracle();
    if (next === undefined || next === api) return;
    unsubscribe?.();
    api = next;
    unsubscribe = next.onUnitStatus(render);
  };

  attach();
  const timer = setInterval(attach, 500);

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || panel.hidden) return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    oracle()?.dismissUnitStatus();
  };
  document.addEventListener('keydown', onKeydown);
  const onClose = (): void => {
    oracle()?.dismissUnitStatus();
  };
  close?.addEventListener('click', onClose);

  return {
    dispose: () => {
      clearInterval(timer);
      unsubscribe?.();
      document.removeEventListener('keydown', onKeydown);
      close?.removeEventListener('click', onClose);
    },
  };
}

/** 触屏长按的阈值：约 500ms。 */
export const LONG_PRESS_MS = 500;

/**
 * 长按是否该开上下文面板。指针已经移出单位（`stillOnUnit=false`）就不算。
 * 单拆成函数是为了让 500ms 与「移出即取消」两条都有单测。
 */
export function longPressShouldFire(elapsedMs: number, stillOnUnit: boolean): boolean {
  return stillOnUnit && elapsedMs >= LONG_PRESS_MS;
}

/** 指针格子先比人再比楼；上到碑的优先级仍由调用方决定。 */
export function unitAtCell(world: UnitStatusWorld, x: number, y: number): UnitRef | null {
  const villager = villagerAtCell(world.villagers, x, y);
  if (villager !== null) return { kind: 'villager', id: villager.id };
  const building = world.buildings.find(
    (item) =>
      x >= item.origin.x
      && x < item.origin.x + item.footprint.w
      && y >= item.origin.y
      && y < item.origin.y + item.footprint.h,
  );
  return building === undefined ? null : { kind: 'building', id: building.instanceId };
}
