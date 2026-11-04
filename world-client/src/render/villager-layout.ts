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
  /** 受光：暖色压低透明度，任何底色上都读成主动光。 */
  | 'lit'
  /** 内描边/接触影：比 shade 再暗一档，用来把「外轮廓 / 内转折 / 暗部」分开。 */
  | 'contact'
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
 * 体型档：肩宽/下摆/腿长一起变，差距要大到「剪影」能分开，而不只是胖一圈。
 *   petite 头 10×8 / 高 26 —— 最小的孩子，头顶到脚 26px；
 *   slim  肩 9 / 摆 11 —— 窄，摆几乎不张；
 *   young 头 10×9 / 肩 8 —— 比 slim 矮 2px、肩窄 1px，给少年；
 *   adult 肩 12 / 摆 15 —— 标准 A 字；
 *   stout 肩 15 / 摆 18 —— 宽，摆张得最开（含 1px 轮廓刚好 20，仍在 24 内）；
 *   stoutShort 比 stout 再矮 2px —— 矮壮老人；
 *   tall  头 9×11 / 肩 9 / 摆 12 —— 头更长、腿更长，给无面者那种窄高轮廓。
 */
const BUILD: Readonly<Record<VillagerLook['build'], BuildSpec>> = {
  petite: { headW: 10, headH: 8, headTop: -25, torsoTop: -16, shoulder: 8, hem: 11, legTop: -6 },
  slim: { headW: 10, headH: 10, headTop: -29, torsoTop: -18, shoulder: 9, hem: 11, legTop: -6 },
  young: { headW: 10, headH: 9, headTop: -27, torsoTop: -17, shoulder: 8, hem: 11, legTop: -6 },
  adult: { headW: 12, headH: 10, headTop: -29, torsoTop: -18, shoulder: 12, hem: 15, legTop: -6 },
  stout: { headW: 13, headH: 10, headTop: -27, torsoTop: -17, shoulder: 15, hem: 18, legTop: -5 },
  stoutShort: { headW: 13, headH: 7, headTop: -23, torsoTop: -16, shoulder: 15, hem: 18, legTop: -6 },
  tall: { headW: 9, headH: 10, headTop: -28, torsoTop: -19, shoulder: 9, hem: 12, legTop: -7 },
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
  // 侧视是真正的侧面：头前后径比正面窄；背视对设定集人物另加发量。
  const sideView = facing === 'right' || facing === 'left';
  const backView = facing === 'up';

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
    // 侧视/背视兜帽各收 1px：背面读成「更窄的黑影」（PDF p.58）。
    const pad = sideView || backView ? 1 : 0;
    const fx = hx + pad;
    const fw = hw - pad * 2;
    push(out, [
      rect(fx - 1, top - 1, fw + 2, hh + 2, 'ink'),
      rect(fx, top, fw, hh, 'shade'),
      rect(fx, top, 1, hh, 'base'),
    ]);
    if (facing === 'up') return out;
    const maskW = facing === 'down' ? fw - 2 : Math.max(5, fw - 3);
    const maskH = hh - 4;
    const mx = facing === 'down'
      ? fx + 1
      : facing === 'right' ? fx + fw - maskW - 1 : fx + 1;
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
    // 侧视头窄 2px；背视两鬓的白毛向外撑 1px，头顶因此比正面宽。
    const pad = sideView ? 1 : backView ? -1 : 0;
    const fx = hx + pad;
    const fw = hw - pad * 2;
    push(out, [rect(fx - 1, top - 1, fw + 2, hh + 2, 'ink')]);
    if (facing === 'up') {
      push(out, [
        rect(fx, top, fw, hh, 'skin'),
        rect(fx + 1, top, fw - 2, 2, 'skin'),
        rect(fx, top + 3, 2, hh - 4, 'hair'),
        rect(fx + fw - 2, top + 3, 2, hh - 4, 'hair'),
        rect(fx + 1, top + hh - 2, fw - 2, 4, 'hair'),
      ]);
      return out;
    }
    const side = facing === 'left' ? -1 : 1;
    const faceW = facing === 'down' ? fw - 2 : fw - 4;
    const faceX = facing === 'down' ? fx + 1 : side < 0 ? fx + 1 : fx + 3;
    push(out, [
      rect(fx, top, fw, hh, 'skin'),
      rect(faceX, top + 2, faceW, hh - 2, 'skin'),
      // 秃顶只留两侧白毛。
      rect(fx, top + 3, 2, hh - 4, 'hair'),
      rect(fx + fw - 2, top + 3, 2, hh - 4, 'hair'),
      // 八字须与长须；须尖压到胸口，形成倒三角。
      rect(faceX + 1, top + hh - 3, faceW - 2, 1, 'hair'),
      rect(fx + 1, top + hh - 2, fw - 2, 2, 'ink'),
      rect(fx + 2, top + hh - 1, fw - 4, 7, 'hair'),
    ]);
    const eyeY = top + 5;
    if (facing === 'down') {
      push(out, [
        rect(fx + 2, eyeY, 3, 2, 'ink'),
        rect(fx + fw - 5, eyeY, 3, 2, 'ink'),
        rect(fx + 3, eyeY + 1, 1, 1, 'pale'),
        rect(fx + fw - 4, eyeY + 1, 1, 1, 'pale'),
        rect(fx + 5, eyeY, fw - 10, 1, 'trim'),
      ]);
    } else {
      const lx = facing === 'right' ? fx + fw - 6 : fx + 2;
      push(out, [
        rect(lx, eyeY, 3, 2, 'ink'),
        rect(lx + 1, eyeY + 1, 1, 1, 'pale'),
      ]);
    }
    return out;
  }

  if (look.head === 'yubaba') {
    // 掌柜：极高的白发髻、大鼻、深眼窝、金耳饰；靠一圈外扩白发把轮廓撑大。
    // 侧视白发收 2px（侧面看到的是发髻纵深），背视收在 19px（背面的发瀑比正面窄）。
    // 正面白发撑到 23px：正/侧/背三向的头宽是三档，而不是同一个外轮廓。
    const pad = sideView ? 2 : backView ? 0 : -2;
    push(out, [
      rect(hx - 3 + pad, top - 3, hw + 6 - pad * 2, hh + 5, 'ink'),
      rect(hx - 2 + pad, top - 2, hw + 4 - pad * 2, hh + 3, 'hair'),
      rect(hx - 1 + pad, top - 2, hw + 2 - pad * 2, 1, 'pale'),
    ]);
    const cx = hx + Math.floor(hw / 2);
    push(out, [
      rect(cx - 3, top - 3, 7, 4, 'ink'),
      rect(cx - 2, top - 2, 5, 2, 'hair'),
      rect(cx - 1, top - 2, 1, 1, 'pale'),
      rect(cx - 2, top, 5, 1, 'ink'),
    ]);
    if (facing === 'up') return out;
    const fx = hx + pad;
    const fw = hw - pad * 2;
    const faceX = facing === 'down' ? fx + 1 : facing === 'right' ? fx + 2 : fx + 1;
    const faceW = facing === 'down' ? fw - 2 : fw - 4;
    push(out, [
      rect(faceX, top + 2, faceW, hh - 2, 'skin'),
      rect(faceX, top + 2, faceW, 1, 'hair'),
      // 发影：刘海压一道内描边，头发与额头分成两档，而不是一条平色接平色。
      rect(faceX, top + 3, faceW, 1, 'contact'),
      // 大鼻：2px 深色阴影，正面才压。
      rect(cx - 1, top + 5, 2, 2, 'skin'),
      rect(cx - 1, top + 7, 2, 1, 'ink'),
      rect(fx - 1, top + hh - 3, 1, 2, 'trim'),
      rect(fx + fw, top + hh - 3, 1, 2, 'trim'),
    ]);
    const eyeY = top + 5;
    out.push(...eyeRects(faceX + 2, faceW - 3, eyeY, facing, blink));
    if (facing === 'down') {
      out.push({ x: cx - 2, y: eyeY, w: 1, h: 1, paint: 'shade' });
      out.push({ x: cx + 2, y: eyeY, w: 1, h: 1, paint: 'shade' });
    }
    return out;
  }

  // 侧视头窄 2px（前后径比正面窄）；设定集人物背视再加 1px 发量。
  // 马尾的「发量」由后缕自己撑，头本身不再外扩——否则背视会整块变宽，和正面撞车。
  const cast = isCastLook(look);
  const pad = cast ? (sideView ? -1 : backView ? (look.head === 'ponytail' ? 0 : 1) : 0) : 0;
  const gx = hx - pad;
  const gw = hw + pad * 2;
  push(out, [rect(gx - 1, top - 1, gw + 2, hh + 2, 'ink')]);

  if (facing === 'up') {
    // 背面：整块头发，不留脸。
    push(out, [rect(gx, top, gw, hh, 'hair')]);
  } else {
    push(out, [
      rect(gx, top, gw, 3, 'hair'),
      rect(gx, top + 2, 1, hh - 2, 'hair'),
      rect(gx + gw - 1, top + 2, 1, hh - 2, 'hair'),
      rect(gx + 1, top + 2, gw - 2, hh - 3, 'skin'),
      // 刘海压住额头 1px，脸不至于读成一块方皮肤。
      rect(gx + 1, top + 2, gw - 2, 1, 'hair'),
      // 发丝高光只给 2px。
      rect(gx + 1, top, 2, 1, 'hair'),
      rect(gx + 1, top, 1, 1, 'pale'),
    ]);
    out.push(...eyeRects(gx + 2, gw - 4, top + hh - 5, facing, blink));
  }

  if (look.head === 'bob') {
    // 齐耳短发：两颊各多一块，收在头轮廓里。
    push(out, [
      rect(gx, top + hh - 4, 2, 4, 'hair'),
      rect(gx + gw - 2, top + hh - 4, 2, 4, 'hair'),
    ]);
  } else if (look.head === 'ponytail') {
    // 马尾在人物自己的右侧：正面看落在画面左缘，背面看落在右缘——
    // 正面与背面的列分布因此天然是镜像的，三向不会退化成同一个外轮廓。
    const side = facing === 'up' || facing === 'right' ? 1 : -1;
    const baseX = side < 0 ? gx - 1 : gx + gw - 1;
    push(out, [
      rect(baseX + (side < 0 ? -2 : 1), top + 3, 3, 4, 'ink'),
      rect(baseX + (side < 0 ? -1 : 1), top + 4, 2, 2, 'hair'),
      rect(baseX + (side < 0 ? -3 : 2), top + 7, 4, 6, 'ink'),
      rect(baseX + (side < 0 ? -2 : 2), top + 8, 3, 4, 'hair'),
      rect(baseX + (side < 0 ? -2 : 1), top + 13, 3, 5, 'ink'),
      rect(baseX + (side < 0 ? -1 : 1), top + 13, 2, 4, 'hair'),
    ]);
    if (facing === 'up') {
      // 背面：马尾垂到肩胛以下、偏在一侧，行宽因此与正面不同（设定集 p.42/44 的后发）。
      push(out, [
        rect(gx + gw + 2, top + hh, 3, 9, 'ink'),
        rect(gx + gw + 3, top + hh + 1, 2, 7, 'hair'),
      ]);
    }
  } else if (look.head === 'bun') {
    const cx = gx + Math.floor(gw / 2);
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

/**
 * 设定集人物的帧内小动作：全部是整数像素，只看 `pose.frame` 与 `walking`。
 * 走路帧让脚（姿态里的 footLeft/footRight）交替、身体 1px 上下浮，长摆随步伐甩摆；
 * 待机两帧做小幅摆动（下摆、围巾尾、肩背、手持物），幅度小但逐帧可测。
 */
interface CastMotion {
  /** 袍摆/裙摆左右摆：-1/0/+1。整条下摆平移，行宽不变。 */
  readonly hemX: number;
  /** 披风肩背处的呼吸起伏：0/+1。只平移上身那两档。 */
  readonly chestX: number;
  /** 手持物摆动：水桶、灯杖；各 2 帧一个周期。 */
  readonly propX: number;
}

function castMotion(
  look: VillagerLook,
  facing: VillagerSnapshot['facing'],
  pose: VillagerPose,
  walking: boolean,
): CastMotion {
  if (!isCastLook(look)) return { hemX: 0, chestX: 0, propX: 0 };
  const frame = pose.frame;
  // 走路：长摆（长袍/披风/裙摆）1/0/-1/0 甩摆，与脚的交替错开半拍；短工装贴身，
  // 正面/背面走动时下摆不横移（只有侧视才甩 1px：侧视只露一条腿，脚的动作太薄）。
  const hemPattern = look.head === 'mask' ? [-1, 0, 1, 0] : [1, 0, -1, 0];
  const sideView = facing === 'right' || facing === 'left';
  const walkHem = look.outfit === 'tunic' && !sideView ? 0 : hemPattern[frame % 4] ?? 0;
  const hemX = walking ? walkHem : 0;
  // 待机：斗篷的肩背比下摆先起（往持物反侧让 1px）；其余人的下摆第 2 帧轻摆 1px，
  // 灯笼头提着灯杖，下摆往持物反侧让，避免和下摆/灯杖同帧同向把某一行顶宽 2px。
  const chestX = !walking && look.outfit === 'cloak' && frame % 2 === 1 ? -1 : 0;
  const idleHem = !walking && look.outfit !== 'cloak' && frame % 2 === 1
    ? look.head === 'mask' ? -1 : 1
    : 0;
  const hem = hemX + idleHem;
  // 道具按 2 帧周期摆：水桶/灯杖每 2 帧往怀里收 1px（桶已在画布右缘，外摆会被裁）。
  // 只在待机摆动：走动帧里多人同时收桶会把最像的一对（迷路人/汐）推到 0.78 以上；
  // 摆向与围巾尾反相（否则左右两头同一帧各凸 1px，行宽一次变 2px）。
  const propX = walking
    ? 0
    : look.accent === 'bucket'
      ? facing === 'down' ? -(frame % 2) : frame % 2
      : look.accent === 'staff' ? -(frame % 2) : 0;
  return { hemX: hem, chestX, propX };
}

/** 外套/斗篷/围裙/长袍：肩宽、下摆、暗部与开衩。 */
function outfitRects(
  look: VillagerLook,
  facing: VillagerSnapshot['facing'],
  motion: CastMotion,
): PixelRect[] {
  const b = BUILD[look.build];
  const top = b.torsoTop;
  const out: PixelRect[] = [];
  const { left: sLeft, right: sRight } = span(b.shoulder);
  const { left: hLeft, right: hRight } = span(b.hem);
  // 侧视收 1px、背视按人物另行收放——三种朝向必须落在不同的行宽上，
  // 否则遮名判据只验证了同一套外轮廓。
  const sideView = facing === 'right' || facing === 'left';
  const backView = facing === 'up';
  const band = (y: number, h: number, left: number, right: number): void => {
    const width = right - left + 1;
    out.push(rect(left - 1, y, width + 2, h, 'ink') as PixelRect);
    out.push(rect(left, y, width, h, 'base') as PixelRect);
    // 左缘 1px 受光：光从左上来，布面上要有「基色 + 暗部 + 受光」三档，
    // 否则一整件衣服只有平涂和右缘一道暗边。
    out.push(rect(left, y, 1, h, 'lit') as PixelRect);
    // 右缘 1px 暗部：光从左上来，右边就该压一档。
    out.push(rect(right, y, 1, h, 'shade') as PixelRect);
  };

  if (look.outfit === 'cloak') {
    if (look.head === 'yubaba') {
      // 掌柜：披风在肩背处最宽，向下收成窄裙摆；褶子只在轮廓上收，不另造符号。
      // 设定集 PDF p.53 / 书页 104–105：深蓝长裙、宽肩、矮而宽。
      // 正面是「宽发冠 + 披风肩 → 收窄裙摆」的倒三角；背视把披风再撑 1px；
      // 侧面整身收 4px（披风的纵深）。三种朝向的行宽因此不重叠。
      const side = sideView ? 4 : 0;
      const spread = backView ? 1 : 0;
      band(top, 4, sLeft - 2 + side - spread + motion.chestX, sRight + 2 - side + spread + motion.chestX);
      band(top + 4, 5, sLeft - 3 + side - spread + motion.chestX, sRight + 3 - side + spread + motion.chestX);
      const lower = backView ? 5 : sideView ? 3 : 0;
      // 正面裙摆铺到接近脚踝宽度（矮而宽的深蓝长裙，PDF p.53）：
      // 侧视是薄薄一片、背视收成窄摆，三种朝向的下摆行宽因此差 4px 以上。
      // 裙摆随帧轻摆：整条下摆平移 hemX，行宽一格不变。
      band(
        top + 9,
        4,
        (sideView || backView ? hLeft + 2 + lower : hLeft) + motion.hemX,
        (sideView || backView ? hRight - 2 - lower : hRight) + motion.hemX,
      );
      band(
        top + 13,
        2,
        (sideView || backView ? hLeft + 4 + (backView ? 4 : lower) : hLeft + 2) + motion.hemX,
        (sideView || backView ? hRight - 4 - (backView ? 4 : lower) : hRight - 2) + motion.hemX,
      );
      if (backView) {
        // 背视：披风褶拖到脚踝一侧，补上正面看不到的宽度（PDF p.53）。
        out.push(rect(hLeft - 1, top + 11, 4, 6, 'ink') as PixelRect);
        out.push(rect(hLeft, top + 12, 2, 4, 'base') as PixelRect);
      }
      out.push(rect(sLeft, top + 4, b.shoulder, 1, 'shade') as PixelRect);
      return out;
    }
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
    // 正面也收 1px：窄肩短工装（设定集里是贴身的工作衣，不是罩袍），
    // 侧视收 4px、背视收 3px——三种朝向的躯干行宽因此是三档。
    const inset = sideView ? 4 : backView ? 3 : 1;
    band(top, 5, sLeft + inset, sRight - inset);
    // 短工装没有长下摆：腰下这一档就是衣摆，随帧平移 1px（行宽不变，
    // 待机的第 2 帧因此除了围巾尾还有一处可测的衣摆位移）。
    band(top + 5, 3, sLeft - 1 + inset + motion.hemX, sRight + 1 - inset + motion.hemX);
    out.push(rect(sLeft + 2 + (sideView ? 1 : 0), top + 1, b.shoulder - 4 - (sideView ? 2 : 0), 6, 'scarfLit') as PixelRect);
    out.push(rect(sLeft + inset, top + 5, b.shoulder - inset * 2, 1, 'scarf') as PixelRect);
    const shortsY = b.legTop - 3;
    const shortsInset = sideView ? 3 : backView ? 2 : 1;
    out.push(rect(sLeft + 1 + shortsInset, shortsY, b.shoulder - 2 - shortsInset * 2, 3, 'water') as PixelRect);
    out.push(rect(sLeft + 1 + shortsInset, shortsY, b.shoulder - 2 - shortsInset * 2, 1, 'shade') as PixelRect);
  } else {
    // 长袍：窄直身、到底再收一档，两侧开衩。
    if (look.head === 'bob' && look.outfit === 'robe') {
      // 汐：白/浅青长袍从腰下逐级外扩，下摆盖住赤脚；
      // 设定集 PDF p.43 / 书页 84–85 的垂坠下摆。
      // 侧面收 2px、背面收 3px 再把拖尾外扩：三向各是一条不同的斜边。
      // 背面收得比正面明显，头肩比也跟着变——正/背不会读成同一个外轮廓。
      const inset = sideView ? 2 : backView ? 3 : 0;
      band(top, 4, sLeft + inset, sRight - inset);
      band(top + 4, 4, sLeft - 1 + inset, sRight + 1 - inset);
      band(top + 8, 3, sLeft - 2 + inset, sRight + 2 - inset);
      band(top + 11, 5,
        (sideView ? sLeft - 3 + inset : backView ? sLeft - 5 : sLeft - 6) + motion.hemX,
        (sideView ? sRight + 3 - inset : backView ? sRight + 5 : sRight + 6) + motion.hemX);
      if (!sideView && !backView) {
        // 广袖：正面两袖各外撑 2px（书页 84–85 的长袍是宽袖）；
        // 背面看不到袖口，下摆也收 1px——正/背的行宽与列分布因此不重合。
        out.push(rect(sLeft - 3, top + 2, 3, 7, 'ink') as PixelRect);
        out.push(rect(sLeft - 2, top + 3, 2, 5, 'base') as PixelRect);
        out.push(rect(sRight + 1, top + 2, 3, 7, 'ink') as PixelRect);
        out.push(rect(sRight + 2, top + 3, 2, 5, 'base') as PixelRect);
      }
      if (sideView) {
        // 侧视：广袖从身前挂下来，衣摆拖在身后（左侧）——侧影因此前窄后长。
        out.push(rect(sRight + 1, top + 2, 3, 7, 'ink') as PixelRect);
        out.push(rect(sRight + 2, top + 3, 1, 5, 'base') as PixelRect);
        out.push(rect(sLeft - 5, top + 8, 4, 9, 'ink') as PixelRect);
        out.push(rect(sLeft - 4, top + 9, 2, 7, 'base') as PixelRect);
      }
      if (backView) {
        // 背视：长袍后摆拖向一侧，下摆行宽与正面/侧面都不同（书页 84–85）。
        out.push(rect(sRight + 4, top + 10, 4, 7, 'ink') as PixelRect);
        out.push(rect(sRight + 5, top + 11, 2, 5, 'base') as PixelRect);
      }
      const mid = Math.floor((sLeft + sRight) / 2);
      out.push(rect(mid, top + 3, 1, 12, 'shade') as PixelRect);
      return out;
    }
    if (look.head === 'mask') {
      // 灯笼头：高领/兜帽下极窄的及地黑袍，不画脚；
      // 设定集 PDF p.58 / 书页 114–115：高而窄、无脸。
      // 背面黑袍再收 2px；侧面高领收 1px——三种朝向不共用一条轮廓。
      // 肩线一圈是正面最宽处（21px）：正面因此是「窄头 → 宽肩 → 窄袍」，
      // 背视只留 17px、侧视 11px——头肩比在三种朝向下都不一样。
      const collar = sideView ? 3 : backView ? 2 : -2;
      const body = sideView ? 2 : backView ? 2 : 0;
      band(top, 5, sLeft - 3 + collar, sRight + 3 - collar);
      // 黑袍下摆随帧轻摆（整段平移，行宽不变）。
      band(top + 5, 14, sLeft + 1 + body + motion.hemX, sRight - 1 - body + motion.hemX);
      const mid = Math.floor((sLeft + sRight) / 2);
      out.push(rect(mid, top + 7, 1, 12, 'shade') as PixelRect);
      return out;
    }
    if (look.head === 'beard') {
      // 炉匠：上半身被六条手臂撑宽，下半身收成直筒围裙/袍摆；
      // 设定集 PDF p.48 / 书页 94–95：矮壮、六臂，袍摆不向外张。
      // 侧视整身再收 1px，背视只留本体宽度——六臂只在前/侧出现。
      const inset = sideView ? 3 : backView ? 2 : 0;
      band(top, 5, sLeft + 3 + inset, sRight - 3 - inset);
      band(top + 5, 5, sLeft + 3 + inset, sRight - 3 - inset);
      band(top + 10, 4, sLeft + 2 + inset + motion.hemX, sRight - 2 - inset + motion.hemX);
      band(top + 14, 3, sLeft + 2 + inset + motion.hemX, sRight - 2 - inset + motion.hemX);
      const mid = Math.floor((sLeft + sRight) / 2);
      out.push(rect(mid, top + 6, 1, 9, 'shade') as PixelRect);
      return out;
    }
    band(top, 12, sLeft, sRight);
    band(top + 12, 4, sLeft, sRight);
    const mid = Math.floor((sLeft + sRight) / 2);
    out.push(rect(mid, top + 3, 1, 12, 'shade') as PixelRect);
    out.push(rect(sLeft, top + 13, 1, 3, 'ink') as PixelRect);
    out.push(rect(sRight, top + 13, 1, 3, 'ink') as PixelRect);
  }

  // 下摆底边压一档：脚才不会浮在下摆上。短工作服没有长下摆，跳过。
  if (look.outfit !== 'tunic') {
    out.push(rect(hLeft - 1 + motion.hemX, top + 15, b.hem + 2, 1, 'shade') as PixelRect);
  }
  return out;
}

/** 五种主人物都算「设定集人物」：侧视叠成一条腿、背视收窄站距。 */
function isCastLook(look: VillagerLook): boolean {
  return (
    look.outfit === 'tunic' ||
    (look.build === 'young' && look.head === 'bob') ||
    look.head === 'beard' ||
    look.head === 'yubaba' ||
    look.head === 'mask'
  );
}

/** 腿/靴：下摆以下只露 3–4px，但脚的动作必须看得出来。 */
function legRects(
  look: VillagerLook,
  pose: VillagerPose,
  walking: boolean,
  facing: VillagerSnapshot['facing'],
): PixelRect[] {
  const b = BUILD[look.build];
  const y = b.legTop;
  const h = -y;
  if (look.head === 'mask') {
    // 黑袍及地：不画脚，让下摆一条直线收窄到底（PDF p.58 的高窄轮廓）。
    return [];
  }
  const cast = isCastLook(look);
  const sideView = facing === 'right' || facing === 'left';
  const backView = facing === 'up';
  if (cast && sideView) {
    // 侧视只露一条腿：两腿前后重叠，行宽从 10 收到 5。
    const x = -2 + (walking ? Math.max(pose.footLeft, pose.footRight) : 0);
    if (look.outfit === 'tunic') {
      return [
        rect(x - 1, y, 5, h, 'ink'),
        rect(x, y, 3, h, 'skin'),
        rect(x, -1, 3, 1, 'skin'),
      ].filter((item): item is PixelRect => item !== null);
    }
    return [
      rect(x - 1, y, 5, h, 'ink'),
      rect(x, y, 3, h - 1, 'timberDark'),
      rect(x, -1, 3, 1, 'ink'),
    ].filter((item): item is PixelRect => item !== null);
  }
  if (cast && backView) {
    // 背视站距收 1px：不靠脸也能和正面分开。
    const leftX = -3 + (walking ? pose.footLeft : 0);
    const rightX = 1 + (walking ? pose.footRight : 0);
    if (look.outfit === 'tunic') {
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
  // 设定集人物的短工装是窄站距：两脚各向内收 1px，正面剪影因此比标准 A 字窄一格。
  const leftX = (cast ? -3 : -4) + (walking ? pose.footLeft : 0);
  const rightX = (cast ? 0 : 1) + (walking ? pose.footRight : 0);
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

/** 围巾：脖前一横条 + 左侧飘尾；走路时尾端上下 1px。侧视只围到脖子前后径。 */
function scarfRects(
  look: VillagerLook,
  walking: boolean,
  frame: number,
  facing: VillagerSnapshot['facing'],
): PixelRect[] {
  const b = BUILD[look.build];
  const sideView = facing === 'right' || facing === 'left';
  const width = isCastLook(look) && sideView ? Math.max(4, b.shoulder - 1) : b.shoulder + 2;
  const y = b.torsoTop - 1;
  const { left } = span(width);
  // 设定集人物：飘尾水平摆 1px，待机两帧因此不是整体平移；走路四帧也不与脚步同相位。
  const cast = isCastLook(look);
  const lift = !cast && walking ? frame % 2 : 0;
  const sway = cast ? frame % 2 : 0;
  return [
    rect(left, y, width, 2, 'scarf'),
    rect(left, y, Math.max(3, width - 2), 1, 'scarfLit'),
    rect(left - 1 - sway, y + 2 + lift, 3, 1, 'scarf'),
    rect(left - 2 - sway, y + 3 + lift, 3, 1, 'scarf'),
    rect(left - 1 - sway, y + 4 + lift, 2, 1, 'shade'),
  ].filter((item): item is PixelRect => item !== null);
}

/** 手持物/配饰：四种，各自打破不同的方向（侧、下、上、无）。 */
function accentRects(
  look: VillagerLook,
  facing: VillagerSnapshot['facing'],
  motion: CastMotion,
): PixelRect[] {
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
    // 灯杆贴着袍边竖着（PDF p.58 的高窄剪影）；侧视时在朝向镜头的一侧。
    // 背视时杖在身前被袍子挡住，不画，背面因此更窄。
    if (look.head === 'mask' && facing === 'up') return out;
    // 灯杖 2 帧一个周期左右轻摆 1px。
    const x = (look.head === 'mask' ? sRight : side < 0 ? sLeft - 3 : sRight + 1) + motion.propX;
    push(out, [
      rect(x, -28, 2, 28, 'ink'),
      rect(x + 1, -27, 1, 26, 'timberDark'),
      rect(x - 1, -30, 4, 3, 'ink'),
      rect(x, -29, 2, 1, 'trim'),
    ]);
  } else if (look.accent === 'bucket') {
    // 提水桶：桶身、桶沿、提手，都在 24px 内。
    // 背视桶在身前被身体挡住；侧视把桶收到腰侧，中段行宽随之变化。
    if (facing === 'up') return out;
    // 水桶 2 帧一个周期轻晃 1px（只向内，桶沿不贴画布右缘）。
    const x =
      (facing === 'right' || facing === 'left' ? sRight : side < 0 ? sLeft - 5 : sRight + 2) +
      motion.propX;
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
  const cast = isCastLook(look);
  // 设定集人物摆臂不上下抖（那会让单行宽度一次变 2px）；走路的动作由脚、下摆、道具承担。
  const swing = walking && !cast ? pose.frame % 2 : 0;
  const sideView = facing === 'right' || facing === 'left';
  // 设定集人物侧视只露朝向镜头的一条手臂，另一条被身体挡住——行宽随之不同。
  const drawLeft = !(cast && sideView) || facing === 'left';
  const drawRight = !(cast && sideView) || facing === 'right';
  const out: PixelRect[] = [];
  if (drawLeft) {
    const arm = [
      rect(sLeft - 1, b.torsoTop + 2 + swing, 2, 7, 'shade'),
      rect(sLeft - 1, b.torsoTop + 9 + swing, 2, 1, 'skin'),
    ].filter((item): item is PixelRect => item !== null);
    out.push(...arm);
  }
  if (drawRight) {
    const arm = [
      rect(sRight + 1, b.torsoTop + 2 - swing, 2, 7, 'shade'),
      rect(sRight + 1, b.torsoTop + 9 - swing, 2, 1, 'skin'),
    ].filter((item): item is PixelRect => item !== null);
    out.push(...arm);
  }

  if (look.head === 'beard') {
    // 六臂：默认两条之外，左右各再挂两对短臂，肩线以下逐级错开。
    // 侧视只留朝向镜头的一侧（另一侧被身体挡住），背视两臂各收 1px；
    // 这样正/侧/背的“宽肩”行宽不同，六臂仍读得出来。
    const leftReach = 4;
    const lowerPair = facing !== 'up';
    const leftArms = facing === 'down' || facing === 'left';
    const rightArms = facing === 'down' || facing === 'right';
    if (leftArms) {
      push(out, [
        rect(sLeft - leftReach, b.torsoTop + 3 + swing, 3, 6, 'shade'),
        rect(sLeft - leftReach, b.torsoTop + 8 + swing, 2, 1, 'skin'),
        ...(lowerPair
          ? [
              rect(sLeft - 3, b.torsoTop + 9 + swing, 3, 5, 'shade'),
              rect(sLeft - 3, b.torsoTop + 13 + swing, 2, 1, 'skin'),
            ]
          : []),
      ]);
    }
    if (rightArms) {
      push(out, [
        rect(sRight + 2, b.torsoTop + 3 - swing, 3, 6, 'shade'),
        rect(sRight + 2, b.torsoTop + 8 - swing, 2, 1, 'skin'),
        ...(lowerPair
          ? [
              rect(sRight + 2, b.torsoTop + 9 - swing, 3, 5, 'shade'),
              rect(sRight + 2, b.torsoTop + 13 - swing, 2, 1, 'skin'),
            ]
          : []),
      ]);
    }
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
  const motion = castMotion(look, facing, pose, walking);
  const joints = [
    ...outfitRects(look, facing, motion),
    ...legRects(look, pose, walking, facing),
    ...headRects(look, facing, blink),
    ...scarfRects(look, walking, pose.frame, facing),
    ...accentRects(look, facing, motion),
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
