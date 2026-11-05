/**
 * 截图呈现态夹具（纯逻辑，无 Phaser 依赖）。
 *
 * `SandboxScene` 把这两个值只用在「画什么」上：呈现时刻、潮位、昼夜层的入参。
 * 世界快照、判据、存档一概不读它。抽成纯函数是为了能单测那些分支——
 * 场景本身在 Node 里造不出来（Phaser 是空壳）。
 */

export interface ShotPin {
  readonly nowMs: number | null;
  readonly tideLevel: number | null;
}

/** 未钉住：呈现值全部回落到世界快照。 */
export const NO_SHOT_PIN: ShotPin = Object.freeze({ nowMs: null, tideLevel: null });

/**
 * 钉住呈现态。非有限值整条不生效（与 `SandboxScene` 原来的早退一致）：
 * 两路是同一帧的一对口径，只钉一半会让画面读成「按 A 时刻算的潮位」。
 */
export function pinShot(prev: ShotPin, nowMs: number, tideLevel: number): ShotPin {
  if (!Number.isFinite(nowMs) || !Number.isFinite(tideLevel)) return prev;
  if (nowMs === prev.nowMs && tideLevel === prev.tideLevel) return prev;
  return { nowMs, tideLevel };
}

/** 解钉：回到「全部读快照」。 */
export function unpinShot(): ShotPin {
  return NO_SHOT_PIN;
}

/** 画面上用的时刻。 */
export function presentedNowOf(pin: ShotPin, snapshotNow: number): number {
  return pin.nowMs ?? snapshotNow;
}

/** 画面上用的潮位。 */
export function presentedTideOf(pin: ShotPin, snapshotTide: number): number {
  return pin.tideLevel ?? snapshotTide;
}

/**
 * 昼夜层入参：钉住时给快照一份同值拷贝，免得「按 12:30 算的鸟、按真实时刻
 * 算的暗角」对不上；未钉住时原样返回（默认路径零拷贝，逐字节不变）。
 */
export function phaseInputOf<T extends { now: number }>(pin: ShotPin, snapshot: T): T {
  if (pin.nowMs === null) return snapshot;
  return { ...snapshot, now: pin.nowMs };
}
