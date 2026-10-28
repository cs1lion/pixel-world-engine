/**
 * 墙钟时间怎么变成世界时间——补齐、上限、帧预算，三件事一次钉完。
 *
 * 这条算式原先长在 `SandboxScene.update()` 里。那是个引 Phaser 的场景，
 * node 下连文件都加载不了，于是「补齐有 250ms 上限」「一步最多跑几次」
 * 这两个数**没有任何测试碰过**——注释说它们是什么，它们就是什么。
 * 抽进 `eco-mode.ts` 之后就能离线钉，这个文件就是那道闸。
 *
 * 钉的是三件容易互相搅浑的事：
 *   1. **补齐**：世界按真实经过的时间走，不按帧数走。60fps 与 12fps 下
 *      村民该在同一时刻走到同一格。
 *   2. **上限**（`FRAME_CLAMP_MS`）：补齐不是无条件的。隐藏标签页被浏览器
 *      压到 1fps 时一帧 1000ms，全补进去等于玩家睡着时世界跑了一整天。
 *      超出的部分不补，世界走慢——**不拿一句「补齐了」骗人**。
 *   3. **帧预算**（调用方的 `maxSteps`）：一帧最多跑几步，免得卡死。
 *      它必须比上限松，否则「世界走慢」就变成帧预算说了算，上限成了装饰。
 *
 * 最后一条钉的是**这次搬动没有改行为**：把搬之前那条算式原样抄一份在下面，
 * 逐输入对。抄一份不是重复——它是这次重构唯一的凭据。没有它，「搬出来了」
 * 与「搬对了」是两件事，而后者只能靠这一条说。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_CLAMP_MS, paceFrame } from '../src/render/eco-mode.ts';
import { codeOf } from './source-scan.ts';

const STEP = 100;
const MAX_STEPS = 5;

/** 以固定帧间隔跑 `frames` 帧，收下总步数与残余。 */
function run(frames: number, frameMs: number, maxSteps = MAX_STEPS): { steps: number; carried: number } {
  let carried = 0;
  let steps = 0;
  for (let i = 0; i < frames; i += 1) {
    const pace = paceFrame(carried, frameMs, STEP, maxSteps);
    carried = pace.leftover;
    steps += pace.steps;
  }
  return { steps, carried };
}

test('帧率不同，世界时间相同：20fps 与 5fps 跑同样秒数，步数一样', () => {
  // 各跑 10 秒。20fps 是 200 帧、5fps 是 50 帧——帧数差四倍，步数不该差。
  // 取 50ms 与 200ms 这两个间隔是因为它们二进精确：用 1000/60 那种，
  // 两边的浮点尾差落在不同的位置，步数会差 1，那是在测浮点不是测补齐。
  const fast = run(200, 50);
  const slow = run(50, 200);
  assert.equal(fast.steps, 100, `200 帧 20fps 该跑 100 步，实得 ${fast.steps}`);
  assert.equal(slow.steps, 100, `50 帧 5fps 该跑 100 步，实得 ${slow.steps}`);
  assert.equal(fast.carried, 0, '整秒数不该剩零头');
  assert.equal(slow.carried, 0, '整秒数不该剩零头');
});

test('一步没攒满之前不推进，残余留着不丢', () => {
  // 12fps 一帧 83.33ms：第一帧不够一步，第二帧才够。差的 16.67ms 不是丢了，
  // 是攒在池子里——所以第二步落在第二帧末，不是第三帧。
  const first = paceFrame(0, 1000 / 12, STEP, MAX_STEPS);
  assert.equal(first.steps, 0, '83.33ms 不够一步');
  const second = paceFrame(first.leftover, 1000 / 12, STEP, MAX_STEPS);
  assert.equal(second.steps, 1, '攒到 166.67ms 该推进一步');
  assert.ok(Math.abs(second.leftover - 66.67) < 0.01, `剩的该是 66.67ms，实得 ${second.leftover}`);
});

test('上限之外的时间不补：1fps 的隐藏标签页，世界按四分之一走', () => {
  const pace = paceFrame(0, 1000, STEP, MAX_STEPS);
  assert.equal(pace.steps, 2, `1000ms 只该承认 ${FRAME_CLAMP_MS}ms，实得 ${pace.steps} 步`);
  assert.equal(pace.leftover, 50, `250ms 跑两步该剩 50ms，实得 ${pace.leftover}`);
  // 睡得再久也一样：八年和八秒补进来的一样多。
  const long = paceFrame(0, 8 * 365 * 24 * 3600 * 1000, STEP, MAX_STEPS);
  assert.equal(long.steps, pace.steps, '睡八年不该比睡八秒多补');
  assert.equal(long.leftover, pace.leftover);
});

