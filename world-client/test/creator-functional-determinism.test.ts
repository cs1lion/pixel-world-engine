/** 造物确定性：同一基线 + 同一串操作，造物指纹逐位一致；换参数只动造物指纹。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CreatorHarness } from './fixtures/creator-functional.ts';
import { canonicalJson, sha256Hex } from '../src/trace/format.ts';
import { projectWorld } from '../src/trace/runtime.ts';
import type { CreationPlan } from '../src/world/creator-schema.ts';

interface ChainResult {
  readonly fingerprints: readonly string[];
  readonly proposalIds: readonly string[];
  readonly worldFingerprint: string;
  readonly memoryFingerprint: string;
  /** 便于失败时看出是哪一段分叉。 */
  readonly steps: readonly string[];
}

function changedPalette(plan: CreationPlan): CreationPlan {
  const slot = Object.keys(plan.palette)[0];
  assert.ok(slot !== undefined, '模板至少有一个配色槽');
  const current = Object.values(plan.palette)[0];
  assert.ok(current !== undefined, '配色槽应有已解析色值');
  const replacement = Object.values(plan.palette).find((value) => value !== current)
    ?? current + 1;
  const palette: Record<string, number> = { ...plan.palette };
  palette[slot] = replacement;
  return { ...plan, palette: palette as unknown as CreationPlan['palette'] };
}

async function runChain(changeOneParameter: boolean): Promise<ChainResult> {
  const h = new CreatorHarness();
  const steps: string[] = [];
  const proposalIds: string[] = [];
  const fingerprints: string[] = [];
  try {
    const proposed = h.engine.planCreation(h.view(0));
    assert.ok(proposed !== null, '开局应当缺一个模板');
    const plan = changeOneParameter ? changedPalette(proposed) : proposed;

    const first = await h.landManual(plan, 0);
    proposalIds.push(first.creation.recordId);
    steps.push('land-1');

    for (let index = 0; index < 7; index += 1) h.advanceDay();
    steps.push('observe-1');

    let demolished = h.demolishCommand(first.instanceId);
    if (!demolished.ok) {
      h.advanceDay();
      demolished = h.demolishCommand(first.instanceId);
    }
    assert.equal(demolished.ok, true, '真实拆除应成功');
    steps.push('demolish-1');

    const second = await h.landManual(plan, h.worldDay);
    proposalIds.push(second.creation.recordId);
    steps.push('land-2');

    for (let index = 0; index < 7; index += 1) h.advanceDay();
    steps.push('observe-2');

    for (const record of h.ledger.readAll()) {
      if (record.kind === 'creation' || record.kind === 'landing') {
        fingerprints.push(record.replay.fingerprint);
      }
    }

    return {
      fingerprints,
      proposalIds,
      steps,
      worldFingerprint: sha256Hex(canonicalJson(projectWorld(h.snapshot()))),
      memoryFingerprint: sha256Hex(canonicalJson(h.memory.toSnapshot())),
    };
  } finally {
    h.dispose();
  }
}

test('[确定性] 同一基线 + 同一串造物操作跑两遍：造物指纹逐位相同，世界与记忆指纹也相同', async (t) => {
  const first = await runChain(false);
  const second = await runChain(false);
  t.diagnostic(`steps=${first.steps.join('→')}`);
  assert.deepEqual(first.proposalIds, second.proposalIds, '同样的操作应生成同样的 proposalId');
  assert.deepEqual(first.fingerprints, second.fingerprints, '造物指纹必须逐位相同');
  assert.equal(first.fingerprints.length, 4, '两次造物 × creation/landing 各一条');
  assert.equal(first.worldFingerprint, second.worldFingerprint);
  assert.equal(first.memoryFingerprint, second.memoryFingerprint);
  assert.equal(first.worldFingerprint.length, 64);
  assert.equal(first.memoryFingerprint.length, 64);
});

test('[确定性] 只改一个提案色板参数：造物指纹全变，世界与记忆指纹不变', async (t) => {
  const baseline = await runChain(false);
  const changed = await runChain(true);
  t.diagnostic(
    `baseline=${baseline.fingerprints[0]?.slice(0, 12)} changed=${changed.fingerprints[0]?.slice(0, 12)}`,
  );
  assert.equal(baseline.fingerprints.length, changed.fingerprints.length);
  for (let index = 0; index < baseline.fingerprints.length; index += 1) {
    assert.notEqual(
      baseline.fingerprints[index],
      changed.fingerprints[index],
      `第 ${index + 1} 个造物指纹应随色板参数改变`,
    );
  }
  // 色板只存在于提案里；世界快照与记忆库都不该被它改动。
  assert.equal(baseline.worldFingerprint, changed.worldFingerprint);
  assert.equal(baseline.memoryFingerprint, changed.memoryFingerprint);
  // proposalId 也不该被配色参数带偏。
  assert.deepEqual(baseline.proposalIds, changed.proposalIds);
});
