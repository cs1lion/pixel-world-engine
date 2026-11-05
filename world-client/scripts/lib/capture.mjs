/**
 * 截图口径：等相位压暗层「渐变完成」再拍。
 *
 * 为什么不再用固定等待：`phaseView` 的压暗层按**帧 delta** 累加（FADE_MS =
 * 900），而 `page.screenshot` 会打断 rAF，实际帧率不稳定。等 2200ms 时
 * 渐变常常还没走完，四张 phase-* 的整屏色偏逐次漂移——同码两跑可见差
 * 0.2% 上下、精确差 40% 上下。改成「取样区连续 3 帧不变」再拍：读到的
 * 终态与时间无关。
 *
 * 采样区必须只有静止地面：萤火、雨、行人、会呼吸的灯都不算收敛。晴天
 * 四刻里选左下角的一块空地（见 `DEFAULT_PATCH`）。
 *
 * 上限 6 秒。**超时不收敛就报错，不要改成固定等待或世界时钟驱动**——
 * 那说明压暗层跟的是帧 delta 而不是时间，是代码问题（本轮范围外）。
 */

/** 画布内取样区（CSS 像素，相对 canvas 左上角）：左下角一块只有草地的空地。 */
export const DEFAULT_PATCH = Object.freeze({ dx: 6, dy: 604, width: 26, height: 26 });

/**
 * 等居民落定：位置与 `visible` 连续几拍不变。
 *
 * 压暗层收敛只解决「颜色漂」；画面里还有人时，两跑的抓拍会落在不同的走路
 * 中间态。00:00 这一拍两人都在路上：有回家语义的树上他们各自走到门口再
 * 进屋（约 25 秒），没有的老树上走回门口就站住——两种都收敛，所以这条能
 * 同时用在「新码两跑」和「旧码两跑」的自证里。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{timeoutMs?:number,stablePolls?:number,intervalMs?:number}} [options]
 */
export async function waitVillagersSettled(page, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45000;
  const stablePolls = options.stablePolls ?? 3;
  const intervalMs = options.intervalMs ?? 150;
  const startedAt = Date.now();
  let previous = null;
  let same = 0;
  let polls = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    const fingerprint = await page.evaluate(() =>
      window.Oracle.view().villagers.map((v) => `${v.pos.x},${v.pos.y},${v.visible ? 1 : 0}`).join('|'),
    );
    polls += 1;
    same = previous !== null && fingerprint === previous ? same + 1 : 0;
    previous = fingerprint;
    if (same >= stablePolls - 1) {
      return { settled: true, waitedMs: Date.now() - startedAt, polls };
    }
    await page.waitForTimeout(intervalMs);
  }
  return { settled: false, waitedMs: Date.now() - startedAt, polls };
}

/**
 * 等压暗层收敛。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{x:number,y:number}} canvasBox 画布的页面坐标（`boundingBox()`）
 * @param {{capMs?:number,stableFrames?:number,patch?:{dx:number,dy:number,width:number,height:number}}} [options]
 * @returns {Promise<{settled:boolean,waitedMs:number,frames:number,capMs:number}>}
 */
export async function waitFadeSettled(page, canvasBox, options = {}) {
  const capMs = options.capMs ?? 6000;
  const stableFrames = options.stableFrames ?? 3;
  const patch = options.patch ?? DEFAULT_PATCH;
  const clip = {
    x: Math.round(canvasBox.x + patch.dx),
    y: Math.round(canvasBox.y + patch.dy),
    width: patch.width,
    height: patch.height,
  };
  const startedAt = Date.now();
  let previous = null;
  let same = 0;
  let frames = 0;
  while (Date.now() - startedAt <= capMs) {
    const shot = await page.screenshot({ clip });
    frames += 1;
    same = previous !== null && shot.equals(previous) ? same + 1 : 0;
    previous = shot;
    // 连续 `stableFrames` 帧逐字节相同 = 这一块画面不再变，压暗层走完了。
    if (same >= stableFrames - 1) {
      return { settled: true, waitedMs: Date.now() - startedAt, frames, capMs };
    }
  }
  return { settled: false, waitedMs: Date.now() - startedAt, frames, capMs };
}
