import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DirectorEngine, DIRECTOR_CONFIG, type WorldVitalsSnapshot } from '../src/world/director.ts';
import { DIRECTOR_EVENT_KINDS } from '../src/world/creator/schema.ts';

/**
 * 导演只吃四个标量。
 *
 * 这组测试守的是接口形状：`processDayClosed` 的入参只有 WorldVitalsSnapshot
 * 四个字段——导演拿不到事件日志，也就没法自己编剧情，只能按 §2.3 的规则
 * 从白名单里挑一个事件注入。
 */

const SEED = 'world-001';

const vitals = (over: Partial<WorldVitalsSnapshot> = {}): WorldVitalsSnapshot => ({
  meanValence: 0.1,
  meanArousal: 0.5,
  infoEntropy: 1,
  isolatedHoldersCount: 1,
  ...over,
});

const freshDirector = (): DirectorEngine => {
  const d = new DirectorEngine();
  d.initialize(SEED, 1);
  return d;
};

// ---------------------------------------------------------------- 健康时闭嘴

test('世界状态健康时导演什么都不注入', () => {
  const decision = freshDirector().processDayClosed(SEED, vitals());

  assert.equal(decision.shouldInject, false);
  assert.equal(decision.priority, 'low');
  assert.match(decision.reasoning, /健康/);
});

test('导演从不自行加快反应：一天只处理一次 DayClosed', () => {
  const d = freshDirector();
  const first = d.processDayClosed(SEED, vitals());
  assert.equal(first.shouldInject, false);
  // 同样的快照再喂一次不会让它突然改主意——没有跨天累积就没有干预。
  const second = d.processDayClosed(SEED, vitals());
  assert.equal(second.shouldInject, false);
});

// ---------------------------------------------------------------- 死寂

test('唤醒度太低时注入访客或天气异常', () => {
  const decision = freshDirector().processDayClosed(SEED, vitals({ meanArousal: 0.15 }));

  assert.equal(decision.shouldInject, true);
  assert.ok(['visitor_arrival', 'weather_anomaly'].includes(decision.eventKind!));
  assert.equal(decision.priority, 'medium');
  assert.equal(decision.requiresHumanReview, false);
});

test('唤醒度刚好在阈值上不算死寂', () => {
  const decision = freshDirector().processDayClosed(
    SEED,
    vitals({ meanArousal: DIRECTOR_CONFIG.AROUSAL_DEATH_THRESHOLD }),
  );
  assert.equal(decision.shouldInject, false);
});

// ---------------------------------------------------------------- 情绪低迷

test('情绪严重低迷时注入酒馆宴会，且必须人工确认', () => {
  const decision = freshDirector().processDayClosed(SEED, vitals({ meanValence: -0.6 }));

  assert.equal(decision.shouldInject, true);
  assert.equal(decision.eventKind, 'tavern_feast');
  assert.equal(decision.priority, 'high');
  assert.equal(decision.requiresHumanReview, true);
});

test('情绪刚好在阈值上不触发宴会——严格小于才算数', () => {
  // -0.45 是宴会的触发线（严格小于）。刚好落在线上不注射，
  // 也不降到别的规则：§2.3 只有那两条，没有「轻度提振」这一档。
  const decision = freshDirector().processDayClosed(
    SEED,
    vitals({ meanValence: DIRECTOR_CONFIG.VALENCE_LOW_THRESHOLD }),
  );
  assert.notEqual(decision.eventKind, 'tavern_feast');
  assert.equal(decision.shouldInject, false);
  assert.equal(decision.priority, 'low');
  assert.equal(decision.requiresHumanReview, false);
});

// ---------------------------------------------------------------- 信息失控与孤岛

// ---------------------------------------------------------------- 只有两条注入规则

/**
 * v1.0 §2.3 只定义了**两条**注入规则（arousal、valence）。
 * 这份实现曾经自行加了 `infoEntropy > 2.5` 与 `isolatedHoldersCount > 3`，
 * 两个阈值都是编的。前者更糟——`memory/vitals.ts` 的 `entropyOf` 用
 * `Math.min(1, ...)` 封顶，值域是 [0, 1]，2.5 这条**永远不可能触发**。
 * 下面三条测试守的就是「别偷偷加规则、别偷偷收观察量为处方」。
 */
test('信息熵再高也不单独触发注入——规范里没有这条规则', () => {
  const decision = freshDirector().processDayClosed(
    SEED,
    vitals({ infoEntropy: 1 }),  // 真实值域的上限
  );

  assert.equal(decision.shouldInject, false);
  assert.equal(decision.eventKind, undefined);
});

test('孤岛单位再多也不单独触发注入', () => {
  const decision = freshDirector().processDayClosed(
    SEED,
    vitals({ isolatedHoldersCount: 99 }),
  );

  assert.equal(decision.shouldInject, false);
  assert.equal(decision.eventKind, undefined);
});

test('两个观察量仍然出现在决策理由里——它们不是被删了，只是不当处方', () => {
  const decision = freshDirector().processDayClosed(
    SEED,
    vitals({ infoEntropy: 0.4, isolatedHoldersCount: 3 }),
  );
  assert.match(decision.reasoning, /信息熵 0\.400/);
  assert.match(decision.reasoning, /孤立单位 3/);
});

// ---------------------------------------------------------------- 注入的一定是白名单里的

