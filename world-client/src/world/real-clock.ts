/**
 * 真实时钟模式的时间内核：1 世界日 = 24 真实小时，日界在本地 00:00。
 *
 * **与加速模式的分别**（`SandboxScene` 的默认真实时钟与 `?clock=fast`）：
 * - 真实时钟（默认）：`timeScale` **不作为倍率**，步长永远是 `LOGIC_STEP_MS`；
 *   墙钟走多久，世界走多久。日界按本地（默认 UTC+8）的 00:00，不是「开局
 *   满 24 小时」。
 * - 加速模式（显式 `?clock=fast`，或只给 `?speed=`）：`timeScale` 放大喂给
 *   `Simulation` 的步长，一世界日约 `DAY_MS / (1000 × timeScale)` 真实秒。
 *   它服务演示与回归，不承诺 1:1。
 *
 * 这里只做纯计算与判定，不读 `Date.now()`、不碰 Phaser。调用方把墙钟与单调
 * 时钟递进来，于是「日界恰在 00:00」「离线 3 天补 3 次」「回拨 10 分钟暂停」
 * 都能在 node 下用可控时间钉住。
 *
 * **锚点可配置**：`utcOffsetMinutes` 默认写死 480（UTC+8，无夏令时）。改它只
 * 影响「哪一刻算本地 00:00」，不会让日长变。
 */

/** 一世界日的真实毫秒数。与记忆层 `DAY_MS` 同为 24 小时，这里是真实时钟侧的常量。 */
export const REAL_DAY_MS = 24 * 60 * 60 * 1000;

/** 默认时区：UTC+8。写死默认值，避免跨机器/跨时区漂移；要改由调用方显式传入。 */
export const DEFAULT_UTC_OFFSET_MINUTES = 480;

/** 加速模式的默认倍率：一世界日约 4 小时真实时间（见 `test/day-pace.test.ts`）。 */
export const DEFAULT_FAST_TIME_SCALE = 6;

/** 加速模式的倍率上限。真实时钟不走这条闸。 */
export const MAX_TIME_SCALE = 60;

export type ClockMode = 'real' | 'accelerated';

export interface ClockSelection {
  readonly mode: ClockMode;
  /** 真实时钟下恒为 1；加速模式下是 `?speed=` 或默认倍率。 */
  readonly timeScale: number;
  readonly utcOffsetMinutes: number;
}

/**
 * 从 URL 查询串解析时钟入口。
 *
 * **默认真实时钟**：不写参数就是 1:1。要加速必须显式说出口——
 * `?clock=fast`（`accelerated` 也认），或只给 `?speed=`（历史入口，截图与
 * 回归一直这么用）。`?clock=real` 永远压过 `?speed=`：留一个能偷偷加速的
 * 真实时钟，就没有人能说它还是真实时钟。
 */
export function resolveClockSelection(
  search: string | URLSearchParams,
  defaultFastScale = DEFAULT_FAST_TIME_SCALE,
): ClockSelection {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const offsetParam = params.get('utcOffsetMinutes');
  const offsetRaw = offsetParam === null ? null : Number(offsetParam);
  const utcOffsetMinutes =
    offsetRaw !== null && Number.isInteger(offsetRaw) && offsetRaw >= -720 && offsetRaw <= 840
      ? offsetRaw
      : DEFAULT_UTC_OFFSET_MINUTES;

  const clock = params.get('clock');
  const speedRaw = params.get('speed');
  const speed = speedRaw === null ? null : Number(speedRaw);
  const hasSpeed =
    speed !== null && Number.isFinite(speed) && speed > 0 && speed <= MAX_TIME_SCALE;

  const accelerated = clock === 'fast' || clock === 'accelerated' || (clock === null && hasSpeed);
  if (!accelerated) {
    return { mode: 'real', timeScale: 1, utcOffsetMinutes };
  }
  return {
    mode: 'accelerated',
    timeScale: hasSpeed ? speed : defaultFastScale,
    utcOffsetMinutes,
  };
}

/** 墙钟回拨超过这个幅度就暂停推进。5 分钟以内按抖动处理。 */
export const CLOCK_BACKWARD_LIMIT_MS = 5 * 60 * 1000;

/** 离线逐日补算的上限。超过它就合并成一次「长时间流逝」结算。 */
export const OFFLINE_SETTLE_MAX_DAYS = 7;

export interface RealClockOptions {
  readonly utcOffsetMinutes?: number;
  readonly backwardLimitMs?: number;
  readonly offlineMaxDays?: number;
}

export interface RealClockTick {
  /** 可推进的真实毫秒。暂停时为 0。 */
  readonly deltaMs: number;
  readonly paused: boolean;
  readonly pauseReason: 'wall-clock-backward' | null;
  /** 这次观察跨过了几个本地日界。 */
  readonly dayGap: number;
  /** 逐日结算的世界日序号；合并结算时只有最后一个。 */
  readonly settlementDays: readonly number[];
  /** 合并结算时被跳过（没有单独关账）的天数。逐日结算时为 0。 */
  readonly skippedDays: number;
}

