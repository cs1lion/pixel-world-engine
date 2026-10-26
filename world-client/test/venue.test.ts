import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVenue, type VenueCandidate } from '../src/world/venue.ts';

const town = (kind: 'code' | 'research' | 'writing'): VenueCandidate => ({
  instanceId: `town-${kind}`,
  boundTask: kind,
  isWild: false,
  busy: false,
});

const wild = (kind: 'code' | 'research' | 'writing'): VenueCandidate => ({
  instanceId: `wild-${kind}`,
  boundTask: kind,
  isWild: true,
  busy: false,
});

/** 挑到了就报它挑到谁，没挑到就报为什么没挑到。 */
function why(pick: ReturnType<typeof pickVenue>): string {
  return pick.ok ? pick.venue.instanceId : pick.reason;
}

// ------------------------------------------------------------------ 事件流来的活去镇内

test('事件流来的活优先去镇内铺子：那是确定性的本地工作', () => {
  assert.equal(why(pickVenue([wild('code'), town('code')], 'code', 'feed')), 'town-code');
});

test('镇内铺子忙时，事件流来的活宁可排队也不去郊野', () => {
  const busyTown: VenueCandidate = { ...town('code'), busy: true };
  const picked = pickVenue([busyTown, wild('code')], 'code', 'feed');
  assert.equal(why(picked), 'busy', '事件流来的活不该被派到郊野');
});

// ------------------------------------------------------------------ 神谕活去郊野

test('神谕派的长活优先去郊野：那是探索性的外部工作', () => {
  assert.equal(why(pickVenue([town('research'), wild('research')], 'research', 'oracle')), 'wild-research');
});

test('郊野铺子忙时，神谕活退回镇内', () => {
  const busyWild: VenueCandidate = { ...wild('research'), busy: true };
  assert.equal(why(pickVenue([town('research'), busyWild], 'research', 'oracle')), 'town-research');
});

test('只有镇内铺子时，神谕活照样能派', () => {
  assert.equal(why(pickVenue([town('writing')], 'writing', 'oracle')), 'town-writing');
});

test('只有郊野铺子时，事件流来的活不去（宁可不动，也不假装在本地做）', () => {
  // 楼是有的、也空着，只是不在上游的活能去的那一侧。所以是 busy 不是 none——
  // 说「这座镇子没有接 code 的铺子」在这里是假话。
  assert.equal(why(pickVenue([wild('code')], 'code', 'feed')), 'busy');
});

// ---------------------------------------------- 没有铺子，与铺子都忙着：两句不同的话

test('一座铺子都不接这类活时，说的是「没有」不是「没有空闲的」', () => {
  // 这一条钉的是灯潮界：六栋楼 boundTask 全是 null。原来的实现在这里返回 null，
  // 调用方只有一句话可说——「没有空闲的 code 铺子」。那句话告诉用户
  // 「有，只是忙」，而它一栋都没有。用户于是去找一座不存在的铺子。
  const picked = pickVenue([town('code'), wild('research')], 'writing', 'feed');
  assert.equal(why(picked), 'none');
  assert.equal(pickVenue([], 'code', 'oracle').ok, false);
});

test('「没有」与「都忙着」分得开：忙是楼的事，没有是镇子的事', () => {
  const none = pickVenue([town('code')], 'research', 'feed');
  const busy = pickVenue([{ ...town('research'), busy: true }], 'research', 'feed');
  assert.equal(why(none), 'none');
  assert.equal(why(busy), 'busy');
});

test('楼都忙着也是「有，只是腾不出手」，不是「没有」', () => {
  const picked = pickVenue(
    [{ ...town('code'), busy: true }, { ...wild('code'), busy: true }],
    'code',
    'oracle',
  );
  assert.equal(why(picked), 'busy');
});

// ------------------------------------------------------------------ 边界

test('活类型对不上时不会乱派', () => {
  assert.equal(pickVenue([town('code')], 'research', 'feed').ok, false);
  assert.equal(pickVenue([], 'code', 'oracle').ok, false);
});

test('同类多个候选时取第一个可用的，顺序稳定', () => {
  const a = town('code');
  const b: VenueCandidate = { ...town('code'), instanceId: 'town-code-2' };
  assert.equal(why(pickVenue([a, b], 'code', 'feed')), 'town-code');
  const aBusy: VenueCandidate = { ...a, busy: true };
  assert.equal(why(pickVenue([aBusy, b], 'code', 'feed')), 'town-code-2');
});
