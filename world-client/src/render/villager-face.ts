/**
 * 表情覆盖层（第三步）：只画眉眼口的 1–2px cell，画在身体之上的**独立 Graphics**。
 *
 * 边界：
 * - 不新增色值，只用现有 `ink`；
 * - 不改身体排版：身体区域（外套 + 腿 + 头/围巾/配饰）逐矩形不变，
 *   这条由 `test/anim-express-layers.test.ts` 用 sha256 守住；
 * - 情绪 id 只从世界已有的事实推（`mode` / `bubble`），不读记忆、不写世界。
 */

import type { VillagerMode, VillagerSnapshot } from '../world/types.ts';
import type { VillagerLook } from '../world/villager-look.ts';
import { faceBox, type PixelRect } from './villager-layout.ts';

export type EmotionId = 'calm' | 'joy' | 'focus' | 'weary' | 'worry';

/**
 * 情绪映射：只认世界已经给出的事实。
 *
 * `bubble` 是「她这会儿在说话」，`mode` 是手上的活。没有新的情绪字段，
 * 也就没有新的存档面。
 */
export function emotionOf(
  mode: VillagerMode,
  bubble: string | null,
): EmotionId {
  if (bubble !== null) return 'joy';
  switch (mode) {
    case 'working':
      return 'focus';
    case 'delivering':
      return 'joy';
    case 'bearingDecree':
      return 'worry';
    case 'saluting':
      return 'calm';
    default:
      return 'calm';
  }
}

/** 说话时嘴每拍开合一次；不说话就闭合。 */
export function isTalking(bubble: string | null): boolean {
  return bubble !== null;
}

/**
 * 眉眼口 cell。每块 1–2px，位置全部夹在 `faceBox` 里；背面没有脸，返回空。
 */
export function expressionRects(
  look: VillagerLook,
  facing: VillagerSnapshot['facing'],
  emotion: EmotionId,
  beat: number,
  talking: boolean,
): readonly PixelRect[] {
  const box = faceBox(look, facing);
  if (box === null || box.w < 4 || box.h < 4) return [];
  const out: PixelRect[] = [];
  const push = (x: number, y: number, w: number, h: number): void => {
    const left = Math.max(box.x, Math.min(box.x + box.w - w, x));
    const top = Math.max(box.y, Math.min(box.y + box.h - h, y));
    out.push({ x: left, y: top, w, h, paint: 'ink' });
  };

  const down = facing === 'down';
  const eyeLeft = down ? box.x + 1 : facing === 'right' ? box.x + box.w - 3 : box.x + 1;
  const eyeRight = down ? box.x + box.w - 2 : eyeLeft;

  // 眼睛：1–2px。喜读成弯（2 宽），专注竖（2 高），疲惫半眯（2 宽 1 高）。
  const eyeW = emotion === 'joy' || emotion === 'weary' ? 2 : 1;
  const eyeH = emotion === 'focus' ? 2 : 1;
  push(eyeLeft, box.eyeY, eyeW, eyeH);
  if (down) push(eyeRight, box.eyeY, eyeW, eyeH);

  // 眉：2x1。专注/担忧是斜的，喜是抬高的，疲惫是压低的。
  const browDy = emotion === 'joy' ? -3 : emotion === 'weary' ? -1 : -2;
  push(eyeLeft, box.eyeY + browDy, 2, 1);
  if (down) {
    const rightDy = emotion === 'focus' ? -1 : emotion === 'worry' ? -3 : browDy;
    push(eyeRight - 1, box.eyeY + rightDy, 2, 1);
  }

  // 嘴：2x1；说话时每两拍开一次（2x2）。白胡子那张的嘴被胡子压着，不另画。
  if (look.head !== 'beard') {
    const mouthY = box.y + box.h - 2;
    const open = talking && beat % 2 === 0;
    const mouthX = down
      ? box.x + Math.floor(box.w / 2) - 1
      : facing === 'right'
        ? box.x + box.w - 3
        : box.x + 2;
    if (emotion === 'focus' || emotion === 'worry') {
      push(mouthX, mouthY, 1, open ? 2 : 1);
    } else {
      push(mouthX, mouthY, 2, open ? 2 : 1);
    }
    if (emotion === 'joy') {
      push(mouthX - 1, mouthY - 1, 1, 1);
      push(mouthX + 2, mouthY - 1, 1, 1);
    }
  }
  return out;
}
