/**
 * 像素闸门的「测量面」契约（单一来源）。
 *
 * 为什么要有这份契约：`page.screenshot` / `locator.screenshot` 截的是**页面合成结果**
 * 裁到元素/区域，不是 canvas backing buffer —— DOM 叠层会进字节。实测（2026-11-08）：
 * 在取样区注入 40×40 纯红 DOM 后，画布区与 patch 的截图 hash 都变，而
 * `canvas.toDataURL()` 不变。所以「哪些 DOM 算测量面」必须只写一处，否则各脚本
 * 各自维护一份 `visibility:hidden` 清单，改名/新增后就会静默漂移。
 *
 * 三组：
 * - `CHROME`：UI chrome，**必须隐藏**（顶栏、状态、小地图、队列、oracle、维修、
 *   调试面板、编年史）。它们不是玩家看到的「世界画面」，留在字节里只会引入
 *   runner 字体/布局差异。
 * - `SCENE_DOM`：**保留**。场景内文字（区域名、露话）锚在世界坐标上，属于产品
 *   呈现的一部分；剔掉它等于把判据改成「只测底层画布、不测玩家看到的画面」。
 * - `DYNAMIC`：逐帧会动（角色名/气泡跟着村民走）。「连续 N 帧逐字节相同」这类
 *   判据不可能跨过它们，像素闸门取字节前要隐藏，或另立判据。
 *
 * 注意：`#world-overlay` **不是**压暗层，别把容器当叠层。它只是上面三类文字的
 * 透明容器（实测 `background: rgba(0,0,0,0)`、`background-image: none`、
 * `pointer-events: none`、`z-index: 6`，与 canvas 同框）；压暗/暗角画在 canvas 上。
 * 只隐藏 `#world-overlay` 会连带把区域名/露话一起藏掉，那才是「改判据对象」。
 *
 * 退化边界：这份契约只对「页面合成」截图有效；若将来改成直接读 backing buffer，
 * 这些选择器都不再相关（而 `toDataURL()` 在当前 WebGL 上下文里是全黑，见 E9）。
 */

/** UI chrome：必须隐藏。 */
export const CHROME = Object.freeze([
  '#topbar',
  '#status',
  '#minimap',
  '#queue',
  '#oracle',
  '#maintenance',
  '#debug-panel',
  '#chronicle',
]);

/** 场景内文字：保留（锚在世界坐标上的产品呈现）。 */
export const SCENE_DOM = Object.freeze([
  '.setting-region-label',
  '.overlay-reveal',
]);

/** 逐帧会动：逐字节稳定判据取字节前必须隐藏。 */
export const DYNAMIC = Object.freeze([
  '.overlay-name',
  '.overlay-bubble',
]);

/**
 * 隐藏 CHROME（以及可选的 DYNAMIC），返回实际命中的选择器与缺失的选择器。
 * 缺失不在这里抛：由 `assertSurfacePresent` 决定要不要红。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{dynamic?:boolean}} [options]
 */
export async function applyMeasurementSurface(page, options = {}) {
  const dynamic = options.dynamic ?? true;
  const selectors = [...CHROME, ...(dynamic ? DYNAMIC : [])];
  const { applied, missing } = await page.evaluate((list) => {
    const appliedSelectors = [];
    const missingSelectors = [];
    for (const selector of list) {
      const elements = document.querySelectorAll(selector);
      if (elements.length === 0) {
        missingSelectors.push(selector);
        continue;
      }
      for (const element of elements) {
        if (element instanceof HTMLElement) element.style.visibility = 'hidden';
      }
      appliedSelectors.push(selector);
    }
    return { applied: appliedSelectors, missing: missingSelectors };
  }, selectors);
  return { applied, missing, selectors };
}

/**
 * 真实页面上的守卫：隐藏清单里的每个选择器都必须存在，否则直接抛错。
 * 防的是「选择器改名后静默失效」——与扫描面那类静默跳过同族。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{dynamic?:boolean}} [options]
 */
export async function assertSurfacePresent(page, options = {}) {
  const result = await applyMeasurementSurface(page, options);
  if (result.missing.length > 0) {
    throw new Error(
      `测量面契约失效：${result.missing.join('、')} 在页面上不存在（改名了？）。`
      + '改选择器必须同时改 scripts/lib/measure-surface.mjs。',
    );
  }
  return result;
}
