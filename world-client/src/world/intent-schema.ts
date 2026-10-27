/** 意图 schema 与校验器：模糊输入与 LLM 之间的那道闸。
 *
 * **LLM 的入口有两个，这是管「一句话变成命令」的那一个**；另一个是
 * `creator-schema.ts`，管「一份 JSON 变成一座楼」（`SandboxScene` 的造物
 * 提示走它的 `parseCreationPlan`）。
 *
 * 这里原来写「LLM 接入的唯一入口」——不成立：`creator-schema.ts` 就是第二个，
 * 而下面还写着「前三条与 `creator-schema.ts` 同源」，同一段里自相矛盾。
 *
 * 模型读一句人话，输出一份 JSON，这里决定它能不能变成世界命令。
 *
 * 四条设计原则（前三条与 `creator-schema.ts` 同源）：
 *
 * 1. **只接受世界已有的动词。** 模型不能发明 `teleport` 或 `spawn_dragon`。
 *    动词表就是 `WorldCommand` 的投影，少一个它做不到，多一个世界不认。
 *
 * 2. **未知字段直接拒绝。** 模型多写 `confidence` / `explanation`，说明它对
 *    输出形状的理解已经偏了。静默丢掉会让它一直错下去。
 *
 * 3. **`kind: 'unknown'` 是**一等公民**，不是失败。** 听不出意图时，模型必须
 *    能诚实地说"我不知道"，而不是硬猜一个最像的。世界宁可不动，也不替用户
 *    做他没说的事——这条与 `speak()` 的祈使判定是同一条原则的两端：
 *    规则侧靠拒绝闲聊来守，模型侧靠允许 unknown 来守。
 *
 * 4. **只管形状，不管可行性。** "这栋楼能不能建""这个人忙不忙""迷雾揭没揭"
 *    都由世界自己判（`checkPlacement` / `dispatch` 的拒绝理由）。这里只回答
 *    "这份 JSON 是不是一份合法的意图"。
 *
 * 与规则解析器的关系：**规则优先，模型兜底**。`parseOracle*` 认得出就不调模型，
 * 认不出才问。这样既有离线可跑、可测的确定性，又不会因为模型抖动而改变
 * 已经能被规则稳定识别的那部分行为。
 */

import type { CarryItem, GridPoint, TaskKind, Weather } from './types.ts';
import type { MiracleKind } from './oracle-miracle.ts';
import type { PrefabBlueprint } from './types.ts';
import { isCarryItem } from './gate.ts';
import { TIDE_OVERRIDE_MAX_MS } from './tide.ts';

/** 模型能表达的意图种类。与 `WorldCommand` 一一对应，不多不少。 */
export type IntentKind =
  | 'dispatch'
  | 'complete'
  | 'cancelPending'
  | 'setWeather'
  | 'setTide'
  | 'build'
  | 'demolish'
  | 'miracle'
  | 'carry'
  | 'unknown';

export class IntentSchemaError extends Error {}

