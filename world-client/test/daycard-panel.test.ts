/**
 * 日历抽屉：拉开、按周摆、切范围、收起、纯读提示、与镇志互斥。
 *
 * 这里验 DOM 行为，不验数据推导——卡与周摘要由 `memory-daycard.test.ts`
 * 钉住。两组合起来才是「屏幕上的字」与「字从哪来」。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bindDayCardPanel,
  type DayCardOracle,
  type DayCardProof,
  type DayCardRead,
} from '../src/ui/daycard-panel.ts';
import { dayCardOf } from '../src/world/memory/daycard.ts';
import type { DayDigest, DayFlag } from '../src/world/memory/types.ts';
import { installFakeDom, type FakeElement } from './fake-dom.ts';

const IDS = [
  'daycard',
  'daycard-open',
  'daycard-close',
  'daycard-refresh',
  'daycard-heading',
  'daycard-note',
  'daycard-list',
  'daycard-range-7',
  'daycard-range-30',
  'daycard-range-all',
  'chronicle',
  'chronicle-open',
];

function digestOf(day: number, flags: DayFlag[]): DayDigest {
  return {
    day,
    people: ['v0', 'v1', 'v2'],
    firstEvent: `ev-${day}-0`,
    lastEvent: `ev-${day}-1`,
    places: ['street'],
    flags,
    events: [
      [`ev-${day}-0`, 'street_greet', 0],
      [`ev-${day}-1`, flags.includes('dispute') ? 'conflict' : 'routine_done', 0],
    ],
    beats: [[0, 1], [1, 2]],
    extras: [0, 0, 0],
    anomalies: flags.includes('dispute') ? ['两个人在街口吵了一架'] : [],
    pointers: [],
    compact: false,
  };
}

function cardsOf(): ReturnType<typeof dayCardOf>[] {
  return [
    digestOf(10, ['social']),
    digestOf(11, ['work']),
    digestOf(12, ['quiet']),
    digestOf(13, ['social', 'dispute']),
    digestOf(14, ['quiet']),
    digestOf(15, ['social']),
    digestOf(16, ['quiet']),
    digestOf(17, ['social']),
    digestOf(18, ['quiet']),
    digestOf(19, ['social']),
  ].map((digest) => dayCardOf(digest));
}

function proof(): DayCardProof {
  return {
    readMs: 1.25,
    days: 10,
    memoryBytesBefore: 12345,
    memoryBytesAfter: 12345,
    memoryEqual: true,
    saveBytesBefore: 67890,
    saveBytesAfter: 67890,
    saveEqual: true,
  };
}

function fakeApi(): DayCardOracle {
  const read: DayCardRead = { cards: cardsOf(), readMs: 0.42, days: 10 };
  return {
    dayCards: () => read,
    dayCardProof: proof,
  };
}

/** 假 DOM 不聚合 textContent，测试里自己收一遍。 */
function textOf(node: FakeElement): string {
  return [node.textContent, ...node.children.map((child) => textOf(child))].join(' ');
}

/** 按类名递归收节点：装饰图挂在文字节点内部，不是 list 的直接子节点。 */
function collect(node: FakeElement, cls: string): FakeElement[] {
  const hit = node.className.split(' ').includes(cls) ? [node] : [];
  return [...hit, ...node.children.flatMap((child) => collect(child, cls))];
}

test('拉开日历：按周摆，每天一行，争执日一眼能看出来', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('daycard').hidden = true;
    bindDayCardPanel(() => fakeApi());
    dom.byId('daycard-open').click();

    assert.equal(dom.byId('daycard').hidden, false, '点了日历要开');
    const list = dom.byId('daycard-list');
    const weeks = list.byClass('daycard-week');
    const rows = list.byClass('daycard-row');
    assert.equal(weeks.length, 2, '10 天切两段周');
    assert.equal(rows.length, 10);

    const joined = textOf(list);
    assert.ok(joined.includes('第 13 天'), `要摆出第 13 天：${joined}`);
    assert.ok(joined.includes('吵了一架'), '争执日要显示「吵了一架」');
    assert.ok(joined.includes('两个人在街口吵了一架'), '大事要用摘要里的原句');
    assert.ok(joined.includes('这周不平静'), '周标题要说清这周不平静');

    const note = textOf(dom.byId('daycard-note'));
    assert.ok(note.includes('只读'), note);
    assert.ok(note.includes('存档未变'), note);
    assert.ok(note.includes('记忆未变'), note);
  } finally {
    dom.restore();
  }
});

test('11-11 装饰：每段周一张构图贴片、每天一张表情，都是纯附加', () => {
  const dom = installFakeDom(IDS);
  try {
    bindDayCardPanel(() => fakeApi());
    dom.byId('daycard-open').click();
    const list = dom.byId('daycard-list');
    const plates = collect(list, 'art-plate');
    const emotes = collect(list, 'art-emote');
    assert.equal(plates.length, 2, '两段周各挂一张画册贴片');
    assert.equal(emotes.length, 10, '十天各挂一张表情');
    assert.equal(
      (plates[0] as unknown as { src?: string }).src,
      '/assets/plate/map-00.png',
      '贴片路径来自清单',
    );
    // 装饰不改文字：原来那十天的读数一个字都不能少。
    assert.ok(textOf(list).includes('第 13 天'), '挂图不该吃掉日历上的字');
  } finally {
    dom.restore();
  }
});

test('切到近 7 天：只留最近 7 行，标题跟着变', () => {
  const dom = installFakeDom(IDS);
  try {
    bindDayCardPanel(() => fakeApi());
    dom.byId('daycard-range-7').click();
    assert.equal(dom.byId('daycard-list').byClass('daycard-row').length, 7);
    assert.ok(textOf(dom.byId('daycard-heading')).includes('近 7 天'));
    assert.equal(dom.byId('daycard-range-7').getAttribute('aria-pressed'), 'true');
  } finally {
    dom.restore();
  }
});

test('关掉与互斥：关闭键收起；拉开镇志时日历自己收起', () => {
  const dom = installFakeDom(IDS);
  try {
    bindDayCardPanel(() => fakeApi());
    dom.byId('daycard-open').click();
    assert.equal(dom.byId('daycard').hidden, false);

    dom.byId('chronicle-open').click();
    assert.equal(dom.byId('daycard').hidden, true, '镇志拉开时日历要收起');

    dom.byId('daycard-open').click();
    dom.byId('daycard-close').click();
    assert.equal(dom.byId('daycard').hidden, true);
    assert.equal(dom.byId('daycard-open').getAttribute('aria-expanded'), 'false');
  } finally {
    dom.restore();
  }
});

test('没有日摘要：空态说清楚，不是一片空白', () => {
  const dom = installFakeDom(IDS);
  try {
    bindDayCardPanel(() => ({ dayCards: () => ({ cards: [], readMs: 0, days: 0 }) }));
    dom.byId('daycard-open').click();
    assert.equal(dom.byId('daycard-list').children.length, 0);
    assert.ok(textOf(dom.byId('daycard-note')).includes('还没有日摘要'));
  } finally {
    dom.restore();
  }
});
