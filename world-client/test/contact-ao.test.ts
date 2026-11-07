import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactAoUnknownBaseCount,
  lumaOf,
  resetContactAoUnknownBaseCount,
  shouldDrawContactAo,
} from '../src/render/contact-ao.ts';

/** 灯潮界的地形 token（与证据脚本的 TERRAIN_TOKENS 同值）。 */
const MUD = 0x202b35;
const GRASS = 0x30454a;
const STONE = 0x52666a;
const PLAZA = 0x7d8984;
const INK = 0x111821;
const CHARCOAL = 0x2c3439;

test('基底未知不许画，并记一次「取错落点」', () => {
  resetContactAoUnknownBaseCount();
  assert.equal(shouldDrawContactAo(undefined, INK), false, '不知道基底时不能把「不知道」当亮底放行');
  assert.equal(contactAoUnknownBaseCount(), 1);
  assert.equal(shouldDrawContactAo(undefined, INK), false);
  assert.equal(contactAoUnknownBaseCount(), 2);
  resetContactAoUnknownBaseCount();
  assert.equal(contactAoUnknownBaseCount(), 0);
});

test('已知基底时，ink 比所有地形都暗 → 每一档都画', () => {
  resetContactAoUnknownBaseCount();
  for (const base of [MUD, GRASS, STONE, PLAZA]) {
    assert.ok(lumaOf(INK) < lumaOf(base), `ink 应比 ${base.toString(16)} 暗`);
    assert.equal(shouldDrawContactAo(base, INK), true);
  }
  assert.equal(contactAoUnknownBaseCount(), 0, '已知基底不该计入「未知」');
});

test('阴影色比基底亮时不画，但不算「未知基底」', () => {
  resetContactAoUnknownBaseCount();
  assert.ok(lumaOf(CHARCOAL) > lumaOf(MUD));
  assert.equal(shouldDrawContactAo(MUD, CHARCOAL), false, '提亮语义错误：不产出矩形');
  assert.equal(contactAoUnknownBaseCount(), 0, '这是「提亮」分支，不是「取错落点」');
});

test('计数为 0 是默认状态：不调用判定就不涨', () => {
  resetContactAoUnknownBaseCount();
  assert.equal(contactAoUnknownBaseCount(), 0);
});
