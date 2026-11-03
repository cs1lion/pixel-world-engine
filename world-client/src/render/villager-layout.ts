/** 24×30 村民的分层排版：纯像素矩形数据，不引 Phaser，Node 里能直接验算。
 *
 * 为什么把「长什么样」和「怎么画」分开：
 *   - 可判别性验收（两两 ΔE、剪影类数、四维不撞车）要能量，而量化只能对着
 *     排版数据做；
 *   - 绘制只剩「把矩形交给 `Graphics.fillRect`」这一件事，改像素不会顺手改色。
 *
 * 分层顺序（先画的在下面）：身体/外套 → 头发与头饰 → 围巾 → 手持物。
 * 每层仍是 1px `ink` 外轮廓优先、颜色后填，所以任意两层叠起来都读得出边界。
 *
 * 坐标系：原点在**脚底**（格子的下缘），向上为负。`TILE_PX` 仍是 16，
 * 角色 30 高会跨到上一格 14px；这是有意的「跨格悬垂」，深度仍按脚底算。
 */

import type { VillagerMode, VillagerSnapshot } from '../world/types.ts';
import type { WorldColor } from '../world/palette-data.ts';
import type { VillagerLook } from '../world/villager-look.ts';
import type { VillagerPose } from './villager-frames.ts';

/** 名义画布宽度；实际剪影 18–24，宽出来的部分是马尾/灯/杖/侧包。 */
export const VILLAGER_W = 24;
/** 名义画布高度（脚底到头顶）。 */
export const VILLAGER_H = 30;

/**
 * 调色角色。`base/shade/hair/scarf/scarfLit` 由外观的 token 槽解析，
 * 其余直接就是世界 24 色的 token 名。
 */
export type PaintRole =
  | 'base'
  | 'shade'
  | 'hair'
  | 'scarf'
  | 'scarfLit'
  | WorldColor;

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly paint: PaintRole;
}

interface BuildSpec {
  readonly headW: number;
  readonly headH: number;
  readonly headTop: number;
  readonly torsoTop: number;
  readonly shoulder: number;
  readonly hem: number;
  readonly legTop: number;
}

/**
 * 四档体型：肩宽/下摆/腿长一起变，差距要大到「剪影」能分开，而不只是胖一圈。
 *   slim  肩 9 / 摆 11 —— 窄，摆几乎不张；
 *   adult 肩 12 / 摆 15 —— 标准 A 字；
 *   stout 肩 15 / 摆 18 —— 宽，摆张得最开（含 1px 轮廓刚好 20，仍在 24 内）；
 *   tall  头 9×11 / 肩 9 / 摆 12 —— 头更长、腿更长，给无面者那种窄高轮廓。
 */
const BUILD: Readonly<Record<VillagerLook['build'], BuildSpec>> = {
  slim: { headW: 10, headH: 10, headTop: -29, torsoTop: -18, shoulder: 9, hem: 11, legTop: -6 },
  adult: { headW: 12, headH: 10, headTop: -29, torsoTop: -18, shoulder: 12, hem: 15, legTop: -6 },
  stout: { headW: 13, headH: 10, headTop: -27, torsoTop: -17, shoulder: 15, hem: 18, legTop: -5 },
  tall: { headW: 9, headH: 11, headTop: -29, torsoTop: -19, shoulder: 9, hem: 12, legTop: -7 },
};

/** 一格的左右极值（格宽是奇数时左多一像素，和旧的 A 字下摆同一习惯）。 */
function span(width: number): { left: number; right: number } {
  const left = -Math.floor(width / 2);
  return { left, right: left + width - 1 };
}

function rect(x: number, y: number, w: number, h: number, paint: PaintRole): PixelRect | null {
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h, paint };
}

function push(out: PixelRect[], items: readonly (PixelRect | null)[]): void {
  for (const item of items) if (item !== null) out.push(item);
}

