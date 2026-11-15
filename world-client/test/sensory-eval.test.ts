/**
 * 视听反馈与世界法则评分器防假绿自检单测
 * 放置路径建议：world-client/test/sensory-eval.test.ts
 * 运行方式：node --import tsx --test world-client/test/sensory-eval.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateRainShelterRule,
} from '../src/world/behavior-rules.ts';
import {
  stepOracleSalute,
} from '../src/render/fx-layer.ts';
import {
  VILLAGER_VOICE_PROFILES,
  computeAnimalesePitchSeries,
} from '../src/audio/animalese.ts';
import {
  ProceduralSfxEngine,
} from '../src/audio/sfx.ts';

test('EDD 防假绿 1：7 位村民声线配置唯一且音高序列 100% 确定性', () => {
  const ids = Object.keys(VILLAGER_VOICE_PROFILES);
  assert.equal(ids.length, 7, '必须完整覆盖 7 位村民声线');

  const signatures = new Set(
    ids.map((id) => {
      const p = VILLAGER_VOICE_PROFILES[id];
      return `${p.basePitch}:${p.wave}:${p.speedScale}`;
    })
  );
  assert.equal(signatures.size, 7, '7 位村民的声线参数组合不得重复');

  const seqA = computeAnimalesePitchSeries('v_elder', '神谕已至，全镇戒备');
  const seqB = computeAnimalesePitchSeries('v_elder', '神谕已至，全镇戒备');
  const seqOther = computeAnimalesePitchSeries('v_scout', '神谕已至，全镇戒备');

  assert.deepEqual(seqA, seqB, '同一角色相同文本音高序列必须完全一致');
  assert.notDeepEqual(seqA, seqOther, '不同角色相同文本音高序列必须体现差异');
});

test('EDD 防假绿 2：实时下雨躲雨规则受强制神谕优先级约束且确定性选址', () => {
  const buildings = [
    { id: 'b_far', door: { x: 20, y: 20 } },
    { id: 'b_near', door: { x: 5, y: 4 } },
  ];

  // 情况 A：户外且无强制神谕 -> 命中 rain-shelter 并选最近建筑
  const shelterResult = evaluateRainShelterRule({
    weather: 'rain',
    villager: { id: 'v_scout', pos: { x: 4, y: 4 }, isOutdoor: true, hasForcedOracle: false },
    buildings,
  });
  assert.equal(shelterResult.triggered, true);
  assert.equal(shelterResult.targetBuildingId, 'b_near');
  assert.deepEqual(shelterResult.targetDoor, { x: 5, y: 4 });

  // 情况 B：有强制神谕在身 -> 严禁被 rain-shelter 打断
  const oracleProtected = evaluateRainShelterRule({
    weather: 'rain',
    villager: { id: 'v_smith', pos: { x: 4, y: 4 }, isOutdoor: true, hasForcedOracle: true },
    buildings,
  });
  assert.equal(oracleProtected.triggered, false);
});

test('EDD 防假绿 3：神谕行礼必须按逻辑拍准确锁定 2 拍后释放寻路', () => {
  let state = { saluteTicksRemaining: 2, isSaluting: true, actionBobPhase: 0 };

  state = stepOracleSalute(state);
  assert.equal(state.saluteTicksRemaining, 1);
  assert.equal(state.isSaluting, true);

  state = stepOracleSalute(state);
  assert.equal(state.saluteTicksRemaining, 0);
  assert.equal(state.isSaluting, false);
});

test('EDD 防假绿 4：无头环境（无 AudioContext）下音效引擎必须零异常安全降级', () => {
  const sfx = new ProceduralSfxEngine(null);
  assert.doesNotThrow(() => {
    sfx.setRainAmbience(true);
    sfx.playOracleChime();
    sfx.playBuildComplete();
    sfx.playFootstep();
    sfx.setRainAmbience(false);
  });
  assert.equal(sfx.isHeadlessNoop(), true);
});

test('EDD 数据集契约检查：若已落盘 main.json / held-out.json，校验用例数量与 ID 唯一性', async (t) => {
  const evalDir = path.resolve(process.cwd(), 'world-client/eval/sensory');
  try {
    await fs.access(evalDir);
  } catch {
    t.skip('尚未将 main.json / held-out.json 落盘至 world-client/eval/sensory/');
    return;
  }

  const mainJson = JSON.parse(await fs.readFile(path.join(evalDir, 'main.json'), 'utf8'));
  const heldOutJson = JSON.parse(await fs.readFile(path.join(evalDir, 'held-out.json'), 'utf8'));
  assert.equal(mainJson.examples.length, 10);
  assert.equal(heldOutJson.examples.length, 6);

  const allIds = [...mainJson.examples, ...heldOutJson.examples].map((e) => e.id);
  assert.equal(new Set(allIds).size, 16, '主集与保留集用例 ID 不得重复');
});