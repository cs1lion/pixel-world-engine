/** 祈使判定：一句话是不是在**命令**世界。
 *
 * 三个解析器（派活 / 造物 / 神迹）都要回答同一个问题：这句话是在下命令，
 * 还是在聊天？早先每个文件各写一份前缀表与叙述标记，加第四条通道时会变成四份。
 *
 * 这里收敛成一份。各解析器只提供自己的**动词表**，其余判定共用。
 *
 * 判定分三步：
 *   1. 剥掉句首的位置短语（「在 (32,14) ...」）
 *   2. 剥掉礼貌与承接前缀（「帮我」「再」）
 *   3. 句首是给定动词，且不含叙述标记、不以叙述主语开头
 */

import type { GridPoint } from './types.ts';

/**
 * 礼貌与承接前缀。
 *
 * 承接副词（再 / 继续 / 接着）也算：「再整理一份」是在下命令，不是叙述。
 */
export const POLITE_PREFIXES: readonly string[] = [
  '帮我', '帮忙', '麻烦', '请', '给我', '替我',
  '再', '继续', '接着', '顺便', '另外',
];

/** 明确不是命令的标记：疑问、否定、过去叙述、评价收尾。 */
export const NON_IMPERATIVE_MARKERS: readonly string[] = [
  // 疑问
  '？', '?', '吗', '呢', '要不要', '能不能', '可不可以', '是不是',
  // 否定
  '不用', '不要', '不必',
  // 过去/进行
  '昨天', '前天', '刚才', '之前', '已经', '一直', '老是', '总是',
  // 评价性收尾：写代码真累 / 查资料很烦
  '真累', '好累', '很累', '真烦', '好烦', '很烦', '有点累', '有点烦',
];

/**
 * 只在分句开头才算数的标记。
 *
 * 「别」是这张表里唯一的单字，也因此唯一会撞车：「特别」「识别」「级别」
 * 「差别」「别墅」都含一个不表否定的「别」。按整句查 substring，
 * 「特别整理一份报告」「识别这块地」会被判成叙述——而 `hasNarrativeMarker`
 * 是四个解析器（`oracle` / `oracle-build` / `oracle-carry` /
 * `oracle-miracle`）进门的第一道闸，一律直接返回 null。一句明明白白的
 * 命令就这么被吞掉，连「听不懂」都不问。
 *
 * 否定词「别」只可能站在分句的开头：「别建房子」「查一下，别查太旧的」。
 * 所以只在那里认它；落在别处的「别」证不明是否定，就不判。
 *
 * 收窄之后漏掉的那几种（「请别建」「先别建」）不会因此变成命令：剥掉礼貌
 * 前缀后句首是「别」而不是动词，`isImperative` 的动词表那一关照样拦得住。
 */
const BOUNDARY_ONLY_MARKERS: readonly string[] = ['别'];

/** 分句边界：否定词只在这些字符之后还算否定。 */
const CLAUSE_BOUNDARY = /^[\s，。；！？、,;!?]/;

/** 这句话含叙述标记吗。 */
export function hasNarrativeMarker(text: string): boolean {
  if (NON_IMPERATIVE_MARKERS.some((marker) => text.includes(marker))) return true;
  return BOUNDARY_ONLY_MARKERS.some((marker) => startsClause(text, marker));
}

/**
 * `marker` 有没有站在某个分句的开头：整句开头，或紧跟在一个标点之后。
 *
 * `at === 0` 必须先判——`slice(-1)` 会绕回去取到最后一个字符。
 */
function startsClause(text: string, marker: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(marker, from);
    if (at === -1) return false;
    if (at === 0 || CLAUSE_BOUNDARY.test(text.slice(at - 1))) return true;
    from = at + 1;
  }
}

/**
 * 纯疑问标记。
 *
 * 与 `NON_IMPERATIVE_MARKERS` 分开：世界法则（下雨 / 放晴）只关心
 * "是不是在问"，不关心"是不是过去时"——「昨天已经下雨了」不该改天，
 * 但那是靠叙述标记拦的，不是靠疑问标记。
 */
export const QUESTION_MARKERS: readonly string[] = [
  '？', '?', '吗', '呢', '要不要', '能不能', '可不可以', '是不是',
];

/** 句首的叙述主语：出现它就不是命令。 */
export const NARRATIVE_SUBJECTS: readonly string[] = [
  '我', '他', '她', '它', '这', '那', '这个', '那个',
];

/** 这句话是在提问吗。 */
export function isQuestion(text: string): boolean {
  return QUESTION_MARKERS.some((marker) => text.includes(marker));
}

/**
 * 这是一句命令吗。
 *
 * @param verbs 该解析器认的祈使动词（如「写 / 查」或「建 / 盖」）
 */
export function isImperative(text: string, verbs: readonly string[]): boolean {
  if (hasNarrativeMarker(text)) return false;

  const body = stripLeadIns(text);
  if (body.length === 0) return false;
  if (NARRATIVE_SUBJECTS.some((subject) => body.startsWith(subject))) return false;

  return verbs.some((verb) => body.startsWith(verb));
}

/**
 * 剥掉句首的成套开场白：位置短语与礼貌前缀可能以任意顺序叠加。
 *
 * 「在 (3,4) 帮我建」「帮我 在 (3,4) 建」都是命令，剥一轮不够——
 * 所以交替剥到不再变化。
 */
export function stripLeadIns(text: string): string {
  let body = text;
  for (let round = 0; round < 4; round += 1) {
    const next = stripPrefixes(stripLocation(body));
    if (next === body) break;
    body = next;
  }
  return body;
}

/**
 * 剥掉句首的位置短语：「在 (32,14)」「(32,14)」「32,14 那边」。
 *
 * 只剥句首那一处，不动句中的坐标——`readPoint` 仍从整句里找。
 */
export function stripLocation(text: string): string {
  return text
    .replace(/^\s*在?\s*\(?\d{1,3}\s*[,，]\s*\d{1,3}\)?\s*(那里|那边|这儿|这边)?\s*/, '')
    .replace(/^\s*在\s*/, '');
}

/** 剥掉礼貌与承接前缀。可能叠加（「麻烦帮我」），循环剥到不能再剥。 */
export function stripPrefixes(text: string): string {
  let body = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of POLITE_PREFIXES) {
      if (body.startsWith(prefix)) {
        body = body.slice(prefix.length).trim();
        changed = true;
      }
    }
  }
  return body;
}

/** 从句子里读坐标。认 `(32,14)`、`32,14`、全角括号与逗号。 */
export function readPoint(text: string): GridPoint | null {
  const matched = /(\d{1,3})\s*[,，]\s*(\d{1,3})/.exec(text);
  if (matched === null) return null;
  const x = Number(matched[1]);
  const y = Number(matched[2]);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  return { x, y };
}
