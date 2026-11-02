/** 单一造物意图的入口：一栋楼、一个位置、一套配色。
 *
 * **这个文件不再自己解析。** 形状校验的唯一实现是 `creator/schema.ts` 的
 * `parsePlaceBuildingIntent`：两边都写一遍「读点 / 读槽位 / 查 24 色闭集」，
 * 迟早会分岔，而分岔的表现是「一个入口放行、另一个入口拒绝同一份数据」。
 * 这里只做两件这一层才该做的事：
 *
 * 1. 保持这个历史入口与它的错误类型（`CreatorSchemaError`）不变；
 * 2. 把校验器返回的 **token 名**按**当前世界**的色板解析成色值。
 *
 * 第 2 条曾经是错的：这里 import 全局 `WORLD` 当唯一色表，而灯潮界的
 * `timber` / `stone` / `amber` 与莞尔镇同名不同色。解析出来的色在灯潮界
 * 全是隔壁世界的颜色——只是解析结果长期被调用方丢掉，所以没在画面上露过面。
 * 接线之后创建计划会真的带着色板走，所以色板必须由调用方传进来，
 * 且**没有默认值**：忘了传就该编译不过，不该悄悄退回 `WORLD`。
 */

import {
  CreatorSchemaError as GenesisSchemaError,
  parsePlaceBuildingIntent,
} from './creator/schema.ts';
import type { GridPoint, PrefabBlueprint } from './types.ts';
import type { WorldColor, WorldPalette } from './theme.ts';

export class CreatorSchemaError extends Error {}

/** 造物意图：用哪个模板、放哪、什么配色（已解析成色值）。 */
export interface CreationPlan {
  readonly templateId: string;
  readonly at: GridPoint;
  /** 已经按**当前世界**色板解析成色值的调色板。 */
  readonly palette: PrefabBlueprint['palette'];
}

/**
 * 校验一份造物意图。
 *
 * `templates` 是允许的模板表：模型不能发明新模板。
 * `palette` 是当前世界的 24 色：同名 token 在不同设定集里是不同颜色。
 */
export function parseCreationPlan(
  raw: unknown,
  templates: ReadonlyMap<string, PrefabBlueprint>,
  worldSize: { readonly width: number; readonly height: number },
  palette: WorldPalette,
): CreationPlan {
  if (!isRecord(raw)) throw new CreatorSchemaError('造物意图必须是对象');

  let command;
  try {
    command = parsePlaceBuildingIntent(raw, templates, worldSize, palette);
  } catch (error) {
    // 形状错误统一成这个历史入口自己的错误类型；别把带 code 的指令错误
    // 泄漏给只认 `CreatorSchemaError` 的旧调用方。
    if (error instanceof GenesisSchemaError) throw new CreatorSchemaError(error.message);
    throw error;
  }

  const template = templates.get(command.templateId);
  // `parsePlaceBuildingIntent` 已经确认模板存在，这里的兜底只为类型收窄。
  if (template === undefined) throw new CreatorSchemaError(`未知模板 "${command.templateId}"`);

  // 省略的槽位回落到模板自带配色；给了的按当前世界色板换值。
  const resolved = { ...template.palette };
  for (const [slot, token] of Object.entries(command.palette ?? {})) {
    resolved[slot as keyof PrefabBlueprint['palette']] = palette[token as WorldColor];
  }

  return { templateId: command.templateId, at: command.at, palette: resolved };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
