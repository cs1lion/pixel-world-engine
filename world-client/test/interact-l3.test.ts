/**
 * L3：边界。
 *
 * 四件事：
 * 1. 神谕输入面板是这页唯一可写的文字面板：空 / 全空白不投递；控制字符被剥离；
 *    恰好 200 字收下，201 字与 10000 字整句拒收；上游在线时拒收的回执照抄；
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
import { installFakeDom, type FakeElement } from './fake-dom.ts';
import {
  UTTERANCE_MAX_LENGTH,
  bindOraclePanel,
  prepareUtterance,
  type OracleApi,
} from '../src/ui/oracle-panel.ts';
import { buildUnitStatus, type UnitStatusContent, type UnitMemoryReader } from '../src/ui/unit-status.ts';

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
    // 开局定在 09:00，不是 00:00：22:00–05:00 是作息里的睡眠段，居民本来
    // 就该回锚点睡下。这条用例验的是「回溯只读」，需要一段真在走动的世界。
    initialNow: 9 * 60 * 60 * 1000,
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

/**
 * 场景里 `unitMemoryReader()` 的同一份只读适配：`MemoryRuntime` 的 `viewOf`
 * 返回的是整个 HolderView，面板只拿它认识的字段。
 */
function readerOf(memory: MemoryRuntime): UnitMemoryReader {
  return {
    viewOf: (holderId) => {
      const view = memory.viewOf(holderId);
      if (view === null) return null;
      return {
        memories: view.memories.map((entry) => ({
          kind: entry.kind,
          who: entry.content.who,
          valence: entry.content.valence,
          arousal: entry.content.arousal,
          createdDay: entry.createdDay,
          redacted: entry.redacted,
        })),
      };
    },
    bondsOf: (holderId) => memory.bondsOf(holderId),
    moodOf: (holderId) => memory.moodOf(holderId),
    innerVoiceOf: (holderId) => memory.innerVoiceOf(holderId),
  };
}

