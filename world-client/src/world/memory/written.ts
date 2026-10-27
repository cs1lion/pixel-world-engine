/** 书面：信件与日记。五类通道里保真度最高的一条。
 *
 * 补充设计 §3.2 A 给这一行的定义是：
 *
 * | 通道 | 谁读 | 延迟 | 保真 | 容量 | 权限 |
 * | 书面 | 去档案室/邮局主动查阅 | 慢（跨天） | **最高，持久（不随跳数衰减）** | 单封信 1 条；单本日记 3 条/天 | 信件：发件人与收件人；日记：仅本人 |
 *
 * 「不随跳数衰减」是这一整条通道存在的理由。口耳相传每跳丢一级细节、打八折
 * 可信度（`retell`），三跳之后基本只剩一句「听说出事了」。写字是唯一能
 * 把一条断言原样留给后人的办法——所以这里**一次都不调 `retell`**。
 *
 * 写下来的东西也不能凭空多出内容：一封信只能装**写信人自己相信的**断言，
 * 一本日记只能装**写日记的人自己亲历的**记忆。这个约束由签名表达——
 * 两个函数都要调用方把 `Claim` / `MemoryEntry` 递进来，而不是让这里去库里捞。
 * 想塞一条不属于他的断言，得先伪造一个 `Claim`，而那要改 `createClaimFrom`。
 *
 * 这一层不调模型，也不读全局状态。它只回答「这个人能不能写下这条」与
 * 「这个人能不能读到」。
 */

import type { MemoryConfig } from './config.ts';
import type { Claim, MemoryEntry } from './types.ts';

/** 一条写下来的记录。信件与日记共用这个形状。 */
export interface WrittenRecord {
  readonly recordId: string;
  readonly kind: 'letter' | 'diary';
  readonly authorId: string;
  /** 日记为 `null`——没有收件人，只有作者自己。 */
  readonly recipientId: string | null;
  readonly claims: readonly Claim[];
  readonly writtenDay: number;
  readonly placeId: string;
}

/**
 * 写一封信。**一封信一条断言**（`letterClaims`）。
 *
 * 多出来的断言不会被悄悄丢掉，而是让整封信写不成——返回 `null`。
 * 这个选择是有意的：静默截断会让写信的人以为三条都寄出去了。宁可让他
 * 分三封寄，也不要世界替他做主删掉两条。
 */
export function writeLetter(input: {
  readonly recordId: string;
  readonly authorId: string;
  readonly recipientId: string;
  readonly claims: readonly Claim[];
  readonly day: number;
  readonly placeId: string;
  readonly config: MemoryConfig;
}): WrittenRecord | null {
  if (input.claims.length === 0) return null;
  if (input.claims.length > input.config.letterClaims) return null;
  // 信只能寄给自己相信的东西。秘密可以写，但它仍然是秘密——
  // 阅读权限由 `canRead` 按收件人判，不在这里放宽。
  return {
    recordId: input.recordId,
    kind: 'letter',
    authorId: input.authorId,
    recipientId: input.recipientId,
    claims: [...input.claims],
    writtenDay: input.day,
    placeId: input.placeId,
  };
}

/**
 * 写今天的日记。**一天最多 `diaryClaimsPerDay` 条**。
 *
 * 与信件不同，超出的条目在这里是**截断**而不是拒写——日记本来就不是
 * 「一封信一个主题」，它是「今天记住的几件事」。截断按显著度降序取前 N，
 * 同分按 memoryId 排（确定性）。
 *
 * 只收 `sourceMode === 'witnessed'` 的条目：日记记的是**亲历**。听来的
 * 东西写在日记里，第二天自己读回来就会当成亲历——那是一条伪造的记忆来源，
 * 而来源链正是这个世界唯一能追责的东西。
 */
export function writeDiary(input: {
  readonly recordId: string;
  readonly authorId: string;
  readonly entries: readonly MemoryEntry[];
  readonly day: number;
  readonly placeId: string;
  readonly config: MemoryConfig;
}): WrittenRecord | null {
  const mine = input.entries
    .filter(
      (entry) =>
        entry.holderId === input.authorId &&
        // 只收**片段**，不收摘要：摘要已经是这一天的抽象，再进日记就是同一件事
        // 写两遍。日记该是「今天发生的几件事」，摘要该是「今天大概是什么样」。
        entry.kind === 'episodic' &&
        entry.sourceMode === 'witnessed' &&
        entry.createdDay === input.day &&
        !entry.redacted,
    )
    .sort((a, b) => {
      if (a.salience !== b.salience) return b.salience - a.salience;
      return a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0;
    })
    .slice(0, Math.max(0, input.config.diaryClaimsPerDay));

  if (mine.length === 0) return null;
  return {
    recordId: input.recordId,
    kind: 'diary',
    authorId: input.authorId,
    recipientId: null,
    claims: mine.map(claimOfEntry),
    writtenDay: input.day,
    placeId: input.placeId,
  };
}

/**
 * 谁能读到这条记录。
 *
 * 日记只有本人。信件只有发件人与收件人。没有第三种人——「档案室谁都能进」
 * 是档案室那套权限的事，不是信件的。把两者混在一起，等于让每一封私信
 * 都默认公开。
 */
export function canRead(record: WrittenRecord, holderId: string): boolean {
  if (record.kind === 'diary') return record.authorId === holderId;
  return record.authorId === holderId || record.recipientId === holderId;
}

/**
 * 读到的东西。**原样返回，不 `retell`**——这就是「不随跳数衰减」。
 *
 * 读到的断言 `hop` 归零：对读的人来说它是新的，但他读的不是传言，
 * 是一份文件。所以它的细节层级与可信度都保持写信那一刻的样子。
 *
 * 读不到返回空数组，不返回 `null`：调用方不必区分「没有这条记录」与
 * 「这条记录不归你读」——两种情况下他看到的都是什么都没有。
 */
export function readRecord(record: WrittenRecord, holderId: string): readonly Claim[] {
  if (!canRead(record, holderId)) return [];
  return record.claims.map((claim) => ({ ...claim, hop: 0 }));
}

/** 一条记忆转成一条可以写下来的断言。 */
function claimOfEntry(entry: MemoryEntry): Claim {
  return {
    claimId: `written_${entry.memoryId}`,
    eventRefs: entry.eventRefs,
    content: { ...entry.content, who: [...entry.content.who] },
    // 亲历的可信度就是记忆本身的可信度；日记不会让它更可信，也不会更不可信。
    confidence: entry.confidence,
    hop: 0,
    sourceChain: [{ holderId: entry.holderId, claimId: `written_${entry.memoryId}`, hop: 0 }],
    originHolderId: entry.holderId,
    createdDay: entry.createdDay,
    secret: false,
    distortedBy: [],
  };
}
