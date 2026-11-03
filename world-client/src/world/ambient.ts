/** 世界自己发生的事：没有谁下命令，镇子自己过了一天里的某一刻。
 *
 * 在这之前，`Simulation` 里每一条 `announce()` 都挂在命令上——玩家不说，世界
 * 就不发生任何事。三天实测里 `world.changed` 只有两条，其中一条还是探针注入的
 * 神迹；记忆层的 `beliefs` 因此卡在「一个断言、两个人」的上限。这一支补的是
 * **事件源**，不是事件通道：通道仍然是 `announce()`，这里只回答「这一拍世界
 * 自己有没有事情要报」。
 *
 * 三条设计约束，写在这里免得后来者绕过：
 *
 * 1. **纯函数，零状态。** 输入里只有 `prevNow` / `now`、一个只读的潮位函数与
 *    此刻读得出来的世界，没有游标、没有「上一次是什么时候」。加了游标就要进
 *    存档，进存档就要升 schema，而 `save.test.ts` 的「续跑等价」会因为读档后
 *    第一拍的行为不同当场红——`bc12487` 那一笔已经踩过一次。
 * 2. **限流靠时间槽，不靠计数器。** 一个 `AMBIENT_SLOT_MS` 里最多出一件事，
 *    判定方式是 `floor(prevNow / SLOT) !== floor(now / SLOT)`：跨槽那一拍才
 *    可能出事件。这同样是纯的——`prevNow` 由 `update(deltaMs)` 直接给。
 * 3. **只报世界已经发生的事，不制造新状态。** 潮水本来就跨过了中线，村民本来
 *    就站在落点上；这里只是把它说出来。事件不改变世界，所以它也不可能让
 *    回放分叉。
 *
 * 潮位用函数传进来而不是传两个读数，原因见 `tideTurn`：跨槽那一拍只能看见
 * 100 毫秒的窗口，而潮水半周期 6 分钟才跨一次中线——撞上的概率是 1/3600，
 * 三天 720 次跨越的期望命中是 0.2 次，实测一次也没撞上。
 */

import type { GridPoint } from './types.ts';
import { PACE } from './pace.ts';

/**
 * 一个时间槽有多长：**2 个世界小时**（`pace.ts` 的节奏表）。
 *
 * 定这个数的是两个相反的要求。太短，事件流会被同一件事刷满；太长，玩家盯一分钟
 * 什么都看不到。2 世界小时在默认倍率 60 下是 2 分钟现实时间，正好是「抬头看一眼，
 * 镇子上有点动静」的密度。
 */
export const AMBIENT_SLOT_MS = PACE.ambientSlotMs;

/**
 * 潮水的中线。跨过它才算「转折」。
 *
 * 不用 `TIDE_HIGH_MIN` / `TIDE_LOW_MAX`：那两个数是**作息去不去得了**的闸，
 * 不是「潮水在涨还是在退」的分界。拿作息闸当叙事分界，会让文案在潮水明明
 * 还在涨的时候说「退了」。
 */
export const TIDE_MID = 0.5;

/**
 * 潮水那条事每隔几个槽才看一次。
 *
 * 潮水半个周期就掉一次头（`TIDE_PERIOD_MS` 12 分钟，抖动 ±2），一天 240 次。
 * 按「掉头就报」写，事件流变成节拍器，而且每个槽都轮得到它——村民一句也进不来。
 * 所以潮水按**场景节拍**报：每 2 个槽（4 个世界时）看一次刚走完的那一槽，
 * 一天 6 条，剩下的槽留给日常。
 *
 * 槽从 30 分钟改成 2 世界小时之后，节拍数从 8 跟着缩到 2——4 个世界时的
 * 潮水节拍不变，一天仍是 6 条。
 */
export const TIDE_BEAT_SLOTS = 2;