/** 校验后的意图。判别联合，取值域全部收窄过。 */
export type ParsedIntent =
  | { readonly kind: 'dispatch'; readonly taskKind: TaskKind; readonly summary: string }
  | { readonly kind: 'complete' }
  | { readonly kind: 'cancelPending' }
  | { readonly kind: 'setWeather'; readonly weather: Weather }
  /**
   * 拨一下潮水。**有期限**——`durationMs` 是命令的一部分，不是可选的注解。
   *
   * 潮汐同时是世界时钟：一条能永久按住它的命令，会让所有依赖它的确定性
   * 跟着松动（见 `tide.ts` 的 `TIDE_OVERRIDE_MAX_MS`）。
   */
  | { readonly kind: 'setTide'; readonly level: number; readonly durationMs: number }
  | { readonly kind: 'build'; readonly templateId: string; readonly at: GridPoint | null }
  /**
   * 拆一栋楼。**两个来源，两种说法，不能混着用**：
   *
   * - `instanceId`：指名道姓。模型/服务端给的就是这个，世界**只认那一栋**，
   *   找不到就拒绝——绝不改拆另一栋同模板的。
   * - `templateId`：用户只说了「拆掉抄书斋」。这是规则解析器的产物，世界按模板
   *   找，且必须**恰好一栋**；有两栋就得让用户说清是哪一栋，不替用户挑。
   *
   * 早先只有 `templateId`，服务端还把实例 id 降级成模板 id 再传——「拆 2 号楼」
   * 落到「拆第一栋抄书斋」，是替用户改了主意。
   */
  | { readonly kind: 'demolish'; readonly instanceId: string; readonly templateId?: never }
  | { readonly kind: 'demolish'; readonly templateId: string; readonly instanceId?: never }
  | { readonly kind: 'miracle'; readonly miracle: MiracleKind; readonly at: GridPoint | null }
  /**
   * 给谁什么凭证（渡有仪式，SPEC_V2 §4.6）。
   *
   * **按名字点人，不按 id。** 喂给模型的上下文里只有名字
   * （`intent-context.ts` 的 `busy` 是 `{name, taskKind}`），叫 id 就是
   * `demolish` 那个 bug 重演：模型手里没有 id 可填，只能编一个。
   * 名字重了怎么办是世界的事——它拒，不替用户挑。
   *
   * `carries` 是闭集，与区域声明的 `requires` 同一套词（`gate.ts`）。
   * 空数组是「让她放下手的一切」——整锅换上换成空，是说得出口的。
   * 它与「收走一件」是两句话，别混：后者走 `remove`。
   *
   * **给与收必须且只能给一个**，与 `demolish` 的 instanceId/templateId 同一条规矩。
   * 收走不是「给一个更短的清单」：世界那边 `setCarries` 是整锅换上，
   * 「收回她的鞋」若翻成 `carries: []`，会把她手里的灯一起拿走。
   * 所以收要走 `remove`——世界从她现有的里减。
   */
  | { readonly kind: 'carry'; readonly villager: string; readonly carries: readonly CarryItem[]; readonly remove?: never }
  | { readonly kind: 'carry'; readonly villager: string; readonly remove: readonly CarryItem[]; readonly carries?: never }
  /** 明确表示"没听懂"。带一句给用户看的说明。 */
  | { readonly kind: 'unknown'; readonly reason: string };

const TASK_KINDS: readonly TaskKind[] = ['code', 'research', 'writing', 'quick'];
const WEATHERS: readonly Weather[] = ['clear', 'rain', 'storm'];
const MIRACLES: readonly MiracleKind[] = ['light', 'tree', 'cat'];

/**
 * 每种意图允许的字段。
 *
 * `unknown` 只接受 `reason`——它没有目标可带，带了就是模型在自作主张。
 *
 * 导出来是为了一份守卫：`test/intent-contract.test.ts` 拿它跟服务端
 * `wire.py` 的 `ALLOWED_KEYS` 逐条比。两边各写一遍，「加一种意图时只改一边」
 * 就是用户看得见的漂——客户端放过的字段，服务端 502。
 */
export const ALLOWED_KEYS: Readonly<Record<IntentKind, readonly string[]>> = {
  dispatch: ['kind', 'taskKind', 'summary'],
  complete: ['kind'],
  cancelPending: ['kind'],
  setWeather: ['kind', 'weather'],
  setTide: ['kind', 'level', 'durationMs'],
  build: ['kind', 'templateId', 'at'],
  // 两个键都在表里，但**必须且只能给一个**：见 `demolish` 的两种形状。
  demolish: ['kind', 'instanceId', 'templateId'],
  miracle: ['kind', 'miracle', 'at'],
  // 四个键都在表里，但 carries 与 remove **必须且只能给一个**：
  // 给是整锅换上，收是从现有的里减。混着给，世界不知道该照哪句办。
  carry: ['kind', 'villager', 'carries', 'remove'],
  unknown: ['kind', 'reason'],
};

/**
 * 校验一份意图。
 *
 * `templates` 是允许的模板表：模型不能发明新建筑。
 * `worldSize` 用来判坐标在不在界内；能不能建是 `checkPlacement` 的事。
 */
