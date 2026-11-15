/**
 * 造物落地账读侧的验收：日报一行 + 楼面板脚注。
 *
 * 这批断言护的是**口径**，不是排版：
 *   1. 四个来源分列，不许合并成一个总数（合并会让人以为活都是外环干的）；
 *   2. 违规必须说出来，藏起来等于落地检查没跑；
 *   3. 没有记录就不写（报纸不写没发生的事）；
 *   4. 日报多出来这一行，既有四类短讯一条都不能被挤掉。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeReport } from '../src/world/report.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import type { LandingEntry } from '../src/world/landing-readout.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 读侧模块是本次新增的。red-first 把 test/ 的 diff 套到 base 时它不存在，
 * 静态 import 会变成 ERR_MODULE_NOT_FOUND（脚本判 ERROR，不可采信）；
 * 动态取、只吞「文件不在」，让它红在断言上。模块写坏则原样抛。
 */
async function readout(): Promise<Record<string, unknown>> {
  try {
    return (await import('../src/world/landing-readout.ts')) as Record<string, unknown>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') return {};
    throw error;
  }
}

const MISSING = '读侧还没落地——这正是 red-first 要在 base 上看到的红灯';

interface Summary {
  readonly total: number;
  readonly byOrigin: readonly { readonly origin: string; readonly count: number }[];
  readonly flagged: number;
  readonly violations: readonly string[];
}

/** 日报短讯上限：加一类事实就该抬一格，不许挤掉别的类别。 */
const REPORT_LINE_LIMIT = 5;

const blueprints = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >,
);

/** 与 `test/faith.test.ts` 同一个造法：真实世界，不做假快照。 */
function makeSim(): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
}

function entry(over: Partial<LandingEntry> & Pick<LandingEntry, 'instanceId'>): LandingEntry {
  return {
    prefabId: 'prefab-x',
    displayName: '某铺子',
    origin: 'auto',
    day: 3,
    landed: true,
    pathfindingConnected: true,
    hasConflict: false,
    invariantViolated: false,
    violations: [],
    ...over,
  };
}

const MIXED: readonly LandingEntry[] = [
  entry({ instanceId: 'a1', origin: 'auto', day: 3 }),
  entry({ instanceId: 'a2', origin: 'auto', day: 3 }),
  entry({ instanceId: 'm1', origin: 'manual', day: 3 }),
  entry({
    instanceId: 'o1',
    origin: 'oracle',
    day: 3,
    invariantViolated: true,
    violations: ['不变式：占地压住既有摆件'],
  }),
  entry({ instanceId: 'y1', origin: 'auto', day: 2 }),
];

test('1. 四个来源分列，不合并成一个总数', async () => {
  const mod = await readout();
  const summarizeLandings = mod['summarizeLandings'] as
    | ((entries: readonly LandingEntry[], day: number | null) => Summary)
    | undefined;
  assert.equal(typeof summarizeLandings, 'function', MISSING);

  const summary = summarizeLandings!(MIXED, 3);
  assert.equal(summary.total, 4, '第 3 天落地 4 栋');
  assert.deepEqual(
    summary.byOrigin,
    [
      { origin: 'auto', count: 2 },
      { origin: 'manual', count: 1 },
      { origin: 'oracle', count: 1 },
    ],
    '外环 2 / 你 1 / 神谕 1，顺序固定且各自成项',
  );
  // day 过滤必须真的过滤：第 2 天那栋不该进来。
  assert.equal(summarizeLandings!(MIXED, null).total, 5, '不按日筛时是全部 5 栋');
});

