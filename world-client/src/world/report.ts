/** 《神谕日报》：把世界发生过的事排成三条短讯。
 *
 * 纯函数，从快照推导，不另存一份真相。报纸只写世界真的发生过的事；
 * 没发生就不写，不用"今天很平静"这种填充句糊过去。
 */

import type { TaskRecord, WorldSnapshot } from './types.ts';
import { describePropSource } from './faith.ts';

export interface DailyReport {
  readonly headline: string;
  readonly lines: readonly string[];
  readonly date: string;
}

const LINE_LIMIT = 3;

export function composeReport(snapshot: WorldSnapshot): DailyReport {
  const done = snapshot.tasks.filter((task) => task.status === 'done');
  const failed = snapshot.tasks.filter((task) => task.status === 'failed');
  const { feed: feedDelivered, local: localDelivered } = snapshot.deliveries;
  const delivered = feedDelivered + localDelivered;
  const lines: string[] = [];

  if (delivered > 0) {
    // 先按角色分账，再在每个人名下把上游来的与本地造的活分开；不合并成一个总数。
    const workers =
      snapshot.deliveriesByVillager.length > 0
        ? snapshot.deliveriesByVillager
        : [
            {
              villagerId: snapshot.villager.id,
              name: snapshot.villager.name,
              feed: feedDelivered,
              local: localDelivered,
            },
          ];
    const localLabel = snapshot.feed.connected ? '本地' : '离线本地';
    const parts = workers.map((worker) => {
      const total = worker.feed + worker.local;
      if (total === 0) return `${worker.name}交付 0 单`;
      const sources: string[] = [];
      if (worker.feed > 0) sources.push(`上游 ${worker.feed}`);
      if (worker.local > 0) sources.push(`${localLabel} ${worker.local}`);
      return `${worker.name}交付 ${total} 单（${sources.join(' / ')}）`;
    });
    // 「最近一单」要的是**最晚交付**的那一单，不是数组末尾那一单。
    //
    // `snapshot.tasks` 是照创建顺序 push 的（`simulation.ts:1198`、`:1768`，
    // 读档那条 `:2878` 也只是按存档里的顺序原样 push 回去，全程没有 sort、
    // 没有重排），`done` 过滤一遍还是那个顺序。两个人同时干活时
    // 这两个顺序会分叉：先派下去的长活后交，后派下去的短活先交。照数组末尾取，
    // 报纸就把**先**交的那单叫「最近」——一句话说着当下，指的却是过去。
    // 实测：长活 8500 交付、短活 3800 交付，纸上写「最近一单：短活」。
    //
    // `TaskRecord` 上两个时刻戳都留着，各是各的用处：`createdAt` 是派活那一刻，
    // `completedAt` 是落成那一刻。三个收尾处写的都是 `this.now`——
    // `finishInPlace`（`simulation.ts:2329`）、`finishActiveTask`（`:2500`）、
    // `settleDetachedTask`（`:2962`）；而世界钟只增不减（`update` 里 `:581`
    // 每次 `+=`），所以按 `completedAt` 排出来的才是真正的交付顺序。读档回来的
    // 单带着原来的 `completedAt`，新交的只会更大，跨会话也还排得对。
    //
    // 打平怎么办：同一拍里两单都落成时 `completedAt` 相等（两单一起派下去就会——
    // 一帧里两条命令、两个铺子同一拍越过预估，都走得到）。那时没有"更近"可言，
    // 可纸上仍要写「最近一单」——写了就是句假话，说的是唯一，那儿有两个。
    // 所以打平时**整句不提**，跟 `done` 为空时同一个处置：说不出就不说。
    // 这不是保守过头：`deliveries.local` 已经如实报了两单，少的只是一个排名。
    const latest = done.reduce<TaskRecord | undefined>(
      (newest, task) =>
        newest === undefined || (task.completedAt ?? 0) > (newest.completedAt ?? 0)
          ? task
          : newest,
      undefined,
    );
    const tied =
      latest !== undefined &&
      done.some((task) => task !== latest && (task.completedAt ?? 0) === (latest.completedAt ?? 0));
    lines.push(
      latest === undefined || tied
        ? parts.join(' / ')
        : `${parts.join(' / ')}，最近一单：${latest.summary}`,
    );
  } else {
    lines.push('还没有交付。祭坛在等第一条神谕。');
  }

  // 这一句数的是**玩家这次玩起来之后造没造**。答案在快照里存着：
  // `startupBuildingIds` 之外的就是。不猜——猜过的两种猜法都错过：
  //   - `boundTask === null` 问的是「接不接活」。民居不接活却是开局落的，
  //     于是大世界的日报在玩家什么都没做的那天写「造物主新起 5 栋楼」（旧措辞）。
  //   - `zone !== 'living'` 问的是分区。灯潮界那六栋楼全是 `zone: 'industry'` +
  //     `boundTask: null`，同一句话在设定集上原样重现；而小世界里玩家真能建一间
  //     民居（白名单只查模板在不在），那条判据又把它整句话吞掉。
  //
  // 也不说「新起」：报纸是现算的（`composeReport` 每次调用都从快照推一遍），
  // 日期还跟着世界钟走（`formatDate` 打的是第几分第几秒）。一栋开局后落成的楼，
  // 到钟走了很远的那张报纸上仍写着「新起」——「新」是句时间断言，而手里有的只是
  // 「开局之后造的」这份来路。
  //
  // 想改说「今天起的」也做不到：`PlacedBuilding` 上没记落成时刻（只记了人的一句
  // `sourceSummary`），没有时刻戳可比。天界倒是有一个——`lampDayOf(snapshot.now)`
  // 按世界钟算得出第几天——可一天的两头只有一头，比不出「这栋是不是今天落的」。
  // 所以说来路，不说新旧。
  const newBuildings = snapshot.buildings.filter(
    (building) => !snapshot.startupBuildingIds.has(building.instanceId),
  );
  if (newBuildings.length > 0) {
    // 有来由的楼写清来由：那是"被记住"在建筑上的落点。
    const described = newBuildings.map((building) =>
      building.sourceSummary === null || building.sourceSummary === undefined
        ? building.displayName
        : `${building.displayName}（${building.sourceSummary}）`,
    );
    lines.push(`开局之后造物主起了 ${newBuildings.length} 栋楼：${described.join('、')}`);
  }

  if (snapshot.props.length > 0) {
    // 最新那件写清来路，早先的只列名字：一行里挤不下全部来源。
    const latest = snapshot.props[snapshot.props.length - 1];
    const earlier = snapshot.props.slice(0, -1).map((prop) => prop.label);
    const latestLine = latest === undefined ? '' : describePropSource(latest);
    const head = earlier.length > 0 ? `${earlier.join('、')}、${latestLine}` : latestLine;
    lines.push(`${head} 已经落在祭坛边。`);
  }

  if (failed.length > 0) {
    lines.push(`有 ${failed.length} 单没办成，记在案上。`);
  }

  const weather =
    snapshot.weather === 'clear'
      ? '今天晴'
      : snapshot.weather === 'storm'
        ? '今天刮了暴雨'
        : '今天下了雨';
  lines.push(`${weather}。${villagerTail(snapshot)}`);

  // 没有里程碑时不能写"第 1 次神恩"：那是还没发生的事。
  //
  // 头条也不许带时间词，理由同上面那句「新起」：报纸是现算的，日期跟着世界钟走，
  // 而这两个数都是**整场累计**的——`deliveries` 由 `settledLog` 重建，而 `settledLog`
  // 只追加不裁剪、整份落档（`toSave` 的 `settled`），所以它把上一次会话交付的单也
  // 数在内。于是「今日有交付」会在一个今天什么都没交付的会话里说今天有交付；
  // 「世界刚醒来」则在钟走了很远、仍然一单未交付时继续说刚醒来。
  // 攒满里程碑那条本来是干净的（数的是已经落地的次数，不带时间词），不动。
  const headline =
    snapshot.faith.milestones > 0
      ? `第 ${snapshot.faith.milestones} 次神恩已落地`
      : delivered > 0
        ? '已有交付'
        : '世界还没动静';

  return {
    headline,
    lines: lines.slice(0, LINE_LIMIT),
    date: formatDate(snapshot.now),
  };
}

export function formatDate(nowMs: number): string {
  const totalSeconds = Math.floor(nowMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `第 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

/** 多角色收尾：谁在忙、谁在祭坛，都按名字写清；全闲/全忙各有可读措辞。 */
function villagerTail(snapshot: WorldSnapshot): string {
  const states = snapshot.villagers.map((villager) => ({
    villager,
    task: snapshot.tasks.find((item) => item.id === villager.taskId),
  }));
  const busy = states.filter((item) => item.task !== undefined);
  const idleNames = states
    .filter((item) => item.task === undefined)
    .map((item) => item.villager.name);
  if (busy.length === 0) {
    return snapshot.villagers.length > 1
      ? `${idleNames.join('、')}都在祭坛边坐着。`
      : '在祭坛边坐着。';
  }
  const parts = busy.map(
    ({ villager, task }) => `${villager.name}手上是「${task?.summary ?? ''}」`,
  );
  if (idleNames.length > 0) parts.push(`${idleNames.join('、')}在祭坛边坐着`);
  return `${parts.join('，')}。`;
}

export { LINE_LIMIT };
