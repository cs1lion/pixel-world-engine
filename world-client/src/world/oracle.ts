/** 神谕解析：把一句话收敛到世界认识的几个动词。
 *
 * 这是世界自己的意图路由器，不是 LLM。真实助理把结构化指令交给它；
 * 沙盒里用关键词兜底，任何认不出的输入都落到 unknown，世界不动。
 *
 * **只认祈使句，不认叙述。** 这是世界不撒谎的一半：如果一句闲聊也能让世界动起来，
 * 那世界就在替你做你没想到的决定。旧实现只要句子里出现「写」就派活，
 * 「这个 bug 怎么写都不对」会真的派一个写作活——那是误伤。
 *
 * 判定分两步：
 *   1. 先排除明显不是命令的句子：疑问、否定、叙述。
 *   2. 再看句首是不是祈使动词（可带「帮我 / 请 / 麻烦」这类礼貌前缀）。
 *
 * 这套判定与造物 / 神迹两个解析器共用 `imperative.ts`：三条通道对
 * 「这句话是不是命令」只能有一个口径，否则同一句话在不同通道里会有
 * 不同结论，接 LLM 时尤其致命。
 */

import type { OracleIntent, TaskKind, Weather } from './types.ts';
import { hasNegation, hasNarrativeMarker, isImperative, isQuestion } from './imperative.ts';

interface Rule {
  readonly kind: TaskKind;
  readonly words: readonly string[];
}

/** 顺序即优先级：先认「交付」，再认世界法则，最后认活。 */
const COMPLETE_WORDS = ['完成', '交付', '收工', 'done', 'finish', 'complete'];
const RAIN_WORDS = ['下雨', '降雨', '落雨', 'rain'];
const CLEAR_WORDS = ['放晴', '雨停', '天晴', '出太阳', 'clear'];
/** 暴雨要先于「下雨」判：`暴` 打头的句子不会命中 RAIN_WORDS，但顺序仍要摆对。 */
const STORM_WORDS = ['暴雨', '大雨', '雷雨', '刮风下雨', 'storm'];
/** 撤销排队中的神谕；只撤等待队列，不动正在干的活。 */
const CANCEL_WORDS = ['撤销', '取消', 'cancel', 'undo'];
/**
 * 拨潮水。只认两个固定短语，不给数值——「涨到 0.37」这种话是白名单命令
 * 该管的事（#6），规则词表这一层只做「听得懂的那几句」。
 */
const TIDE_RISE_WORDS = ['涨潮', '涨水', '满潮'];
const TIDE_FALL_WORDS = ['退潮', '退水', '落潮'];
/** 拨住多久。够看见，又不至于让人以为潮汐坏了。 */
const TIDE_HOLD_MS = 60_000;
/** 短活必须「顺手」打头：句中顺带提到「简单」不算短活，也抢不走长活的词。 */
const QUICK_PREFIXES = ['顺手', '随便', '简单', '小事'];

/** 句首的祈使动词。只有出现在**开头**才算命令。 */
const IMPERATIVE_VERBS: readonly string[] = [
  // 中文
  '写', '查', '搜', '整理', '研究', '调研', '做', '跑', '爬', '抓',
  // 英文
  'write', 'search', 'research', 'draft', 'find', 'run', 'build', 'make',
];

const TASK_RULES: readonly Rule[] = [
  { kind: 'code', words: ['代码', '写码', '脚本', '程序', '爬虫', '编程', 'code', 'script'] },
  { kind: 'research', words: ['查', '搜', '资料', '研究', '调研', 'search', 'research'] },
  { kind: 'writing', words: ['写', '文稿', '便笺', '整理', '草稿', '稿', 'write', 'draft'] },
];

export type OracleAction =
  | OracleIntent
  | { readonly kind: 'weather'; readonly weather: Weather }
  /** 拨潮水。同样是有期限的覆盖，不是"设潮位"。 */
  | { readonly kind: 'tide'; readonly level: number; readonly durationMs: number };

