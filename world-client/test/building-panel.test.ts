/**
 * 楼面板：点一栋铺子，看它叫什么、接过什么活、墙上留着什么。
 *
 * 照 `villager-panel.test.ts` / `stele-panel.test.ts` 那六条（摆出来 / 空态 /
 * null 收起 / 关闭按钮 / Escape 只在开着时生效 / 晚订阅不补发），另加两条这一面
 * 独有的：**接不接活要说清后果**，以及**痕迹行随可见度变文案**——后者是
 * 「风化只降可见度」这句话在纸面上唯一的证据。
 *
 * 这个文件只测纸面。名字怎么改的、痕迹怎么风化的，各在 `toponym.test.ts` 与
 * `trace-hints.test.ts`；面板这一层不重算它们，只把算好的摆出来。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  activityText,
  bindBuildingPanel,
  historyLineText,
  taskText,
  traceLineText,
  traceText,
  type BuildingOracle,
  type BuildingPanelView,
} from '../src/ui/building-panel.ts';
import { TASK_PROFILES } from '../src/world/tasks.ts';
import { installFakeDom } from './fake-dom.ts';

const IDS = ['building-panel', 'building-panel-name', 'building-panel-body', 'building-panel-close'];

function fakeApi(): {
  api: BuildingOracle;
  emit: (view: BuildingPanelView | null) => void;
  dismissed: () => number;
  subscribe: (listener: (view: BuildingPanelView | null) => void) => void;
} {
  const listeners: ((view: BuildingPanelView | null) => void)[] = [];
  let dismissCount = 0;
  let last: BuildingPanelView | null = null;
  return {
    api: {
      lookAtBuilding: () => {},
      onBuilding: (listener) => {
        if (last !== null) listener(last);
        listeners.push(listener);
        return () => {};
      },
      dismissBuilding: () => {
        dismissCount += 1;
      },
      building: () => last,
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

const view = (over: Partial<BuildingPanelView> = {}): BuildingPanelView => ({
  placeId: 'ledger_house#1',
  name: '账房',
  history: [],
  task: 'writing',
  activity: 'idle',
  traces: [],
  // 落地账脚注：默认没有记录（`null`），个别用例要验脚注时自己传。
  landing: null,
  ...over,
});

test('接不接活要说清后果：不接活不是一句「无」，是「派到这里的活会被拒」', () => {
  assert.equal(taskText(null), '不接活：派到这里的活会被拒。');
  assert.ok(taskText('code').includes(TASK_PROFILES.code.label), taskText('code'));
  // 说法从 `TASK_PROFILES` 取，不在这里再抄一遍中文。
  assert.ok(taskText('research').includes(TASK_PROFILES.research.label));
});

test('状态四种各有一句人话，四种互不相同', () => {
  const texts = (['idle', 'operating', 'overheating', 'cooling'] as const).map(activityText);
  assert.equal(new Set(texts).size, 4, `四种状态该说四句话，实际：${texts.join(' / ')}`);
  for (const text of texts) assert.ok(text.length > 0);
});

test('痕迹行随可见度变文案——这是「风化只降可见度」在纸面上的证据', () => {
  const fresh = traceLineText({ layer: 'scorch', visibility: 1 });
  const weathered = traceLineText({ layer: 'scorch', visibility: 0.4 });
  assert.equal(fresh, '焦痕 · 还剩 100% 可见');
  assert.equal(weathered, '焦痕 · 还剩 40% 可见');
  assert.notEqual(fresh, weathered, '风化前后该读出不同的数');
});

test('一道痕迹都没有时照实说，不留一行空白让人猜', () => {
  assert.equal(traceText([]), '墙上什么都没留下。');
  assert.equal(traceText([{ layer: 'patch', visibility: 0.5 }]), '墙上留着 1 道痕迹。');
});

test('历史链的一行：有由头就引出来，没有就只写改名那天', () => {
  assert.equal(
    historyLineText({ day: 4, name: '账房·立事', because: '有人在这儿立了一桩事' }),
    '第 4 天改成「账房·立事」——因为「有人在这儿立了一桩事」',
  );
  // 查不到那条传说时**不编一个理由**：只写改名这件事。
  assert.equal(
    historyLineText({ day: 4, name: '账房·立事', because: null }),
    '第 4 天改成「账房·立事」',
  );
});

test('摆出来：名字进标题，四行都在，痕迹一条一行', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('building-panel').hidden = true;
    const harness = fakeApi();
    bindBuildingPanel(() => harness.api);
    harness.emit(
      view({
        name: '账房·立事',
        activity: 'operating',
        traces: [
          { layer: 'scorch', visibility: 0.7 },
          { layer: 'patch', visibility: 0.9 },
        ],
        history: [{ day: 4, name: '账房·立事', because: '有人在这儿立了一桩事' }],
      }),
    );
    assert.equal(dom.byId('building-panel-name').textContent, '账房·立事', '标题就是此刻的名字');
    const body = dom.byId('building-panel-body');
    const texts = body.children.map((child) => child.textContent);
    assert.ok(texts.includes(taskText('writing')), texts.join(' | '));
    assert.ok(texts.includes(activityText('operating')), texts.join(' | '));
    assert.ok(texts.includes('墙上留着 2 道痕迹。'), texts.join(' | '));
    const list = body.children.find((child) => child.className === 'building-trace-list');
    assert.ok(list !== undefined, '有痕迹时要摆出一张单子');
    assert.equal(list!.children.length, 2, '一道痕迹一行');
    assert.equal(list!.children[0]!.textContent, '焦痕 · 还剩 70% 可见');
    const history = body.children.find((child) => child.className === 'building-history');
    assert.ok(history !== undefined);
    assert.equal(
      history!.children[0]!.textContent,
      '第 4 天改成「账房·立事」——因为「有人在这儿立了一桩事」',
    );
    assert.equal(dom.byId('building-panel').hidden, false, '面板要开');
  } finally {
    dom.restore();
  }
});

test('没改过名：明说「还没改过名」，不是一片空白', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('building-panel').hidden = true;
    const harness = fakeApi();
    bindBuildingPanel(() => harness.api);
    harness.emit(view());
    const history = dom.byId('building-panel-body').children.find(
      (child) => child.className === 'building-history',
    );
    assert.ok(history !== undefined, '这一行要在，只是说的是「还没改过名」');
    assert.equal(history!.textContent, '还没改过名。');
  } finally {
    dom.restore();
  }
});

test('null 收起面板', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('building-panel').hidden = true;
    const harness = fakeApi();
    bindBuildingPanel(() => harness.api);
    harness.emit(view());
    assert.equal(dom.byId('building-panel').hidden, false);
    harness.emit(null);
    assert.equal(dom.byId('building-panel').hidden, true);
  } finally {
    dom.restore();
  }
});

test('关闭按钮：收起，并通知场景', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('building-panel').hidden = true;
    const harness = fakeApi();
    bindBuildingPanel(() => harness.api);
    harness.emit(view());
    dom.byId('building-panel-close').click();
    assert.equal(dom.byId('building-panel').hidden, true);
    assert.equal(harness.dismissed(), 1);
  } finally {
    dom.restore();
  }
});

test('Escape 只在面板开着时收起', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('building-panel').hidden = true;
    const harness = fakeApi();
    bindBuildingPanel(() => harness.api);
    dom.doc.key('Escape');
    assert.equal(harness.dismissed(), 0, '面板没开，Escape 不该通知场景');
    harness.emit(view());
    dom.doc.key('Escape');
    assert.equal(dom.byId('building-panel').hidden, true);
    assert.equal(harness.dismissed(), 1);
  } finally {
    dom.restore();
  }
});

test('关掉之后，晚订阅的人不会再被补发一份', () => {
  const dom = installFakeDom(IDS);
  try {
    dom.byId('building-panel').hidden = true;
    const harness = fakeApi();
    bindBuildingPanel(() => harness.api);
    harness.emit(view());
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
