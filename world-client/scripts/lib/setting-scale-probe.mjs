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
        source: '改前基线常量（旧构建无 debugSettingScale；不参与判定）',
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
    source: '渲染常量 setting-scale.ts（debugSettingScale 实测）',
  };
}
