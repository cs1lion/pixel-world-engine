/** 语义动作帧表的判据：动作 = 一类行为，全部由快照与世界时间推导。
 *
 * 动态 import + try/catch：本模块在 base 上不存在，red-first 只套 test/ diff，
 * 必须红在断言而不是 ERR_MODULE_NOT_FOUND（B7）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

let mod: Record<string, unknown> = {};
try {
  mod = (await import('../src/render/action-frames.ts')) as unknown as Record<string, unknown>;
} catch {
  // 缺文件本身就是「实现还没落地」，交给下面的 typeof 断言判。
}

const need = (name: string): unknown => {
  assert.equal(typeof mod[name], 'function', `${name} 必须存在`);
  return mod[name];
};

const actionOf = need('actionOf') as (s: {
  mode: string; walking: boolean; carrying: string | null;
}) => string;
const actionFrameAt = need('actionFrameAt') as (a: string, ms: number) => number;
const actionFrameCount = need('actionFrameCount') as (a: string) => number;
const actionFrameName = need('actionFrameName') as (a: string, f: number) => string;
const actionFrameRect = need('actionFrameRect') as (
  a: string, f: number, w: number, h: number,
) => { x: number; y: number; w: number; h: number };

const ACTION_IDS = mod['ACTION_IDS'] as readonly string[] | undefined;
const ACTION_ROWS = mod['ACTION_ROWS'] as readonly { action: string; row: number; colOffset: number; frames: number }[] | undefined;
const SHEET_COLS = mod['SHEET_COLS'] as number | undefined;
const SHEET_ROWS = mod['SHEET_ROWS'] as number | undefined;

test('七个语义动作、21 帧，全部落在 4×6 网格内', () => {
  assert.ok(Array.isArray(ACTION_IDS), 'ACTION_IDS 必须存在');
  assert.equal(ACTION_IDS!.length, 7);
  assert.ok(Array.isArray(ACTION_ROWS), 'ACTION_ROWS 必须存在');
  assert.equal(ACTION_ROWS!.reduce((n, r) => n + r.frames, 0), 21, '21 帧全有归属');
  assert.equal(SHEET_COLS, 4);
  assert.equal(SHEET_ROWS, 6);
  for (const row of ACTION_ROWS!) {
    assert.ok(row.row >= 0 && row.row < SHEET_ROWS!);
    assert.ok(row.colOffset + row.frames <= SHEET_COLS!, `${row.action} 不能越出网格`);
  }
  // walk 与 carry 共享第 1 行、各占两帧，不重复不重叠。
  const walk = ACTION_ROWS!.find((r) => r.action === 'walk')!;
  const carry = ACTION_ROWS!.find((r) => r.action === 'carry')!;
  assert.equal(walk.row, carry.row);
  assert.equal(walk.colOffset + walk.frames, carry.colOffset);
});

test('帧名与帧矩形都按各自帧数循环，负数也不越界', () => {
  for (const action of ACTION_IDS!) {
    const count = actionFrameCount(action);
    assert.ok(count >= 2 && count <= 4, `${action} 的帧数应在 2..4`);
    assert.equal(actionFrameName(action, 0), actionFrameName(action, count));
    assert.equal(actionFrameName(action, -1), actionFrameName(action, count - 1));
    const rect = actionFrameRect(action, count + 1, 100, 120);
    assert.equal(rect.w, 100);
    assert.equal(rect.h, 120);
    assert.ok(rect.x >= 0 && rect.x <= 3 * 100);
    assert.ok(rect.y >= 0 && rect.y <= 5 * 120);
  }
});

test('快照 → 动作：走路只看 walking，搬运看 carrying', () => {
  assert.equal(actionOf({ mode: 'idle', walking: true, carrying: null }), 'walk');
  assert.equal(actionOf({ mode: 'toWork', walking: true, carrying: 'scroll' }), 'carry');
  assert.equal(actionOf({ mode: 'working', walking: false, carrying: null }), 'work');
  assert.equal(actionOf({ mode: 'sheltering', walking: false, carrying: null }), 'rest');
  assert.equal(actionOf({ mode: 'delivering', walking: false, carrying: null }), 'cheer');
  assert.equal(actionOf({ mode: 'saluting', walking: false, carrying: null }), 'idle');
  assert.equal(actionOf({ mode: 'idle', walking: false, carrying: 'stone' }), 'pour');
  assert.equal(actionOf({ mode: 'idle', walking: false, carrying: null }), 'idle');
  // 走作息环线的人 mode 仍是 idle，但 path 不空 —— 表会漏、路不会。
  assert.equal(actionOf({ mode: 'idle', walking: true, carrying: null }), 'walk');
});

test('帧号只由世界时间推导：同一输入逐次相同，冻结后不动', () => {
  for (const action of ACTION_IDS!) {
    assert.equal(actionFrameAt(action, 5000), actionFrameAt(action, 5000));
    assert.equal(actionFrameAt(action, 5000), actionFrameAt(action, 5000), '第二次读也不能变');
  }
  // 同一时刻跨动作可不同（帧数不同），但每个动作自己确定性。
  const frozen = actionFrameAt('work', 12345);
  assert.equal(actionFrameAt('work', 12345), frozen, '世界冻住时帧号不许漂');
  assert.notEqual(actionFrameAt('work', 12345 + 1000 / 12), frozen,
    '推进一帧步长后应当换帧');
});
