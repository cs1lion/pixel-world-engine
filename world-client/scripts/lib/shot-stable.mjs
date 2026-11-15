/**
 * 抓拍前提：画面**已经停住**，才允许拿它做逐字节比较。
 *
 * 为什么需要这一层：`check-ground-shadow` 在 30 轮实测里红了 4 次（13.3%），
 * 读数都是「首张同刻图抓拍早于整屏调色收敛」——两页都冻住了世界，但 `phaseView`
 * 的压暗层按**帧 delta** 累加（`FADE_MS = 900`），第一张截图常常落在渐变中途。
 * 于是「同一时刻 → 同一画面」这条判据并不是假的，只是**前提没成立**就被拿来比了。
 *
 * 判据是「连续 `requireIdenticalFrames` 帧逐字节相同」，默认 8。为什么不是 2 或 3：
 * 8-bit 量化下，渐变中相邻两帧完全可能落在同一个颜色档位（平台期），连续两帧
 * 相同只说明「这一档还没跳」；而 `t` 每帧只走 1/54，8 帧才把时间轴推得足够远。
 *
 * 两种取帧模式，**跨页比较必须用步进模式**：
 * - 实时模式（不给 `advance`）：按真实 rAF 连拍，直到出现连续 N 帧相同，超时就
 *   `stable: false`。用于单页闸门（画面是否停住是它自己的判据）。
 * - 步进模式（给 `advance`）：**步进恰好 N 帧**、逐帧比。帧数固定，所以两页走完
 *   同样的帧序列；前提「连续 N 帧相同」仍是断言，不成立就 `stable: false`。
 *
 * 为什么跨页不能靠实时模式：`check-ground-shadow` 的确定性判据是两页逐字节比。
 * 实时模式每次等到的帧数不定，两页的帧号就会漂开（实测一次 135 vs 179），而画面里
 * 有一处按**渲染帧**推进、不随世界钟推进的微动（见 OPEN_ISSUES E12），量化平台因此
 * 不同 → 13 张里 5 张不等。步进把两边钉在同一帧号上，比较才有意义。**注意这不是
 * 「冻结后连拍 20 张」**：那种做法是自己跟自己比（同一张图重拍 20 次），不是闸门。
 *
 * **fail-closed**：等不到稳定 / 步进的 N 帧不全相同，一律 `stable: false`，绝不静默
 * 跳过、绝不降级成「拍一张算了」。调用方必须打印 `[判据前提不成立] …` 并以非 0 退出；
 * 把不稳定当成稳定，就是把随机红训练成人人忽略的红。
 *
 * 取样面走 `measure-surface.mjs` 契约：先隐藏 `CHROME` 与逐帧会动的 `DYNAMIC`
 * （名字/气泡），保留 `SCENE_DOM`（区域名/露话）。**不用 `canvas.toDataURL()`**：
 * E9 实测它在当前 WebGL 上下文返回全黑（480×320、r=g=b=0、alpha 全 255），
 * 改读 backing buffer 需要 `preserveDrawingBuffer` 或 `gl.readPixels`，成本另记。
 * 这里只用 Playwright 的 `page.screenshot({ clip })`（页面合成结果）。
 *
 * 退化边界：若将来改成直接读 canvas backing buffer，`CHROME` / `DYNAMIC` 的隐藏
 * 都不再相关；若 CI 的字体/抗锯齿让整块画面永远逐字节不同，这里会先卡在前提上
 * （这正是 E9 说的顺序：先定截图面，再定判据）。步进模式依赖调用方提供可复现的
 * 帧源（本仓库是 `scripts/lib/frame-clock.mjs` 的 `stepFrames`）；没有帧源就退回
 * 实时模式，不要自己造一个「等一会儿」的假步进。
 */

import { createHash } from 'node:crypto';
import { applyMeasurementSurface } from './measure-surface.mjs';

const DEFAULT_REQUIRE_IDENTICAL_FRAMES = 8;
/**
 * 实时模式的超时是**前提**的上限，不是判据阈值。按帧进度判据最慢的已知观测是共享
 * runner 上 31 帧 / 8226ms（3 帧收敛，见 `capture.mjs` 文件头）；8 帧按同一量级
 * 放宽到 30s，仍然「等不到就报前提不成立」，不会退化成拍一张。步进模式不用它。
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   clip: {x:number,y:number,width:number,height:number},
 *   requireIdenticalFrames?: number,
 *   timeoutMs?: number,
 *   advance?: () => Promise<void>,
 * }} options
 * `advance`：推进恰好一帧（步进模式）。给了它就不看 `timeoutMs`。
 * @returns {Promise<{
 *   stable: boolean,
 *   framesWaited: number,
 *   hash: string|null,
 *   elapsedMs: number,
 *   reason: string|null,
 *   buffer: Buffer|null,
 * }>}
 * `buffer` 是满足判据的那一帧原始 PNG；调用方直接把它写盘/比较，避免再拍一张
 * 引入「第 9 帧」这种未经证明的假设。不稳定时 `buffer` 为 `null`。
 */
