/** 世界的回写：它做过的事，要记回日志里。
 *
 * 只增日志是一条**双向**的线：世界从它读活（`task.*`），也把结果写回去
 * （`world.changed`）。少了后半段，日志只记得「上游要过什么」，不记得
 * 「世界做成了什么」——记忆（#7）与后续的规则引擎（#6）就没有素材。
 *
 * 三条纪律：
 *
 * 1. **只记已经发生的事**。命令被拒（`ok: false`）不写，世界没变就没什么可记。
 *    `syncEvents` 也不写：那是读日志，不是改世界。
 * 2. **`at` 是世界时间**（`sim.now`），不是墙钟。回放同一条日志得到同一条时间线。
 * 3. **世界不读自己写的东西**。`world.changed` 不归 `foldTaskEvents` 管，
 *    所以回写不会变成反馈回路。这一条有测试钉着。
 *
 * 回写是**尽力而为**的：写不进去，世界照常过日子。日志缺一条「她交付了」
 * 是遗憾，但让整个世界停下来等一个 HTTP 请求是本末倒置。
 */

import type { GridPoint, TaskKind, Weather } from './types.ts';

/** 日志里的事件 kind。与 `task.*` 并列，都是小写点分名。 */
export const WORLD_CHANGED = 'world.changed';

/**
 * 世界里发生的一件**会留在世界状态里**的事。
 *
 * 这份清单是封闭的：新增一种改变要同时改服务端白名单（`server/events/world_changes.py`），
 * 两边不一致时服务端会拒收——宁可少记，不可乱记。
 *
 * 不收的东西与理由：
 *   - 潮位：`tideLevelAt(now)` 的纯函数，日志里记它等于记时钟；
 *   - 角色走动、气泡、作息：渲染层的读感，不是世界事实；
 *   - 队列的增删（`cancelPending`）：只在世界内存里，读档不保留。
 */
export type WorldChange =
  | {
      readonly change: 'task.delivered';
      readonly taskId: string;
      readonly summary: string;
      readonly workerId: string;
      /** 这单是上游派的还是世界自己造的。与交付统计同口径。 */
      readonly source: 'feed' | 'local';
      readonly taskKind: TaskKind;
    }
  | {
      readonly change: 'building.built';
      readonly instanceId: string;
      readonly prefabId: string;
      readonly displayName: string;
      /** 这栋楼为哪条活而建；开局常驻的楼没有来由，记 null。 */
      readonly summary: string | null;
    }
  | {
      readonly change: 'building.removed';
      readonly instanceId: string;
      readonly displayName: string;
    }
  | {
      readonly change: 'miracle';
      /** 世界侧叫 `light`（点灯），日志里写 `lamp`——摆件就叫 lamp，用它的名字。 */
      readonly miracle: 'lamp' | 'tree' | 'cat';
      readonly at: GridPoint;
    }
  | {
      readonly change: 'weather';
      readonly weather: Weather;
    };

/** 服务端接受的全部 `change` 值。测试拿它对照 Python 侧的白名单。 */
export const WORLD_CHANGE_KINDS: readonly WorldChange['change'][] = [
  'task.delivered',
  'building.built',
  'building.removed',
  'miracle',
  'weather',
];

/**
 * 把一条改变切成服务端要的信封：`{ at, change, payload }`。
 *
 * 信封与载荷分层不是洁癖：神迹的落点是格子坐标 `{x, y}`，而信封的 `at`
 * 是世界时间毫秒。两者同名时，`{ at: {x, y} }` 会被服务端当成「时间是个对象」
 * 而整条拒掉——坐标根本递不进去，而且拒得很安静（世界那边只看到一次写失败）。
 *
 * `at` 由调用方给（世界时间），不从 change 里取：change 描述的是**发生了什么**，
 * 不描述**什么时候**。时间归世界，事件归这条改变。
 */
export function toEnvelope(
  change: WorldChange,
  at: number,
): { at: number; change: string; payload: Record<string, unknown> } {
  const { change: kind, ...payload } = change;
  return { at, change: kind, payload: payload as Record<string, unknown> };
}
