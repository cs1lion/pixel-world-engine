/** 作业牌子：LLM 只负责换一种说法，事实一个都不许变。
 *
 * 三条边界，各钉一组：
 *   1. **世界侧**：作业发生时才排请求，请求里的 `canonical` 就是牌子原文案、
 *      `villagerId` 是真正干活的那个人（不靠坐标猜），取走即清空。
 *   2. **落地侧**：模型的话只在「她仍站在这处、还是同一拍」时才写进牌子；
 *      她已经走开就不写——牌子不许挂错人、不许挂过时的话。
 *   3. **运输侧**：断网、超时、上游 500、`ok:false`，一律回 `null`，不抛不重试。
 *
 * 这一组**不**断言"模型写了什么"——那是一个会漂的输出。只断言世界在这一路上
 * 不变坏：牌子有原文案兜底，产出账照记。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { routineProfiles, siteTargetResolver } from '../src/settings/index.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { OutputKind } from '../src/world/site-output.ts';

const MINUTE_MS = 60_000;

function makeSim() {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  const resolve = siteTargetResolver(pack, world.grid, world.buildings);
  const profiles = routineProfiles(pack, resolve);
  const siteOutputs = new Map<string, OutputKind>(
    (pack.sites ?? [])
      .filter((site) => site.output !== undefined)
      .map((site) => [site.id, site.output!] as const),
  );
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: pack.hub,
    villagerName: pack.villagers[0]!.name,
    villagerNames: pack.villagers.map((villager) => villager.name),
    villagerProfiles: profiles,
    blueprints: pack.blueprints,
    wallClock: () => 1000,
    initialNow: 6 * 60 * MINUTE_MS,
    siteOutputs,
  });
  return { sim, pack };
}

/** 跑到第一次有作业进帐为止（最多 11 世界小时）。 */
function runUntilFirstNote(sim: Simulation) {
  const end = 11 * 60 * MINUTE_MS;
  for (let t = 0; t < end; t += 5000) {
    sim.update(5000);
    const notes = sim.drainWorkNotes();
    if (notes.length > 0) return notes;
  }
  return [];
}

test('世界侧：作业发生才排请求，事实由世界给，取走即清空', () => {
  const { sim } = makeSim();
  const notes = runUntilFirstNote(sim);
  assert.ok(notes.length > 0, '跑完一个白天一条牌子请求都没排出来');

  const note = notes[0]!;
  // 干活的确实是世界里那个人，不是靠坐标猜出来的空串。
  const people = sim.snapshot().villagers;
  assert.ok(
    people.some((villager) => villager.id === note.villagerId),
    `请求里的村民 id 不在世界里：${note.villagerId}`,
  );
  assert.ok(note.site.length > 0, '请求没带场所 id');
  // `canonical` 是牌子原文案——模型只准换说法，这是唯一权威事实。
  assert.equal(note.canonical, note.siteName, '牌子原文案与场所标签必须是同一句');
  assert.ok(note.canonical.length > 0, '请求没带权威事实，模型只能瞎编');
  assert.ok(Number.isInteger(note.day) && note.day >= 0, `第几天不合法：${note.day}`);
  assert.ok(note.stock >= 0, `存货不能是负的：${note.stock}`);
  assert.ok(Array.isArray(note.people), '在场的人必须是列表');

  // 取走即清空：同一趟作业不会被问两次。
  assert.deepEqual(sim.drainWorkNotes(), [], '排过的请求被重复取走了');
});

test('落地侧：她还在原地才写；走开了、换人了都不写', () => {
  const { sim } = makeSim();
  const notes = runUntilFirstNote(sim);
  const note = notes[0]!;

  // 她这会儿正站在那儿，写得进去。
  assert.equal(sim.applyWorkNarration(note.villagerId, note.site, '炭堆前歇了歇'), true);

  // 场所对不上：换个场所 id 就不该写（防止把市场的话挂到锅炉房）。
  assert.equal(sim.applyWorkNarration(note.villagerId, `${note.site}-别处`, '不该写进去'), false);
  // 没这个人：安全返回 false，不抛。
  assert.equal(sim.applyWorkNarration('v404', note.site, '不该写进去'), false);
});

test('落地侧：写进去的是模型那句，不是原文案', () => {
  const { sim } = makeSim();
  const notes = runUntilFirstNote(sim);
  const note = notes[0]!;
  const written = sim.applyWorkNarration(note.villagerId, note.site, '弯腰把炭码齐');
  assert.equal(written, true);
  const villager = sim.snapshot().villagers.find((item) => item.id === note.villagerId)!;
  // 快照是渲染读的那一份：牌子要在屏上真的换了，不能只改内部字段。
  assert.equal(villager.routine, '弯腰把炭码齐');
});

test('运输侧：断网、超时、上游坏、空话，一律回 null 且不抛', async () => {
  const { createWorkNoteClient } = await import('../src/world/work-note-client.ts');
  const request = {
    villagerId: 'v1',
    site: 'boiler_annex#1',
    siteName: '搬炭',
    activity: 'work',
    stock: 2,
    day: 1,
    people: [],
    canonical: '搬炭',
  };

  const cases: Array<[string, () => Promise<Response>]> = [
    ['断网', async () => { throw new Error('ECONNREFUSED'); }],
    ['上游 500', async () => new Response('boom', { status: 500 })],
    ['没听懂', async () => Response.json({ ok: false, text: null })],
    ['空话', async () => Response.json({ ok: true, text: '   ' })],
    ['字段不是字符串', async () => Response.json({ ok: true, text: 42 })],
    ['JSON 坏', async () => new Response('{', { status: 200 })],
  ];
  for (const [label, impl] of cases) {
    const client = createWorkNoteClient({ fetchImpl: impl as unknown as typeof fetch });
    assert.equal(await client(request), null, `${label} 时不该拿到牌子文案`);
  }

  // 正常一条：去掉首尾空白再交出去。
  const ok = createWorkNoteClient({
    fetchImpl: (async () => Response.json({ ok: true, text: '  弯腰把炭码齐  ' })) as unknown as typeof fetch,
  });
  assert.equal(await ok(request), '弯腰把炭码齐');

  // 超时：12s 没回就放弃，不许压着后面所有拍。
  const hang = createWorkNoteClient({
    timeoutMs: 20,
    fetchImpl: ((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch,
  });
  assert.equal(await hang(request), null, '超时不该卡住世界');
});

test('牌子失败不影响世界：产出账照记，牌子保留原文案', () => {
  const { sim } = makeSim();
  const notes = runUntilFirstNote(sim);
  const note = notes[0]!;
  const villagerOf = () => sim.snapshot().villagers.find((item) => item.id === note.villagerId)!
  const before = villagerOf().routine;

  // 模型不可用：客户端交回空话，世界必须拒收——牌子留原文案，不留一块空牌。
  assert.equal(sim.applyWorkNarration(note.villagerId, note.site, ''), false, '空话被写进牌子了');
  assert.equal(villagerOf().routine, before, '牌子被一句空话抹掉了');

  const reading = sim.siteOutputReading();
  assert.ok(reading.total > 0, '牌子失败把产出账也弄没了');
});
