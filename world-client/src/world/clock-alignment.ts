/**
 * 老档日界对齐：检测世界日界与本地零点的偏移，给出「前跳多少」的方案，
 * 并把玩家的「暂不 / 已对齐」决定单独存起来（**不动 `world.` 存档契约**）。
 *
 * 语义（2026-11-03 定）：
 * - 对齐 = 把世界时钟**向前**跳 `deltaMs`，让下一个世界日界落在本地 00:00。
 * - 历史记忆条目与事件的 `day` / `when` 一个字段都不改写；`now` 跳变后
 *   相对定时器统一平移同一量（见 `Simulation.realignAfterClockJump`）。
 * - 当前世界日因此**提前结束**：日长变成 `DAY - deltaMs`。以老档实测
 *   `07:00:59` 的偏移为例，前跳约 7 小时，本日缩短为约 16 小时 59 分。
 * - 撤销 = 把同一 `deltaMs` 移回去；`now` 回到对齐前的值。
 */

import { REAL_DAY_MS } from './real-clock.ts';
import type { ClockMode } from './real-clock.ts';
import type { BaselineStorage } from './real-clock-baseline.ts';

/**
 * 日界对齐只在真实时钟模式（`?clock=real`）可用。
 *
 * 默认的游玩时间驱动里没有「墙钟日界」：世界只在页面开着时前进，关页面即
 * 冻结，「对齐到今天零点」既没有可对齐的对象，也会凭空改写玩家没玩过的
 * 时间。所以默认模式**不检测、不提示**，维护入口置灰。
 */
export function clockAlignmentAvailable(mode: ClockMode): boolean {
  return mode === 'real';
}

/** 偏移超过这个幅度才提示。5 分钟以内按墙钟抖动处理，不打扰玩家。 */
export const CLOCK_ALIGN_THRESHOLD_MS = 5 * 60 * 1000;

/** 独立 persist 键：每个世界一份，不进存档。 */
export const CLOCK_ALIGN_KEY_PREFIX = 'xiaoxi.pixel-world.clock-align.v1';

export interface ClockAlignmentProbe {
  /** 当前世界日界落在本地一天的哪个相位（毫秒）。0 = 正好本地 00:00。 */
  readonly boundaryMs: number;
  /** 本地时钟写法，例如 `07:01`。 */
  readonly boundaryLabel: string;
  /** 对齐需要把世界时钟向前跳多少毫秒。 */
  readonly deltaMs: number;
  /** 对齐后当前世界日的长度（毫秒）。 */
  readonly dayLengthAfterMs: number;
  /** 日界离最近一次本地零点的距离；决定要不要提示。 */
  readonly offsetFromMidnightMs: number;
  readonly required: boolean;
}

/** 已持久化的决定：要么「暂不」，要么「已对齐」。 */
export type ClockAlignmentRecord =
  | {
      readonly kind: 'declined';
      readonly boundaryMs: number;
      readonly wallMs: number;
    }
  | {
      readonly kind: 'applied';
      readonly boundaryMs: number;
      readonly deltaMs: number;
      readonly fromNow: number;
      readonly toNow: number;
      readonly dayBefore: number;
      readonly wallMs: number;
    };

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

