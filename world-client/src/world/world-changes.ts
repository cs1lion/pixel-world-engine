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
 *   - 潮位曲线本身：`tideLevelAt(now)` 的纯函数，每一拍都记等于记时钟。
 *     **但潮位「被拨过」要记**——那是一次事件，而且它进存档（`tideOverride`），
 *     是会留在世界状态里的事。两者不是一回事。
 *   - **潮水跨过中线那一下要记**（`world.event` 的 `tide_turn`）：它同样是
 *     纯函数推得出来的，但它是一个**转折**，不是每一拍的读数。记的是
 *     「潮水掉头了」这件事，不是「此刻潮位是多少」。
 *     （潮水 12 分钟一个周期，一天掉头 240 次；真正限流的是 `ambient.ts` 的
 *     节拍，一天 6 条。别把「一天 240 次」当成事件密度。）
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
    }
  | {
      /**
       * 有人拨了一下潮水。记的是**覆盖**，不是当时的潮位：
       * 潮位是 `now` 的纯函数，记下来等于记时钟；而「谁在什么时刻
       * 把潮水压到多少、压到什么时候」是一次真正的事件。
       */
      readonly change: 'tide';
      readonly level: number;
      /** 世界时间，覆盖到这一刻失效。 */
      readonly until: number;
    }
  | {
      /**
       * 世界自己发生的一件事：没有谁下命令，镇子自己走到了这一刻。
       *
       * 与 `world.vitals` 的区别是它有落点、能被看见、能进记忆——心电图是
       * 体检报告，这一条是「刚才发生了什么」。
       *
       * **载荷里不能有 `at`**：信封的 `at` 是世界时间毫秒，`{ at: {x, y} }`
       * 会被服务端当成「时间是个对象」整条拒掉（`miracle` 那一支的注释记着
       * 这件事）。坐标叫 `where`。
       */
      readonly change: 'world.event';
      /**
       * 世界自己报的事的种类。
       *
       * `tide_turn` / `routine_done` 来自 `ambient.ts` 的 `AmbientKind`；
       * `daily_water` / `daily_lamp` 是固定时刻表里已经接通的两件每日小事
       * （`timetable.ts`）；`street_*` 是 `liveliness.ts` 里两位居民在街上
       * 撞见后由确定性规则选出的互动与街头小事。全部是闭集，服务端
       * `WORLD_EVENT_KINDS` 与这里逐字一致——加一个只改一边，回写会被
       * 自己的服务端拒掉。
       */
      readonly kind: WorldEventKind;
      /** 一句话，玩家在事件流里读到的就是它。 */
      readonly text: string;
      /** 落点。合成地点用 `place:x,y`，楼用它的 `instanceId`。 */
      readonly placeId: string;
      readonly where: GridPoint;
      /**
       * 这件事的当事人；没有就是 `null`（潮水没有当事人）。
       *
       * 与「谁看见了」不是一回事：看见谁由记忆层的感知模型算。这里是「这件事
       * 是谁做的」——日常落点就是那个村民。记忆层拿它算卷入度，缺了它，
       * 环境事件的显著度够不着写入线，一条闲话也生不出来。
       */
      readonly actorId: string | null;
      /**
       * 这件事里的另一位居民；没有就是缺省。
       *
       * 街头互动与街头小事都是两个人的事：`actorId` 是动手的那一位，
       * `otherId` 是被撞 / 被抢 / 被帮的那一位。方向性关系账本要靠这一对
       * id 才能各记一笔——只给一个 id 的话，记忆层只能记「谁做了」，
       * 记不下「对谁做的」。
       */
      readonly otherId?: string | null;
    }
  | {
      /**
       * 一天结束了，世界的心电图。四个标量，一个日子。
       *
       * 这是**唯一一条不是「世界改了什么」的改变**，收在这里是因为它是内环
       * 唯一被允许的对外输出（补充设计 §0 的边界）：`DayClosed` 之后把这份
       * 快照抛出去，谁接是别人的事。世界自己不读它做任何决定——心电图是
       * 体检报告，不是处方。
       *
       * 四个数各有定义，抄自补充设计 §2.3：
       * - `meanValence` 全村近 3 日记忆情绪均值，-1~1；
       * - `meanArousal` 兴奋度均值，0~1；
       * - `infoEntropy` 当日传播的独立断言数与覆盖方差折算的熵，0~1；
       * - `isolatedHoldersCount` 连续 3 天没跟任何人说过话的单位数。
       */
      readonly change: 'world.vitals';
      readonly day: number;
      readonly meanValence: number;
      readonly meanArousal: number;
      readonly infoEntropy: number;
      readonly isolatedHoldersCount: number;
    }
  | {
      /**
       * 一件事被足够多的人讲了足够久，镇上认下了它——碑上刻一行字。
       *
       * 这是记忆层的**输出**变成世界共识的那一刻。与 `world.vitals` 一样，
       * 它是本层的产物而不是喂给本层的输入（`observe.ts` 为它返回 `null`）：
       * 把「传说立起来了」再记成一条经历，就会自己吃自己。
       *
       * 载荷里**不带坐标**：`placeId` 已经是落点（与 `world.event` 同一套写法），
       * 而信封的 `at` 是世界时间——`miracle` 那一支踩过的同名坑不再踩第二遍。
       */
      readonly change: 'legend';
      readonly legendId: string;
      /** 碑上那句话：几种讲法用「；」连起来（`candidatesFrom` 的 `variants`）。 */
      readonly text: string;
      /** 这件事在哪。楼用 `instanceId`，合成地点用 `place:x,y`。 */
      readonly placeId: string;
      /** 此刻还有几个人在讲。淡去的传说 `reach` 掉到 1 以下就不再往日志里记。 */
      readonly reach: number;
      /** 立碑那天。 */
      readonly day: number;
    };

/** `world.event` 的种类闭集。服务端白名单的客户端一半。 */
export type WorldEventKind =
  | 'tide_turn'
  | 'routine_done'
  | 'daily_water'
  | 'daily_lamp'
  | 'harbor_report'
  | 'street_greet'
  | 'street_yield'
  | 'street_quarrel'
  | 'street_together'
  | 'street_tumble'
  | 'street_water'
  | 'street_help';

/** 服务端接受的全部 `change` 值。测试拿它对照 Python 侧的白名单。 */
export const WORLD_CHANGE_KINDS: readonly WorldChange['change'][] = [
  'task.delivered',
  'building.built',
  'building.removed',
  'miracle',
  'weather',
  'tide',
  'world.event',
  'world.vitals',
  'legend',
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
