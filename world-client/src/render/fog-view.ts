/** 迷雾渲染：把还没长出来的地方压成一片暗。
 *
 * 只压暗、不遮挡：玩家仍能隐约看见地形轮廓，读成「还没去过」而不是「一块黑布」。
 * （这里原来还有一句「这与 ART_SPEC 的 alpha 纪律一致——压暗属于允许的三类用法
 * 之一」。两句都假：**仓库里从来没有 `ART_SPEC` 这个文档**
 * （`git log --all --diff-filter=A -- '*ART_SPEC*'` 全史为空）；而「允许的三类
 * 用法」这条规则在仓库里也找不到第二处记载——全仓只有这一行在说它。已删。）
 *
 * 烘焙成纹理而不是每帧画：下面那个循环每跑一遍就是 (1536/4)×(1152/4) = 110592
 * 次迭代、每次最多两条绘制指令，而它在揭示半径不变时**一帧都不用重画**
 * （`key` 只由 center/radius 决定，见 `update`）。与地形是同一个问题，
 * 理由见 `bake.ts`——那儿原来也写着「24 万条」，那个数比循环次数还大。
 */

import Phaser from 'phaser';
import { TILE_PX } from '../world/setup.ts';
import { WORLD } from '../world/palette-data.ts';
import { bakeLayer, type BakedLayer } from './bake.ts';
import { driftPuffs } from '../world/fog-drift.ts';

export interface FogState {
  readonly center: { readonly x: number; readonly y: number };
  readonly revealedRadius: number;
}

export interface FogView {
  /** `timeMs` 只驱动边缘雾团的漂移，不触发烘焙。 */
  update(fog: FogState, timeMs: number): void;
  /** 释放烘焙纹理。场景关闭时必须调，否则同名纹理残留。 */
  destroy(): void;
}

const FOG_DEPTH = 7950;
/** 边缘几格渐变，避免迷雾边界是一条硬线。 */
const FADE_CELLS = 14;
/** 铺雾的小块边长（像素）。4px 在 2 倍显示下是 8px 的过渡，看不出阶梯。 */
const BLOCK = 4;
/**
 * 雾团的小块边长（像素）。
 *
 * 与上面 `BLOCK` 那个 4px 不是一回事：`BLOCK` 铺的是**烘焙的雾体**，这个铺的是
 * 每帧重画的**边缘雾团**。雾团按 8px 算的理由写在 `update` 里那段注释上，
 * 由 `test/fog-puff-budget.test.ts` 按这个数与 `PUFF_RADII_TILES` 重算。
 */
export const PUFF_CELL_PX = 8;

