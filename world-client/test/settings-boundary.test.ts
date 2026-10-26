import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack, SettingPackError } from '../src/settings/load.ts';
import type { RawSettingPack } from '../src/settings/types.ts';

/**
 * 设定集是外部数据，装载器是它唯一的一道门。
 *
 * 这组测试钉的是同一类失败：**写错了不说，画面上少一样东西**。
 * 未知地形会让那种格子底色退回旧世界，未知构件会被渲染层默默跳过，
 * 色名打错一个字母会让斗篷变回莞尔镇的颜色，`tide` 写错一个词让那条作息
 * 永远不成立。它们都不抛错、不报缺省，只是安静地少了一点东西——
 * 在几十格的地图上，这是最难定位的一种"设定集里写了、场景里没有"。
 *
 * 每一条都要能举出「写错时世界会变成什么样」，否则就不该在这里。
 */

const raw = (patch: Partial<RawSettingPack>): RawSettingPack => ({ ...DENGCHAO_RAW, ...patch });

test('未知地形在装载时就拒：写错的地形不会退回旧世界的底色', () => {
  const snow = raw({ terrain: [{ x: 2, y: 2, w: 3, h: 3, terrain: 'snow' as never }] });
  assert.throws(() => loadSettingPack(snow), SettingPackError, 'snow 不是八种地形之一');
});

test('未知构件 kind 在装载时就拒：渲染层遇到它会整个跳过，不报错', () => {
  const lighthouse = raw({
    scenery: [{ kind: 'lighthouse' as never, at: { x: 10, y: 10 } }],
  });
  assert.throws(() => loadSettingPack(lighthouse), SettingPackError, 'lighthouse 不在构件闭集里');
});

test('居民外观的色名必须在 24 色里：打错一个字母，斗篷会变回旧镇的颜色', () => {
  // SandboxScene 解析外观时写的是 `palette[style.cloak] ?? WORLD.cloak`。
  // 那个兜底本身是对的（渲染层不该抛），但它把「设定集写错了」这一事实吃掉了：
  // 灯潮界的迷路人穿着一件莞尔镇的斗篷，而没有任何地方说过这件事。
  const typo = raw({
    villagers: DENGCHAO_RAW.villagers.map((villager, index) =>
      index === 0
        ? { ...villager, style: { cloak: 'clokk' as never, scarf: 'pale', lamp: false } }
        : villager,
    ),
  });
  assert.throws(() => loadSettingPack(typo), SettingPackError, 'clokk 不是色板槽名');
});

test('外观的 lamp 必须是布尔：写字符串时世界会静静当她没有灯', () => {
  const yes = raw({
    villagers: DENGCHAO_RAW.villagers.map((villager, index) =>
      index === 0
        ? { ...villager, style: { cloak: 'cloak', scarf: 'pale', lamp: 'yes' as never } }
        : villager,
    ),
  });
  assert.throws(() => loadSettingPack(yes), SettingPackError, 'lamp 只能是 true 或 false');
});

test('作息停留时长必须是正数：负数或 NaN 会让那一格每一次心跳都重新出发', () => {
  // `nextRoutineAt = now + dwellMs` 是全世界上唯一读它的地方。负数把那个时刻
  // 放到过去，`now < nextRoutineAt` 立刻为假，她于是每一拍都重新选一次作息点，
  // 原地打转；NaN 更糟，两个比较都是假，同样每拍重来。
  for (const dwellMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const broken = raw({
      villagers: DENGCHAO_RAW.villagers.map((villager, index) =>
        index === 0
          ? {
              ...villager,
              routine: villager.routine.map((stop, stopIndex) =>
                stopIndex === 0 ? { ...stop, dwellMs } : stop,
              ),
            }
          : villager,
      ),
    });
    assert.throws(() => loadSettingPack(broken), SettingPackError, `dwellMs=${dwellMs} 应当被拒`);
  }
});

test('作息的 tide 只能是 low / high：写错一个词，那条作息永远不成立', () => {
  // 判定写的是 `tide === 'low' && level > 0.34` 与 `tide === 'high' && level < 0.6`。
  // 写成 'ebb' 两个分支都不进，于是这条作息在满潮退潮时都照去不误——
  // 设定集里那句「趁退潮」从此只是数据里的一行字。
  const ebb = raw({
    villagers: DENGCHAO_RAW.villagers.map((villager, index) =>
      index === 0
        ? {
            ...villager,
            routine: villager.routine.map((stop, stopIndex) =>
              stopIndex === 0 ? { ...stop, tide: 'ebb' as never } : stop,
            ),
          }
        : villager,
    ),
  });
  assert.throws(() => loadSettingPack(ebb), SettingPackError, 'ebb 不是 tide 的取值');
});

test('这五道门只拒写错的，不误伤现有的灯潮界', () => {
  // 同一条边界上，拒得准和拒得狠是两件事。灯潮界本身必须原样通过。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  assert.equal(world.buildings.length, 6);
  assert.equal(pack.villagers.length, 2);
  assert.ok(pack.scenery.length > 0);
});
