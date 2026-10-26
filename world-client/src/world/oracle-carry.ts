/** 把一句神谕变成**交接意图**：「给汐一盏灯」「把灯给汐」「收走汐的鞋」。
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
 * **只认祈使。** 动词得在句首（「收走汐的灯」）或在「把」之后
 * （「把汐的灯收走」）。少了这一条，「汐收走了莞尔的鞋」——一句纯粹的叙述，
 * 没有在命令任何人——会把她的兜掏空。世界只能被命令改变，这句话没有在命令谁。
 *
 * **这个名字不在这里核对。** 离线规则没有角色名册，它只负责把「汐」这两个字
 * 从句子里取出来。取出来的名字世界上有没有、是不是指着两个人，由
 * `villagerNamed` 在结算时说——所以「给她一盏灯」会被老实拒掉，
 * 而不是猜一个最近的居民。
 */

import type { CarryItem } from './types.ts';
import { hasNarrativeMarker, isQuestion, stripLeadIns } from './imperative.ts';

/**
 * 交接意图：给她什么，或从她手里收走什么。
 *
 * 两个方向分成两个形状，不共用一个可选字段。这里**两个键都真的只存在于
 * 一边**，所以 `'remove' in intent` 是靠得住的判别。
 *
 * 别把这个结论搬到 `ParsedIntent`（`intent-schema.ts`）上去：那边为了
 * 让四个键都进 `ALLOWED_KEYS`，两个成员各带一个 `?: never`。在那种联合上
 * `'remove' in intent` 判完仍然可能 `undefined`（tsc 报 TS18048），
 * 只有 `intent.remove !== undefined` 能用。同一件事，两种形状，两种写法——
 * 实测过的，不是推的。
 */
export type CarryIntent =
  | { readonly villager: string; readonly carries: readonly CarryItem[] }
  | { readonly villager: string; readonly remove: readonly CarryItem[] };

/**
 * 凭证的说法。长的优先匹配：「一盏灯」不该被「灯」抢先切碎。
 *
 * 与 `CARRY_ITEMS`（`gate.ts`）是同一套词的两种语言：那边是世界的机制，
 * 这边是人嘴里的说法。加一种凭证时两边都要加——`oracle-carry.test.ts`
 * 拿 `CARRY_WORDS` 跟 `CARRY_ITEMS` 逐种比，只改一边就红。
 */
export const CARRY_WORDS: readonly { readonly kind: CarryItem; readonly words: readonly string[] }[] = [
  { kind: 'lamp', words: ['一盏灯', '一盏灯吧', '这盏灯', '那盏灯', '灯'] },
  { kind: 'shoes', words: ['一双鞋', '一双鞋吧', '这双鞋', '那双鞋', '鞋'] },
];

/** 收走：同一个动作的反方向， verbs 一样，只是不给东西。 */
const TAKE_WORDS: readonly string[] = ['收走', '收回', '缴了', '没收', '拿走'];

/**
 * 句首的祈使动词。**长的在前**：「送给」不能被「送」抢先切掉一个字，
 * 切了收件人就少一个。「递」「交」同理。
 *
 * 一份表，三处用它：句首判定、切多长、句子里找动词。加一个字不用改三处。
 */
const GIVE_VERBS: readonly string[] = ['送给', '递给', '交给', '赏给', '给', '送', '递', '交', '赏'];

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

  // 收走先说：「收走汐的鞋」里也有「鞋」这个词，
  // 顺着给的形状切会把「汐的」当成收件人。
  return takeOf(body) ?? giveOf(body);
}

/** 「收走汐的灯」与「把汐的灯收走」。 */
function takeOf(body: string): CarryIntent | null {
  // 动词打头。这是**唯一**的祈使形状——动词不在句首就不是命令，
  // 「汐收走了莞尔的鞋」说的是已经发生的事，不是在让她交出来。
  const head = TAKE_WORDS.find((word) => body.startsWith(word));
  if (head !== undefined) {
    const rest = body.slice(head.length);
    const found = SORTED_WORDS.find((entry) => rest.includes(entry.word));
    if (found === undefined) return null;
    // 那件东西先从这半句里抹掉再取名字：不抹的话「汐的灯」里名字就成了「汐的灯」。
    return named(firstNameOf(rest.replace(found.word, ' ')), [], [found.kind]);
  }

  // 东西打头：「把汐的灯收走」。动词在句尾，所以「把」打头也算祈使。
  const handed = new RegExp(`^把(.+?)(${TAKE_WORDS.join('|')})`).exec(body);
  if (handed === null) return null;
  const found = SORTED_WORDS.find((entry) => (handed[1] ?? '').includes(entry.word));
  if (found === undefined) return null;
  return named(firstNameOf((handed[1] ?? '').replace(found.word, ' ')), [], [found.kind]);
}

/** 「给汐一盏灯」与「把一盏灯给汐」。 */
function giveOf(body: string): CarryIntent | null {
  // 动词打头：「给汐一盏灯」「递给汐一双鞋」。
  const head = GIVE_VERBS.find((verb) => body.startsWith(verb));
  if (head !== undefined) {
    const rest = body.slice(head.length);
    const found = SORTED_WORDS.find((entry) => rest.endsWith(entry.word));
    if (found === undefined) return null;
    return named(firstNameOf(rest.slice(0, rest.length - found.word.length)), [found.kind], []);
  }

  // 东西打头：「把一盏灯给汐」。动词不在句首，得从句子当中找。
  const hand = firstGiveAt(body);
  if (hand === null) return null;
  const item = body.slice(0, hand.at);
  const found = SORTED_WORDS.find((entry) => item.includes(entry.word));
  if (found === undefined) return null;
  return named(firstNameOf(body.slice(hand.at + hand.verb.length)), [found.kind], []);
}

/** 句子里第一个交接动词在哪儿、是哪个。 */
function firstGiveAt(body: string): { readonly at: number; readonly verb: string } | null {
  let best: { readonly at: number; readonly verb: string } | null = null;
  for (const verb of GIVE_VERBS) {
    const at = body.indexOf(verb);
    if (at === -1) continue;
    if (best === null || at < best.at) best = { at, verb };
  }
  return best;
}

/**
 * 没有收件人就不是交接。
 *
 * 「送灯」说的是给出去一件东西，没说给谁——那是半句话，不是命令。
 * 老实返回 null 让它落进 unknown，世界会问「说给谁」。猜一个最近的居民，
 * 就是把她的兜动了，而用户从没要求过。
 *
 * 给与收是两个方向：`gives` 是整锅换上，`takes` 是从现有的里减。
 * 两个数组里**永远只有一个非空**——动词表互不抢词（`takeOf` 先试，
 * 它认了就不走 `giveOf`）。真出现两个都非空，`takes` 优先：收是减法，
 * 给了又收不如当作没收，前者会把她其余的东西也换掉。
 */
function named(villager: string, gives: readonly CarryItem[], takes: readonly CarryItem[]): CarryIntent | null {
  if (villager.length === 0) return null;
  return takes.length > 0 ? { villager, remove: takes } : { villager, carries: gives };
}

/**
 * 从一段话里取名字：剥掉所有格与虚词，剩下的就是她。
 *
 * 这个字符类要一直**盖住** `GIVE_VERBS` 里的每个字，否则「把一盏灯给汐」
 * 的后半句会连动词一起当名字。改动词表时看一眼这里。
 */
function firstNameOf(text: string): string {
  return text
    .replace(/[的了和与及还有把被给送递交赏]/g, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .sort((a, b) => b.length - a.length)[0] ?? '';
}
