/** 场景 → `art1/lighting-sources.ts` 的读数装配（**唯一**读世界的那一侧）。
 *
 * `render/art1/lighting-sources.ts` 只认普通形状（坐标 + kind + 序号），
 * 「世界此刻有没有这盏灯」的判据留在本文件：它 import 的是既有读数模块，
 * 不新写一套（灯位来自摆件表、窗光来自工作站活动、雨强来自 `sim`）。
 *
 * 为什么要单独一个文件装这件事：表现层的数据装配如果散在 `SandboxScene`
 * 的 `update` 里，就变成了「没人知道哪盏灯为什么亮」。集中在这里，
 * 每条判据都能指名它抄的是谁的现成读数。
 */

import { TILE_PX } from '../../world/setup.ts';
import type { WorldProp, PlacedBuilding } from '../../world/types.ts';
import { buildWarmSources, hallAnchorsOf, lampAnchorsOf, type LightAnchor } from '../art1/lighting-sources.ts';
import type { WarmLightSource } from '../art1/lighting.ts';

/** 场景递给本文件的读数：全部是快照里已有的东西，不做二次判断。 */
export interface LightingReadings {
  readonly props: readonly WorldProp[];
  readonly buildings: readonly PlacedBuilding[];
  /** 此刻正在开工的楼（`activity !== 'idle'`）——由场景按快照算，不在这里判。 */
  readonly activeInstanceIds: ReadonlySet<string>;
  /** 设定集街灯读数（`settingScenery.lampUnits()`）；旧镇没有设定集时为空。 */
  readonly streetLamps: readonly { readonly order: number; readonly x: number; readonly y: number; readonly hanging: boolean }[];
  /** 灯塔位（世界像素）：设定集渡口图有，旧镇没有。 */
  readonly beacon: { readonly x: number; readonly y: number } | null;
  /** 街灯此刻该亮几盏（`litLampCountAt` 的读数，判据在 `world/lamp-street.ts`）。 */
  readonly litLampCount: number;
}

/**
 * 组装这一轮的光源表。
 *
 * 三个来源，各抄一处现成读数：
 *   - **街灯**：优先用设定集的 `lampUnits()`（那 28 盏的坐标与渐次顺序是
 *     渲染层已有的事实）；没有设定集时退回摆件表里 `kind === 'lamp'` 的灯。
 *     「该亮几盏」由 `litLampCount` 裁——判据本身在 `world/lamp-street.ts`，
 *     这里只乘数量。
 *   - **窗口**：正在开工的楼（活动非 idle）。没人干活的楼不发光，
 *     夜里整条街一片暖光会读成「所有人都在忙」。
 *   - **灯塔**：设定集给的渡口灯塔，一盏，永远最亮。
 */
export function assembleWarmSources(readings: LightingReadings): WarmLightSource[] {
  const anchors: LightAnchor[] = [];

  if (readings.streetLamps.length > 0) {
    anchors.push(...lampAnchorsOf(readings.streetLamps, readings.litLampCount));
  } else {
    // 旧镇：街灯是摆件。坐标按格算像素（灯柱画在格中心偏左 2px，与
    // `decor.ts` 的 `drawLamp` 同一锚点，差一像素就会晕在灯柱外）。
    const lamps = readings.props
      .filter((prop) => prop.kind === 'lamp')
      .map((prop, index) => ({
        x: prop.at.x * TILE_PX + 6,
        y: prop.at.y * TILE_PX - 4,
        kind: 'lamp' as const,
        index,
      }));
    anchors.push(...lamps.slice(0, Math.max(0, readings.litLampCount)));
  }

  anchors.push(
    ...hallAnchorsOf(
      readings.buildings.map((building) => ({
        instanceId: building.instanceId,
        x: building.origin.x * TILE_PX,
        // 楼底落地线：与 `buildings.ts` 的 `buildingBaseY` 同一个数（origin.y + h）。
        // 用占地行数换算，不 import 那个函数：它要的是 py（含 groundTopY 的抬层）。
        y: (building.origin.y + building.footprint.h) * TILE_PX,
        w: building.footprint.w * TILE_PX,
        h: building.footprint.h * TILE_PX,
        active: readings.activeInstanceIds.has(building.instanceId),
      })),
    ),
  );

  if (readings.beacon !== null) {
    anchors.push({ x: Math.round(readings.beacon.x), y: Math.round(readings.beacon.y), kind: 'beacon', index: 0 });
  }

  return buildWarmSources(anchors);
}

/**
 * 亮窗比例：正在开工的楼占总楼数的比例。
 *
 * 它是**画面量**（窗口光晕的呼吸深度），不是世界事实，所以直接由场景
 * 把两个已有的数递进来相除；除不到就 0，一个都不亮。
 */
export function litWindowRatio(activeCount: number, buildingCount: number): number {
  if (!Number.isFinite(buildingCount) || buildingCount <= 0) return 0;
  return Math.min(1, Math.max(0, activeCount / buildingCount));
}
