/** 事件日志客户端：把世界的只增日志读进世界。
 *
 * 只做运输与形状校验，不做判断：
 *   - 不认识 `kind` 的含义（那是 #5 的投影要回答的）；
 *   - 不重试（日志是只增的，重试没有副作用，但会让「这一刻读到了什么」
 *     变得不确定——世界的时间线不该被网络抖动改写）；
 *   - **失败返回失败，不抛异常**。调用方是世界主循环，一条读失败不该让
 *     整个模拟停摆。这一点与 `intent-client.ts` 相反：意图是玩家的一次
 *     主动动作，失败要立刻让他看见；日志是背景读取，失败只是「这一拍没读到」。
 *
 * 断点续读靠 `since`：把上次读到的最后一条 id 传回来，服务端只返回严格更新的那些。
 *
 * 另有一件事，与读相对：`record()` 把世界做过的事记回去（`world.changed`）。
 * 服务端只收白名单里的世界改变，不收裸的 append——「谁能往日志里写什么」
 * 因此是一件在服务端说得清的事。写失败与读失败同一条纪律：降级成 `ok: false`，不抛。
 */

import { toEnvelope, type WorldChange } from './world-changes.ts';

/** 一条事件。字段与服务端 `WorldEvent` 一致，`at` 是**世界时间毫秒**，不是墙钟。 */
export interface WorldEventRow {
  readonly id: number;
  readonly at: number;
  readonly kind: string;
  readonly actor: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventsPage {
  readonly events: readonly WorldEventRow[];
  /** 整个日志的最大 id。`since >= latestId` 就是追平了。 */
  readonly latestId: number;
  /** 这一页之外还有没有更新的。读满但到底时为 false。 */
  readonly hasMore: boolean;
}

export type EventsResult =
  | { readonly ok: true; readonly page: EventsPage }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

/**
 * 下一轮的游标。
 *
 * **不要用 `latestId` 当游标。** `latestId` 是整个日志的最大 id，不是这一页的；
 * 拿它当 `since` 会直接跳过这一页之后、`latestId` 之前的所有事件。
 * 空页时没有事件可跳，游标原地不动。
 */
export function nextCursor(page: EventsPage, previous: number): number {
  return page.events.length === 0 ? previous : page.events[page.events.length - 1]!.id;
}

export const EVENTS_URL = '/api/events';
/** 回写端点。收的是「世界改了什么」，由服务端落成一条 `world.changed`。 */
export const WORLD_CHANGES_URL = '/api/world/changes';

export type WriteResult =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

/** 单次读取超时。日志是背景读取，等太久不如这一拍先跳过。 */
export const EVENTS_TIMEOUT_MS = 5000;

/** 一页的默认条数。与服务端 `DEFAULT_LIMIT` 一致。 */
export const EVENTS_DEFAULT_LIMIT = 200;

export interface EventsClient {
  /** 读 `id > since` 的事件。任何失败都落到 `ok: false`。 */
  fetchSince(since: number, limit?: number): Promise<EventsResult>;
  /**
   * 把世界做过的一件事记回日志。`at` 是**世界时间**，由调用方给。
   *
   * 只报已经发生的事——被拒的命令不经过这里。写失败不重试：日志缺一条
   * 「她交付了」是遗憾，但重试会让同一条改变在日志里出现两次。
   */
  record(change: WorldChange, at: number): Promise<WriteResult>;
}

export interface EventsClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** 测试注入：便于断言请求地址。默认 `EVENTS_URL`。 */
  readonly url?: string;
  /** 回写地址。默认 `WORLD_CHANGES_URL`；测试注入用。 */
  readonly writeUrl?: string;
}

export function createEventsClient(options: EventsClientOptions = {}): EventsClient {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? EVENTS_TIMEOUT_MS;
  const url = options.url ?? EVENTS_URL;
  const writeUrl = options.writeUrl ?? WORLD_CHANGES_URL;

  return {
    async fetchSince(since: number, limit = EVENTS_DEFAULT_LIMIT): Promise<EventsResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          const query = new URLSearchParams({ since: String(since), limit: String(limit) });
          response = await fetchImpl(`${url}?${query.toString()}`, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller.signal,
          });
        } catch (error) {
          const why = controller.signal.aborted ? `超时 ${timeoutMs}ms` : errorText(error);
          return { ok: false, reason: `事件日志不可达：${why}`, status: null };
        }

        if (!response.ok) {
          return {
            ok: false,
            reason: `事件日志返回 ${response.status}`,
            status: response.status,
          };
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { ok: false, reason: '事件日志返回的不是 JSON', status: response.status };
        }

        const parsed = parsePage(body);
        if (parsed === null) {
          return { ok: false, reason: '事件日志响应形状不对', status: response.status };
        }
        return { ok: true, page: parsed };
      } finally {
        clearTimeout(timer);
      }
    },

    async record(change: WorldChange, at: number): Promise<WriteResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response;
        try {
          response = await fetchImpl(writeUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(toEnvelope(change, at)),
            signal: controller.signal,
          });
        } catch (error) {
          const why = controller.signal.aborted ? `超时 ${timeoutMs}ms` : errorText(error);
          return { ok: false, reason: `回写不可达：${why}`, status: null };
        }

        if (!response.ok) {
          return { ok: false, reason: `回写被拒 ${response.status}`, status: response.status };
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          return { ok: false, reason: '回写返回的不是 JSON', status: response.status };
        }
        const id = isRecord(body) && isPositiveInt(body.id) ? body.id : null;
        // 服务端必须回一个 id：没有它，调用方无法确认这条真的落进去了。
        if (id === null) {
          return { ok: false, reason: '回写响应里没有 id', status: response.status };
        }
        return { ok: true, id };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * 校验一页的形状。任何一处不对就整页作废。
 *
 * 为什么不做「跳过坏的那条、留下好的」：日志是世界的事实来源，跳过一条等于
 * 悄悄改变世界的因果链，而调用方不会知道。整页作废至少让失败是可见的。
 */
export function parsePage(body: unknown): EventsPage | null {
  if (!isRecord(body)) return null;
  const rawEvents = body.events;
  const latestId = body.latestId;
  const hasMore = body.hasMore;
  if (!Array.isArray(rawEvents)) return null;
  if (!isNonNegativeInt(latestId)) return null;
  if (typeof hasMore !== 'boolean') return null;

  const events: WorldEventRow[] = [];
  let previousId = 0;
  for (const item of rawEvents) {
    const event = parseEvent(item);
    if (event === null) return null;
    // 服务端保证升序；客户端也查一次。乱序会让调用方的游标原地打转。
    if (event.id <= previousId) return null;
    previousId = event.id;
    events.push(event);
  }
  // 页内最大 id 不该超过日志的最大 id——超了说明两边对日志的认知已经不一致。
  if (events.length > 0 && events[events.length - 1]!.id > latestId) return null;
  return { events, latestId, hasMore };
}

function parseEvent(item: unknown): WorldEventRow | null {
  if (!isRecord(item)) return null;
  const { id, at, kind, actor, payload } = item;
  if (!isPositiveInt(id)) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return null;
  if (typeof kind !== 'string' || kind.length === 0) return null;
  if (typeof actor !== 'string' || actor.length === 0) return null;
  if (!isRecord(payload)) return null;
  return { id, at, kind, actor, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
