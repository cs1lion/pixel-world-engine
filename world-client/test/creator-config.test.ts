import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTONOMY_CLIMB_CONFIG,
  DIRECTOR_PID_CONFIG,
  FUSE_THRESHOLD_CONFIG,
  MEMORY_PROTOCOL_CONFIG,
  PROPAGATION_CHANNEL_CONFIG,
} from '../src/world/creator/config.ts';
import { DIRECTOR_CONFIG } from '../src/world/director.ts';
import { DAY_MS, DEFAULT_MEMORY_CONFIG as MEMORY_CONFIG } from '../src/world/memory/config.ts';

/**
 * v1.0 第 3.3 节的定稿表落地了吗。
 *
 * 这组测试的价值不在"断言一个常量等于它自己"，而在**把文档里的数字钉在代码上**：
 * 谁把 0.95 改成 0.9，这里会红，而且红的时候能看出是哪一条门禁被放松了。
 */

// ---------------------------------------------------------------- 七项能力的爬梯

test('设定理解：L1 → L2，门禁三项', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.SETTING_UNDERSTANDING;
  assert.equal(cfg.startLevel, 1);
  assert.equal(cfg.targetLevel, 2);
  assert.equal(cfg.metrics.schemaPassRate, 1);
  assert.equal(cfg.metrics.conflictCount, 0);
  assert.equal(cfg.metrics.coverageRate, 0.95);
});

test('布局与建筑：L2 → L3，门禁三项', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.LAYOUT_AND_BUILDING;
  assert.equal(cfg.startLevel, 2);
  assert.equal(cfg.targetLevel, 3);
  assert.equal(cfg.metrics.pathfindingConnectedRate, 1);
  assert.equal(cfg.metrics.collisionRate, 0);
  assert.equal(cfg.metrics.constraintSatisfactionRate, 1);
});

test('历史 / 关系 / 记忆：L2 → L4，门禁含溯源与回放', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.HISTORY_RELATIONS_MEMORY;
  assert.equal(cfg.startLevel, 2);
  assert.equal(cfg.targetLevel, 4);
  assert.equal(cfg.metrics.traceabilityRate, 1);
  assert.equal(cfg.metrics.relationSymmetryRate, 1);
  assert.equal(cfg.metrics.replayHashConsistencyRate, 1);
});

test('静态美术：L1 → L2，剪影 IoU 上限 0.75', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.STATIC_ART;
  assert.equal(cfg.startLevel, 1);
  assert.equal(cfg.targetLevel, 2);
  assert.equal(cfg.metrics.gridAlignmentRate, 1);
  assert.equal(cfg.metrics.colorPaletteBleedRate, 0);
  assert.ok(cfg.metrics.silhouetteIoUCap <= 0.75);
});

test('动画：L0 → L1，走模块化骨架而不是序列帧', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.ANIMATION;
  assert.equal(cfg.startLevel, 0);
  assert.equal(cfg.targetLevel, 1);
  assert.equal(cfg.metrics.usesModularSkeleton, true);
  assert.ok(cfg.metrics.frameToFrameCentroidShiftCap <= 1);
});

test('导演运行：L1 → L2，情绪健康区间 [-0.3, +0.6] 且要连续 7 天', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.DIRECTOR_RUNNING;
  assert.equal(cfg.startLevel, 1);
  assert.equal(cfg.targetLevel, 2);
  assert.equal(cfg.metrics.invariantViolationCount, 0);
  assert.equal(cfg.metrics.valenceHealthyRange.min, -0.3);
  assert.equal(cfg.metrics.valenceHealthyRange.max, 0.6);
  assert.equal(cfg.metrics.consecutiveDaysRequired, 7);
});

test('通用性：L0 → L2，换设定包时内核改行数必须是 0', () => {
  const cfg = AUTONOMY_CLIMB_CONFIG.GENERALIZATION;
  assert.equal(cfg.startLevel, 0);
  assert.equal(cfg.targetLevel, 2);
  assert.equal(cfg.metrics.codeModificationLinesOnSwitch, 0);
});

test('七项能力，一项不少', () => {
  assert.equal(Object.keys(AUTONOMY_CLIMB_CONFIG).length, 7);
});

// ---------------------------------------------------------------- 熔断阈值

