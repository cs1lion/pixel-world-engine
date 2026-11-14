/**
 * 评审 minor checks 的防回退断言（PR #48 第二轮）。
 *
 * 把评审提的边界逐条变成机器可查的东西：
 *   1. 回放最后一拍的落地结算**不能丢**（`step()` 必须 await 所有 settlementPromises）；
 *   2. 落地结算在本拍内写定，后续拆除不回溯改写；实体找不到要安全返回；
 *   3. 读数在 await 之前从同一份捕获快照取全，不读可变网格；
 *   4. 日报「今日」按虚拟世界钟算，不读墙钟；
 *   5. 缓存超限后旧楼回退「无脚注」，`placeId` 与 `instanceId` 同键；
 *   6. 长违规文案走 textContent，且有 CSS 兜底；
 *   7. ADR 不再用行号指着 SandboxScene.ts，改指方法名。
 *
 * **本文件对本次新增的 `landing-readout.ts` 零引用**（连动态 import 都没有）：
 * red-first 把 test/ 的 diff 套到 base 时那个文件不存在，动态 import 的解析失败
 * 会被它判成 ERROR（即使 catch 住了也不可采信）。读侧函数的行为已由
 * `creator-landing-readout.test.ts` 覆盖，这里只做源码级与时序级断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrace } from '../src/trace/replay.ts';
import { TRACE_FORMAT, TRACE_VERSION } from '../src/trace/format.ts';
import { composeReport } from '../src/world/report.ts';
import { selectSetting, worldForSetting } from '../src/settings/index.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (relative: string): string => join(ROOT, 'src', relative);
/** 文件不存在时返回空串，让断言红在「缺内容」而不是 ENOENT。 */
const read = (relative: string): string => {
  const path = src(relative);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

type LandingOrigin = 'manual' | 'auto' | 'oracle' | 'world';
interface LandingEntry {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly displayName: string;
  readonly origin: LandingOrigin;
  readonly day: number;
  readonly landed: boolean;
  readonly pathfindingConnected: boolean;
  readonly hasConflict: boolean;
  readonly invariantViolated: boolean;
  readonly violations: readonly string[];
}

/** 开局还没落位的第一张蓝图（`Simulation.build` 拒同模板第二栋）。 */
function unbuiltId(): string {
  const pack = selectSetting('?world=dengchao');
  const existing = new Set(worldForSetting(pack).buildings.map((item) => item.prefabId));
  const id = [...pack.blueprints.keys()].sort().find((candidate) => !existing.has(candidate));
  assert.ok(id !== undefined);
  return id;
}

function trace(lastStepBuild: boolean): Parameters<typeof runTrace>[0] {
  const at = lastStepBuild ? 4_000 : 1_000;
  const injections: unknown[] = [
    {
      seq: 1,
      atWorldMs: at,
      kind: 'command',
      payload: { command: { kind: 'build', prefabId: unbuiltId(), instanceId: 'hardening-1' } },
    },
  ];
  return {
    format: TRACE_FORMAT,
    traceVersion: TRACE_VERSION,
    description: 'hardening: 最后一拍落地',
    worldId: 'dengchao',
    worldSeed: 'hardening-seed',
    initialNow: 0,
    stepMs: 100,
    steps: 40,
    eventRange: { from: 0, to: 0 },
    injections,
    outer: { memory: false, creator: true },
  } as Parameters<typeof runTrace>[0];
}

test('1. 最后一拍的落地结算不能丢：step() 必须 await 所有 settlementPromises', async () => {
  const run = await runTrace(trace(true));
  const business = run.creator?.business;
  assert.ok(business !== null && business !== undefined);
  assert.ok(
    business.landings.some((item) => item.instanceId === 'hardening-1'),
    '把 build 放在轨迹最后一拍，landing 还是 0 条 → 回放结束时漏 await 了结算',
  );
});

test('2. 落地结算在本拍内写定；后续拆除不回溯改写已写入的记录', async () => {
  // 生产 `demolish` 会拒「正在施工」，所以「结算完成前被拆」在当前规则下不可达。
  // 能测、也该测的是时序：落地那拍就把记录写定，之后拆楼不许改写它。
  const base = trace(false);
  const injections = [...base.injections];
  injections.push({
    seq: 2,
    atWorldMs: 4_000,
    kind: 'command',
    payload: { command: { kind: 'demolish', instanceId: 'hardening-1' } },
  } as never);
  const run = await runTrace({ ...base, injections });
  const business = run.creator?.business;
  assert.ok(business !== null && business !== undefined);
  const rows = business.landings.filter((item) => item.instanceId === 'hardening-1');
  assert.equal(rows.length, 1, '落地一次就只该有一条 landing');
  assert.equal(typeof rows[0]!.pathfindingConnected, 'boolean', '可达性读数要是落地那拍算出的布尔');
});

test('2b. 实体找不到时安全返回：不凭缓存形状补一条幽灵记录', () => {
  const runtime = read('trace/runtime.ts');
  const start = runtime.indexOf('private async settleUnplannedLanding');
  assert.ok(start > 0, '无头回放必须有非提案落地的结算入口');
  const end = runtime.indexOf('private async settlePendingLandings', start);
  const body = runtime.slice(start, end);
  assert.match(body, /if \(building === undefined\) return;/, '楼已被拆掉时必须提前返回');
  assert.match(
    body,
    /snapshot\.buildings\.find\(\(item\) => item\.instanceId === instanceId\)/,
    '找实体要用当前快照，不能用落地前缓存或 pending 表',
  );
});

test('3. 落地读数必须在 await 之前从同一份快照取全（不读可变网格）', () => {
  const runtime = read('trace/runtime.ts');
  const start = runtime.indexOf('private async settleUnplannedLanding');
  assert.ok(start > 0);
  const end = runtime.indexOf('private async settlePendingLandings', start);
  const body = runtime.slice(start, end);
  const awaitAt = body.indexOf('await checkLandedBuilding');
  assert.ok(awaitAt > 0);
  const reachableAt = body.indexOf('const pathfindingConnected =');
  const coverageAt = body.indexOf('const coverageRate =');
  assert.ok(reachableAt > 0, '必须有一个显式的 pathfindingConnected 常量');
  assert.ok(coverageAt > 0, '必须有一个显式的 coverageRate 常量');
  assert.ok(
    reachableAt < awaitAt,
    'landingReachable 必须在 await 之前算：await 之后 this.world.grid 可能已被拆除改过',
  );
  assert.ok(coverageAt < awaitAt, 'creationCoverage 也必须在 await 之前');
});

test('4. 日报「今日」按虚拟世界钟算，不读墙钟', () => {
  const reportSource = read('world/report.ts');
  assert.doesNotMatch(reportSource, /Date\.now|performance\.now/, '不许读墙钟');
  assert.match(reportSource, /snapshot\.now \/ DAY_MS/, '天界必须按世界毫秒折算');

  const blueprints = parseBlueprintTable(
    JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')) as Record<
      string,
      Record<string, unknown>
    >,
  );
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
  });
  const snapshot = sim.snapshot();
  const day = Math.floor(snapshot.now / DAY_MS);
  const entry = (d: number): LandingEntry => ({
    instanceId: `x${d}`,
    prefabId: 'x',
    displayName: 'x',
    origin: 'auto',
    day: d,
    landed: true,
    pathfindingConnected: true,
    hasConflict: false,
    invariantViolated: false,
    violations: [],
  });
  assert.doesNotMatch(
    composeReport(snapshot, [entry(day - 1), entry(day + 1)]).lines.join(' | '),
    /今日落地/,
    '前一天与后一天都不算今天',
  );
  assert.match(composeReport(snapshot, [entry(day)]).lines.join(' | '), /今日落地 1 栋/);
});

