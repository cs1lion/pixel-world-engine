/** 《神谕日报》：把世界发生过的事排成三条短讯。
 *
 * 纯函数，从快照推导，不另存一份真相。报纸只写世界真的发生过的事；
 * 没发生就不写，不用"今天很平静"这种填充句糊过去。
 */

import type { TaskRecord, VillagerSnapshot, WorldSnapshot } from './types.ts';
import { describePropSource } from './faith.ts';
import { NOT_SOMEWHERE, atAltar } from './villager-words.ts';

export interface DailyReport {
  readonly headline: string;
  readonly lines: readonly string[];
  /**
   * 世界开跑至今过了多久，**不是日历上的日期**。
   *
   * 这个字段原来叫 `date`，生成它的函数原来叫 `formatDate`——两个名字都在承诺
   * 一件它们不做的事：这个世界没有日历，`formatWorldClock` 打的是
   * 「第 N 分 MM 秒」，一个从开局起只增不减的秒表。叫 `date` 的害处是具体的：
   * 下一个读它的人会拿它当日期用（排月份、比大小、或者写"今日"），而它连翻篇都不会。
   * 所以名字改成说实话的那个。
   */
  readonly clock: string;
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
    // 这一段里的行号**审计看不见**：`audit-references.ts` 的 `CALL_REF` 要求
    // 「名字()」紧跟坐标，而这里是「名字」+ 全角括号、坐标在反引号里——那 8 处
    // 同一形状的引用它一律不查（它自己的注释里记着这个数）。所以改过
    // `simulation.ts` 之后，这些数得手工核，没有东西会替你红。
    //
    // `snapshot.tasks` 是照创建顺序 push 的（`simulation.ts:1443`、`:2028`，
    // 读档那条 `:3097` 也只是按存档里的顺序原样 push 回去，全程没有 sort、
    // 没有重排），`done` 过滤一遍还是那个顺序。两个人同时干活时
    // 这两个顺序会分叉：先派下去的长活后交、后派下去的短活先交。照数组末尾取，
    // 报纸就把**先**交的那单叫「最近」——一句话说着当下，指的却是过去。
    // 实测：长活 8500 交付、短活 3800 交付，纸上写「最近一单：短活」。
    //
    // `TaskRecord` 上两个时刻戳都留着，各是各的用处：`createdAt` 是派活那一刻，
    // `completedAt` 是落成那一刻。三个收尾处写的都是 `this.now`——
    // `finishInPlace`（`simulation.ts:2510`）、`finishActiveTask`（`:2697`）、
    // `settleDetachedTask`（`:3178`）；而世界钟只增不减（`update` 里 `:682`
    // 每次 `+=`），所以按 `completedAt` 排出来的才是真正的交付顺序。读档回来的
    // 单带着原来的 `completedAt`，新交的只会更大，跨会话也还排得对。
    //
    // 打平怎么办：同一拍里两单都落成时 `completedAt` 相等。那时没有"更近"可言，
    // 可纸上仍要写「最近一单」——写了就是句假话，说的是唯一，那儿有两个。
    // 所以打平时**整句不提**，跟 `done` 为空时同一个处置：说不出就不说。
    // 这不是保守过头：`deliveries.local` 已经如实报了两单，少的只是一个排名。
    //
    // 打得平只有一条路，窄得很：同一帧里派两条 `quick`，且有两个以上空闲村民
    // ——两条都原地办（`finishInPlace`，铺子是 null），于是在同一拍写上同一个
    // `this.now`。实测 createdAt 100/100、completedAt 1300/1300；只有一个村民时
    // 第二条要排队（created 1300、completed 2500），打不平。
    //
    // 别把这条读成「同一帧派两单就会打平」——实测不是：四类活的时长两两不同
    // （镇内 6000/4200/3200/1200，郊野同乘 1.8 得 10800/7560/5760/1200），
    // 不同类永远落不到同一拍；同一类在同一帧里派两条，第二条连单都建不出来
    // （一种活一座铺子，`pickVenue` 直接回「没有空闲的」）。上游那条更到不了
    // 这儿：`syncEvents` 收工的单一律 splice 出表（`:1492`、`:3193`），
    // 所以 `done` 里只会有本地派的活。
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
  // 而世界钟是个只增不减的秒表（`formatWorldClock` 打的是第几分第几秒，见文件
  // 末尾）。一栋开局后落成的楼，到钟走了很远的那张报纸上仍写着「新起」——
  // 「新」是句时间断言，而手里有的只是「开局之后造的」这份来路。
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
      ? '外头晴着'
      : snapshot.weather === 'storm'
        ? '外头刮着暴雨'
        : '外头下着雨';
  lines.push(`${weather}。${villagerTail(snapshot)}`);

