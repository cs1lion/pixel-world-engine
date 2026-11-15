/**
 * 「空景」：**无任何建筑** 的设定集，用来验证下雨躲雨规则在无建筑时的回退。
 *
 * 这不是给玩家用的设定集，是评测世界法则（`eval/sensory` 的 H2）需要的那一个极端世界：
 * 与 `dengchao` 一样复用莞尔镇的网格与 24 色、一样带 7 位村民（保证躲雨判定真的会被
 * 走到，而不是因为「世界没有居民」而变成空指针假绿），但**一个落点建筑都没有**。
 * 这样 `evaluateRainShelterRule` 的「无建筑回退」分支是被真实执行到的，不是被绕过的。
 *
 * 只走 `loadSettingPack` 这条编译路径（`authored: true`），和 `dengchao` 一样经过装载期
 * 校验，不会因为「空」而跳过任何一道校验。配色与模板直接复用 `dengchao`（同一份 24 色与
 * 蓝图），空景只把「建筑落点」置空——它与玩家设定集是两条路，评测只是借用它的网格与色板。
 */
import type { RawSettingPack } from '../types.ts';
import { LARGE_ALTAR, LARGE_WORLD_SPEC } from '../../world/setup.ts';
import { DENGCHAO_RAW } from '../dengchao/pack.ts';

/** 7 位村民：只占出生点与一条简单作息，外观与档案都省略（编译器会走默认外观）。 */
const EMPTY_VILLAGERS: RawSettingPack['villagers'] = [
  { name: '空港甲', at: { x: 5, y: 5 }, routine: [{ x: 5, y: 5, label: '巡视' }] },
  { name: '空港乙', at: { x: 10, y: 5 }, routine: [{ x: 10, y: 5, label: '巡视' }] },
  { name: '空港丙', at: { x: 15, y: 5 }, routine: [{ x: 15, y: 5, label: '巡视' }] },
  { name: '空港丁', at: { x: 20, y: 5 }, routine: [{ x: 20, y: 5, label: '巡视' }] },
  { name: '空港戊', at: { x: 25, y: 5 }, routine: [{ x: 25, y: 5, label: '巡视' }] },
  { name: '空港己', at: { x: 30, y: 5 }, routine: [{ x: 30, y: 5, label: '巡视' }] },
  { name: '空港庚', at: { x: 35, y: 5 }, routine: [{ x: 35, y: 5, label: '巡视' }] },
];

export const EMPTY_RAW: RawSettingPack = {
  ...DENGCHAO_RAW,
  id: 'empty-map',
  name: '空景',
  saveKey: 'empty-map.pixel-world.save.v1',
  palette: DENGCHAO_RAW.palette,
  terrainColors: DENGCHAO_RAW.terrainColors,
  grid: LARGE_WORLD_SPEC,
  terrain: [],
  regions: [],
  sites: [],
  prefabs: DENGCHAO_RAW.prefabs,
  placements: [],
  hub: LARGE_ALTAR,
  villagers: EMPTY_VILLAGERS,
  scenery: [],
};
