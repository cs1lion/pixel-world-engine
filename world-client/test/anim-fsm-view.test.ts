/**
 * 动画状态机接入渲染（第二版，`?animfsm=1` 开关）的迁移测试。
 *
 * 三条地基，先红后绿：
 *   1. 开关关闭 = 不接管：`?animfsm` 缺省时计划里没有层、没有 FSM 状态，
 *      旧路径的帧号原样透传（开关不改变今天的任何一帧）。
 *   2. 开关打开 = 接管：稳态（单个状态、权重 1、无残影）画出来的姿态与
 *      `villagerPose` 逐字段相同——接管不等于改画面。
 *   3. 过渡期权重和恒为 1；目标状态是当前层。
 *
 * 实现文件在 base 上不存在。用动态 import 把「缺实现」变成 `AssertionError`
 * （red-first 只认断言失败；`ERR_MODULE_NOT_FOUND` 会被判成「测试没跑起来」）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnimFsmState } from '../src/animation/villager-anim-fsm.ts';
import { villagerPose } from '../src/render/villager-frames.ts';
import type { VillagerMode } from '../src/world/types.ts';

type ViewModule = typeof import('../src/animation/villager-anim-fsm-view.ts');
const view: ViewModule | null = await import('../src/animation/villager-anim-fsm-view.ts').catch(
  () => null,
);

/** 全部 8 个 mode；`animIntentOf` 只认 saluting/working/delivering 三个特例。 */
const ALL_MODES: readonly VillagerMode[] = [
  'idle',
  'saluting',
  'toWork',
  'working',
  'delivering',
  'toAltar',
  'sheltering',
  'bearingDecree',
];

test('1. 开关关闭 = 不接管：缺省 ?animfsm 不产生任何层与状态', () => {
  const m = view;
  assert.ok(m, '缺少接入渲染实现：src/animation/villager-anim-fsm-view.ts');

  // 开关解析：只有 `?animfsm` / `?animfsm=1` 算开；其余一律关。
  assert.equal(m.animFsmEnabledOf(''), false);
  assert.equal(m.animFsmEnabledOf('?debug=1&ledger=off'), false);
  assert.equal(m.animFsmEnabledOf('?animfsm=0'), false);
  assert.equal(m.animFsmEnabledOf('?animfsm=1'), true);
  assert.equal(m.animFsmEnabledOf('?animfsm'), true);
  const params = new URLSearchParams('?world=dengchao&animfsm=1');
  assert.equal(m.animFsmEnabledOf(params), true);

  // 关闭时，钉子怎么写都不进 FSM：帧号原样交给旧路径，层与状态恒为空。
  for (const mode of ALL_MODES) {
    for (const walking of [false, true]) {
      for (const pinnedFrame of [null, 0, 3]) {
        for (const settled of [null, true, false]) {
          const plan = m.villagerDrawPlanOf({
            enabled: false,
            mode,
            walking,
            nowMs: 1234,
            pinnedFrame,
            settled,
            prev: null,
          });
          assert.equal(plan.source, 'legacy', `${mode}/${walking}/${pinnedFrame}/${settled}`);
          assert.equal(plan.frame, pinnedFrame, '关闭时旧路径的帧号必须原样透传');
          assert.deepEqual(plan.layers, [], '关闭时不许算层');
          assert.equal(plan.state, null, '关闭时不许推进 FSM 状态');
        }
      }
    }
  }
});

