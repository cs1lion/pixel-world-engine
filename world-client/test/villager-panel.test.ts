import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bindVillagerPanel, type VillagerOracle } from '../src/ui/villager-panel.ts';
import type { VillagerMemoryView } from '../src/ui/villager-panel.ts';
import { installFakeDom } from './fake-dom.ts';

/**
 * 村民面板：摆出那几句话，也收得回去。
 *
 * 这一层原来只有「摆出来」的一侧有测试。**收回去**的一侧一个都没有，而它正是
 * 最容易和镜头各说各话的地方：面板还开着、镜头已经不看人了，玩家就会把那几句话
 * 读成此刻正在发生的事。所以这里钉三件收的事：`null` 收起、Escape 收起、
 * 关掉之后晚订阅的人也不会再被补发一份。
 */

function fakeApi(): {
  api: VillagerOracle;
  emit: (view: VillagerMemoryView | null) => void;
  dismissed: () => number;
  subscribe: (listener: (view: VillagerMemoryView | null) => void) => void;
} {
  const listeners: ((view: VillagerMemoryView | null) => void)[] = [];
  let dismissCount = 0;
  let last: VillagerMemoryView | null = null;
  return {
    api: {
      lookAtVillager: () => {},
      onVillagerMemory: (listener) => {
        // 与场景同一个契约：晚订阅的人先拿到现状。
        if (last !== null) listener(last);
        listeners.push(listener);
        return () => {};
      },
      dismissVillager: () => {
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

const view = (lines: VillagerMemoryView['lines']): VillagerMemoryView => ({
  id: 'v1',
  name: '汐',
  lines,
});

const IDS = ['villager-panel', 'villager-panel-name', 'villager-panel-body', 'villager-panel-close'];

test('名字与三句引文摆上屏，每句带一个时间', () => {
  const dom = installFakeDom(IDS);
  try {
    const harness = fakeApi();
    bindVillagerPanel(() => harness.api);
    harness.emit(
      view([
        { memoryId: 'm1', text: '潮水退过一半', age: '今天' },
        { memoryId: 'm2', text: '在旧站牌下认路', age: '昨天' },
        { memoryId: 'm3', text: '灯芯换过一回', age: '3 天前' },
      ]),
    );
    assert.equal(dom.byId('villager-panel-name').textContent, '汐');
    assert.equal(dom.byId('villager-panel').hidden, false);
    const quotes = dom.byId('villager-panel-body').children;
    assert.deepEqual(
      quotes.map((quote) => quote.textContent),
      ['潮水退过一半', '在旧站牌下认路', '灯芯换过一回'],
      '原文照搬，顺序就是检索顺序',
    );
    assert.deepEqual(
      quotes.map((quote) => quote.children[0]!.textContent),
      ['今天', '昨天', '3 天前'],
    );
  } finally {
    dom.restore();
  }
});

test('一条都没有时照实说，不留空白框', () => {
  const dom = installFakeDom(IDS);
  try {
    const harness = fakeApi();
    bindVillagerPanel(() => harness.api);
    harness.emit(view([]));
    const body = dom.byId('villager-panel-body');
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0]!.textContent, '她这会儿想不起什么。');
    assert.equal(dom.byId('villager-panel').hidden, false, '面板要开，只是里面是一句话');
  } finally {
    dom.restore();
  }
});

test('null 收起面板——镜头不看她了，屏上就不该还摆着她', () => {
  const dom = installFakeDom(IDS);
  try {
    const harness = fakeApi();
    bindVillagerPanel(() => harness.api);
    harness.emit(view([{ memoryId: 'm1', text: '甲', age: '今天' }]));
    assert.equal(dom.byId('villager-panel').hidden, false);
    harness.emit(null);
    assert.equal(dom.byId('villager-panel').hidden, true);
  } finally {
    dom.restore();
  }
});

test('关闭按钮：收起，并松开跟随', () => {
  const dom = installFakeDom(IDS);
  try {
    const harness = fakeApi();
    bindVillagerPanel(() => harness.api);
    harness.emit(view([{ memoryId: 'm1', text: '甲', age: '今天' }]));
    dom.byId('villager-panel-close').click();
    assert.equal(dom.byId('villager-panel').hidden, true);
    assert.equal(harness.dismissed(), 1);
  } finally {
    dom.restore();
  }
});

test('Escape 只在面板开着时收起', () => {
  const dom = installFakeDom(IDS);
  try {
    // 开局是收起的：`index.html` 的 `<aside id="villager-panel" hidden>` 才是
    // 那个初始态，模块自己不负责设它。假 DOM 得照抄，否则这条测的是「默认开」。
    dom.byId('villager-panel').hidden = true;
    const harness = fakeApi();
    bindVillagerPanel(() => harness.api);
    dom.doc.key('Escape');
    assert.equal(harness.dismissed(), 0, '面板没开，Escape 不该去动镜头');
    harness.emit(view([{ memoryId: 'm1', text: '甲', age: '今天' }]));
    dom.doc.key('Escape');
    assert.equal(dom.byId('villager-panel').hidden, true);
    assert.equal(harness.dismissed(), 1);
  } finally {
    dom.restore();
  }
});

test('关掉之后，晚订阅的人不会再被补发一份', () => {
  // 场景那边 `closeVillagerPanel` 会把 lastVillagerMemory 清成 null，
  // 于是 `onVillagerMemory` 的补发也停了。这里钉的是面板这一侧的对应行为：
  // 收到 null 之后再没有东西能把它打开。
  const dom = installFakeDom(IDS);
  try {
    const harness = fakeApi();
    bindVillagerPanel(() => harness.api);
    harness.emit(view([{ memoryId: 'm1', text: '甲', age: '今天' }]));
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