/** 头部：轮廓、表情、四种头型。 */
function headRects(look: VillagerLook, facing: VillagerSnapshot['facing'], blink: boolean): PixelRect[] {
  const b = BUILD[look.build];
  // 兜帽的外轮廓比头再高 2px、发髻再高 3px，都被这 1–2px 下移收回 30px 画布内。
  const top = look.head === 'bun' ? b.headTop + 2 : look.head === 'hood' ? b.headTop + 1 : b.headTop;
  const hw = b.headW;
  const hh = b.headH;
  const hx = -Math.floor(hw / 2);
  const out: PixelRect[] = [];

  if (look.head === 'hood') {
    // 兜帽：外轮廓比头宽 4px、上缘再抬 1px；脸只开一个小窗。
    push(out, [
      rect(hx - 2, top - 2, hw + 4, hh + 4, 'ink'),
      rect(hx - 1, top - 1, hw + 2, hh + 2, 'shade'),
      rect(hx - 3, top + hh - 2, 5, 10, 'ink'),
      rect(hx - 2, top + hh - 1, 3, 8, 'shade'),
      rect(hx + hw - 2, top + hh - 2, 5, 10, 'ink'),
      rect(hx + hw - 1, top + hh - 1, 3, 8, 'shade'),
      // 帽檐的亮边：只给左上 1px，保住「头不是一团黑」。
      rect(hx - 2, top - 2, hw + 3, 1, 'hair'),
      rect(hx + 1, top - 1, 3, 1, 'pale'),
    ]);
    if (facing !== 'up') {
      push(out, [
        rect(hx + 1, top + 3, hw - 2, 6, 'skin'),
        rect(hx + 1, top + 3, hw - 2, 1, 'hair'),
      ]);
      // 眼在窗口内；两侧各收 1px，兜帽下的脸更窄。
      const eyeY = top + 6;
      out.push(...eyeRects(hx + 2, hw - 4, eyeY, facing, blink));
    }
    return out;
  }

  if (look.head === 'mask') {
    // 无面者：黑/半透明长袍兜住整个头，正面只留一张白面具；背面就是一块黑。
    push(out, [
      rect(hx - 1, top - 1, hw + 2, hh + 2, 'ink'),
      rect(hx, top, hw, hh, 'shade'),
      rect(hx, top, 1, hh, 'base'),
    ]);
    if (facing === 'up') return out;
    const maskW = facing === 'down' ? hw - 2 : Math.max(5, hw - 3);
    const maskH = hh - 4;
    const mx = facing === 'down'
      ? hx + 1
      : facing === 'right' ? hx + hw - maskW - 1 : hx + 1;
    const my = top + 2;
    push(out, [
      rect(mx - 1, my - 1, maskW + 2, maskH + 2, 'ink'),
      rect(mx, my, maskW, maskH, 'pale'),
    ]);
    const eyeY = my + 2;
    if (facing === 'down') {
      push(out, [
        rect(mx + 1, eyeY, 1, 2, 'ink'),
        rect(mx + maskW - 2, eyeY, 1, 2, 'ink'),
        rect(mx + 1, eyeY + 2, 1, 1, 'deepShade'),
        rect(mx + maskW - 2, eyeY + 2, 1, 1, 'deepShade'),
        rect(mx + Math.floor(maskW / 2) - 1, my + maskH - 2, 2, 1, 'ink'),
      ]);
    } else {
      const ex = facing === 'right' ? mx + maskW - 3 : mx + 2;
      push(out, [
        rect(ex, eyeY, 1, 2, 'ink'),
        rect(ex, eyeY + 2, 1, 1, 'deepShade'),
        rect(ex + (facing === 'right' ? -1 : 1), my + maskH - 2, 1, 1, 'ink'),
      ]);
    }
    return out;
  }

  if (look.head === 'beard') {
    // 锅炉房老人：秃顶、两鬓白毛、长须、圆框眼镜；正面/侧面都要读到「白胡子」。
    push(out, [rect(hx - 1, top - 1, hw + 2, hh + 2, 'ink')]);
    if (facing === 'up') {
      push(out, [
        rect(hx, top, hw, hh, 'skin'),
        rect(hx + 1, top, hw - 2, 2, 'skin'),
        rect(hx, top + 3, 2, hh - 4, 'hair'),
        rect(hx + hw - 2, top + 3, 2, hh - 4, 'hair'),
        rect(hx + 1, top + hh - 2, hw - 2, 4, 'hair'),
      ]);
      return out;
    }
    const side = facing === 'left' ? -1 : 1;
    const faceW = facing === 'down' ? hw - 2 : hw - 4;
    const faceX = facing === 'down' ? hx + 1 : side < 0 ? hx + 1 : hx + 3;
    push(out, [
      rect(hx, top, hw, hh, 'skin'),
      rect(faceX, top + 2, faceW, hh - 2, 'skin'),
      // 秃顶只留两侧白毛。
      rect(hx, top + 3, 2, hh - 4, 'hair'),
      rect(hx + hw - 2, top + 3, 2, hh - 4, 'hair'),
      // 八字须与长须；须尖压到胸口，形成倒三角。
      rect(faceX + 1, top + hh - 3, faceW - 2, 1, 'hair'),
      rect(hx + 1, top + hh - 2, hw - 2, 2, 'ink'),
      rect(hx + 2, top + hh - 1, hw - 4, 7, 'hair'),
    ]);
    const eyeY = top + 5;
    if (facing === 'down') {
      push(out, [
        rect(hx + 2, eyeY, 3, 2, 'ink'),
        rect(hx + hw - 5, eyeY, 3, 2, 'ink'),
        rect(hx + 3, eyeY + 1, 1, 1, 'pale'),
        rect(hx + hw - 4, eyeY + 1, 1, 1, 'pale'),
        rect(hx + 5, eyeY, hw - 10, 1, 'trim'),
      ]);
    } else {
      const lx = facing === 'right' ? hx + hw - 6 : hx + 2;
      push(out, [
        rect(lx, eyeY, 3, 2, 'ink'),
        rect(lx + 1, eyeY + 1, 1, 1, 'pale'),
      ]);
    }
    return out;
  }

  if (look.head === 'yubaba') {
    // 掌柜：极高的白发髻、大鼻、深眼窝、金耳饰；靠一圈外扩白发把轮廓撑大。
    push(out, [
      rect(hx - 3, top - 3, hw + 6, hh + 5, 'ink'),
      rect(hx - 2, top - 2, hw + 4, hh + 3, 'hair'),
      rect(hx - 1, top - 2, hw + 2, 1, 'pale'),
    ]);
    const cx = hx + Math.floor(hw / 2);
    push(out, [
      rect(cx - 3, top - 3, 7, 4, 'ink'),
      rect(cx - 2, top - 2, 5, 2, 'hair'),
      rect(cx - 1, top - 2, 1, 1, 'pale'),
      rect(cx - 2, top, 5, 1, 'ink'),
    ]);
    if (facing === 'up') return out;
    const faceX = facing === 'down' ? hx + 1 : facing === 'right' ? hx + 2 : hx + 1;
    const faceW = facing === 'down' ? hw - 2 : hw - 4;
    push(out, [
      rect(faceX, top + 2, faceW, hh - 2, 'skin'),
      rect(faceX, top + 2, faceW, 1, 'hair'),
      // 大鼻：2px 深色阴影，正面才压。
      rect(cx - 1, top + 5, 2, 2, 'skin'),
      rect(cx - 1, top + 7, 2, 1, 'ink'),
      rect(hx - 1, top + hh - 3, 1, 2, 'trim'),
      rect(hx + hw, top + hh - 3, 1, 2, 'trim'),
    ]);
    const eyeY = top + 5;
    out.push(...eyeRects(faceX + 2, faceW - 3, eyeY, facing, blink));
    if (facing === 'down') {
      out.push({ x: cx - 2, y: eyeY, w: 1, h: 1, paint: 'shade' });
      out.push({ x: cx + 2, y: eyeY, w: 1, h: 1, paint: 'shade' });
    }
    return out;
  }

  push(out, [rect(hx - 1, top - 1, hw + 2, hh + 2, 'ink')]);

  if (facing === 'up') {
    // 背面：整块头发，不留脸。
    push(out, [rect(hx, top, hw, hh, 'hair')]);
  } else {
    push(out, [
      rect(hx, top, hw, 3, 'hair'),
      rect(hx, top + 2, 1, hh - 2, 'hair'),
      rect(hx + hw - 1, top + 2, 1, hh - 2, 'hair'),
      rect(hx + 1, top + 2, hw - 2, hh - 3, 'skin'),
      // 刘海压住额头 1px，脸不至于读成一块方皮肤。
      rect(hx + 1, top + 2, hw - 2, 1, 'hair'),
      // 发丝高光只给 2px。
      rect(hx + 1, top, 2, 1, 'hair'),
      rect(hx + 1, top, 1, 1, 'pale'),
    ]);
    out.push(...eyeRects(hx + 2, hw - 4, top + hh - 5, facing, blink));
  }

  if (look.head === 'bob') {
    // 齐耳短发：两颊各多一块，收在头轮廓里。
    push(out, [
      rect(hx, top + hh - 4, 2, 4, 'hair'),
      rect(hx + hw - 2, top + hh - 4, 2, 4, 'hair'),
    ]);
  } else if (look.head === 'ponytail') {
    const side = facing === 'left' ? -1 : 1;
    const baseX = side < 0 ? hx - 1 : hx + hw - 1;
    push(out, [
      rect(baseX + (side < 0 ? -2 : 1), top + 3, 3, 4, 'ink'),
      rect(baseX + (side < 0 ? -1 : 1), top + 4, 2, 2, 'hair'),
      rect(baseX + (side < 0 ? -3 : 2), top + 7, 4, 6, 'ink'),
      rect(baseX + (side < 0 ? -2 : 2), top + 8, 3, 4, 'hair'),
      rect(baseX + (side < 0 ? -2 : 1), top + 13, 3, 5, 'ink'),
      rect(baseX + (side < 0 ? -1 : 1), top + 13, 2, 4, 'hair'),
    ]);
  } else if (look.head === 'bun') {
    const cx = hx + Math.floor(hw / 2);
    push(out, [
      rect(cx - 2, top - 3, 5, 4, 'ink'),
      rect(cx - 1, top - 2, 3, 2, 'hair'),
      rect(cx - 1, top - 2, 1, 1, 'pale'),
    ]);
  }
  return out;
}

