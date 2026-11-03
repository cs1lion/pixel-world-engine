/** 上帝调试面板：只读实体列表 + 事件流（S2-3）。
 *
 * 纯函数负责组数据（可离线单测）；DOM 部分只负责开关、暂停/过滤和节流渲染。
 * 面板不改变仿真：所有数据都来自快照 / 只读事件 / 只读存档元信息。
 */

import type { AgentToWorld } from '../world/bridge.ts';
import type { RewindResult } from '../world/history/scene-history.ts';
import type { WorldEvent, WorldSnapshot } from '../world/types.ts';
import type { SettingSceneryMetrics } from '../render/setting-scale.ts';
import { summarizeWorld } from '../world/world-state.ts';

export const DEBUG_EVENT_LIMIT = 50;
/** 面板刷新节流 4Hz；10Hz 的逻辑步长不受影响（纯 DOM，不参与仿真）。 */
export const DEBUG_REFRESH_MS = 250;

export type EventTone = WorldEvent['tone'];
export type ToneFilter = EventTone | 'all';

export interface SaveStatusView {
  readonly schemaVersion: number;
  readonly savedAtWallClock: number | null;
  readonly autoSavePaused: boolean;
}

export interface DebugFilters {
  readonly tone: ToneFilter;
  readonly limit: number;
}

export interface DebugVillagerRow {
  readonly id: string;
  readonly name: string;
  readonly mode: string;
  readonly taskId: string;
}

export interface DebugBuildingRow {
  readonly instanceId: string;
  readonly displayName: string;
  readonly activity: string;
  readonly currentTask: string;
  readonly constructionRemainingMs: number | null;
}

export interface DebugTaskRow {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly source: string;
  readonly status: string;
  readonly workerId: string;
  readonly buildingId: string;
  readonly blockedQuestion: string;
}

export interface DebugPendingRow {
  readonly villagerId: string;
  readonly villagerName: string;
  readonly items: readonly { readonly id: string; readonly kind: string; readonly summary: string }[];
}

export interface DebugModel {
  readonly villagers: readonly DebugVillagerRow[];
  readonly buildings: readonly DebugBuildingRow[];
  readonly tasks: readonly DebugTaskRow[];
  readonly pending: readonly DebugPendingRow[];
  readonly feed: WorldSnapshot['feed'];
  readonly save: SaveStatusView | null;
  readonly events: readonly WorldEvent[];
  readonly counts: {
    readonly villagers: number;
    readonly buildings: number;
    readonly tasks: number;
    readonly pending: number;
    readonly events: number;
  };
}

export function selectEvents(
  events: readonly WorldEvent[],
  filters: DebugFilters,
): readonly WorldEvent[] {
  const filtered =
    filters.tone === 'all' ? [...events] : events.filter((event) => event.tone === filters.tone);
  const limit = Math.max(0, Math.floor(filters.limit));
  return filtered.slice(-limit);
}

export function buildDebugModel(
  snapshot: WorldSnapshot,
  events: readonly WorldEvent[],
  save: SaveStatusView | null,
  filters: DebugFilters,
): DebugModel {
  const buildings: DebugBuildingRow[] = snapshot.workstations.map((workstation) => {
    const building = snapshot.buildings.find(
      (item) => item.instanceId === workstation.buildingId,
    );
    const activity = workstation.activity;
    const currentTask = 'taskId' in activity ? activity.taskId : '';
    const construction = snapshot.constructions.find(
      (item) => item.buildingId === workstation.buildingId,
    );
    return {
      instanceId: workstation.buildingId,
      displayName: building?.displayName ?? workstation.buildingId,
      activity: activity.kind,
      currentTask,
      constructionRemainingMs: construction?.remainingMs ?? null,
    };
  });
  const pending: DebugPendingRow[] = snapshot.villagers.map((villager) => ({
    villagerId: villager.id,
    villagerName: villager.name,
    items: snapshot.pending
      .filter((item) => item.villagerId === villager.id)
      .map((item) => ({ id: item.id, kind: item.kind, summary: item.summary })),
  }));
  const selectedEvents = selectEvents(events, filters);
  return {
    villagers: snapshot.villagers.map((villager) => ({
      id: villager.id,
      name: villager.name,
      mode: villager.mode,
      taskId: villager.taskId ?? '—',
    })),
    buildings,
    tasks: snapshot.tasks.map((task) => ({
      id: task.id,
      kind: task.kind,
      summary: task.summary,
      source: task.source,
      status: task.status,
      workerId: task.workerId ?? '—',
      buildingId: task.buildingId ?? '—',
      blockedQuestion: task.blockedQuestion ?? '—',
    })),
    pending,
    feed: snapshot.feed,
    save,
    events: selectedEvents,
    counts: {
      villagers: snapshot.villagers.length,
      buildings: snapshot.workstations.length,
      tasks: snapshot.tasks.length,
      pending: snapshot.pending.length,
      events: selectedEvents.length,
    },
  };
}

