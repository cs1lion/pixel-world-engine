/**
 * 场所开关：某个场所在某段世界时间上开/关。
 *
 * 这一版有**三条**按时段开闭的门控行（街口摊位、花径、三处工坊），投影只要世界时刻
 * 一个输入，不留 site 维度。它钉三件事：
 *
 * 1. 边界：左闭右开，与 `marketPhaseAt` 同一口径；期望表**从 `TIMETABLE` 派生**，
 *    不在这里再抄一遍 08:00 / 19:00 这类字面量；
 * 2. 拆帧不变性：同一世界时刻，不同 delta 分片跑到的环境帧投影逐字一致——
 *    这条今天绿，谁把场所相位改成存档状态，它就会红；
 * 3. 回放：跨 08:00 / 17:00 / 19:00 的一条轨迹两跑，世界/记忆/造物三层指纹一致，
 *    且开市与夜市那两条 `world.event` 真的在事件流里。
 *
 * 动态 import 是刻意的：在 base 上模块没有 `siteOpenAt` 这个导出，测试必须**红在
 * 断言**上，不能变成 `ERR_MODULE_NOT_FOUND`（`red:first` 会把它记成 ERROR，不算红）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { DAY_MS } from '../src/world/memory/config.ts';
import { worldMinutes } from '../src/world/pace.ts';
import { TIMETABLE, minuteOfDay, type TimetableId } from '../src/world/timetable.ts';
import { hasEnvironment } from '../src/world/environment.ts';
import { runTrace } from '../src/trace/replay.ts';
import type { TraceInput } from '../src/trace/format.ts';

type Phase = 'open' | 'closed' | 'night';
type SiteHoursModule = {
  readonly siteOpenAt?: (worldNow: number) => Phase;
  readonly marketPhaseAt?: (worldNow: number) => Phase;
};

type SiteBandLike = {
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly phase: 'open' | 'night';
};
type SiteDefLike = {
  readonly id: string;
  readonly kind: string;
  readonly bands: readonly SiteBandLike[];
};
type SiteTableModule = {
  readonly SITE_KINDS?: readonly string[];
  readonly SITE_TABLE?: readonly SiteDefLike[];
  readonly siteStateAt?: (siteId: string, worldNow: number) => Phase;
  readonly sitePhaseOf?: (site: SiteDefLike, worldNow: number) => Phase;
  readonly siteOpenAt?: (worldNow: number) => Phase;
  readonly marketPhaseAt?: (worldNow: number) => Phase;
};

const hours = (await import('../src/world/timetable.ts')) as unknown as SiteHoursModule;
const table = (await import('../src/world/timetable.ts')) as unknown as SiteTableModule;
const routines = (await import('../src/world/routines.ts')) as unknown as {
  readonly SITE_FLAGS?: Readonly<Record<string, readonly string[]>>;
};

function requireSiteTable(): readonly SiteDefLike[] {
  const defs = table.SITE_TABLE;
  if (!Array.isArray(defs)) {
    assert.fail('timetable.ts 必须导出 SITE_TABLE（场所静态内容表）');
  }
  return defs;
}

function requireSiteStateAt(): (siteId: string, worldNow: number) => Phase {
  const fn = table.siteStateAt;
  if (typeof fn !== 'function') {
    assert.fail('timetable.ts 必须导出 siteStateAt（按场所 id 的纯函数投影）');
  }
  return fn;
}

function requireSitePhaseOf(): (site: SiteDefLike, worldNow: number) => Phase {
  const fn = table.sitePhaseOf;
  if (typeof fn !== 'function') {
    assert.fail('timetable.ts 必须导出 sitePhaseOf（只吃 SiteDef 数据，不按 kind 写分支）');
  }
  return fn;
}

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

function makeSim(initialNow: number): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    initialNow,
    onChange: () => undefined,
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

/** 某一拍在一天里的分钟数。只读时刻表，不在测试里再抄一遍字面量。 */
function beatMinute(id: TimetableId): number {
  const beat = TIMETABLE.find((item) => item.id === id);
  if (beat === undefined) throw new Error(`时刻表里没有 ${id}`);
  return beat.minuteOfDay;
}

const OPEN_FROM = beatMinute('market_open');
const OPEN_TO = beatMinute('work_end');
const NIGHT_FROM = beatMinute('night_market');
const NIGHT_TO = beatMinute('market_close');

const EXPECTED: readonly TimetableId[] = ['market_open', 'work_end', 'night_market', 'market_close'];

/** 独立再推一遍期望相位：早市 [open, work_end)，夜市 [night_market, market_close)。 */
function expectedAt(minute: number): Phase {
  if (minute >= NIGHT_FROM && minute < NIGHT_TO) return 'night';
  if (minute >= OPEN_FROM && minute < OPEN_TO) return 'open';
  return 'closed';
}

