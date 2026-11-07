/**
 * 「读数来源是否诚实」的判定：拿不到 `debugSettingScale` 实测值时，**不许**用改前
 * 基线常量冒充本次读数继续跑。这个模块只做判定、不碰浏览器，便于单测把两种
 * 「拿不到」分开钉住：
 *
 *   · `missing` —— 环境不支持该钩子（旧构建 / 别的路径），报「判据前提不成立」；
 *   · `throw` / 值不合法 —— 钩子在、但读数异常，报「读数非法」并给出实际值。
 *
 * 唯一声明的例外：`SCALE_LABEL=before` 拍的就是旧构建，旧构建本来没有这个口子。
 * 那种情况不是「冒充实测」，而是「改前基线常量」本身，必须由脚本大声声明、
 * 且这张图的常量不参与任何「通过」判定。除此之外一律红。
 */

/** 渲染层 `SettingSceneryMetrics` 的五个字段（见 `src/render/setting-scale.ts`）。 */
export const REQUIRED_FIELDS = ['personH', 'shopfrontH', 'shopfrontTop', 'lampPostH', 'lampBodyBottom'];

/**
 * JSON 里「这是实测」的唯一来源标记。消费方只认它，不认「metrics 看起来像数字」。
 */
export const MEASURED_SOURCE = '渲染常量 setting-scale.ts（debugSettingScale 实测）';
/**
 * 改前基线常量的来源标记：它是画标尺用的基线，**不是读数**，不许参与任何做差/比较。
 */
export const BASELINE_SOURCE = '改前基线常量（非实测）';

/** 实际值怎么写进错误信息：JSON 优先，循环引用等退化到 String。 */
export function describeProbeValue(value) {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {{ status: 'missing' | 'throw' | 'value', detail?: string, value?: unknown }} probe
 * @param {{ label?: string }} [options]
 * @returns {{
 *   ok: boolean,
 *   code: 'missing' | 'invalid' | 'before-baseline' | 'ok',
 *   message: string,
 *   metrics: Record<string, number> | null,
 *   source: string,
 *   declared?: boolean,
 *   fromBaselineConstant?: boolean,
 * }}
 */
export function judgeSettingScaleProbe(probe, options = {}) {
  const label = options.label ?? 'after';

  if (probe.status === 'missing') {
    if (label === 'before') {
      return {
        ok: true,
        code: 'before-baseline',
        declared: true,
        message: `环境不支持 debugSettingScale（${probe.detail ?? '未说明'}）；改前旧构建本来就没有这个钩子`,
        metrics: null,
        source: BASELINE_SOURCE,
        fromBaselineConstant: true,
      };
    }
    return {
      ok: false,
      code: 'missing',
      message: `环境不支持 debugSettingScale：${probe.detail ?? '未说明'}`,
      metrics: null,
      source: '',
    };
  }

  if (probe.status === 'throw') {
    return {
      ok: false,
      code: 'invalid',
      message: `读数非法：debugSettingScale 抛异常：${probe.detail ?? '未说明'}`,
      metrics: null,
      source: '',
    };
  }

  const value = probe.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ok: false,
      code: 'invalid',
      message: `读数非法：debugSettingScale 返回 ${describeProbeValue(value)}（应为对象）`,
      metrics: null,
      source: '',
    };
  }

  const missing = [];
  const bad = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) {
      missing.push(field);
    } else if (!Number.isFinite(value[field]) || value[field] < 0) {
      bad.push(`${field}=${describeProbeValue(value[field])}`);
    }
  }
  if (missing.length > 0 || bad.length > 0) {
    const reasons = [];
    if (missing.length > 0) reasons.push(`缺字段 ${missing.join('/')}`);
    if (bad.length > 0) reasons.push(`非有限非负数 ${bad.join('、')}`);
    return {
      ok: false,
      code: 'invalid',
      message: `读数非法：debugSettingScale 返回 ${describeProbeValue(value)}（${reasons.join('；')}）`,
      metrics: null,
      source: '',
    };
  }

  return {
    ok: true,
    code: 'ok',
    message: '',
    metrics: {
      personH: value.personH,
      shopfrontH: value.shopfrontH,
      shopfrontTop: value.shopfrontTop,
      lampPostH: value.lampPostH,
      lampBodyBottom: value.lampBodyBottom,
    },
    source: MEASURED_SOURCE,
    fromBaselineConstant: false,
  };
}

/**
 * 消费方「把这份 JSON 当读数用」的唯一入口：来源不是实测就抛。
 *
 * 为什么不能只看 `metrics` 像不像数字：将来有人把基线常量抄进 `metrics`
 * 或改错 `metricsSource`，做出来的差会静默通过。只认 `MEASURED_SOURCE`
 * 且 `metricsFromBaselineConstant` 不为 `true`。
 *
 * @param {unknown} json 读回来的 `setting-scale-*.json`
 * @param {{ label?: string }} [options]
 * @returns {Record<string, number>}
 */
export function assertMeasuredReading(json, options = {}) {
  const label = options.label ?? '?';
  const record = json !== null && typeof json === 'object' ? /** @type {Record<string, unknown>} */ (json) : {};
  const measured =
    record.metricsFromBaselineConstant !== true &&
    record.metrics !== null &&
    typeof record.metrics === 'object' &&
    record.metricsSource === MEASURED_SOURCE;
  if (!measured) {
    throw new SettingScaleReadingError(
      `[判据前提不成立] 读数非法：${label} 的 metricsSource=${JSON.stringify(record.metricsSource)}、` +
        `metricsFromBaselineConstant=${JSON.stringify(record.metricsFromBaselineConstant)}，` +
        '不是 debugSettingScale 实测读数；不许拿它做差或与另一份读数比较',
    );
  }
  return /** @type {Record<string, number>} */ (record.metrics);
}

/** 消费方读到非实测来源时的红。名字单独导出，便于调用方只吞它、不吞别的错。 */
export class SettingScaleReadingError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SettingScaleReadingError';
  }
}
