/**
 * L3：边界。
 *
 * 四件事：
 * 1. 神谕输入面板是这页唯一可写的文字面板：空 / 全空白不投递；超长与控制字符
 *    必须在面板层被挡住（现在没有，见 `docs/BUGS_FOUND.md` 的 BUG-1，断言标 todo）；
 * 2. 回溯时间线是只读的：拖到第 N 天再点单位，读的是**当前**这一份，不是那一天的；
 * 3. 存档读写后重开，面板读数逐行复原；
 * 4. 两个单位同时点开时只有一个面板——这条由 `scripts/check-interact.mjs` 用真实
 *    点击验，这里钉同一选择对象只有一份内容。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation, type SimulationDeps } from '../src/world/simulation.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { SceneHistory } from '../src/world/history/scene-history.ts';
import { MemoryHistoryStore } from '../src/world/history/store.ts';
import { fnv1a64Hex } from '../src/world/save.ts';
import { installFakeDom } from './fake-dom.ts';
import { bindOraclePanel, type OracleApi } from '../src/ui/oracle-panel.ts';
import { buildUnitStatus, type UnitStatusContent } from '../src/ui/unit-status.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeRig(): { sim: Simulation; deps: SimulationDeps } {
  const world = buildWorld(blueprints);
  const deps: SimulationDeps = {
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined ? null : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  };
  return { sim: new Simulation(deps), deps };
}

function labelOf(content: UnitStatusContent, name: string): string {
  return content.lines.find((line) => line.key === name)?.value ?? '';
}

/** 神谕面板的假 API：只记录 `say` 收到了什么。 */
function fakeOracleApi(): { api: OracleApi; said: string[] } {
  const said: string[] = [];
  const api: OracleApi = {
    view: () => ({}) as never,
    say: (text: string) => {
      said.push(text);
      return { ok: true, message: '' };
    },
    dispatch: () => {},
    finish: () => {},
    saveNow: () => ({ ok: true, message: '' }),
    loadSave: () => ({ ok: true, message: '' }),
    clearSave: () => ({ ok: true, message: '' }),
    build: () => {},
    miracle: () => {},
    beginCreation: () => ({ ok: true, message: '' }),
    confirmCreation: () => ({ ok: true, message: '' }),
    cancelCreation: () => ({ ok: true, message: '' }),
    creation: () => null,
    injectBlocked: () => {},
    worldState: () => ({ line: '镇内 3 栋', missingWild: [], buildable: [] }),
    decree: () => null,
    renderStats: () => ({ graphicsObjects: 0, totalCommands: 0, largest: [] }),
    centerCameraOn: () => {},
    canPlaceAt: () => true,
    feed: () => ({ ok: true, message: '' }),
    onResult: () => () => {},
    onStatus: () => () => {},
    setPhase: () => {},
    currentPhase: () => 'noon',
    realPhase: () => 'noon',
    isAutoPhase: () => true,
    setAutoPhase: () => {},
    setNight: () => {},
    toggleNight: () => false,
    nightEnabled: () => false,
    report: () => ({ headline: '天下太平', lines: [], clock: '今天' }),
    slab: () => [],
  };
  return { api, said };
}

const ORACLE_IDS = [
  'oracle',
  'utterance',
  'reply',
  'status',
  'finish',
  'paper-headline',
  'paper-lines',
  'paper-clock',
  'slab-count',
  'slab-lines',
  'decree',
  'decree-title',
  'decree-question',
  'world-state',
  'build-row',
] as const;

function bindWritingPanel(): {
  readonly said: string[];
  readonly input: { value: string };
  submit(value: string): void;
  restore(): void;
} {
  const dom = installFakeDom(ORACLE_IDS);
  const world = fakeOracleApi();
  const input = dom.byId('utterance');
  bindOraclePanel(() => world.api);
  return {
    said: world.said,
    input,
    submit(value: string) {
      input.value = value;
      dom.byId('oracle').submit();
    },
    restore: dom.restore,
  };
}

test('L3-1a 输入校验：空输入与全空白都不投递', () => {
  const panel = bindWritingPanel();
  try {
    panel.submit('');
    assert.equal(panel.said.length, 0, '空输入不投递');
    panel.submit('   ');
    assert.equal(panel.said.length, 0, '全空白不投递');
    assert.equal(panel.input.value, '   ', '没投递的输入不该被清空');
  } finally {
    panel.restore();
  }
});

test('L3-1b 输入校验：控制字符必须被挡住（todo：现在是原样投递）', { todo: true }, () => {
  const panel = bindWritingPanel();
  try {
    const raw = '\u0000\u0001\u0007<script>alert(1)</script>';
    panel.submit(raw);
    assert.equal(panel.said.length, 0, '含控制字符的输入不该进世界队列');
  } finally {
    panel.restore();
  }
});

test('L3-1c 输入校验：超长文本必须被挡住（todo：现在 10k 字符原样投递）', { todo: true }, () => {
  const panel = bindWritingPanel();
  try {
    const raw = '生长'.repeat(5_000);
    panel.submit(raw);
    const longest = panel.said.reduce((max, line) => Math.max(max, line.length), 0);
    assert.ok(longest <= 2_000, `面板层应有长度上限，实际投递了 ${longest} 字`);
  } finally {
    panel.restore();
  }
});

