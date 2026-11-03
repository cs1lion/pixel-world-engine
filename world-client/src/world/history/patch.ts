/** 历史快照的差分：把「昨天的整档」与「今天的整档」压成**字段级补丁**。
 *
 * 这一层只做两件事，都是纯函数：
 *
 * - `diffDoc(prev, next)`：同一形状的两份文档 → 一串 `DiffOp`；
 * - `applyOps(doc, ops)`：把补丁原样应用到一份文档上。
 *
 * 三条纪律：
 *
 * 1. **只写变了的字段。** 整对象进补丁会退化成「每天一份全量」——那是这一层
 *    存在的全部理由。数组按 id 对齐（`facts` 按 `eventId`、`entries` 按
 *    `memoryId`……），元素内部再逐字段比。
 * 2. **顺序也要对得上。** 按键对齐的数组会丢掉顺序，而顺序不是装饰：
 *    `entries` 的先后决定回忆打分的同分次序。所以公共键的相对顺序一变，
 *    补丁里多一条 `order`（整天一份 id 列表，几百字节到几 KB）。
 * 3. **不可变优先。** 两份文档里没动过的元素是同一个对象引用；先比引用再往
 *    下走，是这一层能在关页之外的几十毫秒里跑完的原因。
 */

import type { MemoryRuntimeSnapshot } from '../memory/runtime.ts';
import type { WorldSave } from '../save.ts';

/** 历史里的一份完整状态：世界存档（`world.memory` 留空）+ 记忆快照。 */
export interface HistoryDoc {
  readonly day: number;
  readonly save: WorldSave;
  readonly memory: MemoryRuntimeSnapshot;
}

export interface DiffOp {
  /** 路径。按键对齐的数组里，键本身就是路径的一段。 */
  readonly path: readonly string[];
  readonly value?: unknown;
  readonly del?: true;
  /** 整个数组的新顺序（键列表）。只在公共键的相对顺序变了时出现。 */
  readonly order?: readonly string[];
  /** 追加到数组尾部（`tells` 这类只增表）。 */
  readonly append?: readonly unknown[];
}

/** 一个数组怎么认元素。返回 `null` 表示按下标对齐。 */
type KeyFn = (item: any) => string;

function pairKeyOf(item: any): string {
  return `${String(item?.[0])}\u0000${String(item?.[1])}`;
}

/**
 * 按键对齐的数组。键是路径（用 `.` 连接）。
 *
 * 表里没有的数组一律按下标对齐；`tells` / `roads` / `oracle` 是只增或很小的
 * 几列，按下标足够了。真出现「中间删一条」时下标对齐会退化成整列替换——
 * 那是最坏情况的正确性保底，不是常态。
 */
const KEYED: Readonly<Record<string, KeyFn>> = {
  // ---- 记忆段
  'memory.holders': (item) => String(item.holderId),
  'memory.facts': (item) => String(item.eventId),
  'memory.entries': (item) => String(item.memoryId),
  'memory.claims': (item) => String(item.claimId),
  'memory.beliefs': (item) => `${String(item.holderId)}\u0000${String(item.claimId)}`,
  'memory.traces': (item) => String(item.placeId),
  'memory.traces.*.entries': (item) => String(item.traceId),
  'memory.legends': (item) => String(item.legendId),
  'memory.placeAnchors': (item) => String(item.placeId),
  'memory.landmarks': (item) => String(item.plotKey),
  'memory.eras': (item) => String(item.eraId),
  'memory.epics': (item) => String(item.epicId),
  'memory.turningPoints': (item) =>
    `${String(item.holderId)}\u0000${String(item.claimId)}\u0000${String(item.day)}`,
  'memory.placeNames': (item) => String(item.placeId),
  'memory.announcements': (item) => String(item.announcementId),
  'memory.verifyPlans': (item) => String(item.holderId),
  'memory.cooldowns': (item) =>
    `${String(item.pairKey)}\u0000${String(item.claimId)}\u0000${String(item.atMs)}`,
  'memory.fanout.counts': pairKeyOf,
  'memory.credibility': pairKeyOf,
  'memory.metToday': pairKeyOf,
  // ---- 世界存档
  'save.world.villagers': (item) => String(item.id),
  'save.world.buildings': (item) => String(item.instanceId),
  'save.world.tasks': (item) => String(item.id),
  'save.world.pending': (item) => String(item.id),
  'save.world.activities': (item) => String(item.buildingId),
  'save.world.constructions': (item) => String(item.buildingId),
  'save.world.props': (item) => String(item.id),
  'save.world.settled': (item) => String(item.id),
  'save.world.critters': (item) => String(item.id),
};

