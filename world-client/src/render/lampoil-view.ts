/** 灯的绘制与忙碌程度。**渲染层独有**（#4）。
 *
 * 拆出 `villager.ts` 的理由有两条，都是它自己要求的：
 *
 * 1. **画灯要读油，读油要走一遍衰减模型**（`world/lampoil.ts`）。那段模型是纯函数，
 *    在 node 下能直接加载；`villager.ts` 引 Phaser，加载不了。放这儿，
 *    「油怎么变」就能离线单测，不必拉一整个场景起来。
 * 2. 灯是小人身上最细的一处（5×7 的灯身加一圈光晕），它改动的频率比身子高。
 *    混在 `drawBody` 里，每次调亮度都要在整帧绘制中间找那几行。
 *    这里原来写「400 行的 `drawBody`」——把 `villager.ts` 的文件行数安到了
 *    函数头上：`drawBody` 是 114 行。（那句还写「整个文件才 397 行」——397 这个数
 *    哪个版本都不是：本文件这一笔之前 `villager.ts` 是 396 行，之后是 401 行，
 *    现在 405 行。所以行数这件事我只说函数的那个，文件的说不准就不说。）
 *    数是往大了说，理由（该拆）不靠它成立。
 *
 * 纪律与 `villager.ts` 相同：坐标全是整数像素，颜色只取当次色板，不新增第 25 色。
 */

import type { VillagerMode } from '../world/types.ts';
import { isLit, lampGlow, type LampActivity } from '../world/lampoil.ts';
import type { WorldPalette } from '../world/theme.ts';
import { isWalkingMode } from './villager-frames.ts';

/**
 * 村民的忙碌程度 → 灯的耗油档。
 *
 * 归拢成三档而不是八种 mode：要的是「跑动的人灯晃得厉害、站着的人灯稳」，
 * 不是给每种动作配一条耗油曲线。八档曲线调不动，也没人看得出差别。
 */
export function lampActivityOf(mode: VillagerMode): LampActivity {
  if (isWalkingMode(mode) || mode === 'bearingDecree') return 'walk';
  if (mode === 'working' || mode === 'delivering') return 'work';
  return 'idle';
}

/**
 * 余量 → 提灯那个人的 alpha。见底时整人发灰。
 *
 * 为什么是 0.8：一盏提灯的人暗到那个程度，站在满油的邻居旁边是看得出来的。
 * 再低就开始读作「他病了」，而那不是这条要说的——他只是没油了。
 *
 * 必须每帧显式写回，不能只在见底那一次设：油补回来以后上一帧的灰得自己退掉。
 * 这条正是它要抽成纯函数的原因——`villager.ts` 引 Phaser，在 node 下加载不了，
 * 而「见底发灰、回满恢复」是 #4 的验收条件之一，得能离线单测。
 */
export function lampBodyAlpha(oil: number): number {
  return isLit(oil) ? 1 : 0.8;
}

/**
 * 画一盏提在手上的灯。原点与 `drawBody` 同一处（脚下那一点），坐标相对它。
 *
 * **亮度是连续的，灭是突然的。** 光晕的大小与浓度都随余量走，所以油是看着一点点
 * 暗下去的；灯芯到 `LAMP_DRY` 那一下灭掉，那一下是道坎，不是渐变——
 * 「还亮着」与「已经灭了」在画面上必须分得开，糊在一起就等于没有阈值。
 *
 * 光晕浓度上限沿用原来的 0.12，不放宽：那是这盏灯在 24 色里被接受的值，
 * 调大就该走一遍画面审计，不该在拆文件的时候顺手改。
 */
export function drawLamp(
  g: {
    fillStyle(color: number, alpha: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
  },
  oil: number,
  palette: WorldPalette,
): void {
  const lit = isLit(oil);
  const glow = lampGlow(oil);
  if (lit) {
    const w = 9 + 8 * glow;
    const h = 13 + 6 * glow;
    g.fillStyle(palette.warmLight, 0.12 * glow);
    g.fillRect(Math.round(9 - w / 2), Math.round(-9 - h / 2), Math.round(w), Math.round(h));
  }
  // 灯身：亮着是琥珀，灭了是炭灰。灭了还留着一只灯身，读作「他有灯，只是没油了」。
  g.fillStyle(lit ? palette.amber : palette.charcoal, 1);
  g.fillRect(8, -10, 5, 7);
  if (lit) {
    // 火芯跟着余量提亮：满油时是纯白热，见底时暗回暖光。
    g.fillStyle(palette.warmLight, 0.55 + 0.45 * glow);
    g.fillRect(9, -9, 3, 4);
  }
  // 提手。与油量无关——灯还挂在手上。
  g.fillStyle(palette.timberDark, 1);
  g.fillRect(9, -13, 1, 3);
}
