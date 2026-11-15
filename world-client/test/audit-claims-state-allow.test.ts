import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * `audit-claims-state` 的反向样本：有坐标的、本身就是判据定义的、引用了别处坐标的，
 * 都**不许**命中；函数名 / 带行号的引用 / 裸单词也都不算闸门名。
 *
 * 第一版规则用「当前 / 现在 / 尚未」当状态词时，在现有文档上命中 51 段，
 * 几乎全是散文——规则一宽人就会开始忽略它。这两份夹具就是窄规则的守卫。
 *
 * 模块不存在时必须红在**断言**上，不能是 `ERR_MODULE_NOT_FOUND`（B7）。
 */

interface Vocabulary {
  npmScripts: ReadonlySet<string>;
  scriptNames: ReadonlySet<string>;
}

interface Hit {
  file: string;
  section: string;
  block: string;
  stateWord: string;
  gateToken: string;
  reason: string;
}

interface StateModule {
  scanStateClaimsInText?: (input: { file: string; text: string; vocab: Vocabulary }) => Hit[];
  hasCoordinate?: (block: string) => boolean;
}

const MODULE_PATH = new URL('../scripts/audit-claims-state.ts', import.meta.url).href;

async function load(): Promise<StateModule> {
  let mod: StateModule | null = null;
  let importError: unknown = null;
  try {
    mod = (await import(MODULE_PATH)) as unknown as StateModule;
  } catch (error) {
    importError = error;
  }
  assert.equal(
    typeof mod?.scanStateClaimsInText,
    'function',
    `模块缺 scanStateClaimsInText${importError === null ? '' : `：${importError instanceof Error ? importError.message : String(importError)}`}`,
  );
  assert.equal(importError, null, '模块缺 audit-claims-state：import 抛了错');
  return mod!;
}

const VOCAB: Vocabulary = {
  npmScripts: new Set(['fixture:check']),
  scriptNames: new Set(['check-ground-shadow', 'check-ground-shadow.mjs', 'check-lamp-band']),
};

const FIXTURE = [
  '# 反例：都不许命中',
  '',
  '### 有 sha 坐标',
  '',
  '`fixture:check` 不是绿闸的历史：`eafbcc3` 那次合并前留下的读数。',
  '',
  '### 有日期坐标',
  '',
  '2026-11-08 实测：`check-ground-shadow` 不在 CI，读数 6 条 / 195 项。',
  '',
  '### 本身就是判据定义',
  '',
  '判据＝`npm run fixture:check` 全绿；以它为准，不写会过期的数字。',
  '',
  '### 引用别处坐标',
  '',
  '`check-ground-shadow` 仍未接 CI，读数坐标见 V3「违反暴露」。',
  '',
  '### 不是闸门的标识符',
  '',
  '`checkPlacement` 仍未接 CI（这是函数名，不是闸门）。',
  '',
  '`check-scene-motion.mjs:35` 仍未接 CI（这是带行号的引用）。',
  '',
].join('\n');

test('反例全部不命中：坐标 / 判据定义 / 引用别处坐标 / 非闸门标识符', async () => {
  const scanStateClaimsInText = (await load()).scanStateClaimsInText!;
  const hits = scanStateClaimsInText({ file: 'docs/fixture.md', text: FIXTURE, vocab: VOCAB });
  assert.equal(hits.length, 0, `不该命中，实际命中 ${hits.length} 段：${hits.map((hit) => hit.block).join(' | ')}`);
});

test('sha 与 ISO 日期都算坐标，函数名与带行号的引用不算', async () => {
  const hasCoordinate = (await load()).hasCoordinate!;
  assert.equal(typeof hasCoordinate, 'function', '模块缺 hasCoordinate');
  assert.equal(hasCoordinate('见 `eafbcc3` 那次合并'), true, '7 位 hex 算坐标');
  assert.equal(hasCoordinate('2026-11-08 实测 6 条'), true, 'ISO 日期算坐标');
  assert.equal(hasCoordinate('`checkPlacement` 仍未接 CI'), false, '没有坐标就是没有坐标');
});