test('升级：连续 3 批 / 14 天，通过率 ≥98%，人工修改 ≤2%', () => {
  assert.equal(FUSE_THRESHOLD_CONFIG.climbRequiredBatches, 3);
  assert.equal(FUSE_THRESHOLD_CONFIG.climbRequiredDays, 14);
  assert.equal(FUSE_THRESHOLD_CONFIG.autoCheckPassRateThreshold, 0.98);
  assert.equal(FUSE_THRESHOLD_CONFIG.manualModificationRateThreshold, 0.02);
});

test('降级：拒绝率 >10%、或不变式违反 ≥1 次、或一次回滚', () => {
  assert.equal(FUSE_THRESHOLD_CONFIG.summaryRejectionRateThreshold, 0.1);
  assert.equal(FUSE_THRESHOLD_CONFIG.invariantViolationTriggerCount, 1);
  assert.equal(FUSE_THRESHOLD_CONFIG.rollbackTriggerOnce, 1);
});

test('降级后有 7 天冷却', () => {
  assert.equal(FUSE_THRESHOLD_CONFIG.cooldownDaysAfterDowngrade, 7);
});

// ---------------------------------------------------------------- 导演 PID

test('导演的四个阈值与 §2.3 的注入规则一致', () => {
  assert.equal(DIRECTOR_PID_CONFIG.arousalDeathThreshold, 0.25);
  assert.equal(DIRECTOR_PID_CONFIG.valenceLowThreshold, -0.45);
  assert.equal(DIRECTOR_PID_CONFIG.valenceHealthyMin, -0.3);
  assert.equal(DIRECTOR_PID_CONFIG.valenceHealthyMax, 0.6);
});

test('规范没给的调参项不在配置里——写在配置里却没读，比不写更糟', () => {
  // `maxInjectionsPerDay` / `eventCooldownDays` / `consecutiveDaysTrigger`
  // 都曾经在这里，v1.0 找不到出处，`director.ts` 也一次都没读过。
  const keys = Object.keys(DIRECTOR_PID_CONFIG);
  assert.ok(!keys.includes('maxInjectionsPerDay'));
  assert.ok(!keys.includes('eventCooldownDays'));
  assert.ok(!keys.includes('consecutiveDaysTrigger'));
});

test('健康判定要连续 7 天，与 §3.3 一致', () => {
  assert.equal(DIRECTOR_PID_CONFIG.healthyConsecutiveDays, 7);
});

test('情绪健康区间与爬梯表里导演那一行是同一个区间', () => {
  const climb = AUTONOMY_CLIMB_CONFIG.DIRECTOR_RUNNING.metrics.valenceHealthyRange;
  assert.equal(DIRECTOR_PID_CONFIG.valenceHealthyMin, climb.min);
  assert.equal(DIRECTOR_PID_CONFIG.valenceHealthyMax, climb.max);
});

test('连续天数也与爬梯表一致', () => {
  assert.equal(
    DIRECTOR_PID_CONFIG.healthyConsecutiveDays,
    AUTONOMY_CLIMB_CONFIG.DIRECTOR_RUNNING.metrics.consecutiveDaysRequired,
  );
});

test('运营配置与运行时实现里的数字不许分叉——两份清单会漂', () => {
  // `director.ts` 里有自己的一份 `DIRECTOR_CONFIG`，配置这里又有一份。
  // 两份手抄的阈值必然漂（本仓库已有先例：`date` 改名 `clock` 漏改一处）。
  // 这条测试把两份钉在一起，谁改一边都会红。
  assert.equal(DIRECTOR_PID_CONFIG.valenceHealthyMin, DIRECTOR_CONFIG.VALENCE_HEALTHY_MIN);
  assert.equal(DIRECTOR_PID_CONFIG.valenceHealthyMax, DIRECTOR_CONFIG.VALENCE_HEALTHY_MAX);
  assert.equal(DIRECTOR_PID_CONFIG.arousalDeathThreshold, DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD);
  assert.equal(DIRECTOR_PID_CONFIG.valenceLowThreshold, DIRECTOR_CONFIG.VALENCE_LOW_THRESHOLD);
  assert.equal(
    DIRECTOR_PID_CONFIG.healthyConsecutiveDays,
    DIRECTOR_CONFIG.HEALTHY_CONSECUTIVE_DAYS,
  );
});

// ---------------------------------------------------------------- 记忆协议（下游黑盒参考）

