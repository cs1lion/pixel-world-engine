import prefabs from '../world/prefabs.json' with { type: 'json' };
import { parseBlueprintTable } from '../world/blueprints.ts';
import { WORLD, TERRAIN_COLORS } from '../world/palette-data.ts';
import { activateWorld, registerWorldPalette } from '../world/theme.ts';
import { LARGE_ALTAR, LARGE_WORLD_SPEC } from '../world/setup.ts';
import type { SettingPack } from './types.ts';
import {
  loadSettingPack,
  buildSettingWorld,
  resolveStopPoint,
  siteTargetResolver,
} from './load.ts';
import { DENGCHAO_RAW } from './dengchao/pack.ts';
import { PACE, dwellMsForSetting } from '../world/pace.ts';

const LEGACY_PACK: SettingPack = {
  id: 'default', name: '莞尔镇', saveKey: 'xiaoxi.pixel-world.save.v1',
  palette: WORLD, terrainColors: TERRAIN_COLORS,
  grid: LARGE_WORLD_SPEC, terrain: [], regions: [],
  blueprints: parseBlueprintTable(prefabs), placements: [], hub: LARGE_ALTAR,
  villagers: [], scenery: [], authored: false,
};

/** 选了哪套设定集，就把它的 24 色挂到渲染层的当前世界指针上。
 *
 * 这条链只有这一个入口：渲染代码不认 `pack`，只问 `paletteFor()`；
 * 所以「激活」必须和「选包」绑在一起，不能另开一条路。
 */
function useSetting(pack: SettingPack): SettingPack {
  registerWorldPalette(pack.id, pack.palette, pack.terrainColors);
  activateWorld(pack.id);
  return pack;
}

export function selectSetting(search: string): SettingPack {
  const id = new URLSearchParams(search).get('world');
  if (id === null || id === '' || id === 'default') return useSetting(LEGACY_PACK);
  if (id === 'dengchao') return useSetting(loadSettingPack(DENGCHAO_RAW));
  throw new Error(`没有这个设定集：${id}。可试 ?world=dengchao，或省略参数进入莞尔镇。`);
}

export function worldForSetting(pack: SettingPack, buildings?: Parameters<typeof buildSettingWorld>[1]) {
  return buildSettingWorld(pack, buildings);
}

export { siteTargetResolver };

/** 场所落点 → 这条作息自己的 id。表里没有的场所走通用 `promenade`。 */
const SITE_ROUTINE_IDS: Readonly<Record<string, 'courtyard'>> = { courtyard: 'courtyard' };

export function routineProfiles(
  pack: SettingPack,
  resolveSite: (site: string) => { x: number; y: number } = siteTargetResolver(pack),
) {
  // 场所 id → 种类。门控只认种类（时刻表以 kind 为 id）；落点靠 id 区分，
  // 所以同一处花径可以有两个站位锚，门却只有一扇。
  const kindOf = new Map((pack.sites ?? []).map((site) => [site.id, site.kind]));
  return pack.villagers.map((villager) => ({
    at: villager.at,
    // 开局带什么凭证，装载时已经从 style.lamp 算好（`load.ts`）。
    // 这里原样递下去，不再问一遍 style——那会变成第二个事实。
    carries: villager.carries,
    routine: villager.routine.map((stop, index) => {
      const kind = 'site' in stop ? kindOf.get(stop.site) : undefined;
      return {
        // 场所落点带自己的 id（现在只有花径）；坐标落点沿用原来的两项。
        id: index === 0
          ? 'altar' as const
          : (kind === undefined
              ? 'promenade' as const
              : (SITE_ROUTINE_IDS[kind] ?? 'promenade' as const)),
        label: stop.label,
        // 设定集的落点只有坐标，没有目的地的名字，所以默认那句是「赶路」——
        // 与 `villager-words.ts` 里 `toWork` 挑不到铺子时的说法同一句。想说
        // 「去浅滩」的设定集自己在 `going` 里写，写了就说它写的。
        going: stop.going ?? '赶路',
        // 给场所的落点在这里解析成格：锚 + `nearestWalkable`。解析不到就 throw，
        // 不静默落到 (0,0)。
        target: resolveStopPoint(stop, resolveSite),
        // 设定集给的是相对长短（4600–6500 的旧毫秒值），世界负责把它折进
        // 20–40 世界分钟的节奏（见 `pace.ts`）。省略就是默认停留。
        dwellMs: stop.dwellMs === undefined ? PACE.dwellDefaultMs : dwellMsForSetting(stop.dwellMs),
        ...(stop.tide === undefined ? {} : { tide: stop.tide }),
        // 场所开关：关着时这一拍退回锚点，口径与潮汐条件一致。
        ...(kind === undefined ? {} : { site: kind }),
      };
    }),
  }));
}
