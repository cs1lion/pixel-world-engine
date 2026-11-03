/**
 * 日界对齐面板的模式门槛：默认的游玩时间驱动下**不提示、维护入口置灰**，
 * 并写明这回事只在 `?clock=real` 下可用。
 *
 * 只测纸面：检测本身（`inspectClockAlignment`）与场景门槛
 * （`clockAlignmentAvailable`）另有测试；这里钉的是「玩家看得到什么」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bindClockAlignPanel, type ClockAlignmentView, type ClockAlignOracle } from '../src/ui/clock-align.ts';
import { installFakeDom } from './fake-dom.ts';

const IDS = [
  'clock-align',
  'clock-align-text',
  'clock-align-yes',
  'clock-align-no',
  'clock-align-check',
  'clock-align-undo',
  'clock-align-readout',
];

function view(overrides: Partial<ClockAlignmentView> = {}): ClockAlignmentView {
  return {
    available: true,
    pending: false,
    required: false,
    boundaryLabel: '07:01',
    offsetMs: 0,
    deltaMs: 0,
    jumpLabel: '7 小时 1 分',
    dayLengthAfterLabel: '16 小时 59 分',
    aligned: false,
    undoAvailable: false,
    notice: null,
    dayNote: null,
    ...overrides,
  };
}

function oracle(read: () => ClockAlignmentView): ClockAlignOracle {
  return {
    clockAlignment: read,
    requestClockAlignmentCheck: read,
    applyClockAlignment: read,
    declineClockAlignment: read,
    undoClockAlignment: read,
  };
}

test('默认模式：不弹提示，检查入口置灰，读数写明只在 real 模式可用', () => {
  const dom = installFakeDom(IDS);
  const handle = bindClockAlignPanel(() => oracle(() => view({ available: false, pending: true })));
  try {
    assert.equal(dom.byId('clock-align').hidden, true, '默认模式不弹提示');
    assert.equal((dom.byId('clock-align-check') as unknown as HTMLButtonElement).disabled, true, '维护入口置灰');
    assert.match(dom.byId('clock-align-readout').textContent, /\?clock=real/, '读数说清可用范围');
  } finally {
    handle.dispose();
    dom.restore();
  }
});

test('real 模式：该提示就提示，检查入口可用', () => {
  const dom = installFakeDom(IDS);
  const handle = bindClockAlignPanel(() => oracle(() => view({ pending: true, required: true })));
  try {
    assert.equal(dom.byId('clock-align').hidden, false);
    assert.match(dom.byId('clock-align-text').textContent, /07:01/, '提示里写出日界相位');
    assert.match(dom.byId('clock-align-text').textContent, /7 小时 1 分/, '提示里写出前跳量');
    assert.equal((dom.byId('clock-align-check') as unknown as HTMLButtonElement).disabled, false);
    assert.equal(dom.byId('clock-align-undo').hidden, true, '没对齐过就没有撤销入口');
  } finally {
    handle.dispose();
    dom.restore();
  }
});
