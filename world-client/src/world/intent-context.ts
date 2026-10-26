/** 喂给意图模型的**世界现状**。
 *
 * 为什么需要：模型现在只看到一句话与模板表，不知道镇上几栋楼、谁在忙。
 * 「建个工坊」若已有工坊，由世界在结算时拒绝并说清——但那是**事后**才知道，
 * 用户白等一次往返。把现状给它，模型能在事前少犯这类错。
 *
 * 三条纪律，与 `intent-schema.ts` 同源：
 *
 * 1. **只读上下文，不是校验来源。** 模型看到「已有工坊」不代表它有权拒绝；
 *    真正的拒绝仍由世界判（`simulation.ts` 的 `build` 分支）。这里只减少
 *    模型的瞎猜，不接管任何判定。
 *
 * 2. **不含可推断的细节。** 不发完整建筑数组、不发每个格子、不发任务 id。
 *    发一串建筑清单，模型除了复述没有别的用途，还白烧 token。
 *    唯一的例外是 `instanceId`：它不是细节，是**这栋楼的唯一名字**。
 *    拆楼必须指名道姓（见 `intent-schema.ts` 的 demolish），不给它，
 *    模型只能给模板，世界就得替用户挑一栋。
 *
 * 3. **形状稳定。** 这份结构同时喂 `intent-prompt.ts`（离线推演与测试）与
 *    `world_intent.py`（线上）。两处都从这里的字段渲染，改字段只改一处。
 */

import { WILD_PREFABS } from './setup.ts';
import { TASK_PROFILES, WORKSHOP_TASKS } from './tasks.ts';
import type { CarryItem, PlacedBuilding, TaskKind, VillagerSnapshot, Weather, WorldSnapshot } from './types.ts';

/** 一道要凭证的区域：要什么、叫什么。叫法是给界面与模型看的，不由网格给。 */
export interface GatedRegion {
  readonly id: string;
  readonly name: string;
  readonly needs: CarryItem;
}

/** 一处呼吸段（SPEC_V2 §4.7）：叫什么。叫法由拿着设定集的调用方给，不由网格给。 */
export interface BreathingRegion {
  readonly id: string;
  readonly name: string;
}

/**
 * 喂给模型的世界现状。
 *
 * 刻意做成"一句话能说清的量"：建筑清单、谁在忙、天气、缺口。
 * 每多一个字段就多一处两端要同步的地方。
 */
export interface IntentContext {
  /** 已有的建筑，按郊野 / 镇内分组，只给 id 与显示名。 */
  readonly built: {
    readonly town: readonly { readonly instanceId: string; readonly templateId: string; readonly name: string }[];
    readonly wild: readonly { readonly instanceId: string; readonly templateId: string; readonly name: string }[];
  };
  /** 每类活有几栋能接。`0` 表示这类活目前没地方做。 */
  readonly capacity: readonly { readonly taskKind: TaskKind; readonly count: number }[];
  /** 正在干活的人。空闲时不列。 */
  readonly busy: readonly { readonly name: string; readonly taskKind: TaskKind }[];
  /** 还有几条神谕在排队。 */
  readonly queued: number;
  readonly weather: Weather;
  /** 已经建过、不能再建第二栋的模板。与 `simulation.ts` 的 build 拒绝一致。 */
  readonly exhausted: readonly string[];
  /**
   * 要凭证才进得去的区域，以及此刻谁过得去、谁过不去。
   *
   * 渡有仪式（SPEC_V2 §4.6）从前不在这儿：那道门在世界上是真的，喂给模型的
   * 现状里却没有。于是模型既不知道「汐进不去叠浪楼」，也不知道 `carry`
   * 能改变这件事——用户说「让她进得去」，它只能答 unknown。
   *
   * `passed` / `blocked` 是**此刻**谁兜里有什么，不是永久属性：`carry`
   * 一给一收，下一次快照这段话就变了。所以它和 `busy` 一样是快照，不是设定。
   */
  readonly gated: readonly {
    readonly region: string;
    readonly needs: CarryItem;
    readonly passed: readonly string[];
    readonly blocked: readonly string[];
  }[];
  /**
   * 哪几处是呼吸段（SPEC_V2 §4.7）。
   *
   * 与 `gated` 同一条理由：呼吸段在世界上是真的，不说出来它就只是配置里的
   * 一行字。用户看到世界静了一瞬，不知道那是设定，会以为它卡了。
   *
   * 只给叫什么，不给谁在里头：里头的人是快照，会随她走动每拍都变，
   * 而这一行要说的是**哪儿**是留白，不是**此刻**谁在歇。
   */
  readonly breathing: readonly { readonly region: string }[];
}

/** 从快照归纳出喂模型的上下文。纯函数。
 *
 * `gates` 是世界有哪几道门（`WorldGrid.gatedRegions()` 配上设定集的叫法），
 * `breathing` 是世界有哪几处留白（`WorldGrid.breathingRegions()` 同一条手续）。
 * 两者省略都等于「一样都没有」——莞尔镇从来没有这两项，它的现状不该因此多出一行。 */
