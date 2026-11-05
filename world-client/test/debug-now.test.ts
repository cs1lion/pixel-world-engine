import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMinuteOfDay } from '../src/scenes/debug-now.ts';

test('?now= 收整数分钟：边界 0 与 1439 都合法', () => {
  assert.equal(parseMinuteOfDay('0'), 0);
  assert.equal(parseMinuteOfDay('495'), 495);
  assert.equal(parseMinuteOfDay('1439'), 1439);
});

test('?now= 没给：返回 undefined，交给调用方决定默认开局', () => {
  assert.equal(parseMinuteOfDay(null), undefined);
  assert.equal(parseMinuteOfDay(''), undefined);
  assert.equal(parseMinuteOfDay('   '), undefined);
});

test('?now= 越界明确失败，不静默回落到 00:00', () => {
  assert.throws(() => parseMinuteOfDay('-1'), /0\.\.1439/);
  assert.throws(() => parseMinuteOfDay('1440'), /0\.\.1439/);
  assert.throws(() => parseMinuteOfDay('99999'), /0\.\.1439/);
});

test('?now= 非整数明确失败', () => {
  assert.throws(() => parseMinuteOfDay('12.5'), /0\.\.1439/);
  assert.throws(() => parseMinuteOfDay('abc'), /0\.\.1439/);
});

test('?now= HH:MM 形式明确失败（已废弃，不再兼容）', () => {
  assert.throws(() => parseMinuteOfDay('10:00'), /HH:MM/);
  assert.throws(() => parseMinuteOfDay('06:30'), /HH:MM/);
});