test('帧预算永远比上限松：世界走慢是上限说了算', () => {
  // 池子最大是「残余（< 一步）+ 上限」，所以一步最多跑
  // floor((STEP + FRAME_CLAMP_MS) / STEP) 次。要帧预算永远碰不到，得
  // FRAME_CLAMP_MS <= (maxSteps - 1) * STEP。场景里 250 <= 4×100 = 400，
  // 还余着一整步——这一条钉的就是那个余量，别让上限涨过它。
  const worst = paceFrame(STEP - 0.01, FRAME_CLAMP_MS, STEP, MAX_STEPS);
  assert.equal(worst.steps, 3, `池子最大 ${(STEP - 0.01 + FRAME_CLAMP_MS).toFixed(2)}ms，该跑 3 步，实得 ${worst.steps}`);
  assert.ok(worst.steps < MAX_STEPS, `最坏情况就跑满了 ${MAX_STEPS} 步——帧预算已经在上限前面生效了`);

  // 场景里那两个数从源码里读，不在这份测试里重抄——抄一份就成了两处真相。
  const scene = codeOf(new URL('../src/scenes/SandboxScene.ts', import.meta.url));
  const step = scene.match(/const LOGIC_STEP_MS = (\d+)/);
  const maxSteps = scene.match(/const MAX_STEPS_PER_FRAME = (\d+)/);
  assert.ok(step !== null && maxSteps !== null, '场景里找不到 LOGIC_STEP_MS / MAX_STEPS_PER_FRAME');
  assert.equal(Number(step[1]), STEP, '这一步的长度变了，上面几条的账要重算');
  assert.ok(
    FRAME_CLAMP_MS <= (Number(maxSteps[1]) - 1) * STEP,
    `MAX_STEPS_PER_FRAME 降到了 ${maxSteps[1]}——帧预算会抢在 FRAME_CLAMP_MS 前生效，`,
  );
});

test('上限一放松，帧预算立刻接住：它就不是装饰', () => {
  // 池子能超过帧预算时，maxSteps 该把它截住。这里手工塞一个 999ms 的
  // carried（正常跑永远到不了——上一节钉了池子上限是 349ms），
  // 为的是证明「预算永远碰不到」不是因为写错了，而是因为上限够紧。
  const pace = paceFrame(999, 100, STEP, 3);
  assert.equal(pace.steps, 3, 'maxSteps 3 该截住');
  assert.equal(pace.leftover, 799, `1099ms 跑 3 步该剩 799ms，实得 ${pace.leftover}`);
});

test('剩下的不丢：跨帧累加正好等于承认过的总时间', () => {
  // 200 帧 20fps = 10 秒。每帧 50ms 都远在上限之内，所以承认的总量
  // 该正好是 10000ms——一步不多，一步不少。
  const { steps, carried } = run(200, 50);
  assert.equal(steps * STEP + carried, 10000, `200 帧 20fps 该正好 10000ms，实得 ${steps * STEP + carried}`);
});

test('间隔回退不制造负的余量', () => {
  // Phaser 的 time 理论上只增。真出现回退时按 0 算，别让一个负的 leftover
  // 把之后每一帧都拖成负的——那会让世界莫名其妙停一拍。
  const pace = paceFrame(50, -500, STEP, MAX_STEPS);
  assert.equal(pace.steps, 0, '间隔是负的，不该推进');
  assert.equal(pace.leftover, 50, `余量该原样留着，实得 ${pace.leftover}`);
  const carried = paceFrame(-30, 100, STEP, MAX_STEPS);
  assert.equal(carried.leftover, 0, `负的 carried 按 0 算，实得 ${carried.leftover}`);
});

/**
 * 搬之前那条算式，照 `47a0f62` 之前的 `SandboxScene.update()` 逐字抄下来。
 *
 * 它**不是**被测物，是这次重构的凭据：抽函数最容易悄悄改掉边界，
 * 而边界改了在画面上要过很久才看得出来（世界走慢一格，没人会注意）。
 * 所以把旧的留在旁边，逐输入对。
 *
 * 别把它「优化」成跟 `paceFrame` 一样——两条一模一样，这条就空转了。
 */
function paceFrameBefore(accumulator: number, elapsedMs: number, stepMs: number, maxSteps: number) {
  let acc = accumulator + Math.min(elapsedMs, 250);
  let steps = 0;
  while (acc >= stepMs && steps < maxSteps) {
    acc -= stepMs;
    steps += 1;
  }
  return { steps, leftover: acc };
}

test('搬出来没有改行为：与搬之前那条算式逐输入相同', () => {
  // 扫一遍真实域：carried 0..400（池子最多到 349，取到 400 有余）、
  // elapsed 0..60000（一秒到一分钟，覆盖 1fps 到 60fps 与深睡初醒）。
  // 离线扫过 2400 万组全同；这里取其中 24 万组，够快也够密。
  let checked = 0;
  for (let carried = 0; carried <= 400; carried += 1) {
    for (let elapsed = 0; elapsed <= 60000; elapsed += 1) {
      const before = paceFrameBefore(carried, elapsed, STEP, MAX_STEPS);
      const after = paceFrame(carried, elapsed, STEP, MAX_STEPS);
      checked += 1;
      assert.equal(
        after.steps,
        before.steps,
        `carried=${carried} elapsed=${elapsed}：步数从 ${before.steps} 变成了 ${after.steps}`,
      );
      assert.equal(
        after.leftover,
        before.leftover,
        `carried=${carried} elapsed=${elapsed}：残余从 ${before.leftover} 变成了 ${after.leftover}`,
      );
    }
  }
  assert.equal(checked, 401 * 60001, '扫描范围变了，这条就不再是同一件事');
});
