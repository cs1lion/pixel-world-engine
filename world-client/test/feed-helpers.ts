/** 测试用的上游事件流构造器。
 *
 * 世界收的是**折叠结果**（`TaskFoldState`），不是原始事件——折叠是纯函数，
 * 世界只负责对齐。所以测试可以跳过「造事件 → 折叠」两步，直接描述
 * 「日志现在长什么样」：
 *
 *     sim.enqueue(syncCommand({
 *       tasks: [{ id: 'c_1', kind: 'code', title: '写爬虫' }],
 *       connected: true,
 *     }));
 *
 * 每次调用独立构造一份折叠状态，等价于「从头回放整条日志」——这正是
 * 世界在 `syncEvents` 里假设的输入。
 */

import type { TaskFoldState } from '../src/world/task-events.ts';
import type { TaskKind } from '../src/world/types.ts';

/** 一条还开着的活。 */
export interface SyncTask {
  readonly id: string;
  readonly kind: TaskKind;
  readonly title: string;
  /** 这条活在等玩家回答的问题；省略即没有问题。 */
  readonly question?: string | null;
}

export interface SyncCommandInput {
  /** 日志里还没收尾的活。 */
  readonly tasks?: readonly SyncTask[];
  /** 已经收尾的活。给 id 即可，`completedAt` 是世界时间毫秒。 */
  readonly finished?: readonly (string | { readonly id: string; readonly completedAt: number | null })[];
  /** 被撤掉的 id。 */
  readonly cancelled?: readonly string[];
  /** 上游读得到吗。false 表示这一轮没读到——世界照常过日子，不改任何状态。 */
  readonly connected?: boolean;
}

/** 游标：跨调用单调递增，模拟「日志只增」这件事。 */
let cursor = 0;

export function resetSyncCursor(): void {
  cursor = 0;
}

/**
 * 造一条 `syncEvents` 命令。
 *
 * `tasks` 与 `finished` 里同名 id 时以 `finished` 为准——一条活不可能既开着又收了，
 * 这种输入本身就说明测试写错了，让它落到「已收」这一侧比悄悄两条都留更安全。
 */
export function syncCommand(input: SyncCommandInput): {
  kind: 'syncEvents';
  fold: TaskFoldState;
  connected: boolean;
} {
  const finishedIds = new Set(
    (input.finished ?? []).map((item) => (typeof item === 'string' ? item : item.id)),
  );
  const settled = (input.finished ?? []).map((item) =>
    typeof item === 'string'
      ? { id: item, completedAt: null }
      : { id: item.id, completedAt: item.completedAt },
  );
  const open = (input.tasks ?? [])
    .filter((task) => !finishedIds.has(task.id))
    .map((task) => ({
      id: task.id,
      kind: task.kind,
      title: task.title,
      question: task.question ?? null,
    }));
  cursor += 1 + open.length + settled.length;
  return {
    kind: 'syncEvents',
    fold: {
      cursor,
      open,
      settled,
      cancelled: [...(input.cancelled ?? [])].sort(),
    },
    connected: input.connected ?? true,
  };
}
