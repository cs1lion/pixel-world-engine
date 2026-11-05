import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKGROUND_FLOOR_FPS,
  MIN_BACKGROUND_DIVISOR,
  backgroundThrottleOk,
} from '../scripts/render-budget-threshold.ts';

/**
 * 「切到后台真的降频」判据的双条件单测。
 *
 * 规则：`back < front` 且（`back <= front / 3` 或 `back <= 12`）。
 * 12 帧是**地板**——低于它已经不需要再证明降频；比例条件一个字没放宽。
 *
 * 用例里的 `oldRuleOk` 是旧判据（只有 `back <= front / 3`）的结果，
 * 用来证明 (19, 10) 这条在慢 runner 上是**旧规则假红**，而不是代码退化。
 */
const oldRuleOk = (front: number, back: number): boolean => back <= front / MIN_BACKGROUND_DIVISOR;

interface Case {
  readonly label: string;
  readonly front: number;
  readonly back: number;
  readonly expected: boolean;
  readonly oldRule: boolean;
}

const CASES: readonly Case[] = [
  // 慢 runner：前台本身只有 19 帧，后台 10 帧已经是明显降载。
  // 旧规则要求 ≤ 6.33 才过 → 假红。
  { label: '慢 runner (19, 10)', front: 19, back: 10, expected: true, oldRule: oldRuleOk(19, 10) },
  // 快机：比例条件本身满足。
  { label: '快机 (60, 11)', front: 60, back: 11, expected: true, oldRule: oldRuleOk(60, 11) },
  // 不降载：后台几乎和前台一样快。
  { label: '不降载 (60, 58)', front: 60, back: 58, expected: false, oldRule: oldRuleOk(60, 58) },
  // 半降载：21 > 20 且 21 > 12，两条都不满足 → 红。
  { label: '半降载 (60, 21)', front: 60, back: 21, expected: false, oldRule: oldRuleOk(60, 21) },
  // 边界：20 恰好等于 60/3 → 过。
  { label: '边界 (60, 20)', front: 60, back: 20, expected: true, oldRule: oldRuleOk(60, 20) },
  // 边界：12.5 既 > 12 又 > 37/3 ≈ 12.33 → 红。
  { label: '边界 (37, 12.5)', front: 37, back: 12.5, expected: false, oldRule: oldRuleOk(37, 12.5) },
];

test('后台降频判据：双条件（比例 或 12 帧地板）', () => {
  console.log(
    `背景降频判据：back < front 且（back <= front/${MIN_BACKGROUND_DIVISOR} 或 back <= ${BACKGROUND_FLOOR_FPS}）`,
  );
  for (const item of CASES) {
    const actual = backgroundThrottleOk(item.front, item.back);
    console.log(
      `${actual === item.expected ? 'ok  ' : 'FAIL'} ${item.label} → ${actual}`
        + `（旧规则 ${item.oldRule}）`,
    );
    assert.equal(
      actual,
      item.expected,
      `${item.label}：期望 ${item.expected}，实际 ${actual}（旧规则 ${item.oldRule}）`,
    );
  }
});

test('(19, 10) 是旧规则的假红：新规则放行、旧规则不放行', () => {
  assert.equal(backgroundThrottleOk(19, 10), true);
  assert.equal(oldRuleOk(19, 10), false, '如果这里变 true，说明旧规则用例站不住，需要重写证据');
});

test('地板不放宽「后台必须比前台慢」这条', () => {
  // 前台已经低于地板时，后台必须严格更慢；相等或更快都红。
  assert.equal(backgroundThrottleOk(11, 11), false, '相等不算降频');
  assert.equal(backgroundThrottleOk(11, 12), false, '后台比前台快不算降频');
  assert.equal(backgroundThrottleOk(11, 10.5), true);
  assert.equal(backgroundThrottleOk(Number.NaN, 5), false, '非有限数直接红');
});