/** 把本地一天内的毫秒写成 `HH:MM`（秒按四舍五入进分钟）。 */
export function formatBoundaryClock(ms: number): string {
  const totalMinutes = Math.round(mod(ms, REAL_DAY_MS) / 60_000) % 1440;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** 人话时长：`7 小时 0 分` / `16 小时 59 分`。 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} 小时 ${minutes} 分`;
}

/**
 * 检测日界偏移。
 *
 * 世界相位 `p = worldNow mod DAY`，本地相位 `q = (wallMs + 时区) mod DAY`；
 * 世界日界落在本地的相位就是 `q - p`（取模）。把它前移到 0 所需的**最小正向**
 * 跳量正好等于这个相位本身，所以 `deltaMs === boundaryMs`。
 */
export function inspectClockAlignment(
  worldNow: number,
  wallMs: number,
  utcOffsetMinutes: number,
): ClockAlignmentProbe {
  const worldPhase = mod(worldNow, REAL_DAY_MS);
  const localPhase = mod(wallMs + utcOffsetMinutes * 60_000, REAL_DAY_MS);
  const boundaryMs = mod(localPhase - worldPhase, REAL_DAY_MS);
  const offsetFromMidnightMs = Math.min(boundaryMs, REAL_DAY_MS - boundaryMs);
  return {
    boundaryMs,
    boundaryLabel: formatBoundaryClock(boundaryMs),
    deltaMs: boundaryMs,
    dayLengthAfterMs: REAL_DAY_MS - boundaryMs,
    offsetFromMidnightMs,
    required: offsetFromMidnightMs > CLOCK_ALIGN_THRESHOLD_MS,
  };
}

/** 墙钟回拨暂停时不执行对齐：两件事同时改 `now` 会互相破坏。 */
export function mayAlignClock(probe: ClockAlignmentProbe, paused: boolean): boolean {
  return probe.required && !paused;
}

export function clockAlignmentKey(worldId: string): string {
  return `${CLOCK_ALIGN_KEY_PREFIX}:${worldId}`;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** 读决定；坏值一律当没有（与时钟基线同一条规矩）。 */
export function readClockAlignment(
  storage: BaselineStorage,
  worldId: string,
): ClockAlignmentRecord | null {
  let raw: string | null;
  try {
    raw = storage.getItem(clockAlignmentKey(worldId));
  } catch {
    return null;
  }
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  if (value.kind === 'declined') {
    if (!isFiniteNonNegative(value.boundaryMs) || !isFiniteNonNegative(value.wallMs)) return null;
    return { kind: 'declined', boundaryMs: value.boundaryMs, wallMs: value.wallMs };
  }
  if (value.kind === 'applied') {
    if (
      !isFiniteNonNegative(value.boundaryMs)
      || !isFiniteNonNegative(value.deltaMs)
      || !isFiniteNonNegative(value.fromNow)
      || !isFiniteNonNegative(value.toNow)
      || !isFiniteNonNegative(value.dayBefore)
      || !isFiniteNonNegative(value.wallMs)
      || value.deltaMs === 0
      || value.fromNow + value.deltaMs !== value.toNow
    ) {
      return null;
    }
    return {
      kind: 'applied',
      boundaryMs: value.boundaryMs,
      deltaMs: value.deltaMs,
      fromNow: value.fromNow,
      toNow: value.toNow,
      dayBefore: value.dayBefore,
      wallMs: value.wallMs,
    };
  }
  return null;
}

export function writeClockAlignment(
  storage: BaselineStorage,
  worldId: string,
  record: ClockAlignmentRecord,
): boolean {
  try {
    storage.setItem(clockAlignmentKey(worldId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function clearClockAlignment(storage: BaselineStorage, worldId: string): boolean {
  try {
    storage.removeItem(clockAlignmentKey(worldId));
    return true;
  } catch {
    return false;
  }
}

/**
 * 提示的会话/持久状态机。
 *
 * 「暂不」按**日界相位**记住：重启后同一个相位不再弹；相位变了（换了存档/
 * 世界时钟变了）才会重新问。`reopen()` 是设置/调试面板的再次触发入口，
 * 不受「暂不」影响——否则弹过一次就永远点不到了。
 */
export class ClockAlignmentGate {
  private declinedBoundaryMs: number | null;
  private visible = false;

  constructor(declinedBoundaryMs: number | null = null) {
    this.declinedBoundaryMs = declinedBoundaryMs;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  get declinedAt(): number | null {
    return this.declinedBoundaryMs;
  }

  /**
   * 「暂不」记的相位与当前相位算同一个吗？
   *
   * 真实时钟与世界时间按 1:1 走，但每拍按 `LOGIC_STEP_MS` 取整，重开一次页面
   * 就能差几十毫秒。拿绝对相等去判，重启后必然又弹——这不是玩家的决定被忘了，
   * 是测量在漂。按同一阈值（5 分钟）判「同一个日界」。
   */
  private sameBoundary(probe: ClockAlignmentProbe): boolean {
    if (this.declinedBoundaryMs === null) return false;
    const diff = Math.abs(probe.boundaryMs - this.declinedBoundaryMs);
    const circular = Math.min(diff, REAL_DAY_MS - diff);
    return circular <= CLOCK_ALIGN_THRESHOLD_MS;
  }

  /** 读档/回拨后重算：该弹就弹，该收就收。 */
  open(probe: ClockAlignmentProbe): boolean {
    if (!probe.required || this.sameBoundary(probe)) {
      this.visible = false;
      return false;
    }
    this.visible = true;
    return true;
  }

  /** 玩家点「暂不」：收起，并记住这个相位。 */
  decline(probe: ClockAlignmentProbe): void {
    this.declinedBoundaryMs = probe.boundaryMs;
    this.visible = false;
  }

  /** 再次触发入口：忘掉「暂不」，重新按当前偏移判断。 */
  reopen(probe: ClockAlignmentProbe): boolean {
    this.declinedBoundaryMs = null;
    return this.open(probe);
  }

  /** 不涉及玩家决定，直接收起（例如对齐已完成或切到加速模式）。 */
  hide(): void {
    this.visible = false;
  }
}