/** 眼睛：朝下两只、朝侧一只；眨眼只闭 1 帧的时长。 */
function eyeRects(
  x: number,
  width: number,
  y: number,
  facing: VillagerSnapshot['facing'],
  blink: boolean,
): PixelRect[] {
  const out: PixelRect[] = [];
  const w = blink ? 2 : 1;
  if (facing === 'down' || facing === 'up') {
    out.push({ x, y, w, h: 1, paint: 'ink' });
    out.push({ x: x + width - 1, y, w, h: 1, paint: 'ink' });
  } else if (facing === 'right') {
    out.push({ x: x + width - 2, y, w, h: 1, paint: 'ink' });
  } else {
    out.push({ x: x + 1, y, w, h: 1, paint: 'ink' });
  }
  return out;
}

/** 外套/斗篷/围裙/长袍：肩宽、下摆、暗部与开衩。 */
function outfitRects(look: VillagerLook): PixelRect[] {
  const b = BUILD[look.build];
  const top = b.torsoTop;
  const out: PixelRect[] = [];
  const { left: sLeft, right: sRight } = span(b.shoulder);
  const { left: hLeft, right: hRight } = span(b.hem);

  const band = (y: number, h: number, left: number, right: number): void => {
    const width = right - left + 1;
    out.push(rect(left - 1, y, width + 2, h, 'ink') as PixelRect);
    out.push(rect(left, y, width, h, 'base') as PixelRect);
    // 右缘 1px 暗部：光从左上来，右边就该压一档。
    out.push(rect(right, y, 1, h, 'shade') as PixelRect);
  };

  if (look.outfit === 'cloak') {
    // A 字：肩 10–14 → 下摆 12–16，四段阶梯；下摆止于 -4，脚露 4px。
    band(top, 4, sLeft, sRight);
    band(top + 4, 5, sLeft - 1, sRight + 1);
    band(top + 9, 4, hLeft, hRight);
    band(top + 13, 2, hLeft, hRight);
    out.push(rect(hLeft, top + 14, b.hem, 1, 'shade') as PixelRect);
    // 腰带：把 A 字切成「上身/裙摆」。
    out.push(rect(sLeft, top + 4, b.shoulder, 1, 'shade') as PixelRect);
  } else if (look.outfit === 'coat') {
    // 直筒长外套：肩宽到底，下摆再宽一格；正中一条暗缝。
    band(top, 10, sLeft, sRight);
    band(top + 10, 3, sLeft - 1, sRight + 1);
    band(top + 13, 2, sLeft - 1, sRight + 1);
    const mid = Math.floor((sLeft + sRight) / 2);
    out.push(rect(mid, top + 2, 1, 11, 'shade') as PixelRect);
    // 开衩：正中 1px ink，走路时读得出两条腿。
    out.push(rect(mid, top + 14, 1, 2, 'ink') as PixelRect);
  } else if (look.outfit === 'apron') {
    // 围裙：直身上衣 + 一块更暗的围裙面 + 腰带。
    band(top, 12, sLeft, sRight);
    band(top + 12, 3, hLeft, hRight);
    const panelX = sLeft + 1;
    const panelW = b.shoulder - 2;
    out.push(rect(panelX, top + 2, panelW, 11, 'shade') as PixelRect);
    out.push(rect(panelX, top + 2, panelW, 1, 'scarfLit') as PixelRect);
    out.push(rect(sLeft, top + 8, b.shoulder, 1, 'ink') as PixelRect);
  } else if (look.outfit === 'tunic') {
    // 短工作服：只到腰下，露出短裤和赤脚；白色前襟 + 蓝色短裤来自设定集。
    band(top, 5, sLeft, sRight);
    band(top + 5, 3, sLeft - 1, sRight + 1);
    out.push(rect(sLeft + 2, top + 1, b.shoulder - 4, 6, 'scarfLit') as PixelRect);
    out.push(rect(sLeft, top + 5, b.shoulder, 1, 'scarf') as PixelRect);
    const shortsY = b.legTop - 3;
    out.push(rect(sLeft + 1, shortsY, b.shoulder - 2, 3, 'water') as PixelRect);
    out.push(rect(sLeft + 1, shortsY, b.shoulder - 2, 1, 'shade') as PixelRect);
  } else {
    // 长袍：窄直身、到底再收一档，两侧开衩。
    band(top, 12, sLeft, sRight);
    band(top + 12, 4, sLeft, sRight);
    const mid = Math.floor((sLeft + sRight) / 2);
    out.push(rect(mid, top + 3, 1, 12, 'shade') as PixelRect);
    out.push(rect(sLeft, top + 13, 1, 3, 'ink') as PixelRect);
    out.push(rect(sRight, top + 13, 1, 3, 'ink') as PixelRect);
  }

  // 下摆底边压一档：脚才不会浮在下摆上。短工作服没有长下摆，跳过。
  if (look.outfit !== 'tunic') {
    out.push(rect(hLeft - 1, top + 15, b.hem + 2, 1, 'shade') as PixelRect);
  }
  return out;
}

