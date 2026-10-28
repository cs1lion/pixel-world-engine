import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RuleSynthesizer,
  buildStructuredDiff,
  isSelfJustifying,
  type SynthesisContext,
} from '../src/world/creator/synthesizer.ts';
import type { PlaceBuildingCommand, SpawnCharacterCommand } from '../src/world/creator/schema.ts';

/**
 * 逆向审校合成器。
 *
 * 这组测试守的是一条很容易破掉的界线：**不猜意图**。
 * 从 diff 算得出来的（挪到河边 → 距河 ≤ N）可以自动固化；
 * 算不出来的（换了个颜色，为什么换？）只能记为待确认，绝不能当规则用。
 */

const workshop = (over: Partial<PlaceBuildingCommand> = {}): PlaceBuildingCommand => ({
  kind: 'PlaceBuilding',
  templateId: 'iron_workshop',
  at: { x: 10, y: 10 },
  ...over,
});

const withLandmarks = (): SynthesisContext => ({
  nearbyLandmarks: (at) => [
    { id: 'river', at: { x: at.x, y: at.y - 3 } },
    { id: 'far_tower', at: { x: at.x + 40, y: at.y + 40 } },
  ],
});

// ---------------------------------------------------------------- 挪到地标旁

test('挪到河边，合成的是到河的距离上限，而不是移动了几格', () => {
  const diff = buildStructuredDiff(workshop({ at: { x: 10, y: 10 } }), workshop({ at: { x: 10, y: 30 } }));
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, withLandmarks());

  assert.equal(result.patches.length, 1);
  const patch = result.patches[0];
  assert.equal(patch?.type, 'spatial_constraint');
  assert.equal((patch as { reference: string }).reference, 'river');
  // 地标在 at.y-3，最终位置 (10,30)，所以距离是 3——不是移动的 20 格。
  assert.equal((patch as { maxDistance: number }).maxDistance, 3);
});

test('几何约束可以自动固化', () => {
  const diff = buildStructuredDiff(workshop(), workshop({ at: { x: 10, y: 11 } }));
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, withLandmarks());

  assert.equal(result.autoApplicable.length, 1);
  assert.equal(result.needsIntent.length, 0);
  assert.equal(isSelfJustifying(result.autoApplicable[0]!), true);
});

test('查不到地标就不合成距离规则——不拿移动量凑数', () => {
  const diff = buildStructuredDiff(workshop(), workshop({ at: { x: 10, y: 30 } }));
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, {});

  assert.equal(result.patches.length, 0);
  assert.equal(result.regression, 'not_run');
});

// ---------------------------------------------------------------- 换配色

test('换了配色只记为待确认，不合成任何阈值', () => {
  const diff = buildStructuredDiff(
    workshop({ palette: { roof: 'cloak' } }),
    workshop({ palette: { roof: 'pale' } }),
  );
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, withLandmarks());

  assert.equal(result.patches.length, 1);
  const patch = result.patches[0]!;
  assert.equal(patch.type, 'art_quality');
  assert.equal(isSelfJustifying(patch), false, '配色偏好不能自作主张');
  assert.equal(result.autoApplicable.length, 0);
  assert.equal(result.needsIntent.length, 1);
});

test('被拒的配色补丁记的是真实的两个 token，不是编出来的数字', () => {
  const diff = buildStructuredDiff(
    workshop({ palette: { roof: 'cloak' } }),
    workshop({ palette: { roof: 'pale' } }),
  );
  const patch = new RuleSynthesizer().synthesizeFromDiff(diff, withLandmarks()).patches[0]!;

  assert.equal((patch as { rejectedToken: string }).rejectedToken, 'cloak');
  assert.equal((patch as { acceptedToken: string }).acceptedToken, 'pale');
  assert.equal((patch as { slot: string }).slot, 'roof');
});

// ---------------------------------------------------------------- 改名