export function parseIntent(
  raw: unknown,
  templates: ReadonlyMap<string, PrefabBlueprint>,
  worldSize: { readonly width: number; readonly height: number },
): ParsedIntent {
  const fail = (why: string): never => {
    throw new IntentSchemaError(why);
  };

  if (!isRecord(raw)) fail('意图必须是对象');
  const record = raw as Record<string, unknown>;

  const kind = record.kind;
  if (typeof kind !== 'string' || !(kind in ALLOWED_KEYS)) {
    fail(`未知意图 "${String(kind)}"：可选 ${Object.keys(ALLOWED_KEYS).join(' / ')}`);
  }
  const intentKind = kind as IntentKind;

  // 先查未知字段：它最能暴露"模型以为世界有这个世界没有的能力"。
  const allowed = ALLOWED_KEYS[intentKind];
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      fail(
        `意图 "${intentKind}" 不接受字段 "${key}"：只接受 ${allowed.join(' / ')}`,
      );
    }
  }

  switch (intentKind) {
    case 'dispatch': {
      const taskKind = readOneOf(record.taskKind, TASK_KINDS, 'taskKind', fail);
      const summary = readNonEmpty(record.summary, 'summary', fail);
      return { kind: 'dispatch', taskKind, summary };
    }
    case 'complete':
      return { kind: 'complete' };
    case 'cancelPending':
      return { kind: 'cancelPending' };
    case 'setWeather':
      return { kind: 'setWeather', weather: readOneOf(record.weather, WEATHERS, 'weather', fail) };
    case 'setTide': {
      const level = readNumber(record.level, 'level', fail);
      // 取值域与上限都在这里判：模型不该有机会让世界收到一条越界命令。
      // 具体的错误说法由世界那条路（`setTideLevel`）再说一次，这里只挡形状。
      if (level < 0 || level > 1) fail(`level 必须在 0..1，收到 ${level}`);
      const durationMs = readNumber(record.durationMs, 'durationMs', fail);
      if (durationMs <= 0) fail('durationMs 必须是正数毫秒');
      if (durationMs > TIDE_OVERRIDE_MAX_MS) {
        fail(`durationMs 最多 ${TIDE_OVERRIDE_MAX_MS}——再久就成了夺权，不只是拨一下`);
      }
      return { kind: 'setTide', level, durationMs };
    }
    case 'build':
      return {
        kind: 'build',
        templateId: readTemplate(record.templateId, templates, fail),
        at: readPoint(record.at, worldSize, fail),
      };
    case 'demolish': {
      // 实例 id 是**不透明字符串**：注册表里没有它，世界才判它存不存在。
      // 模板 id 反过来要查注册表——模型不能发明建筑。
      const instanceId = readOptionalNonEmpty(record.instanceId, 'instanceId', fail);
      const templateId =
        record.templateId === undefined
          ? null
          : readTemplate(record.templateId, templates, fail);
      if (instanceId !== null && templateId !== null) {
        fail('demolish 只接受 instanceId 或 templateId 之一，不能同时给');
      }
      if (instanceId === null && templateId === null) {
        fail('demolish 需要 instanceId（指名道姓）或 templateId（按模板拆）');
      }
      return instanceId !== null
        ? { kind: 'demolish', instanceId }
        : { kind: 'demolish', templateId: templateId as string };
    }
    case 'miracle':
      return {
        kind: 'miracle',
        miracle: readOneOf(record.miracle, MIRACLES, 'miracle', fail),
        at: readPoint(record.at, worldSize, fail),
      };
    case 'carry': {
      const villager = readNonEmpty(record.villager, 'villager', fail);
      const hasCarries = 'carries' in record;
      const hasRemove = 'remove' in record;
      // 两条路只能走一条，与 `demolish` 的 instanceId/templateId 同一条规矩。
      if (hasCarries && hasRemove) {
        fail('carry 只能给 carries 或 remove 之一，不能同时给');
      }
      if (!hasCarries && !hasRemove) {
        fail('carry 需要 carries（给她什么）或 remove（收走什么）');
      }
      return hasRemove
        ? { kind: 'carry', villager, remove: readCarryList(record.remove, 'remove', fail) }
        : { kind: 'carry', villager, carries: readCarryList(record.carries, 'carries', fail) };
    }
    case 'unknown':
      return { kind: 'unknown', reason: readNonEmpty(record.reason, 'reason', fail) };
  }
}

