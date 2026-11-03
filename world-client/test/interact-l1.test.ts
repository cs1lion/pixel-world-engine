/**
 * L1：玩家真的会点的那一下。
 *
 * 这一层只钉「点得到、关得掉、读得对」：
 * 1. 点一个村民，状态菜单的三行读数（情绪 / 心里 / 对某人）与记忆层那份数据逐字一致；
 * 2. 菜单真的写进 `#unit-status`（标题、副标题、每一行的键与值），不是内存里有个对象；
 * 3. 点空白 / Esc / 关闭钮都能收起，且在输入框里按 Esc 不算；
 * 4. 右键与长按的入口契约：500ms 才触发，指针移出单位就取消。
 *
 * 右键/长按真正打开记忆面板 / 楼志的那一段在 `scripts/check-interact.mjs` 里用真实
 * 鼠标与触摸事件跑；这里钉的是两份投影数据与面板 DOM 的绑定。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { installFakeDom } from './fake-dom.ts';
import {
  LONG_PRESS_MS,
  bindUnitStatusPanel,
  buildUnitStatus,
  longPressShouldFire,
  type UnitMemoryReader,
  type UnitStatusContent,
  type UnitStatusOracle,
  type UnitStatusView,
} from '../src/ui/unit-status.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined ? null : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

/** 三行读数的合成记忆：不经过真实记忆库，只钉面板这一层的取数与格式化。 */
function threeLineMemory(otherId: string): UnitMemoryReader {
  return {
    viewOf: () => null,
    moodOf: () => ({ label: '轻快', valence: 0.45, arousal: 0.3 }),
    innerVoiceOf: () => ({ templateId: 'inner-curious', text: '想去看潮。' }),
    bondsOf: () => [{ to: otherId, trust: 0.62, warmth: 0.41, debt: -0.15 }],
  };
}

function labelOf(content: UnitStatusContent, name: string): string {
  return content.lines.find((line) => line.key === name)?.value ?? '';
}

/** 一个只做「订阅 + 收起」的 oracle 替身，面板绑定只碰这两件事。 */
function makeOracle(view: UnitStatusView | null): {
  readonly oracle: UnitStatusOracle;
  emit(next: UnitStatusView | null): void;
  dismissed(): number;
} {
  let listener: ((next: UnitStatusView | null) => void) | null = null;
  let dismissCount = 0;
  return {
    oracle: {
      onUnitStatus(next) {
        listener = next;
        next(view);
        return () => {
          listener = null;
        };
      },
      dismissUnitStatus() {
        dismissCount += 1;
      },
      unitStatus: () => view?.content ?? null,
    },
    emit(next) {
      listener?.(next);
    },
    dismissed: () => dismissCount,
  };
}

function viewOf(content: UnitStatusContent): UnitStatusView {
  return { content, anchor: { x: 120, y: 80 } };
}

test('L1-1 左键点村民：情绪 / 心里 / 对某人三行与记忆数据逐字一致', () => {
  const sim = makeSim();
  const snapshot = sim.snapshot();
  const villager = snapshot.villagers[0]!;
  const other = snapshot.villagers.find((item) => item.id !== villager.id && item.visible);
  assert.ok(other !== undefined, '这个世界至少有两个在场的人');

  const content = buildUnitStatus(
    snapshot,
    { kind: 'villager', id: villager.id },
    threeLineMemory(other.id),
  );
  assert.ok(content !== null);
  assert.equal(content.title, villager.name);

  assert.equal(labelOf(content, '情绪'), '轻快 · 效价 0.45 · 唤醒 0.30');
  assert.equal(labelOf(content, '心里'), '想去看潮。');
  assert.equal(
    labelOf(content, `对 ${other.name}`),
    '信任 0.62 · 亲疏 0.41 · 他欠我 0.15',
  );
  assert.equal(
    labelOf(content, '位置'),
    `格子 (${Math.floor(villager.pos.x)}, ${Math.floor(villager.pos.y)})`,
  );
  // 三行之外不夹带记忆原文：面板只摆读数，不展开故事。
  assert.equal(content.lines.some((line) => line.value.includes('我看见')), false);
});