/** 腿/靴：下摆以下只露 3–4px，但脚的动作必须看得出来。 */
function legRects(look: VillagerLook, pose: VillagerPose, walking: boolean): PixelRect[] {
  const b = BUILD[look.build];
  const y = b.legTop;
  const h = -y;
  const leftX = -4 + (walking ? pose.footLeft : 0);
  const rightX = 1 + (walking ? pose.footRight : 0);
  if (look.outfit === 'tunic') {
    // 赤脚：短裤下直接是肤色，脚背 1px，脚底不另加靴。
    return [
      rect(leftX - 1, y, 5, h, 'ink'),
      rect(leftX, y, 3, h, 'skin'),
      rect(rightX - 1, y, 5, h, 'ink'),
      rect(rightX, y, 3, h, 'skin'),
      rect(leftX, -1, 3, 1, 'skin'),
      rect(rightX, -1, 3, 1, 'skin'),
    ].filter((item): item is PixelRect => item !== null);
  }
  return [
    rect(leftX - 1, y, 5, h, 'ink'),
    rect(leftX, y, 3, h - 1, 'timberDark'),
    rect(rightX - 1, y, 5, h, 'ink'),
    rect(rightX, y, 3, h - 1, 'timberDark'),
    rect(leftX, -1, 3, 1, 'ink'),
    rect(rightX, -1, 3, 1, 'ink'),
  ].filter((item): item is PixelRect => item !== null);
}