test('改了角色名，记为禁用词候选，需人来补理由', () => {
  const a: SpawnCharacterCommand = {
    kind: 'SpawnCharacter',
    name: '张三',
    role: '铁匠',
    startingLocation: { x: 1, y: 1 },
  };
  const b: SpawnCharacterCommand = { ...a, name: '张铁' };

  const result = new RuleSynthesizer().synthesizeFromDiff(buildStructuredDiff(a, b));

  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]?.type, 'narrative_invariant');
  assert.equal(result.autoApplicable.length, 0);
});

test('改了职业，记给角色生成用的负样本', () => {
  const a: SpawnCharacterCommand = {
    kind: 'SpawnCharacter',
    name: '李四',
    role: '农夫',
    startingLocation: { x: 1, y: 1 },
  };
  const b: SpawnCharacterCommand = { ...a, role: '商人' };

  const result = new RuleSynthesizer().synthesizeFromDiff(buildStructuredDiff(a, b));

  assert.equal(result.patches[0]?.type, 'template_prompt');
});

// ---------------------------------------------------------------- 回归集

test('没配回归集是 not_run，不是通过', () => {
  const diff = buildStructuredDiff(workshop(), workshop({ at: { x: 10, y: 11 } }));
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, withLandmarks());

  assert.equal(result.regression, 'not_run');
  assert.match(result.regressionDetail ?? '', /没有配置回归集/);
});

test('回归集全绿才算 passed', () => {
  const diff = buildStructuredDiff(workshop(), workshop({ at: { x: 10, y: 11 } }));
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, {
    ...withLandmarks(),
    regressionSuite: {
      run: () => [
        { caseId: 'case-1', broken: false },
        { caseId: 'case-2', broken: false },
      ],
    },
  });

  assert.equal(result.regression, 'passed');
});

test('回归集被破坏时报 failed，并指名是哪几条用例', () => {
  const diff = buildStructuredDiff(workshop(), workshop({ at: { x: 10, y: 11 } }));
  const result = new RuleSynthesizer().synthesizeFromDiff(diff, {
    ...withLandmarks(),
    regressionSuite: {
      run: () => [
        { caseId: 'case-7', broken: true },
        { caseId: 'case-9', broken: false },
      ],
    },
  });

  assert.equal(result.regression, 'failed');
  assert.match(result.regressionDetail ?? '', /case-7/);
});

// ---------------------------------------------------------------- Diff 构造

test('只动了坐标是 moved，动了三处以上是 rejected', () => {
  assert.equal(
    buildStructuredDiff(workshop(), workshop({ at: { x: 1, y: 1 } })).diffType,
    'moved',
  );

  const a = workshop({ palette: { body: 'timber', roof: 'cloak' } });
  const b = workshop({ at: { x: 1, y: 1 }, templateId: 'tavern', palette: { body: 'soil' } });
  assert.equal(buildStructuredDiff(a, b).diffType, 'rejected');
});

test('kind 不同时点出 kind，而不是装作没变化', () => {
  const diff = buildStructuredDiff(workshop(), {
    kind: 'SpawnCharacter',
    name: '王五',
    role: '学者',
    startingLocation: { x: 1, y: 1 },
  });
  assert.deepEqual(diff.modificationPoints, ['kind']);
});

test('调色板每一处改动都单独记一个字段路径', () => {
  const diff = buildStructuredDiff(
    workshop({ palette: { body: 'timber', roof: 'cloak' } }),
    workshop({ palette: { body: 'soil', roof: 'cloak' } }),
  );
  assert.deepEqual(diff.modificationPoints, ['palette.body']);
});

// ---------------------------------------------------------------- 空 diff

test('什么都没改时不合成任何东西', () => {
  const result = new RuleSynthesizer().synthesizeFromDiff(buildStructuredDiff(workshop(), workshop()));

  assert.equal(result.patches.length, 0);
  assert.equal(result.regression, 'not_run');
});
