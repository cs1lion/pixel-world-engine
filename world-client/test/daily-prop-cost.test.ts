/**
 * 「传播计算 `< 10ms/天`」——§3.2 B 五条指标里最后一个没人量过的硬数。
 *
 * ## 为什么要有这个文件
 *
 * §3.2 B 的 `daily_prop_cost`（`docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md:154`）
 * 是**两半**：
 *
 * 1. 「传播计算 `0` 次 LLM 调用」——**有闸**。`test/creator-config.test.ts:235`
 *    钉住配置里那个数是 0，`test/memory-protocol.test.ts` 钉住断言是
 *    `generatedBy.by === 'rule'` 生的。
 * 2. 「纯图算法 `< 10ms/天`」——**一闸都没有**。`10ms` 这三个字符在
 *    `src/world/memory/` 与 `docs/` 里**零命中**：没有测试、没有探针、没有 eval，
 *    连一句注释都没提过它。
 *
 * 而这个仓库最不容的正是「读起来像真的、其实一次都没量过」——`config.ts` 第 3 条
 * 纪律那句「900 秒由 timeScale 承担」就是这么站了很久的（见
 * `test/day-pace.test.ts` 与 `mechanism-claims-need-the-arithmetic` 的教训）。
 *
 * ## 今天量出来（2026-10-28，Windows 11 / Node 22）
 *
 * 跑真实 `MemoryRuntime`、真实设定集落成的世界、五个 `importanceHint = 0.9` 的
 * 大事同时在第一天出生，逐天 `tick` 一整天的世界时间：
 *
 * | 世界 | holder | 单日最慢 | 中位 | 对 10ms 预算 |
 * | --- | --- | --- | --- | --- |
 * | 灯潮界（设定集） | 11（2 村民 + 9 楼） | 4.87 ms | 1.03 ms | 余 9.7 倍 |
 * | 默认世界（`buildLargeWorld`） | 13（2 村民 + 11 楼） | 0.42 ms | 0.31 ms | 余 32 倍 |
 *
 * **2026-11-01 重测**：设定集从 6 栋楼长到 9 栋，上面两行是重测值（三次取中位，
 * 首跑含 JIT 预热所以单次最慢会比中位数高一个量级）。这组数噪声很大，
 * 所以下面的闸只守「量级」与「随规模走的方向」，不守绝对值。
 *
 * **同一天还发现「随规模走」那条在出货世界的规模上量不出信号**（7 对 11 个
 * holder 时小的一方反而更贵，差值在噪声里），对照因此搬到 82 对 146 个合成
 * holder 上——理由与扫描数据写在那个测试自己的注释里。
 *
 * 最慢的永远是**第 1 天**——所有断言都在那天出生，之后库里的东西只会被遗忘，
 * 不会新增。两个世界都远在预算之内（余 9.7 倍与 32 倍），**不是不达标**。
 *
 * ## 这一条**不**主张什么
 *
 * - **不主张表里那些毫秒数就是真的。** 表是历史**墙钟**读数，跟机器有关，CI 上会
 *   不一样。能被机器搬动的是绝对值，不是形状——所以下面那道闸的阈值放到 50ms，
 *   是预算的 5 倍、实测最慢的约 10 倍。它抓的是**量级退化**（哪天谁把传播改成
 *   每步全库扫描），不是抓 10ms 那条线。真要守 10ms，得先有一台固定的基准机。
 * - **闸的读数不是墙钟。** 2026-11-03 起，绝对预算闸的主指标是
 *   `process.cpuUsage()` 的**进程 CPU 时间**（user + system，起止两次调用取差），
 *   阈值仍是 50ms。单次墙钟在 `node --test` 并行跑时夹着排队时间——同文件相邻
 *   用例全过、只有这条红，实测 54.62ms / 100.28ms，本机 p50 56.6ms，量到的是
 *   机器有多忙，不是传播有多贵。CPU 时间不含调度等待：空载时与墙钟同量级，
 *   负载下墙钟炸到 340–540ms 而 CPU 仍在 0–31ms。墙钟数字保留在 diagnostic 里当附注。
 * - **0.00 会重采。** 同一条 15.6ms 刻度也意味着「一天不到一格」时 CPU 读成
 *   `0.00`——那一跑等于没量。所以第 1 天读成 0 就再采，最多三次，**取最大值**
 *   判定。取最大而不是平均：真退化成 60ms 的那次若和两个 0 平均成 20ms，
 *   回归就被糊掉了。预算仍是 50ms，语义仍是「最快那天不许超预算」。
 * - **方向那条仍用墙钟。** Windows 上进程 CPU 记账跟着调度时钟走（粒度约
 *   15.6ms），第 6 天这种不到 1ms 的一天会读成 `0.00`；`0 < 0 * 2` 恒假，
 *   量到的是「量不出来」而不是「变贵了」。绝对预算闸用 CPU（真退化成全库
 *   扫描是几十毫秒，跨得过粒度），「稳态不比第 1 天贵」这种比值留在墙钟：
 *   第 1 天里含首日全部的 JIT 与建库开销，2 倍余量够厚。
 * - **不主张这是典型值。** 我把全部 holder 一字排开、间距 `talkDistance`，
 *   又让五个大事同一天出生——这是**最利于传播的摆法**，量到的是上界。
 *   真实作息的 holder 散在各处，配不成对的更多，一天更便宜。
 * - **不查 `paceFrame` / `tick` 自己算得对不对。** 那是 `eco-mode.test.ts` 与
 *   `frame-pace.test.ts` 的事；这里只从外部量总账。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { buildSettingWorld, loadSettingPack } from '../src/settings/load.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import { MemoryRuntime } from '../src/world/memory/runtime.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';

/** §3.2 B 的预算：一天传播与日终整理的计算耗时。 */
const BUDGET_MS = 10;
/** 这道闸自己的阈值：预算的 5 倍。理由见文件头——它抓量级，不抓 10ms 那条线。 */
const CEILING_MS = 50;
/** CPU 读成 0.00 时的重采上限：最多采三次，取最大值。理由见文件头。 */
const CPU_ATTEMPTS = 3;