/** 围巾：脖前一横条 + 左侧飘尾；走路时尾端上下 1px。 */
function scarfRects(look: VillagerLook, walking: boolean, frame: number): PixelRect[] {
  const b = BUILD[look.build];
  const y = b.torsoTop - 1;
  const { left } = span(b.shoulder + 2);
  const lift = walking ? frame % 2 : 0;
  return [
    rect(left, y, b.shoulder + 2, 2, 'scarf'),
    rect(left, y, Math.max(3, b.shoulder - 2), 1, 'scarfLit'),
    rect(left - 1, y + 2 + lift, 3, 1, 'scarf'),
    rect(left - 2, y + 3 + lift, 3, 1, 'scarf'),
    rect(left - 1, y + 4 + lift, 2, 1, 'shade'),
  ].filter((item): item is PixelRect => item !== null);
}

/** 手持物/配饰：四种，各自打破不同的方向（侧、下、上、无）。 */
function accentRects(look: VillagerLook, facing: VillagerSnapshot['facing']): PixelRect[] {
  const b = BUILD[look.build];
  const side = facing === 'left' ? -1 : 1;
  const { left: sLeft, right: sRight } = span(b.shoulder);
  const out: PixelRect[] = [];
  if (look.accent === 'satchel') {
    const bagX = side < 0 ? sLeft - 6 : sRight + 1;
    push(out, [
      rect(bagX, b.torsoTop + 5, 6, 6, 'ink'),
      rect(bagX + 1, b.torsoTop + 6, 4, 4, 'terracotta'),
      rect(bagX + 1, b.torsoTop + 6, 4, 1, 'trim'),
      // 斜挎的带子：四颗 1px，读成一条肩带。
      rect(side < 0 ? sLeft + 2 : sRight - 3, b.torsoTop + 1, 1, 1, 'trim'),
      rect(side < 0 ? sLeft + 1 : sRight - 2, b.torsoTop + 2, 1, 1, 'trim'),
      rect(side < 0 ? sLeft : sRight - 1, b.torsoTop + 3, 1, 1, 'trim'),
      rect(side < 0 ? sLeft - 1 : sRight, b.torsoTop + 4, 1, 1, 'trim'),
    ]);
  } else if (look.accent === 'lantern') {
    const x = side < 0 ? sLeft - 3 : sRight + 1;
    push(out, [
      rect(x + 1, b.torsoTop + 2, 1, 10, 'timberDark'),
      rect(x, b.torsoTop + 12, 6, 6, 'ink'),
      rect(x + 1, b.torsoTop + 13, 4, 4, 'amber'),
      rect(x + 2, b.torsoTop + 14, 2, 2, 'warmLight'),
      rect(x, b.torsoTop + 12, 6, 1, 'trim'),
    ]);
  } else if (look.accent === 'staff') {
    const x = side < 0 ? sLeft - 3 : sRight + 1;
    push(out, [
      rect(x, -28, 2, 28, 'ink'),
      rect(x + 1, -27, 1, 26, 'timberDark'),
      rect(x - 1, -30, 4, 3, 'ink'),
      rect(x, -29, 2, 1, 'trim'),
    ]);
  } else if (look.accent === 'bucket') {
    // 提水桶：桶身、桶沿、提手，都在 24px 内。
    const x = side < 0 ? sLeft - 5 : sRight + 2;
    push(out, [
      rect(x, b.torsoTop + 9, 6, 5, 'ink'),
      rect(x + 1, b.torsoTop + 10, 4, 3, 'plaster'),
      rect(x + 1, b.torsoTop + 10, 4, 1, 'trim'),
      rect(x + 2, b.torsoTop + 7, 1, 2, 'ink'),
      rect(x + 4, b.torsoTop + 8, 1, 2, 'ink'),
    ]);
  }
  return out;
}

