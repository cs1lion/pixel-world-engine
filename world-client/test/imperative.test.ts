import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NARRATIVE_SUBJECTS,
  NON_IMPERATIVE_MARKERS,
  POLITE_PREFIXES,
  QUESTION_MARKERS,
  hasNarrativeMarker,
  isImperative,
  isQuestion,
  readPoint,
  stripLocation,
  stripPrefixes,
} from '../src/world/imperative.ts';

// ------------------------------------------------------------------ 前缀

test('礼貌与承接前缀被剥掉', () => {
  assert.equal(stripPrefixes('帮我写个爬虫'), '写个爬虫');
  assert.equal(stripPrefixes('再整理一份便笺'), '整理一份便笺');
  assert.equal(stripPrefixes('麻烦帮我查一下'), '查一下', '叠加的前缀也要剥干净');
});

test('没有前缀时原样返回', () => {
  assert.equal(stripPrefixes('写个爬虫'), '写个爬虫');
});

// ------------------------------------------------------------------ 位置

test('句首的位置短语被剥掉', () => {
  assert.equal(stripLocation('在 (32,14) 建一间书阁'), '建一间书阁');
  assert.equal(stripLocation('(32,14) 种树'), '种树');
  assert.equal(stripLocation('在 32,14 那里种树'), '种树');
});

test('句中没有位置时原样返回', () => {
  assert.equal(stripLocation('建一间书阁'), '建一间书阁');
});

// ------------------------------------------------------------------ 叙述判定

test('疑问、否定、过去叙述都算叙述', () => {
  for (const text of ['要不要写？', '别写了', '昨天查过', '外面在下雨吗']) {
    assert.equal(hasNarrativeMarker(text), true, `「${text}」应当被判为叙述`);
  }
});

test('陈述句不算叙述标记', () => {
  for (const text of ['写个爬虫', '查一下天气']) {
    assert.equal(hasNarrativeMarker(text), false, `「${text}」不该被判为叙述`);
  }
});

test('含「别」的词一律还算否定——不收窄，收了窄会放行改世界的命令', () => {
  // 已知误伤：「特别」「区别」「识别」「级别」「差别」「别墅」里的那个「别」
  // 不是否定，按整句查 substring 就会被吞，用户听到一句「没听懂」。
  //
  // 但不收窄。汉语里「别」也落在动词短语中间，那时句首仍然是祈使动词——
  // `hasNarrativeMarker` 一放行，动词表那一关也跟着放行，于是：
  //   交付别交错了 → complete、撤销别撤错单 → cancelPending、写报告别写太长 → dispatch
  // 为了少吞几句查询放改世界的命令进门，这笔账不换。误伤的方向安全（只说
  // 「没听懂」），漏判的方向不安全。详见 imperative.ts 里 SINGLE_CHAR_OVERREACH
  // 那段注释。这条测试就是钉住那个选择，免得下一个人再「修」一遍。
  for (const text of ['查一下A和B的区别', '特别整理一份报告', '建一栋别墅', '整理呢绒', '查一下吗啡']) {
    assert.equal(hasNarrativeMarker(text), true, `「${text}」含单字标记，还算否定`);
  }
  // 否定的本行更不能丢。
  for (const text of ['别建房子', '别写了', '交付别交错了', '点灯别点太亮']) {
    assert.equal(hasNarrativeMarker(text), true, `「${text}」是真否定，必须拦下`);
  }
});

// ------------------------------------------------------------------ 疑问

test('疑问标记独立于叙述标记', () => {
  // 世界法则只关心"是不是在问"，所以两者分开。
  assert.equal(isQuestion('外面在下雨吗'), true);
  assert.equal(isQuestion('下雨吧'), false);
  assert.equal(isQuestion('昨天已经完成了'), false, '过去叙述不是疑问');
});

// ------------------------------------------------------------------ 祈使判定

test('祈使：句首是给定动词', () => {
  const verbs = ['写', '查', '建'];
  assert.equal(isImperative('写个爬虫', verbs), true);
  assert.equal(isImperative('帮我查一下', verbs), true, '礼貌前缀不影响');
  assert.equal(isImperative('在 (3,4) 建一间', verbs), true, '位置前缀不影响');
});

test('非祈使：叙述主语开头', () => {
  const verbs = ['写', '查'];
  assert.equal(isImperative('我想写点东西', verbs), false);
  assert.equal(isImperative('这个 bug 怎么写都不对', verbs), false);
});

test('非祈使：句首不是给定动词', () => {
  assert.equal(isImperative('今天天气不错', ['写', '查']), false);
});

test('非祈使：含叙述标记', () => {
  assert.equal(isImperative('写代码真累', ['写']), false);
  assert.equal(isImperative('要不要写', ['写']), false);
});

test('空句子不是祈使', () => {
  assert.equal(isImperative('', ['写']), false);
  assert.equal(isImperative('   ', ['写']), false);
});

test('前缀与位置可以任意顺序叠加', () => {
  const verbs = ['建'];
  assert.equal(isImperative('在 (3,4) 帮我建一间', verbs), true);
  assert.equal(isImperative('帮我 在 (3,4) 建一间', verbs), true, '位置在礼貌前缀之后');
  assert.equal(isImperative('麻烦 在 (3,4) 帮我建一间', verbs), true, '三层叠加');
});

test('只剥前缀不剥动词本身：剥完还得能匹配上', () => {
  // 「开」既是前缀的一部分也是动词时，不能剥丢。
  assert.equal(isImperative('开灯', ['开']), true);
  assert.equal(isImperative('帮我开灯', ['开']), true);
});

// ------------------------------------------------------------------ 坐标

test('读得到括号里的坐标', () => {
  assert.deepEqual(readPoint('在 (32,14) 建'), { x: 32, y: 14 });
  assert.deepEqual(readPoint('32,14'), { x: 32, y: 14 });
  assert.deepEqual(readPoint('（32，14）'), { x: 32, y: 14 }, '全角括号与逗号也认');
});

test('没有坐标时返回 null', () => {
  assert.equal(readPoint('建一间书阁'), null);
  assert.equal(readPoint('在很远的地方'), null);
});

// ------------------------------------------------------------------ 常量对齐

test('三个解析器共用同一份常量：内容不重复定义', () => {
  // 这条不是测行为，是防回退：常量只该在这里定义一次。
  assert.ok(POLITE_PREFIXES.length > 0);
  assert.ok(NON_IMPERATIVE_MARKERS.length > 0);
  assert.ok(QUESTION_MARKERS.length > 0);
  assert.ok(NARRATIVE_SUBJECTS.length > 0);
});
