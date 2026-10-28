/** task-29 动画采样门禁：12fps、帧号由 simulation 时间决定、位置整数像素。
 *
 * 这些断言不加载 Phaser（`villager-frames.ts` 是纯函数），所以能在 node --test 里跑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { Simulation } from '../src/world/simulation.ts';
import { LAMP_DRY } from '../src/world/lampoil.ts';
import { syncCommand } from './feed-helpers.ts';
import {
  ANIM_FPS,
  FRAME_MS,
  IDLE_FRAMES,
  WALK_FRAMES,
  animFrame,
  animStep,
  lampAnimationTime,
  pixelAt,
  villagerPose,
} from '../src/render/villager-frames.ts';

test('采样率就是 12fps', () => {
  assert.equal(ANIM_FPS, 12);
  assert.ok(Math.abs(FRAME_MS - 1000 / 12) < 1e-9);
});

test('同一 simulation 时间 → 同一帧号（与调用时机无关）', () => {
  for (const now of [0, 1, 41, 83, 84, 167, 1667, 123_456]) {
    assert.equal(animFrame(now, IDLE_FRAMES), animFrame(now, IDLE_FRAMES));
    assert.equal(animFrame(now, WALK_FRAMES), animFrame(now, WALK_FRAMES));
  }
});

test('帧号每 1/12 秒进位一次，不掉帧也不跳帧', () => {
  const boundaries: number[] = [];
  let last = animStep(0);
  for (let t = 0; t <= 1000; t += 1) {
    const step = animStep(t);
    if (step !== last) {
      boundaries.push(t);
      last = step;
    }
  }
  // 0..1000ms 内应有 12 次进位（83,167,…,1000）
  assert.equal(boundaries.length, 12);
  assert.deepEqual(boundaries, [84, 167, 250, 334, 417, 500, 584, 667, 750, 834, 917, 1000]);
});

test('待机 2 帧 / 走路 4 帧，帧号始终在范围内且会回绕', () => {
  const idleSeen = new Set<number>();
  const walkSeen = new Set<number>();
  for (let t = 0; t < 2000; t += 17) {
    idleSeen.add(animFrame(t, IDLE_FRAMES));
    walkSeen.add(animFrame(t, WALK_FRAMES));
  }
  assert.deepEqual([...idleSeen].sort(), [0, 1]);
  assert.deepEqual([...walkSeen].sort(), [0, 1, 2, 3]);
});

test('走路放四帧、站着放两帧——判据是脚下有没有路，不是 mode', () => {
  // 这一条原来叫「只有走路态用 4 帧，其余模式用 2 帧待机」，判据是渲染层
  // 自己列的一张 mode 表（`isWalkingMode` = `toWork|toAltar|sheltering`）。
  // **那张表漏了两种真的在走的人**：走作息环线的那位 mode 是 `'idle'`
  // （`stepIdle` 只写 `path` 与 `routineGoing`，不翻 mode），举急件的那位是
  // `'bearingDecree'`。两种人一路在滑，腿上放的还是站着的那两帧——而她们
  // 嘴上的牌子（「去街口」「举着急件跑向祭坛」）说的是正在跑。
  //
  // 所以判据换成快照里那个派生字段：`path.length > 0`。**表会漏，路不会。**
  assert.equal(villagerPose('toWork', true, 250).frameCount, WALK_FRAMES);
  assert.equal(villagerPose('toAltar', true, 250).frameCount, WALK_FRAMES);
  assert.equal(villagerPose('sheltering', true, 250).frameCount, WALK_FRAMES);
  assert.equal(villagerPose('bearingDecree', true, 250).frameCount, WALK_FRAMES);
  // 走作息环线：mode 是 idle，可她真的在走。这一支是原来漏掉的那一种。
  assert.equal(villagerPose('idle', true, 250).frameCount, WALK_FRAMES);
  // 站着的时候一律两帧，不管她是什么 mode。
  for (const mode of ['idle', 'saluting', 'working', 'delivering', 'bearingDecree'] as const) {
    const pose = villagerPose(mode, false, 250);
    assert.equal(pose.frameCount, IDLE_FRAMES, `${mode} 站着应该放待机 2 帧`);
  }
});

test('同一个 mode，走与不走的帧数必须真的不一样', () => {
  // 上一行只说了「idle 走着给四帧」。这一行钉住它**不是白给的**：如果哪天
  // 有人把 `walking` 那个参数接漏了（比如又改回按 mode 判），这一行会红，
  // 而上一行只会静静地继续绿。
  const walking = villagerPose('idle', true, 250);
  const standing = villagerPose('idle', false, 250);
  assert.notEqual(walking.frameCount, standing.frameCount, 'idle 走着与站着得是两套帧');
  // 走路的四帧里必须有抬脚——两帧待机的脚永远是 0。
  const feet = new Set<string>();
  for (let t = 0; t < 400; t += 17) {
    const pose = villagerPose('idle', true, t);
    feet.add(`${pose.footLeft},${pose.footRight}`);
  }
  assert.ok(feet.size > 1, `走路该有脚的动作，实得 ${[...feet].join(' / ')}`);
  for (let t = 0; t < 400; t += 17) {
    const pose = villagerPose('idle', false, t);
    assert.equal(`${pose.footLeft},${pose.footRight}`, '0,0', '待机两帧不该有脚的动作');
  }
});

test('姿态偏移全是整数像素（没有逐帧浮点晃动）', () => {
  for (let t = 0; t < 5000; t += 7) {
    for (const mode of ['idle', 'toWork', 'saluting', 'delivering', 'working'] as const) {
      const pose = villagerPose(mode, false, t);
      assert.ok(Number.isInteger(pose.offsetY), `${mode}@${t} offsetY 非整数`);
      assert.ok(Number.isInteger(pose.footLeft), `${mode}@${t} footLeft 非整数`);
      assert.ok(Number.isInteger(pose.footRight), `${mode}@${t} footRight 非整数`);
      assert.ok(pose.frame >= 0 && pose.frame < pose.frameCount);
    }
  }
});

test('行礼/交付的额外偏移也是整数，且叠在帧偏移上', () => {
  const base = villagerPose('idle', false, 250);
  const salute = villagerPose('saluting', false, 250);
  const deliver = villagerPose('delivering', false, 250);
  assert.equal(salute.offsetY, base.offsetY - 2);
  assert.equal(deliver.offsetY, base.offsetY - 1);
});

test('位置取整：分数坐标一定落到整数像素，不出现 .5', () => {
  const cases = [0, 0.4999, 0.5, 0.51, 3.25, 12.5, -0.5, 7.999];
  for (const value of cases) {
    const px = pixelAt(value);
    assert.ok(Number.isInteger(px), `${value} → ${px} 不是整数`);
    assert.ok(Math.abs(px - value) <= 0.5, `${value} → ${px} 偏离超过半像素`);
  }
  // 世界格中心：整数格 → 整数像素
  const TILE_PX = 16;
  for (const cell of [0, 1, 7, 12]) {
    assert.ok(Number.isInteger(pixelAt((cell + 0.5) * TILE_PX)));
  }
});

test('像素取整不返回 -0（strictEqual 会红）', () => {
  // Math.round(-0.5) 是 -0；像素上等价，但断言里必须归一到 0。
  assert.strictEqual(pixelAt(-0.5), 0);
  assert.ok(Object.is(pixelAt(-0.5), 0), 'pixelAt(-0.5) 不能是 -0');
  assert.strictEqual(pixelAt(-0.49), 0);
  assert.strictEqual(pixelAt(0), 0);
  assert.ok(Object.is(pixelAt(-0), 0));
});

test('采样是纯函数：调用它不会改变输入，也不依赖调用次数', () => {
  const mode = 'toWork' as const;
  const now = 1234;
  const first = villagerPose(mode, true, now);
  for (let i = 0; i < 100; i += 1) villagerPose(mode, true, now + i * 13);
  const again = villagerPose(mode, true, now);
  assert.deepEqual(again, first);
});

test('活体：走作息环线的人放的是四帧，不是站着的那两帧', () => {
  // 上面几条钉的是纯函数。这一条钉的是**世界真的会把 walking 送到渲染层**：
  // 走环线的那个人 mode 是 `'idle'`，她不在 `toWork|toAltar|sheltering` 里，
  // 所以按 mode 判的那一版给她两帧——她一路在滑，腿上没有动作。
  //
  // 判据是「坐标动了的那些拍」，与 `routine-going-label.test.ts` 同一条：
  // 快照里没有 `path`，而位置是世界自己的事实，不需要给测试加观察口。
  const raw = JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>;
  const blueprints = parseBlueprintTable(raw);
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });

  let movingIdle = 0;
  const wrong: string[] = [];
  let before = new Map(
    sim.snapshot().villagers.map((v) => [v.id, { pos: { ...v.pos }, walking: v.walking }]),
  );
  for (let t = 0; t < 1800; t += 1) {
    sim.update(16);
    const snapshot = sim.snapshot();
    for (const villager of snapshot.villagers) {
      const was = before.get(villager.id)!;
      const moved = villager.pos.x !== was.pos.x || villager.pos.y !== was.pos.y;
      const pose = villagerPose(villager.mode, villager.walking, snapshot.now);
      // **只判「这一整拍都在走」的那些拍**：`walking` 这一拍开始时为真、
      // 结束时还为真，说明路没在这一拍里走完。
      //
      // 这条限定挡的是**两类边界拍**，不是一类。少了它，这条会因为世界的记账顺序
      // 而红，而那不是缺陷：
      //
      // - **到站那一拍**：`walk()` 在 `pos = next` 之后才 `path.shift()`，于是最后
      //   一步走完的那一刻她动了，而 `path` 已经空了——`walking` 是假，放两帧。
      //   那一帧她确实站在了落脚点上，两帧不算假。
      // - **出发那一拍**：交路线的那几处都把 `path` 写上就 `return`，不当拍走
      //   （`stepIdle` 的作息节拍、`saluting→toWork` 的 `pendingRoute`、急件派发、
      //   下雨躲檐）。于是 `walking` 在真走之前已经为真了一整拍，而那一拍她没动。
      //   躲檐那处自己写着「这一刻路才交出去，人还在原地」，说的是同一件事。
      //
      // 两类都不算假，理由是同一条：**被同一拍改写的东西，描述的是改写前那一帧。**
      // 这与 `routine-going-label.test.ts` 的 `stale` 规则也是同一条。
      if (moved && villager.mode === 'idle' && was.walking && villager.walking) {
        movingIdle += 1;
        if (pose.frameCount !== WALK_FRAMES) {
          wrong.push(`t=${t} ${villager.name} 整拍都在走却放 ${pose.frameCount} 帧`);
        }
      }
    }
    before = new Map(
      snapshot.villagers.map((v) => [v.id, { pos: { ...v.pos }, walking: v.walking }]),
    );
  }

  assert.ok(movingIdle > 200, `只观察到 ${movingIdle} 整拍在走，像是世界没跑起来`);
  assert.deepEqual(
    wrong.slice(0, 5),
    [],
    `走着的拍放的不是四帧，共 ${wrong.length} 处：\n${wrong.slice(0, 5).join('\n')}`,
  );
});

test('动画采样不改变世界确定性回放（边跑边采样，结果与不采样一致）', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>;
  const blueprints = parseBlueprintTable(raw);
  const world = buildWorld(blueprints);
  const makeSim = (): Simulation =>
    new Simulation({
      grid: world.grid,
      buildings: world.buildings,
      altar: ALTAR,
      villagerName: '莞尔',
      spawnBuilding: (prefabId, instanceId) => {
        const blueprint = blueprints.get(prefabId);
        if (blueprint === undefined) return null;
        return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
      },
    });
  const sampled = makeSim();
  const plain = makeSim();
  for (let i = 0; i < 300; i += 1) {
    plain.update(50);
    sampled.update(50);
    // 每步都按当前快照时间采样一次：纯函数，不许影响仿真。
    const snapshot = sampled.snapshot();
    for (const villager of snapshot.villagers) {
      const pose = villagerPose(villager.mode, villager.walking, snapshot.now);
      assert.ok(Number.isInteger(pose.offsetY));
    }
  }
  assert.deepEqual(sampled.snapshot(), plain.snapshot(), '采样改变了仿真回放结果');
});

test('灯油只改画面取样：油干时采样变慢，补回油后立刻恢复', () => {
  assert.equal(lampAnimationTime(1, 1234), 1234, '有油时必须原样返回，不改已验证的动作');
  assert.equal(lampAnimationTime(LAMP_DRY, 1234), 1234, '刚好到底线算还有油');
  const dry = lampAnimationTime(0, 1234);
  assert.ok(dry < 1234, '油干时采样时刻要落后，动作才会变慢');
  assert.equal(dry % 400, 0, '慢速取样按 400ms 一档，而不是连续变慢');
  // 同一档内的两个时刻必须给出同一个姿态：这就是"慢"本身。
  assert.deepEqual(
    villagerPose('idle', false, lampAnimationTime(0, 1234)),
    villagerPose('idle', false, lampAnimationTime(0, 1400)),
  );
  // 补回油后不能再被慢速取样影响。
  assert.notEqual(lampAnimationTime(1, 1234), dry);
});

test('活体：举急件的那位放的是四帧，不是站着的那两帧', () => {
  // 上面那条活体跑的是默认世界——**一个急件都没有**。举急件的那位
  // （`bearingDecree`）从来没上过场，她那一档四帧全靠上面第 75 行那条纯函数
  // 断言撑着。而那个 `true` 是测试自己传进去的，所以把快照的 `walking` 改回
  // 按 mode 判时，第 75 行**照旧绿**：变异实测只红上面那条活体。
  //
  // 这条驱真的急件补上这个缺口。步长 100ms，与 `decree.test.ts`、
  // `routine-going-label.test.ts` 一致——16ms 一拍拍 400 下不够她走到被派上。
  const raw = JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>;
  const blueprints = parseBlueprintTable(raw);
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
  // 一张带问题的活，才派得出急件。
  sim.enqueue(
    syncCommand({
      tasks: [
        { id: 'c_block', kind: 'code', title: '清理临时目录', question: '要删掉 ./temp_build 吗？' },
      ],
    }),
  );

  let bearingMoved = 0;
  let bearingWalk = 0;
  const wrong: string[] = [];
  let before = new Map(
    sim.snapshot().villagers.map((v) => [v.id, { pos: { ...v.pos }, walking: v.walking }]),
  );
  for (let t = 0; t < 400; t += 1) {
    sim.update(100);
    const snapshot = sim.snapshot();
    for (const villager of snapshot.villagers) {
      if (villager.mode !== 'bearingDecree') continue;
      const was = before.get(villager.id)!;
      const moved = villager.pos.x !== was.pos.x || villager.pos.y !== was.pos.y;
      if (!moved) continue;
      bearingMoved += 1;
      // 同一条「整拍都在走」规则：`walk()` 在 `pos = next` 之后才 `path.shift()`，
      // 所以最后一步走完的那一刻她动了而 `walking` 已经是假——那一帧她确实站在
      // 落脚点上，两帧不算假。
      if (!was.walking || !villager.walking) continue;
      bearingWalk += 1;
      const pose = villagerPose(villager.mode, villager.walking, snapshot.now);
      if (pose.frameCount !== WALK_FRAMES) {
        wrong.push(`t=${t} ${villager.name} 举着急件整拍都在走却放 ${pose.frameCount} 帧`);
      }
    }
    before = new Map(
      snapshot.villagers.map((v) => [v.id, { pos: { ...v.pos }, walking: v.walking }]),
    );
  }

  assert.ok(bearingMoved > 0, '一趟急件都没派出来——这条什么都没验');
  // 这句是这条的价值所在：把快照的 `walking` 改回按 mode 判，`bearingDecree`
  // 不在那张表里，于是她一个整拍走路的样本都不剩，上面红的是这句而不是判据。
  assert.ok(bearingWalk > 0, `只见到 ${bearingMoved} 拍在动，却没有一整拍在走的——她像是没拿到 walking`);
  assert.deepEqual(
    wrong.slice(0, 5),
    [],
    `举急件走着的那几拍放的不是四帧，共 ${wrong.length} 处：\n${wrong.slice(0, 5).join('\n')}`,
  );
});
