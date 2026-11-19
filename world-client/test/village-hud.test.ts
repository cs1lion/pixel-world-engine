import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindVillageHud,
  clockWeatherLine,
  clockWeatherOf,
  microBadgeFor,
  nextSelection,
  stripItems,
  VILLAGER_STRIP_MAX,
  type VillageHudOracle,
  type VillageSelection,
} from '../src/ui/village-hud.ts';
import type { VillagerMode, VillagerSnapshot, Weather, WorldSnapshot } from '../src/world/types.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { installFakeDom } from './fake-dom.ts';

/**
 * 左上角头像条：牌子那一行字、四种微标、头像条的人数上限与排序、
 * 以及「点一下飞过去、再点一下锁跟随」的状态机。
 *
 * 微标那条尤其值得钉死：它只能认快照里真有的读数（mode + 作息牌子），
 * 哪一天多出一种 mode，这里不改成「猜她大概在干嘛」，就得红。
 */

function villager(
  id: string,
  name: string,
  mode: VillagerMode,
  extra: Partial<VillagerSnapshot> = {},
): VillagerSnapshot {
  return {
    id,
    name,
    mode,
    pos: { x: 0, y: 0 },
    walking: false,
    facing: 'down',
    visible: true,
    taskId: null,
    bubble: null,
    routine: null,
    umbrella: false,
    carrying: null,
    lampOil: 0,
    nameState: 'held',
    carries: [],
    ...extra,
  } as VillagerSnapshot;
}

function snapshotOf(villagers: readonly VillagerSnapshot[], now: number, weather: Weather): WorldSnapshot {
  return { villagers, now, weather } as unknown as WorldSnapshot;
}

test('四种微标都从快照读得出来，其余时候不说硬话', () => {
  assert.equal(microBadgeFor(villager('v0', '莞', 'sheltering')), '躲雨');
  assert.equal(microBadgeFor(villager('v0', '莞', 'saluting')), '行礼');
  for (const mode of ['working', 'toWork', 'delivering', 'toAltar', 'bearingDecree'] as const) {
    assert.equal(microBadgeFor(villager('v0', '莞', mode)), '劳作', `mode=${mode} 应读作劳作`);
  }
  assert.equal(
    microBadgeFor(villager('v0', '莞', 'idle', { routine: '实在熬不住，就地睡下了' })),
    '睡觉',
  );
  assert.equal(
    microBadgeFor(villager('v0', '莞', 'idle', { routine: '在祭坛边睡下了' })),
    '睡觉',
  );
  // 白天闲着：无事可说，不硬凑一枚标。
  assert.equal(microBadgeFor(villager('v0', '莞', 'idle')), null);
  // 「回祭坛歇下」不是睡——歇是歇，睡是睡，牌子没写睡字就不说睡。
  assert.equal(
    microBadgeFor(villager('v0', '莞', 'idle', { routine: '回祭坛歇下' })),
    null,
  );
});

test('时钟天气牌：世界毫秒换 day/HH:MM/天气，不读墙钟', () => {
  const now = 2 * DAY_MS + (14 * 60 + 5) * 60_000;
  const reading = clockWeatherOf({ now, weather: 'rain' });
  assert.equal(reading.day, 2);
  assert.equal(reading.clock, '14:05');
  assert.equal(reading.weather, '雨');
  assert.equal(clockWeatherLine(reading), '第 2 天 · 14:05 · 雨');
  // 第 0 天起点：世界刚醒来的那一刻。
  assert.equal(clockWeatherLine(clockWeatherOf({ now: 0, weather: 'clear' })), '第 0 天 · 00:00 · 晴');
});

test('头像条：按 id 排，至多七人', () => {
  const many = Array.from({ length: 10 }, (_, i) => villager(`v${9 - i}`, `居${9 - i}`, 'idle'));
  const items = stripItems(snapshotOf(many, 0, 'clear'));
  assert.equal(items.length, VILLAGER_STRIP_MAX);
  assert.deepEqual(
    items.map((item) => item.id),
    ['v0', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6'],
  );
  // 微标与可见性都随人带走，不是条上另算一份。
  const mixed = [
    villager('v0', '莞', 'sheltering'),
    villager('v1', '汐', 'idle', { visible: false }),
  ];
  const two = stripItems(snapshotOf(mixed, 0, 'clear'));
  assert.equal(two[0]!.badge, '躲雨');
  assert.equal(two[1]!.visible, false);
});

test('选择状态机：第一下飞，第二下锁，跟谁点谁松开', () => {
  const empty: VillageSelection = { selectedId: null, followingId: null };
  assert.deepEqual(nextSelection(empty, 'a'), { selectedId: 'a', followingId: null });
  assert.deepEqual(nextSelection({ selectedId: 'a', followingId: null }, 'a'), {
    selectedId: 'a',
    followingId: 'a',
  });
  assert.deepEqual(nextSelection({ selectedId: 'a', followingId: 'a' }, 'a'), {
    selectedId: 'a',
    followingId: null,
  });
  assert.deepEqual(nextSelection({ selectedId: 'a', followingId: 'a' }, 'b'), {
    selectedId: 'b',
    followingId: null,
  });
});

test('绑定：牌上写一行字，头像点上飞、跟上锁、再点松', () => {
  const dom = installFakeDom(['village-hud', 'village-clock', 'village-strip', 'village-follow']);
  try {
    const fly: string[] = [];
    const follow: string[] = [];
    const released: string[] = [];
    const view = snapshotOf(
      [villager('v1', '莞儿', 'working'), villager('v0', '汐', 'idle', { routine: '在祭坛边睡下了' })],
      2 * DAY_MS + (14 * 60 + 5) * 60_000,
      'rain',
    );
    const api: VillageHudOracle = {
      view: () => view,
      flyToVillager: (id) => { fly.push(id); },
      followVillager: (id) => { follow.push(id); },
      releaseCameraFollow: () => { released.push('x'); },
      onStatus: () => () => {},
    };
    bindVillageHud(() => api, { tick: () => () => {} });

    const chip = dom.byId('village-clock');
    assert.equal(chip.textContent, '第 2 天 · 14:05 · 雨');

    const strip = dom.byId('village-strip');
    assert.equal(strip.children.length, 2);
    // 按 id 排：v0 的「汐」在最前；她的牌子写着睡下了，徽标是「睡觉」。
    assert.equal(strip.children[0]!.title, '汐');
    assert.equal(strip.children[0]!.children[1]!.textContent, '睡觉');
    assert.equal(strip.children[1]!.children[1]!.textContent, '劳作');

    const first = strip.children[1]!;
    first.click();
    assert.deepEqual(fly, ['v1']);
    // 同一人第二下：锁跟随。
    first.click();
    assert.deepEqual(follow, ['v1']);
    const followButton = dom.byId('village-follow') as unknown as { textContent: string; disabled: boolean };
    assert.equal(followButton.textContent, '松开跟随');
    assert.equal(followButton.disabled, false);
    // 第三下：松开跟随。
    first.click();
    assert.equal(released.length, 1);
  } finally {
    dom.restore();
  }
});
