/** 世界回写的改变 → 记忆层的一条观察。
 *
 * `WorldChange` 说的是「世界改了什么」（给日志看），记忆层要的是「发生了什么、
 * 在哪、谁在场」（给单位看）。两者不是一回事：日志记的是世界的账，记忆记的是
 * 一个人的经历。这个文件做那一次翻译。
 *
 * **只翻译有地点的那几种。** 一条没有落点的事件进不了感知模型——「谁看见了」
 * 无从算起。硬编一个假地点比不记更坏：世界会开始记得一件没在任何地方发生过的事。
 * 所以 `tide` 与 `world.vitals` 返回 `null`：前者是时钟的读数，后者是本层的
 * 输出（把它再喂回来就是自己吃自己）。
 *
 * 位置与建筑由调用方查（它手上有 `Simulation` 的快照）。记忆层不知道
 * 「谁是 v0、他在哪」，也不该知道。
 */

import type { WorldChange, WorldEventKind } from '../world-changes.ts';
import type { RuntimeObservation } from './runtime.ts';
import type { BondDelta } from './world.ts';

/** 调用方要能回答的三个问题。答不上来的就返回 `undefined`，事件会被跳过。 */
export interface ObservationLookups {
  /** 某个单位此刻站在哪。 */
  readonly atOfHolder: (holderId: string) => { readonly x: number; readonly y: number } | undefined;
  /** 某个建筑在哪（取门口，人站在那里才看得见）。 */
  readonly atOfBuilding: (
    instanceId: string,
  ) => { readonly x: number; readonly y: number } | undefined;
  /** 某个任务是在哪栋楼里做的。 */
  readonly buildingOfTask: (taskId: string) => string | undefined;
}

/** 世界事件的分量：街头小事比「今天做过活」重，互动只是见过一面。 */
export function worldEventImportance(kind: WorldEventKind): number {
  switch (kind) {
    case 'delivery_failed':
      // 一次失败让村子少了一单、还暴露出有人饿着；比普通交付（0.45）重，
      // 比炸炉事故（0.8）轻。0.70 高于史诗候选下限 0.55，但
      // `irreversibilityOf` 对它是 0，最多讲成地方传说，不会立碑。
      return 0.7;
    case 'street_tumble':
    case 'street_water':
    case 'street_help':
      return 0.65;
    case 'street_quarrel':
      return 0.55;
    case 'street_greet':
    case 'street_yield':
    case 'street_together':
      // 见过一面不是「大事」：压在传说门槛（0.4）下面，让同地点的闲话还能
      // 并成一块碑；但它仍然写进个人记忆（闲话本来就写得下）。
      return 0.38;
    case 'daily_water':
    case 'daily_lamp':
      return 0.35;
    case 'routine_done':
      return 0.35;
    case 'tide_turn':
      return 0.35;
    // 市面四拍是镇子级事实（`actorId` 为 null）：分量与固定时刻表的每日小事
    // 同档——镇子每天都会走过，但谁也没做成一件事。
    case 'market_open':
    case 'work_end':
    case 'night_market':
    case 'market_close':
      return 0.35;
    case 'harbor_report':
      // 船班播报是镇子级事件，但个人记忆只记码头边在场的人。门槛要略高：
      // 它值得记住（决定今天过不过得了河），但不是传说级；0.55 让
      // 「看见的人」过 T_write，而不是把广播塞给全镇。
      return 0.55;
  }
}

export function worldEventValence(kind: WorldEventKind): number {
  switch (kind) {
    case 'delivery_failed':
      // 当事人挨饿、村子丢单，明确为负；但没人受伤，不比炸炉事故（-0.7）
      // 更重，比「打翻水」（-0.55）更重——损失落在别人身上，不只是湿了地。
      return -0.6;
    case 'street_help':
      return 0.6;
    case 'street_together':
      return 0.3;
    case 'street_greet':
      return 0.2;
    case 'street_yield':
      return 0.1;
    case 'street_quarrel':
      return -0.35;
    case 'street_tumble':
      return -0.5;
    case 'street_water':
      return -0.55;
    case 'daily_water':
    case 'daily_lamp':
      return 0.15;
    case 'routine_done':
      return 0.1;
    case 'tide_turn':
      return 0;
    // 市面四拍没有情绪方向：开市闭市都是钟点到了，不是谁做成了什么。
    case 'market_open':
    case 'work_end':
    case 'night_market':
    case 'market_close':
      return 0;
    case 'harbor_report':
      // 停航是坏消息，开航只是寻常；同一句话里已经说了船开没开。
      return 0;
  }
}

