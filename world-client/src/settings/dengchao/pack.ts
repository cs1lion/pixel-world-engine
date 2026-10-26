import type { RawSettingPack } from '../types.ts';

const prefab = (
  id: string,
  displayName: string,
  w: number,
  h: number,
  roof: string,
  silhouette: 'gable' | 'tower' | 'flat' = 'gable',
): unknown => ({
  id, displayName, zone: 'industry', footprint: { w, h }, clearMargin: 1,
  door: { x: Math.floor(w / 2), y: h },
  workSpots: [{ x: Math.floor(w / 2), y: Math.floor(h / 2) }],
  chimney: { x: w - 1.2, y: 0.4 }, accent: 'smoke', silhouette, boundTask: null,
  palette: { body: 'timber', roof, trim: 'trim', window: 'amber' },
});

/** 原创灯潮界的首张户外地图；所有坐标都是可审计的数据，不是随机布景。 */
export const DENGCHAO_RAW: RawSettingPack = {
  id: 'dengchao', name: '灯潮界', saveKey: 'dengchao.pixel-world.save.v1',
  palette: {
    ink: '#111821', soil: '#202b35', grass: '#30454a', grassLit: '#52666a',
    stone: '#52666a', plaza: '#7d8984', farm: '#3d5154', timber: '#7c4a40',
    timberDark: '#412d32', trim: '#dfbd7a', amber: '#f0a44b', skin: '#d5b28c',
    cloak: '#48727b', cloakDark: '#293f50', ember: '#bf5441', pale: '#d1d7bd',
    plaster: '#b9b294', terracotta: '#a4483d', copper: '#53736d', water: '#294f60',
    moss: '#47645c', deepShade: '#1b303b', warmLight: '#f4d596', charcoal: '#2c3439',
  },
  terrainColors: {
    grass: 'grass', stone: 'stone', plaza: 'plaza', farm: 'farm', tree: 'soil',
    // 浅滩底色**不能**等于水色：两者一样时，退潮露出的滩涂和满潮的水面在屏幕上
    // 是同一块蓝，潮汐就只剩下 HUD 上的一个数字。这里用湿沙的灰绿，
    // 水面叠上去才会真的变深、变蓝。
    shallow: 'copper', mud: 'soil', coal: 'charcoal',
  },
  grid: {
    width: 64, height: 48, border: 1,
    zones: [
      { id: 'industry', x: 1, y: 1, w: 62, h: 46 },
      { id: 'street', x: 30, y: 14, w: 5, h: 32 },
    ],
  },
  terrain: [
    { x: 1, y: 1, w: 62, h: 14, terrain: 'shallow' },
    // 站台必须站在石砌码头上：直接压在浅滩上会读成"房子漂在水里"，也说不清人怎么上去。
    { x: 7, y: 9, w: 13, h: 6, terrain: 'stone' },
    { x: 1, y: 15, w: 62, h: 19, terrain: 'grass' },
    { x: 1, y: 34, w: 62, h: 13, terrain: 'coal' },
    { x: 28, y: 14, w: 9, h: 24, terrain: 'stone' },
    { x: 1, y: 28, w: 62, h: 4, terrain: 'plaza' },
    { x: 8, y: 15, w: 48, h: 4, terrain: 'stone' },
    // 叠浪楼门前的一道水口：涨潮灌满、退潮露出一线湿床，朱红桥横跨其上。
    { x: 28, y: 27, w: 9, h: 1, terrain: 'shallow' },
    { x: 28, y: 34, w: 9, h: 12, terrain: 'stone' },
    { x: 39, y: 35, w: 18, h: 8, terrain: 'mud' },
  ],
  regions: [
    { id: 'ferry', name: '渡口站台', x: 5, y: 8, w: 20, h: 10 },
    { id: 'shoal', name: '浅滩轨道', x: 1, y: 1, w: 62, h: 13 },
    { id: 'bathhouse', name: '叠浪楼', x: 27, y: 17, w: 12, h: 11 },
    { id: 'lampstreet', name: '灯街', x: 12, y: 19, w: 40, h: 15 },
    { id: 'sootbank', name: '积尘滩', x: 37, y: 34, w: 23, h: 13 },
  ],
  prefabs: {
    wave_house: prefab('wave_house', '叠浪楼', 7, 6, 'terracotta', 'tower'),
    lamp_lodge: prefab('lamp_lodge', '迎灯舍', 5, 4, 'copper'),
    tea_stall: prefab('tea_stall', '潮声茶摊', 5, 4, 'terracotta', 'flat'),
    ferry_station: prefab('ferry_station', '旧渡口站台', 6, 4, 'copper', 'flat'),
    lamp_workshop: prefab('lamp_workshop', '补灯铺', 4, 4, 'terracotta'),
    boiler_annex: prefab('boiler_annex', '炉底入口', 4, 3, 'charcoal', 'flat'),
  },
  placements: [
    { prefabId: 'wave_house', at: { x: 28, y: 20 } },
    { prefabId: 'lamp_lodge', at: { x: 18, y: 22 } },
    { prefabId: 'tea_stall', at: { x: 40, y: 22 } },
    { prefabId: 'ferry_station', at: { x: 10, y: 10 } },
    { prefabId: 'lamp_workshop', at: { x: 43, y: 34 } },
    { prefabId: 'boiler_annex', at: { x: 29, y: 14 } },
  ],
  hub: { x: 32, y: 29 },
  villagers: [
    { name: '迷路人', at: { x: 23, y: 29 }, style: { cloak: 'cloak', scarf: 'pale', lamp: false }, routine: [
      { x: 19, y: 15, label: '在旧站牌下认路', dwellMs: 6500 },
      { x: 24, y: 29, label: '沿着灯街找一盏认识的灯', dwellMs: 4800 },
      { x: 21, y: 7, label: '趁退潮看浅滩上的旧轨道', dwellMs: 6500, tide: 'low' },
      { x: 36, y: 29, label: '在叠浪楼外等潮水退去', dwellMs: 5000 },
    ] },
    { name: '汐', at: { x: 36, y: 29 }, style: { cloak: 'terracotta', scarf: 'trim', lamp: true }, routine: [
      { x: 32, y: 27, label: '点亮楼前的长灯', dwellMs: 5800 },
      { x: 19, y: 29, label: '在迎灯舍前照看来客', dwellMs: 5200 },
      { x: 39, y: 29, label: '满潮时收起滩边的灯', dwellMs: 4800, tide: 'high' },
      { x: 50, y: 42, label: '趁退潮拾回还能用的灯芯', dwellMs: 6000, tide: 'low' },
    ] },
  ],
  scenery: [
    // 叠浪楼门前的朱红桥：横跨楼前那道水口，潮水从桥下过。
    { kind: 'bridge', at: { x: 28, y: 27 }, length: 9 },
    // 浅滩轨道横贯整片浅滩，退潮时才完全露出来。
    { kind: 'track', at: { x: 2, y: 8 }, length: 60 },
    { kind: 'sign', at: { x: 19, y: 15 } },
    { kind: 'statue', at: { x: 26, y: 28 } },
    // 灯街的灯沿街两侧排，站在街边而不是草地深处：灯是街的，不是野地的。
    ...Array.from({ length: 10 }, (_, i) => ({
      kind: 'lantern' as const,
      at: { x: 15 + i * 4, y: i % 2 === 0 ? 27 : 32 },
    })),
    // 摊位与幌布补上设定集里「有人做买卖」的街面，不做成通栏招牌墙。
    { kind: 'stall', at: { x: 17, y: 26 } },
    { kind: 'stall', at: { x: 24, y: 33 } },
    { kind: 'stall', at: { x: 34, y: 26 } },
    { kind: 'banner', at: { x: 21, y: 27 } },
    { kind: 'banner', at: { x: 30, y: 33 } },
    { kind: 'banner', at: { x: 46, y: 27 } },
    // 积尘滩的废弃物堆只出现在滩上，不越到灯街。
    ...Array.from({ length: 7 }, (_, i) => ({
      kind: 'debris' as const,
      at: { x: 40 + i * 2, y: 41 + (i % 3) },
    })),
    { kind: 'steam', at: { x: 34, y: 18 } },
    { kind: 'steam', at: { x: 45, y: 37 } },
  ],
};