test('L1-2 面板 DOM：标题、副标题、每一行的键与值都真的写上去', () => {
  const content: UnitStatusContent = {
    kind: 'villager',
    id: 'v1',
    title: '汐',
    subtitle: '村民 v1',
    lines: [
      { key: '行为', value: '在走' },
      { key: '情绪', value: '轻快 · 效价 0.45 · 唤醒 0.30' },
      { key: '心里', value: '想去看潮。' },
      { key: '对 莞尔', value: '信任 0.62 · 亲疏 0.41 · 他欠我 0.15' },
    ],
  };
  const dom = installFakeDom([
    'unit-status',
    'unit-status-title',
    'unit-status-subtitle',
    'unit-status-body',
    'unit-status-close',
  ]);
  try {
    const panel = dom.byId('unit-status');
    panel.hidden = true;
    const stub = makeOracle(viewOf(content));
    const bound = bindUnitStatusPanel(() => stub.oracle);

    assert.equal(panel.hidden, false, '有选中单位就要摆出来');
    assert.equal(dom.byId('unit-status-title').textContent, '汐');
    assert.equal(dom.byId('unit-status-subtitle').textContent, '村民 v1');

    const body = dom.byId('unit-status-body');
    assert.equal(body.children.length, content.lines.length, '一行一个 row，不多不少');
    content.lines.forEach((line, index) => {
      const row = body.children[index]!;
      const [key, value] = row.children;
      assert.equal(key?.textContent, line.key, `第 ${index} 行的键`);
      assert.equal(value?.textContent, line.value, `第 ${index} 行的值`);
    });
    assert.equal(panel.style.left, '120px');
    assert.equal(panel.style.top, '80px');

    stub.emit(null);
    assert.equal(panel.hidden, true, '订阅收到 null 就收起');

    bound.dispose();
  } finally {
    dom.restore();
  }
});

test('L1-3 点空白 / Esc / 关闭钮收起；在输入框里按 Esc 不算', () => {
  const content: UnitStatusContent = {
    kind: 'villager',
    id: 'v1',
    title: '汐',
    subtitle: '村民 v1',
    lines: [{ key: '行为', value: '站着' }],
  };
  const dom = installFakeDom([
    'unit-status',
    'unit-status-title',
    'unit-status-subtitle',
    'unit-status-body',
    'unit-status-close',
  ]);
  try {
    const panel = dom.byId('unit-status');
    const stub = makeOracle(viewOf(content));
    const bound = bindUnitStatusPanel(() => stub.oracle);
    assert.equal(panel.hidden, false);

    // 点空白在世界里等价于 `dismissUnitStatus()`；面板这一侧由 oracle 收起。
    stub.emit(null);
    assert.equal(panel.hidden, true, '点空白后菜单消失');
    assert.equal(stub.dismissed(), 0, '订阅收 null 不再回调一次收起');

    // Esc：焦点不在输入框里时收起（面板要先开着，收起态按 Esc 不理）。
    stub.emit(viewOf(content));
    assert.equal(dom.doc.listeners.get('keydown')?.size, 1, 'Esc 只挂一个监听器');
    for (const listener of dom.doc.listeners.get('keydown') ?? []) {
      listener({ key: 'Escape', target: null });
    }
    assert.equal(stub.dismissed(), 1, 'Esc 调一次收起');

    // 焦点在输入框里时，Esc 是输入框的事，不该收起面板。
    stub.emit(viewOf(content));
    for (const listener of dom.doc.listeners.get('keydown') ?? []) {
      listener({ key: 'Escape', target: { tagName: 'INPUT' } });
    }
    assert.equal(stub.dismissed(), 1, '输入框里的 Esc 不算');

    // 关闭钮：点一下收起。
    dom.byId('unit-status-close').click();
    assert.equal(stub.dismissed(), 2, '关闭钮收起');

    // dispose：两个监听器都要摘掉，否则反复挂面板会累加。
    bound.dispose();
    assert.equal(dom.doc.listeners.get('keydown')?.size ?? 0, 0, 'dispose 摘掉 Esc');
    assert.equal(dom.byId('unit-status-close').listeners.get('click')?.size ?? 0, 0, 'dispose 摘掉关闭钮');
  } finally {
    dom.restore();
  }
});

test('L1-4 右键 / 长按的入口契约：500ms 才开，指针移出单位就取消', () => {
  assert.equal(LONG_PRESS_MS, 500);
  assert.equal(longPressShouldFire(499, true), false, '499ms 只是点一下');
  assert.equal(longPressShouldFire(500, true), true, '到 500ms 才算长按');
  assert.equal(longPressShouldFire(10_000, true), true);
  assert.equal(longPressShouldFire(500, false), false, '指针已经移出单位，长按取消');
});