export function parseOracle(raw: string): OracleAction {
  const text = raw.trim();
  if (text.length === 0) return { kind: 'unknown', raw };
  const lower = text.toLowerCase();

  // 世界法则与「交付 / 撤销」是固定短语。**命中词必须打头。**
  //
  // 为什么不能只靠「排除问句」：`isQuestion` 只认句尾问号与疑问词打头，
  // 挡不住「命令里顺带提到」——实测这四句都被误判过：
  //   「查一下下雨的历史数据」→ 判成 weather（用户其实在派查资料的活）
  //   「帮我写一份完成报告」  → 判成 complete（收了一张根本没在手上的单）
  //   「先别取消排队」        → 判成 cancelPending（否定句被当成命令执行）
  //   「will it rain tomorrow」→ 判成 weather
  // 这类误判改的是世界本身（改天气、收单），比漏判危险得多。
  //
  // 打头判定是**主防线**；问句与叙述排除留着做第二道——有些合法的打头句仍
  // 不是命令（「下雨了吗」以「下雨」打头但是提问），两道一起才够。
  //
  // 可打头判定挡不住「打头的否定句」：「撤销别撤错单」确实以「撤销」打头，
  // 但它是在说别做错，不是在下命令。所以 `commandLeads` 比 `leads` 多查一道
  // 否定词——天气三档、撤销、潮汐两端这**六处**，加上 `parseTideLevel` 那道
  // 共七处，实测漏的后果：「撤销别撤错单」「取消别取消错了」都会真的撤掉
  // 等待队列。上面「先别取消排队」那条说的就是这一类误判，而打头规则只修好了
  // 它句首的那半句，没修好句中是否定。
  //
  // 查的是 `hasNegation` 而不是 `hasNarrativeMarker`：后者混着过去时，
  // 「撤销刚才那条」是句正常命令，不能因为它含「刚才」就拦掉。
  //
  // **`complete` 不走 `commandLeads`，走 `taskLeads`。** 它与短活、派活那两处
  // 一样查整份叙述表（28 个标记，含过去时与「真累/很烦」这类评价收尾）。
  // 理由有两条：一是收单改世界（攒神恩点、记交付、回执），和另两处同级；
  // 二是「交付已经交了」这种句子是在陈述，不是在下令，拿它收单等于替玩家
  // 宣布一件他没说的事。`hasNegation` 那四个词是 `NON_IMPERATIVE_MARKERS` 的
  // 子集，所以 `taskLeads` 一并挡住了否定句，不会把上面那批放回来。
  //
  // 这里曾把 `complete` 也改成 `commandLeads`——`37654f0` 那句「`complete` 与
  // 短活那两处本来就带着叙述排除，这五处漏了」是错的：它自己的 diff 就把
  // `complete` 从 `leads && !hasNarrativeMarker` 挪上了 `commandLeads`，
  // 叙述排除当场没了。作者以为没动，实测放进来六句改世界的：
  // 「交付已经交了」「交付之前先说一声」「完成总是拖到最后」「交付昨天就交了」
  // 「完成一直没交」「交付真累」——全部真的交付、faith 0→1。
  // 已回退并留此注：`taskLeads` 就是挪走之前那一式。
  const leads = (words: readonly string[]): boolean =>
    words.some((word) => lower.startsWith(word));
  const commandLeads = (words: readonly string[]): boolean =>
    leads(words) && !isQuestion(lower) && !hasNegation(lower);
  /** 任务三道（交付/短活/派活）另外还查整份叙述表：过去时与评价收尾也不收单。 */
  const taskLeads = (words: readonly string[]): boolean =>
    leads(words) && !hasNarrativeMarker(lower);

  if (taskLeads(COMPLETE_WORDS)) return { kind: 'complete' };
  if (commandLeads(CLEAR_WORDS)) {
    return { kind: 'weather', weather: 'clear' };
  }
  // 暴雨先判：它的词里也有「下雨」，但落到的档不同。
  if (commandLeads(STORM_WORDS)) {
    return { kind: 'weather', weather: 'storm' };
  }
  if (commandLeads(RAIN_WORDS)) {
    return { kind: 'weather', weather: 'rain' };
  }
  if (commandLeads(CANCEL_WORDS)) {
    return { kind: 'cancelPending' };
  }
  // 拨潮水。满潮 1、退到底 0——两个端点，不给中间值。
  // 带参数的拨潮：只认「涨潮 0.4 / 潮位 40% / 潮位 0.4」这类明确写法。
  // 先把带参数的说完，再落到两个干净的端点命令上。
  const tideLevel =
    isQuestion(lower) || hasNegation(lower) ? null : parseTideLevel(lower);
  if (tideLevel !== null) {
    // NaN = 说的是潮位，但没给出能用的数（「涨潮到五米」）。用句子里那个数
    // 拼一条越界命令，让世界照实拒绝——不要把它当成干净的「涨潮」执行。
    const level = Number.isNaN(tideLevel)
      ? (chineseAmount(lower) ?? 5)
      : tideLevel;
    return { kind: 'tide', level, durationMs: TIDE_HOLD_MS };
  }
  if (commandLeads(TIDE_RISE_WORDS) && !hasAmount(lower)) {
    return { kind: 'tide', level: 1, durationMs: TIDE_HOLD_MS };
  }
  if (commandLeads(TIDE_FALL_WORDS) && !hasAmount(lower)) {
    return { kind: 'tide', level: 0, durationMs: TIDE_HOLD_MS };
  }

  // 短活：句首就是「顺手 / 随便」这类，本身就是祈使，不必再套动词表。
  if (QUICK_PREFIXES.some((word) => lower.startsWith(word)) && !hasNarrativeMarker(lower)) {
    return { kind: 'dispatch', taskKind: 'quick', summary: text };
  }

  // 其余派活必须先是祈使句。
  if (!isImperative(lower, IMPERATIVE_VERBS)) return { kind: 'unknown', raw };

  for (const rule of TASK_RULES) {
    // 关键词仍要出现（决定**派哪类活**），但「是不是命令」已由 isImperative 判过。
    if (rule.words.some((word) => lower.includes(word))) {
      return { kind: 'dispatch', taskKind: rule.kind, summary: text };
    }
  }
  return { kind: 'unknown', raw };
}

