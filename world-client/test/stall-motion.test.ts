import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STALL_MOTION_OFF,
  STALL_MOTION_ON,
  stallClothSwayAt,
  stallCoverSwayAt,
  stallFireAt,
} from '../src/world/stall-motion.ts';

/** 世界日的第 minute 分钟。 */
const atMinute = (minute: number): number => minute * 60_000;

test('棚布风摆：幅度不超过 1px，且真的在动', () => {
  const samples = Array.from({ length: 30 }, (_, i) => stallClothSwayAt(atMinute(20) + i * 3_000, 0));
  assert.ok(samples.every((value) => Math.abs(value.dx) <= 1), '棚布只横移 1px');
  assert.ok(samples.every((value) => value.lift === Math.abs(value.dx)), '抬起量与横移同档');
  assert.ok(new Set(samples.map((value) => value.dx)).size > 1, '棚布必须真的在摆');
});

test('棚布风摆：不同摊子错开相位，不是整排同手同脚', () => {
  const a = stallClothSwayAt(atMinute(20), 0);
  const b = stallClothSwayAt(atMinute(20), 1);
  assert.notDeepEqual(a, b);
});

test('盖布风摆：同样 ≤1px，下垂只在下摆时多 1px', () => {
  for (let i = 0; i < 30; i += 1) {
    const sway = stallCoverSwayAt(atMinute(21) + i * 3_000, 2);
    assert.ok(Math.abs(sway.dx) <= 1);
    assert.equal(sway.droop, sway.dx === 0 ? 0 : 1);
  }
});

test('盖布与棚布不同相：同一时刻不会给出同一个摆法', () => {
  const cloth = stallClothSwayAt(atMinute(20), 0);
  const cover = stallCoverSwayAt(atMinute(20), 0);
  assert.ok(cloth.dx !== cover.dx || cloth.lift !== cover.droop);
});

test('火光：亮度落在 0.6–1.0、焰高 2–4px，四秒内会变', () => {
  const samples = Array.from({ length: 24 }, (_, i) => stallFireAt(atMinute(20) + i * 500, 3));
  assert.ok(samples.every((value) => value.level >= 0.6 && value.level <= 1));
  assert.ok(samples.every((value) => value.height >= 2 && value.height <= 4));
  assert.ok(new Set(samples.map((value) => value.level)).size > 1, '火光必须真的在跳');
});

test('火光：不同摊子相位错开', () => {
  const a = stallFireAt(atMinute(20), 0);
  const b = stallFireAt(atMinute(20), 4);
  assert.notDeepEqual(a, b);
});

test('确定性：同一世界时刻必得同一组读数', () => {
  const now = atMinute(20) + 7_000;
  for (const order of [0, 3, 5]) {
    assert.deepEqual(stallClothSwayAt(now, order), stallClothSwayAt(now, order));
    assert.deepEqual(stallCoverSwayAt(now, order), stallCoverSwayAt(now, order));
    assert.deepEqual(stallFireAt(now, order), stallFireAt(now, order));
  }
});

test('开关：全关时三支都退成常量（渲染层据此取 0 帧差对照）', () => {
  assert.equal(STALL_MOTION_OFF.cloth, false);
  assert.equal(STALL_MOTION_OFF.fire, false);
  assert.equal(STALL_MOTION_ON.cloth, true);
  assert.equal(STALL_MOTION_ON.fire, true);
});
