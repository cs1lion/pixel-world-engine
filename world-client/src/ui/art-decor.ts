/** 2026-11-11 参考图集的 DOM 装饰挂载。
 *
 * 世界画布上的建筑 / 村民 / 布景位图由 `render/` 各层自己查 `hasArt`；
 * 这里只管 DOM 面板里那三处小图：村民徽记、楼的状态图、记忆行的表情。
 *
 * 两条硬边界，都是为了不破坏素材装载冒烟（`scripts/check-art-assets.mjs`）：
 *
 * 1. **`?art=0` 一张图都不发请求**：节点是运行时 `createElement` 出来的，
 *    且只在 `artEnabledOf` 为真时才创建。静态写进 `index.html` 的 `<img>`
 *    哪怕 `hidden` 也会发请求，会把「关掉素材」这条退路直接烧掉。
 * 2. **只挂清单里的素材**：`src` 由 `artAssetPath` 拼出来，id 来自
 *    `public/assets/manifest.json` 里已有的键，不引入清单外的请求。
 *
 * 装饰是纯附加：`appendDecor` 只往宿主末尾追加一个无文本的 `<img>`，
 * 不改宿主的 `textContent`，也不动已有子节点的顺序。
 */

import { artAssetPath, artEnabledOf, type ArtKind } from '../render/art-assets.ts';

export function decorEnabled(): boolean {
  // Node 单测里没有 location：按默认（开）处理，让假 DOM 也能验到挂载。
  const search = typeof location === 'undefined' ? '' : location.search;
  return artEnabledOf(search);
}

export function decorUrl(kind: ArtKind, id: string): string {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}${artAssetPath(kind, id)}`;
}

/** 往宿主末尾挂一张装饰图。素材关掉时返回 false 且什么都不建。 */
export function appendDecor(
  host: HTMLElement,
  kind: ArtKind,
  id: string | null,
  className: string,
): boolean {
  // 装饰是附加物：没有 document（Node 单测收尾后、或假 DOM 已撤）就别挂，
  // 不让一张可选的小图把回执 / 记忆行本身带崩。
  if (id === null || !decorEnabled() || typeof document === 'undefined') return false;
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  // 用标准属性而不是 setAttribute：本仓有两套假 DOM（fake-dom.ts 与
  // oracle-panel-reply.test.ts 自带的简化版），后者只认属性赋值。
  img.src = decorUrl(kind, id);
  host.append(img);
  return true;
}