test('L3-2 回溯只读：拖到第 N 天再点单位，读数仍是当前这一份', async () => {
  const { sim, deps } = makeRig();
  const store = new MemoryHistoryStore();
  const history = new SceneHistory({ worldId: 'interact-l3', store });
  const memory = new MemoryRuntime({ worldId: 'interact-l3' });
  const holders = sim.snapshot().villagers.map((villager) => ({
    holderId: villager.id,
    type: 'character' as const,
    at: { x: Math.floor(villager.pos.x), y: Math.floor(villager.pos.y) },
  }));
  memory.syncHolders(holders);

  // 先让世界走起来，再记第 1 天；之后继续走，当前与第 1 天的位置就会分开。
  const villagerId = sim.snapshot().villagers[0]!.id;
  const start = sim.snapshot().villagers.find((item) => item.id === villagerId)!;
  const startCell = { x: Math.floor(start.pos.x), y: Math.floor(start.pos.y) };
  let elapsed = 0;
  while (elapsed < 5_000_000) {
    sim.update(1000);
    elapsed += 1000;
    const current = sim.snapshot().villagers.find((item) => item.id === villagerId)!;
    if (
      Math.floor(current.pos.x) !== startCell.x
      || Math.floor(current.pos.y) !== startCell.y
    ) {
      break;
    }
  }
  assert.ok(elapsed < 5_000_000, '世界在 5000 世界秒内走动了');

  const dayOneNow = sim.snapshot().now;
  history.capture(1, {
    day: 1,
    save: sim.toSave(memory.toJSON()),
    memory: memory.toSnapshot(),
  });
  await history.flush();

  // 再走一段，当前一定比第 1 天晚。
  for (let step = 0; step < 60; step += 1) sim.update(1000);
  const current = sim.snapshot();
  assert.ok(current.now > dayOneNow, '当前世界比记录的那一天晚');

  const beforeHash = fnv1a64Hex(JSON.stringify(sim.toSave(memory.toJSON())));
  const rewind = await history.rewind(1);
  assert.ok(rewind !== null && rewind.save !== null, '第 1 天有记录');
  const afterHash = fnv1a64Hex(JSON.stringify(sim.toSave(memory.toJSON())));
  assert.equal(afterHash, beforeHash, '回溯一个字节都没改当前世界');

  const historical = Simulation.fromSave(rewind.save, deps).snapshot();
  assert.equal(historical.now, dayOneNow, '回溯出来的存档就是那一天');
  const ref = { kind: 'villager' as const, id: villagerId };
  const panelNow = buildUnitStatus(current, ref, memory);
  const panelThen = buildUnitStatus(historical, ref, memory);
  assert.ok(panelNow !== null && panelThen !== null);

  const currentPos = current.villagers.find((item) => item.id === villagerId)!.pos;
  const thenPos = historical.villagers.find((item) => item.id === villagerId)!.pos;
  assert.equal(
    labelOf(panelNow, '位置'),
    `格子 (${Math.floor(currentPos.x)}, ${Math.floor(currentPos.y)})`,
    '点单位读的是当前这一份',
  );
  assert.notEqual(
    labelOf(panelThen, '位置'),
    labelOf(panelNow, '位置'),
    '第 1 天与当前的位置确实不同——否则这条断言没有意义',
  );
});

test('L3-3 存档读写后重开：面板读数逐行复原', () => {
  const { sim, deps } = makeRig();
  const memory = new MemoryRuntime({ worldId: 'interact-l3' });
  const snapshot = sim.snapshot();
  const villager = snapshot.villagers[0]!;
  const other = snapshot.villagers[1]!;
  memory.syncHolders(
    snapshot.villagers.map((item) => ({
      holderId: item.id,
      type: 'character' as const,
      at: { x: Math.floor(item.pos.x), y: Math.floor(item.pos.y) },
    })),
  );
  memory.observe(
    {
      eventId: 'ev-tide',
      kind: 'milestone',
      placeId: 'altar',
      at: { x: 1, y: 1 },
      actors: [villager.id, other.id],
      outcome: { what: '潮水涨到石阶', name: '石阶' },
      importanceHint: 0.6,
      valence: 0.4,
      arousal: 0.4,
      placeType: 'landmark',
      landmark: {
        change: 'built',
        displayName: '石阶',
        origin: { x: 1, y: 1 },
        footprint: { w: 2, h: 2 },
      },
    },
    [villager.id, other.id],
    1000,
  );
  memory.tick(DAY_MS);

  const ref = { kind: 'villager' as const, id: villager.id };
  const before = buildUnitStatus(sim.snapshot(), ref, memory);
  assert.ok(before !== null);
  assert.match(labelOf(before, '情绪'), /效价/, '存档前就有一行可读的情绪');

  const saved = sim.toSave(memory.toJSON());
  const restored = Simulation.fromSave(saved, deps);
  const restoredMemory = new MemoryRuntime({ worldId: 'interact-l3' });
  assert.equal(
    restoredMemory.fromJSON(saved.world.memory),
    true,
    `记忆段能读回来（${String(saved.world.memory).slice(0, 120)}）`,
  );

  const after = buildUnitStatus(restored.snapshot(), ref, restoredMemory);
  assert.ok(after !== null);
  assert.deepEqual(after, before, '标题、副标题与每一行读数都逐字复原');
});

test('L3-4 同时开两个单位：同一个选择位只有后一个的内容', () => {
  const { sim } = makeRig();
  const snapshot = sim.snapshot();
  const first = snapshot.villagers[0]!;
  const second = snapshot.villagers[1]!;

  // 场景只维护一个 `unitStatusSelection`；点第二个就是覆盖第一个。
  const one = buildUnitStatus(snapshot, { kind: 'villager', id: first.id });
  const two = buildUnitStatus(snapshot, { kind: 'villager', id: second.id });
  assert.ok(one !== null && two !== null);
  assert.notEqual(one.id, two.id);
  assert.equal(one.title, first.name);
  assert.equal(two.title, second.name);
});