export function worldEventArousal(kind: WorldEventKind): number {
  switch (kind) {
    case 'delivery_failed':
      // 一次当众的、带身体反应的失手（手抖、没送到），比摔倒（0.55）抓人，
      // 但远不到全村骚动（0.7）。
      return 0.6;
    case 'street_tumble':
    case 'street_water':
    case 'street_help':
      return 0.55;
    case 'street_quarrel':
      return 0.45;
    case 'street_greet':
    case 'street_yield':
    case 'street_together':
      return 0.3;
    case 'tide_turn':
      return 0.35;
    case 'harbor_report':
      return 0.3;
    default:
      return 0.25;
  }
}

/**
 * 街头小事的方向性账本。
 *
 * `actor` 是动手的那一位，`other` 是被撞 / 被抢 / 被帮的那一位。每一对
 * 记**两条**，因为 A 对 B 与 B 对 A 是两条独立的账：
 *
 * - 撞翻担子：被撞的人对撞人者掉信任；撞人者对被撞者**略微**升温
 *   （愧疚不是好感，只是往后会留神）。
 * - 抢水：两边都掉，但被抢的那一边掉得更多——发起的那一边只是不讲理，
 *   被抢的那一边是实打实没喝上。
 * - 帮忙抬货：被帮的人涨得更多，并欠下一笔 `debt`；帮忙的人自己也有
 *   「做了件好事」的正向读数，但不把对方的回礼提前记成好感。
 *
 * 数值是**直接落账**，不经过 `bumpBond` 的 valence 折算——街头小事要的
 * 就是「同一件事在两个人账上不一样」。
 */
export function incidentBondDeltas(
  kind: WorldEventKind,
  actor: string,
  other: string,
): readonly BondDelta[] | undefined {
  switch (kind) {
    case 'street_tumble':
      return [
        { from: other, to: actor, trust: -0.22, warmth: -0.16 },
        { from: actor, to: other, trust: 0.04, warmth: 0.03 },
      ];
    case 'street_water':
      return [
        { from: other, to: actor, trust: -0.16, warmth: -0.1 },
        { from: actor, to: other, trust: -0.1, warmth: -0.07 },
      ];
    case 'street_help':
      return [
        { from: other, to: actor, trust: 0.2, warmth: 0.18, debt: 0.18 },
        { from: actor, to: other, trust: 0.1, warmth: 0.1 },
      ];
    default:
      return undefined;
  }
}

/**
 * 一条改变 → 一条观察。返回 `null` 表示这件事不该进记忆。
 *
 * `eventId` 由调用方给：它是事件日志里的身份，回放要靠它对上。
 * 这里不自己生成——同一件事在日志和记忆里必须是同一个 id，否则
 * 「记忆能追溯到事件」那条验收就无从谈起。
 */
