/**
 * 离线那一侧也要开得了一道门。
 *
 * 渡有仪式此前只有一个入口：模型的 `carry` 意图。没有 API Key 时
 * `matchRules` 认不出「给汐一盏灯」，那句话落进 unknown——门还在，
 * 凭证给不出去，她一辈子进不去叠浪楼。一个只有模型能用的机制，
 * 等于离线世界里没有这个机制。
 *
 * 这里只测**解析**：这句话翻成了什么意图。翻出来的名字世界上有没有、
 * 是不是指着两个人，是世界结算时的事（`villagerNamed`），不在这里重复。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOracleCarry, CARRY_WORDS } from '../src/world/oracle-carry.ts';
import { CARRY_ITEMS } from '../src/world/gate.ts';

// ------------------------------------------------------------------ 给

test('给谁一盏灯：动词打头的三种写法都认', () => {
  assert.deepEqual(parseOracleCarry('给汐一盏灯'), { villager: '汐', carries: ['lamp'] });
  assert.deepEqual(parseOracleCarry('送汐一盏灯'), { villager: '汐', carries: ['lamp'] });
  assert.deepEqual(parseOracleCarry('递给汐一盏灯'), { villager: '汐', carries: ['lamp'] });
});

test('东西打头也认：把一盏灯给汐', () => {
  assert.deepEqual(parseOracleCarry('把一盏灯给汐'), { villager: '汐', carries: ['lamp'] });
  assert.deepEqual(parseOracleCarry('把那双鞋送给迷路人'), { villager: '迷路人', carries: ['shoes'] });
});

test('礼貌前缀与句尾标点都剥得掉', () => {
  assert.deepEqual(parseOracleCarry('帮我给汐一盏灯'), { villager: '汐', carries: ['lamp'] });
  assert.deepEqual(parseOracleCarry('麻烦递给汐一盏灯。'), { villager: '汐', carries: ['lamp'] });
  assert.deepEqual(parseOracleCarry('给汐一盏灯吧！'), { villager: '汐', carries: ['lamp'] });
});

test('两种凭证分得开：灯是灯，鞋是鞋', () => {
  assert.deepEqual(parseOracleCarry('给汐一双鞋'), { villager: '汐', carries: ['shoes'] });
  assert.deepEqual(parseOracleCarry('给汐鞋'), { villager: '汐', carries: ['shoes'] });
});

test('长的说法不被短的切碎：「一盏灯」不能被「灯」抢先', () => {
  // 若按「灯」切，收件人就变成「汐一」——世界上没有这个人，
  // 而那句话本来是清清楚楚的。
  assert.deepEqual(parseOracleCarry('给汐一盏灯'), { villager: '汐', carries: ['lamp'] });
});

// ------------------------------------------------------------------ 收

test('收走：同一个动作的反方向，兜里就空了', () => {
  assert.deepEqual(parseOracleCarry('收走汐的灯'), { villager: '汐', remove: ['lamp'] });
  assert.deepEqual(parseOracleCarry('把汐的灯收走'), { villager: '汐', remove: ['lamp'] });
  assert.deepEqual(parseOracleCarry('收回汐的鞋'), { villager: '汐', remove: ['shoes'] });
});

// ------------------------------------------------------------------ 不认的

test('疑问不触发：问一句不该把她兜里的东西动了', () => {
  assert.equal(parseOracleCarry('要不要给汐一盏灯？'), null);
  assert.equal(parseOracleCarry('能给汐一盏灯吗'), null);
});

test('叙述不触发：说过的话不是命令', () => {
  assert.equal(parseOracleCarry('昨天已经给汐一盏灯了'), null);
  assert.equal(parseOracleCarry('别给汐一盏灯'), null);
});

test('没有收件人就不是交接：那是神迹，不是给东西', () => {
  // 「点灯」是神迹（`oracle-miracle.ts`）。它没有一个收件人，
  // 所以这条路不该接——接了就变成给一个不存在的人发凭证。
  assert.equal(parseOracleCarry('点灯'), null);
  assert.equal(parseOracleCarry('点亮楼前的长灯'), null);
});

test('空句与没说完的话都不猜', () => {
  assert.equal(parseOracleCarry(''), null);
  assert.equal(parseOracleCarry('   '), null);
  assert.equal(parseOracleCarry('给汐'), null, '说了给谁、没说什么，交给世界去问');
  assert.equal(parseOracleCarry('给'), null);
});

// ------------------------------------------------------------------ 祈使，只有祈使

test('叙述不收东西：「汐收走了莞尔的鞋」说的不是命令', () => {
  // 这句话描述的是已经发生的事。收走那一路若在句子里随便找动词，
  // 它就会把收件人取成「汐」、把她的兜掏空——而用户从没要求过。
  assert.equal(parseOracleCarry('汐收走了莞尔的鞋'), null);
  assert.equal(parseOracleCarry('她已经收回那盏灯了'), null);
});

test('祈使的收走只有两种形状：动词打头，或「把」打头', () => {
  assert.deepEqual(parseOracleCarry('收走汐的灯'), { villager: '汐', remove: ['lamp'] });
  assert.deepEqual(parseOracleCarry('把汐的灯收走'), { villager: '汐', remove: ['lamp'] });
  // 动词在句尾但前面不是「把」：那是在说一件事，不是在下命令。
  assert.equal(parseOracleCarry('汐的灯收走'), null);
});

test('没有收件人就不是交接：说给谁没说，就不猜', () => {
  // 「送灯」被规则放过的话，意图里的 villager 是空串——客户端放行、
  // 服务端拒掉，落成 unknown。半句话该落进 unknown，让世界问「说给谁」。
  //
  // （2026-10-28：这里原来写「服务端 502」。没有 502——`oracle/api.py` 只有
  // 503 / 422 / 200+unknown 三种，`wire.WireError` 一律 `ok: false`。
  // 同一个错在 `src/world/intent-schema.ts` 等处改过，这几个测试文件漏了。）
  assert.equal(parseOracleCarry('送灯'), null);
  assert.equal(parseOracleCarry('给'), null);
  assert.equal(parseOracleCarry('收走灯'), null);
  assert.equal(parseOracleCarry('把灯收走'), null);
});

test('指示词也说得出：这盏灯不只是那盏灯', () => {
  assert.deepEqual(parseOracleCarry('给汐这盏灯'), { villager: '汐', carries: ['lamp'] });
  assert.deepEqual(parseOracleCarry('给汐这双鞋'), { villager: '汐', carries: ['shoes'] });
});

// ------------------------------------------------------------------ 两张表不能漂

test('离线认得世界上每一种凭证：只改一边就红', () => {
  // `CARRY_WORDS` 是人嘴里的说法，`CARRY_ITEMS` 是世界的机制，两处各写一遍。
  // 加一种凭证时只改一边，离线这条嘴就永远哑着——而没有任何测试会因此红。
  const offline = [...new Set(CARRY_WORDS.map((entry) => entry.kind))].sort();
  assert.deepEqual(offline, [...CARRY_ITEMS].sort());
});
