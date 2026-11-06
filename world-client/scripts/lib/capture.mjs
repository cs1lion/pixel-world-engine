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
 * 上限 **60 帧（探针取样次数）**，不是墙钟秒数。**超帧上限不收敛就报错，
 * 不要改成固定等待或世界时钟驱动**——那说明压暗层跟的是帧 delta 而不是时间，
 * 是代码问题（本轮范围外）。
 *
 * 为什么按帧判而不是按毫秒：压暗层在 `phase-view` 里按**帧 delta**累加
 * （`FADE_MS = 900`），推进的是世界/渲染帧的进度，不是墙钟。同一份代码，
 * 共享 runner 上帧间隔被拉长（30fps 软件渲染 + 截图开销），墙钟要 6–8 秒
 * 才凑够同样的帧进度；本地只要 319–840ms。按毫秒判，阈值等于在赌「最慢的
 * 那台机器」；按帧进度判，判据只问「压暗层推进完了没有」。
 *
 * 为什么是 60 帧：现有全部读数里最差的是共享 runner 的 **31 帧 / 8226ms**
 * （另有 24 帧 / 6248ms、25 帧 / 6217ms），本地 3–14 帧。60 ≈ 最差观测值的
 * 1.9 倍，留给「比已知最慢 runner 再慢一倍」的情况。留余量的理由不是
 * 「怕红」：探针每取一帧都要一次截图，取帧本身也花机器时间；真实不收敛的
 * 样本会一直动，跑到 60 帧仍然 `settled:false`，闸门照样判红（反向用例见
 * `scripts/check-phases-negative.mjs`，实测恰在帧上限处判红）。
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
 * @param {{maxFrames?:number,stableFrames?:number,patch?:{dx:number,dy:number,width:number,height:number}}} [options]
 * @returns {Promise<{settled:boolean,waitedMs:number,frames:number,maxFrames:number}>}
 */
export async function waitFadeSettled(page, canvasBox, options = {}) {
  const maxFrames = options.maxFrames ?? 60;
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
  // 判据是**帧进度**：取到第 `maxFrames` 帧还没收敛就判不收敛。
  // `waitedMs` 只是读数（打印/落盘用），不参与判定。
  while (frames < maxFrames) {
    const shot = await page.screenshot({ clip });
    frames += 1;
    same = previous !== null && shot.equals(previous) ? same + 1 : 0;
    previous = shot;
    // 连续 `stableFrames` 帧逐字节相同 = 这一块画面不再变，压暗层走完了。
    if (same >= stableFrames - 1) {
      return { settled: true, waitedMs: Date.now() - startedAt, frames, maxFrames };
    }
  }
  return { settled: false, waitedMs: Date.now() - startedAt, frames, maxFrames };
}
