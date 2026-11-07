/**
 * 扫描面守卫的共用件：**根缺失要说出来，受查数掉了地板要报**。
 *
 * 三个审计（`audit-references` / `audit-ports` / 以及各自的测试）都要判同一件事，
 * 所以阈值口径只写在这里一处——两处各写一遍，早晚会漂成两个阈值。
 *
 * 判两个方向，**红了都只能靠刷新基线消除**：
 * - **塌陷**：受查数比基线下降超过 `max(minDrop, 2%)` → 红。用来抓「目录没了、
 *   文档丢了、扫描根被写成空头承诺」，不是给每次正常增长记账。
 * - **过期**：受查数比基线增长超过 `STALE_RATIO`（20%）→ 红。基线是快照，
 *   不跟着实际面刷新的地板会静默失效——342 的基线对着 530 的实面，塌掉 195 处
 *   （37%）都不红。所以增长也要红，逼出一次显式的「刷新 + 留痕」。
 *
 * 阈值依据：正常改动只动个位数（挪一个函数、加一段注释，行号引用随之漂几处）；
 * 删一份文档或挪走一个目录会让引用数掉几十到几百。`2%` 正好把这两类分开，
 * 再加一个 `minDrop = 5` 的绝对下限挡住小仓库的取整噪声。过期比例的依据见
 * `STALE_RATIO` 的注释。**三个阈值都不许顺手改大来消红。**
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
 * 政策常数：基线过期比例 **20%**。
 *
 * 为什么要有这个数：地板只判下降时，基线一旦过期就形同虚设——342 的基线对着
 * 530 的实际面，塌掉 195 处（37%）仍然绿。这个失效是静默的，比塌陷本身更危险。
 *
 * 为什么是 20%：正常文档增长（几周、十来篇）通常跨不过 20%；而基线过期是
 * 「守卫已经失效但没人知道」，代价远大于一次显式刷新。取 20% 让正当增长也会
 * 红——这是有意的：刷新基线是一次显式动作，要留下 commit 与 note，和天花板
 * 棘轮同理，不能靠「实际面涨了」自动漂过去。
 *
 * **红线只能靠刷新基线消除**（按实测值写回 + 记日期/commit/前后值），
 * 不许把 20% 调大来消红——那等于把守卫调哑。改比例必须按政策常数记账
 * （理由 + 当时的实测面 + 谁批的）。
 *
 * **这里有一个有意的盲窗，不是遗漏**：地板是「基线 − max(minDrop, 2%)」，
 * 过期线是「基线 + ceil(基线 × 20%)」，两者之间约 22% 的区间里任何回落都
 * 不会红（references 现在 117 处 / 22%，ports 36 处 / 23%，由 `silentWindow`
 * 实算并打印）。收紧到能把这段也抓住，就得让每次正常文档改动都红，进而训练
 * 人忽略红——代价比窄窗更大。为什么现在不收紧、将来什么条件才允许收紧
 * （例如有了按文件粒度记账的手段），见 `docs/OPEN_ISSUES.md` 的 E11。
 */
export const STALE_RATIO = 0.2;

/**
 * 地板判定。
 *
 * - `missing`：基线文件里没有这一项。**也是红**——安静的缺项与「没掉」长得一样。
 * - `breach`：实际受查数比基线少了超过允许的降幅。
 * - `stale`：实际受查数比基线增长了超过 `STALE_RATIO`。基线过期，需要刷新。
 * - `ok`：两个方向都在阈值内。
 */
export type ScanFloor =
  | { readonly kind: 'ok'; readonly baseline: number; readonly allowed: number }
  | { readonly kind: 'breach'; readonly baseline: number; readonly allowed: number }
  | {
      readonly kind: 'stale';
      readonly baseline: number;
      readonly allowed: number;
      /** 超出基线的百分比，供人看的整数。 */
      readonly overPercent: number;
    }
  | { readonly kind: 'missing' };

/** 允许的最大降幅：绝对下限与相对比例取大者。 */
function allowedDrop(baseline: ScanBaselineFile, floor: number): number {
  return Math.max(baseline.threshold.minDrop, Math.ceil(floor * baseline.threshold.ratio));
}

/** 允许的最大增幅：超过它说明基线已经过期，需要按实测刷新。 */
function allowedGrowth(floor: number): number {
  return Math.ceil(floor * STALE_RATIO);
}

/** 绿区盲窗的四个读数，全部由当前基线实算，不写死。 */
export type SilentWindow = {
  /** 地板：低于它判塌陷。 */
  readonly floor: number;
  /** 过期线：高于它判基线过期。 */
  readonly staleLine: number;
  /** 两者之间的落差：这段里任何回落都不会红。 */
  readonly gap: number;
  /** `gap` 占基线的百分比（整数，四舍五入）。 */
  readonly percent: number;
};

/**
 * 绿区盲窗：地板到过期线之间这段，任何回落都不会红。
 *
 * 它是 `minDrop`/2% 与 `STALE_RATIO` 两个阈值的必然产物，不是遗漏。把读数打出来
 * 是为了让这个洞有数字、别只剩一句「只防塌陷」；收紧取舍见 `STALE_RATIO` 注释。
 */
export function silentWindow(floor: { readonly baseline: number; readonly allowed: number }): SilentWindow {
  const growth = allowedGrowth(floor.baseline);
  const lowest = floor.baseline - floor.allowed;
  const staleLine = floor.baseline + growth;
  return {
    floor: lowest,
    staleLine,
    gap: staleLine - lowest,
    percent: Math.round(((staleLine - lowest) / floor.baseline) * 100),
  };
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
  if (floor - actual > allowed) return { kind: 'breach', baseline: floor, allowed };
  if (actual - floor > allowedGrowth(floor)) {
    const overPercent = Math.round(((actual - floor) / floor) * 100);
    return { kind: 'stale', baseline: floor, allowed, overPercent };
  }
  return { kind: 'ok', baseline: floor, allowed };
}
