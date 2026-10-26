/** 渲染配色的稳定语义槽。每套设定集可换色值，不能换含义。
 *
 * token 名是**闭集**，来自 `WORLD`：设定集手册自己的 11 色只是另一组值，
 * 落点仍是这 24 个槽（SPEC_V2 §4.2）。所以这里是 `Record<WorldColor, number>`
 * 而不是 `Record<string, number>`——写错一个 token 名（`terracota`）要当场
 * 编译失败，而不是在运行时画出一个 `undefined` 色、安静地什么都不显示。
 */
import type { WorldColor } from './palette-data.ts';

export type { WorldColor };

export type WorldPalette = Readonly<Record<WorldColor, number>>;
