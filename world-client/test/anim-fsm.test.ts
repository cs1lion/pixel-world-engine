/**
 * 村民动画状态机的迁移测试。
 *
 * 覆盖的是**状态迁移本身**，不是像素：
 *   - 正常序列与每个动作被打断后的落点；
 *   - 打断后残留权重的收敛；
 *   - 极短时间内连续打断 A→B→C；
 *   - 同一意图重复调用不抖动；
 *   - 稳态输出与现有 `villagerPose` 逐字段一致（接入前的对齐证据）。
 *
 * `villager-frames.ts` 是纯函数，所以这些断言能在 `node --test` 里直接跑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type {
  AnimFsmState,
  AnimSample,
  AnimStateId,
} from '../src/animation/villager-anim-fsm.ts';
import { villagerPose } from '../src/render/villager-frames.ts';
import type { VillagerMode } from '../src/world/types.ts';

/**
 * 实现文件在 base 上可能还不存在。用动态 import 把「缺实现」变成一条断言失败
 * （`AssertionError`），而不是 `ERR_MODULE_NOT_FOUND`——后者会被 red-first 判成
 * 「测试根本没跑起来」，那样这条闸门就白跑了。实现缺失时其余用例不注册，
 * 免得把「缺文件」伪装成一片下游 TypeError。
 */
type FsmModule = typeof import('../src/animation/villager-anim-fsm.ts');
const fsm: FsmModule | null = await import('../src/animation/villager-anim-fsm.ts').catch(() => null);

test('动画状态机实现存在：`villager-anim-fsm.ts` 可加载', () => {
  assert.ok(fsm, '缺少动画状态机实现');
});

