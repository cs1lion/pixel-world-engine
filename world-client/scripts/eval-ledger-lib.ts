/**
 * 指标账本的校验器。它不量世界，只保证每个读数**说清楚自己从哪来**：
 * `seed / weather / rainSeed / denominator / source / script_sha / judge` 缺一即红。
 *
 * 为什么这几项必须强制：
 * - 同一节里出现过两套数（76.9/1.8 与 75.9/3.9），因为没钉天气与雨滴种子；
 * - 判据带曾把「列级判光阈值 1pp」当成两次运行的显著性阈，还写出脚本里不存在的
 *   0.08pp——根因都是读数缺分母、缺生成脚本。
 *
 * `script` 字段可选；一旦填了，就按当前文件的 sha256 复核，脚本改了而读数没重测，
 * 账本会红。外部证据树（pwe-soak）的生成脚本未提交，`script_sha` 必须写
 * `not_measured`，不许填一个看起来像哈希的值。
 *
 * 哈希对**内容**算，先做行尾归一化（CRLF → LF）：仓库开了 `core.autocrlf=true`，
 * 检出到 Windows 工作树是 CRLF、索引里是 LF，同一份脚本在不同 checkout 上字节数
 * 不同。若直接对工作树字节算 sha256，同一账本里就会出现 CRLF 与 LF 两套哈希，
 * 任何 checkout 都无法同时满足（曾经就是这样红掉的）。归一化只影响哈希口径，
 * 不改仓库行尾策略，也不动 `.gitattributes`。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const REQUIRED_FIELDS = [
  'id',
  'value',
  'unit',
  'seed',
  'weather',
  'rainSeed',
  'denominator',
  'source',
  'script_sha',
  'judge',
  'measured_at',
  'gate',
] as const;

export const JUDGES = ['program', 'human-rubric'] as const;
export const GATES = ['ci-pr', 'ci-nightly', 'release'] as const;
const NOT_MEASURED = 'not_measured';
const HASH = /^[0-9a-f]{64}$/;
const EXTERNAL_SOURCE = 'pwe-soak/';

export interface LedgerMetric {
  readonly [key: string]: unknown;
}

export interface LedgerDocument {
  readonly version: number;
  readonly generated: string;
  readonly metrics: readonly LedgerMetric[];
}

export interface LedgerValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly metrics: number;
}

/** 内容哈希：先 CRLF → LF 归一化，跨 checkout 稳定。生成端必须用同一个函数。 */
export function sha256OfContent(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}

export function sha256OfFile(path: string): string {
  return sha256OfContent(readFileSync(path, 'utf8'));
}

export function validateLedger(document: unknown, worldClientRoot: string): LedgerValidation {
  const errors: string[] = [];
  if (typeof document !== 'object' || document === null) {
    return { ok: false, errors: ['账本不是对象'], metrics: 0 };
  }
  const doc = document as LedgerDocument;
  if (doc.version !== 1) errors.push('version 必须是 1');
  if (typeof doc.generated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.generated)) {
    errors.push('generated 必须是 YYYY-MM-DD');
  }
  const metrics = doc.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) {
    return { ok: false, errors: [...errors, 'metrics 必须是非空数组'], metrics: 0 };
  }

  const seen = new Set<string>();
  metrics.forEach((metric, index) => {
    const where = `metrics[${index}]`;
    for (const field of REQUIRED_FIELDS) {
      if (!(field in metric)) errors.push(`${where} 缺必填字段 ${field}`);
    }
    const id = metric.id;
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`${where} id 必须是非空字符串`);
    } else if (seen.has(id)) {
      errors.push(`${where} id 重复：${id}`);
    } else {
      seen.add(id);
    }

    const value = metric.value;
    if (typeof value !== 'number' && value !== NOT_MEASURED) {
      errors.push(`${where} value 只能是数字或 "${NOT_MEASURED}"`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      errors.push(`${where} value 不是有限数`);
    }
    if (value === 0 && metric.source === NOT_MEASURED) {
      errors.push(`${where} 没量过就写 "${NOT_MEASURED}"，不许用 0 占位`);
    }
    if (value === NOT_MEASURED && typeof metric.note !== 'string') {
      errors.push(`${where} value=not_measured 时必须写 note 说明为什么没量`);
    }

    for (const field of ['seed', 'weather', 'rainSeed', 'denominator', 'source'] as const) {
      const raw = metric[field];
      if (typeof raw !== 'string' || raw.trim() === '') {
        errors.push(`${where} ${field} 必须是非空字符串`);
      }
    }
    if (typeof metric.denominator === 'string' && metric.denominator.trim() === NOT_MEASURED &&
      value !== NOT_MEASURED) {
      errors.push(`${where} 有读数却没有分母`);
    }

    if (!JUDGES.includes(metric.judge as (typeof JUDGES)[number])) {
      errors.push(`${where} judge 必须是 ${JUDGES.join('/')}`);
    }
    if (!GATES.includes(metric.gate as (typeof GATES)[number])) {
      errors.push(`${where} gate 必须是 ${GATES.join('/')}`);
    }
    if (typeof metric.measured_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(metric.measured_at)) {
      errors.push(`${where} measured_at 必须是 YYYY-MM-DD`);
    }

    const scriptSha = metric.script_sha;
    if (typeof scriptSha !== 'string' || (scriptSha !== NOT_MEASURED && !HASH.test(scriptSha))) {
      errors.push(`${where} script_sha 必须是 64 位小写 sha256 或 "${NOT_MEASURED}"`);
    } else if (typeof metric.script === 'string') {
      const scriptPath = isAbsolute(metric.script)
        ? metric.script
        : resolve(worldClientRoot, metric.script);
      try {
        const actual = sha256OfFile(scriptPath);
        if (scriptSha !== actual) {
          errors.push(`${where} script_sha 与 ${metric.script} 当前内容不一致（脚本改过，读数需重测）`);
        }
      } catch {
        errors.push(`${where} script 指向的文件不存在：${metric.script}`);
      }
    }

    // 外部来源（pwe-soak 证据树）必须钉住输入：要么给 input_sha，要么明说没量、并写原因。
    // 起因：12 条 soak 读数只写了「来自 pwe-soak 的某个提交」，没人能证明读的是哪份输入。
    const source = typeof metric.source === 'string' ? metric.source : '';
    const note = typeof metric.note === 'string' ? metric.note : '';
    const inputSha = metric.input_sha;
    if (typeof inputSha === 'string' && !HASH.test(inputSha)) {
      errors.push(`${where} input_sha 必须是 64 位小写 sha256`);
    }
    if (source.startsWith(EXTERNAL_SOURCE) || note.includes('pwe-soak')) {
      const inputStatus = metric.input_status;
      if (typeof inputSha === 'string' && HASH.test(inputSha)) {
        // 已钉住输入，放行
      } else if (inputStatus === NOT_MEASURED) {
        if (typeof metric.input_note !== 'string' || metric.input_note.trim() === '') {
          errors.push(`${where} input_status="${NOT_MEASURED}" 时必须写 input_note 说明为什么不可判`);
        }
      } else {
        errors.push(
          `${where} 外部来源（pwe-soak）必须给 input_sha（64 位小写 sha256）` +
          `或 input_status="${NOT_MEASURED}" + input_note`,
        );
      }
    }
  });

  return { ok: errors.length === 0, errors, metrics: metrics.length };
}

export function loadLedger(repoRoot: string): unknown {
  return JSON.parse(readFileSync(resolve(repoRoot, 'eval/ledger.json'), 'utf8'));
}
