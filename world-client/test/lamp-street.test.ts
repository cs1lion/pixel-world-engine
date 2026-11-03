import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LAMP_STREET_ASSETS,
  LAMP_STREET_LAMP_COUNT,
  lampStreetScenery,
} from '../src/settings/dengchao/lamp-street.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { loadSettingPack } from '../src/settings/load.ts';
import {
  LAMP_DOWN_MINUTE,
  LAMP_ON_MINUTE,
  lampStreetLitAt,
  litLampCountAt,
  minuteOfDay,
} from '../src/world/lamp-street.ts';

const HOUR = 60 * 60 * 1000;

/** 世界日的第 h 小时 m 分钟（第 0 天）。 */
function at(h: number, m = 0): number {
  return h * HOUR + m * 60_000;
}

// ------------------------------------------------------------ 资产清单

test('灯街资产清单：29 件，格数与时序都可数', () => {
  assert.equal(LAMP_STREET_ASSETS.length, 29);

  const byKind = (kind: (typeof LAMP_STREET_ASSETS)[number]['kind']) =>
    LAMP_STREET_ASSETS.filter((asset) => asset.kind === kind);
  assert.equal(byKind('lantern').length, 10, '十根街灯');
  assert.equal(byKind('lamp_string').length, 3, '三串纸灯');
  assert.equal(byKind('paving').length, 1, '一条铺装');
  assert.equal(byKind('shopfront').length, 3, '三面店铺立面');
  assert.equal(byKind('stall').length, 6, '六个摊位');
  assert.equal(byKind('banner').length, 3, '三幅幌布');
  assert.equal(byKind('signpost').length, 3, '三根竖招牌');

  const cells = LAMP_STREET_ASSETS.reduce((sum, asset) => sum + asset.cells, 0);
  assert.equal(cells, 125, '格数合计');
});

test('灯街资产清单：每一件都在 lampstreet 地域内，且每一件都有设定集页码', () => {
  const region = DENGCHAO_RAW.regions.find((item) => item.id === 'lampstreet');
  assert.ok(region !== undefined, '夹具：灯街地域存在');
  for (const asset of LAMP_STREET_ASSETS) {
    assert.match(asset.sourcePage, /PDF p\d/, `${asset.id} 缺页码`);
    assert.ok(asset.at.x >= region.x && asset.at.x < region.x + region.w, `${asset.id} 越左/右界`);
    assert.ok(asset.at.y >= region.y && asset.at.y < region.y + region.h, `${asset.id} 越上/下界`);
    // 清单里写的 cells 必须是正数；渲染层据此排版，写 0 就是一件看不见的东西。
    assert.ok(asset.cells > 0, `${asset.id} cells 必须 > 0`);
  }
});

test('灯街资产能过装载期校验（未知 kind 会被拒）', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const kinds = new Set(pack.scenery.map((item) => item.kind));
  const newKinds = ['lamp_string', 'paving', 'shopfront', 'signpost'] as const;
  for (const kind of newKinds) {
    assert.ok(kinds.has(kind), `装载后应有 ${kind}`);
  }
  // 清单编译出的数组与 pack 里的灯街段必须同源。
  const lampKinds = new Set<string>([
    'lantern', 'lamp_string', 'paving', 'shopfront', 'stall', 'banner', 'signpost',
  ]);
  const fromScenery = pack.scenery.filter((item) => lampKinds.has(item.kind));
  assert.equal(fromScenery.length, lampStreetScenery().length, 'pack 里的灯街件数应等于清单');
});

// ------------------------------------------------------------ 18:00 灯态

test('世界日分钟：17:59 与 18:00 是两个世界', () => {
  assert.equal(minuteOfDay(at(17, 59)), 17 * 60 + 59);
  assert.equal(minuteOfDay(at(18, 0)), 18 * 60);
  assert.equal(minuteOfDay(at(5, 0)), 5 * 60);
  assert.equal(minuteOfDay(-1), 1439, '负数时刻稳定回绕');
});

test('18:00 前 0 盏、18:00 起 28 盏', () => {
  assert.equal(litLampCountAt(at(17, 59), 'dusk', LAMP_STREET_LAMP_COUNT), 0);
  assert.equal(litLampCountAt(at(18, 0), 'dusk', LAMP_STREET_LAMP_COUNT), 28);
  assert.equal(litLampCountAt(at(18, 1), 'dusk', LAMP_STREET_LAMP_COUNT), 28);
});

test('天亮收灯：05:00 起 0 盏，04:59 仍是 28 盏', () => {
  assert.equal(litLampCountAt(at(4, 59), 'night', LAMP_STREET_LAMP_COUNT), 28);
  assert.equal(litLampCountAt(at(5, 0), 'night', LAMP_STREET_LAMP_COUNT), 0);
  assert.equal(LAMP_DOWN_MINUTE, 5 * 60);
});

test('灯态看相位：正午强制不亮，夜里亮；强制相位按代表时刻判', () => {
  assert.equal(lampStreetLitAt(at(12, 0), 'noon', true), false);
  assert.equal(lampStreetLitAt(at(12, 0), 'night', true), false, '世界钟说正午，相位说夜——两边都不该点灯');
  assert.equal(lampStreetLitAt(at(21, 0), 'night', true), true);
  // 强制相位（?time=）：不看世界分钟，只看这个相位的代表时刻。
  assert.equal(lampStreetLitAt(at(3, 0), 'noon', false), false);
  assert.equal(lampStreetLitAt(at(3, 0), 'dusk', false), true);
  assert.equal(lampStreetLitAt(at(3, 0), 'night', false), true);
  assert.equal(lampStreetLitAt(at(3, 0), 'dawn', false), false);
  assert.equal(LAMP_ON_MINUTE, 18 * 60);
});
