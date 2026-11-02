/**
 * 脚本层的相机投影换算：把世界坐标换成「canvas 内 CSS 像素」。
 *
 * 生产那份住在 `src/render/camera-math.ts`（`viewOriginOf`）与
 * `src/render/labels.ts`（`projectWorldToOverlay`）。脚本是 `.mjs`，不能直接
 * import `.ts`，所以这里放一份**纯公式**的脚本层副本；两处消费者
 * （`smoke.mjs`、`check-creation.mjs`）都走这一个入口，不再各写一遍。
 *
 * 公式只有两行，但它错过的形态很具体：`scroll` 是**镜头中心**，不是视野左上角，
 * 两者差 `size/2 - size/(2*zoom)`；`zoom === 1` 时正好相等，所以只按默认倍率
 * 跑测试永远发现不了。生产那两处改了，这里必须跟着改。
 */

/** 一个世界格多少世界像素（与 `src/world/setup.ts` 的 `TILE_PX` 同值）。 */
export const TILE_PX = 16;

/** Phaser 相机在某一帧能读到的四个数（`Oracle.camera()` 的形状）。 */
export const viewOriginOf = (scroll, size, zoom) => scroll + size / 2 - size / (2 * zoom);

/**
 * 世界像素 → canvas 内 CSS 像素（相对 canvas 左上角）。
 *
 * @param camera   { scrollX, scrollY, width, height, zoom }；width/height 是逻辑像素
 * @param rect     canvas 的 CSS 尺寸（getBoundingClientRect 的 width/height）
 * @param gameSize canvas.width/height（逻辑像素，480×320）
 */
export function projectWorldToCanvas(worldX, worldY, camera, rect, gameSize) {
  const originX = viewOriginOf(camera.scrollX, camera.width, camera.zoom);
  const originY = viewOriginOf(camera.scrollY, camera.height, camera.zoom);
  return {
    x: (worldX - originX) * camera.zoom * (rect.width / gameSize.width),
    y: (worldY - originY) * camera.zoom * (rect.height / gameSize.height),
  };
}

/** 世界格中心 → canvas 内 CSS 像素。 */
export function cellToCanvasPoint(cell, camera, rect, gameSize) {
  return projectWorldToCanvas(
    (cell.x + 0.5) * TILE_PX,
    (cell.y + 0.5) * TILE_PX,
    camera,
    rect,
    gameSize,
  );
}
