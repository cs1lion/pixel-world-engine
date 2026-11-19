import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindDockPanel,
  clampDockWidth,
  dockBodyClass,
  dockWidthAfterDrag,
  DOCK_DEFAULT_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  DOCK_STORAGE_KEY,
  parseDockPref,
  serializeDockPref,
} from '../src/ui/dock-panel.ts';
import { installFakeDom } from './fake-dom.ts';

/**
 * 镇志停靠：偏好怎么解析、宽度怎么夹、拖边时宽度怎么走。
 *
 * 文件头那两条纪律（坏偏好当没写过、只记布局不记内容）靠这组测试钉着：
 * localStorage 是会被别的标签页与扩展写脏的地方，解析必须宽进严出。
 */

test('宽度先取整再夹进 [240, 560]', () => {
  assert.equal(clampDockWidth(10), DOCK_MIN_WIDTH);
  assert.equal(clampDockWidth(9999), DOCK_MAX_WIDTH);
  assert.equal(clampDockWidth(300.4), 300);
  assert.equal(clampDockWidth(Number.NaN), DOCK_DEFAULT_WIDTH);
  assert.equal(clampDockWidth(DOCK_MIN_WIDTH), DOCK_MIN_WIDTH);
});

test('偏好解析：坏的一律当没写过', () => {
  assert.deepEqual(parseDockPref(null), { side: 'off', width: DOCK_DEFAULT_WIDTH });
  assert.deepEqual(parseDockPref('not json at all'), { side: 'off', width: DOCK_DEFAULT_WIDTH });
  assert.deepEqual(parseDockPref('null'), { side: 'off', width: DOCK_DEFAULT_WIDTH });
  assert.deepEqual(parseDockPref('{"side":"up","width":400}'), { side: 'off', width: 400 });
  assert.deepEqual(parseDockPref('{"side":"left","width":10}'), { side: 'left', width: DOCK_MIN_WIDTH });
  assert.deepEqual(parseDockPref('{"side":"right","width":400}'), { side: 'right', width: 400 });
});

test('序列化与解析互为反函数，且宽度先夹过', () => {
  const round = (side: 'left' | 'right', width: number): void => {
    const text = serializeDockPref({ side, width });
    assert.deepEqual(parseDockPref(text), { side, width: clampDockWidth(width) });
  };
  round('left', 340);
  round('right', 560);
  round('left', 9999);
});

test('body 类名与拖边方向：左停靠右拉变宽，右停靠右拉变窄', () => {
  assert.equal(dockBodyClass('left'), 'dock-left');
  assert.equal(dockBodyClass('right'), 'dock-right');
  assert.equal(dockBodyClass('off'), null);
  assert.equal(dockWidthAfterDrag(300, 50, 'left'), 350);
  assert.equal(dockWidthAfterDrag(300, 50, 'right'), 250);
  // 拖出界也归夹紧。
  assert.equal(dockWidthAfterDrag(DOCK_MAX_WIDTH, 500, 'left'), DOCK_MAX_WIDTH);
  assert.equal(dockWidthAfterDrag(DOCK_MIN_WIDTH, -500, 'right'), DOCK_MAX_WIDTH);
  assert.equal(dockWidthAfterDrag(DOCK_MIN_WIDTH, 500, 'left'), DOCK_MAX_WIDTH);
});

test('绑定：贴左写偏好、还原清掉，键名固定', () => {
  const dom = installFakeDom(['chronicle', 'chronicle-dock-left', 'chronicle-dock-right', 'chronicle-dock-restore']);
  try {
    const writes: Array<[string, string]> = [];
    bindDockPanel({ storage: { getItem: () => null, setItem: (key, value) => writes.push([key, value]) } });

    const host = dom.byId('chronicle');
    assert.equal(host.className, '');

    dom.byId('chronicle-dock-left').click();
    assert.ok(host.className.includes('dock-left'));
    assert.ok(host.className.includes('docked'));
    assert.equal(writes.length, 1);
    assert.equal(writes[0]![0], DOCK_STORAGE_KEY);
    assert.deepEqual(JSON.parse(writes[0]![1]), { side: 'left', width: DOCK_DEFAULT_WIDTH });

    dom.byId('chronicle-dock-right').click();
    assert.ok(host.className.includes('dock-right'));
    assert.ok(!host.className.includes('dock-left'));

    dom.byId('chronicle-dock-restore').click();
    assert.ok(!host.className.includes('docked'));
    assert.equal(writes.length, 3);
    assert.deepEqual(JSON.parse(writes[2]![1]), { side: 'off', width: DOCK_DEFAULT_WIDTH });
  } finally {
    dom.restore();
  }
});

test('绑定：上来就读旧偏好，不用人再点一遍', () => {
  const dom = installFakeDom(['chronicle', 'chronicle-dock-left', 'chronicle-dock-right', 'chronicle-dock-restore']);
  try {
    bindDockPanel({
      storage: {
        getItem: (key) => (key === DOCK_STORAGE_KEY ? '{"side":"right","width":420}' : null),
        setItem: () => {},
      },
    });
    const host = dom.byId('chronicle');
    assert.ok(host.className.includes('dock-right'));
    assert.ok(host.className.includes('docked'));
  } finally {
    dom.restore();
  }
});
