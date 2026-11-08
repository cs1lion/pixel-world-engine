/**
 * 场所开关：某个场所在某段世界时间上开/关。
 *
 * 这一版只有**一个**按时段开闭的场所（街口摊位），所以投影只需要世界时刻一个输入，
 * 不留 site 维度。它钉三件事：
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
  readonly kind: 'market' | 'park';
  readonly bands: readonly SiteBandLike[];
};
type SiteTableModule = {
  readonly SITE_TABLE?: readonly SiteDefLike[];
  readonly siteStateAt?: (siteId: string, worldNow: number) => Phase;
  readonly sitePhaseOf?: (site: SiteDefLike, worldNow: number) => Phase;
  readonly siteOpenAt?: (worldNow: number) => Phase;
  readonly marketPhaseAt?: (worldNow: number) => Phase;
};

const hours = (await import('../src/world/timetable.ts')) as unknown as SiteHoursModule;
const table = (await import('../src/world/timetable.ts')) as unknown as SiteTableModule;

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
  assert.equal(
    saveKeys.some((key) => /market|site|hours/i.test(key)),
    false,
    `存档里不许出现场所相位字段，实际有：${saveKeys.join(', ')}`,
  );
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

test('SITE_TABLE：这一刀只有 market 一条，时段合法且不重叠', () => {
  const defs = requireSiteTable();
  assert.equal(defs.length, 1, 'SITE_TABLE 只放 market；公园时段待设定集给出，不在这里编造');
  const market = defs[0];
  assert.equal(market.id, 'market');
  assert.equal(market.kind, 'market');
  assert.ok(market.bands.length >= 2, 'market 至少要有早市与夜市两条时段');

  const ordered = [...market.bands].sort((a, b) => a.fromMinute - b.fromMinute);
  assert.deepEqual(
    market.bands.map((band) => band.fromMinute),
    ordered.map((band) => band.fromMinute),
    'bands 必须按开始时刻排序',
  );
  for (const band of market.bands) {
    assert.ok(
      Number.isInteger(band.fromMinute) && Number.isInteger(band.toMinute),
      '时段边界必须是整分钟',
    );
    assert.ok(band.fromMinute >= 0 && band.toMinute <= 1440, '时段必须落在一天之内');
    assert.ok(band.fromMinute < band.toMinute, '时段必须非空');
  }
  for (let index = 1; index < market.bands.length; index += 1) {
    assert.ok(
      market.bands[index - 1].toMinute <= market.bands[index].fromMinute,
      '时段不许重叠',
    );
  }

  // 结果证据：四个边界与 TIMETABLE 派生值逐字一致。代码上的单一来源由
  // `SITE_TABLE` 直接引用 `MARKET_OPEN_MINUTE` 等派生常量保证，这里只钉结果。
  assert.deepEqual(
    market.bands.map((band) => [band.fromMinute, band.toMinute]),
    [
      [OPEN_FROM, OPEN_TO],
      [NIGHT_FROM, NIGHT_TO],
    ],
    'market 的四个边界必须来自 TIMETABLE，不能在表里另抄一遍',
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

test('SiteDef 只换数据：测试内 park fixture 走同一个 sitePhaseOf', () => {
  const sitePhaseOf = requireSitePhaseOf();

  // 只在测试里造一条 park 数据，证明相位函数不按 kind 写分支；
  // 生产 `SITE_TABLE` 不写公园时段，等设定集给内容。
  const park: SiteDefLike = {
    id: 'park:fixture',
    kind: 'park',
    bands: [{ fromMinute: 6 * 60, toMinute: 22 * 60, phase: 'open' }],
  };

  assert.equal(sitePhaseOf(park, worldMinutes(6 * 60)), 'open', '公园 06:00 左闭');
  assert.equal(sitePhaseOf(park, worldMinutes(6 * 60 - 1)), 'closed', '公园 06:00 前关闭');
  assert.equal(sitePhaseOf(park, worldMinutes(22 * 60 - 1)), 'open', '公园 22:00 前仍开');
  assert.equal(sitePhaseOf(park, worldMinutes(22 * 60)), 'closed', '公园 22:00 右开');
});
