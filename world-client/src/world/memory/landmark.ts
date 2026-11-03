/** 地标的一生：建 / 改 / 拆 / 废墟 / 重建。
 *
 * 这一层是**纯规则**：吃什么状态、加一段什么阶段，都由一张用例表决定，
 * 不调模型、不读墙钟。同一串事件跑两遍，地标的历史必须逐字节相同（协议 §16）。
 *
 * 三条硬约束：
 *
 * 1. **阶段引用事件，不复制事件。** `causeEventRef` 是唯一的内容入口；
 *    想读「那天到底说了什么」去 `facts` 里查，这里只有状态与时刻。
 * 2. **身份是地块，不是实例 id。** 拆完重建会拿到新的 `instanceId`
 *    （`Simulation.nextInstanceId` 不回收旧号），但那还是同一块地。
 *    `plotKey` 由原点与占地算出来，重建时用它把新旧两条记录接上。
 * 3. **废墟是状态，不是美术。** 拆掉之后先记 `demolished`，过了
 *    `ruinAfterDays` 天没有重建才记 `ruined`。美术怎么画是表现层的事，
 *    数据结构把「曾经在哪、占多大」留着（`anchor` / `footprint`）。
 */

import type { Landmark, LandmarkFootprint, LandmarkPhase, LandmarkState } from './types.ts';

/** 一栋楼落下/拆掉时，调用方能给出的位置信息。 */
export interface LandmarkInfo {
  readonly displayName: string;
  readonly origin: { readonly x: number; readonly y: number };
  readonly footprint: { readonly w: number; readonly h: number };
}

/**
 * 世界交进来的一条地标变更：**发生了什么** + **那块地在哪**。
 *
 * `built` 今天对应 `building.built`——那是**动工**，不是落成（世界在开工时
 * 就报这件事，`Simulation.build` 一落位就 announce）。所以第一段阶段的
 * 说明是「动工」，不写「落成」。楼只能拆已经建完的栋，所以生命周期仍然
 * 建 → 拆 → 废墟 → 重建 这一条完整。
 */
export interface LandmarkEvent extends LandmarkInfo {
  readonly change: 'built' | 'removed';
}

/** 站着的那几种状态。废墟与拆毁不算「站着」。 */
const STANDING: ReadonlySet<LandmarkState> = new Set<LandmarkState>(['built', 'altered', 'rebuilt']);

export function isStanding(state: LandmarkState): boolean {
  return STANDING.has(state);
}

/** 这块地的主键：原点 + 占地。同一块地上拆了再建，这个键不变。 */
export function plotKeyOf(info: LandmarkInfo): string {
  const { origin, footprint } = info;
  return `${origin.x},${origin.y},${footprint.w},${footprint.h}`;
}

/** 没有位置信息时的退化主键：至少让同一个实例 id 的两条记录接得上。 */
export function plotKeyOfPlace(placeId: string): string {
  return `place:${placeId}`;
}

export function footprintOf(info: LandmarkInfo): LandmarkFootprint {
  return { x: info.origin.x, y: info.origin.y, w: info.footprint.w, h: info.footprint.h };
}

function phase(
  state: LandmarkState,
  day: number,
  atMs: number,
  causeEventRef: string,
  name: string,
  note: string,
): LandmarkPhase {
  return { state, day, atMs, causeEventRef, name, note };
}

/**
 * 第一次立起来。
 *
 * `day` 与 `atMs` 都来自同一条事实：日只是毫秒的投影，两个都存是为了
 * 读的人不必自己换算，同时保证回放时精确时刻不丢。
 */
export function landmarkBuilt(
  placeId: string,
  info: LandmarkInfo,
  day: number,
  atMs: number,
  causeEventRef: string,
): Landmark {
  return {
    placeId,
    aliases: [placeId],
    displayName: info.displayName,
    plotKey: plotKeyOf(info),
    anchor: { x: info.origin.x, y: info.origin.y },
    footprint: footprintOf(info),
    bornDay: day,
    phases: [phase('built', day, atMs, causeEventRef, info.displayName, '动工')],
    current: 'built',
  };
}

/**
 * 同一块地上又立起了一栋：`rebuilt` 追加在旧历史后面。
 *
 * 新的实例 id 进 `aliases`，`placeId` 换成新的——旧痕迹仍挂在旧 id 名下，
 * 查这块地的全部痕迹要遍历 `aliases`，所以两个都留着。
 */