test('2. 违规要说出来，且计数只数有问题的栋', async () => {
  const mod = await readout();
  const summarizeLandings = mod['summarizeLandings'] as
    | ((entries: readonly LandingEntry[], day: number | null) => Summary)
    | undefined;
  const landingLineOf = mod['landingLineOf'] as ((summary: Summary) => string | null) | undefined;
  assert.equal(typeof summarizeLandings, 'function', MISSING);
  assert.equal(typeof landingLineOf, 'function', MISSING);

  const summary = summarizeLandings!(MIXED, 3);
  assert.equal(summary.flagged, 1, '只有神谕那栋违反不变式');
  assert.deepEqual(summary.violations, ['不变式：占地压住既有摆件']);

  const line = landingLineOf!(summary);
  assert.ok(line !== null);
  assert.match(line!, /今日落地 4 栋/);
  assert.match(line!, /外环 2/, '来源要写在行里');
  assert.match(line!, /1 栋有问题/, '违规数要写在行里');
  assert.match(line!, /压住既有摆件/, '违规原因要写出来，藏起来等于没检查');
});

test('3. 没有落地就没有这一行，不写填充句', async () => {
  const mod = await readout();
  const summarizeLandings = mod['summarizeLandings'] as
    | ((entries: readonly LandingEntry[], day: number | null) => Summary)
    | undefined;
  const landingLineOf = mod['landingLineOf'] as ((summary: Summary) => string | null) | undefined;
  assert.equal(typeof summarizeLandings, 'function', MISSING);
  assert.equal(typeof landingLineOf, 'function', MISSING);

  assert.equal(landingLineOf!(summarizeLandings!([], 3)), null);
  assert.equal(
    landingLineOf!(summarizeLandings!([entry({ instanceId: 'x', day: 1 })], 3)),
    null,
    '别的日子落地不算今天',
  );
});

test('3b. 日报里必须真的出现这一行，且既有短讯没被挤掉', async () => {
  const mod = await readout();
  assert.equal(typeof mod['summarizeLandings'], 'function', MISSING);
  assert.equal(typeof mod['landingLineOf'], 'function', MISSING);

  // 走真实世界：读侧不能只在夹具上活。
  const sim = makeSim();
  const snapshot = sim.snapshot();
  // 日报按**世界日**筛：这里把夹具的日号对齐到当前世界日，否则筛掉的是全部。
  const today = Math.floor(snapshot.now / DAY_MS);
  // 夹具的日号整体平移到当前世界日：昨天的落地位不能被算进今天。
  const shift = today - 3;
  const report = composeReport(
    snapshot,
    MIXED.map((item) => ({ ...item, day: item.day + shift })),
  );
  const joined = report.lines.join(' | ');
  assert.match(joined, /今日落地 4 栋/, '日报必须带上落地那一行');
  assert.match(joined, /外环 2/, '来源分列要出现在日报里');
  assert.ok(
    report.lines.length <= REPORT_LINE_LIMIT,
    `短讯 ${report.lines.length} 条超过上限：加一行不等于可以挤掉别的类别`,
  );
});

test('4. 楼面板脚注：来源 + 过没过，没有记录就是 null', async () => {
  const mod = await readout();
  const buildingLandingOf = mod['buildingLandingOf'] as
    | ((entries: readonly LandingEntry[], instanceId: string) => {
        originLabel: string;
        clean: boolean;
        violations: readonly string[];
      } | null)
    | undefined;
  assert.equal(typeof buildingLandingOf, 'function', MISSING);

  // 面板类型上必须真有这个字段，否则读侧只是个没人用的函数。
  const panelSource = readFileSync(join(ROOT, 'src/ui/building-panel.ts'), 'utf8');
  assert.match(
    panelSource,
    /readonly landing:/,
    'BuildingPanelView 必须带 landing 字段，脚注才有地方落地',
  );

  const clean = buildingLandingOf!(MIXED, 'm1');
  assert.ok(clean !== null);
  assert.equal(clean!.originLabel, '你');
  assert.equal(clean!.clean, true);
  assert.deepEqual(clean!.violations, []);

  const dirty = buildingLandingOf!(MIXED, 'o1');
  assert.ok(dirty !== null);
  assert.equal(dirty!.originLabel, '神谕');
  assert.equal(dirty!.clean, false);
  assert.deepEqual(dirty!.violations, ['不变式：占地压住既有摆件']);

  assert.equal(buildingLandingOf!(MIXED, 'nobody'), null, '没记录就不编');
});