export function summarizeForIntent(
  snapshot: WorldSnapshot,
  gates: readonly GatedRegion[] = [],
  breathing: readonly BreathingRegion[] = [],
): IntentContext {
  const isWild = (building: PlacedBuilding): boolean => WILD_PREFABS.has(building.prefabId);
  const toEntry = (building: PlacedBuilding) => ({
    instanceId: building.instanceId,
    templateId: building.prefabId,
    name: building.displayName,
  });

  const town = snapshot.buildings.filter((b) => !isWild(b)).map(toEntry);
  const wild = snapshot.buildings.filter((b) => isWild(b)).map(toEntry);

  // 铺子的产能：按 boundTask 数，未建的不算。
  const capacity = WORKSHOP_TASKS.map((kind) => ({
    taskKind: kind,
    count: snapshot.buildings.filter((b) => b.boundTask === kind).length,
  }));

  // 谁在忙：taskId 指向的任务就是他在做的活。
  const busy: { name: string; taskKind: TaskKind }[] = [];
  for (const villager of snapshot.villagers) {
    const kind = busyKindOf(villager, snapshot);
    if (kind !== null) busy.push({ name: villager.name, taskKind: kind });
  }

  return {
    built: { town, wild },
    capacity,
    busy,
    queued: snapshot.pending.length,
    weather: snapshot.weather,
    // 世界拒绝「同一种铺子建第二栋」，所以每个已建的模板都算耗尽。
    exhausted: [...new Set(snapshot.buildings.map((b) => b.prefabId))],
    // 谁兜里有什么按**此刻**的快照算：carry 一给一收，这段话下一拍就变了。
    gated: gates.map((gate) => ({
      region: gate.name,
      needs: gate.needs,
      passed: snapshot.villagers.filter((v) => v.carries.includes(gate.needs)).map((v) => v.name),
      blocked: snapshot.villagers.filter((v) => !v.carries.includes(gate.needs)).map((v) => v.name),
    })),
    breathing: breathing.map((place) => ({ region: place.name })),
  };
}

/** 这个人在做什么活；闲着返回 null。 */
function busyKindOf(villager: VillagerSnapshot, snapshot: WorldSnapshot): TaskKind | null {
  if (villager.taskId === null) return null;
  const task = snapshot.tasks.find((item) => item.id === villager.taskId);
  return task?.kind ?? null;
}

/**
 * 把上下文渲染成提示词里的一段。
 *
 * 为什么不用 JSON：模型要读的是"镇上有什么"，不是一份数据。JSON 会更长、
 * 更容易被它误当成输出格式的样例照抄。
 */
export function renderIntentContext(context: IntentContext): string {
  const lines: string[] = [];

  if (context.built.town.length === 0 && context.built.wild.length === 0) {
    lines.push('世界是空的，一栋楼都没有。');
  } else {
    lines.push(`镇内已有：${describeBuildings(context.built.town)}`);
    lines.push(`郊野已有：${describeBuildings(context.built.wild)}`);
  }

  const total = context.capacity.reduce((sum, entry) => sum + entry.count, 0);
  lines.push(
    `能接活的铺子 ${total} 栋（${context.capacity
      .map((entry) => `${TASK_PROFILES[entry.taskKind].label} ${entry.count}`)
      .join(' / ')}）。`,
  );

  if (context.busy.length > 0) {
    lines.push(
      `正在忙：${context.busy
        .map((item) => `${item.name}在做${TASK_PROFILES[item.taskKind].label}`)
        .join('、')}。`,
    );
  } else {
    lines.push('现在没人干活。');
  }

  if (context.queued > 0) lines.push(`还有 ${context.queued} 条神谕在排队。`);
  // 三档都要说出来：告诉模型「天在下雨」而实际是暴雨，它就会把用户说的
  // 「雨太大了」当成已经在办的事，答 unknown。
  lines.push(
    context.weather === 'clear'
      ? '天晴。'
      : context.weather === 'storm'
        ? '外面在刮暴雨。'
        : '外面在下雨。',
  );

  if (context.exhausted.length > 0) {
    lines.push(
      `这些模板已经建过，不能再建第二栋：${context.exhausted.join('、')}。`,
    );
  }

  // 门要在最后说，而且要连着「谁能改它」说。只说「叠浪楼要一盏灯」，
  // 模型知道有这么道门，还是不知道用户说「让她进得去」时该答什么——
  // 那句话要听成 `carry`，而 `carry` 在你能表达的命令那张表里。
  // 一道门都没有时整段不出现：莞尔镇的现状不该多出一行讲不存在的东西。
  for (const gate of context.gated) {
    const who = (names: readonly string[]): string =>
      names.length === 0 ? '没人' : names.join('、');
    lines.push(
      `${gate.region}要${CARRY_LABEL[gate.needs]}才进得去：${who(gate.passed)}进得去，` +
        `${who(gate.blocked)}进不去。要让人进得去，给她一件（见 carry）。`,
    );
  }

  // 呼吸段跟在门后头说，也连「没有命令能改它」说：`carry` 改的是门，
  // 改不了留白。不说这句，模型会以为用户说「让浅滩轨道别静了」时
  // 该去改世界上的一道门。
  // 一处都没有时整段不出现：莞尔镇的现状不该多出一行讲不存在的东西。
  if (context.breathing.length > 0) {
    lines.push(
      `${context.breathing.map((place) => place.region).join('、')}是留白：` +
        '那里不派活、不出急件。这是世界自己的节律，没有命令能改它。',
    );
  }

  return lines.join('\n');
}

/** 凭证的中文叫法。提示词与现状说的是同两个词，不能让模型去猜 lamp 是什么。 */
const CARRY_LABEL: Readonly<Record<CarryItem, string>> = {
  lamp: '一盏灯',
  shoes: '一双鞋',
};

function describeBuildings(
  list: readonly { readonly name: string }[],
): string {
  if (list.length === 0) return '空着';
  return list.map((entry) => entry.name).join('、');
}