/** 走路摆臂与工作手持物：这些是动作，不是外观，最后画。 */
function actionRects(
  look: VillagerLook,
  pose: VillagerPose,
  facing: VillagerSnapshot['facing'],
  mode: VillagerMode,
  walking: boolean,
): PixelRect[] {
  const b = BUILD[look.build];
  const { left: sLeft, right: sRight } = span(b.shoulder);
  const swing = walking ? pose.frame % 2 : 0;
  const out: PixelRect[] = [
    rect(sLeft - 1, b.torsoTop + 2 + swing, 2, 7, 'shade'),
    rect(sRight + 1, b.torsoTop + 2 - swing, 2, 7, 'shade'),
    rect(sLeft - 1, b.torsoTop + 9 + swing, 2, 1, 'skin'),
    rect(sRight + 1, b.torsoTop + 9 - swing, 2, 1, 'skin'),
  ].filter((item): item is PixelRect => item !== null);

  if (look.head === 'beard') {
    // 六臂：默认两条之外，左右各再挂两对短臂，肩线以下逐级错开。
    push(out, [
      rect(sLeft - 4, b.torsoTop + 3 + swing, 3, 6, 'shade'),
      rect(sRight + 2, b.torsoTop + 3 - swing, 3, 6, 'shade'),
      rect(sLeft - 4, b.torsoTop + 8 + swing, 2, 1, 'skin'),
      rect(sRight + 2, b.torsoTop + 8 - swing, 2, 1, 'skin'),
      rect(sLeft - 3, b.torsoTop + 9 + swing, 3, 5, 'shade'),
      rect(sRight + 2, b.torsoTop + 9 - swing, 3, 5, 'shade'),
      rect(sLeft - 3, b.torsoTop + 13 + swing, 2, 1, 'skin'),
      rect(sRight + 2, b.torsoTop + 13 - swing, 2, 1, 'skin'),
    ]);
  }

  const side = facing === 'left' ? -1 : 1;
  const bob = mode === 'working' || mode === 'delivering' ? pose.frame % 2 : 0;
  const handX = side < 0 ? sLeft - 3 : sRight + 1;
  if (mode === 'working') {
    out.push(rect(handX, b.torsoTop + 8 - bob, 2, 7, 'ink') as PixelRect);
    out.push(rect(handX - (side < 0 ? 3 : 0), b.torsoTop + 6 - bob, 5, 2, 'plaza') as PixelRect);
    out.push(rect(handX - (side < 0 ? 3 : 0), b.torsoTop + 6 - bob, 5, 1, 'pale') as PixelRect);
  } else if (mode === 'delivering') {
    out.push(rect(-5, b.torsoTop + 5 - bob, 10, 7, 'ink') as PixelRect);
    out.push(rect(-4, b.torsoTop + 6 - bob, 8, 5, 'pale') as PixelRect);
    out.push(rect(-4, b.torsoTop + 7 - bob, 8, 1, 'soil') as PixelRect);
  } else if (mode === 'saluting') {
    out.push(rect(handX, b.torsoTop - 6, 2, 5, 'skin') as PixelRect);
    out.push(rect(handX, b.torsoTop - 7, 2, 1, 'ink') as PixelRect);
  }
  return out;
}

