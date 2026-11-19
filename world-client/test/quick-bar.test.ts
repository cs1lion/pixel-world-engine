import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bindVillagerQuickBar, quickBarAnchor, QUICK_ACTIONS } from '../src/ui/quick-bar.ts';
import type { VillagerSnapshot, WorldSnapshot } from '../src/world/types.ts';
import { TILE_PX } from '../src/world/setup.ts';
import { groundY } from '../src/render/ground.ts';
import { installFakeDom } from './fake-dom.ts';

/**
 * 脚下快捷条：五个动作一字不散、锚点贴脚、动作走场景已有的写口、
 * 看不见的人不摆条、Esc 收条。
 */

function villager(id: string, visible = true, extra: Partial<VillagerSnapshot> = {}): VillagerSnapshot {
  return {
    id,
    name: '莞儿',
    mode: 'idle',
    pos: { x: 10, y: 5 },
    ...extra,
    walking: false,
    facing: 'down',
    visible,
    taskId: null,
    bubble: null,
    routine: null,
    umbrella: false,
    carrying: null,
    lampOil: 0,
    nameState: 'held',
    carries: [],
  } as VillagerSnapshot;
}

test('五个动作，顺序即屏幕顺序', () => {
  assert.deepEqual(
    QUICK_ACTIONS.map((spec) => spec.action),
    ['dispatch', 'carry', 'ask', 'follow', 'info'],
  );
  assert.deepEqual(
    QUICK_ACTIONS.map((spec) => spec.text),
    ['派活', '给东西', '问一句', '跟随', '资料'],
  );
});

test('锚点在她脚下：脚底世界坐标 + 一点让位', () => {
  const viewport = {
    rect: { left: 0, top: 0, width: 480, height: 320 },
    gameWidth: 480,
    gameHeight: 320,
    cameraWorldX: 0,
    cameraWorldY: 0,
    cameraZoom: 1,
  };
  const point = quickBarAnchor(villager('v1'), viewport);
  assert.equal(point.x, (10 + 0.5) * TILE_PX);
  assert.equal(point.y, groundY(5) + 8);
  // 她往下走一格，条跟着往下一格（TILE_PX 世界像素）。
  const moved = villager('v1', true, { pos: { x: 10, y: 6 } });
  assert.equal(quickBarAnchor(moved, viewport).y, point.y + TILE_PX);
});

test('绑定：派活走 villagerAction，跟随/资料走专口，做完即收', () => {
  const dom = installFakeDom(['world-overlay']);
  try {
    const calls: string[] = [];
    const view = { villagers: [villager('v1')] } as unknown as WorldSnapshot;
    const api = {
      view: () => view,
      villagerAction: (action: string, id: string) => { calls.push(`act:${action}:${id}`); },
      followVillager: (id: string) => { calls.push(`follow:${id}`); },
      inspectVillager: (id: string) => { calls.push(`inspect:${id}`); },
    };
    const handle = bindVillagerQuickBar(() => api, { readPlacement: () => ({ x: 100, y: 50 }) });

    const root = dom.byId('world-overlay');
    const bar = root.children.find((child) => child.id === 'villager-quick-bar');
    assert.ok(bar !== undefined, '条挂在 #world-overlay 下');
    assert.equal(bar.hidden, true);

    handle.show('v1');
    assert.equal(bar.hidden, false);
    assert.equal(bar.children.length, 5);
    // 假 DOM 没有 offsetWidth，横向夹紧按 0 宽兜底——这条钉的是「不崩」。
    assert.equal(bar.style.left, '2px');
    assert.equal(bar.style.top, '50px');

    bar.children[0]!.click();
    assert.deepEqual(calls, ['act:dispatch:v1']);
    assert.equal(bar.hidden, true);

    handle.show('v1');
    bar.children[3]!.click();
    assert.deepEqual(calls.slice(1), ['follow:v1']);

    handle.show('v1');
    bar.children[4]!.click();
    assert.deepEqual(calls.slice(2), ['inspect:v1']);

    // 人不见了（走出画面/被拆），条自己收。
    handle.show('v1');
    handle.sync({ villagers: [villager('v1', false)] } as unknown as WorldSnapshot);
    assert.equal(bar.hidden, true);

    // Esc 收条。
    handle.show('v1');
    dom.doc.key('Escape');
    assert.equal(bar.hidden, true);

    handle.dispose();
    handle.show('v1');
    dom.doc.key('Escape');
    assert.equal(bar.hidden, false, 'dispose 后 Esc 不再管这条已经收掉的实例');
  } finally {
    dom.restore();
  }
});