/** 某个绝对时刻落在本地第几天（自 epoch 起的本地日序号）。 */
export function localDayIndex(atMs: number, utcOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES): number {
  return Math.floor((atMs + utcOffsetMinutes * 60_000) / REAL_DAY_MS);
}

/** 某个绝对时刻距本地 00:00 过了多少毫秒。 */
export function msSinceLocalMidnight(
  atMs: number,
  utcOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES,
): number {
  const local = atMs + utcOffsetMinutes * 60_000;
  return local - Math.floor(local / REAL_DAY_MS) * REAL_DAY_MS;
}

/**
 * 真实时钟的观察器。
 *
 * 用法：`start()` 定基线，之后每帧 `observe(wallMs, monotonicMs)`。墙钟是推进
 * 与日界的依据；单调时钟只用来确认「这一帧确实在往前走」（它不该倒退）。
 *
 * **暂停后不自动恢复**：墙钟回拨超过 5 分钟是异常，静默改 `now` 会把世界
 * 推进到一个回不去的时刻。暂停后由调用方显式 `resume()`，期间 `deltaMs` 恒为 0。
 */
export class RealClock {
  private readonly offsetMinutes: number;
  private readonly backwardLimitMs: number;
  private readonly offlineMaxDays: number;
  private lastWallMs: number | null = null;
  private lastMonoMs: number | null = null;
  private lastDayIndex: number | null = null;
  private paused = false;

  constructor(options: RealClockOptions = {}) {
    this.offsetMinutes = options.utcOffsetMinutes ?? DEFAULT_UTC_OFFSET_MINUTES;
    this.backwardLimitMs = options.backwardLimitMs ?? CLOCK_BACKWARD_LIMIT_MS;
    this.offlineMaxDays = options.offlineMaxDays ?? OFFLINE_SETTLE_MAX_DAYS;
  }

  get started(): boolean {
    return this.lastWallMs !== null;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(wallMs: number, monotonicMs: number): void {
    this.lastWallMs = wallMs;
    this.lastMonoMs = monotonicMs;
    this.lastDayIndex = this.dayIndexOf(wallMs);
    this.paused = false;
  }

  /**
   * 用**上一次会话**的墙钟时刻做基线，再 `observe` 当前时刻。
   *
   * 这是跨会话补算的入口：`observe` 复用同一条日界/回拨/合并逻辑，不另写
   * 一套；单调时钟给当前值即可（跨会话比较的是墙钟，不是 `performance.now()`）。
   */
  prime(lastWallMs: number, monotonicMs: number): void {
    this.lastWallMs = lastWallMs;
    this.lastMonoMs = monotonicMs;
    this.lastDayIndex = this.dayIndexOf(lastWallMs);
    this.paused = false;
  }

  /** 异常解除后重新对表：不补回暂停期间的时间，只从当前这一刻继续。 */
  resume(wallMs: number, monotonicMs: number): void {
    this.start(wallMs, monotonicMs);
  }

  observe(wallMs: number, monotonicMs: number): RealClockTick {
    if (this.lastWallMs === null || this.lastMonoMs === null || this.lastDayIndex === null) {
      this.start(wallMs, monotonicMs);
      return {
        deltaMs: 0,
        paused: false,
        pauseReason: null,
        dayGap: 0,
        settlementDays: [],
        skippedDays: 0,
      };
    }
    if (this.paused) {
      return {
        deltaMs: 0,
        paused: true,
        pauseReason: 'wall-clock-backward',
        dayGap: 0,
        settlementDays: [],
        skippedDays: 0,
      };
    }

    const wallDelta = wallMs - this.lastWallMs;
    const monoDelta = monotonicMs - this.lastMonoMs;
    // 单调时钟倒退本身不该发生；真发生了说明进程时钟被重置，按异常停下，
    // 不拿它去解释墙钟。
    if (wallDelta < -this.backwardLimitMs || monoDelta < 0) {
      this.paused = true;
      this.lastWallMs = wallMs;
      this.lastMonoMs = monotonicMs;
      return {
        deltaMs: 0,
        paused: true,
        pauseReason: 'wall-clock-backward',
        dayGap: 0,
        settlementDays: [],
        skippedDays: 0,
      };
    }

    const deltaMs = Math.max(0, wallDelta);
    const day = this.dayIndexOf(wallMs);
    const gap = Math.max(0, day - this.lastDayIndex);
    const merged = gap > this.offlineMaxDays;
    const settlementDays: number[] = [];
    let skippedDays = 0;
    if (gap > 0 && merged) {
      // 天数太多就只关一次账：中间那些天不逐日重放，记下跳过了多少天。
      settlementDays.push(day);
      skippedDays = gap - 1;
    } else {
      for (let index = this.lastDayIndex + 1; index <= day; index += 1) {
        settlementDays.push(index);
      }
    }

    this.lastWallMs = wallMs;
    this.lastMonoMs = monotonicMs;
    this.lastDayIndex = day;
    return {
      deltaMs,
      paused: false,
      pauseReason: null,
      dayGap: gap,
      settlementDays,
      skippedDays,
    };
  }

  private dayIndexOf(atMs: number): number {
    return localDayIndex(atMs, this.offsetMinutes);
  }
}
