/** 事件 → 任务视图。世界的活从一条只增日志里长出来，不再从台账快照里读。
 *
 * 为什么这件事值得单开一个纯函数：
 *
 * 旧世界读的是**快照**（`GET /api/executive/commissions` 的一份全量列表）。
 * 快照有个天生的毛病：**「不在列表里」有两种含义**——「被撤了」和「这一页没取到」。
 * 分不清就只能靠一个 `complete` 标志去猜，猜错的后果是她手上的活被误判成撤回。
 *
 * 事件流没有这个问题。「被撤了」是一个显式事件（`task.cancelled`），
 * 「没发生」就是没发生。缺页只会漏掉事件，不会伪造出「撤单」这个结论。
 *
 * 所以这里的折叠是**增量**的：给定上一次的状态与一批新事件，算出新状态。
 * 从头折叠（`since=0`）自然得到当前全部未完成的任务——那就是启动时的对账，
 * 不需要另写一套对账逻辑。
 */

import type { TaskKind } from './types.ts';

/** 世界认识的四种任务事件。不在表里的 kind 一律忽略，不猜。 */
export const TASK_OPENED = 'task.opened';
export const TASK_BLOCKED = 'task.blocked';
export const TASK_SETTLED = 'task.settled';
export const TASK_CANCELLED = 'task.cancelled';

export const TASK_EVENT_KINDS: readonly string[] = [
  TASK_OPENED,
  TASK_BLOCKED,
  TASK_SETTLED,
  TASK_CANCELLED,
];

/** 日志里的一条事件。与服务端 `WorldEvent` 同形，`at` 是世界时间毫秒。 */
export interface TaskEvent {
  readonly id: number;
  readonly at: number;
  readonly kind: string;
  readonly actor: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** 世界里一条还没收尾的活。 */
export interface FeedTask {
  readonly id: string;
  readonly kind: TaskKind;
  readonly title: string;
  /** 这条活在等玩家回答的问题；没有就是 null。 */
  readonly question: string | null;
}

/** 收尾的活。`completedAt` 是事件带来的墙钟毫秒；事件没带就是 null。 */
export interface FeedSettled {
  readonly id: string;
  readonly completedAt: number | null;
}

/**
 * 折叠状态。
 *
 * `cursor` 是已消费的最大事件 id：调用方拿它当下次 `since`。
 * 它只在**按 id 递增**喂进来时前进；乱序或重复的事件被丢掉而不是重放，
 * 因为「同一条事件折叠两次」会让撤单后重开的单凭空复活。
 */
export interface TaskFoldState {
  readonly cursor: number;
  /** 未收尾的活，按 id 字典序（派活顺序由此决定，与事件到达顺序无关）。 */
  readonly open: readonly FeedTask[];
  /** 已收尾的活，按收尾事件 id 递增。 */
  readonly settled: readonly FeedSettled[];
  /** 被撤掉的 id。已结算的 id 不复活（与存档的 settledLog 同一条纪律）。 */
  readonly cancelled: readonly string[];
}

export const EMPTY_FOLD: TaskFoldState = {
  cursor: 0,
  open: [],
  settled: [],
  cancelled: [],
};

const TASK_KINDS_SET: ReadonlySet<string> = new Set(['code', 'research', 'writing', 'quick']);

/** 折叠一批事件。纯函数：同一个输入永远得到同一个输出，不读时钟不读随机数。 */
export function foldTaskEvents(
  previous: TaskFoldState,
  events: readonly TaskEvent[],
): TaskFoldState {
  let cursor = previous.cursor;
  const open = new Map(previous.open.map((task) => [task.id, task]));
  const settled = [...previous.settled];
  const cancelled = new Set(previous.cancelled);
  const settledIds = new Set(settled.map((item) => item.id));

  for (const event of events) {
    // 严格递增才消费：重复投递的同一条事件不折叠第二次。
    if (event.id <= cursor) continue;
    cursor = event.id;

    switch (event.kind) {
      case TASK_OPENED: {
        const task = parseOpened(event);
        if (task === null) break;
        // 已结算的 id 不复活：这是存档里那条纪律在事件流上的同一句话。
        if (settledIds.has(task.id) || cancelled.has(task.id)) break;
        open.set(task.id, task);
        break;
      }
      case TASK_BLOCKED: {
        const id = stringOf(event.payload, 'id');
        const question = stringOf(event.payload, 'question');
        if (id === null || question === null) break;
        const task = open.get(id);
        // 问题只挂在还开着的活上。给一条不存在的活挂问题，说明日志与世界的
        // 认知已经不一致——忽略，而不是凭空造一条活出来。
        if (task === undefined) break;
        open.set(id, { ...task, question: question.trim() === '' ? null : question });
        break;
      }
      case TASK_SETTLED: {
        const id = stringOf(event.payload, 'id');
        if (id === null) break;
        open.delete(id);
        cancelled.delete(id);
        if (settledIds.has(id)) break;
        settledIds.add(id);
        settled.push({ id, completedAt: numberOf(event.payload, 'completedAt') });
        break;
      }
      case TASK_CANCELLED: {
        const id = stringOf(event.payload, 'id');
        if (id === null) break;
        open.delete(id);
        // 已结算的单被撤：不算撤单（它已经成了）。否则会覆盖掉收尾记录。
        if (settledIds.has(id)) break;
        cancelled.add(id);
        break;
      }
      default:
        // 别的 kind（world.changed、oracle.spoken…）不归这里管。
        break;
    }
  }

  return {
    cursor,
    open: [...open.values()].sort((a, b) => a.id.localeCompare(b.id)),
    settled,
    cancelled: [...cancelled].sort(),
  };
}

function parseOpened(event: TaskEvent): FeedTask | null {
  const id = stringOf(event.payload, 'id');
  const kind = stringOf(event.payload, 'kind');
  const title = stringOf(event.payload, 'title');
  if (id === null || kind === null || title === null) return null;
  if (!TASK_KINDS_SET.has(kind)) return null;
  const question = stringOf(event.payload, 'question');
  return {
    id,
    kind: kind as TaskKind,
    title,
    question: question === null || question.trim() === '' ? null : question,
  };
}

function stringOf(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberOf(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