/** 存档状态一行字（调试用，不参与逻辑）。 */
export function saveStatusLine(save: SaveStatusView | null): string {
  if (save === null) return '存档：未写入';
  const savedAt =
    save.savedAtWallClock === null
      ? '未记录'
      : new Date(save.savedAtWallClock).toISOString().slice(11, 19);
  return `存档：v${save.schemaVersion} · 保存于 ${savedAt} UTC · 自动存档${save.autoSavePaused ? '已暂停' : '开启'}`;
}

const FEED_FIELDS: readonly (keyof WorldSnapshot['feed'])[] = [
  'connected',
  'reconciled',
  'cursor',
  'lastReadAt',
];

export function feedSummary(feed: WorldSnapshot['feed']): string {
  const parts = FEED_FIELDS.map((key) => `${key}=${String(feed[key])}`);
  return `事件流：${parts.join(' · ')}`;
}

export interface DebugPanelSources {
  readonly getSnapshot: () => WorldSnapshot | undefined;
  readonly getEvents: (limit: number) => readonly WorldEvent[];
  readonly getSaveStatus: () => SaveStatusView | null;
  readonly feed?: (message: {
    readonly type: 'task.assigned';
    readonly taskId: string;
    readonly taskKind: 'code' | 'research' | 'writing' | 'quick';
    readonly summary: string;
  }) => { readonly ok: boolean; readonly message: string };
  /** 注入一条上游事件，验证「事件流 → 世界」这条链路通着。 */
  readonly pushEvent?: (event: { kind: string; payload: Record<string, unknown> }) => void;
  /** 只读回溯的时间轴。省略 = 这一版没有历史层。 */
  readonly historyDays?: () => readonly HistoryDayView[];
  /** 读某一天的视图。**只读**：面板不会拿它写任何东西。 */
  readonly historyRewind?: (day: number) => Promise<HistoryRewindView | null>;
}

/**
 * 外环（creator）当前指标窗口里的只读计数。
 *
 * 这些数只回答「查过几次」，不回答「查出了什么」：冲突/不变式违反的结论仍在
 * `MetricWindow` 的 `conflictCount` / `invariantViolationCount`，走门禁判定。
 * 字段名与门禁用的比率对齐（`replayHashChecks` 对应 `replayHashConsistencyRate`
 * 的观测次数），底层计数器叫 `replayChecks`。
 *
 * **只读快照**：每次调用现取一份新对象，拿到之后改它不会影响外环。
 */
export interface CreatorChecksView {
  readonly conflictChecks: number;
  readonly invariantChecks: number;
  readonly pathfindingChecks: number;
  readonly replayHashChecks: number;
  readonly coverageChecks: number;
}

/**
 * 场景挂在 `window.Oracle` 上的那一面里，调试面板要用的那几样。
 *
 * 它原来声明在 `main.ts` 里——而 `main.ts` 是接线的地方，不是契约待的地方。更麻
 * 烦的是**它在生产侧没有对手**：场景那头是 `as unknown as { Oracle: typeof api }`，
 * 消费侧（`main.ts`）另写一次 `as unknown as { Oracle?: DebugOracle }`，两次断言
 * 中间没有任何东西核对。场景少挂一样，这边照样"类型安全"，运行时才炸。
 *
 * 所以搬到这里，并由场景在挂载时赋一次值——见 `SandboxScene.registerOracleApi()`
 * 里那三行 `const xxx: Xxx = api`。`OracleApi` 那一处已经这么接了（`6ac7a6b`），
 * 这两处是同一个洞，一起堵上。
 */
/**
 * 一个人的时间线上的一格（只读）。`eventId` 与事件日志同一个 id；
 * `bias` 只在「记错了」的条目上出现。
 */
export interface MemoryTimelineEntry {
  readonly memoryId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly day: number;
  readonly when: number;
  readonly sourceMode: string;
  readonly bias?: string;
}