  // 天气那一句不带时间词，理由是同一条：`snapshot.weather` 是**这一拍**的读数。
  //
  // 这里原先写「世界钟里没有"天"」——不成立，同一份文件上面那段「开局之后造物主
  // 起了 N 栋楼」的注释里就写着反面：`lampDayOf(snapshot.now)` 按世界钟算得出第几天
  // （`lampoil.ts:59`，一天 24 个世界小时），记忆也按天归档。「没有天」只对
  // `formatWorldClock` 成立：它打「第 N 分 MM 秒」，只增不减（实测 now 到 180000000 仍是
  // 「第 3000 分」）。原先那句「实测 18000000 没有第二天」也举错了例子——那才 5 小时，
  // 第一个整天都没走完（`lampDayOf` 那天还是 0），第二天要到 86400000 才来。
  //
  // （原来这里写的是「同一份文件第 113 行」——**一个文件内的自指行号**，正是这个仓库
  // 反复吃亏的那类引用：它跟着我自己的编辑漂。改过几笔之后那一行说的是
  // `formatWorldClock` 打第几分第几秒，而要说的是 `lampDayOf` 那句，它在另一段注释里。
  // 行号引用审计也看不见这种漂：`audit-references.ts` 只认「文件.ts:NNN」这个形状，
  // 一句光秃秃的「第 113 行」它根本不查。所以这里改成叫名字，不叫行号——也不写
  // 「上面第几行」，那同样是会漂的数。）
  //
  // 结论不变，换一条理由：有天也照样不能说「今天晴」。天气是这一拍的读数，
  // 快照里没有按天记的天气史，「今天早些时候下没下过」无从知道——与上面
  // 「新起」是同一道坎：有单位，没有可比的第二个数。「下了雨」还多一层过去时。
  // 改成现在时：外头晴着 / 下着雨 / 刮着暴雨，全都只描述手里这一拍。
  //
  // 没有里程碑时不能写"第 1 次神恩"：那是还没发生的事。
  //
  // 头条也不许带时间词，理由同上面那句「新起」：报纸是现算的，日期跟着世界钟走，
  // 而这两个数都是**整场累计**的——`deliveries` 由 `settledLog` 重建，而 `settledLog`
  // 只追加不裁剪、整份落档（`toSave` 的 `settled`），所以它把上一次会话交付的单也
  // 数在内。于是「今日有交付」会在一个今天什么都没交付的会话里说今天有交付；
  // 「世界刚醒来」则在钟走了很远、仍然一单未交付时继续说刚醒来。
  // 攒满里程碑那条本来是干净的（数的是已经落地的次数，不带时间词），不动。
  //
  // 「世界还没动静」这半句也不许只看那两计数：实测零交付、零里程碑而一棵神迹
  // 种的树已经落在祭坛边（props=1），同一份报纸的第二行正写着「一棵神迹种的树
  // 已经落在祭坛边」——头条说没动静，纸上别处写着它动过。所以把 props、
  // 开局后起的楼、没办成的单一起算进"动没动过"；真的什么都没发生才这么说。
  //
  // 这里原来写「神迹树的**照片**」——这个世界没有照片。`WorldProp`（`types.ts` 里
  // 那个 interface）是一盏灯/一棵树/一面幌布，带 `kind`、`at`、`label`，是画在
  // 地图上的一件东西，不是任何影像；全仓 grep「照片」只命中这一处注释自己。
  // 实测描述的是 props 数组里多出来那一项，照实说「一棵树」就行。
  //
  // 这一句原来还带一个指向 `ConstructionSnapshot.totalMs` 的行号，而
  // `WorldProp` 在它下面二十多行——我写错了，而行号引用审计查不出来：那两行都
  // "有代码"，`hasCode()` 只判「不是空行、不只是括号」。所以这里只引名字不引行号。
  const changed =
    snapshot.props.length > 0 || newBuildings.length > 0 || failed.length > 0;
  const headline =
    snapshot.faith.milestones > 0
      ? `第 ${snapshot.faith.milestones} 次神恩已落地`
      : delivered > 0
        ? '已有交付'
        : changed
          ? '镇子上已经有了变化'
          : '世界还没动静';