/**
 * 一整帧的矩形序列（先画的在下面）。
 *
 * `nowMs` 只用来决定眨眼那一帧——与旧实现同一条（每 4.3 秒闭 100ms），
 * 不引入新的浮点或随机。
 */
export function villagerLayout(
  look: VillagerLook,
  facing: VillagerSnapshot['facing'],
  pose: VillagerPose,
  walking: boolean,
  mode: VillagerMode,
  nowMs: number,
): readonly PixelRect[] {
  const blink = nowMs > 0 && !walking && Math.floor(nowMs / 100) % 43 === 0;
  const lift = pose.offsetY;
  const joints = [
    ...outfitRects(look),
    ...legRects(look, pose, walking),
    ...headRects(look, facing, blink),
    ...scarfRects(look, walking, pose.frame),
    ...accentRects(look, facing),
    ...actionRects(look, pose, facing, mode, walking),
  ];
  return joints.map((item) => ({ ...item, y: item.y + lift }));
}

// ---------------------------------------------------------------- 可判别性

/** 剪影统计：只看轮廓占不占像素，不看颜色。 */
export interface Silhouette {
  readonly bboxW: number;
  readonly bboxH: number;
  readonly pixels: number;
  /** 从上到下 6 段的行宽（像素），用来区分「结构」而不只是「高矮胖瘦」。 */
  readonly profile: readonly number[];
}