function projectionOf(sim: Simulation): string {
  const frame = sim.environment();
  return JSON.stringify({
    now: frame.now,
    day: frame.day,
    minuteOfDay: frame.minuteOfDay,
    marketOpen: hasEnvironment(frame, 'marketOpen'),
    nightMarket: hasEnvironment(frame, 'nightMarket'),
  });
}

test('siteOpenAt：逐世界分钟、跨日与四个边界，全部与 TIMETABLE 派生表一致', () => {
  const candidate = hours.siteOpenAt;
  if (typeof candidate !== 'function') {
    assert.fail('timetable.ts 必须导出 siteOpenAt（场所开关的纯函数投影）');
  }
  const siteOpenAt = candidate;

  for (const day of [0, 1, 3]) {
    for (let minute = 0; minute < 1440; minute += 1) {
      const now = day * DAY_MS + worldMinutes(minute);
      assert.equal(minuteOfDay(now), minute, `第 ${day} 天第 ${minute} 分的分钟口径`);
      assert.equal(
        siteOpenAt(now),
        expectedAt(minute),
        `第 ${day} 天第 ${minute} 分应当是 ${expectedAt(minute)}`,
      );
    }
  }

  // 四个边界各自再钉左闭右开：边界那一分钟算「新相位」，前一毫秒算「旧相位」。
  for (const edge of EXPECTED.map((id) => beatMinute(id)) as readonly number[]) {
    assert.equal(siteOpenAt(worldMinutes(edge)), expectedAt(edge), `${edge} 分是左闭`);
    assert.equal(siteOpenAt(worldMinutes(edge) - 1), expectedAt(edge - 1), `${edge} 分前是右开`);
  }

  // 行为没变：老的 marketPhaseAt 与新的投影逐点相同（这是重构，不是新行为）。
  const legacy = hours.marketPhaseAt;
  if (typeof legacy === 'function') {
    for (let minute = 0; minute < 1440; minute += 17) {
      assert.equal(
        legacy(worldMinutes(minute)),
        siteOpenAt(worldMinutes(minute)),
        `第 ${minute} 分新老投影必须一致`,
      );
    }
  }
});

test('拆帧不变性：同一世界时刻，不同 delta 分片的环境帧投影逐字一致', () => {
  const start = worldMinutes(6 * 60);
  const total = worldMinutes(3 * 60); // 06:00 → 09:00，跨 08:00 开市

  const coarse = makeSim(start);
  for (let step = 0; step < 36; step += 1) coarse.update(300_000);
  const fine = makeSim(start);
  for (let step = 0; step < 108; step += 1) fine.update(100_000);

  assert.equal(coarse.toSave().world.now, start + total, '粗分片必须跑到同一个世界时刻');
  assert.equal(fine.toSave().world.now, start + total, '细分片必须跑到同一个世界时刻');
  assert.equal(projectionOf(coarse), projectionOf(fine), '同一世界时刻的场所投影不许跟帧走');

  // 场所相位是派生读数，不许落成存档字段——落了就违反「零状态」。
  const saveKeys = Object.keys(coarse.toSave().world);
  // 判据是「派生相位不入档」，不是「键名里不许有 site」：
  // `world.siteOutput` 是累计产出的**世界事实**（搬了多少炭、洗了多少件衣裳），
  // 不是从时钟算出来的相位，所以它合法。这里只挡相位类键。
  assert.equal(
    saveKeys.some((key) => /market|siteHours|sitePhase|siteState|hours/i.test(key)),
    false,
    `存档里不许出现场所相位字段，实际有：${saveKeys.join(', ')}`,
  );
  assert.ok(saveKeys.includes('siteOutput'), '产出账是世界事实，必须在档里');
});

test('回放：跨 08:00 / 17:00 / 19:00 的一条轨迹两跑，三层指纹一致', async () => {
  const input: TraceInput = {
    format: 'pwe-trace/2',
    traceVersion: 2,
    description: '场所开关切片：06:00 → 21:00，跨早市、收工与夜市三拍。',
    worldId: 'default',
    worldSeed: 'default',
    initialNow: worldMinutes(6 * 60),
    stepMs: 60_000,
    steps: 15 * 60,
    eventRange: { from: 0, to: 0 },
    injections: [],
    outer: { memory: true, creator: true },
  };

  const first = await runTrace(input, { openEventRange: true });
  const second = await runTrace(input, { openEventRange: true });

  assert.equal(first.finalProjection, second.finalProjection, '世界层投影必须两跑一致');
  assert.equal(
    first.stepFingerprints.join('\n'),
    second.stepFingerprints.join('\n'),
    '逐拍世界指纹必须两跑一致',
  );
  assert.deepEqual(first.memory, second.memory, '记忆层指纹必须两跑一致');
  assert.deepEqual(first.creator, second.creator, '造物层指纹必须两跑一致');

  // 事件流读的是 `CapturedEvent`（seq / at / tone / text），没有 kind；用时刻表
  // 里那一拍自己的文案来认，不在测试里另抄一句。
  const texts = first.events.map((event) => event.text);
  for (const id of ['market_open', 'work_end', 'night_market'] as const) {
    const beat = TIMETABLE.find((item) => item.id === id);
    assert.notEqual(beat, undefined, `时刻表里没有 ${id}`);
    assert.ok(texts.includes(beat!.text), `事件流里必须有 ${id} 那一拍：${beat!.text}`);
  }
});