/** 时间轴上一格：哪一天、有没有记录。 */
export interface HistoryDayView {
  readonly day: number;
  readonly kind: 'base' | 'patch' | 'missing';
}

/**
 * 某一天的只读回溯视图。**只给摘要**：时代、角色记得的几条、场景的阶段。
 *
 * 它不是「那天的世界」本身——真正的世界存档与记忆快照在 `SceneHistory` 里，
 * 面板只消费这份投影（与 `PlaceChronicle` 同一条纪律）。
 *
 * 类型直接复用历史层的 `RewindResult`：面板要的与回溯 API 给的是同一份东西，
 * 少一层再抄一遍的映射，就少一处「面板说 A、接口说 B」的漂移。
 */
export type HistoryRewindView = RewindResult;

/**
 * 真实时钟的只读状态。`catchUp` 是最近一次补算的结果——常驻到下一次补算/造物，
 * 不随帧消失；没有 setter。
 */
export interface ClockStatusView {
  readonly mode: 'accelerated' | 'real';
  readonly paused: boolean;
  readonly notice: string | null;
  readonly catchUp: {
    readonly kind: 'day-by-day' | 'merged';
    readonly days: number;
    readonly skippedDays: number;
  } | null;
}

export interface DebugOracle {
  view(): WorldSnapshot;
  events(limit: number): readonly WorldEvent[];
  saveStatus(): SaveStatusView;
  /** 某个角色记得的事，按天/时刻排序。省略表示这一面没挂。 */
  memoryTimeline?(holderId: string): readonly MemoryTimelineEntry[];
  /** 只读关系账本，供浏览器验收对照面板读数。 */
  memoryBonds?(holderId: string): readonly {
    readonly to: string;
    readonly trust: number;
    readonly warmth: number;
    readonly debt: number;
  }[];
  /** 只读持久情绪，供浏览器验收对照面板读数。 */
  memoryMood?(holderId: string): { readonly label: string; readonly valence: number; readonly arousal: number } | null;
  /** 只读内心话，供浏览器验收对照模板 id。 */
  memoryInner?(holderId: string): { readonly templateId: string; readonly text: string } | null;
  /** 调试/浏览器验收：打开某个角色的只读状态菜单，不写世界。 */
  openUnitStatusForDebug?(holderId: string): boolean;
  /**
   * 调试灯态：`true`/`false` 强制街灯亮/灭，`null` 交回世界时钟。
   * 只压过渲染层，不改 `lampStreetLitAt` 的时刻判据。
   */
  debugForceLamps?(on: boolean | null): boolean | null;
  /**
   * 灯柱/灯串的三支动态开关。缺省全开；证据脚本逐支关掉取「关掉时帧差为 0」的对照。
   */
  debugLampMotion?(patch: { ignite?: boolean; breathe?: boolean; sway?: boolean }): {
    ignite: boolean;
    breathe: boolean;
    sway: boolean;
  };
  /** 世界时间冻住：不推进模拟、渲染照跑。验「暂停世界后画面静止」。 */
  debugHoldWorld?(on: boolean): boolean;
  /** 冻住时手动推进一格（世界毫秒），返回推进后的世界时刻。 */
  debugStepWorld?(ms: number): number;
  /** 渐次点亮的排期：第一盏/最后一盏的世界时刻，与此刻亮满了几盏。 */
  debugLampIgnition?(): {
    total: number;
    spanMs: number;
    rampMs: number;
    firstAtMs: number | null;
    lastAtMs: number | null;
    litAt: number;
  };
  /** 全街 28 盏的渐次顺序与坐标。 */
  debugLampUnits?(): readonly { order: number; x: number; y: number; hanging: boolean }[];
  /**
   * 摊位两支动态的开关（棚布/盖布摆动、火光跳动）。缺省全开；
   * 证据脚本逐支关掉取「关掉时帧差为 0」的对照。
   */
  debugStallMotion?(patch: { cloth?: boolean; fire?: boolean }): {
    cloth: boolean;
    fire: boolean;
  };
  /** 本帧摊位读数：棚布摆幅、火光亮度/焰高、盖布摆幅，以及当前是否已盖。 */
  debugStallUnits?(): {
    weather: string;
    packed: boolean;
    stalls: readonly {
      order: number;
      x: number;
      y: number;
      awningSway: number;
      fireLevel: number;
      fireHeight: number;
    }[];
    covers: readonly { order: number; dx: number; droop: number }[];
  };
  /** 证据脚本要一份确定的雨天：下一条 `setWeather`，世界照常走一步。 */
  debugSetWeather?(weather: 'clear' | 'rain' | 'storm' | 'fog'): string;
  /** 钉死「摊子已盖」这一渲染态（`null` 交回天气）；只压画面，不改世界。 */
  debugForcePacked?(on: boolean | null): boolean | null;
  /** 钉死渲染用的潮位（0..1）；`null` 交回快照。只压画面，不改世界。 */
  debugPinTide?(level: number | null): number | null;
  /** 藏掉天上的鸟/蝙蝠（证据隔离用）。 */
  debugHideAmbience?(hidden: boolean): boolean;
  /**
   * 立面与街灯的实际像素尺寸（店面墙 48 / 灯柱 58 / 灯体下沿 43）。
   * 证据脚本拿它画标尺：尺子读渲染常量，不另抄一份数字。
   */
  debugSettingScale?(): SettingSceneryMetrics | null;
  /** 地面光池这一层的指令数：灯灭时应为 0（残留亮斑会让它不为 0）。 */
  debugLampPool?(): number;
  feed(message: AgentToWorld): { ok: boolean; message: string };
  pushEvent(event: { kind: string; payload: Record<string, unknown> }): void;
  /**
   * 外环指标窗口的只读计数。世界还没醒来 / 外环没起来时返回 `null`——
   * 不用全 0 顶替，因为 0 的意思是「外环在，只是还没查过」。
   */
  creatorChecks(): CreatorChecksView | null;
  /** 真实时钟的只读状态。省略表示这一面没挂。 */
  clockStatus?(): ClockStatusView;
  /** 只读回溯的时间轴。省略表示这一面没挂（例如浏览器没有 IndexedDB）。 */
  historyDays?(): readonly HistoryDayView[];
  /** 读某一天的只读视图。省略 = 没有历史层。 */
  historyRewind?(day: number): Promise<HistoryRewindView | null>;
}