export function landmarkRebuilt(
  previous: Landmark,
  placeId: string,
  info: LandmarkInfo,
  day: number,
  atMs: number,
  causeEventRef: string,
): Landmark {
  const aliases = previous.aliases.includes(placeId)
    ? previous.aliases
    : [...previous.aliases, placeId];
  return {
    ...previous,
    placeId,
    aliases,
    displayName: info.displayName,
    anchor: { x: info.origin.x, y: info.origin.y },
    footprint: footprintOf(info),
    phases: [
      ...previous.phases,
      phase('rebuilt', day, atMs, causeEventRef, info.displayName, '重建（动工）'),
    ],
    current: 'rebuilt',
  };
}

/**
 * 拆了。楼不在，地还在。
 *
 * `anchor` 用事实给的门口坐标（拆楼那一刻它还在，调用方查得到），不用旧记录
 * 里的那个——旧记录可能是上一次重建之前的门口，一格之差就画错地方。
 */
export function landmarkDemolished(
  previous: Landmark,
  day: number,
  atMs: number,
  causeEventRef: string,
  anchor: { readonly x: number; readonly y: number },
): Landmark {
  return {
    ...previous,
    anchor: { x: anchor.x, y: anchor.y },
    phases: [
      ...previous.phases,
      phase('demolished', day, atMs, causeEventRef, previous.displayName, '拆除'),
    ],
    current: 'demolished',
  };
}

/**
 * **没有建成记录的拆楼**。手改存档、或世界从中间接过来时够得着这一支。
 *
 * 不编 `bornDay`：那一天不是它的生日，是我们第一次听说它的日子。
 * 只写一段 `demolished`，让「这块地有过事」至少查得到，不假装它一生的前史。
 */
export function landmarkWithoutHistory(
  placeId: string,
  info: LandmarkInfo | null,
  displayName: string,
  day: number,
  atMs: number,
  causeEventRef: string,
  anchor: { readonly x: number; readonly y: number },
): Landmark {
  const plotKey = info === null ? plotKeyOfPlace(placeId) : plotKeyOf(info);
  return {
    placeId,
    aliases: [placeId],
    displayName,
    plotKey,
    anchor: { x: anchor.x, y: anchor.y },
    footprint: info === null ? null : footprintOf(info),
    bornDay: day,
    phases: [phase('demolished', day, atMs, causeEventRef, displayName, '拆除（没有建成记录）')],
    current: 'demolished',
  };
}

/** 改了——今天唯一的来源是改名。 */
export function landmarkAltered(
  previous: Landmark,
  name: string,
  day: number,
  atMs: number,
  causeEventRef: string,
): Landmark {
  return {
    ...previous,
    displayName: name,
    phases: [
      ...previous.phases,
      phase('altered', day, atMs, causeEventRef, name, `改名：${previous.displayName}→${name}`),
    ],
    // 改名不改变「站着」这件事：`built` 改完名还是 `built`，`rebuilt` 也是。
    // 只有从没建过、也没有拆除记录的地方不该走到这里（调用方按地标存在才调）。
    current: isStanding(previous.current) ? previous.current : 'altered',
  };
}

/**
 * 拆掉之后过了一段时间仍没有重建：`ruined`。
 *
 * 只对 `demolished` 生效。**不删前面的阶段**：废墟是拆毁之后的下一段，
 * 「这里曾经有一栋楼」这句话的落点就是那一段 `demolished`。
 */
export function landmarkRuined(
  previous: Landmark,
  day: number,
  atMs: number,
  causeEventRef: string,
): Landmark {
  return {
    ...previous,
    phases: [
      ...previous.phases,
      phase('ruined', day, atMs, causeEventRef, previous.displayName, '荒废'),
    ],
    current: 'ruined',
  };
}

/**
 * 这块地是不是该从「刚拆」变成「废墟」。
 *
 * 判据只有一条：最后一段是 `demolished`，且已经过了 `ruinAfterDays` 个世界日。
 * `causeEventRef` 仍是那次拆除——废墟不是一件新发生的事，是同一件事的下一个样子。
 */
export function shouldRuine(landmark: Landmark, day: number, afterDays: number): boolean {
  if (landmark.current !== 'demolished') return false;
  const last = landmark.phases[landmark.phases.length - 1];
  if (last === undefined || last.state !== 'demolished') return false;
  return day - last.day >= afterDays;
}

/** 这块地此刻的历史一句话：建 / 改 / 拆 / 废墟 / 重建，按天排。 */
export function phaseSummary(landmark: Landmark): string {
  return landmark.phases.map((item) => `第${item.day}天${item.note}`).join(' · ');
}

/** 这块地的全部实例 id（含历史）。查痕迹时用它遍历。 */
export function placeIdsOf(landmark: Landmark): readonly string[] {
  return landmark.aliases.includes(landmark.placeId)
    ? landmark.aliases
    : [...landmark.aliases, landmark.placeId];
}
