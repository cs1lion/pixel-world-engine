import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * B1 棘轮：天花板是政策常数，不是实测值。
 *
 * 为什么需要这条测试：`check-render-budget` / `check-ground-shadow` 只拿当次读数
 * 与写死的常量比较，把常量改大不会被任何检查拦住（K8）。这里把「已批准上限」
 * 放进 `scripts/policy-ceilings.json`，并要求脚本里的常量不得大于它。
 *
 * 拦得住：
 *  - 任何超过已批准值的上调，哪怕只改脚本里一个数字，默认路径就红；
 *  - 记录缺少 approved_at / approved_by / reason 时红 —— 抬升必须留下显式痕迹。
 *
 * 拦不住（如实写）：
 *  - 运行时 env 覆盖（`GROUND_SHADOW_PEAK_CEILING` / `RENDER_BUDGET_FORCE_COMMANDS`）
 *    本来就绕过常量；本测试只锁提交里的常量。
 *  - 先降到已批准值以下、再涨回原值（仍 ≤ 已批准值）。要堵这个口就得要求每次下调
 *    都同步改记录，那会把「降低」也变麻烦，故不做。
 *  - 记录里的 reason 是否属实：测试只能保证痕迹存在，不能判断理由真假。
 *  - 「降」不会自动写回记录：下调后记录仍停在旧值，本测试只提示可以收紧。
 */

const RECORD_URL = new URL('../scripts/policy-ceilings.json', import.meta.url);

type Entry = {
  value: number;
  approved_at: string;
  approved_by: string;
  reason: string;
};

const readRecord = (): Record<string, Entry> =>
  JSON.parse(readFileSync(RECORD_URL, 'utf8')) as Record<string, Entry>;

/** 纯函数，便于反向用例直接验证「上调必红 / 降与持平不红」。 */
const evaluate = (name: string, current: number, record: Record<string, Entry>) => {
  const entry = record[name];
  if (!entry) {
    return {
      ok: false,
      message: `${name} 不在 scripts/policy-ceilings.json：新增天花板必须先登记，再写进脚本。`,
    };
  }
  if (current > entry.value) {
    return {
      ok: false,
      message:
        `${name} 从 ${entry.value} 上调到 ${current}：未获批准的抬升。`
        + '这是政策常数，不是实测值；要抬升必须在同一次提交里改 scripts/policy-ceilings.json，'
        + '并填写 approved_at / approved_by / reason —— 只改脚本里的数字不算留下痕迹。',
    };
  }
  return { ok: true, message: '' };
};

const extract = (file: string, pattern: RegExp, name: string) => {
  const source = readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
  const literal = source.match(pattern)?.[1];
  assert.ok(
    literal,
    `${file} 里找不到 ${name} 的常量字面量。改名或换了写法时必须同步本测试与 policy-ceilings.json。`,
  );
  return Number(literal.replaceAll('_', ''));
};

const constants = () => ({
  MAX_COMMANDS_CEILING: extract(
    'check-render-budget.mjs',
    /const MAX_COMMANDS_CEILING = ([\d_]+);/,
    'MAX_COMMANDS_CEILING',
  ),
  GROUND_SHADOW_PEAK_CEILING: extract(
    'check-ground-shadow.mjs',
    /const PEAK_CEILING = Number\(process\.env\.GROUND_SHADOW_PEAK_CEILING \?\? ([\d_]+)\);/,
    'PEAK_CEILING',
  ),
});

describe('B1 天花板棘轮', () => {
  it('每条天花板都在记录里，且抬升痕迹字段齐全', () => {
    const record = readRecord();
    for (const name of Object.keys(constants())) {
      const entry = record[name];
      assert.ok(entry, `${name} 没有登记在 scripts/policy-ceilings.json。`);
      assert.ok(Number.isInteger(entry.value) && entry.value > 0, `${name} 的 value 必须是正整数。`);
      assert.match(entry.approved_at, /^\d{4}-\d{2}-\d{2}$/, `${name} 的 approved_at 必须是 YYYY-MM-DD。`);
      assert.ok(entry.approved_by.trim().length > 0, `${name} 的 approved_by 不能为空。`);
      assert.ok(entry.reason.trim().length >= 10, `${name} 的 reason 必须写清依据（至少 10 字）。`);
    }
  });

  it('脚本常量不得超过已批准上限（改大常量会红）', () => {
    const record = readRecord();
    for (const [name, current] of Object.entries(constants())) {
      const verdict = evaluate(name, current, record);
      assert.ok(verdict.ok, verdict.message);
      if (current < (record[name] as Entry).value) {
        console.log(
          `[提示] ${name} 当前 ${current} 低于已批准 ${(record[name] as Entry).value}，可顺手收紧记录。`,
        );
      }
    }
  });

  it('反向用例：上调必红、持平与下调不红', () => {
    const record = { FLOOR: { value: 100, approved_at: '2026-03-01', approved_by: 'x', reason: 'y'.repeat(10) } };
    const raised = evaluate('FLOOR', 101, record);
    assert.equal(raised.ok, false);
    assert.match(raised.message, /这是政策常数，不是实测值/);
    assert.match(raised.message, /approved_at \/ approved_by \/ reason/);
    assert.equal(evaluate('FLOOR', 100, record).ok, true);
    assert.equal(evaluate('FLOOR', 99, record).ok, true);
    assert.equal(evaluate('MISSING', 1, record).ok, false);
  });
});