export function observationOf(
  change: WorldChange,
  eventId: string,
  lookups: ObservationLookups,
  anchor?: { readonly x: number; readonly y: number },
): RuntimeObservation | null {
  switch (change.change) {
    case 'task.delivered': {
      // 一单活做完了。落点是那栋楼——屋里的人看见他收工，屋外的人看不见。
      const buildingId = lookups.buildingOfTask(change.taskId);
      const at =
        buildingId === undefined ? lookups.atOfHolder(change.workerId) : lookups.atOfBuilding(buildingId);
      if (at === undefined) return null;
      return {
        eventId,
        kind: 'task_done',
        placeId: buildingId ?? `place:${change.workerId}`,
        at,
        actors: [change.workerId],
        outcome: { what: '有人交了一单活', summary: change.summary, taskKind: change.taskKind },
        importanceHint: 0.45,
        valence: 0.3,
        arousal: 0.4,
        // 交付发生在铺子里就按室内算——屋外八格的人看不见，这是痕迹通道存在的理由。
        // 但原地办的活（`in_place`）本来就在露天：地点是那个人脚下，不能一并算成室内，
        // 否则站在旁边的人永远看不见，自然目击也就永远形不成关系。
        indoor: buildingId !== undefined,
      };
    }

    case 'building.built': {
      const at = lookups.atOfBuilding(change.instanceId);
      if (at === undefined) return null;
      return {
        eventId,
        kind: 'milestone',
        placeId: change.instanceId,
        at,
        actors: [],
        outcome: { what: '有人立起了一栋新楼', name: change.displayName },
        importanceHint: 0.6,
        valence: 0.5,
        arousal: 0.4,
        // 后果规则要分得清「一栋楼」与「一个普通地点」：拆楼留下的是废墟。
        placeType: 'building',
      };
    }

    case 'building.removed': {
      const at = lookups.atOfBuilding(change.instanceId);
      if (at === undefined) return null;
      return {
        eventId,
        kind: 'conflict',
        placeId: change.instanceId,
        at,
        actors: [],
        outcome: { what: '一栋楼被拆了', name: change.displayName },
        importanceHint: 0.55,
        valence: -0.5,
        arousal: 0.5,
        // 同上：这一次「冲突」是一个地点被抹掉，不是一次口角。
        placeType: 'building',
      };
    }

    case 'miracle': {
      // 神迹的落点是格子坐标本身，没有建筑可查。
      return {
        eventId,
        kind: 'celebration',
        placeId: `place:${change.at.x},${change.at.y}`,
        at: change.at,
        actors: [],
        outcome: { what: '神明显了一次灵' },
        importanceHint: 0.8,
        valence: 0.8,
        arousal: 0.7,
      };
    }

    case 'weather': {
      // 天气没有落点：它同时发生在所有地方。落到记忆里的 `what` 写清楚是哪一档——
      // 面板的「因为昨天淋了雨，今天提前收摊」要靠这句话认出「淋雨」那一条。
      // 落点仍由调用方给（灯街的摊位；纯逻辑测试给 {0,0}）。
      const what = change.weather === 'rain'
        ? '雨落下来了'
        : change.weather === 'storm'
          ? '暴雨落下来了'
          : change.weather === 'fog'
            ? '雾漫上来了'
            : '天放晴了';
      const valence = change.weather === 'rain' || change.weather === 'storm'
        ? -0.3
        : change.weather === 'fog'
          ? -0.2
          : 0;
      return {
        eventId,
        kind: 'weather_anomaly',
        placeId: 'place:sky',
        at: anchor ?? { x: 0, y: 0 },
        actors: [],
        outcome: { what, weather: change.weather },
        importanceHint: 0.5,
        valence,
        arousal: 0.6,
      };
    }

    case 'world.event': {
      // 世界自己发生的事。**落点由世界给，不在这里编**——`where` 决定谁看得见，
      // 编一个坐标就等于让一件没在任何地方发生过的事进记忆。
      //
      // `what` 直接写那句话：这件事的文案是世界自己组织好的（「潮水退过一半，
      // 滩涂露出来了」），落到 `DEFAULT_WHAT` 那张表上只会得到一句更笼统的话。
      //
      // `actors` 是**当事人**，不是目击者：日常落点就是那个村民。少了它，
      // 她对这件事的卷入度只有先验的 0.15，显著度 0.4375 掉到 0.225，
      // 够不着 `T_write`——她自己的一天她一件也记不住。
      //
      // `street_*` 是两个人之间的事：`actorId` 是动手的那一位，`otherId`
      // 是被撞 / 被抢 / 被帮的那一位。两个人都是当事人——只记动手的那一位，
      // 被撞的人那一天就等于没发生过这件事，而关系账本该改的正是她。
      const actor = change.actorId;
      const other = change.otherId ?? null;
      const actors = actor === null
        ? []
        : other === null || other === actor ? [actor] : [actor, other];
      const failure = change.failure;
      // 失败的结构化事实要进 `outcome`：日报与后续断言读的是「哪一单、为什么、
      // 是不是重复」，不是那句给人看的话。`status: 'fail'` 是这条事件在
      // 记忆层的可检索标记——没有它，失败事实与一次普通街头小事分不开。
      const outcome = failure === undefined
        ? { what: change.text }
        : {
            what: change.text,
            status: 'fail',
            taskId: failure.taskId,
            taskKind: failure.taskKind,
            reason: failure.reason,
            repeat: failure.repeat,
          };
      return {
        eventId,
        kind: change.kind,
        placeId: change.placeId,
        at: change.where,
        actors,
        outcome,
        importanceHint: worldEventImportance(change.kind),
        // 每日小事是她自己的一天里做得成的事：比潮水多一点温度，比交付轻。
        // 街头小事有真正的情绪方向；互动只是「今天见过」。
        valence: worldEventValence(change.kind),
        arousal: worldEventArousal(change.kind),
        // 有楼就是室内（同房间目击），原地单就是室外（8 格 + 遮挡）。
        // 别的 world.event 不给这个字段，仍按调用方的地点推断。
        ...(failure === undefined
          ? {}
          : { indoor: lookups.atOfBuilding(change.placeId) !== undefined }),
        ...(other === null || actor === null || other === actor
          ? {}
          : { bondDeltas: incidentBondDeltas(change.kind, actor, other) }),
      };
    }

    // 潮位是 `now` 的纯函数，记它等于记时钟；心电图是**本层的输出**，
    // 喂回来就成了自己吃自己。传说同一条理由：它本来就是记忆层攒出来的共识，
    // 再记成一条经历，就会是「传说被听见→又形成传说」的自激。
    case 'tide':
    case 'world.vitals':
    case 'legend':
      return null;
  }
}