test('SITE_TABLE：怎么开门是性质——id 唯一、时段合法不重叠、每个 kind 至少一行', () => {
  const defs = requireSiteTable();
  assert.ok(defs.length > 0, 'SITE_TABLE 不许为空：空表等于所有场所永远关着');

  // id 唯一：同一个场所挂两套时段，`siteStateAt` 只会静默取到先遍历到的那条。
  const ids = defs.map((def) => def.id);
  assert.equal(new Set(ids).size, ids.length, `SITE_TABLE 的 id 必须唯一：${ids.join(', ')}`);

  // 闭集里的每个 kind 都得有至少一条门控行，否则那个 kind 永远打不开。
  for (const kind of table.SITE_KINDS ?? []) {
    assert.ok(
      defs.some((def) => def.kind === kind),
      `SITE_KINDS 里的 ${kind} 在 SITE_TABLE 里没有门控行`,
    );
  }

  for (const def of defs) {
    const ordered = [...def.bands].sort((a, b) => a.fromMinute - b.fromMinute);
    assert.deepEqual(
      def.bands.map((band) => band.fromMinute),
      ordered.map((band) => band.fromMinute),
      `${def.id} 的 bands 必须按开始时刻排序`,
    );
    for (const band of def.bands) {
      assert.ok(
        Number.isInteger(band.fromMinute) && Number.isInteger(band.toMinute),
        `${def.id} 的时段边界必须是整分钟`,
      );
      assert.ok(band.fromMinute >= 0 && band.toMinute <= 1440, `${def.id} 的时段必须落在一天之内`);
      assert.ok(band.fromMinute < band.toMinute, `${def.id} 的时段必须非空`);
    }
    for (let index = 1; index < def.bands.length; index += 1) {
      assert.ok(
        def.bands[index - 1]!.toMinute <= def.bands[index]!.fromMinute,
        `${def.id} 的时段不许重叠`,
      );
    }
  }

  // 结果证据：营业边界必须来自 TIMETABLE 派生值。这里只问「有没有这条带」，
  // 不写死条数、也不写死 id 列表——设定集以后给集市加一条时段，这里不该红。
  const hasBand = (def: SiteDefLike, from: number, to: number, phase: 'open' | 'night'): boolean =>
    def.bands.some((band) => band.fromMinute === from && band.toMinute === to && band.phase === phase);

  const market = defs.find((def) => def.id === 'market');
  assert.ok(market !== undefined, 'SITE_TABLE 里必须有 market 门控行');
  assert.equal(market.kind, 'market');
  assert.ok(hasBand(market, OPEN_FROM, OPEN_TO, 'open'), 'market 的早市边界必须来自 TIMETABLE');
  assert.ok(hasBand(market, NIGHT_FROM, NIGHT_TO, 'night'), 'market 的夜市边界必须来自 TIMETABLE');

  const courtyard = defs.find((def) => def.id === 'courtyard');
  assert.ok(courtyard !== undefined, 'SITE_TABLE 里必须有 courtyard 门控行');
  assert.equal(courtyard.kind, 'courtyard', '花径的 kind 必须与 SiteKind 闭集里的 courtyard 同名');
  const quietEnd = TIMETABLE.find((beat) => beat.id === 'quiet_end')!.minuteOfDay;
  const workEnd = TIMETABLE.find((beat) => beat.id === 'work_end')!.minuteOfDay;
  assert.ok(
    hasBand(courtyard, quietEnd, workEnd, 'open'),
    '花径的开门/关门必须引用 quiet_end / work_end，不能在表里另写 14:00 / 17:00',
  );
});

test('siteStateAt：market 逐分钟与旧投影一致，未知 id 必须 throw', () => {
  const siteStateAt = requireSiteStateAt();

  for (const day of [0, 1, 3]) {
    for (let minute = 0; minute < 1440; minute += 1) {
      const now = day * DAY_MS + worldMinutes(minute);
      assert.equal(
        siteStateAt('market', now),
        expectedAt(minute),
        `第 ${day} 天第 ${minute} 分的 market 相位`,
      );
    }
  }
  for (const edge of EXPECTED.map((id) => beatMinute(id)) as readonly number[]) {
    assert.equal(siteStateAt('market', worldMinutes(edge)), expectedAt(edge), `${edge} 分是左闭`);
    assert.equal(
      siteStateAt('market', worldMinutes(edge) - 1),
      expectedAt(edge - 1),
      `${edge} 分前是右开`,
    );
  }

  assert.throws(
    () => siteStateAt('not-in-table', worldMinutes(0)),
    /SITE_TABLE/,
    '未知场所 id 必须 throw，不许静默成 closed',
  );
});

