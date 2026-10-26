/** 把一句神谕变成**交接意图**：「给汐一盏灯」「把灯给汐」「收走她的鞋」。
 *
 * 这是渡有仪式（SPEC_V2 §4.6）在**离线**那一侧的嘴。此前那道门只有一个入口：
 * 模型的 `carry` 意图。没有 API Key 时 `matchRules` 认不出这句话，于是
 * 「给她一盏灯」落进 unknown——门还在，凭证给不出去，她一辈子进不去。
 * 一个只有模型能用的机制，等于离线世界里没有这个机制。
 *
 * 与 `oracle.ts` / `oracle-build.ts` / `oracle-miracle.ts` 的分工同构：
 * 那个认派活与天气，那两个认造房与神迹，这个认**把东西交到谁手里**。
 * 四张动词表互不抢词——「点灯」是神迹，「给汐一盏灯」是交接，
 * 差在有没有一个收件人。
 *
 * 只认祈使句：疑问与叙述不触发。与另外三个解析器同一套判定。
 *
 * **这个名字不在这里核对。** 离线规则没有角色名册，它只负责把「汐」这两个字
 * 从句子里取出来。取出来的名字世界上有没有、是不是指着两个人，由
 * `villagerNamed` 在结算时说——所以「给她一盏灯」会被老实拒掉，
 * 而不是猜一个最近的居民。
 */

import type { CarryItem } from './types.ts';
import { hasNarrativeMarker, isQuestion, stripLeadIns } from './imperative.ts';

export interface CarryIntent {
  /** 收件人。名字，不是 id——离线规则手里没有 id。 */
  readonly villager: string;
  /** 空数组是收走：两手空空。 */
  readonly carries: readonly CarryItem[];
}

/**
 * 凭证的说法。长的优先匹配：「一盏灯」不该被「灯」抢先切碎。
 *
 * 与 `CARRY_ITEMS` 是同一套词的两种语言：那边是世界的机制，这边是人嘴里的
 * 说法。加一种凭证时两边都要加，而 `intent-contract.test.ts` 盯着
 * `CARRY_ITEMS` 只有一处声明。
 */
const CARRY_WORDS: readonly { readonly kind: CarryItem; readonly words: readonly string[] }[] = [
  { kind: 'lamp', words: ['一盏灯', '一盏灯吧', '那盏灯', '灯'] },
  { kind: 'shoes', words: ['一双鞋', '一双鞋吧', '那双鞋', '鞋'] },
];

/** 收走：同一个动作的反方向， verbs 一样，只是不给东西。 */
const TAKE_WORDS: readonly string[] = ['收走', '收回', '缴了', '没收', '拿走'];

/** 句首的祈使动词。 */
const GIVE_VERBS: readonly string[] = ['给', '送', '递', '交', '赏'];

/** 句尾的语气与标点。切掉之后再比形状，否则「给汐一盏灯。」对不上。 */
const TRAILING = /[。！!，,、\s]+$/;

/** 把所有说法按长短排一遍，长的先试。 */
const SORTED_WORDS = [...CARRY_WORDS]
  .flatMap((entry) => entry.words.map((word) => ({ word, kind: entry.kind })))
  .sort((a, b) => b.word.length - a.word.length);

export function parseOracleCarry(raw: string): CarryIntent | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  const lower = text.toLowerCase();

  // 疑问与叙述不触发，与另外三个解析器同一道关。
  if (hasNarrativeMarker(lower) || isQuestion(lower)) return null;

  const body = stripLeadIns(lower).replace(TRAILING, '').trim();
  if (body.length === 0) return null;

  // 收走：先说，因为「收走她的鞋」里也有「鞋」这个词，
  // 顺着给的形状切会把「她的」当成收件人。
  for (const word of TAKE_WORDS) {
    const at = body.indexOf(word);
    if (at === -1) continue;
    // 整句里找那件东西，不能只在动词后头找：「收走汐的灯」东西在后，
    // 「把汐的灯收走」东西在前。只在后头找，后一种就什么也找不到。
    const found = SORTED_WORDS.find((entry) => body.includes(entry.word));
    if (found === undefined) continue;
    // 收件人写在动词前头（「收走汐的灯」）还是后头（「把汐的灯收走」）都认：
    // 两边各取一次，先问前头。取之前先把那件东西从这半句里抹掉——
    // 不抹的话「把汐的灯」里名字就成了「汐的灯」。
    const before = firstNameOf(body.slice(0, at).replace(found.word, ' '));
    const after = firstNameOf(body.slice(at + word.length).replace(found.word, ' '));
    return { villager: before || after, carries: [] };
  }

  // 给：两种语序。「给汐一盏灯」是动词打头，「把一盏灯给汐」是东西打头。
  return giveOf(body);
}

/** 从一段话里取名字：剥掉所有格与量词，剩下的就是她。 */
function firstNameOf(text: string): string {
  return text
    .replace(/[的了和与及还有把被给送递交赏]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .sort((a, b) => b.length - a.length)[0] ?? '';
}

/** 「给汐一盏灯」与「把一盏灯给汐」。 */
function giveOf(body: string): CarryIntent | null {
  // 东西打头：「把一盏灯给汐」。先认这种——它的动词不在句首。
  const handOver = /^把(.+?)(给|送给|递给|交给)(.+)$/.exec(body);
  if (handOver !== null) {
    const found = SORTED_WORDS.find((entry) => (handOver[1] ?? '').includes(entry.word));
    if (found !== undefined) {
      return { villager: firstNameOf(handOver[3] ?? ''), carries: [found.kind] };
    }
  }

  // 动词打头：「给汐一盏灯」「递给汐一双鞋」。
  if (!GIVE_VERBS.some((verb) => body.startsWith(verb))) return null;
  const rest = body.slice(firstVerbLength(body));
  const found = SORTED_WORDS.find((entry) => rest.endsWith(entry.word));
  if (found === undefined) return null;
  return { villager: firstNameOf(rest.slice(0, rest.length - found.word.length)), carries: [found.kind] };
}

/** 句首那个动词有多长。「递给」是两个字，「给」是一个。 */
function firstVerbLength(body: string): number {
  const longest = ['送给', '递给', '交给'].find((verb) => body.startsWith(verb));
  return longest?.length ?? 1;
}