/**
 * 句子里有没有一个具体的量。
 *
 * 只用来区分「涨潮」与「涨潮到五米」。后者带了一个世界没有的参数，**必须被拒**，
 * 而不是被 `startsWith` 读成干净的「涨潮」：那等于把一句做不到的话悄悄当成
 * 另一件事执行，回执照样说成功。
 */
function hasAmount(lower: string): boolean {
  return /[0-9]/.test(lower) || /米|度|成|级|分|秒|分钟/.test(lower);
}

/**
 * 「潮位 0.4」「潮位 40%」「涨潮 0.4」这类明确给了 0..1 的写法。
 *
 * **必须以拨潮的词打头**，与另外几条世界法则同一个纪律：句中顺带提到潮位的话
 * （「查一下潮位 40 的历史」）不是改潮水的命令。只认显式数值，不把「涨潮」
 * 本身读成一个数。
 *
 * 返回 `NaN` 表示「说的是潮位，但没有给出一个 0..1 的数」——例如「涨潮到五米」。
 * 它会被翻成一条越界命令，由世界照实拒绝并给出原因，而不是掉进「规则认不出，
 * 正在问模型」：既然它带着世界没有的参数，就不该再去问模型要一个数值。
 */
function parseTideLevel(lower: string): number | null {
  const prefix = /^(?:潮位|水位|涨潮|涨水|满潮|退潮|退水|落潮)(.*)$/.exec(lower);
  if (prefix === null) return null;
  const matched = /^\s*(?:到|调到|设为)?\s*([0-9]+(?:\.[0-9]+)?)\s*(%|％)?/.exec(prefix[1]!);
  // 没给出数：后面也没有任何量，那就是干净的「涨潮 / 退潮」，交给端点命令。
  // 只有带着量却说不出一个可用数值时，才算「说了做不到的事」。
  if (matched === null) return hasAmount(prefix[1]!) ? Number.NaN : null;
  const value = Number.parseFloat(matched[1]!);
  if (!Number.isFinite(value)) return Number.NaN;
  return matched[2] === undefined ? value : value / 100;
}

/** 中文数字。只到「十」，够读「涨潮到五米」这类说法。 */
const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 「五米」写成数字再去拒，用户才在回执里看到自己说的那个数。 */
function chineseAmount(lower: string): number | null {
  const matched = /([零一二两三四五六七八九十]+)\s*(?:米|度|成|级)/.exec(lower);
  if (matched === null) return null;
  const digits = matched[1]!;
  if (digits.length === 1) return CHINESE_DIGITS[digits] ?? null;
  // 只处理「十X」「X十」，不假装看懂任意中文数词。
  if (digits.startsWith('十')) return 10 + (CHINESE_DIGITS[digits.slice(1)] ?? 0);
  if (digits.endsWith('十')) return (CHINESE_DIGITS[digits[0]!] ?? 0) * 10;
  return CHINESE_DIGITS[digits[0]!] ?? null;
}