/** 一个外观的剪影（站着不动的那一帧，避免把动作当成身份）。 */
export function silhouetteOf(look: VillagerLook): Silhouette {
  const pose: VillagerPose = {
    frame: 0,
    frameCount: 2,
    offsetY: 0,
    footLeft: 0,
    footRight: 0,
  };
  const rects = villagerLayout(look, 'down', pose, false, 'idle', 0);
  const cells = new Map<string, true>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        cells.set(`${x},${y}`, true);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const height = maxY - minY + 1;
  const bandSize = Math.max(1, Math.ceil(height / 6));
  const profile: number[] = [];
  for (let band = 0; band < 6; band += 1) {
    const from = minY + band * bandSize;
    const to = Math.min(maxY + 1, from + bandSize);
    let width = 0;
    for (let y = from; y < to; y += 1) {
      let rowMin = Infinity;
      let rowMax = -Infinity;
      for (const key of cells.keys()) {
        const [x, yy] = key.split(',').map(Number) as [number, number];
        if (yy !== y) continue;
        if (x < rowMin) rowMin = x;
        if (x > rowMax) rowMax = x;
      }
      if (rowMin !== Infinity) width = Math.max(width, rowMax - rowMin + 1);
    }
    profile.push(width);
  }
  return { bboxW: maxX - minX + 1, bboxH: height, pixels: cells.size, profile };
}

/**
 * 剪影签名：每段行宽先按「这一段相对本剪影最宽处」归一，再压成三档。
 *
 * 为什么不直接压绝对值（`floor(width/5)`）：那样 7 个人里 5 个都落在同一档，
 * 签名退化成「谁比谁宽 1px」——正是验收里说的「只剩高矮胖瘦」。归一之后读的是
 * **纵向轮廓**：头/肩/腰/摆的相对关系、以及配饰在哪一段凸出来。
 *
 * 三档阈值 0.85 / 0.66 是经验值：小于 2/3 宽读作「收」，超过 0.85 读作「满」。
 */
export function silhouetteSignature(look: VillagerLook): string {
  const { profile, bboxH } = silhouetteOf(look);
  const widest = Math.max(...profile, 1);
  const contour = profile
    .map((width) => {
      const ratio = width / widest;
      if (ratio >= 0.85) return '2';
      if (ratio >= 0.66) return '1';
      return '0';
    })
    .join('');
  // 高度只作为**后缀**：轮廓相同、身高差 2px 以上（如矮壮型 28 vs 标准 30）
  // 也算不同类，但分类的主依据仍是上面的纵向轮廓，不是「谁更高」。
  return `${contour}@${bboxH}`;
}
