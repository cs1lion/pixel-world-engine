import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * `audit-claims-state` 的正向样本：E7 要抓的三句「没坐标的状态句」，
 * 都取自 2026-11-08 真实出现在仓库文档里的原文。
 *
 * 模块不存在时必须红在**断言**上（`actual 'undefined'` / `expected 'function'`），
 * 不能是 `ERR_MODULE_NOT_FOUND`——后者会被 red-first 判成 `module`，不可采信（B7）。
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

/** 手写词表：不依赖磁盘上的 scripts 目录，夹具只钉判定本身。 */
const VOCAB: Vocabulary = {
  npmScripts: new Set(['fixture:check']),
  scriptNames: new Set(['check-ground-shadow', 'check-ground-shadow.mjs']),
};

const FIXTURE = [
  '# 夹具：必须命中的状态句',
  '',
  '### A 判据被写成过期读数',
  '',
  '`fixture:check` 当前 5/5 FAIL（100 断言 0 通过），不是绿闸。',
  '',
  '### B 同一件事的另一份副本',
  '',
  '当前 `fixture:check` 5/5 FAIL（100 断言 0 通过），owner 未认领。',
  '',
  '### C 没有数字的接线状态',
  '',
  '`check-ground-shadow` 仍不在 CI。',
  '',
].join('\n');

test('三段无坐标的状态句全部命中，且能指出是哪个状态词、哪个闸门', async () => {
  const scanStateClaimsInText = (await load()).scanStateClaimsInText!;
  const hits = scanStateClaimsInText({ file: 'docs/fixture.md', text: FIXTURE, vocab: VOCAB });

  assert.equal(hits.length, 3, '三段各命中一次，不多不少');

  assert.equal(hits[0]?.stateWord, '不是绿闸');
  assert.equal(hits[0]?.gateToken, 'fixture:check');
  assert.match(hits[0]?.section ?? '', /A 判据被写成过期读数/, '定位用小节标题，不用行号');

  assert.equal(hits[1]?.stateWord, '未认领');
  assert.equal(hits[1]?.gateToken, 'fixture:check');

  assert.equal(hits[2]?.stateWord, '不在 CI');
  assert.equal(hits[2]?.gateToken, 'check-ground-shadow', '裸闸门名必须能从 scripts 词表解析到');
});

test('数字本身不算坐标：`5/5` 不是 sha 也不是日期', async () => {
  const hasCoordinate = (await load()).hasCoordinate!;
  assert.equal(typeof hasCoordinate, 'function', '模块缺 hasCoordinate');
  assert.equal(hasCoordinate('`fixture:check` 当前 5/5 FAIL（100 断言 0 通过）'), false);
});