test('5. 会话缓存超限：旧楼回退为「无脚注」，绝不显示错的', () => {
  const scene = read('scenes/SandboxScene.ts');
  assert.match(scene, /landingEntries\.splice\(0,/, '缓存必须有裁剪，不能无限涨');
  assert.match(
    scene,
    /buildingLandingOf\(this\.landingEntries, placeId\)/,
    '面板查询用的 placeId 必须与 rememberLanding 写的 instanceId 是同一个键',
  );
  const readoutSource = read('world/landing-readout.ts');
  assert.match(
    readoutSource,
    /if \(found === undefined\) return null;/,
    '裁掉的记录必须回退 null；不许凭空补一句脚注',
  );
  assert.match(readoutSource, /export function buildingLandingOf/);
});

test('6. 长违规文案走 textContent，且有 CSS 兜底不撑破面板', () => {
  const panel = read('ui/building-panel.ts');
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(panel, /node\.textContent = text/, '拼 violations 的 line() 只能是 textContent');
  assert.doesNotMatch(panel, /innerHTML/, '不许拼 HTML');
  assert.match(
    html,
    /#building-panel-body \.building-landing[^}]*overflow-wrap:\s*anywhere/,
    '.building-landing 需要 overflow-wrap: anywhere',
  );
});

test('7. ADR 不再用行号指着 SandboxScene.ts，改指方法名', () => {
  const adr = readFileSync(join(ROOT, '..', 'docs/adr/ADR_SCHEMA_PASS_RATE_SEMANTICS.md'), 'utf8');
  assert.doesNotMatch(adr, /SandboxScene\.ts:\d+/, '行号会随每次接线漂移；这张表要改成符号名');
  assert.match(adr, /settleCreationObservation\(\)|recordUnplannedLanding\(\)/);
});
