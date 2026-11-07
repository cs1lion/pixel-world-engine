import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 读数来源必须诚实：拿不到 `debugSettingScale` 实测值时判红，不许退回基线常量。
 * 两种「拿不到」必须能分开——环境没钩子报「环境不支持」，钩子在但读数异常报
 * 「读数非法」并带实际值。这里钉判定本身；真实退出码由
 * `test/fixtures/setting-scale-hook-probe.mjs` 用桩页 + 真脚本端到端复现。
 *
 * `check-types` 的 `include` 只到 `test/`，不认 `scripts/lib/*.mjs` 的类型；
 * 沿用 `tree-identity.test.ts` 的形状：动态 import + `as unknown as`，先断言导出存在。
 */

interface ProbeInput {
  status: 'missing' | 'throw' | 'value';
  detail?: string;
  value?: unknown;
}

interface ProbeVerdict {
  ok: boolean;
  code: string;
  message: string;
  metrics: Record<string, number> | null;
  source: string;
  declared?: boolean;
  fromBaselineConstant?: boolean;
}

interface ProbeModule {
  MEASURED_SOURCE: string;
  BASELINE_SOURCE: string;
  BASELINE_ANNOTATION: string;
  judgeSettingScaleProbe(probe: ProbeInput, options?: { label?: string }): ProbeVerdict;
  assertMeasuredReading(json: unknown, options?: { label?: string }): Record<string, number>;
  isMeasuredReading(json: unknown): boolean;
  isBaselineConstantShot(json: unknown): boolean;
  readShotForComposite(
    json: unknown,
    options?: { label?: string },
  ): { scale: Record<string, number>; annotation: string | null; fromBaselineConstant: boolean };
}

const MODULE_PATH = new URL('../scripts/lib/setting-scale-probe.mjs', import.meta.url).href;

async function load(): Promise<ProbeModule> {
  return (await import(MODULE_PATH)) as unknown as ProbeModule;
}

const VALID = { personH: 30, shopfrontH: 48, shopfrontTop: 16, lampPostH: 58, lampBodyBottom: 43 };

test('无钩子（环境不支持）→ 判红，且说的是「环境不支持」而不是「读数非法」', async () => {
  const { judgeSettingScaleProbe } = await load();
  const verdict = judgeSettingScaleProbe(
    { status: 'missing', detail: 'window.Oracle.debugSettingScale 不是函数（typeof=undefined）' },
    { label: 'after' },
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'missing');
  assert.equal(verdict.metrics, null);
  assert.match(verdict.message, /环境不支持 debugSettingScale/);
  assert.doesNotMatch(verdict.message, /读数非法/);
});

test('无钩子 + 改前那一跑：声明为改前基线常量，不参与判定', async () => {
  const { judgeSettingScaleProbe, BASELINE_SOURCE } = await load();
  const verdict = judgeSettingScaleProbe({ status: 'missing', detail: 'typeof=undefined' }, { label: 'before' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, 'before-baseline');
  assert.equal(verdict.declared, true);
  assert.equal(verdict.metrics, null);
  assert.equal(verdict.source, BASELINE_SOURCE);
  assert.equal(verdict.fromBaselineConstant, true);
});

test('钩子存在但抛异常 → 判红，报「读数非法」并带原因', async () => {
  const { judgeSettingScaleProbe } = await load();
  const verdict = judgeSettingScaleProbe({ status: 'throw', detail: 'scene not ready' }, { label: 'after' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'invalid');
  assert.match(verdict.message, /读数非法/);
  assert.match(verdict.message, /scene not ready/);
});

test('钩子返回值不是对象 → 判红，并给出实际值', async () => {
  const { judgeSettingScaleProbe } = await load();
  const verdict = judgeSettingScaleProbe({ status: 'value', value: 'ok' }, { label: 'after' });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, 'invalid');
  assert.match(verdict.message, /读数非法/);
  assert.match(verdict.message, /"ok"/);
});

test('钩子返回值缺字段 / 非数字 → 判红，并列出实际值', async () => {
  const { judgeSettingScaleProbe } = await load();
  const missing = judgeSettingScaleProbe(
    { status: 'value', value: { personH: 30, shopfrontH: 48, shopfrontTop: 16, lampPostH: 58 } },
    { label: 'after' },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.message, /缺字段 lampBodyBottom/);

  const notNumber = judgeSettingScaleProbe(
    { status: 'value', value: { ...VALID, shopfrontH: '四十八' } },
    { label: 'after' },
  );
  assert.equal(notNumber.ok, false);
  assert.match(notNumber.message, /shopfrontH="四十八"/);

  const notFinite = judgeSettingScaleProbe({ status: 'value', value: { ...VALID, personH: Number.NaN } }, { label: 'after' });
  assert.equal(notFinite.ok, false);
  assert.match(notFinite.message, /personH=null/); // JSON.stringify(NaN) === 'null'
});

test('钩子返回值合法 → 绿，读数原样带回，来源标为实测', async () => {
  const { judgeSettingScaleProbe, assertMeasuredReading } = await load();
  const verdict = judgeSettingScaleProbe({ status: 'value', value: { ...VALID } }, { label: 'after' });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.code, 'ok');
  assert.deepEqual(verdict.metrics, VALID);
  assert.match(verdict.source, /debugSettingScale 实测/);
  assert.equal(verdict.fromBaselineConstant, false);

  // 落盘 JSON 的形状：消费方只认这个组合。
  const json = { metrics: verdict.metrics, metricsSource: verdict.source, metricsFromBaselineConstant: verdict.fromBaselineConstant };
  assert.deepEqual(assertMeasuredReading(json, { label: 'after' }), VALID);
});