/** 看一槽里潮水有没有跨过中线时的取样间隔。半周期 6 分钟，1 分钟一格不会漏。 */
const TIDE_SAMPLE_MS = 60 * 1000;

/**
 * 一个作息落点该记在哪儿：几格之内有楼门，就是那栋楼。
 *
 * 为什么要有这条规则：痕迹要落在一个**看得见的地方**。村民按作息站在落点上，
 * 那件事的 `placeId` 本来只是脚下那一格（`place:x,y`），而只有楼登记成了
 * 地点 Holder——落在格子上的痕迹没有主人，谁也读不到、也画不出来。
 *
 * 2 格是量出来的，不是推的（2026-11-01，灯潮界 27 个作息落点）：
 *
 * | 半径 | 归到楼上的落点 |
 * | --- | --- |
 * | 2 格 | 5 个（叠浪楼 ×2、迎灯舍、炉匠铺、账房） |
 * | 3 格 | 再多两个：潮声茶摊前（2.83）、炉底入口边（2.83） |
 *
 * 取 2 不取 3，是因为那两个地方**各有各的名字**（茶摊、炉底入口都是楼），
 * 把人站在茶摊前做的事记到茶摊隔壁的楼上去，墙上就会多出不属于它的痕迹。
 */
export const FOOTFALL_ATTRIBUTION_RADIUS = 2;

/** 一扇门：只认 id 与坐标，这一层不认识 `Building`。 */
export interface FootfallDoor {
  readonly instanceId: string;
  readonly x: number;
  readonly y: number;
}

/** 脚下那一格的合成地点 id。`observe.ts` 给神迹用的也是这一套写法。 */
export function cellPlaceId(cell: GridPoint): string {
  return `place:${cell.x},${cell.y}`;
}

/**
 * 这件事记在哪儿：最近的楼门够得着就是那栋楼，否则是脚下那一格。
 *
 * 同距按 `instanceId` 升序取第一个——回放要一致，不能靠数组顺序。
 */
export function footfallPlace(
  cell: GridPoint,
  doors: readonly FootfallDoor[],
  radius = FOOTFALL_ATTRIBUTION_RADIUS,
): string {
  let best: FootfallDoor | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const door of doors) {
    const distance = Math.hypot(door.x - cell.x, door.y - cell.y);
    const closer = distance < bestDistance;
    const tieBreak = distance === bestDistance && best !== null && door.instanceId < best.instanceId;
    if (!closer && !tieBreak) continue;
    best = door;
    bestDistance = distance;
  }
  if (best !== null && bestDistance <= radius) return best.instanceId;
  return cellPlaceId(cell);
}

/** 世界自己报的事，目前两种。 */
export type AmbientKind = 'tide_turn' | 'routine_done';

/** 站在作息落点上的人。行为层从 `Simulation` 的快照里挑，这里只负责用。 */
export interface AmbientDweller {
  readonly id: string;
  readonly name: string;
  /**
   * 这件事记在哪儿：够得着楼门就是那栋楼的 id，否则是脚下那一格
   * （`footfallPlace` 算的）。`where` 与它**不是一回事**——`where` 是她站的
   * 那一格，决定谁看得见；`placeId` 是这件事留在哪，决定痕迹落在谁身上。
   */
  readonly placeId: string;
  readonly where: GridPoint;
  /** 作息牌子，例如「在旧站牌下认路」。 */
  readonly label: string;
}

export interface AmbientInput {
  readonly prevNow: number;
  readonly now: number;
  /**
   * 任意世界时刻的潮位。`Simulation` 传 `(t) => effectiveTideLevel(t, override)`，
   * 所以有效期内的潮位覆盖照样算数，而这里不必知道覆盖是什么。
   */
  readonly tideAt: (worldTime: number) => number;
  /** 此刻站在落点上的村民，按 `Simulation.villagers` 的顺序。 */
  readonly dwellers: readonly AmbientDweller[];
  /** 潮汐那件事的落点：有楼进水就用那栋楼的门，没有就用祭坛。 */
  readonly tidePlace: { readonly placeId: string; readonly where: GridPoint };
}