export async function shotStable(page, options = {}) {
  const clip = options.clip;
  if (clip === undefined || clip === null) {
    throw new Error('shotStable 需要 clip（画布包围盒）；缺了它截的是整页，测量面契约不再成立');
  }
  const requireIdenticalFrames = options.requireIdenticalFrames ?? DEFAULT_REQUIRE_IDENTICAL_FRAMES;
  if (!Number.isInteger(requireIdenticalFrames) || requireIdenticalFrames < 1) {
    throw new Error(`requireIdenticalFrames 必须是正整数，收到 ${String(requireIdenticalFrames)}`);
  }
  const advance = options.advance;
  if (advance !== undefined && typeof advance !== 'function') {
    throw new Error('advance 必须是「推进一帧」的函数；传了它就走步进模式');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (advance === undefined && !(timeoutMs > 0)) {
    throw new Error(`timeoutMs 必须为正，收到 ${String(timeoutMs)}`);
  }

  // 按契约隐藏 CHROME + DYNAMIC；SCENE_DOM 保留。每次抓拍前都重做一次是幂等的，
  // 也能盖住「名字/气泡节点在两次抓拍之间被重建」的情况。
  await applyMeasurementSurface(page, { dynamic: true });

  if (advance !== undefined) {
    return steppedShot(page, { clip, requireIdenticalFrames, advance });
  }
  return realtimeShot(page, { clip, requireIdenticalFrames, timeoutMs });
}

/** 步进模式：步进恰好 N 帧，要求每一帧都与前一帧逐字节相同。 */
async function steppedShot(page, { clip, requireIdenticalFrames, advance }) {
  const startedAt = Date.now();
  const frames = [];
  for (let index = 0; index < requireIdenticalFrames; index += 1) {
    await advance();
    frames.push(await page.screenshot({ clip }));
  }

  let longestRun = 1;
  let run = 1;
  for (let index = 1; index < frames.length; index += 1) {
    run = frames[index].equals(frames[index - 1]) ? run + 1 : 1;
    if (run > longestRun) longestRun = run;
  }

  const last = frames[frames.length - 1];
  if (longestRun >= requireIdenticalFrames) {
    return {
      stable: true,
      framesWaited: frames.length,
      hash: createHash('sha256').update(last).digest('hex'),
      elapsedMs: Date.now() - startedAt,
      reason: null,
      buffer: last,
    };
  }

  let reason;
  if (longestRun <= 1) {
    reason = `每次都在变：步进 ${frames.length} 帧，没有任何两帧相邻相同（要求连续 ${requireIdenticalFrames} 帧相同）`;
  } else {
    reason = `从未出现连续 ${requireIdenticalFrames} 帧相同`
      + `（步进 ${frames.length} 帧，最长连续 ${longestRun} 帧）`;
  }
  return {
    stable: false,
    framesWaited: frames.length,
    hash: createHash('sha256').update(last).digest('hex'),
    elapsedMs: Date.now() - startedAt,
    reason,
    buffer: null,
  };
}

/** 实时模式：按真实 rAF 连拍，直到出现连续 N 帧相同；超时即前提不成立。 */
async function realtimeShot(page, { clip, requireIdenticalFrames, timeoutMs }) {
  const startedAt = Date.now();
  let previous = null;
  let same = 0;
  let longestRun = 0;
  let framesWaited = 0;
  let lastShot = null;

  while (Date.now() - startedAt < timeoutMs) {
    const shot = await page.screenshot({ clip });
    framesWaited += 1;
    same = previous !== null && shot.equals(previous) ? same + 1 : 0;
    if (same + 1 > longestRun) longestRun = same + 1;
    previous = shot;
    lastShot = shot;
    if (same >= requireIdenticalFrames - 1) {
      return {
        stable: true,
        framesWaited,
        hash: createHash('sha256').update(shot).digest('hex'),
        elapsedMs: Date.now() - startedAt,
        reason: null,
        buffer: shot,
      };
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const hash = lastShot === null ? null : createHash('sha256').update(lastShot).digest('hex');
  let reason;
  if (framesWaited === 0) {
    reason = `超时（${timeoutMs}ms 内没取到任何帧）`;
  } else if (framesWaited === 1) {
    reason = `超时（${timeoutMs}ms 内只取到 1 帧，无法判定连续 ${requireIdenticalFrames} 帧相同）`;
  } else if (longestRun <= 1) {
    reason = `每次都在变：从未出现连续 ${requireIdenticalFrames} 帧相同`
      + `（${timeoutMs}ms 超时，共 ${framesWaited} 帧，任意两帧都不同）`;
  } else {
    reason = `从未出现连续 ${requireIdenticalFrames} 帧相同`
      + `（${timeoutMs}ms 超时，共 ${framesWaited} 帧，最长连续 ${longestRun} 帧）`;
  }
  return { stable: false, framesWaited, hash, elapsedMs, reason, buffer: null };
}