test('一个世界日是 24 世界小时，与内环的 DAY_MS 是同一个长度', () => {
  // README 问题 8 已裁定：v1.0 的 900 按 86400 读，`DAY_MS` 不变。
  // 这里曾经抄成 900 并注释「常态 15 分钟」——同一份代码里一天既是
  // 900 秒又是 86400 秒，「连续 14 个 world_day」的长度因此没有定义。
  assert.equal(MEMORY_PROTOCOL_CONFIG.dayLengthSeconds, 86_400);
  assert.equal(MEMORY_PROTOCOL_CONFIG.dayLengthSeconds * 1000, DAY_MS);
});

test('显著度四项权重加起来是 1', () => {
  const w = MEMORY_PROTOCOL_CONFIG.salienceWeights;
  assert.ok(Math.abs(w.emotion + w.surprise + w.goalRelevance + w.involvement - 1) < 1e-9);
});

test('三层阈值递增：写入 < 晋升 < 闪光灯', () => {
  assert.ok(MEMORY_PROTOCOL_CONFIG.T_write < MEMORY_PROTOCOL_CONFIG.T_promote);
  assert.ok(MEMORY_PROTOCOL_CONFIG.T_promote < MEMORY_PROTOCOL_CONFIG.T_flash);
});

test('检索五维权重加起来是 1', () => {
  const w = MEMORY_PROTOCOL_CONFIG.recallWeights;
  const sum = w.recency + w.salience + w.relevance + w.clue + w.relationship;
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('传说门槛：5 个持有者、存活 3 天', () => {
  assert.equal(MEMORY_PROTOCOL_CONFIG.legendRequirements.holders, 5);
  assert.equal(MEMORY_PROTOCOL_CONFIG.legendRequirements.days, 3);
});

// ---------------------------------------------------------------- 传播通道

test('每次交谈最多传 2 条，每天最多扇出 3 人，最多 3 跳', () => {
  assert.equal(PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.topicsPerChat, 2);
  assert.equal(PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.maxFanout, 3);
  assert.equal(PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.maxHops, 3);
});

test('同一对的冷却与整体闲聊冷却是两条不同的护栏，没有合成一条', () => {
  // §3.2 B：「1 个 world_day（日常闲聊整体冷却为 0.25 day）」。
  // 括号里是另一条参数。这里曾只抄了括号里的 0.25，把「同一对」写成了
  // 「整体」——两条护栏合成一条，而且取的是松的那个。
  const b = PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics;
  assert.equal(b.pairCooldownDays, 1);
  assert.equal(b.chatCooldownDays, 0.25);
});

test('creator 侧的传播参数与内环真实实现一致——两份手抄会漂', () => {
  const b = PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics;
  assert.equal(b.maxFanout, MEMORY_CONFIG.maxFanout);
  assert.equal(b.maxHops, MEMORY_CONFIG.maxHops);
  assert.equal(b.pairCooldownDays, MEMORY_CONFIG.pairCooldownDays);
  assert.equal(b.chatCooldownDays, MEMORY_CONFIG.chatCooldownDays);
  assert.equal(b.fidelityDecayPerHop.confidenceDecayFactor, MEMORY_CONFIG.hopConfidenceFactor);
  assert.equal(b.fidelityDecayPerHop.valenceMultiplier, MEMORY_CONFIG.hopValenceGain);
});

test('每跳 confidence × 0.8', () => {
  assert.equal(
    PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.fidelityDecayPerHop.confidenceDecayFactor,
    0.8,
  );
});

test('覆盖率曲线：第一天不许全知（≤35%），第三天稳态 60%-80%', () => {
  const curve = PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.metrics.coverageCurve;
  assert.equal(curve.day1EndMax, 0.35);
  assert.equal(curve.day3EndSteadyState.min, 0.6);
  assert.equal(curve.day3EndSteadyState.max, 0.8);
});

test('保真度随跳数严格递减到 0', () => {
  const f = PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.metrics.fidelityCurve;
  assert.deepEqual([f.hop0, f.hop1, f.hop2, f.hop3], [3, 2, 1, 0]);
});

test('传播路径 0 次模型调用——这是内环的成本红线', () => {
  assert.equal(
    PROPAGATION_CHANNEL_CONFIG.barriersAndMetrics.metrics.dailyPropagationCost.llmCalls,
    0,
  );
});
