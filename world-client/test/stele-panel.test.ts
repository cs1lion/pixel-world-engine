/**
 * 碑面板：摆出来、收回去、Escape 只在开着时生效、截断要说出来。
 *
 * 形状照 `villager-panel.test.ts` 那六条。这里多的一条是**截断**：一次立起
 * 十五条是实测到的真实形态，而面板只摆 `STELE_MAX_LINES` 条。静默截断是这
 * 一面板唯一的错法——用户会以为世界只立了五条。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindStelePanel,
  emptySteleText,
  type SteleOracle,
  type SteleView,
} from '../src/ui/stele-panel.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import type { SteleLine } from '../src/world/memory/stele.ts';
import { installFakeDom } from './fake-dom.ts';

const IDS = ['stele-panel', 'stele-panel-body', 'stele-panel-close'];

function fakeApi(): {
  api: SteleOracle;
  emit: (view: SteleView | null) => void;
  dismissed: () => number;
  subscribe: (listener: (view: SteleView | null) => void) => void;
} {
  const listeners: ((view: SteleView | null) => void)[] = [];
  let dismissCount = 0;
  let last: SteleView | null = null;
  return {
    api: {
      openStele: () => {},
      onStele: (listener) => {
        if (last !== null) listener(last);
        listeners.push(listener);
        return () => {};
      },
      dismissStele: () => {
        dismissCount += 1;
      },
    },
    emit: (view) => {
      last = view;
      for (const listener of listeners) listener(view);
    },
    dismissed: () => dismissCount,
    subscribe: (listener) => {
      if (last !== null) listener(last);
      listeners.push(listener);
    },
  };
}

const line = (n: number, texts: string[] = [`第 ${n} 件事`]): SteleLine => ({
  legendId: `legend_${n}`,
  texts,
  reach: 10 - n,
  age: n === 0 ? '今天' : `${n} 天前`,
  formedDay: 4,
  faded: false,
});

test('空碑上那句话把两个数说给用户听，而且这两个数从配置取', () => {
  // 写死的数在有人调参那天就变成假话，而屏幕上没人会怀疑它。
  const text = emptySteleText();
  assert.ok(text.includes(`${DEFAULT_MEMORY_CONFIG.legendHolders}个人`), `该说 ${DEFAULT_MEMORY_CONFIG.legendHolders} 个人：${text}`);
  assert.ok(text.includes(`讲满${DEFAULT_MEMORY_CONFIG.legendDays}天`), `该说 ${DEFAULT_MEMORY_CONFIG.legendDays} 天：${text}`);
  // 换成一份别的配置，那句话必须跟着变——这就是「不许手写」的证明。
  const custom = emptySteleText({ ...DEFAULT_MEMORY_CONFIG, legendHolders: 9, legendDays: 7 });
  assert.ok(custom.includes('9个人') && custom.includes('讲满7天'), `跟着配置变了：${custom}`);
  assert.ok(!custom.includes(`${DEFAULT_MEMORY_CONFIG.legendHolders}个人`));
});

test('一块碑都没有：摆出空态那句话，面板仍然打开', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({ lines: [], hidden: 0 });
    const body = dom.byId('stele-panel-body');
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0]!.textContent, emptySteleText());
    assert.equal(dom.byId('stele-panel').hidden, false, '面板要开，里面是一句话');
  } finally {
    dom.restore();
  }
});

test('几块碑摆上屏：每种讲法一行，底下跟一句「第 N 天立 · N 人在讲 · age」', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({
      lines: [
        line(0, ['潮水退过一半', '滩涂露出来了']),
        line(1, ['一盏灯亮了']),
      ],
      hidden: 0,
    });
    const body = dom.byId('stele-panel-body');
    assert.equal(body.children.length, 2, '两块碑');
    const first = body.children[0]!;
    // 讲法分行摆，不改写：同一件事有几种说法，正是传说该有的样子。
    const quotes = first.children.filter((child) => child.tag === 'p');
    assert.deepEqual(quotes.map((p) => p.textContent), ['潮水退过一半', '滩涂露出来了']);
    const when = first.children.find((child) => child.className === 'stele-when');
    assert.ok(when !== undefined, '每块碑底下要有一行时刻');
    assert.ok(when!.textContent.includes('第 4 天立'), when!.textContent);
    assert.ok(when!.textContent.includes('10 人在讲'), when!.textContent);
    assert.ok(when!.textContent.includes('今天'), when!.textContent);
    assert.equal(dom.byId('stele-panel').hidden, false);
  } finally {
    dom.restore();
  }
});

test('淡去的碑带一句「已淡去」——但不删除，它还在碑上', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({ lines: [{ ...line(0), faded: true, reach: 1 }], hidden: 0 });
    const when = dom.byId('stele-panel-body').children[0]!.children.find(
      (child) => child.className === 'stele-when',
    );
    assert.ok(when!.textContent.includes('已淡去'), when!.textContent);
  } finally {
    dom.restore();
  }
});

test('截断必须说出来：少掉的每一条都得有个数', () => {
  // 一次立起十五条是实测到的真实形态（`legend-forms.test.ts`）。静默截断是
  // 这一面板唯一的错法：用户会以为世界只立了五条。
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({
      lines: Array.from({ length: 5 }, (_, i) => line(i)),
      hidden: 17,
    });
    const body = dom.byId('stele-panel-body');
    assert.equal(body.children.length, 6, '五块碑 + 一行「还有 N 块」');
    const more = body.children.at(-1)!;
    assert.equal(more.className, 'stele-more');
    assert.equal(more.textContent, '还有 17 块碑没刻上来。');
  } finally {
    dom.restore();
  }
});

test('没被截断时不说那句——0 条不该摆出一行「还有 0 块」', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({ lines: [line(0)], hidden: 0 });
    const body = dom.byId('stele-panel-body');
    assert.equal(body.children.filter((child) => child.className === 'stele-more').length, 0);
  } finally {
    dom.restore();
  }
});

test('null 收起面板', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({ lines: [line(0)], hidden: 0 });
    assert.equal(dom.byId('stele-panel').hidden, false);
    harness.emit(null);
    assert.equal(dom.byId('stele-panel').hidden, true);
  } finally {
    dom.restore();
  }
});

test('关闭按钮：收起，并通知场景', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({ lines: [line(0)], hidden: 0 });
    dom.byId('stele-panel-close').click();
    assert.equal(dom.byId('stele-panel').hidden, true);
    assert.equal(harness.dismissed(), 1);
  } finally {
    dom.restore();
  }
});

test('Escape 只在面板开着时收起', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    dom.doc.key('Escape');
    assert.equal(harness.dismissed(), 0, '面板没开，Escape 不该通知场景');
    harness.emit({ lines: [line(0)], hidden: 0 });
    dom.doc.key('Escape');
    assert.equal(dom.byId('stele-panel').hidden, true);
    assert.equal(harness.dismissed(), 1);
  } finally {
    dom.restore();
  }
});

test('关掉之后，晚订阅的人不会再被补发一份', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('stele-panel').hidden = true;
    const harness = fakeApi();
    bindStelePanel(() => harness.api);
    harness.emit({ lines: [line(0)], hidden: 0 });
    harness.emit(null);
    let replayed = 0;
    harness.subscribe(() => {
      replayed += 1;
    });
    assert.equal(replayed, 0, '关掉的人不该被「补发」成一个还开着的面板');
  } finally {
    dom.restore();
  }
});
