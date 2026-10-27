/** 隐私、删除与级联。
 *
 * 协议第 15 节。两件事：
 *
 * 1. **可见性**：`private_to_player` 的事件不写入任何单位记忆的明文，
 *    最多写入抽象化的 sanitized 版本；记忆继承事件的可见性；气泡、碑文等
 *    表现输出前再过一次脱敏。
 * 2. **删除级联**：`delete(root)` 沿 `derivedFrom` 与 `eventRefs` 找出所有
 *    派生物，一并清除；摘要里只含该事件的语句直接删，其余保留并标 `redacted`。
 *
 * 这一层是纯函数：吃一份库，返回一份新库与被删的清单。它不写日志、不发事件，
 * 调用方拿 `MemoryDeleted(root_id, counts)` 去发。
 *
 * **删除之后不得再被检索命中，也不得再次被整理写回。** 前一句靠过滤（检索
 * 跳过 `redacted`），后一句靠这里真的把条目拿掉——如果只打标记，下一次整理
 * 仍会从当日片段里把它压进摘要。
 */

import type { MemoryEntry, WorldFact } from './types.ts';

/** 一个根被删掉之后，连带清掉了什么。 */
export interface DeletionReport {
  readonly rootId: string;
  readonly entries: readonly MemoryEntry[];
  readonly removedMemoryIds: readonly string[];
  readonly redactedMemoryIds: readonly string[];
  readonly counts: {
    readonly memories: number;
    readonly summaries: number;
    readonly claims: number;
    readonly traces: number;
    readonly legends: number;
  };
}

/** 删除的根可以是事件、记忆或断言。 */
export type DeletionRoot =
  | { readonly kind: 'event'; readonly id: string }
  | { readonly kind: 'memory'; readonly id: string }
  | { readonly kind: 'claim'; readonly id: string };

/**
 * 一条事件的可见性能不能进某个单位的记忆。
 *
 * `private_to_player` 不写明文；`sanitized` 只能写脱敏版本；`world` 随便。
 * 返回值是「该怎么写」而不是「能不能写」，因为 private 事件**可以**留下
 * 一条抽象化记忆——「有人做了件事」是允许的，「他改了哪个文件」不是。
 */
export type WriteMode = 'verbatim' | 'abstracted' | 'forbidden';

export function writeModeOf(fact: WorldFact, holderIsPlayer: boolean): WriteMode {
  if (fact.visibility === 'world') return 'verbatim';
  if (fact.visibility === 'sanitized') return 'abstracted';
  // private_to_player：玩家自己的记忆在上游，世界侧不写明文。
  return holderIsPlayer ? 'forbidden' : 'abstracted';
}

/**
 * 删除级联。
 *
 * 三档处理，对应协议第 15 节的第 2 条：
 *
 * - **整条都是这个事件** → 删除；
 * - **摘要是多事件的并集**，其中含该事件 → 保留，标 `redacted`，并把该事件
 *   从 `eventRefs` 里摘掉。摘完之后 `eventRefs` 空了，就整条删除——
 *   一条没有出处的记忆不成立。
 * - **别的事件** → 不动。
 *
 * 这条规则让「删除」不会顺手删掉无辜的记忆：一段摘要记着三件事，删掉其中
 * 一件，另外两件该留着。
 */
export function deleteCascade(
  entries: readonly MemoryEntry[],
  root: DeletionRoot,
  claims: ReadonlySet<string> = new Set(),
): { readonly entries: readonly MemoryEntry[]; readonly report: Omit<DeletionReport, 'counts'> } {
  const removed: string[] = [];
  const redacted: string[] = [];
  const kept: MemoryEntry[] = [];

  for (const entry of entries) {
    if (matchesRoot(entry, root, claims)) {
      removed.push(entry.memoryId);
      continue;
    }
    if (root.kind !== 'event') {
      kept.push(entry);
      continue;
    }
    // 事件被删：看这条记忆里还有没有别的事件撑着。
    if (!entry.eventRefs.includes(root.id)) {
      kept.push(entry);
      continue;
    }
    const remaining = entry.eventRefs.filter((ref) => ref !== root.id);
    if (remaining.length === 0) {
      removed.push(entry.memoryId);
      continue;
    }
    redacted.push(entry.memoryId);
    kept.push({
      ...entry,
      eventRefs: [remaining[0]!, ...remaining.slice(1)],
      redacted: true,
      derivedFrom: {
        ...entry.derivedFrom,
        memoryIds: entry.derivedFrom.memoryIds.filter((id) => !removed.includes(id)),
      },
    });
  }

  return {
    entries: kept,
    report: { rootId: rootIdOf(root), entries: kept, removedMemoryIds: removed, redactedMemoryIds: redacted },
  };
}

function matchesRoot(entry: MemoryEntry, root: DeletionRoot, claims: ReadonlySet<string>): boolean {
  if (root.kind === 'memory') return entry.memoryId === root.id;
  if (root.kind === 'event') return false;
  // 断言被删：信念副本跟着走。
  return entry.derivedFrom.claimIds.includes(root.id) || claims.has(entry.memoryId);
}

function rootIdOf(root: DeletionRoot): string {
  return root.id;
}

/**
 * 表现输出的脱敏。
 *
 * 协议第 15 节最后一句：气泡、碑文等表现输出前再过一次脱敏。这一层与
 * `writeModeOf` 分开：一个是「写不写进记忆」，一个是「说不说得出口」。
 * 一条 `sanitized` 记忆可以写进记忆库，但它的原话不该出现在气泡里——
 * 气泡是给玩家看的，而玩家已经在别处知道真相了。
 */
export function redactForDisplay(text: string, forbidden: readonly string[]): string {
  let output = text;
  for (const token of forbidden) {
    if (token === '') continue;
    output = output.split(token).join('…');
  }
  return output;
}