if (fsm !== null) {
const {
  ANIM_STATE_IDS,
  ANIM_STATES,
  ANIM_TRANSITIONS,
  MAX_RESIDUAL_LAYERS,
  advanceAnimFsm,
  animFrameAt,
  animGraphMarkdown,
  animIntentOf,
  createAnimFsmState,
  sampleAnimFsm,
  transitionDurationMs,
} = fsm;

const EPS = 1e-9;

function weightSum(sample: AnimSample): number {
  return sample.layers.reduce((sum, layer) => sum + layer.weight, 0);
}

function weightOf(sample: AnimSample, state: AnimStateId): number {
  const layer = sample.layers.find((item) => item.state === state);
  return layer === undefined ? 0 : layer.weight;
}

function layerStates(sample: AnimSample): AnimStateId[] {
  return sample.layers.map((layer) => layer.state);
}

test('状态表：5 个动作态，转移表覆盖全部 20 个不同方向的打断', () => {
  assert.deepEqual([...ANIM_STATE_IDS], ['idle', 'walk', 'salute', 'work', 'deliver']);
  assert.equal(ANIM_STATES.length, 5);
  assert.equal(ANIM_TRANSITIONS.length, 20);
  for (const transition of ANIM_TRANSITIONS) {
    assert.notEqual(transition.from, transition.to);
    assert.ok(transition.durationMs > 0, `${transition.from}→${transition.to} 时长非正`);
    assert.ok(transition.durationMs <= 500, `${transition.from}→${transition.to} 时长长得不像过渡`);
    assert.ok(transition.condition.length > 0, `${transition.from}→${transition.to} 缺条件说明`);
  }
});

test('稳态采样与现有 villagerPose 逐字段一致（接入前的对齐证据）', () => {
  const cases: readonly [AnimStateId, VillagerMode, boolean][] = [
    ['idle', 'idle', false],
    ['walk', 'idle', true],
    ['salute', 'saluting', false],
    ['work', 'working', false],
    ['deliver', 'delivering', false],
  ];
  for (const [state, mode, walking] of cases) {
    for (const now of [0, 1, 41, 83, 84, 167, 250, 1234, 123_456]) {
      const sample = sampleAnimFsm(createAnimFsmState(state, 0), now);
      assert.equal(sample.layers.length, 1, `${state}@${now} 稳态应只有一层`);
      assert.equal(sample.layers[0].weight, 1);
      const pose = villagerPose(mode, walking, now);
      assert.deepEqual(
        sample.layers[0].pose,
        { offsetY: pose.offsetY, footLeft: pose.footLeft, footRight: pose.footRight },
        `${state}@${now} 姿态与旧采样不一致`,
      );
      assert.equal(sample.layers[0].frame, pose.frame, `${state}@${now} 帧号不一致`);
      assert.equal(sample.layers[0].frameCount, pose.frameCount, `${state}@${now} 帧数不一致`);
      assert.equal(sample.offsetY, pose.offsetY, `${state}@${now} 加权位移不一致`);
      assert.deepEqual(sample.anchor, { x: 0, y: 0 });
    }
  }
});

test('正常序列：idle → salute → walk → work → deliver → walk → idle', () => {
  let state = createAnimFsmState('idle', 0);
  const steps: readonly [AnimStateId, number][] = [
    ['salute', 100],
    ['walk', 900],
    ['work', 9000],
    ['deliver', 9500],
    ['walk', 11_000],
    ['idle', 11_300],
  ];
  const expectedDurations = [90, 180, 150, 220, 200, 140];
  for (let index = 0; index < steps.length; index += 1) {
    const [intent, at] = steps[index] as [AnimStateId, number];
    const previous = state.current;
    state = advanceAnimFsm(state, intent, at);
    assert.equal(state.current, intent, `第 ${index + 1} 步没落到 ${intent}`);
    assert.equal(
      transitionDurationMs(previous, intent),
      expectedDurations[index],
      `${previous}→${intent} 时长与表不符`,
    );
    // 过渡刚开始：旧状态仍在，权重 1；新状态权重 0 但已经在层里。
    const sample = sampleAnimFsm(state, at);
    assert.equal(sample.layers[0].state, intent);
    assert.equal(sample.layers[0].weight, 0);
    assert.equal(weightOf(sample, previous), 1);
    assert.ok(Math.abs(weightSum(sample) - 1) < EPS);
    // 过渡结束：只剩新状态。
    const settledSample = sampleAnimFsm(state, at + expectedDurations[index]!);
    assert.deepEqual(layerStates(settledSample), [intent]);
    assert.equal(settledSample.layers[0].weight, 1);
  }
});

test('每个动作被别的动作打断时：落点是新意图，旧状态在时长内清空', () => {
  for (const from of ANIM_STATE_IDS) {
    for (const to of ANIM_STATE_IDS) {
      if (from === to) continue;
      const at = 1000;
      let state = createAnimFsmState(from, 0);
      state = advanceAnimFsm(state, to, at);
      assert.equal(state.current, to, `${from} 被 ${to} 打断后没落到 ${to}`);
      const duration = transitionDurationMs(from, to);

      const opening = sampleAnimFsm(state, at);
      assert.equal(opening.layers[0].state, to);
      assert.equal(opening.layers[0].weight, 0, `${from}→${to} 新状态不是从 0 淡入`);
      assert.equal(weightOf(opening, from), 1, `${from}→${to} 旧状态开场不是满权重`);
      assert.ok(Math.abs(weightSum(opening) - 1) < EPS);

      const closing = sampleAnimFsm(state, at + duration);
      assert.deepEqual(layerStates(closing), [to], `${from}→${to} 结束后旧状态没清空`);
      assert.equal(closing.layers[0].weight, 1);
    }
  }
});

test('打断后残留权重单调收敛，最终归零', () => {
  let state = createAnimFsmState('walk', 0);
  state = advanceAnimFsm(state, 'idle', 100);
  state = advanceAnimFsm(state, 'work', 180);

  const sampleAt = (t: number): AnimSample => sampleAnimFsm(state, t);
  let lastWalk = weightOf(sampleAt(180), 'walk');
  let lastIdle = weightOf(sampleAt(180), 'idle');
  assert.ok(lastWalk > 0.4 && lastWalk < 0.5, `walk 残影应约 0.43，实得 ${lastWalk}`);
  assert.ok(lastIdle > 0.5 && lastIdle < 0.6, `idle 残影应约 0.57，实得 ${lastIdle}`);
  for (let t = 181; t <= 420; t += 1) {
    const sample = sampleAt(t);
    const walk = weightOf(sample, 'walk');
    const idle = weightOf(sample, 'idle');
    assert.ok(walk <= lastWalk + EPS, `t=${t} walk 残影回升了：${lastWalk} → ${walk}`);
    assert.ok(idle <= lastIdle + EPS, `t=${t} idle 残影回升了：${lastIdle} → ${idle}`);
    assert.ok(Math.abs(weightSum(sample) - 1) < EPS, `t=${t} 权重和不是 1`);
    lastWalk = walk;
    lastIdle = idle;
  }
  const settled = sampleAt(420);
  assert.deepEqual(layerStates(settled), ['work'], '420ms 后仍残留旧层');
  assert.equal(settled.layers[0].weight, 1);
});

test('极短时间内连续打断 A→B→C：权重连续、不跳变、最终收敛', () => {
  let state = createAnimFsmState('walk', 0);
  state = advanceAnimFsm(state, 'idle', 10);
  state = advanceAnimFsm(state, 'work', 20);

  const opening = sampleAnimFsm(state, 20);
  assert.ok(opening.layers.length >= 3, `A→B→C 至少三层，实得 ${opening.layers.length}`);
  assert.ok(opening.layers.length <= MAX_RESIDUAL_LAYERS + 1);
  assert.ok(Math.abs(weightSum(opening) - 1) < EPS);

  let previous = opening;
  for (let t = 21; t <= 1000; t += 1) {
    const sample = sampleAnimFsm(state, t);
    assert.ok(Math.abs(weightSum(sample) - 1) < EPS, `t=${t} 权重和不是 1`);
    for (const layer of sample.layers) {
      assert.ok(layer.weight >= -EPS && layer.weight <= 1 + EPS, `t=${t} ${layer.state} 权重越界`);
      const before = previous.layers.find((item) => item.state === layer.state);
      const beforeWeight = before === undefined ? 0 : before.weight;
      // 最长 1ms 内的变化不会超过 1/90（最短转移），留两倍余量。
      assert.ok(
        Math.abs(layer.weight - beforeWeight) <= 0.02,
        `t=${t} ${layer.state} 权重跳变：${beforeWeight} → ${layer.weight}`,
      );
    }
    previous = sample;
  }
  const settled = sampleAnimFsm(state, 1000);
  assert.deepEqual(layerStates(settled), ['work']);
  assert.equal(settled.layers[0].weight, 1);
});

test('同一意图重复触发不抖动：不重新开始过渡，残影继续单调衰减', () => {
  const settled = createAnimFsmState('walk', 0);
  let state = advanceAnimFsm(settled, 'idle', 10);
  const openingState = state;
  const opening = sampleAnimFsm(state, 10);
  assert.equal(opening.layers.length, 2);

  for (let t = 11; t <= 200; t += 1) {
    const before = state;
    state = advanceAnimFsm(state, 'idle', t);
    // 同一意图只允许「残影到期被剪掉」，不允许新增残影或重置计时。
    assert.equal(state.current, 'idle', `t=${t} 同一意图把状态改掉了`);
    assert.equal(state.enteredAtMs, before.enteredAtMs, `t=${t} 同一意图重置了进入时刻`);
    assert.ok(state.fades.length <= before.fades.length, `t=${t} 同一意图新增了残影`);
    for (const fade of state.fades) {
      assert.equal(fade.startedAtMs, 10, `t=${t} 残影计时被重置`);
    }
  }

  const mid = sampleAnimFsm(openingState, 120);
  assert.deepEqual(layerStates(mid), ['idle', 'walk']);
  assert.ok(Math.abs(weightSum(mid) - 1) < EPS);
  assert.ok(weightOf(mid, 'walk') > 0.1, '120ms 时 walk 残影应仍可见');
  // walk→idle 时长 140，150ms 时旧状态应已清空。
  const settledSample = sampleAnimFsm(openingState, 150);
  assert.deepEqual(layerStates(settledSample), ['idle']);
  assert.equal(weightOf(settledSample, 'walk'), 0);
});

test('纯函数：调用不修改入参，同一输入同一输出', () => {
  const state = createAnimFsmState('walk', 0);
  const snapshot = JSON.stringify(state);
  const moved = advanceAnimFsm(state, 'deliver', 500);
  assert.equal(JSON.stringify(state), snapshot, 'advanceAnimFsm 修改了入参');
  assert.deepEqual(moved, advanceAnimFsm(state, 'deliver', 500));

  const sampleA = sampleAnimFsm(moved, 700);
  const sampleB = sampleAnimFsm(state, 700);
  assert.equal(sampleA.layers.length, 1, '从 walk 直接采样不该出现残影');
  assert.equal(sampleB.layers.length, 1);
});

test('非有限时刻一律落到 0，不产生 NaN / 小数像素', () => {
  const state = createAnimFsmState('walk', Number.NaN);
  const sample = sampleAnimFsm(state, Number.NaN);
  assert.equal(sample.nowMs, 0);
  assert.equal(sample.offsetY, 0);
  assert.equal(sample.layers[0].frame, animFrameAt('walk', 0));
  assert.ok(Number.isInteger(sample.offsetY));
  const advanced = advanceAnimFsm(state, 'salute', Number.NaN);
  assert.deepEqual(advanced.fades[0]?.startedAtMs, 0);
});

test('所有状态、所有时刻的加权位移都是整数像素', () => {
  for (const state of ANIM_STATE_IDS) {
    const fsm = createAnimFsmState(state, 0);
    for (const now of [0, 47, 333, 1001, 123_456]) {
      const sample = sampleAnimFsm(fsm, now);
      assert.ok(Number.isInteger(sample.offsetY), `${state}@${now} 位移不是整数`);
      assert.ok(Object.is(sample.offsetY, sample.offsetY), `${state}@${now} 位移是 NaN`);
      assert.deepEqual(sample.anchor, { x: 0, y: 0 });
    }
  }
});

test('连续 20 次打断：残影层数有上限，权重和仍为 1', () => {
  let state = createAnimFsmState('walk', 0);
  const intents: AnimStateId[] = ['idle', 'work', 'deliver', 'salute', 'walk'];
  for (let index = 0; index < 20; index += 1) {
    state = advanceAnimFsm(state, intents[index % intents.length] as AnimStateId, index + 1);
    const sample = sampleAnimFsm(state, index + 1);
    assert.ok(
      sample.layers.length <= MAX_RESIDUAL_LAYERS + 1,
      `第 ${index + 1} 次打断后层数 ${sample.layers.length} 超过上限`,
    );
    assert.ok(Math.abs(weightSum(sample) - 1) < EPS, `第 ${index + 1} 次打断后权重和不是 1`);
  }
});

test('快照 mode/walking → 意图的映射覆盖全部 8 个 mode', () => {
  const modes: readonly VillagerMode[] = [
    'idle',
    'saluting',
    'toWork',
    'working',
    'delivering',
    'toAltar',
    'sheltering',
    'bearingDecree',
  ];
  for (const mode of modes) {
    assert.equal(animIntentOf(mode, true), mode === 'saluting'
      ? 'salute'
      : mode === 'working'
        ? 'work'
        : mode === 'delivering'
          ? 'deliver'
          : 'walk');
    assert.equal(animIntentOf(mode, false), mode === 'saluting'
      ? 'salute'
      : mode === 'working'
        ? 'work'
        : mode === 'delivering'
          ? 'deliver'
          : 'idle');
  }
});

test('文档就是生成函数的原文：状态图不会与代码分叉', () => {
  const doc = readFileSync(
    new URL('../../docs/animation/villager-anim-fsm.md', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n'); // Windows 检出会把生成文件转成 CRLF；比对前统一换行。
  assert.equal(doc, animGraphMarkdown(), '状态图文档过期：请跑 node scripts/export-anim-graph.ts');
  assert.ok(doc.includes('| idle |'), '文档里没有状态表');
  assert.ok(doc.includes('| walk | idle |'), '文档里没有转移表');
});

test('状态值可深拷贝、可跨引擎传递：只含字符串、数字与数组', () => {
  let state: AnimFsmState = createAnimFsmState('walk', 0);
  state = advanceAnimFsm(state, 'salute', 10);
  state = advanceAnimFsm(state, 'work', 20);
  const copy: AnimFsmState = JSON.parse(JSON.stringify(state)) as AnimFsmState;
  assert.deepEqual(copy, state);
  assert.deepEqual(sampleAnimFsm(copy, 50), sampleAnimFsm(state, 50));
});
} // if (fsm !== null)