export interface DebugPanelHandle {
  readonly dispose: () => void;
  readonly isOpen: () => boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

function row(label: string, value: string, kind?: string): HTMLElement {
  const node = element('div', 'dbg-row');
  if (kind !== undefined) node.dataset.debugRow = kind;
  const key = element('span', 'dbg-key');
  key.textContent = label;
  const val = element('span', 'dbg-val');
  val.textContent = value;
  node.append(key, val);
  return node;
}

function section(title: string, count: number): HTMLElement {
  const wrapper = element('section', 'dbg-section');
  const heading = element('h3');
  heading.textContent = `${title}（${count}）`;
  wrapper.append(heading);
  return wrapper;
}

/** 绑定面板；返回句柄可用于测试/卸载。不影响仿真。 */
export function bindDebugPanel(sources: DebugPanelSources): DebugPanelHandle {
  const panel = document.querySelector<HTMLElement>('#debug-panel');
  const toggle = document.querySelector<HTMLButtonElement>('#debug-toggle');
  const close = document.querySelector<HTMLButtonElement>('#debug-close');
  const pause = document.querySelector<HTMLInputElement>('#debug-pause');
  const tone = document.querySelector<HTMLSelectElement>('#debug-tone');
  const content = document.querySelector<HTMLDivElement>('#debug-content');
  const stats = document.querySelector<HTMLDivElement>('#debug-stats');
  const injectSlot = document.querySelector<HTMLDivElement>('#debug-inject-slot');
  if (!panel || !toggle || !content || !tone || !pause) {
    return { dispose: () => {}, isOpen: () => false };
  }

  let open = false;
  let paused = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** 回溯详情常驻在这里：面板每 250ms 重绘，详情不能被那次重绘擦掉。 */
  let historyView: HistoryRewindView | null = null;
  let historyPending = false;

  // 注入区随面板创建一次，放在 #debug-content 之外：repaint 只清 content，
  // details 的 open 状态与按钮事件绑定都不会丢（task-19 P2 修复）。
  if (injectSlot !== null && (sources.feed !== undefined || sources.pushEvent !== undefined)) {
    const details = element('details', 'dbg-inject');
    details.id = 'debug-inject';
    const summary = element('summary');
    summary.textContent = '调试注入（仅调试、不写日志；默认收起）';
    details.append(summary);
    if (sources.feed !== undefined) {
      const feedButton = element('button');
      feedButton.type = 'button';
      feedButton.dataset.debugAction = 'feed';
      feedButton.textContent = '注入一条 quick 外部单';
      feedButton.addEventListener('click', () => {
        sources.feed?.({
          type: 'task.assigned',
          taskId: `dbg-${Date.now()}`,
          taskKind: 'quick',
          summary: '调试注入的小事（不写日志）',
        });
      });
      details.append(feedButton);
    }
    if (sources.pushEvent !== undefined) {
      const eventButton = element('button');
      eventButton.type = 'button';
      eventButton.dataset.debugAction = 'pushEvent';
      eventButton.textContent = '注入一条上游任务事件';
      eventButton.addEventListener('click', () => {
        sources.pushEvent?.({
          kind: 'task.opened',
          payload: {
            id: `dbg_${Date.now()}`,
            kind: 'code',
            title: '调试注入的活（不写日志）',
          },
        });
      });
      details.append(eventButton);
    }
    injectSlot.append(details);
  }

  const filters = (): DebugFilters => ({
    tone: (tone.value as ToneFilter) ?? 'all',
    limit: DEBUG_EVENT_LIMIT,
  });

  const paint = (): void => {
    const snapshot = sources.getSnapshot();
    if (snapshot === undefined) return;
    const model = buildDebugModel(
      snapshot,
      sources.getEvents(DEBUG_EVENT_LIMIT),
      sources.getSaveStatus(),
      filters(),
    );
    content.replaceChildren();

    const villagers = section('角色', model.villagers.length);
    for (const villager of model.villagers) {
      villagers.append(
        row(
          `${villager.id} ${villager.name}`,
          `${villager.mode} · task=${villager.taskId}`,
          'villager',
        ),
      );
    }
    content.append(villagers);

    const buildings = section('铺子', model.buildings.length);
    for (const building of model.buildings) {
      const extra =
        building.constructionRemainingMs === null
          ? ''
          : ` · 施工剩 ${Math.round(building.constructionRemainingMs)}ms`;
      buildings.append(
        row(
          building.displayName,
          `${building.activity}${building.currentTask === '' ? '' : ` · ${building.currentTask}`}${extra}`,
          'building',
        ),
      );
    }
    content.append(buildings);

    // 世界状态：归纳结果，不是原始数据。造物主做选择时读的就是这份。
    const state = summarizeWorld(snapshot);
    const summary = section('世界状态', state.buildings.total);
    summary.append(
      row('镇内 / 郊野', `${state.buildings.town} / ${state.buildings.wild}`, 'state'),
    );
    for (const entry of state.taskKinds) {
      summary.append(
        row(
          `活：${entry.kind}`,
          `镇内 ${entry.town} · 郊野 ${entry.wild}`,
          'state',
        ),
      );
    }
    summary.append(
      row('郊野空地', `约 ${state.space.wildFree} 栋`, 'state'),
    );
    summary.append(
      row('角色', `忙 ${state.activity.busy} · 闲 ${state.activity.idle}`, 'state'),
    );
    if (state.gaps.missingWild.length > 0) {
      summary.append(
        row('缺口', `缺郊野铺子：${state.gaps.missingWild.join('、')}`, 'state'),
      );
    }
    content.append(summary);

    const tasks = section('任务', model.tasks.length);
    for (const task of model.tasks) {
      tasks.append(
        row(
          `${task.id} ${task.status}`,
          `${task.source} · worker=${task.workerId} · ${task.kind}：${task.summary}${
            task.blockedQuestion === '—' ? '' : ` · 请示：${task.blockedQuestion}`
          }`,
          'task',
        ),
      );
    }
    content.append(tasks);

    const pending = section('等待队列', model.counts.pending);
    for (const queue of model.pending) {
      pending.append(
        row(`${queue.villagerId} ${queue.villagerName}`, `${queue.items.length} 条`, 'pending'),
      );
      for (const item of queue.items) {
        pending.append(row(`  ${item.id}`, `${item.kind}：${item.summary}`, 'pending-item'));
      }
    }
    content.append(pending);

    const status = element('section', 'dbg-section');
    const heading = element('h3');
    heading.textContent = '连接与存档';
    status.append(heading, row('连接', feedSummary(model.feed), 'feed'));
    status.append(row('存档', saveStatusLine(model.save), 'save'));
    content.append(status);

    // 只读回溯：点一天，看那天的时代、场景阶段与角色记得的几条。
    // 详情存在 `historyView` 里而不是 DOM 里——面板每 250ms 重绘一次，
    // 写进 DOM 的那份会被下一次 replaceChildren 擦掉。
    const days = sources.historyDays?.() ?? [];
    const history = section('回溯（只读）', days.length);
    if (sources.historyDays === undefined || sources.historyRewind === undefined) {
      history.append(row('时间轴', '这个环境没有历史层', 'history'));
    } else if (days.length === 0) {
      history.append(row('时间轴', '还没有可回看的日子（关一天账才有）', 'history'));
    } else {
      for (const item of days.slice(-12)) {
        const line = row(
          `第 ${item.day} 天`,
          item.kind === 'missing' ? '没有记录' : item.kind === 'base' ? '全量快照' : '当日补丁',
          'history',
        );
        if (item.kind !== 'missing') {
          const button = element('button');
          button.type = 'button';
          button.dataset.debugAction = 'history';
          button.textContent = '看';
          button.addEventListener('click', () => {
            historyPending = true;
            historyView = null;
            paint();
            void sources.historyRewind?.(item.day)
              .then((view) => {
                historyView = view;
                historyPending = false;
                paint();
              })
              .catch(() => {
                historyPending = false;
                paint();
              });
          });
          line.append(button);
        }
        history.append(line);
      }
    }
    if (historyPending) history.append(row('读取中', '正在还原那一天的补丁…', 'history-detail'));
    if (historyView !== null) {
      if (historyView.missing) {
        history.append(row(`第 ${historyView.day} 天`, '这一天没有记录（不近似重建）', 'history-detail'));
      } else {
        history.append(
          row(`第 ${historyView.day} 天`, `时代：${historyView.eraLabel ?? '尚未分期'}`, 'history-detail'),
        );
        for (const character of historyView.characters) {
          const name = character.name ?? character.holderId;
          const lines = character.memories.map((line) => `第${line.day}天 ${line.what}`);
          history.append(
            row(name, lines.length === 0 ? '这一天没有留下条目' : lines.join('；'), 'history-detail'),
          );
        }
        for (const place of historyView.places) {
          const absent = place.absent === null ? '' : ` · ${place.absent}`;
          const phases = place.phases.map((phase) => `第${phase.day}天 ${phase.note}`).join(' / ');
          history.append(
            row(place.name, `${place.state} · ${phases}${absent}`, 'history-detail'),
          );
        }
      }
    }
    content.append(history);

    const events = section('事件流', model.events.length);
    for (const event of model.events) {
      const node = row(`#${Math.round(event.at)}`, `${event.tone}：${event.text}`, 'event');
      node.dataset.tone = event.tone;
      events.append(node);
    }
    content.append(events);

    if (stats !== null) {
      stats.textContent = `角色 ${model.counts.villagers} · 铺子 ${model.counts.buildings} · 任务 ${model.counts.tasks} · 队列 ${model.counts.pending} · 事件 ${model.counts.events}${paused ? ' · 已暂停' : ''}`;
    }
  };

  const setOpen = (next: boolean): void => {
    open = next;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (open) {
      paint();
      timer = setInterval(() => {
        if (!paused) paint();
      }, DEBUG_REFRESH_MS);
    }
  };

  const onToggle = (): void => setOpen(!open);
  const onClose = (): void => setOpen(false);
  const onPause = (): void => {
    paused = pause.checked;
    if (!paused) {
      paint();
      return;
    }
    // 暂停时不重绘列表，只在状态行补标记；世界继续跑，面板冻结。
    if (stats !== null) {
      const base = (stats.textContent ?? '').replace(' · 已暂停', '');
      stats.textContent = `${base} · 已暂停`;
    }
  };
  const onTone = (): void => paint();
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'd' || event.key === 'D') onToggle();
  };

  toggle.addEventListener('click', onToggle);
  close?.addEventListener('click', onClose);
  pause.addEventListener('change', onPause);
  tone.addEventListener('change', onTone);
  window.addEventListener('keydown', onKeydown);

  return {
    dispose: () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      toggle.removeEventListener('click', onToggle);
      close?.removeEventListener('click', onClose);
      pause.removeEventListener('change', onPause);
      tone.removeEventListener('change', onTone);
      window.removeEventListener('keydown', onKeydown);
    },
    isOpen: () => open,
  };
}