const DAY_MS = DEFAULT_MEMORY_CONFIG.dayMs;
const TALK_DISTANCE = DEFAULT_MEMORY_CONFIG.talkDistance;
const VILLAGERS: readonly string[] = ['莞尔', '阿雾'];

/** 默认世界（大规格）落成的楼。`test/large-world.test.ts:144` 钉住它是十一栋。 */
function defaultWorldBuildingIds(): readonly string[] {
  const blueprints = parseBlueprintTable(
    JSON.parse(
      readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
    ) as Record<string, Record<string, unknown>>,
  );
  return buildLargeWorld(blueprints).buildings.map((building) => building.instanceId);
}

/**
 * 一天的世界时间要跑多少**进程 CPU 时间**与墙钟。
 *
 * holder 一字排开、间距 `talkDistance`，五个 `importanceHint = 0.9` 的大事同一天
 * 出生——最利于传播的摆法，量到的是上界。`day` 传第几天。
 *
 * 主指标取 `process.cpuUsage()` 前后差（user + system），排除调度等待；
 * 墙钟同时取：既是附注，也供「稳态不比第 1 天贵」那条方向判断用（理由见文件头）。
 */
function oneDayTiming(
  buildingIds: readonly string[],
  day: number,
): { cpuMs: number; wallMs: number } {
  const rt = new MemoryRuntime({ worldId: 'prop-cost', occlusion: { isWalkable: () => true } });
  rt.syncHolders([
    ...VILLAGERS.map((holderId, index) => ({
      holderId,
      type: 'character' as const,
      at: { x: index * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
    ...buildingIds.map((holderId, index) => ({
      holderId,
      type: 'place' as const,
      at: { x: (index + VILLAGERS.length) * TALK_DISTANCE, y: 0 },
      profile: {},
    })),
  ]);
  for (let i = 0; i < 5; i += 1) {
    rt.observe(
      {
        eventId: `ev_${i}`,
        kind: 'workshop_accident',
        placeId: buildingIds[0],
        at: { x: 0, y: 0 },
        actors: VILLAGERS,
        outcome: {},
        importanceHint: 0.9,
      },
      undefined,
      1000 + i,
    );
  }
  for (let d = 1; d < day; d += 1) rt.tick(d * DAY_MS);
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  rt.tick(day * DAY_MS);
  const wallMs = performance.now() - started;
  const cpuUsed = process.cpuUsage(cpuBefore);
  return { cpuMs: (cpuUsed.user + cpuUsed.system) / 1000, wallMs };
}

/**
 * 第 1 天的 CPU 读数：读成 `0.00` 就再采，最多 `CPU_ATTEMPTS` 次，**取最大值**。
 *
 * Windows 上进程 CPU 记账跟着调度时钟走（约 15.6ms 一格），一天传播不到一格时
 * 两次 `process.cpuUsage()` 的差就是 0.00，**那次等于没量到**。重采是为了不让
 * 这一跑白跑；取最大而不是取平均，是因为平均会把唯一一次真读数（比如真退化到
 * 60ms 的那次）和两个 0 摊成 20ms，恰好把回归糊掉——闸要抓的是「最慢的那次」。
 */
function slowestDayCpu(buildingIds: readonly string[]): {
  cpuMs: number;
  wallMs: number;
  attempts: number[];
} {
  const attempts: number[] = [];
  let picked = oneDayTiming(buildingIds, 1);
  attempts.push(picked.cpuMs);
  while (picked.cpuMs === 0 && attempts.length < CPU_ATTEMPTS) {
    picked = oneDayTiming(buildingIds, 1);
    attempts.push(picked.cpuMs);
  }
  return { cpuMs: picked.cpuMs, wallMs: picked.wallMs, attempts };
}

/**
 * 两个配置各跑三次、**交错**采样，取各自最小值。
 *
 * 原来是一个配置跑完三次再跑另一个、取中位。2026-11-01 这套测试在整套套件
 * 并行跑时红过一次（`half` 比 `all` 的两倍还贵，隔离单跑三次全绿）：`node --test`
 * 并行跑文件，先跑的那一块整段吃别人的负载，中位在三次样本里扛不住连续两段噪声。
 *
 * 交错是为了让两组看到同一段机器状态；取最小值是因为噪声只会把读数往上加，
 * 最小值是这组里最接近「没有噪声时该花多少」的那个数。首跑含 JIT 预热，
 * 最小值顺带把它剔掉了。
 */
function interleavedMinMilliseconds(
  a: readonly string[],
  b: readonly string[],
  day: number,
): [number, number] {
  const as: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    as.push(oneDayTiming(a, day).wallMs);
    bs.push(oneDayTiming(b, day).wallMs);
  }
  return [Math.min(...as), Math.min(...bs)];
}

test('两个出货世界的 holder 数：设定集十六个，默认世界十三个', () => {
  // 注意：下面的计时夹具只放 2 个村民（`VILLAGERS`），不是设定集真实的 7 个——
  // 这条量的是「一张图上有多少楼」对传播代价的影响，村民数固定成 2 才可比。
  // 所以计时表里灯潮界是 11 个 holder，而这条断言的是真实人口 16。
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  assert.equal(pack.villagers.length + world.buildings.length, 16, '设定集的 holder 总数现在是十六个（七人 + 九楼）');
  assert.equal(VILLAGERS.length + defaultWorldBuildingIds().length, 13, '默认世界的 holder 总数不再是十三个');
});

test('一天的世界时间跑得完：默认世界最慢那天也在预算的 5 倍之内', (t) => {
  // 第 1 天是永远最慢的那天（所有断言都在那天出生），所以只量它。
  const buildings = defaultWorldBuildingIds();
  const day1 = slowestDayCpu(buildings);
  t.diagnostic(
    `默认世界第 1 天：CPU ${day1.cpuMs.toFixed(2)}ms`
      + `（墙钟 ${day1.wallMs.toFixed(2)}ms，仅附注，不参与判定）`
      + (day1.attempts.length > 1
        ? `；0.00 后重采 ${day1.attempts.length} 次：${day1.attempts.map((ms) => ms.toFixed(2)).join(' / ')}`
        : ''),
  );
  assert.ok(
    day1.cpuMs < CEILING_MS,
    `默认世界第 1 天的进程 CPU 时间 ${day1.cpuMs.toFixed(2)}ms`
      + `（墙钟 ${day1.wallMs.toFixed(2)}ms 仅附注）超过这道闸的 ${CEILING_MS}ms——`
      + `§3.2 B 的预算本身是 ${BUDGET_MS}ms/天，这一条放到 ${CEILING_MS / BUDGET_MS} 倍是为了不跟机器噪声红。`
      + '真超了的话先看是不是传播改成了每步全库扫描，再回来把文件头那张表改对。',
  );
  // 顺带把「稳态比第 1 天便宜」这个形状钉住。这条不量快慢，只量方向：
  // 库里只有遗忘没有新增，所以后面几天不该更贵。
  const steady = oneDayTiming(buildings, 6);
  t.diagnostic(
    `默认世界第 6 天：CPU ${steady.cpuMs.toFixed(2)}ms`
      + `（墙钟 ${steady.wallMs.toFixed(2)}ms，仅附注）`,
  );
  assert.ok(
    steady.wallMs < day1.wallMs * 2,
    `第 6 天墙钟 ${steady.wallMs.toFixed(2)}ms（CPU ${steady.cpuMs.toFixed(2)}ms 附注）`
      + `比第 1 天墙钟 ${day1.wallMs.toFixed(2)}ms（CPU ${day1.cpuMs.toFixed(2)}ms 附注）贵了一倍以上——`
      + '库里的东西只会被遗忘不会新增，稳态不该比开局贵。这条红说明传播的代价不再由存量决定。'
      + '（这条只量方向，读数用墙钟：不足一个调度刻度的 CPU 差值在 Windows 上读成 0）',
  );
});

test('传播的代价随规模走：holder 少一半的那次不该更贵', () => {
  // 原来的写法是「设定集（8 holder）比默认世界（13 holder）便宜」。设定集
  // 长到 11 个 holder 之后，这个前提没有了——两个出货世界已经不是一个量级，
  // 比它们比的是两张地图谁建得多，不是传播的机制。于是改成受控对照：同一套
  // 摆法，holder 数翻倍，比的是传播的机制。
  //
  // **2026-11-01 实测把对照搬了家。** 在出货世界的规模上（7 对 11 个 holder）
  // 这一天总耗时是 0.168ms 对 0.140ms——小的一方反而更贵，而这个差值在噪声里。
  // 不是机制坏了，是这个规模下固定开销把传播的信号埋掉了：`.tmp-audit/prop-scale-probe`
  // 扫了一遍，12 对 20 个 holder 时 all/half = 0.83，22 对 38 时 1.16，
  // 82 对 146 时 2.04——信号要到这个量级才出得来。所以对照改用合成的 holder 名单
  // （摆法不变：一字排开、间距 `talkDistance`、五个大事同一天出生）。出货世界的
  // 真实规模仍由上面两条守着：绝对预算闸，与「稳态不比第 1 天贵」的方向。
  //
  // 这条闸守的是**方向**（小世界不该更贵），不是上界：传播哪天变成每步全库扫描，
  // 抓它的是上面那道 50ms 的绝对闸，不是这一条。
  const half = Array.from({ length: 80 }, (_, i) => `b${i}`);
  const all = Array.from({ length: 144 }, (_, i) => `b${i}`);
  const [halfMs, allMs] = interleavedMinMilliseconds(half, all, 1);
  assert.ok(
    halfMs < allMs * 2,
    `${half.length + VILLAGERS.length} 个 holder 的世界（${halfMs.toFixed(2)}ms）比 `
      + `${all.length + VILLAGERS.length} 个 holder 的世界（${allMs.toFixed(2)}ms）还贵——传播的代价不再随规模走`,
  );
});
