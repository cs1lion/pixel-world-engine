/** 语义动作帧表的判据：动作 = 一类行为，全部由快照与世界时间推导。
 *
 * 动态 import + try/catch：本模块在 base 上不存在，red-first 只套 test/ diff，
 * 必须红在断言而不是 ERR_MODULE_NOT_FOUND（B7）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const actionBob = need('actionBob') as (a: string, f: number) => number;
const actionFrameRect = need('actionFrameRect') as (
  a: string, f: number, w: number, h: number,
) => { x: number; y: number; w: number; h: number };

const ACTION_IDS = mod['ACTION_IDS'] as readonly string[] | undefined;
const ACTION_ROWS = mod['ACTION_ROWS'] as readonly { action: string; row: number; colOffset: number; frames: number }[] | undefined;
const SHEET_COLS = mod['SHEET_COLS'] as number | undefined;
const SHEET_ROWS = mod['SHEET_ROWS'] as number | undefined;

test('六个语义动作、21 帧，全部落在 4×6 网格内', () => {
  assert.ok(Array.isArray(ACTION_IDS), 'ACTION_IDS 必须存在');
  assert.equal(ACTION_IDS!.length, 6);
  assert.ok(Array.isArray(ACTION_ROWS), 'ACTION_ROWS 必须存在');
  assert.equal(ACTION_ROWS!.reduce((n, r) => n + r.frames, 0), 21, '21 帧全有归属');
  assert.equal(SHEET_COLS, 4);
  assert.equal(SHEET_ROWS, 6);
  for (const row of ACTION_ROWS!) {
    assert.ok(row.row >= 0 && row.row < SHEET_ROWS!);
    assert.ok(row.colOffset + row.frames <= SHEET_COLS!, `${row.action} 不能越出网格`);
  }
  // 走路独占一行四帧：接触 / 下沉 / 经过 / 抬起。两帧读不出抬脚，
  // 屏幕上就是平移——这条判据守的就是那次的修复，别退回两帧。
  const walk = ACTION_ROWS!.find((r) => r.action === 'walk')!;
  assert.equal(walk.frames, 4, '走路要四帧');
  assert.equal(walk.colOffset, 0);
  assert.ok(!ACTION_ROWS!.some((r) => r.action === 'carry'), '不再有单独的搬运行');
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

test('快照 → 动作：走路只看 walking，拿东西也照常走', () => {
  assert.equal(actionOf({ mode: 'idle', walking: true, carrying: null }), 'walk');
  assert.equal(actionOf({ mode: 'toWork', walking: true, carrying: 'scroll' }), 'walk',
    '拿着东西也在走，不该切到另一套不摆动的帧');
  assert.equal(actionOf({ mode: 'working', walking: false, carrying: null }), 'work');
  assert.equal(actionOf({ mode: 'sheltering', walking: false, carrying: null }), 'rest');
  assert.equal(actionOf({ mode: 'delivering', walking: false, carrying: null }), 'cheer');
  assert.equal(actionOf({ mode: 'saluting', walking: false, carrying: null }), 'idle');
  assert.equal(actionOf({ mode: 'idle', walking: false, carrying: 'stone' }), 'pour');
  assert.equal(actionOf({ mode: 'idle', walking: false, carrying: null }), 'idle');
  // 走作息环线的人 mode 仍是 idle，但 path 不空 —— 表会漏、路不会。
  assert.equal(actionOf({ mode: 'idle', walking: true, carrying: null }), 'walk');
});

test('身体起伏跟着帧号走：走路的经过帧抬高 1px，不是整块抖', () => {
  const bobs = [0, 1, 2, 3].map((f) => actionBob('walk', f));
  assert.deepEqual(bobs, [0, -1, 0, -1], '走路四帧里两帧抬起');
  assert.equal(new Set(bobs).size, 2, '起伏要有两个档位，不能是常量');
  // 起伏必须与帧号一一对应且可循环：同一帧永远同一高度。
  assert.equal(actionBob('walk', 1), actionBob('walk', 5));
  assert.equal(actionBob('idle', 1), -1, '待机也有呼吸起伏');
  assert.equal(actionBob('work', 0), 0);
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


test('落地素材守门：七张动作表的走路行都是四帧，且腿动明显大于头动', () => {
  // 这一条守的是实测被指出的缺陷：第一版走路只有两帧、正面、腿几乎不动，
  // 屏幕上看就是平移。判据取自生成脚本对**实际像素**的测量，不是人工承诺。
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname ?? '.', '..', 'public', 'assets', 'manifest.json'), 'utf8'),
  ) as { assets: Record<string, { walkFilledCells?: number; walkLegOverHead?: number }> };
  const sheets = Object.entries(manifest.assets).filter(([key]) => key.startsWith('action/'));
  assert.ok(sheets.length >= 7, `动作表至少七张，实际 ${sheets.length}`);
  for (const [key, entry] of sheets) {
    assert.equal(entry.walkFilledCells, 4, `${key} 的走路行必须四帧都有内容`);
    assert.ok(
      typeof entry.walkLegOverHead === 'number' && entry.walkLegOverHead >= 1.2,
      `${key} 的腿/头比值 ${String(entry.walkLegOverHead)} 低于 1.2：抬脚读不出来，就是平移`,
    );
  }
});
