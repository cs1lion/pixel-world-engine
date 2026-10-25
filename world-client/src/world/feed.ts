/** 上游事件流的轮询器：把只增日志拉进世界。
 *
 * 三件事，都是薄薄一层：
 *   1. 按 `cursor` 续读（`events-client` 负责传输与形状）；
 *   2. 交给 `foldTaskEvents` 折叠成任务视图（纯函数，可离线断言）；
 *   3. 有变化就回调一次，让世界把结果排进命令队列。
 *
 * **为什么是轮询而不是 WebSocket。** 日志是只增的、按 id 可续读的，
 * 这使「断线重连」退化成一个整数：把 `cursor` 带上再读一遍即可，不会重也不会漏。
 * WS 能省掉空轮询，但会引入「漏帧要补」这个第二套正确性问题——日志本身
 * 已经解决了它，没必要再造一份。
 *
 * **失败只降级，不抛。** 读不到就是「这一轮没有新事件」，世界照常过日子。
 * 但要把 `connected: false` 交出去，状态行才能说清"你看到的是旧数据"。
 */

import { createEventsClient, type EventsClient, type WorldEventRow } from './events-client.ts';
import {
  EMPTY_FOLD,
  foldTaskEvents,
  type TaskEvent,
  type TaskFoldState,
} from './task-events.ts';

export interface FeedUpdate {
  readonly fold: TaskFoldState;
  readonly connected: boolean;
}

export interface FeedOptions {
  readonly onUpdate: (update: FeedUpdate) => void;
  /** 轮询间隔。省略 4000ms。 */
  readonly pollMs?: number;
  readonly client?: EventsClient;
  readonly timers?: FeedTimers;
}

/** 定时器的最小面，测试注入假时钟；句柄对调用方不透明。 */
export interface FeedTimers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULT_TIMERS: FeedTimers = {
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export const DEFAULT_POLL_MS = 4000;

/** 一页读多少。够大才不会一页一页爬很久，又不至于一次把整条日志读进内存。 */
const PAGE_LIMIT = 200;

/** 单轮最多连读几页。防止「日志比读得快」时这一拍永远结束不了。 */
const MAX_PAGES_PER_ROUND = 20;

export class FeedClient {
  private readonly onUpdate: (update: FeedUpdate) => void;
  private readonly pollMs: number;
  private readonly client: EventsClient;
  private readonly timers: FeedTimers;
  private fold: TaskFoldState = EMPTY_FOLD;
  private timer: unknown | null = null;
  private disposed = false;
  /** 同一时刻只允许一轮在途，避免慢请求叠成山。 */
  private inFlight: Promise<void> | null = null;

  constructor(options: FeedOptions) {
    this.onUpdate = options.onUpdate;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.client = options.client ?? createEventsClient();
    this.timers = options.timers ?? DEFAULT_TIMERS;
  }

  start(): void {
    if (this.timer !== null || this.disposed) return;
    void this.poll();
    this.timer = this.timers.setInterval(() => {
      void this.poll();
    }, this.pollMs);
  }

  stop(): void {
    this.disposed = true;
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  /** 读一轮。失败只降级成 `connected: false`，不抛。 */
  async poll(): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight !== null) return this.inFlight;
    const task = this.pollOnce();
    this.inFlight = task;
    try {
      await task;
    } finally {
      this.inFlight = null;
    }
  }

  /** 当前折叠结果。测试与调试面板读它，世界不读（世界读快照）。 */
  state(): TaskFoldState {
    return this.fold;
  }

  /**
   * 本地注入一条事件，走与真实事件完全相同的折叠路径。
   *
   * 只给调试面板与浏览器回归用：它让「事件 → 世界」这条链路可以被手动戳一下，
   * 而不必真去写服务端日志。id 由本地游标往后排，不会与已读到的事件撞号。
   */
  inject(event: { kind: string; payload: Record<string, unknown> }): void {
    if (this.disposed) return;
    const row: TaskEvent = {
      id: this.fold.cursor + 1,
      at: 0,
      kind: event.kind,
      actor: 'debug',
      payload: event.payload,
    };
    this.fold = foldTaskEvents(this.fold, [row]);
    this.onUpdate({ fold: this.fold, connected: this.foldConnected });
  }

  /** 最近一轮是否读到了上游。`inject` 回调时沿用它，不假装在线。 */
  private foldConnected = false;

  /**
   * 调试注入：开一条带问题的活。等价于上游先发 `task.opened` 再发 `task.blocked`，
   * 走完全相同的折叠路径——所以急件流程能在这里被完整验证，而不必真写服务端。
   */
  injectBlocked(taskId: string, title: string, question: string): void {
    if (this.disposed) return;
    const base = this.fold.cursor;
    const rows: TaskEvent[] = [
      {
        id: base + 1,
        at: 0,
        kind: 'task.opened',
        actor: 'debug',
        payload: { id: taskId, kind: 'code', title },
      },
      {
        id: base + 2,
        at: 0,
        kind: 'task.blocked',
        actor: 'debug',
        payload: { id: taskId, question },
      },
    ];
    this.fold = foldTaskEvents(this.fold, rows);
    this.onUpdate({ fold: this.fold, connected: this.foldConnected });
  }

  private async pollOnce(): Promise<void> {
    const collected: WorldEventRow[] = [];
    let connected = true;
    let cursor = this.fold.cursor;

    for (let page = 0; page < MAX_PAGES_PER_ROUND; page += 1) {
      const result = await this.client.fetchSince(cursor, PAGE_LIMIT);
      if (this.disposed) return;
      if (!result.ok) {
        connected = false;
        break;
      }
      collected.push(...result.page.events);
      // 空页 = 追平。用 `hasMore` 而不是「页是否读满」判断，因为服务端算的是
      // 「这一页之外还有没有更新的」，那个判断只有它做得准。
      if (!result.page.hasMore) break;
      const last = result.page.events[result.page.events.length - 1];
      if (last === undefined) break;
      cursor = last.id;
    }

    if (collected.length > 0) {
      this.fold = foldTaskEvents(this.fold, collected as readonly TaskEvent[]);
    }
    // 一轮里没有事件也要回调：`connected` 本身是要显示的信息，
    // 而且读档后第一轮空日志必须让世界知道「对账完成了」。
    this.foldConnected = connected;
    this.onUpdate({ fold: this.fold, connected });
  }
}