  return {
    headline,
    lines: lines.slice(0, LINE_LIMIT),
    clock: formatWorldClock(snapshot.now),
  };
}

/**
 * 世界开跑至今过了多久：一个只增不减的秒表，不是日期。
 *
 * 名字里不带 `Date` 是故意的（原来叫 `formatDate`）：这个世界没有日历，
 * 而一个叫 `formatDate` 的函数会让人以为它哪天能翻篇——它不会，`now` 到
 * 180000000 打的还是「第 3000 分」。要"第几天"有另一个函数：
 * `lampoil.ts` 的 `lampDayOf(snapshot.now)`（一天 24 个世界小时）。
 * 两者不要在这里合：报纸每一拍都重算，一个会翻篇的日期会让同一天里
 * 的两次刷新打出不同的"今天"。
 */
export function formatWorldClock(nowMs: number): string {
  const totalSeconds = Math.floor(nowMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `第 ${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

/**
 * 多角色收尾：谁在忙、谁在做什么，都按名字写清。
 *
 * 闲人那一半**不许**一律写「在祭坛边坐着」。实测两个村民跑 8000 拍，
 * 这话在 7766 拍上是假的——她在农田边、街口、屋檐下，纸上说她在祭坛。
 * 而且 `VillagerSnapshot.routine` 一直有值（16000 拍里 15964 拍有牌子），
 * 字段注释写明「没活干时她在做什么，给纸面状态行用」——纸上本该用它，
 * 自己另编一句位置，等于把世界已经说过的那句话盖掉。
 */
function villagerTail(snapshot: WorldSnapshot): string {
  const states = snapshot.villagers.map((villager) => ({
    villager,
    task: snapshot.tasks.find((item) => item.id === villager.taskId),
  }));
  const busy = states.filter((item) => item.task !== undefined);
  const idle = states.filter((item) => item.task === undefined);
  if (busy.length === 0) return `${idleClauses(idle, snapshot).join('、')}。`;
  const parts = busy.map(
    ({ villager, task }) => `${villager.name}手上是「${task?.summary ?? ''}」`,
  );
  if (idle.length > 0) parts.push(idleClauses(idle, snapshot).join('、'));
  return `${parts.join('，')}。`;
}

/** 一句话能不能并成「A、B都……」：带标点的牌子并起来不是话。 */
function mergeable(body: string): boolean {
  return body !== NOT_SOMEWHERE && !/[，。！？；、]/.test(body);
}

/**
 * 闲人们在干什么。只写查过的，不猜。
 *
 * 牌子是世界自己对这一幕的说法，优先用它——它连动词带地点都是世界算出来的。
 * 没有牌子时才轮到纸上判断位置，而且只判手上有坐标可比的那一个点：
 * 人在祭坛格上才说「在祭坛边坐着」，不在就只说"没个准地方"，
 * 不给她安一个没查过的去处。
 *
 * 「在祭坛格上」这一判与状态行那句是同一判（`villager-words.ts` 的 `atAltar`），
 * 搬过去共用：纸与屏各写各的判据时，修一处漏一处就是这么来的。
 */
function idleClauses(
  idle: readonly { readonly villager: VillagerSnapshot }[],
  snapshot: WorldSnapshot,
): string[] {
  const groups = new Map<string, string[]>();
  for (const { villager } of idle) {
    const body =
      villager.routine ?? (atAltar(villager, snapshot) ? '在祭坛边坐着' : NOT_SOMEWHERE);
    const names = groups.get(body);
    if (names === undefined) groups.set(body, [villager.name]);
    else names.push(villager.name);
  }
  // 同样的一句话并成一组：两个人都祭坛边坐着时，「莞尔、阿雾都在祭坛边坐着」
  // 比把同一句写两遍可读。原来那句不可读的根源不是写法，是内容不真。
  return [...groups].map(([body, names]) =>
    names.length > 1 && mergeable(body) ? `${names.join('、')}都${body}` : names.map((name) => `${name}${body}`).join('、'),
  );
}

export { LINE_LIMIT };