export interface AmbientEvent {
  readonly kind: AmbientKind;
  readonly text: string;
  readonly placeId: string;
  readonly where: GridPoint;
  /**
   * 这件事的当事人，没有就是 `null`。
   *
   * 日常落点有当事人——那件事就是她做的。带上它不是装饰：记忆层按
   * 「是不是当事人」给卷入度（`salience.ts` 的 `involvement`），当事人的卷入度是 1、
   * 旁人只有先验的 0.15。没有这一条，两条环境事件的显著度分别是 0.225 与 0.2625，
   * 都够不着 `T_write`（0.3），于是三天下来没有一个人记得，`birthClaim` 也就
   * 一条断言都生不出来——世界照样只有日志，没有闲话。
   */
  readonly actorId: string | null;
}

/** 世界时间落在第几个槽里。整数除法，负时间也稳定（`floor` 而不是截断）。 */
export function slotOf(worldTime: number): number {
  return Math.floor(worldTime / AMBIENT_SLOT_MS);
}

/**
 * 这一拍世界自己有没有事要报。没有就是空数组——大多数拍是这样。
 *
 * 一个槽最多一件，按优先级取第一件成立的：潮水转折优先于日常。潮水有节拍
 * （`TIDE_BEAT_SLOTS`），四个世界时才轮到一次，而日常随时都在，让一槽也无所谓。
 */
export function ambientBetween(input: AmbientInput): readonly AmbientEvent[] {
  if (slotOf(input.prevNow) === slotOf(input.now)) return [];

  const tide = tideTurn(input);
  if (tide !== null) return [tide];

  const dweller = input.dwellers[0];
  if (dweller === undefined) return [];
  return [
    {
      kind: 'routine_done',
      text: `${dweller.name}${dweller.label}`,
      placeId: dweller.placeId,
      where: dweller.where,
      actorId: dweller.id,
    },
  ];
}

/**
 * 潮水跨过中线的那一下。没跨、或这一槽轮不到潮水，就是 `null`。
 *
 * **看的是刚走完的那一整个槽，不是相邻两拍。** 跨槽那一拍离槽首只差
 * `deltaMs`（100 毫秒），拿「这一拍前」与「这一拍后」比，等于只在一个 100 毫秒
 * 的窗口里找跨越——而潮水半周期 6 分钟才跨一次，实测三天里一个都碰不上。
 * 潮位是 `now` 的纯函数，所以这里可以逐分钟把整槽问一遍，不存任何东西。
 *
 * 判「跨过」而不是判「此刻在哪一侧」：后者每个槽都会成立，于是潮水在 0.51 上
 * 停着的那些槽会反复报同一件事。
 */
function tideTurn(input: AmbientInput): AmbientEvent | null {
  const slot = slotOf(input.now);
  if (slot % TIDE_BEAT_SLOTS !== 0) return null;

  const from = Math.max(0, (slot - 1) * AMBIENT_SLOT_MS);
  const to = slot * AMBIENT_SLOT_MS;
  let previous = input.tideAt(from);
  for (let t = from + TIDE_SAMPLE_MS; t <= to; t += TIDE_SAMPLE_MS) {
    const level = input.tideAt(t);
    const rising = previous < TIDE_MID && level >= TIDE_MID;
    const falling = previous >= TIDE_MID && level < TIDE_MID;
    if (rising || falling) {
      return {
        kind: 'tide_turn',
        text: rising ? '潮水涨过一半，滩涂开始没进水里' : '潮水退过一半，滩涂露出来了',
        placeId: input.tidePlace.placeId,
        where: input.tidePlace.where,
        // 潮水没有当事人。看见它的人由感知模型算，不是这里点一个。
        actorId: null,
      };
    }
    previous = level;
  }
  return null;
}
