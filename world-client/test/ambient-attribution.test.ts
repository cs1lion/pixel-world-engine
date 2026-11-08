/** 作息落点记在哪儿：够得着楼门就是那栋楼，否则是脚下那一格。
 *
 * 这条规则只有一个实现（`ambient.ts` 的 `footfallPlace`），两个调用方：
 * 世界层用它决定 `routine_done` 的 `placeId`（`simulation.ts` 的 `stepAmbient`），
 * 场景层用同一把尺子挑出「不归楼」的落点、登记成地标（`SandboxScene.sightsee`）。
 * 两处各写一遍就是本仓记过的那个病：散文里的一致不是闸。
 *
 * 半径 2 是量出来的。这个文件把那次测量的结论钉住——改了半径，或者挪了哪栋楼，
 * 这里会红，而红的时候该做的是重新量一遍落点归属，不是把数改大。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellPlaceId, footfallPlace, FOOTFALL_ATTRIBUTION_RADIUS } from '../src/world/ambient.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';

/** 一扇门，离原点 `distance` 格。 */
function door(instanceId: string, x: number, y: number) {
  return { instanceId, x, y };
}

test('够得着就是那栋楼，够不着就是脚下那一格', () => {
  const doors = [door('shop', 0, 0)];
  assert.equal(footfallPlace({ x: 0, y: 0 }, doors), 'shop', '站在门口');
  assert.equal(footfallPlace({ x: 2, y: 0 }, doors), 'shop', '正好两格——半径含边界');
  assert.equal(footfallPlace({ x: 3, y: 0 }, doors), 'place:3,0', '三格就是自己那一格');
});

test('斜着量：欧氏距离，不是切比雪夫', () => {
  // (2,2) 的切比雪夫距离是 2（会被吸过去），欧氏是 2.83（不该被吸过去）。
  // 这一条挑的是**度量**，不是半径——两件事分开钉，改错哪个都红。
  const doors = [door('shop', 0, 0)];
  assert.equal(footfallPlace({ x: 2, y: 2 }, doors), 'place:2,2', '2.83 格不算「站在楼门口」');
  assert.equal(footfallPlace({ x: 1, y: 1 }, doors), 'shop', '1.41 格算');
});

test('两扇门一样近：取 id 小的，不看数组顺序', () => {
  // 回放要一致。按数组顺序取，等于让「哪栋楼先建」决定痕迹落在谁身上。
  const left = door('b_house', -1, 0);
  const right = door('a_house', 1, 0);
  assert.equal(footfallPlace({ x: 0, y: 0 }, [left, right]), 'a_house');
  assert.equal(footfallPlace({ x: 0, y: 0 }, [right, left]), 'a_house', '换个顺序还是同一栋');
});

test('半径是 2，而这条数是量出来的', () => {
  assert.equal(FOOTFALL_ATTRIBUTION_RADIUS, 2, '改了它就要重新量灯潮界的落点归属，并改 SETTING_DENGCHAO 里那张表');
});

test('灯潮界的 27 个作息落点：5 个归楼，22 个归自己', () => {
  // 2026-11-01 实测。这一条钉的是**这个世界**的形态：
  // 归楼的 5 个分别是 汐/洗衣妇 的叠浪楼前、灯笼头 的迎灯舍前、炉匠 的炉匠铺门口、
  // 账房先生 的账房门口——都是「她就站在那栋楼门口」的作息。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  const doors = world.buildings.map((building) => ({
    instanceId: building.instanceId,
    x: building.door.x,
    y: building.door.y,
  }));
  const stops = new Set<string>();
  for (const villager of pack.villagers) {
    for (const stop of villager.routine) {
      // 场所落点不是写死的坐标作息点：它由 `sites` 表解析，不进这张「坐标 → 楼」表。
      if ('site' in stop) continue;
      stops.add(`${stop.x},${stop.y}`);
    }
  }
  const attributed: string[] = [];
  for (const key of stops) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const placeId = footfallPlace({ x, y }, doors);
    if (placeId !== cellPlaceId({ x, y })) attributed.push(`${key}→${placeId}`);
  }
  assert.equal(stops.size, 27, '作息落点不再是 27 个——改了作息就回来重算这张表');
  assert.equal(attributed.length, 5, `归到楼上的落点从 5 个变了：${attributed.join('、')}`);
  assert.deepEqual(
    [...new Set(attributed.map((entry) => entry.split('→')[1]!.replace(/#\d+$/, '')))].sort(),
    ['lamp_lodge', 'ledger_house', 'soot_forge', 'wave_house'],
    '归楼的四栋：迎灯舍、账房、炉匠铺、叠浪楼',
  );
});