test('消费方把改前基线常量当读数 → 必须抛红（不许拿基线常量做差）', async () => {
  const { assertMeasuredReading, BASELINE_SOURCE } = await load();
  /** 真·改前基线 JSON 的形状：metrics 为 null + 来源是基线常量 + 显式标记。 */
  const beforeJson = {
    label: 'before',
    metrics: null,
    metricsSource: BASELINE_SOURCE,
    metricsFromBaselineConstant: true,
  };
  assert.throws(
    () => assertMeasuredReading(beforeJson, { label: 'before' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\[判据前提不成立\] 读数非法：before/);
      assert.match(error.message, /metricsFromBaselineConstant=true/);
      assert.match(error.message, /不许拿它做差/);
      return true;
    },
  );

  // 就算有人把基线常量抄进 metrics，来源不对也必须红——不能只看「像不像数字」。
  assert.throws(
    () =>
      assertMeasuredReading({
        ...beforeJson,
        metrics: { personH: 30, shopfrontH: 32, shopfrontTop: 0, lampPostH: 37, lampBodyBottom: 24 },
      }),
    /不是 debugSettingScale 实测读数/,
  );
});

/** 真·改前基线 JSON 的完整形状（含画标尺要用的 `ancient`）。 */
const BEFORE_JSON = {
  label: 'before',
  metrics: null,
  metricsSource: '改前基线常量（非实测）',
  metricsFromBaselineConstant: true,
  ancient: { personH: 30, shopfrontH: 32, shopfrontTop: 0, lampPostH: 37, lampBodyBottom: 24 },
};

test('同一份基线常量 JSON：数值消费必须抛，并排图必须成功并带标注', async () => {
  const { assertMeasuredReading, readShotForComposite, BASELINE_ANNOTATION } = await load();
  // 数值消费（做差 / 容差判定 / 任何进判据的地方）：硬红，口径不变。
  assert.throws(
    () => assertMeasuredReading(BEFORE_JSON, { label: 'before' }),
    /不是 debugSettingScale 实测读数/,
  );
  // 并排图只供人看：允许用基线常量，但必须带回「图上要画出来的那行标注」。
  const shot = readShotForComposite(BEFORE_JSON, { label: 'before' });
  assert.equal(shot.fromBaselineConstant, true);
  assert.equal(shot.annotation, BASELINE_ANNOTATION);
  assert.equal(shot.annotation, '改前为基线常量、非实测、未参与判定');
  assert.deepEqual(shot.scale, BEFORE_JSON.ancient);
});

test('旧基线的来源文案（没有 flag）也算声明过的基线常量，并排图可用', async () => {
  const { readShotForComposite, isBaselineConstantShot } = await load();
  // 已跟踪的 setting-scale-before.json 就长这样：只有文案、没有 metricsFromBaselineConstant。
  const legacy = {
    label: 'before',
    metrics: null,
    metricsSource: 'HEAD 基线常量（无 debugSettingScale）',
    ancient: { personH: 30, shopfrontH: 32, shopfrontTop: 0, lampPostH: 37, lampBodyBottom: 24 },
  };
  assert.equal(isBaselineConstantShot(legacy), true);
  const shot = readShotForComposite(legacy, { label: 'before' });
  assert.equal(shot.fromBaselineConstant, true);
  assert.match(shot.annotation ?? '', /非实测、未参与判定/);
});

test('并排图只对改前放宽：改后是基线常量必须抛', async () => {
  const { readShotForComposite } = await load();
  assert.throws(() => readShotForComposite(BEFORE_JSON, { label: 'after' }), /并排图只允许改前那一拍用基线常量/);
});

test('基线常量 JSON 里带 metrics：既不是实测也不是基线常量，并排图必须抛', async () => {
  const { readShotForComposite } = await load();
  assert.throws(
    () => readShotForComposite({ ...BEFORE_JSON, metrics: BEFORE_JSON.ancient }, { label: 'before' }),
    /既不是实测也不是声明过的基线常量/,
  );
});

test('基线常量缺 ancient：画不出标尺，并排图必须抛', async () => {
  const { readShotForComposite } = await load();
  assert.throws(
    () => readShotForComposite({ ...BEFORE_JSON, ancient: { personH: 30 } }, { label: 'before' }),
    /ancient 不可用（缺 shopfrontH/,
  );
});

test('改后是实测：并排图不带标注', async () => {
  const { readShotForComposite, MEASURED_SOURCE } = await load();
  const shot = readShotForComposite({ metrics: VALID, metricsSource: MEASURED_SOURCE }, { label: 'after' });
  assert.equal(shot.fromBaselineConstant, false);
  assert.equal(shot.annotation, null);
  assert.deepEqual(shot.scale, VALID);
});
