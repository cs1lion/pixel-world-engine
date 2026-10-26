import prefabs from '../world/prefabs.json' with { type: 'json' };
import { parseBlueprintTable } from '../world/blueprints.ts';
import { WORLD, TERRAIN_COLORS } from '../world/palette-data.ts';
import { LARGE_ALTAR, LARGE_WORLD_SPEC } from '../world/setup.ts';
import type { SettingPack } from './types.ts';
import { loadSettingPack, buildSettingWorld } from './load.ts';
import { DENGCHAO_RAW } from './dengchao/pack.ts';

const LEGACY_PACK: SettingPack = {
  id: 'default', name: '莞尔镇', saveKey: 'xiaoxi.pixel-world.save.v1',
  palette: WORLD, terrainColors: TERRAIN_COLORS,
  grid: LARGE_WORLD_SPEC, terrain: [], regions: [],
  blueprints: parseBlueprintTable(prefabs), placements: [], hub: LARGE_ALTAR,
  villagers: [], scenery: [], authored: false,
};

export function selectSetting(search: string): SettingPack {
  const id = new URLSearchParams(search).get('world');
  if (id === null || id === '' || id === 'default') return LEGACY_PACK;
  if (id === 'dengchao') return loadSettingPack(DENGCHAO_RAW);
  throw new Error(`没有这个设定集：${id}。可试 ?world=dengchao，或省略参数进入莞尔镇。`);
}

export function worldForSetting(pack: SettingPack, buildings?: Parameters<typeof buildSettingWorld>[1]) {
  return buildSettingWorld(pack, buildings);
}

export function routineProfiles(pack: SettingPack) {
  return pack.villagers.map((villager) => ({
    at: villager.at,
    // 开局带什么凭证，装载时已经从 style.lamp 算好（`load.ts`）。
    // 这里原样递下去，不再问一遍 style——那会变成第二个事实。
    carries: villager.carries,
    routine: villager.routine.map((stop, index) => ({
      id: index === 0 ? 'altar' as const : 'promenade' as const,
      label: stop.label, target: { x: stop.x, y: stop.y },
      dwellMs: stop.dwellMs ?? 5200, ...(stop.tide === undefined ? {} : { tide: stop.tide }),
    })),
  }));
}
