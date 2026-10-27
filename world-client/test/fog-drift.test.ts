import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIFT_PUFFS, driftPuffs } from '../src/world/fog-drift.ts';

const CENTER = { x: 40, y: 30 };
const RADIUS = 16;

// ------------------------------------------------------------------ 确定性

test('同一时刻永远得到同一组雾团', () => {
  const a = driftPuffs(CENTER, RADIUS, 12345);
  const b = driftPuffs(CENTER, RADIUS, 12345);
  assert.deepEqual(a, b, '雾团位置必须可复现，否则截图对不上');
});

test('雾团数量固定，不随时间变化', () => {
  for (const t of [0, 5000, 60000]) {
    assert.equal(driftPuffs(CENTER, RADIUS, t).length, DRIFT_PUFFS);
  }
});

// ------------------------------------------------------------------ 真的在动

test('过一段时间后位置变了：雾确实在漂', () => {
  const a = driftPuffs(CENTER, RADIUS, 0);
  const b = driftPuffs(CENTER, RADIUS, 5000);
  const moved = a.some(
    (puff, i) =>
      Math.hypot(puff.at.x - b[i]!.at.x, puff.at.y - b[i]!.at.y) > 0.3,
  );
  assert.ok(moved, '5 秒后应有明显位移');
});

test('移动是缓慢的：1 秒内位移不超过一格', () => {
  const a = driftPuffs(CENTER, RADIUS, 0);
  const b = driftPuffs(CENTER, RADIUS, 1000);
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.hypot(a[i]!.at.x - b[i]!.at.x, a[i]!.at.y - b[i]!.at.y);
    assert.ok(d <= 1, `第 ${i} 团 1 秒位移 ${d.toFixed(2)} 格，太快会抢注意力`);
  }
});

test('浓度在呼吸：不是恒定的', () => {
  const a = driftPuffs(CENTER, RADIUS, 0);
  const b = driftPuffs(CENTER, RADIUS, 3000);
  assert.ok(
    a.some((puff, i) => Math.abs(puff.alpha - b[i]!.alpha) > 0.05),
    '浓度应随时间变化',
  );
});

test('浓度落在 0..1，不会变成负的或全实心', () => {
  for (const t of [0, 2000, 7000, 20000]) {
    for (const puff of driftPuffs(CENTER, RADIUS, t)) {
      assert.ok(puff.alpha > 0 && puff.alpha < 1, `alpha ${puff.alpha}`);
    }
  }
});

// ------------------------------------------------------------------ 只贴着边界

test('雾团贴着揭示边界，不跑到世界中心', () => {
  for (const puff of driftPuffs(CENTER, RADIUS, 1000)) {
    const distance = Math.hypot(puff.at.x - CENTER.x, puff.at.y - CENTER.y);
    assert.ok(
      distance > RADIUS - 8,
      `雾团离中心 ${distance.toFixed(1)} 格，跑进镇子里了`,
    );
  }
});

test('雾团不会飘到世界外面太远', () => {
  for (const puff of driftPuffs(CENTER, RADIUS, 1000)) {
    const distance = Math.hypot(puff.at.x - CENTER.x, puff.at.y - CENTER.y);
    assert.ok(distance < RADIUS + 12, `雾团离中心 ${distance.toFixed(1)} 格，太远`);
  }
});

test('半径变化时雾团跟着边界走', () => {
  const near = driftPuffs(CENTER, 10, 1000);
  const far = driftPuffs(CENTER, 30, 1000);
  const nearAvg =
    near.reduce((s, p) => s + Math.hypot(p.at.x - CENTER.x, p.at.y - CENTER.y), 0) /
    near.length;
  const farAvg =
    far.reduce((s, p) => s + Math.hypot(p.at.x - CENTER.x, p.at.y - CENTER.y), 0) /
    far.length;
  assert.ok(farAvg > nearAvg + 10, '揭示半径变大时雾团应外移');
});

// ------------------------------------------------------- 速度就是注释里那个数

test('漂移速度落在注释说的那个区间里：量出来的，不是抄的', () => {
  // `fog-drift.ts` 那段写着「实测每秒走 0.6～1.9 格」。这个数不参与任何渲染
  // 决策，只参与「慢不慢」这个判断——所以它错了没有任何机器会响。而它上一版
  // 是 0.35 rad/s，注释自己写着那是「绕着雾圈跑」。
  //
  // 上面那条「1 秒内位移不超过一格」盖不住这件事：它在 RADIUS = 16 上跑，
  // 而那儿实测最快只有 0.60 格/秒——真正 operating 的半径是 38 和 60，
  // 那儿最快 1.94。同样的余量在 16 上够，在 60 上就差三倍。
  //
  // 所以这里按注释说的方法量一遍：半径取它点名的那两个（开局 38、顶格 60），
  // 120 秒、每 1/30 秒一点，14 团全扫。取 120 秒是因为起伏项
  // `sin(0.12t + …)` 的周期是 2π/0.12 ≈ 52.4 秒，两轮多就把最大最小都盖住了；
  // 轨道角不影响速度大小（切向速度只跟半径有关），不必扫满一圈 209 秒。
  //
  // 区间是 2026-10-28 一次实测的 0.60～1.95 格/秒，放成两条带：要抓的是
  // 「谁把 DRIFT_ANGULAR_SPEED 调大了几倍」那种，不是小数点后第二位。
  // 改坏了这条就红——红的意思是来改那段注释，不是来放宽这两个数。
  const DT_MS = 1000 / 30;
  let slowest = Infinity;
  let fastest = -Infinity;
  for (const radius of [38, 60]) {
    for (let step = 1; step <= 120 * 30; step += 1) {
      const now = driftPuffs(CENTER, radius, step * DT_MS);
      const before = driftPuffs(CENTER, radius, (step - 1) * DT_MS);
      for (let i = 0; i < now.length; i += 1) {
        const moved = Math.hypot(
          now[i]!.at.x - before[i]!.at.x,
          now[i]!.at.y - before[i]!.at.y,
        );
        slowest = Math.min(slowest, moved);
        fastest = Math.max(fastest, moved);
      }
    }
  }
  // 每 1/30 秒的位移换成每秒。
  const perSecond = (tilesPerFrame: number): number => tilesPerFrame * 30;
  assert.ok(
    perSecond(fastest) >= 1.8 && perSecond(fastest) <= 2.1,
    `最快该在 1.8～2.1 格/秒，实得 ${perSecond(fastest).toFixed(3)}`,
  );
  assert.ok(
    perSecond(slowest) >= 0.55 && perSecond(slowest) <= 0.65,
    `最慢该在 0.55～0.65 格/秒，实得 ${perSecond(slowest).toFixed(3)}——` +
      '低于这条雾就冻住了，高于那条就开始抢注意力',
  );
});