/** 神谕面板的假 API：记录 `say` 收到了什么；可注入「上游在线但拒收」的回执。 */
function fakeOracleApi(
  say?: (text: string) => { readonly ok: boolean; readonly message: string },
): { api: OracleApi; said: string[] } {
  const said: string[] = [];
  const api: OracleApi = {
    view: () => ({}) as never,
    say: (text: string) => {
      said.push(text);
      return say === undefined ? { ok: true, message: '' } : say(text);
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

function bindWritingPanel(
  say?: (text: string) => { readonly ok: boolean; readonly message: string },
): {
  readonly said: string[];
  readonly input: FakeElement;
  readonly reply: FakeElement;
  submit(value: string): void;
  restore(): void;
} {
  const dom = installFakeDom(ORACLE_IDS);
  const world = fakeOracleApi(say);
  const input = dom.byId('utterance');
  bindOraclePanel(() => world.api);
  return {
    said: world.said,
    input,
    reply: dom.byId('reply'),
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

test('L3-1b 输入校验：控制字符被剥离，纯控制字符按空句处理', () => {
  assert.deepEqual(
    prepareUtterance('\u0000\u0001\u0007拆掉祭坛\u007f'),
    { ok: true, text: '拆掉祭坛' },
    '\\u0000–\\u001f 与 \\u007f 全部剥掉，剩下的字照常投递',
  );
  assert.deepEqual(prepareUtterance('\u0000\u0001\u0007\u007f'), { ok: false, reason: 'empty' });
  assert.deepEqual(prepareUtterance('  \n\t  '), { ok: false, reason: 'empty' }, '空白（含换行/制表符）算空句');

  const panel = bindWritingPanel();
  try {
    panel.submit('\u0000\u0001\u0007<script>alert(1)</script>\u007f');
    assert.equal(panel.said.length, 1, '剥掉控制字符后不是空句，应当投递');
    const sent = panel.said[0]!;
    assert.equal(sent, '<script>alert(1)</script>', '世界队列里只剩可读文字');
    assert.ok(!/[\u0000-\u001f\u007f]/.test(sent), `投递文本仍含控制字符：${JSON.stringify(sent)}`);

    panel.submit('\u0000\u0001\u0007\u007f');
    assert.equal(panel.said.length, 1, '全是控制字符 = 空句，不投递');
    assert.equal(panel.input.value, '\u0000\u0001\u0007\u007f', '没投递的输入原样留着');
  } finally {
    panel.restore();
  }
});

test('L3-1c 输入校验：恰好 200 字收下，201 与 10000 字整句拒收', () => {
  const panel = bindWritingPanel();
  const max = UTTERANCE_MAX_LENGTH;
  try {
    assert.equal(max, 200, '上限是常量里的 200，不散落在代码里');
    assert.equal(panel.input.maxLength, max, '输入框 maxlength 与常量一致');

    panel.submit('字'.repeat(max));
    assert.equal(panel.said.length, 1, '恰好 200 字要收下');
    assert.equal(panel.said[0]!.length, max);
    assert.equal(panel.input.value, '', '收下后清空输入框');
    assert.equal(panel.reply.className.includes('bad'), false, '收下时不报错');

    // 两端留白先 trim 再判长度：夹着 200 个字仍然算恰好上限。
    panel.submit(`   ${'字'.repeat(max)}   `);
    assert.equal(panel.said[1], '字'.repeat(max), 'trim 后恰好 200 字，照收');

    panel.submit('字'.repeat(max + 1));
    assert.equal(panel.said.length, 2, '201 字不投递');
    assert.match(panel.reply.textContent, /201 字/, '回执写清实际字数');
    assert.match(panel.reply.textContent, /上限 200 字/, '回执写清上限');
    assert.equal(panel.reply.className.includes('bad'), true, '超长回执要走错误样式');
    assert.equal(panel.input.value, '字'.repeat(max + 1), '超长的原文留着让人删短，不悄悄截断');

    // 粘贴 / 脚本绕过 maxlength：直接写 value 再提交，提交入口仍拦得住。
    panel.submit('生长'.repeat(5_000));
    assert.equal(panel.said.length, 2, '10000 字绕得过 maxlength，绕不过 prepareUtterance');
    assert.match(panel.reply.textContent, /10000 字/, '回执报出真实长度');
    assert.equal(panel.input.value, '生长'.repeat(5_000), '10000 字原样留在输入框');

    // 控制字符先剥掉再数长度：201 字里混一个 \\u0001，剥完正好 200。
    assert.deepEqual(
      prepareUtterance(`\u0001${'字'.repeat(max)}`),
      { ok: true, text: '字'.repeat(max) },
      '控制字符不占上限',
    );
    assert.equal(prepareUtterance('字'.repeat(max + 1)).ok, false);
  } finally {
    panel.restore();
  }
});

test('L3-1d 服务端在线但拒收：回执照抄、输入保留、不重试', () => {
  const panel = bindWritingPanel(() => ({ ok: false, message: '上游拒绝：这句话认不出。' }));
  try {
    panel.submit('拆掉祭坛');
    assert.equal(panel.said.length, 1, '认得出的句子会送到上游一次');
    assert.equal(panel.reply.textContent, '上游拒绝：这句话认不出。', '上游的回执原样显示');
    assert.equal(panel.reply.className.includes('bad'), true, '拒收回执是错误样式');
    assert.equal(panel.input.value, '拆掉祭坛', '被拒收时不清空，句子还在手上');
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
  const panelNow = buildUnitStatus(current, ref, readerOf(memory));
  const panelThen = buildUnitStatus(historical, ref, readerOf(memory));
  assert.ok(panelNow !== null && panelThen !== null);

  const currentPos = current.villagers.find((item) => item.id === villagerId)!.pos;
  const thenPos = historical.villagers.find((item) => item.id === villagerId)!.pos;
  assert.equal(
    labelOf(panelNow, '位置'),
    `格子 (${Math.floor(currentPos.x)}, ${Math.floor(currentPos.y)})`,
    '点单位读的是当前这一份',
  );
  assert.equal(
    labelOf(panelThen, '位置'),
    `格子 (${Math.floor(thenPos.x)}, ${Math.floor(thenPos.y)})`,
    '同一份历史快照能读出那一天的位置',
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
  const before = buildUnitStatus(sim.snapshot(), ref, readerOf(memory));
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

  const after = buildUnitStatus(restored.snapshot(), ref, readerOf(restoredMemory));
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
