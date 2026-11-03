/** 角色外观的四个形状维度 + 颜色槽。纯数据，不引渲染层。
 *
 * 为什么单开一个文件：设定集（`settings/types.ts`）要按类型写这四个维度，
 * 渲染层（`render/villager-layout.ts`）要按同一份定义排版；两边都从这里取，
 * 才不会出现「设定集写了 `hood`、渲染层只认 `hat`」这种只会静默不画的分歧。
 *
 * 四个维度都**不增加源色**：它们只改像素排布（肩宽、下摆、头型、手持物），
 * 颜色仍旧从世界 24 色的 token 里取。24 色是**源色**闭集，不是屏幕色闭集。
 */

import type { WorldColor } from './palette-data.ts';

export const VILLAGER_BUILDS = ['slim', 'adult', 'stout'] as const;
export const VILLAGER_HEADS = ['bob', 'ponytail', 'bun', 'hood'] as const;
export const VILLAGER_OUTFITS = ['cloak', 'coat', 'apron', 'robe'] as const;
export const VILLAGER_ACCENTS = ['satchel', 'lantern', 'staff', 'none'] as const;

export type VillagerBuild = (typeof VILLAGER_BUILDS)[number];
export type VillagerHead = (typeof VILLAGER_HEADS)[number];
export type VillagerOutfit = (typeof VILLAGER_OUTFITS)[number];
export type VillagerAccent = (typeof VILLAGER_ACCENTS)[number];

/** 设定集能写的外观字段。四个维度都可省略，省略走 `DEFAULT_LOOK`。 */
export interface VillagerLookInput {
  readonly build?: VillagerBuild;
  readonly head?: VillagerHead;
  readonly outfit?: VillagerOutfit;
  readonly accent?: VillagerAccent;
  readonly cloak?: WorldColor;
  readonly cloakDark?: WorldColor;
  readonly scarf?: WorldColor;
  readonly scarfLit?: WorldColor;
  readonly hair?: WorldColor;
}

/** 解析后的外观：四个维度与五个 token 槽都是确定的。 */
export interface VillagerLook {
  readonly build: VillagerBuild;
  readonly head: VillagerHead;
  readonly outfit: VillagerOutfit;
  readonly accent: VillagerAccent;
  readonly cloak: WorldColor;
  readonly cloakDark: WorldColor;
  readonly scarf: WorldColor;
  readonly scarfLit: WorldColor;
  readonly hair: WorldColor;
}

/**
 * 没有写外观时的默认值。
 *
 * `adult / bob / cloak / satchel` 是旧版「一个模板换两色」里最中性的那一具，
 * 也是莞尔镇那位（`v0`）的旧样子：蓝斗篷、橙围巾。
 */
export const DEFAULT_LOOK: VillagerLook = {
  build: 'adult',
  head: 'bob',
  outfit: 'cloak',
  accent: 'satchel',
  cloak: 'cloak',
  cloakDark: 'cloakDark',
  scarf: 'ember',
  scarfLit: 'trim',
  hair: 'timberDark',
};

/** 莞尔镇的两个旧角色。按 `v0` / `v1` 的编号取，不按名字——重名不串外观。 */
export const LEGACY_LOOKS: readonly VillagerLook[] = [
  DEFAULT_LOOK,
  {
    build: 'slim',
    head: 'ponytail',
    outfit: 'coat',
    accent: 'none',
    cloak: 'timber',
    cloakDark: 'timberDark',
    scarf: 'trim',
    scarfLit: 'pale',
    hair: 'timberDark',
  },
];

/** 把设定集里的部分字段补成一份完整外观。 */
export function resolveLook(
  input: VillagerLookInput | undefined,
  fallback: VillagerLook = DEFAULT_LOOK,
): VillagerLook {
  if (input === undefined) return fallback;
  return {
    build: input.build ?? fallback.build,
    head: input.head ?? fallback.head,
    outfit: input.outfit ?? fallback.outfit,
    accent: input.accent ?? fallback.accent,
    cloak: input.cloak ?? fallback.cloak,
    cloakDark: input.cloakDark ?? fallback.cloakDark,
    scarf: input.scarf ?? fallback.scarf,
    scarfLit: input.scarfLit ?? fallback.scarfLit,
    hair: input.hair ?? fallback.hair,
  };
}

/**
 * 没有设定集外观时，按村民 id 的序号挑那两套旧外观。
 *
 * 为什么按 id 不按名字：`v0` / `v1` 是 `Simulation` 自己给的稳定编号；名字
 * 重了会串外观（旧版 `villager.name === '莞尔'` 正是这个毛病）。序号越界
 * 就取模，不抛——世界多一个人不该白屏。
 */
export function legacyLookFor(villagerId: string): VillagerLook {
  const matched = /^v(\d+)$/.exec(villagerId);
  const index = matched === null ? 0 : Number(matched[1]);
  return LEGACY_LOOKS[index % LEGACY_LOOKS.length] as VillagerLook;
}