test('siteOpenAt 委托 siteStateAt(market)：边界与 night 分支逐点不变', () => {
  const candidate = table.siteOpenAt;
  if (typeof candidate !== 'function') {
    assert.fail('timetable.ts 必须导出 siteOpenAt');
  }
  const siteOpenAt = candidate;
  const siteStateAt = requireSiteStateAt();

  for (let minute = 0; minute < 1440; minute += 1) {
    assert.equal(
      siteOpenAt(worldMinutes(minute)),
      siteStateAt('market', worldMinutes(minute)),
      `第 ${minute} 分委托后必须逐字一致`,
    );
  }

  assert.equal(siteOpenAt(worldMinutes(OPEN_FROM)), 'open', '08:00 是左闭');
  assert.equal(siteOpenAt(worldMinutes(OPEN_FROM) - 1), 'closed', '08:00 前毫秒是右开');
  assert.equal(siteOpenAt(worldMinutes(OPEN_TO)), 'closed', '17:00 收工');
  assert.equal(siteOpenAt(worldMinutes(NIGHT_FROM)), 'night', '19:00 夜市左闭');
  assert.equal(siteOpenAt(worldMinutes(NIGHT_TO) - 1), 'night', '22:00 前毫秒仍是夜市');
  assert.equal(siteOpenAt(worldMinutes(NIGHT_TO)), 'closed', '22:00 闭市右开');
});

test('SiteDef 只换数据：测试内 courtyard fixture 走同一个 sitePhaseOf', () => {
  const sitePhaseOf = requireSitePhaseOf();

  // 只在测试里造一条 courtyard 数据，证明相位函数不按 kind 写分支；
  // 生产 `SITE_TABLE` 不写庭院时段，等设定集给内容。
  const courtyard: SiteDefLike = {
    id: 'courtyard:fixture',
    kind: 'courtyard',
    bands: [{ fromMinute: 6 * 60, toMinute: 22 * 60, phase: 'open' }],
  };

  assert.equal(sitePhaseOf(courtyard, worldMinutes(6 * 60)), 'open', '庭院 06:00 左闭');
  assert.equal(sitePhaseOf(courtyard, worldMinutes(6 * 60 - 1)), 'closed', '庭院 06:00 前关闭');
  assert.equal(sitePhaseOf(courtyard, worldMinutes(22 * 60 - 1)), 'open', '庭院 22:00 前仍开');
  assert.equal(sitePhaseOf(courtyard, worldMinutes(22 * 60)), 'closed', '庭院 22:00 右开');
});

test('场所种类闭集是运行时单一源：kind 合法、无重复、与门控登记表键集合一致', () => {
  const kinds = table.SITE_KINDS;
  if (kinds === undefined) {
    assert.fail('timetable.ts 必须导出 SITE_KINDS（场所种类闭集）');
  }
  assert.ok(kinds.length > 0, 'SITE_KINDS 不许为空');
  assert.equal(new Set(kinds).size, kinds.length, `SITE_KINDS 不许重复：${kinds.join(', ')}`);
  assert.equal(kinds.includes('courtyard'), true, '庭院 / 花径 / 桥头前庭');
  assert.equal(kinds.includes('park'), false, '设定集没有城市公园');

  // 闭集与门控登记表必须一一对应：少一个 = 有扇永远打不开的门；
  // 多一个 = 登记表挂了闭集外的种类，装载期会 throw。
  const flags = routines.SITE_FLAGS;
  if (flags === undefined) {
    assert.fail('routines.ts 必须导出 SITE_FLAGS（门控登记表）');
  }
  assert.deepEqual(
    [...kinds].sort(),
    Object.keys(flags).sort(),
    'SITE_KINDS 与 SITE_FLAGS 的键集合必须一致',
  );
});

test('闭集之外的 kind 直接 throw，不静默成 closed', () => {
  const sitePhaseOf = requireSitePhaseOf();
  const unknown = {
    id: 'legacy:fixture',
    kind: 'park',
    bands: [{ fromMinute: 6 * 60, toMinute: 22 * 60, phase: 'open' }],
  } as unknown as SiteDefLike;

  assert.throws(
    () => sitePhaseOf(unknown, worldMinutes(12 * 60)),
    /SITE_KINDS/,
    '与 siteStateAt 未知 id 同口径：表里没有的 kind 不许当成「今天关着」',
  );
});
