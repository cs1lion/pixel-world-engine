import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditSkillDoc } from '../scripts/audit-skill-docs.ts';

/**
 * skill 文档结构闸门的行为锁：三组「坏样例 → 必须报具体位置与原因」，
 * 每组都配一份同源的「应该通过」对照，证明它不是见谁都报。
 *
 * 只锁结构痕迹，不锁语义：判据写得对不对、证据是否真的支持那句话，
 * 本闸门读不懂，测试也不假装它懂。
 */

const doc = (lines: string[]): string => lines.join('\n');
const lineOf = (text: string, needle: string): number => {
  const i = text.split('\n').findIndex((l) => l.includes(needle));
  assert.ok(i >= 0, `夹具里找不到「${needle}」`);
  return i + 1;
};

/** 三件套齐全、互指成立、列与真值齐全、声称带证据。 */
const GOOD = doc([
  '# 示例 skill',
  '',
  '## 2 工作流程图',
  '',
  '```text',
  'T1: 读取说明 -> 产出清单',
  'T2: 跑脚本 -> 产出读数',
  '```',
  '',
  '## 3 任务清单',
  '',
  '| ID | 任务 | 输入 | 输出 | 入口 | 判据 | 状态 | owner |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| T1 | 读取说明 | skill 文件 | 清单 | [需人工] | 人看一遍 | [人工步骤] | cs1lion |',
  '| T2 | 跑脚本 | 清单 | 读数 | scripts/present.ts | exit 0 | [已实现] | agent |',
  '',
  '## 4 脚本清单',
  '',
  '| 脚本 | 入口命令 | 输入 | 输出 | 退出码含义 | 在 CI | 状态 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| scripts/present.ts | node scripts/present.ts | 清单 | 读数 | 0 通过 / 1 失败 | 否 | [已实现] |',
  '',
  '## 5 交付',
  '',
  '已验证：结构检查通过（5.1 自动验证：命令 node scripts/present.ts，exit 0）。',
]);

test('对照：三件套齐全的文档不报', () => {
  assert.deepEqual(auditSkillDoc('good.md', GOOD), []);
});

test('坏样例 1：任务清单漏 owner 列 → 报列名与表头行', () => {
  const bad = doc([
    '# 示例 skill',
    '',
    '## 2 工作流程图',
    '',
    '```text',
    'T1: 读取说明 -> 产出清单',
    'T2: 跑脚本 -> 产出读数',
    '```',
    '',
    '## 3 任务清单',
    '',
    '| ID | 任务 | 输入 | 输出 | 入口 | 判据 | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| T1 | 读取说明 | skill 文件 | 清单 | [需人工] | 人看一遍 | [人工步骤] |',
    '| T2 | 跑脚本 | 清单 | 读数 | scripts/present.ts | exit 0 | [已实现] |',
    '',
    '## 4 脚本清单',
    '',
    '| 脚本 | 入口命令 | 输入 | 输出 | 退出码含义 | 在 CI | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| scripts/present.ts | node scripts/present.ts | 清单 | 读数 | 0 通过 / 1 失败 | 否 | [已实现] |',
  ]);
  const f = auditSkillDoc('bad-missing-column.md', bad);
  assert.equal(f.length, 1, `只该报漏列，实际：${JSON.stringify(f)}`);
  assert.equal(f[0].code, 'MISSING_COLUMN');
  assert.match(f[0].message, /owner/);
  assert.equal(f[0].line, lineOf(bad, '| ID | 任务'), '位置应在任务表表头');
  assert.equal(f[0].file, 'bad-missing-column.md');
});

test('坏样例 2：互指指向不存在的条目 → 报节点、任务与脚本三处', () => {
  const bad = doc([
    '# 示例 skill',
    '',
    '## 2 工作流程图',
    '',
    '```text',
    'T1: 读取说明 -> 产出清单',
    'T3: 跑脚本 -> 产出读数',
    '```',
    '',
    '## 3 任务清单',
    '',
    '| ID | 任务 | 输入 | 输出 | 入口 | 判据 | 状态 | owner |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| T1 | 读取说明 | skill 文件 | 清单 | [需人工] | 人看一遍 | [人工步骤] | cs1lion |',
    '| T2 | 跑脚本 | 清单 | 读数 | scripts/missing.ts | exit 0 | [已实现] | agent |',
    '',
    '## 4 脚本清单',
    '',
    '| 脚本 | 入口命令 | 输入 | 输出 | 退出码含义 | 在 CI | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| scripts/present.ts | node scripts/present.ts | 清单 | 读数 | 0 通过 / 1 失败 | 否 | [已实现] |',
  ]);
  const f = auditSkillDoc('bad-dangling.md', bad);
  const by = (code: string) => f.find((x) => x.code === code);

  const dangling = by('DANGLING_FLOW_ID');
  assert.ok(dangling, `应报流程图节点没有任务条目：${JSON.stringify(f)}`);
  assert.match(dangling.message, /T3/);
  assert.equal(dangling.line, lineOf(bad, 'T3: 跑脚本'));

  const orphan = by('ORPHAN_TASK');
  assert.ok(orphan, `应报任务没有流程图节点：${JSON.stringify(f)}`);
  assert.match(orphan.message, /T2/);
  assert.equal(orphan.line, lineOf(bad, '| T2 |'));

  const script = by('DANGLING_SCRIPT_REF');
  assert.ok(script, `应报脚本引用不存在：${JSON.stringify(f)}`);
  assert.match(script.message, /missing\.ts/);
  assert.equal(script.line, lineOf(bad, '| T2 |'));

  assert.equal(f.length, 3, `只该报这三处：${JSON.stringify(f)}`);
});

test('坏样例 3：把 AI 评估写成「已验证」→ 报声称行与原因', () => {
  const bad = doc([
    '# 示例 skill',
    '',
    '## 2 工作流程图',
    '',
    '```text',
    'T1: 读取说明 -> 产出清单',
    'T2: 跑脚本 -> 产出读数',
    '```',
    '',
    '## 3 任务清单',
    '',
    '| ID | 任务 | 输入 | 输出 | 入口 | 判据 | 状态 | owner |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| T1 | 读取说明 | skill 文件 | 清单 | [需人工] | 人看一遍 | [人工步骤] | cs1lion |',
    '| T2 | 跑脚本 | 清单 | 读数 | scripts/present.ts | exit 0 | [已实现] | agent |',
    '',
    '## 4 脚本清单',
    '',
    '| 脚本 | 入口命令 | 输入 | 输出 | 退出码含义 | 在 CI | 状态 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| scripts/present.ts | node scripts/present.ts | 清单 | 读数 | 0 通过 / 1 失败 | 否 | [已实现] |',
    '',
    '## 5 交付',
    '',
    'AI 评估：内容覆盖完整，已验证（5.2）。',
  ]);
  const f = auditSkillDoc('bad-claim.md', bad);
  assert.equal(f.length, 1, `只该报这一处：${JSON.stringify(f)}`);
  assert.equal(f[0].code, 'CLAIM_WITHOUT_EVIDENCE');
  assert.match(f[0].message, /已验证/);
  assert.match(f[0].message, /5\.1/);
  assert.equal(f[0].line, lineOf(bad, 'AI 评估'));
});
