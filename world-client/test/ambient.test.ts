import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIENT_SLOT_MS,
  TIDE_BEAT_SLOTS,
  ambientBetween,
  slotOf,
  type AmbientDweller,
  type AmbientInput,
} from '../src/world/ambient.ts';

/**
 * 世界自己生事：没有谁下命令，镇子自己走到这一刻。
 *
 * 这一组钉三件事，正好对应 `ambient.ts` 开头那三条约束：
 *
 * 1. **限流靠时间槽**——同一槽里最多一件，跨槽那一拍才可能出；
 * 2. **纯函数**——同样输入两次得到同样输出，不读任何外部状态；
 * 3. **只报已经发生的事**——潮水跨没跨中线是判据，此刻在哪一侧不是。
 *
 * 第三条最容易被写成错的：判「此刻 ≥ 0.5」的话，潮水停在 0.51 的那几十个槽
 * 会反复报同一件事。
 *
 * 还有一条是实测补上的：**跨越要看整槽，不能看相邻两拍**。跨槽那一拍离槽首
 * 只差 100 毫秒，两读数法等于只在一个 100 毫秒的窗口里找跨越，而潮水半周期
 * 6 分钟才跨一次——三天里一个都碰不上。下面「整槽里跨过一次就报」那条钉它。
 */

const SLOT = AMBIENT_SLOT_MS;

/** 第 `n` 个槽走完的那一拍：`prevNow` 在槽 n 的末尾，`now` 在槽 n+1 的开头。 */
const straddle = (n: number): { prevNow: number; now: number } => ({
  prevNow: n * SLOT + SLOT - 1,
  now: (n + 1) * SLOT,
});

/** 一个节拍槽走完的那一拍——潮水只在这些槽里看。 */
const beat = straddle(TIDE_BEAT_SLOTS - 1);

/** 在第 `slot` 个槽的中线处跨过中线：之前 `from`，之后 `to`。 */
const crossingIn = (slot: number, from: number, to: number) => (t: number): number =>
  t < (slot - 0.5) * SLOT ? from : to;

/** 整槽平着走，不跨中线。 */
const flat = (level: number) => (): number => level;

const ALTAR = { placeId: 'place:9,9', where: { x: 9, y: 9 } };

const dweller: AmbientDweller = {
  id: 'v1',
  name: '汐',
  placeId: 'place:18,22',
  where: { x: 18, y: 22 },
  label: '在旧站牌下认路',
};

function input(over: Partial<AmbientInput> = {}): AmbientInput {
  return {
    ...beat,
    tideAt: flat(0.62),
    dwellers: [],
    tidePlace: ALTAR,
    ...over,
  };
}

test('同一槽里不出事——限流不是靠计数器，是靠时间槽', () => {
  // 放一个停在落点上的人：没有这一条，把时间槽闸拆掉这条也照样绿，
  // 因为空世界里本来就没东西可报——那就成了一个什么也没测的测试。
  const events = ambientBetween(input({ prevNow: 10, now: 20, dwellers: [dweller] }));
  assert.deepEqual(events, [], '槽还没走完就报了一件，一天下来会被刷满');
});

test('跨槽且整槽里潮水越过中线：报一次潮水掉头，方向对', () => {
  const rising = ambientBetween(input({ tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.49, 0.51) }));
  assert.equal(rising.length, 1);
  assert.equal(rising[0]!.kind, 'tide_turn');
  assert.match(rising[0]!.text, /涨/);
  assert.equal(rising[0]!.actorId, null, '潮水没有当事人');

  const falling = ambientBetween(input({ tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.51, 0.49) }));
  assert.equal(falling.length, 1);
  assert.equal(falling[0]!.kind, 'tide_turn');
  assert.match(falling[0]!.text, /退/);
});

test('整槽里跨过一次就报——不要求跨越正好落在槽首那 100 毫秒里', () => {
  // 跨越在槽的正中间，离槽首半小时。按「相邻两拍」写的实现会在这里一件都不报，
  // 而那是它唯一会看的那一拍。
  const events = ambientBetween(input({ tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.4, 0.6) }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'tide_turn');
});

test('潮水还在同一侧就不报——判的是「跨没跨过」，不是「此刻在哪一侧」', () => {
  // 整槽都在中线以上。按「此刻 ≥ 0.5」写的实现会在这里报一件，
  // 于是潮水停在 0.51 的几十个槽会反复说同一句话。
  assert.deepEqual(ambientBetween(input({ tideAt: flat(0.51) })), []);
});

test('潮水不在节拍槽里就让位：那一槽轮不到潮水，人声才进得来', () => {
  // 槽 1 里潮水照样跨了中线，但 1 % 8 !== 0。按「跨了就报」写，潮水一天报 240 次，
  // 每个槽都被它占满，下面那条日常一句也说不上。
  const crossing = crossingIn(1, 0.4, 0.6);
  assert.deepEqual(ambientBetween(input({ ...straddle(0), tideAt: crossing })), []);
  const events = ambientBetween(input({ ...straddle(0), tideAt: crossing, dwellers: [dweller] }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.kind, 'routine_done');
});

test('潮水没动静时，取第一个停在落点上的人', () => {
  const second: AmbientDweller = { ...dweller, id: 'v2', name: '雾', label: '点亮楼前的长灯' };
  const events = ambientBetween(input({ dwellers: [dweller, second] }));
  assert.equal(events.length, 1, '一个槽最多一件');
  assert.equal(events[0]!.kind, 'routine_done');
  assert.equal(events[0]!.text, '汐在旧站牌下认路', '文案用她的作息牌子，不是另编一句');
  assert.deepEqual(events[0]!.where, { x: 18, y: 22 });
  assert.equal(events[0]!.actorId, 'v1', '这件事是她做的，当事人得带上——不然她自己都记不住');
});

test('跨槽但潮水没跨线、也没人停着：什么也不报', () => {
  assert.deepEqual(ambientBetween(input()), []);
});

test('潮水那件事落在潮位给的落点上（有楼进水就报那栋楼）', () => {
  const events = ambientBetween(
    input({
      tideAt: crossingIn(TIDE_BEAT_SLOTS, 0.4, 0.6),
      tidePlace: { placeId: 'ferry_station#1', where: { x: 10, y: 10 } },
    }),
  );
  assert.equal(events[0]!.placeId, 'ferry_station#1');
  assert.deepEqual(events[0]!.where, { x: 10, y: 10 });
});

test('纯函数：同样输入两次，逐字相同', () => {
  const given = input({ tideAt: flat(0.62), dwellers: [dweller] });
  assert.deepEqual(ambientBetween(given), ambientBetween(given));
});

test('槽边界：正好落在边界上算新槽，差一毫秒不算', () => {
  assert.equal(slotOf(SLOT - 1), 0);
  assert.equal(slotOf(SLOT), 1);
  // 前一拍在边界上、这一拍还在同一槽里 → 不出事。
  assert.deepEqual(
    ambientBetween(input({ prevNow: SLOT, now: SLOT + 1, tideAt: flat(0.62), dwellers: [dweller] })),
    [],
  );
  // 前一拍差一毫秒到边界 → 跨槽，该出。
  assert.equal(
    ambientBetween(input({ prevNow: SLOT - 1, now: SLOT, tideAt: flat(0.62), dwellers: [dweller] }))
      .length,
    1,
  );
});
