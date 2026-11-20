/** `src/render/fx-ambient/` 的纯函数单测：视觉时钟、微动效、阻尼跟随。
 *
 * 这一层是**表现层豁免区**（可以有自己的视觉时钟与视觉 PRNG），但豁免只
 * 豁免「确定性」，不豁免「说得清」：同一组输入必须同一组输出，帧率必须
 * 不影响结果。这里钉的就是这两件事；观感由人眼与 `?art=1` 冒烟负责。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cyclePhase, swing, visualNoise } from '../src/render/fx-ambient/visual-clock.ts';
import {
  budgetFor,
  driftDotsFor,
  grassBladesFor,
  grassSwayPx,
  rainRipplesFor,
} from '../src/render/fx-ambient/micro-fx.ts';
import {
  DAMPING_K,
  SETTLE_PX,
  beginGlide,
  glideStep,
  createCameraGlide,
} from '../src/render/fx-ambient/avatar-glide.ts';

// ---------------------------------------------------------------- 视觉时钟

test('visualNoise：整数进 0..1 出，同坐标永远同结果', () => {
  for (let x = -3; x < 20; x += 1) {
    for (let y = 0; y < 6; y += 1) {
      const v = visualNoise(x, y);
      assert.equal(v, visualNoise(x, y), `(${x},${y}) 两次结果不同就不是哈希`);
      assert.ok(v >= 0 && v < 1, `(${x},${y}) 越界：${v}`);
    }
  }
  // 不同坐标要有区分度（全相同的话整片草会一起摆）。
  const values = new Set(Array.from({ length: 200 }, (_, i) => Math.floor(visualNoise(i, 7) * 100)));
  assert.ok(values.size > 40, `哈希退化：只有 ${values.size} 个分桶`);
});

test('cyclePhase：周期整除回绕，脏数据不炸', () => {
  assert.equal(cyclePhase(0, 1000), 0);
  assert.equal(cyclePhase(1500, 1000), 0.5);
  assert.equal(cyclePhase(2000, 1000), 0, '整周期要回到 0');
  assert.equal(cyclePhase(-500, 1000), 0.5, '负时刻也要给正相位');
  assert.equal(cyclePhase(Number.NaN, 1000), 0, 'NaN 当 0');
  assert.equal(Number.isFinite(cyclePhase(100, 0)), true, '周期 0 不许炸');
});

test('swing：相位 0/0.25/0.5/0.75 对应 0/1/0/-1', () => {
  assert.equal(Math.round(swing(0)), 0);
  assert.equal(swing(0.25), 1);
  assert.equal(Math.round(swing(0.5)), 0);
  assert.equal(swing(0.75), -1);
});

// ---------------------------------------------------------------- 微动效

const blades = grassBladesFor(
  Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20), grass: true })),
);

test('草相：草地半数留白，摆幅只允许 1 或 2', () => {
  assert.ok(blades.length > 150 && blades.length < 260, `四百格该留约一半，实际 ${blades.length}`);
  assert.ok(blades.every((b) => b.dx === 1 || b.dx === 2));
  assert.ok(blades.every((b) => b.offset >= 0 && b.offset < 1));
  // 相邻格相位不同 = 风读得出来；全同就是集体做操。
  const offsets = new Set(blades.slice(0, 40).map((b) => Math.round(b.offset * 100)));
  assert.ok(offsets.size > 20, `相位偏移退化：${offsets.size} 种`);
});

test('草相：非草地一格都不长', () => {
  const none = grassBladesFor([
    { x: 0, y: 0, grass: false },
    { x: 1, y: 0, grass: false },
  ]);
  assert.deepEqual(none, []);
});

test('草摆位移：整数像素、幅度受风增益限制、同帧可复现', () => {
  const blade = { x: 3, y: 4, dx: 2, offset: 0.3 };
  for (let t = 0; t < 6000; t += 137) {
    const v = grassSwayPx(blade, t, 1);
    assert.equal(Number.isInteger(v), true, `t=${t} 拿到亚像素 ${v}`);
    assert.ok(Math.abs(v) <= 2, `t=${t} 摆幅越界 ${v}`);
    assert.equal(v, grassSwayPx(blade, t, 1));
  }
  // 风增益 0 就必须纹丝不动（无风时不许有摆动）。
  for (let t = 0; t < 3000; t += 211) {
    assert.equal(grassSwayPx(blade, t, 0), 0);
  }
});

test('涟漪：雨强 0 一个都不画；雨强越大越多，但不超过可见区格数', () => {
  const view = { x: 0, y: 0, width: 10, height: 10 };
  assert.deepEqual(rainRipplesFor(view, 1234, 0), []);
  const light = rainRipplesFor(view, 1234, 0.2);
  const heavy = rainRipplesFor(view, 1234, 0.9);
  assert.ok(light.length < heavy.length, `小雨 ${light.length} 应少于暴雨 ${heavy.length}`);
  assert.ok(heavy.length <= 100, '不能多出可见区之外的格');
  assert.ok(heavy.every((r) => r.x >= 0 && r.x < 10 && r.y >= 0 && r.y < 10));
  assert.ok(heavy.every((r) => r.progress >= 0 && r.progress < 1));
});

test('涟漪：只画可见区，镜头挪到别处不会带着旧区的水花', () => {
  const a = rainRipplesFor({ x: 0, y: 0, width: 5, height: 5 }, 900, 1);
  const b = rainRipplesFor({ x: 40, y: 40, width: 5, height: 5 }, 900, 1);
  assert.equal(a.some((r) => b.some((s) => s.x === r.x && s.y === r.y)), false);
  assert.equal(a.length, 25);
  assert.equal(b.length, 25);
});

test('漂移点：萤火与鸟节奏不同，且都夹在合法范围', () => {
  const anchors = Array.from({ length: 12 }, (_, i) => ({ x: i * 10, y: 20, phase: i / 12 }));
  const flies = driftDotsFor(anchors, 2400, 'firefly');
  const birds = driftDotsFor(anchors, 2400, 'bird');
  assert.equal(flies.length, anchors.length);
  assert.ok(flies.every((d) => d.alpha >= 0 && d.alpha <= 1), '闪烁 alpha 要夹住');
  assert.ok(birds.every((d) => d.alpha > 0.5), '鸟不闪烁：alpha 恒定偏高');
  // 两种生物必须给出不同的画面，否则夜里/白天看不出区别。
  assert.notDeepEqual(flies, birds);
  // 同刻同锚点必同结果。
  assert.deepEqual(driftDotsFor(anchors, 2400, 'firefly'), flies);
});

test('漂移点：周期整除回绕（同一相位=同一位置）', () => {
  const anchors = [{ x: 100, y: 50, phase: 0.2 }];
  assert.deepEqual(driftDotsFor(anchors, 0, 'firefly'), driftDotsFor(anchors, 3600, 'firefly'));
});

test('预算：随可见区格数增长、封顶后不再涨，且与世界大小无关', () => {
  const small = budgetFor({ width: 10, height: 10 });
  const big = budgetFor({ width: 100, height: 100 });
  const huge = budgetFor({ width: 400, height: 400 });
  assert.ok(big.maxGrass > small.maxGrass, '更大视野要允许更多草尖');
  assert.equal(big.maxRipples, huge.maxRipples, '涟漪必须封顶，否则视野再大也不涨');
  assert.equal(huge.maxRipples, 600);
  assert.equal(huge.maxDots, 64, '小点数恒定：它不该随视野膨胀');
  assert.equal(budgetFor({ width: 0, height: 0 }).maxGrass, 1, '脏视野不炸成 0 以下');
});

// ---------------------------------------------------------------- 阻尼跟随

test('阻尼推进：单调逼近、不超调，1 秒内到位（既不瞬移也不拖沓）', () => {
  let state = beginGlide({ x: 0, y: 0 }, { x: 100, y: 0 });
  let prev = -1;
  let firstFrame = 0;
  for (let i = 0; i < 60; i += 1) {
    const step = glideStep(state, 16.67);
    state = step.state;
    assert.ok(state.x >= prev - 1e-9, `第 ${i} 步倒退`);
    assert.ok(state.x <= 100 + SETTLE_PX, `第 ${i} 步超调：${state.x}`);
    prev = state.x;
    if (firstFrame === 0 && state.x > 20) firstFrame = i;
    if (step.settled) {
      // 到位用了几帧：约 660ms（40 帧）左右。少于 4 帧就是瞬移。
      assert.ok(i >= 4, `${i} 帧就到位，读成瞬移`);
      assert.ok(i < 60, `${i} 帧才到位，太拖沓`);
      break;
    }
    assert.ok(i < 59, '60 帧（约 1 秒）内必须到位');
  }
  assert.ok(Math.abs(state.x - 100) <= SETTLE_PX);
  assert.ok(firstFrame >= 2, `起步太快（第 ${firstFrame} 帧就跳 20px）`);
});

test('阻尼到位判据：距离 ≤ SETTLE_PX 时第一帧就 settled（不该空转一帧）', () => {
  const step = glideStep(beginGlide({ x: 100, y: 100 }, { x: 101, y: 100 }), 16);
  assert.equal(step.settled, true);
});

test('脏帧间隔：负数与 NaN 当 0，位置不倒退也不变 NaN', () => {
  const state = beginGlide({ x: 0, y: 0 }, { x: 100, y: 50 });
  for (const dt of [-16, Number.NaN, Infinity]) {
    const step = glideStep(state, dt);
    assert.equal(Number.isFinite(step.state.x), true, `dt=${dt} 漂成 NaN`);
    assert.equal(step.state.x, 0, `dt=${dt} 不该动`);
    assert.equal(step.state.y, 0);
  }
});

test('阻尼与 dt 的关系：累计时长相同则位置近似相同（帧率无关）', () => {
  const run = (frameMs: number) => {
    let state = beginGlide({ x: 0, y: 0 }, { x: 200, y: 0 });
    for (let i = 0; i < 1000 / frameMs; i += 1) state = glideStep(state, frameMs).state;
    return state.x;
  };
  const at60 = run(16.67);
  const at30 = run(33.33);
  assert.ok(Math.abs(at60 - at30) < 3, `60fps ${at60} 与 30fps ${at30} 差太多`);
});

test('滑行控制器：到位后交棒（active 转 false），拖拽打断走 cancel', () => {
  const applied: { x: number; y: number }[] = [];
  const glide = createCameraGlide({
    scrollOf: (x, y) => ({ x, y }),
    currentScroll: () => ({ x: 0, y: 0 }),
    applyScroll: (x, y) => applied.push({ x, y }),
  });
  assert.equal(glide.update(16), false, '没发起过就不该接管镜头');
  glide.begin(80, 40);
  assert.equal(glide.active(), true);
  let frames = 0;
  while (glide.update(16) && frames < 500) frames += 1;
  assert.equal(glide.active(), false, '滑到位必须交棒');
  assert.ok(frames > 5 && frames < 300, `收敛用了 ${frames} 帧`);
  assert.deepEqual(applied[applied.length - 1], { x: 80, y: 40 }, '最后一次落点必须是目标');

  glide.begin(10, 10);
  glide.cancel();
  assert.equal(glide.update(16), false, 'cancel 之后不再接管');
});

test('滑行控制器：连点两个头像改道而不回跳', () => {
  const applied: { x: number; y: number }[] = [];
  const glide = createCameraGlide({
    scrollOf: (x, y) => ({ x, y }),
    currentScroll: () => ({ x: 0, y: 0 }),
    applyScroll: (x, y) => applied.push({ x, y }),
  });
  glide.begin(200, 0);
  glide.update(16);
  glide.update(16);
  const before = applied.length;
  glide.begin(0, 200); // 改道
  glide.update(16);
  const after = applied[applied.length - 1];
  assert.ok(after.x > 0 && after.y >= 0, '改道后仍在原位置附近继续滑');
  assert.equal(applied.length, before + 1);
});

test('滑行控制器：镜头已经在那人脚下时不发起滑行（不空抖）', () => {
  const applied: unknown[] = [];
  const glide = createCameraGlide({
    scrollOf: (x, y) => ({ x, y }),
    currentScroll: () => ({ x: 50, y: 50 }),
    applyScroll: (x, y) => applied.push([x, y]),
  });
  glide.begin(50, 51);
  assert.equal(glide.active(), false);
  assert.equal(glide.update(16), false);
  assert.deepEqual(applied, []);
});

test('DAMPING_K 的量级：滑行既不能瞬移也不能拖沓（1 秒内走完大半）', () => {
  let state = beginGlide({ x: 0, y: 0 }, { x: 1000, y: 0 });
  for (let i = 0; i < 60; i += 1) state = glideStep(state, 16.67).state; // 约 1 秒
  const travelled = state.x;
  assert.ok(travelled > 800, `1 秒只走 ${travelled.toFixed(0)}px，太拖沓`);
  assert.ok(travelled < 1000, '1 秒就走完等于瞬移，阻尼白做');
  assert.ok(DAMPING_K > 0);
});
