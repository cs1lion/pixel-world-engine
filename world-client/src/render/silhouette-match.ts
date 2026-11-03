/**
 * 剪影成对相似度：遮名判据的机器版本。
 *
 * 只比同向（正/侧/背各比各的），不把不同朝向的像素叠在一起——
 * 侧背面本来就该不一样，混比会把「朝向差」当成「身份差」。
 *
 * 相似度由四项合成：
 *   - IoU（0.50）：同一格上重叠多少；
 *   - 行投影余弦（0.20）：从上到下的宽度分布；
 *   - 列投影余弦（0.15）：左右重心与肩宽位置；
 *   - 头肩比接近度（0.15）：头宽/肩宽之比，压住「整体放大缩小」的误判。
 *
 * 阈值写在 `test/cast-artbook.test.ts`，不在这里——这里只给读数。
 */
import type { VillagerSnapshot } from '../world/types.ts';
import type { VillagerLook } from '../world/villager-look.ts';
import { VILLAGER_H, VILLAGER_W, villagerLayout } from './villager-layout.ts';

export const SILHOUETTE_FACINGS = ['down', 'right', 'up'] as const;
export type SilhouetteFacing = (typeof SILHOUETTE_FACINGS)[number];

const POSE = { frame: 0, frameCount: 2, offsetY: 0, footLeft: 0, footRight: 0 };

export interface SilhouetteMask {
  readonly width: number;
  readonly height: number;
  /** 行优先的 0/1 像素格。 */
  readonly cells: Uint8Array;
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  readonly bboxW: number;
  readonly bboxH: number;
}

/** 把某一朝向的一帧画进 24×30 的固定画布，只留占/不占。 */
export function silhouetteMask(look: VillagerLook, facing: SilhouetteFacing): SilhouetteMask {
  const cells = new Uint8Array(VILLAGER_W * VILLAGER_H);
  const rects = villagerLayout(look, facing as VillagerSnapshot['facing'], POSE, false, 'idle', 0);
  for (const item of rects) {
    for (let y = item.y; y < item.y + item.h; y += 1) {
      const gy = y + VILLAGER_H;
      if (gy < 0 || gy >= VILLAGER_H) continue;
      for (let x = item.x; x < item.x + item.w; x += 1) {
        const gx = x + VILLAGER_W / 2;
        if (gx < 0 || gx >= VILLAGER_W) continue;
        cells[gy * VILLAGER_W + gx] = 1;
      }
    }
  }
  const rows = new Array<number>(VILLAGER_H).fill(0);
  const cols = new Array<number>(VILLAGER_W).fill(0);
  let minX = VILLAGER_W;
  let maxX = -1;
  let minY = VILLAGER_H;
  let maxY = -1;
  for (let y = 0; y < VILLAGER_H; y += 1) {
    for (let x = 0; x < VILLAGER_W; x += 1) {
      if (cells[y * VILLAGER_W + x] !== 1) continue;
      rows[y] += 1;
      cols[x] += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    width: VILLAGER_W,
    height: VILLAGER_H,
    cells,
    rows,
    cols,
    bboxW: maxX < 0 ? 0 : maxX - minX + 1,
    bboxH: maxY < 0 ? 0 : maxY - minY + 1,
  };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    left += a[i]! ** 2;
    right += b[i]! ** 2;
  }
  if (left === 0 || right === 0) return 0;
  return dot / Math.sqrt(left * right);
}

function headShoulderRatio(mask: SilhouetteMask): number {
  // 头 = 画布最上面 1/3；肩 = 中间 1/3。用「该段最大行宽」而不是平均值，
  // 这样发髻、兜帽、宽肩这些单点凸起不会被平均掉。
  const third = Math.max(1, Math.floor(mask.height / 3));
  let head = 0;
  let shoulder = 0;
  for (let y = 0; y < third; y += 1) head = Math.max(head, mask.rows[y]!);
  for (let y = third; y < third * 2; y += 1) shoulder = Math.max(shoulder, mask.rows[y]!);
  if (shoulder === 0) return 1;
  return head / shoulder;
}

/** 同向两两相似度，0（完全不同）…1（逐像素相同）。 */
export function silhouetteSimilarity(a: SilhouetteMask, b: SilhouetteMask): number {
  return silhouetteBreakdown(a, b).similarity;
}

/** 四项分量，给证据/调参看；判定只用 `similarity`。 */
export function silhouetteBreakdown(
  a: SilhouetteMask,
  b: SilhouetteMask,
): {
  readonly iou: number;
  readonly rowCos: number;
  readonly colCos: number;
  readonly ratioGap: number;
  readonly similarity: number;
} {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.cells.length; i += 1) {
    const left = a.cells[i] === 1;
    const right = b.cells[i] === 1;
    if (left && right) inter += 1;
    if (left || right) union += 1;
  }
  const iou = union === 0 ? 1 : inter / union;
  const rowCos = cosine(a.rows, b.rows);
  const colCos = cosine(a.cols, b.cols);
  const leftRatio = headShoulderRatio(a);
  const rightRatio = headShoulderRatio(b);
  const ratioGap = Math.min(1, Math.abs(leftRatio - rightRatio) / Math.max(leftRatio, rightRatio, 1e-6));
  const similarity = 0.5 * iou + 0.2 * rowCos + 0.15 * colCos + 0.15 * (1 - ratioGap);
  return { iou, rowCos, colCos, ratioGap, similarity };
}

export interface SilhouettePairReading {
  readonly a: string;
  readonly b: string;
  readonly facing: SilhouetteFacing;
  readonly similarity: number;
}

/** 任意两人、任意同向的全部读数。 */
export function pairwiseSilhouettes(
  looks: readonly { readonly name: string; readonly look: VillagerLook }[],
): readonly SilhouettePairReading[] {
  const out: SilhouettePairReading[] = [];
  for (const facing of SILHOUETTE_FACINGS) {
    for (let i = 0; i < looks.length; i += 1) {
      for (let j = i + 1; j < looks.length; j += 1) {
        out.push({
          a: looks[i]!.name,
          b: looks[j]!.name,
          facing,
          similarity: Number(
            silhouetteSimilarity(
              silhouetteMask(looks[i]!.look, facing),
              silhouetteMask(looks[j]!.look, facing),
            ).toFixed(3),
          ),
        });
      }
    }
  }
  return out;
}
