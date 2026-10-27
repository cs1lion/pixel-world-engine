import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKGROUND_FPS,
  FOREGROUND_FPS,
  targetFpsFor,
  shouldAnimateAt,
  shouldAdvanceFrame,
} from '../src/render/eco-mode.ts';

// ------------------------------------------------------------------ 帧率档位

test('聚焦时跑满帧，失焦时明显降频', () => {
  assert.equal(targetFpsFor(true), FOREGROUND_FPS);
  assert.equal(targetFpsFor(false), BACKGROUND_FPS);
  assert.ok(FOREGROUND_FPS >= 60, '前台应跑满');
  assert.ok(BACKGROUND_FPS <= 15, `后台应降到 15 以下，实际 ${BACKGROUND_FPS}`);
});

test('后台帧率不是 0：完全停掉会让人以为挂了', () => {
  assert.ok(BACKGROUND_FPS > 0);
});

test('降频幅度足够大：后台不超过前台的 1/4', () => {
  assert.ok(
    BACKGROUND_FPS <= FOREGROUND_FPS / 4,
    `后台 ${BACKGROUND_FPS} 相对前台 ${FOREGROUND_FPS} 降得不够`,
  );
});

// ------------------------------------------------------------------ 视野外跳过

test('视野内的对象每帧都动', () => {
  const view = { x: 0, y: 0, width: 480, height: 320 };
  assert.equal(shouldAnimateAt({ x: 100, y: 100 }, view), true);
});

test('视野外远处的对象跳过动画', () => {
  const view = { x: 0, y: 0, width: 480, height: 320 };
  assert.equal(shouldAnimateAt({ x: 1200, y: 900 }, view), false);
});

test('视野边缘留一点余量：刚出界的不该立刻停', () => {
  const view = { x: 0, y: 0, width: 480, height: 320 };
  // 稍微超出边界一点，仍应动画（避免边缘一像素就闪断）。
  assert.equal(shouldAnimateAt({ x: 490, y: 100 }, view), true);
  assert.equal(shouldAnimateAt({ x: 520, y: 100 }, view), false);
});

test('视野移动后判定跟着变', () => {
  const point = { x: 600, y: 100 };
  assert.equal(shouldAnimateAt(point, { x: 0, y: 0, width: 480, height: 320 }), false);
  assert.equal(shouldAnimateAt(point, { x: 400, y: 0, width: 480, height: 320 }), true);
});

// ------------------------------------------------------- 后台降频：世界推进的闸门

test('前台不跳帧：每一帧都推进', () => {
  // 前台是满帧跑的，闸门不该拦任何一帧——拦了就是掉帧。
  assert.equal(shouldAdvanceFrame(1000, 1001, false, 1000 / BACKGROUND_FPS), true);
  assert.equal(shouldAdvanceFrame(0, 5, false, 1000 / BACKGROUND_FPS), true);
});

test('后台按最小帧间隔推进：不到点跳过，到了就推进', () => {
  const min = 1000 / BACKGROUND_FPS; // 83.33ms
  // 刚推进完，只过了 16.7ms（60fps 的一帧）：这一帧该被跳过。
  assert.equal(shouldAdvanceFrame(1000, 1016.7, true, min), false);
  // 过了整整一个间隔：该推进了。+0.1 是躲开二进制浮点——83.333… 相减出来
  // 是 83.333…26，正好卡在边界上会无故判成「没到」。
  assert.equal(shouldAdvanceFrame(1000, 1000 + min + 0.1, true, min), true);
  // 整数边界上算到点：是 >=，不是 >。
  assert.equal(shouldAdvanceFrame(500, 600, true, 100), true);
  assert.equal(shouldAdvanceFrame(500, 599.9, true, 100), false);
});

test('后台第一帧必须放过：不然基准永远立不起来，世界就此一动不动', () => {
  // 这是修好的一处，不是假设。失焦的无头面板里实测：Phaser 以 59.6fps 调
  // `update()`（updateCount 14617），而 advanceCount 是 0——世界一步没走。
  //
  // 成因是调用方原来的写法：`lastAdvanceAt === 0` 时拿**本帧 delta** 当
  // 「已经过去的时间」判断，而 60fps 下 delta 只有 16.7ms，后台档要 83.3ms，
  // 于是每一帧都判不过；调用方又只在判过时才记时间戳，`lastAdvanceAt`
  // 就永远是 0，每一帧都从头判一遍。窗口失焦但仍在合成（双屏、刚加载完
  // 还没点回来）都会走进来。
  //
  // 所以这里钉死：一次都没推进过时，这一帧**必须**放过，让调用方把基准立下来。
  // `SandboxScene` 那句注释承诺的是「逻辑时钟按真实经过的时间推进，只是推得
  // 粗一些」——一步不走不是粗一些，是不走。
  assert.equal(shouldAdvanceFrame(0, 1234, true, 1000 / BACKGROUND_FPS), true);
});

test('后台放过第一帧之后，时钟按真实经过的时间走', () => {
  // 照场景那个循环搭个模型：只在闸门放过时记时间戳、累加世界时间。
  // 场景那边累加前还有一道 `Math.min(elapsed, 250)` 的上限——这里六帧总共
  // 才 100ms，一次都没碰到，所以两边在这组数上行为一致。别把这个测试当成
  // 「场景永不失时间」的证据，它只覆盖不到上限的那一段。
  const min = 1000 / BACKGROUND_FPS;
  const frame = 1000 / FOREGROUND_FPS;
  let lastAdvanceAt = 0;
  let advances = 0;
  let worldNow = 0;
  for (let i = 1; i <= 6; i += 1) {
    const now = i * frame;
    if (!shouldAdvanceFrame(lastAdvanceAt, now, true, min)) continue;
    worldNow += lastAdvanceAt === 0 ? frame : now - lastAdvanceAt;
    lastAdvanceAt = now;
    advances += 1;
  }
  assert.ok(advances > 0, '6 帧里一次都没推进：世界冻住了');
  // 浮点：六段 16.666… 累加起来与 6 × frame 的最后一位可能对不上，所以比
  // 「几乎相等」而不是「相等」——上面那条边界测试已经踩过同一个坑。
  assert.ok(
    Math.abs(worldNow - 6 * frame) < 1e-9,
    `推进量应等于真实过去的时间，实际 ${worldNow} vs ${6 * frame}`,
  );
});
