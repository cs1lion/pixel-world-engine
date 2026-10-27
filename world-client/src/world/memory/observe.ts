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

import type { WorldChange } from '../world-changes.ts';
import type { RuntimeObservation } from './runtime.ts';

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
      // 天气没有落点：它同时发生在所有地方。用祭坛当锚——那是村子中心，
      // 而「天气反常」这件事本来就该被全村看见。
      return {
        eventId,
        kind: 'weather_anomaly',
        placeId: 'place:sky',
        at: { x: 0, y: 0 },
        actors: [],
        outcome: { what: '天气反常', weather: change.weather },
        importanceHint: 0.5,
        valence: change.weather === 'storm' ? -0.3 : 0,
        arousal: 0.6,
      };
    }

    // 潮位是 `now` 的纯函数，记它等于记时钟；心电图是本层的输出，
    // 喂回来就成了自己吃自己。两者都不进记忆。
    case 'tide':
    case 'world.vitals':
      return null;
  }
}