/** 走一遍路径表；`*` 匹配任意一段（只用于 `traces.<placeId>.entries`）。 */
function keyFnFor(path: readonly string[]): KeyFn | null {
  const direct = KEYED[path.join('.')];
  if (direct !== undefined) return direct;
  if (path.length === 5 && path[0] === 'memory' && path[1] === 'traces' && path[4] === 'entries') {
    return KEYED['memory.traces.*.entries']!;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

/**
 * 两份文档的差。`prev === next` 直接返回——这是绝大多数元素每天走的那条路。
 *
 * `ops` 里每个值都是 `next` 的引用；写进 IndexedDB 时由结构化克隆复制一遍，
 * 不会与活动的世界共享可变对象。
 */
export function diffDoc(prev: unknown, next: unknown): DiffOp[] {
  const ops: DiffOp[] = [];
  diffValue(prev, next, [], ops);
  return ops;
}

function diffValue(
  prev: unknown,
  next: unknown,
  path: readonly string[],
  ops: DiffOp[],
): void {
  if (prev === next) return;
  if (isPrimitive(prev) || isPrimitive(next)) {
    ops.push({ path: [...path], value: next });
    return;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    diffArray(prev, next, path, ops);
    return;
  }
  if (isRecord(prev) && isRecord(next)) {
    for (const key of Object.keys(next)) {
      if (!(key in prev)) {
        ops.push({ path: [...path, key], value: next[key] });
        continue;
      }
      diffValue(prev[key], next[key], [...path, key], ops);
    }
    for (const key of Object.keys(prev)) {
      if (!(key in next)) ops.push({ path: [...path, key], del: true });
    }
    return;
  }
  // 形状变了（对象 ↔ 数组 ↔ 标量）：整块替换。
  ops.push({ path: [...path], value: next });
}

function diffArray(
  prev: readonly unknown[],
  next: readonly unknown[],
  path: readonly string[],
  ops: DiffOp[],
): void {
  const keyFn = keyFnFor(path);
  if (keyFn === null) {
    // 只增表：前缀逐个比引用，尾部一次 append。`tells` 每天加几条，
    // 走这条比整列替换省得多。世界存档的数组是每天新建的对象，引用比不中，
    // 于是落到「长度一样就逐项递归」，也仍然只写变了的元素。
    if (next.length >= prev.length) {
      let samePrefix = true;
      for (let index = 0; index < prev.length; index += 1) {
        if (prev[index] !== next[index]) {
          samePrefix = false;
          break;
        }
      }
      if (samePrefix && prev.length > 0) {
        ops.push({ path: [...path], append: next.slice(prev.length) });
        return;
      }
    }
    if (prev.length === next.length) {
      for (let index = 0; index < next.length; index += 1) {
        diffValue(prev[index], next[index], [...path, String(index)], ops);
      }
      return;
    }
    ops.push({ path: [...path], value: next });
    return;
  }

  const prevKeys = prev.map((item) => keyFn(item));
  const nextKeys = next.map((item) => keyFn(item));
  const prevIndex = new Map<string, number>();
  for (let index = 0; index < prevKeys.length; index += 1) prevIndex.set(prevKeys[index]!, index);
  const nextSet = new Set(nextKeys);

  for (let index = 0; index < next.length; index += 1) {
    const key = nextKeys[index]!;
    const oldIndex = prevIndex.get(key);
    if (oldIndex === undefined) {
      // 新元素：整条放进来（它还不存在，没有「只变了几个字段」这回事）。
      ops.push({ path: [...path, key], value: next[index] });
      continue;
    }
    diffValue(prev[oldIndex], next[index], [...path, key], ops);
  }
  for (const key of prevKeys) {
    if (!nextSet.has(key)) ops.push({ path: [...path, key], del: true });
  }

  // 公共键的相对顺序变了才记 order。全量 id 列一份，几百字节到几 KB。
  const prevCommon = prevKeys.filter((key) => nextSet.has(key));
  const nextCommon = nextKeys.filter((key) => prevIndex.has(key));
  const reordered = prevCommon.some((key, index) => key !== nextCommon[index]);
  if (reordered) ops.push({ path: [...path], order: nextKeys });
}

/**
 * 走到「装着最后一段的那个容器」。容器可能是对象，也可能是按键对齐的数组；
 * `last` 是要改的键（数组里就是元素的键）。
 */
function resolve(root: unknown, path: readonly string[]): { container: any; last: string } | null {
  let current: any = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    if (Array.isArray(current)) {
      // 数组自己的路径是**祖先那几段**（`path.slice(0, index)`），
      // `segment` 是要找的键——不是再往下走一层。
      const fn = keyFnFor(path.slice(0, index));
      const found = fn === null
        ? current[Number(segment)]
        : current.find((item) => fn(item) === segment);
      if (found === undefined) return null;
      current = found;
      continue;
    }
    if (isRecord(current)) {
      current = current[segment];
      if (current === undefined || current === null) return null;
      continue;
    }
    return null;
  }
  return { container: current, last: path[path.length - 1]! };
}

/**
 * 应用补丁。**会就地改 `doc`**：调用方传进来的必须是一份已经克隆过的文档。
 *
 * 补丁是逐日在同一份文档上叠的，所以这里的顺序必须与 `diffDoc` 的产出顺序
 * 无冲突：先增改、后删、再 order/append。`diffDoc` 已经按这个顺序产出。
 */
export function applyOps(doc: HistoryDoc, ops: readonly DiffOp[]): void {
  for (const op of ops) {
    if (op.path.length === 0) continue;
    const at = resolve(doc, op.path);
    if (at === null) continue;
    const { container, last } = at;

    // 目标本身是数组（order / append / 整列替换）。最后一段是它的键。
    const child = Array.isArray(container) ? undefined : container[last];
    if (Array.isArray(child)) {
      if (op.del === true) delete container[last];
      else if (op.order !== undefined) reorder(child, keyFnFor(op.path), op.order);
      else if (op.append !== undefined) child.push(...op.append);
      else container[last] = op.value;
      continue;
    }

    // 容器本身是按键数组：`last` 是元素的键。
    if (Array.isArray(container)) {
      const fn = keyFnFor(op.path.slice(0, -1));
      if (op.del === true) {
        const index = fn === null
          ? Number(last)
          : container.findIndex((item) => fn(item) === last);
        if (index >= 0) container.splice(index, 1);
        continue;
      }
      const index = fn === null
        ? Number(last)
        : container.findIndex((item) => fn(item) === last);
      if (index >= 0) container[index] = op.value;
      else if (fn === null && Number.isInteger(Number(last))) container[Number(last)] = op.value;
      else container.push(op.value);
      continue;
    }

    if (isRecord(container)) {
      if (op.del === true) delete container[last];
      else if (op.order === undefined && op.append === undefined) container[last] = op.value;
    }
  }
}

/** 按给定的键顺序重排。缺键的留在末尾，宁多不少。 */
function reorder(array: any[], fn: KeyFn | null, keys: readonly string[]): void {
  if (fn === null) return;
  const byKey = new Map<string, any>();
  for (const item of array) byKey.set(fn(item), item);
  const ordered: any[] = [];
  for (const key of keys) {
    const item = byKey.get(key);
    if (item !== undefined) {
      ordered.push(item);
      byKey.delete(key);
    }
  }
  for (const item of byKey.values()) ordered.push(item);
  array.splice(0, array.length, ...ordered);
}