export function createFogView(
  scene: Phaser.Scene,
  gridWidth: number,
  gridHeight: number,
): FogView {
  const width = gridWidth * TILE_PX;
  const height = gridHeight * TILE_PX;
  let layer: BakedLayer | null = null;
  let current: FogState | null = null;
  let lastKey = '';
  // 雾团是**少量独立对象**，每帧重画也不贵（十几团）。
  // 关键是它们不参与烘焙——否则每帧重烘整张大图，视野裁剪就白做了。
  const puffs = scene.add.graphics();
  puffs.setDepth(FOG_DEPTH + 1);

  /** 把给定迷雾状态画进 Graphics。首次烘焙与重烘都走这里。 */
  const paint = (g: Phaser.GameObjects.Graphics, fog: FogState): void => {
    for (let py = 0; py < height; py += BLOCK) {
      for (let px = 0; px < width; px += BLOCK) {
        const cx = px / TILE_PX;
        const cy = py / TILE_PX;
        const distance = Math.hypot(cx - fog.center.x, cy - fog.center.y);
        if (distance <= fog.revealedRadius) continue;

        const into = Math.min(1, (distance - fog.revealedRadius) / FADE_CELLS);
        // alpha 从 0 起跳，不是从 0.12：从 0.12 起会在边界画出一条可见的圆边，
        // 看起来像描边而不是雾。用 smoothstep 让过渡两端都平缓。
        const alpha = 0.44 * (into * into * (3 - 2 * into));
        // 用冷色 water 而不是夜里的 deepShade：两者都压暗，但迷雾要读成
        // "这里还没去过"，不是"天黑了"。冷色带一点蓝，与夜晚的暖窗对比明显。
        g.fillStyle(WORLD.water, alpha);
        g.fillRect(px, py, BLOCK, BLOCK);
      }
    }
  };

  return {
    update(fog, timeMs) {
      const key = `${fog.center.x},${fog.center.y},${fog.revealedRadius}`;
      if (key !== lastKey) {
        lastKey = key;
        current = fog;
        if (layer === null) {
          layer = bakeLayer(scene, 'world-fog', width, height, FOG_DEPTH, (g) => {
            if (current !== null) paint(g, current);
          });
        } else {
          layer.rebake();
        }
      }

      // 边缘雾团：每帧按时间重算。十几团、每团几块，代价可以忽略。
      //
      // 不能画成一个矩形：硬边矩形在像素风里读成"半透明贴纸"，不是雾。
      // 用 4px 的小块按距离衰减拼出来，边缘才有绒感——与迷雾本体同一种手法。
      puffs.clear();
      // 8px 一块而不是 4px。4px 时一团要 317～841 块（三类半径 40/53/66 px 各多少
      // 不一样），14 团一共 7684 块 = 15368 条指令；换 8px 是 1931 块 = 3862 条，
      // 15368/3862 = 3.98 倍——**不是整四分之一**。7684/4 该是 1921，实得 1931；
      // 三类各自除 4 得 79.25/136.75/210.25，实得 81/138/209，两个往上取、一个
      // 往下，方向还不一致。「降到四分之一」那半方向对，数差 0.5%；「一团上百块」
      // 那半照旧对（4px 下最少的一团也有 317 块）。
      // （这里原来写「十几团就是六万多条指令，超过渲染预算」——**两个数都不对**：
      // 15368 不是六万多，而 `MAX_COMMANDS` 是 30000（`scripts/check-render-budget.mjs`），
      // 光雾团这一层 15368 也没超。
      // 超的是**整帧**：烘焙后实测约 2 万那个数是在 8px 下量的，换回 4px 要再加
      // 15368−3862 = 11506 条，合计约 3.1 万，那才越过 30000。所以 8px 这个选择
      // 仍然对，但理由得算整帧，不能只算雾团——原句把两层混成了一层。）
      //
      // （2026-10-28 复审补记：上面那句「烘焙后实测约 2 万」现在**没有出处了**。
      // `scripts/check-render-budget.mjs` 里的原话是「烘焙后实测约 2 万；给一倍余量」，
      // 而那一天起它既没记是什么时候、在哪张图上测的，`git log` 里也查不到——
      // `d5edcc5` 已按「无从复核就不当已知量用」把那一句从 `MAX_COMMANDS` 上面删掉。
      // **但同一笔里我还有两句说过头了，一并作废**：「那个文件自 `996cbd3` 之后
      // 没再动过」是假的（`cff1bed` 与 `d5edcc5` 都动过它，`bake.ts` 的注释
      // 第 29-30 行早就写着 `cff1bed` 那一笔）；「该脚本现在只留
      // `MAX_COMMANDS = 30000` 一条绝对天花板，两个实测数都不留」也是假的——
      // **删掉的只有 2 万一个，77 万与 87% 还在那个脚本第 6 行。**
      // 所以「只留一条绝对天花板」只在「阈值」这个意思上成立，两个实测数还在文件头。）
      // **所以本段那句「在 8px 下量的」是个无从复核的断言**，不是我核过的。
      // 还站得住的是这一串里**不依赖 2 万的那半**：4px 下雾团 15368 条、8px 下
      // 3862 条、差 11506 条，这些由 `test/fog-puff-budget.test.ts` 按
      // `PUFF_CELL_PX` 与 `PUFF_RADII_TILES` 重算。**整帧 3.1 万因此悬着**——
      // 它等于 2 万 + 11506，2 万那一项今天核不了。要把它落到实处，得开着 dev server
      // 跑一次 `npm run test:render-budget` 现看 `stats.totalCommands`，那不在
      // `npm test` 里，所以我没跑。**在跑过之前，别把「3.1 万越过 30000」当结论用。**）
      //
      // 上面这一串数由 `test/fog-puff-budget.test.ts` 按 `PUFF_CELL_PX` 与
      // `PUFF_RADII_TILES` 重算，改任一个它都会红。
      for (const puff of driftPuffs(fog.center, fog.revealedRadius, timeMs)) {
        const cx = puff.at.x * TILE_PX;
        const cy = puff.at.y * TILE_PX;
        const r = puff.radius * TILE_PX;
        for (let dy = -r; dy <= r; dy += PUFF_CELL_PX) {
          for (let dx = -r; dx <= r; dx += PUFF_CELL_PX) {
            const d = Math.hypot(dx, dy) / r;
            if (d > 1) continue;
            // 中心浓、边缘趋零，平方衰减让过渡更柔。
            const falloff = (1 - d) * (1 - d);
            puffs.fillStyle(WORLD.water, puff.alpha * 0.24 * falloff);
            puffs.fillRect(Math.round(cx + dx), Math.round(cy + dy), PUFF_CELL_PX, PUFF_CELL_PX);
          }
        }
      }
    },

    destroy() {
      layer?.destroy();
      layer = null;
      puffs.destroy();
      lastKey = '';
    },
  };
}
