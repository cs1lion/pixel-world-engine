/** `?hpatch=`：**调试演示口**，不是作者输入通道。
 *
 * 为什么存在：高度层（H1/H3、遮挡条）已经有渲染判定，但 `GridSpec.levels` 全仓
 * 零生产者，`LARGE_WORLD_SPEC` 是平地——没有高度世界，H1/H3 的观感与 O1 判据
 * 只能纸面推演。这里只补一个演示载体，见 `docs/OPEN_ISSUES.md` 的
 * 「高度层有渲染判定，但没有内容生产者」。
 *
 * 纪律（用户裁决，逐条钉在 `test/height-demo.test.ts`）：
 *   1. **只在 `?hd2d=on` 时解析**：关着时这个参数结构上不进解析器，格式错也不抛。
 *   2. 开着时格式错必须 **throw**，不许静默降级成平地。
 *   3. **不写存档、不参与 trace/replay、不进任何夹具**；任何 recorder 脚本都不得传它。
 *
 * 真正的作者输入通道属 ADR 阶段 3，本轮不做。
 */

import { MAX_TERRAIN_LEVEL } from './types.ts';

/** 调试演示口的 URL 参数名。 */
export const HPATCH_QUERY = 'hpatch';

/** 一块演示台地：格坐标 + 尺寸 + 级数（与 `GridSpec.levels` 同一形状）。 */
export interface DemoLevelPatch {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly level: number;
}

/**
 * 解析 `?hpatch=x,y,w,h,level[;x,y,w,h,level...]`。
 *
 * `hd2dOn` 为 false 时直接返回空数组——**不读参数、不校验格式**。这是「关掉就
 * 不生效」的开关纪律，也是 166 张基线与这个参数无关的结构理由。
 */
export function demoLevelPatchesOf(
  search: string | URLSearchParams,
  hd2dOn: boolean,
): DemoLevelPatch[] {
  if (!hd2dOn) return [];
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw = params.get(HPATCH_QUERY);
  if (raw === null) return [];
  return raw.split(';').map((part) => parsePatch(part.trim()));
}

function parsePatch(raw: string): DemoLevelPatch {
  const fields = raw === '' ? [] : raw.split(',').map((field) => Number(field.trim()));
  const shapeOk =
    fields.length === 5 &&
    fields.every((value) => Number.isInteger(value)) &&
    fields[0]! >= 0 &&
    fields[1]! >= 0 &&
    fields[2]! >= 1 &&
    fields[3]! >= 1 &&
    fields[4]! >= 0 &&
    fields[4]! <= MAX_TERRAIN_LEVEL;
  if (!shapeOk) {
    throw new Error(
      `?hpatch 每块必须是 "x,y,w,h,level" 五个整数（x,y≥0；w,h≥1；level 0..${MAX_TERRAIN_LEVEL}），收到 "${raw}"`,
    );
  }
  return {
    x: fields[0]!,
    y: fields[1]!,
    w: fields[2]!,
    h: fields[3]!,
    level: fields[4]!,
  };
}
