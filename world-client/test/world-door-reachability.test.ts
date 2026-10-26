/**
 * 门口可达性：每栋楼的门口都连得到世界中心（祭坛 / hub）。
 *
 * 这是「居民走得到那栋楼」的地基，也是 `ADR_PACK_SKIPS_WORLD_BUDGET` 记的那处
 * 分叉：默认世界在 `buildWorld` 里由 `assertWorldInvariants` 强制
 * （`setup.ts:598-601`：门口与祭坛之间没有通路就抛），而编译后的设定集走
 * `buildSettingWorld`——那道 generic 检查它原先不跑，包这条路一向没人守。
 * 现在两边都跑，且共用 `doorReaches` 这一个定义。
 *
 * 这个文件把这条不变量在两条路上都显式钉住：
 *   - 默认莞尔镇（`buildLargeWorld`，程序生成）
 *   - 灯潮界（`selectSetting('dengchao') → buildSettingWorld`，编译而来）
 *
 * 今天的前馈数据让「门口被墙隔断」构造不出来——`prefabs.json` 12 份蓝图
 * `clearMargin` 均为 1、灯潮界同样为 1（`dengchao/pack.ts:11`），margin 环
 * （`grid.ts:230-237`）保证自由内部四连通。所以两条路现在都是绿的；这条守的是
 * 将来：第三个设定集、或有人改了落位/寻路把某扇门隔出世界时，先红的是它。
 * （真要复现分叉，得靠 `clearMargin: 0` 的蓝图——见 `test/pave-reachable.test.ts`，
 *  那里真的围了一栋楼出来；`saved` 读档分支 `load.ts:127` 直接 grid.place，
 *  无留白/分区/门口检查，此处不展开。）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld, type BuiltWorld } from '../src/world/setup.ts';
import { selectSetting, worldForSetting } from '../src/settings/index.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 门口连不到中心的楼：居民永远走不到它，那栋楼就是死的。 */
function cutOffDoors(world: BuiltWorld): string[] {
  return world.buildings
    .filter((building) => world.grid.path(world.altar, building.door).length === 0)
    .map((building) => `${building.displayName}（${building.instanceId}）`);
}

test('默认世界每栋楼的门口都连得到祭坛', () => {
  const world = buildLargeWorld(blueprints);
  // buildWorld 内部已由 assertWorldInvariants 强制；这里显式再钉一次，
  // 作为两条路应对照的基准。
  assert.deepEqual(cutOffDoors(world), [], `与祭坛没有通路的楼：${cutOffDoors(world).join('、')}`);
});

test('编译后的设定集（灯潮界）每栋楼的门口都连得到 hub——这条 buildSettingWorld 自己不查', () => {
  const world = worldForSetting(selectSetting('?world=dengchao'));
  assert.ok(world.buildings.length > 0, '灯潮界应至少有一栋楼，否则这条测试空转');
  // 这是本文件新增的守卫：包这条路不跑 assertWorldInvariants，门口可达性
  // 此前无任何测试覆盖。
  assert.deepEqual(cutOffDoors(world), [], `与 hub 没有通路的楼：${cutOffDoors(world).join('、')}`);
});
