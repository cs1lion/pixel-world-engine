/** 史诗分级：哪些事件够格成为「史诗条目」。
 *
 * 这一层的全部输入都能算：重要性、不可逆性、覆盖比例、跨度。没有模型，
 * 没有「读起来像史诗」的判断。**同一份存档跑两遍必须得到同一批条目**——
 * 这是协议 §16（回放一致）在场景记忆上的落法，也有测试钉着。
 *
 * 档位不是新的传说分类学，而是**对同一条传说加一层度量**：传说先按既有规则
 * 形成（`legend.ts` 的 `qualifies`），形成之后在这里问「它有多重」。
 * 不够格的不删：留在 `legends` 里，照旧读得到，只是不进 `epics` 那一列。
 */

import type { MemoryConfig } from './config.ts';
import type { EpicCriteria, EpicEntry, EpicGrade, Legend, WorldFact } from './types.ts';

/** 判档要的三次查表。给的是引用 id，不是事实本身。 */
export interface EpicLookups {
  readonly factOf: (eventRef: string) => WorldFact | undefined;
  readonly population: number;
  readonly formedDay: number;
}

/**
 * 不可逆性（0..1）。**拆掉/废墟 = 1，改名 = 0.8，立楼 = 0.4，其余 = 0。**
 *
 * 为什么拆楼是 1：楼没了，痕迹会风化到 0，但它不必等 —— 「这块地曾经有一栋楼」
 * 这件事在世界的状态里永远回不去了。庆典、事故、天气都能被下一次覆盖，
 * 拆楼不能。改名 0.8：名字改回来过（理论上），但历史链留下来了，
 * 所以它比庆典重、比拆楼轻。立楼 0.4：楼能拆，但「这里曾经立起来过」
 * 是这块地的第一笔。
 */
export function irreversibilityOf(fact: WorldFact | undefined): number {
  if (fact === undefined) return 0;
  if (fact.kind === 'conflict' && fact.placeType === 'building') return 1;
  if (fact.kind === 'milestone') return fact.placeType === 'building' ? 0.4 : 0.2;
  return 0;
}

/** 这件事的规模：看见过它的人。没有事实时按 0——查不到不等于很大。 */
function witnessesOf(fact: WorldFact | undefined): number {
  return fact === undefined ? 0 : fact.witnesses.length;
}

/**
 * 算度量。`reach` 用传说形成时的 `legend.reach`（讲它的人），
 * `populationShare` 用事件本身的目击者——两者不是同一件事：
 * 一个人可以**没看见**却听说了（reach），也可以是**看见了**但从不提起。
 */
export function criteriaOf(legend: Legend, lookups: EpicLookups): EpicCriteria {
  let importance = 0;
  let irreversibility = 0;
  let witnesses = 0;
  let earliestDay = lookups.formedDay;
  for (const eventRef of legend.eventRefs) {
    const fact = lookups.factOf(eventRef);
    const hint = fact?.importanceHint ?? 0;
    if (hint > importance) importance = hint;
    const irrev = irreversibilityOf(fact);
    if (irrev > irreversibility) irreversibility = irrev;
    const seen = witnessesOf(fact);
    if (seen > witnesses) witnesses = seen;
    if (fact !== undefined && fact.day < earliestDay) earliestDay = fact.day;
  }
  const population = Math.max(1, lookups.population);
  return {
    importance,
    irreversibility,
    reachShare: legend.reach / population,
    populationShare: witnesses / population,
    spanDays: Math.max(0, lookups.formedDay - earliestDay),
  };
}

/**
 * 判档。阈值全部来自 `config`，理由写在那儿：
 *
 * | 档 | 条件 |
 * | --- | --- |
 * | `founding` | importance ≥ 0.8（celebration 级）、不可逆 ≥ 1、讲的人 ≥ 人口 70% |
 * | `epic` | importance ≥ 0.55（拆楼/冲突级）、不可逆 ≥ 0.5、讲的人 ≥ 人口 50% |
 * | `legend` | importance ≥ 0.55、看见过的人 ≥ 人口 50% |
 * | `local` | 其余（仍是一条传说，只是不够格叫史诗） |
 *
 * **为什么门槛是 0.55，以及为什么口角混不进来**：0.55 同时是
 * `building.removed` 与 `conflict` 的 hint。拆楼是日常事件里唯一
 * 不可逆性到 1 的，门槛必须让它够得着；一次口角的 hint 一样是 0.55，
 * 但它的不可逆性是 0，所以最高只到 `legend` 档。两条判据分工明确：
 * 「够重」（importance）与「回不去」（irreversibility）。
 */
export function gradeOf(criteria: EpicCriteria, config: MemoryConfig): EpicGrade {
  if (criteria.importance >= config.epicFoundingImportance
    && criteria.irreversibility >= 1
    && criteria.reachShare >= config.epicFoundingReachShare) {
    return 'founding';
  }
  if (criteria.importance >= config.epicImportanceFloor
    && criteria.irreversibility >= 0.5
    && criteria.reachShare >= config.epicReachShare) {
    return 'epic';
  }
  if (criteria.importance >= config.epicImportanceFloor
    && criteria.populationShare >= config.epicPopulationShare) {
    return 'legend';
  }
  return 'local';
}

/** 题目的规则模板。**不调模型**；只为让碑上有一句话，措辞不需要文采。 */
export function titleOf(legend: Legend, lookups: EpicLookups): string {
  let heaviest: WorldFact | undefined;
  let weight = -1;
  for (const eventRef of legend.eventRefs) {
    const fact = lookups.factOf(eventRef);
    const hint = fact?.importanceHint ?? 0;
    if (fact !== undefined && hint > weight) {
      heaviest = fact;
      weight = hint;
    }
  }
  if (heaviest === undefined) return '一件被反复讲起的事';
  const name = typeof heaviest.outcome.name === 'string' ? heaviest.outcome.name : null;
  if (heaviest.kind === 'conflict' && heaviest.placeType === 'building') {
    return name === null ? '一栋楼被拆了' : `『${name}』被拆了`;
  }
  if (heaviest.kind === 'milestone') {
    return name === null ? '有人立起了一栋楼' : `『${name}』立起来了`;
  }
  if (heaviest.kind === 'celebration' || heaviest.kind === 'tavern_feast') return '一场庆典';
  if (heaviest.kind === 'weather_anomaly') return '天气反常的那几天';
  if (heaviest.kind === 'visitor_arrival') return '有生人进了镇子';
  if (heaviest.kind === 'task_done') return '一单活做成了';
  return '一件被反复讲起的事';
}

/**
 * 从一条传说造一条史诗条目。`epicId` 由世界发（自增）。
 *
 * 返回 `null` 表示这条传说不够格（`local`）——它仍然在 `legends` 里，
 * 不去 `epics` 那一列占位。
 */
export function makeEpic(
  epicId: string,
  legend: Legend,
  lookups: EpicLookups,
  config: MemoryConfig,
): EpicEntry | null {
  const criteria = criteriaOf(legend, lookups);
  const grade = gradeOf(criteria, config);
  if (grade === 'local') return null;
  return {
    epicId,
    eventRefs: legend.eventRefs,
    title: titleOf(legend, lookups),
    variants: [...legend.variants],
    homePlaceId: legend.homePlaceId,
    formedDay: legend.formedDay,
    grade,
    criteria,
    promotedBy: 'rule',
  };
}