test('导演挑出来的每一种事件都在 InjectEvent 白名单里', () => {
  const scenarios: WorldVitalsSnapshot[] = [
    vitals({ meanArousal: 0.1 }),
    vitals({ meanValence: -0.7 }),
    vitals({ infoEntropy: 4 }),
    vitals({ isolatedHoldersCount: 8 }),
    vitals({ meanValence: -0.35 }),
  ];

  for (const v of scenarios) {
    const decision = freshDirector().processDayClosed(SEED, v);
    if (decision.shouldInject) {
      assert.ok(
        (DIRECTOR_EVENT_KINDS as readonly string[]).includes(decision.eventKind!),
        `${decision.eventKind} 不在导演白名单里`,
      );
    }
  }
});

// ---------------------------------------------------------------- 滑动窗口

test('历史只保留最近 7 天', () => {
  const d = freshDirector();
  for (let day = 0; day < 12; day++) {
    d.processDayClosed(SEED, vitals({ meanValence: day % 2 === 0 ? 0.1 : -0.1 }));
  }

  const health = d.getEmotionalHealthStatus(SEED);
  assert.equal(health.daysOutOfHealthRange, 0, '健康的 12 天不该被记成超区间');
});

test('连续 7 天都在区间内才算健康', () => {
  const d = freshDirector();
  for (let day = 0; day < 7; day++) {
    d.processDayClosed(SEED, vitals({ meanValence: 0.1 }));
  }

  assert.equal(d.getEmotionalHealthStatus(SEED).healthy, true);
});

test('数据不满 7 天就不给健康结论——「还不知道」不是「健康」', () => {
  const d = freshDirector();
  for (let day = 0; day < 6; day++) {
    d.processDayClosed(SEED, vitals({ meanValence: 0.1 }));
  }

  // §3.3 要求的是「连续 7 天」。六天全绿不构成七天全绿。
  assert.equal(d.getEmotionalHealthStatus(SEED).healthy, false);
});

test('有一天出界就不算连续 7 天健康——原文没有「允许一天」这条例外', () => {
  const d = freshDirector();
  d.processDayClosed(SEED, vitals({ meanValence: 0.1 }));
  d.processDayClosed(SEED, vitals({ meanValence: 0.9 })); // 出界
  for (let day = 0; day < 6; day++) {
    d.processDayClosed(SEED, vitals({ meanValence: 0.1 }));
  }

  const health = d.getEmotionalHealthStatus(SEED);
  assert.equal(health.healthy, false);
  assert.equal(health.daysOutOfHealthRange, 1);
});

test('连续 7 天都超区间判定为不健康', () => {
  const d = freshDirector();
  for (let day = 0; day < 7; day++) {
    d.processDayClosed(SEED, vitals({ meanValence: 0.9 }));
  }

  const health = d.getEmotionalHealthStatus(SEED);
  assert.equal(health.healthy, false);
});

test('情绪低迷时建议提振效价，死寂时建议提高唤醒', () => {
  const d1 = freshDirector();
  d1.processDayClosed(SEED, vitals({ meanValence: -0.8 }));
  assert.equal(d1.getEmotionalHealthStatus(SEED).recommendedAction, 'boost_valence');

  const d2 = freshDirector();
  d2.processDayClosed(SEED, vitals({ meanValence: 0.1, meanArousal: 0.05 }));
  assert.equal(d2.getEmotionalHealthStatus(SEED).recommendedAction, 'increase_arousal');
});

// ---------------------------------------------------------------- 注入队列

test('注入的事件进队列，处理完之后能清空', () => {
  const d = freshDirector();
  d.processDayClosed(SEED, vitals({ meanValence: -0.7 }));

  assert.ok(d.getInjectionQueue(SEED).length > 0);
  d.clearProcessedQueue(SEED);
  assert.equal(d.getInjectionQueue(SEED).length, 0);
});

test('没初始化过的世界会自动初始化，而不是崩掉', () => {
  const d = new DirectorEngine();
  assert.doesNotThrow(() => d.processDayClosed('never-seen', vitals()));
});

test('未知世界的健康度查询给出保守答案：不健康，零证据', () => {
  const d = new DirectorEngine();
  const health = d.getEmotionalHealthStatus('never-seen');
  // 一天数据都没有的世界不能报健康——那等于白送一个免审资格。
  assert.equal(health.healthy, false);
  assert.equal(health.daysOutOfHealthRange, 0);
});

test('同一份快照两次跑出同一个事件——回放要能一致', () => {
  const outcomes = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const d = freshDirector();
    const decision = d.processDayClosed(SEED, vitals({ meanArousal: 0.1 }));
    outcomes.add(decision.eventKind!);
  }

  // 曾经用 Math.random 在两者间挑，同输入能出两种结果——
  // 而「同种子回放哈希一致」是 L4 的硬门禁。
  assert.equal(outcomes.size, 1, `同输入出了 ${outcomes.size} 种结果：${[...outcomes]}`);
});

test('不同的世界种子可以挑到不同的事件——确定性不等于永远同一个', () => {
  const kinds = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const d = new DirectorEngine();
    d.initialize(`seed-${i}`, 1);
    kinds.add(d.processDayClosed(`seed-${i}`, vitals({ meanArousal: 0.1 })).eventKind!);
  }
  assert.ok(kinds.size > 1, '如果 40 个种子全挑同一个事件，那这个「选择」没有意义');
});