/**
 * 凭证清单：必须是数组，且每一件都在 `gate.ts` 的闭集里。
 *
 * 「没给」和「给错了」是两句话，不并成一句：前者是漏了字段，
 * 后者是填了世界上不存在的东西。合成一句，用户明明什么都没填，
 * 却收到「必须是数组」——那句话是假的，比不报更糟。
 * 服务端 `rules/schema.py` 的 `_villager_carry` 也是这么分的。
 *
 * 闭集在**这儿**就挡掉，不等世界再答一遍：模型不该有机会让世界收到
 * 一个世界上不存在的东西。逐件查，不整锅端——部分接受比整条拒更难查。
 *
 * `carries` 可以是空数组（「让她两手空空」）；`remove` 不行——一件都不收，
 * 那句话就是没说话，该让用户把话说完，而不是记一次什么都没发生的收缴。
 */
function readCarryList(
  value: unknown,
  field: string,
  fail: (why: string) => never,
): readonly CarryItem[] {
  if (!Array.isArray(value)) fail(`${field} 必须是数组`);
  const out: CarryItem[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'string' || !isCarryItem(item)) {
      fail(`${field} 的 "${String(item)}" 不是这个世界上认得的凭证：可选 lamp / shoes`);
    }
    out.push(item);
  }
  if (field === 'remove' && out.length === 0) {
    fail('remove 至少要有一件：一件都不收，那句话就是没说话');
  }
  return out;
}

function readOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  fail: (why: string) => never,
): T {
  if (typeof value !== 'string') fail(`${field} 必须是字符串`);
  if (!(allowed as readonly string[]).includes(value as string)) {
    fail(`${field} 的 "${String(value)}" 不在取值域里：可选 ${allowed.join(' / ')}`);
  }
  return value as T;
}

/** 数字字段。整数与小数都收——潮位是 0..1 的连续量。 */
function readNumber(
  value: unknown,
  field: string,
  fail: (why: string) => never,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} 必须是数字`);
  }
  return value as number;
}

function readNonEmpty(
  value: unknown,
  field: string,
  fail: (why: string) => never,
): string {
  if (typeof value !== 'string') fail(`${field} 必须是字符串`);
  const text = (value as string).trim();
  if (text === '') fail(`${field} 不能为空`);
  return text;
}

/** 可省略的非空字符串：省略是 `null`，给了就必须有内容。 */
function readOptionalNonEmpty(
  value: unknown,
  field: string,
  fail: (why: string) => never,
): string | null {
  if (value === undefined) return null;
  return readNonEmpty(value, field, fail);
}

/**
 * 模板 id 必须是注册表里有的。
 *
 * 与 `creator-schema.ts` 的差别：那边要求 `at` 必填（造物模式里玩家已经选好位置），
 * 这里允许省略——「建个工坊」没说建在哪，由世界挑，那是世界的判断不是模型的。
 */
function readTemplate(
  value: unknown,
  templates: ReadonlyMap<string, PrefabBlueprint>,
  fail: (why: string) => never,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('templateId 必须是非空字符串');
  }
  const templateId = (value as string).trim();
  if (!templates.has(templateId)) {
    fail(`未知模板 "${templateId}"：可选 ${[...templates.keys()].join(' / ')}`);
  }
  return templateId;
}

/** 坐标可省略（null/undefined 都算省略）；给了就必须在界内。 */
function readPoint(
  value: unknown,
  worldSize: { readonly width: number; readonly height: number },
  fail: (why: string) => never,
): GridPoint | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail('at 必须是 { x, y } 或省略');

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'x' && key !== 'y') fail(`at 不接受字段 "${key}"`);
  }
  const x = record.x;
  const y = record.y;
  if (typeof x !== 'number' || !Number.isInteger(x)) fail('at.x 必须是整数格坐标');
  if (typeof y !== 'number' || !Number.isInteger(y)) fail('at.y 必须是整数格坐标');

  const px = x as number;
  const py = y as number;
  // 只判"在不在世界范围里"。能不能建（迷雾、占地、留白、门口）由 checkPlacement 判。
  if (px < 0 || py < 0 || px >= worldSize.width || py >= worldSize.height) {
    fail(
      `at (${px}, ${py}) 在世界之外：范围是 0..${worldSize.width - 1} × 0..${worldSize.height - 1}`,
    );
  }
  return { x: px, y: py };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
