/**
 * 扫描面守卫的共用件：**根缺失要说出来，受查数掉了地板要报**。
 *
 * 三个审计（`audit-references` / `audit-ports` / 以及各自的测试）都要判同一件事，
 * 所以阈值口径只写在这里一处——两处各写一遍，早晚会漂成两个阈值。
 *
 * 地板只防塌陷，不追增长：检查是为了让「目录没了、文档丢了、扫描根被写成空头
 * 承诺」这类事故当场红，而不是给每次正常增长记一笔账。所以判据是**下降**多少，
 * 不是「比基线少就叫红」。
 *
 * 阈值依据（写进 `audit-scan-baseline.json` 的 `note`，也抄在这儿）：
 * 正常改动只动个位数（挪一个函数、加一段注释，行号引用随之漂几处）；
 * 删一份文档或挪走一个目录会让引用数掉几十到几百。`2%` 正好把这两类分开，
 * 再加一个 `minDrop = 5` 的绝对下限挡住小仓库的取整噪声。**只降不涨。**
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 一个扫描根没查成。`actual` 优先给 `ENOENT` / `EACCES` 这种能查的码。 */
export interface ScanRootProblem {
  /** `SCAN_ROOTS` 里写的那一串（相对仓库根）。 */
  readonly scanRoot: string;
  /** 期望它落在的绝对路径。 */
  readonly expected: string;
  /** 实际看到的状态。 */
  readonly actual: string;
}

/** 失败原因：优先给 `ENOENT` / `EACCES` 这种能查的码，其次才给 message。 */
export function failureWhy(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return error instanceof Error ? error.message : String(error);
}

/** 基线文件的形状。`audits[key][metric]` 是上一次核过的受查数。 */
export interface ScanBaselineFile {
  readonly note?: string;
  readonly threshold: {
    /** 绝对下限：小仓库里取整噪声不该算塌陷。 */
    readonly minDrop: number;
    /** 相对基线：挡住「删了文档/挪了目录」这种几十上百的塌陷。 */
    readonly ratio: number;
  };
  /** 每个审计一把尺：`references.checked`、`ports.files`。 */
  readonly audits: Record<string, Record<string, number>>;
}

/** 基线文件就在本目录，跟脚本一起走，不依赖 cwd。 */
export const SCAN_BASELINE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'audit-scan-baseline.json',
);

export type LoadedBaseline =
  | { readonly ok: true; readonly baseline: ScanBaselineFile }
  | { readonly ok: false; readonly why: string };

/** 阈值字段缺失时返回缺哪个；齐全返回 `null`。 */
function thresholdProblem(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return '基线不是对象';
  const threshold = (raw as { threshold?: unknown }).threshold;
  if (threshold === null || typeof threshold !== 'object') return '缺少 threshold（阈值对象）';
  const { minDrop, ratio } = threshold as { minDrop?: unknown; ratio?: unknown };
  if (typeof minDrop !== 'number' || !Number.isFinite(minDrop)) {
    return '缺少 threshold.minDrop（或不是有限数）';
  }
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
    return '缺少 threshold.ratio（或不是有限数）';
  }
  return null;
}

/**
 * 读基线。**读不到不算通过**：没有地板的扫描面就是一块没人核过的绿地，
 * 调用方必须把它当成红（`kind: 'missing'`），不能悄悄跳过。
 *
 * 形状也要核：缺 `threshold.minDrop` / `threshold.ratio` 时 `allowedDrop` 会算出
 * `NaN`（`Math.ceil(floor * undefined)`），`floor - actual > NaN` 恒为 `false`——
 * 地板判据把自己吞成绿。缺字段不是「阈值更宽松」，是**判据失效**，所以在加载
 * 边界就返回 `ok: false`，并打印缺的是哪个字段。
 */
export function loadScanBaseline(file: string = SCAN_BASELINE_PATH): LoadedBaseline {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { ok: false, why: `${file} —— ${failureWhy(error)}` };
  }
  const problem = thresholdProblem(raw);
  if (problem !== null) return { ok: false, why: `${file} —— ${problem}` };
  return { ok: true, baseline: raw as ScanBaselineFile };
}

/**
 * 地板判定。
 *
 * - `missing`：基线文件里没有这一项。**也是红**——安静的缺项与「没掉」长得一样。
 * - `breach`：实际受查数比基线少了超过允许的降幅。
 * - `ok`：在阈值内（含增长）。
 */
export type ScanFloor =
  | { readonly kind: 'ok'; readonly baseline: number; readonly allowed: number }
  | { readonly kind: 'breach'; readonly baseline: number; readonly allowed: number }
  | { readonly kind: 'missing' };

/** 允许的最大降幅：绝对下限与相对比例取大者。 */
function allowedDrop(baseline: ScanBaselineFile, floor: number): number {
  return Math.max(baseline.threshold.minDrop, Math.ceil(floor * baseline.threshold.ratio));
}

export function checkScanFloor(
  baseline: ScanBaselineFile,
  audit: string,
  metric: string,
  actual: number,
): ScanFloor {
  const floor = baseline.audits[audit]?.[metric];
  if (floor === undefined) return { kind: 'missing' };
  const allowed = allowedDrop(baseline, floor);
  return floor - actual > allowed
    ? { kind: 'breach', baseline: floor, allowed }
    : { kind: 'ok', baseline: floor, allowed };
}
