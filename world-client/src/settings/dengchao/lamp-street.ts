/** 灯街的专属资产：灯柱、灯串、铺装、店铺立面、夜市摊位、竖招牌。
 *
 * 这张表是**可数的资产清单**，也是 `pack.ts` 里 scenery 的唯一来源之一：
 * 同一条街的灯与摊子不再散落在几十行 `...Array.from` 里，坐标、格数与
 * 设定集页码集中在一处，验收时数得出来。
 *
 * 坐标都在 `lampstreet` 地域内（x 12..51，y 19..33），不压叠浪楼与账房的
 * 占地；压在地上的铺装走 depth 1，楼与人物照常压在它上面。
 *
 * 来源页码指《The Art of Spirited Away》扫描件（仓库外，仅内部索引）：
 * - 灯笼与点灯：p40–41（黄昏街，成串灯笼）
 * - 店铺立面：p36–39（餐厅街与店面）
 * - 摊位与幌布：p35–36
 * - 街面铺装：p40
 * - 竖招牌：p35
 */

import type { GridPoint } from '../../world/types.ts';
import type { SettingScenery } from '../types.ts';

export interface LampStreetAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: SettingScenery['kind'];
  readonly at: GridPoint;
  readonly length?: number;
  readonly cells: number;
  readonly sourcePage: string;
}

/** 灯街资产。顺序即绘制顺序（同层内先画的在下）。 */
export const LAMP_STREET_ASSETS: readonly LampStreetAsset[] = [
  // 十根街灯：偶数位在北侧、奇数位在南侧，两排交错，避免整条街一条直线。
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `lamp_post_${i + 1}`,
    name: `街灯 ${i + 1}`,
    kind: 'lantern' as const,
    at: { x: 15 + i * 4, y: i % 2 === 0 ? 27 : 32 },
    cells: 1,
    sourcePage: 'PDF p40-41',
  })),

  // 三串成串的纸灯：挂在街面上方，一眼把「灯街」和普通街道分开。
  { id: 'lamp_string_west', name: '西段灯串', kind: 'lamp_string', at: { x: 13, y: 26 }, length: 12, cells: 12, sourcePage: 'PDF p40-41' },
  { id: 'lamp_string_east', name: '东段灯串', kind: 'lamp_string', at: { x: 36, y: 26 }, length: 12, cells: 12, sourcePage: 'PDF p40-41' },
  { id: 'lamp_string_south', name: '南段灯串', kind: 'lamp_string', at: { x: 20, y: 30 }, length: 12, cells: 12, sourcePage: 'PDF p40-41' },

  // 街面铺装：一条 40 格的石铺带，压在 plaza 地形上，给街面自己的纹理。
  { id: 'street_paving', name: '街面铺装', kind: 'paving', at: { x: 12, y: 29 }, length: 40, cells: 40, sourcePage: 'PDF p40' },

  // 三面店铺立面：压在街沿（y27）的三处空档，不再浮在北侧草地上。
  { id: 'shopfront_west', name: '西侧店面', kind: 'shopfront', at: { x: 12, y: 27 }, length: 3, cells: 6, sourcePage: 'PDF p36-39' },
  { id: 'shopfront_mid', name: '中段店面', kind: 'shopfront', at: { x: 36, y: 27 }, length: 3, cells: 6, sourcePage: 'PDF p36-39' },
  { id: 'shopfront_east', name: '东侧店面', kind: 'shopfront', at: { x: 48, y: 27 }, length: 3, cells: 6, sourcePage: 'PDF p36-39' },

  // 夜市摊位：三处旧的 + 三处新的，柜台压在人腰以下、棚顶高过人头。
  { id: 'stall_north_1', name: '北侧摊 1', kind: 'stall', at: { x: 17, y: 26 }, cells: 2, sourcePage: 'PDF p35-36' },
  { id: 'stall_south_1', name: '南侧摊 1', kind: 'stall', at: { x: 24, y: 33 }, cells: 2, sourcePage: 'PDF p35-36' },
  { id: 'stall_north_2', name: '北侧摊 2', kind: 'stall', at: { x: 34, y: 26 }, cells: 2, sourcePage: 'PDF p35-36' },
  { id: 'stall_south_2', name: '南侧摊 2', kind: 'stall', at: { x: 15, y: 32 }, cells: 2, sourcePage: 'PDF p35-36' },
  { id: 'stall_south_3', name: '南侧摊 3', kind: 'stall', at: { x: 33, y: 32 }, cells: 2, sourcePage: 'PDF p35-36' },
  { id: 'stall_east', name: '东段摊', kind: 'stall', at: { x: 47, y: 31 }, cells: 2, sourcePage: 'PDF p35-36' },

  // 幌布：三幅长短不一，给街面立起垂直节奏。
  { id: 'banner_west', name: '西侧幌布', kind: 'banner', at: { x: 21, y: 27 }, cells: 1, sourcePage: 'PDF p35' },
  { id: 'banner_south', name: '南侧幌布', kind: 'banner', at: { x: 30, y: 33 }, cells: 1, sourcePage: 'PDF p35' },
  { id: 'banner_east', name: '东侧幌布', kind: 'banner', at: { x: 46, y: 27 }, cells: 1, sourcePage: 'PDF p35' },

  // 竖招牌：三根，给街面三段各一个可读的「店名」轮廓（方块与横线，不写字）。
  { id: 'signpost_west', name: '西侧竖招牌', kind: 'signpost', at: { x: 13, y: 30 }, cells: 2, sourcePage: 'PDF p35' },
  { id: 'signpost_mid', name: '中段竖招牌', kind: 'signpost', at: { x: 34, y: 33 }, cells: 2, sourcePage: 'PDF p35' },
  { id: 'signpost_east', name: '东侧竖招牌', kind: 'signpost', at: { x: 50, y: 31 }, cells: 2, sourcePage: 'PDF p35' },
];

/** 这张表编译成脚手架认识的 scenery 数组。`cells` 与页码只留在清单里。 */
export function lampStreetScenery(): SettingScenery[] {
  return LAMP_STREET_ASSETS.map((asset) => (
    asset.length === undefined
      ? { kind: asset.kind, at: asset.at }
      : { kind: asset.kind, at: asset.at, length: asset.length }
  ));
}

/** 街灯总数：灯柱 + 每条灯串挂 6 盏。验收用这个数，不在测试里另写一份。 */
export const LAMP_STREET_LAMP_COUNT =
  LAMP_STREET_ASSETS.filter((asset) => asset.kind === 'lantern').length +
  LAMP_STREET_ASSETS
    .filter((asset) => asset.kind === 'lamp_string')
    .reduce((sum, asset) => sum + Math.floor((asset.length ?? 0) / 2), 0);