test('2. 开关打开 = 接管：稳态输出与今天的最终帧逐字段相同', () => {
  const m = view;
  assert.ok(m, '缺少接入渲染实现：src/animation/villager-anim-fsm-view.ts');

  // 第一帧就是稳态：直接从意图起，没有淡入残影。
  for (const mode of ALL_MODES) {
    for (const walking of [false, true]) {
      for (const nowMs of [0, 83, 100, 1234.5, 99999]) {
        const plan = m.villagerDrawPlanOf({
          enabled: true,
          mode,
          walking,
          nowMs,
          pinnedFrame: null,
          settled: null,
          prev: null,
        });
        assert.equal(plan.source, 'fsm', '开关打开且无稳态钉时必须接管');
        assert.equal(plan.layers.length, 1, `${mode}/${walking}/${nowMs}`);
        const layer = plan.layers[0] as (typeof plan.layers)[number];
        assert.equal(layer.weight, 1);
        // 这就是「接管不改画面」：与旧路径同一 mode/walking/时刻的结果逐字段相同。
        assert.deepEqual(layer.pose, villagerPose(mode, walking, nowMs));
        assert.equal(plan.offsetY, layer.pose.offsetY);
      }
    }
  }

  // 稳态钉：显式钉住帧号且 settled（缺省）时，走旧路径的按帧取姿态。
  const pinned = m.villagerDrawPlanOf({
    enabled: true,
    mode: 'saluting',
    walking: false,
    nowMs: 1234,
    pinnedFrame: 0,
    settled: null,
    prev: null,
  });
  assert.equal(pinned.source, 'settled', '缺省 settled=true：稳态钉不该被过渡混合');
  assert.equal(pinned.frame, 0);
  assert.deepEqual(pinned.layers, []);

  // 显式 settled:false = 接受过渡：交给 FSM。
  const live = m.villagerDrawPlanOf({
    enabled: true,
    mode: 'saluting',
    walking: false,
    nowMs: 1234,
    pinnedFrame: 0,
    settled: false,
    prev: null,
  });
  assert.equal(live.source, 'fsm');
});

test('3. 过渡期权重和 ≈ 1；目标状态是当前层（最重的一层在过半后是它）', () => {
  const m = view;
  assert.ok(m, '缺少接入渲染实现：src/animation/villager-anim-fsm-view.ts');

  const options = {
    enabled: true,
    walking: false,
    pinnedFrame: null,
    settled: null,
  } as const;
  // t=0 起于 idle（稳态），同一时刻意图切到 working。
  const start = m.villagerDrawPlanOf({ ...options, mode: 'idle', nowMs: 0, prev: null });
  assert.equal(start.source, 'fsm');
  const idleState = start.state as AnimFsmState;
  assert.equal(start.layers.length, 1);

  let prev: AnimFsmState | null = idleState;
  const timeline: readonly number[] = [0, 40, 74, 75, 76, 120, 149, 150, 400];
  for (const nowMs of timeline) {
    const plan = m.villagerDrawPlanOf({ ...options, mode: 'working', nowMs, prev });
    assert.equal(plan.source, 'fsm');
    prev = plan.state;
    const layers = plan.layers;
    const sum = layers.reduce((acc, layer) => acc + layer.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `t=${nowMs} 权重和=${sum}`);
    // 当前层永远在第一位，且就是目标状态。
    assert.equal(layers[0]?.state, 'work', `t=${nowMs} 当前层必须是目标状态`);

    const heaviest = layers.reduce((acc, layer) => (layer.weight > acc.weight ? layer : acc));
    if (nowMs >= 75) {
      // 交叉淡入的数学事实：t=0 时旧状态权重 1、新状态 0，二者对称于半程。
      // 所以「最重的是目标」只能在过半后成立——写成 t≥半程，不写成「任意时刻」。
      assert.equal(heaviest.state, 'work', `t=${nowMs} 过半后最重的一层应是目标`);
    } else if (nowMs === 0) {
      assert.equal(heaviest.state, 'idle', 't=0 时画面仍是旧状态');
    }
  }

  // 150ms（idle→work 的设计时长）之后收敛回单层权重 1。
  const settled = m.villagerDrawPlanOf({ ...options, mode: 'working', nowMs: 400, prev });
  assert.equal(settled.layers.length, 1);
  assert.equal((settled.layers[0] as (typeof settled.layers)[number]).weight, 1);
});
