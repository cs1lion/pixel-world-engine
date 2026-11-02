/**
 * 真实时钟的**跨会话基线**：上次活跃的真实时刻，以及那一刻的世界时间。
 *
 * 为什么不进存档：存档 `world.*` 是世界的自有事实，锚点是「这台设备上一次
 * 什么时候开着页面」的运行环境信息，两者生命周期不同；把锚点塞进 `world.`
 * 会让同一份存档在换设备/换时区后带上别人的时钟。独立 localStorage 键更诚实，
 * 也避免 v5 契约再扩一次。
 *
 * 老档（v1/v4）没有这个键：读不到就按「从现在起计时」，不凭空补历史。
 */

export const REAL_CLOCK_BASELINE_PREFIX = 'xiaoxi.pixel-world.real-clock.v1';

/** 只声明用到的那三个方法，测试可以塞假存储。 */
export interface BaselineStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClockBaseline {
  /** 上一次写基线时的墙钟毫秒。 */
  readonly lastWallMs: number;
  /** 那一刻的世界时间（`Simulation.now`）。 */
  readonly lastWorldNow: number;
}

/** 每个世界一份基线：换设定集不会把另一座镇子的时间带过来。 */
export function realClockBaselineKey(worldId: string): string {
  return `${REAL_CLOCK_BASELINE_PREFIX}:${worldId}`;
}

/** 读基线。坏值/缺字段/负数一律当「没有」，不猜。 */
export function readClockBaseline(
  storage: BaselineStorage,
  worldId: string,
): ClockBaseline | null {
  let raw: string | null;
  try {
    raw = storage.getItem(realClockBaselineKey(worldId));
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const item = parsed as { lastWallMs?: unknown; lastWorldNow?: unknown };
  const lastWallMs = item.lastWallMs;
  const lastWorldNow = item.lastWorldNow;
  if (
    typeof lastWallMs !== 'number' ||
    typeof lastWorldNow !== 'number' ||
    !Number.isFinite(lastWallMs) ||
    !Number.isFinite(lastWorldNow) ||
    lastWallMs < 0 ||
    lastWorldNow < 0
  ) {
    return null;
  }
  return { lastWallMs, lastWorldNow };
}

/** 写基线。写不进去（隐私模式/配额）只是这一份丢失，不让世界停下。 */
export function writeClockBaseline(
  storage: BaselineStorage,
  worldId: string,
  baseline: ClockBaseline,
): boolean {
  try {
    storage.setItem(realClockBaselineKey(worldId), JSON.stringify(baseline));
    return true;
  } catch {
    return false;
  }
}

export function clearClockBaseline(storage: BaselineStorage, worldId: string): void {
  try {
    storage.removeItem(realClockBaselineKey(worldId));
  } catch {
    // 清不掉也只是下次少补一点，不是世界该停下的理由。
  }
}

/** 补算结果的可读状态。两种文案必须分得开：逐日 vs 合并。 */
export interface ClockCatchUp {
  readonly kind: 'day-by-day' | 'merged';
  readonly days: number;
  readonly skippedDays: number;
}

export function formatClockCatchUp(report: ClockCatchUp): string {
  if (report.kind === 'merged') {
    return `真实时钟：离线合并结算，跳过 ${report.skippedDays} 天`;
  }
  return `真实时钟：离线逐日补算 ${report.days} 天`;
}
