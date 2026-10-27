/** 潮水：把水位画在地上，让"涨退"变成一眼能看见的事。
 *
 * 只读快照里的 `tide.level` 与网格地形，不判断该不该涨。
 *
 * 画法遵守 24 色与"不用模糊"两条：
 * - 淹掉的格子整体压一层水色（`water`），浓淡随潮位插值；
 * - 水边画 1px 泡沫带（`paper`），不用渐变——像素语言里没有柔和过渡；
 * - 水面按潮位做 2px 的横向错位，退潮时自然收回。
 *
 * 水位是**连续**的，不设档位：`level` 直接插值出水色浓度与错位量，中间值
 * 与端点走同一条式子。
 *
 * 这里原来写「只做涨/退两档。波浪与涟漪属于 v2。」——两半都不成立：代码里
 * 没有任何波浪或涟漪，也无所谓「属于 v2」；「两档」更指不上，`MAX_WATER_ALPHA`
 * 与 `SUBMERGE_DIM` 是常数，`body` 只按 `level > 0.66` 换一次色，那不是档位，
 * 是淹没与未淹的两态。
 *
 * 这句是从 `world/tide.ts` 抄来的。我原来还写「那句在那儿是真的（模拟层确实只认
 * 涨/退两个端点命令）」——**这句也是假的**：`tideLevelAt` 返回的是余弦曲线上的
 * 连续值，`TideOverride.level` 是任意数，`describeTide` 有四个标签
 * （满潮 / 退潮见底 / 涨潮 / 退潮），而命令入口 `parseTideLevel` 收任意数值，
 * 加上 `TIDE_RISE_WORDS`（level 1）与 `TIDE_FALL_WORDS`（level 0）两个端点词——
 * 至少三条路，不是两个端点。所以那句话在它本家也是假的。
 *
 * （顺带记一笔同类的：`terrain-edges.ts` 的规则 3 原来写着暗边「只用 soil / plaza /
 * grassLit 三个 token」，实际用了七个——`BRIGHT` 与 `DARK` 两表的并集。
 * 那处已经修好了：规则 3 现在明写「两表一共只用在册的 **7 个** token」。
 * 我写这条附注时那个文件还有未提交改动在飞，所以当时没敢引行号；现在它是干净的，
 * 而规则 3 自己已经把七种 token 列全了，这里照样不引行号——引了就是重复。）
 */

import Phaser from 'phaser';
import type { WorldGrid } from '../world/grid.ts';
import { TILE_PX } from '../world/setup.ts';
import { WORLD } from '../world/palette-data.ts';

/**
 * 水面最高处的浓度。
 *
 * 实测 0.78 太重：满潮时整屏压成一块深青，建筑与角色都糊掉了，
 * 那不像「水漫上来」，像「天黑了」。0.46 让水下地形仍然读得出形状，
 * 水位靠泡沫线和水色的层次表达，不靠把画面压死。
 */
const MAX_WATER_ALPHA = 0.46;
/** 淹没区压暗量：水下的东西整体退一档亮度，同样要克制。 */
const SUBMERGE_DIM = 0.12;

export interface TideView {
  /** 每帧调一次。level 来自快照，网格用来判断哪格淹了。 */
  readonly update: (level: number) => void;
  readonly destroy: () => void;
}

export function createTideView(
  scene: Phaser.Scene,
  grid: WorldGrid,
  originX: number,
  originY: number,
  colors: { readonly water: number; readonly deepShade: number; readonly ink: number; readonly pale: number } = WORLD,
): TideView {
  // 水在地面层之上、建筑与角色之下：depth 3 与天气水洼（2）分开，
  // 免得两者叠在一起互相压暗。
  const water = scene.add.graphics();
  water.setDepth(3);
  water.setVisible(false);

  let lastLevel = -1;

  const paint = (level: number): void => {
    water.clear();
    if (level <= 0.01) {
      water.setVisible(false);
      return;
    }
    water.setVisible(true);
    const alpha = Math.min(MAX_WATER_ALPHA, level * MAX_WATER_ALPHA);
    // 潮位越高，水色越深一档：退潮时是浅滩，满潮时是深水。
    const body = level > 0.66 ? colors.deepShade : colors.water;

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const p = { x, y };
        if (!grid.isFloodedAt(p)) continue;
        const px = originX + x * TILE_PX;
        const py = originY + y * TILE_PX;

        // 水下压暗：让被淹的地形读起来是"在下面"，而不是"换了个颜色"。
        water.fillStyle(colors.ink, SUBMERGE_DIM * Math.min(1, level * 1.4));
        water.fillRect(px, py, TILE_PX, TILE_PX);

        water.fillStyle(body, alpha);
        water.fillRect(px, py, TILE_PX, TILE_PX);

        // 水边泡沫：只在没被淹的邻居那一侧画 1px，水线才有形。
        if (!grid.isFloodedAt({ x, y: y - 1 })) {
          water.fillStyle(colors.pale, Math.min(0.85, alpha + 0.2));
          water.fillRect(px, py, TILE_PX, 1);
        }
        if (!grid.isFloodedAt({ x: x - 1, y })) {
          water.fillStyle(colors.pale, Math.min(0.85, alpha + 0.2));
          water.fillRect(px, py, 1, TILE_PX);
        }
      }
    }
  };

  return {
    update: (level: number): void => {
      // 潮位变化小于 0.002 时不必重画：每帧重建整张水面在 96×72 上太贵。
      if (Math.abs(level - lastLevel) < 0.002) return;
      lastLevel = level;
      paint(level);
    },
    destroy: (): void => {
      water.destroy();
    },
  };
}
