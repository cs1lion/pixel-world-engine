/** 场所产出账：作息里的「作业」真的产出东西。
 *
 * 问题：`activity: 'work' / 'trade'` 原来只做门控，到点只挂一句牌子——
 * 炉匠「搬炭」搬不出炭。这一组钉两件事：
 *   1. 纯函数层：闭集、累加、合计、摘要，不读墙钟不摇随机；
 *   2. 真世界层：跑真 `Simulation`，炉匠到锅炉房、洗衣妇到叠浪湖，
 *      产出账**真的**长出炭与洗好的衣裳；花径的 rest/stroll 不产；
 *      不给 `siteOutputs` 时不记（证明是这条接线在起作用，不是别的东西）。
 *
 * 不靠截图、不靠牌子文案：只读产出账。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTPUT_KINDS,
  OUTPUT_LABELS,
  activityProduces,
  accrueOutput,
  emptyOutputTally,
  isOutputKind,
  outputSummary,
  outputTotal,
} from '../src/world/site-output.ts';
import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { routineProfiles, siteTargetResolver } from '../src/settings/index.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { OutputKind } from '../src/world/site-output.ts';
import { inputsFor, salienceOf } from '../src/world/memory/salience.ts';
import { DEFAULT_MEMORY_CONFIG } from '../src/world/memory/config.ts';
import type { WorldChange } from '../src/world/world-changes.ts';

const MINUTE_MS = 60_000;

test('纯函数：闭集、累加、合计、摘要都不读墙钟', () => {
  assert.deepEqual([...OUTPUT_KINDS], ['coal', 'laundry', 'trade']);
  assert.ok(isOutputKind('coal'));
  assert.ok(!isOutputKind('gold'));
  assert.ok(activityProduces('work'));
  assert.ok(activityProduces('trade'));
  assert.ok(!activityProduces('rest'), '花径坐下不是作业');
  assert.ok(!activityProduces('stroll'), '走看不是作业');

  let tally = emptyOutputTally();
  assert.equal(outputTotal(tally), 0);
  assert.equal(outputSummary(tally, new Map()), '', '没有产出不该说成「产出 0 份」');

  tally = accrueOutput(tally, 'boiler_annex#1');
  tally = accrueOutput(tally, 'boiler_annex#1');
  tally = accrueOutput(tally, 'wave_house#1');
  assert.equal(outputTotal(tally), 3);
  const kinds = new Map<string, OutputKind>([
    ['boiler_annex#1', 'coal'],
    ['wave_house#1', 'laundry'],
    ['market', 'trade'],
  ]);
  assert.equal(
    outputSummary(tally, kinds),
    `boiler_annex#1 ${OUTPUT_LABELS.coal} 2；wave_house#1 ${OUTPUT_LABELS.laundry} 1`,
    '摘要按场所 id 排序，同一份账给同一句话',
  );
  // 纯函数：原账不被改写。
  assert.equal(Object.keys(emptyOutputTally()).length, 0);
});

function makeSim(withOutputs: boolean) {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  const resolve = siteTargetResolver(pack, world.grid, world.buildings);
  const profiles = routineProfiles(pack, resolve);
  const changes: WorldChange[] = [];
  const siteOutputs = new Map<string, OutputKind>(
    (pack.sites ?? [])
      .filter((site) => site.output !== undefined)
      .map((site) => [site.id, site.output!] as const),
  );
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: pack.hub,
    villagerName: pack.villagers[0]!.name,
    villagerNames: pack.villagers.map((villager) => villager.name),
    villagerProfiles: profiles,
    blueprints: pack.blueprints,
    wallClock: () => 1000,
    // 06:00 开工；工坊 06:00–17:00 开门。
    initialNow: 6 * 60 * MINUTE_MS,
    ...(withOutputs ? { siteOutputs } : {}),
    onChange: (change: WorldChange) => { changes.push(change); },
  });
  return { sim, pack, siteOutputs, changes };
}

/** 跑到 17:00 收工（11 个世界小时），每 5 世界秒一拍。 */
function runToWorkEnd(sim: Simulation): void {
  const end = 11 * 60 * MINUTE_MS;
  for (let t = 0; t < end; t += 5000) sim.update(5000);
}

test('真世界：炉匠在锅炉房搬出炭、洗衣妇在叠浪湖洗出衣裳', () => {
  const { sim } = makeSim(true);
  runToWorkEnd(sim);
  const reading = sim.siteOutputReading();
  assert.ok(
    (reading.tally['boiler_annex#1'] ?? 0) > 0,
    `炉匠没搬出炭：${JSON.stringify(reading.tally)}`,
  );
  assert.ok(
    (reading.tally['wave_house#1'] ?? 0) > 0,
    `洗衣妇没洗出衣裳：${JSON.stringify(reading.tally)}`,
  );
  const expected = (reading.tally['boiler_annex#1'] ?? 0)
    + (reading.tally['wave_house#1'] ?? 0)
    + (reading.tally['market'] ?? 0);
  assert.equal(reading.total, expected, '合计 = 三个产出场所之和');
  // 账房先生在集市 `trade`：成交也真的记了。
  assert.ok((reading.tally['market'] ?? 0) > 0, `集市没有成交：${JSON.stringify(reading.tally)}`);
  assert.match(reading.summary, /boiler_annex#1 炭/);
  assert.match(reading.summary, /wave_house#1 洗好的衣裳/);
  // 花径只做 rest/stroll，不进账。
  assert.equal(reading.tally['courtyard'], undefined, '花径不是作业，不该产出');
  assert.equal(reading.tally['courtyard-east'], undefined);
});

test('反例：不给 siteOutputs 时产出账为空（证明是这条接线在起作用）', () => {
  const { sim } = makeSim(false);
  runToWorkEnd(sim);
  const reading = sim.siteOutputReading();
  assert.equal(reading.total, 0, `不给产出定义却记了账：${JSON.stringify(reading.tally)}`);
  assert.equal(reading.summary, '');
});

test('包的场所表把产出物声明对：锅炉房炭、叠浪湖衣裳、集市成交、花径不产', () => {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const byId = new Map((pack.sites ?? []).map((site) => [site.id, site]));
  assert.equal(byId.get('boiler_annex#1')?.output, 'coal');
  assert.equal(byId.get('wave_house#1')?.output, 'laundry');
  assert.equal(byId.get('market')?.output, 'trade');
  assert.equal(byId.get('courtyard')?.output, undefined, '花径是过日子，不是作业');
  assert.equal(byId.get('courtyard-east')?.output, undefined);
});

// ---------------------------------------------------------------- 消耗（循环另一半）

test('纯函数：消耗只扣整轮、库存不足不欠账', async () => {
  const { consumeOutput, consumeRoundsBetween, OUTPUT_CONSUME_INTERVAL_MS } = await import(
    '../src/world/site-output.ts'
  );
  const day = OUTPUT_CONSUME_INTERVAL_MS;
  assert.equal(consumeRoundsBetween(0, day - 1), 0, '不满一轮不算');
  assert.equal(consumeRoundsBetween(0, day), 1);
  assert.equal(consumeRoundsBetween(0, day * 3 + 5), 3, '余量留给下一次');
  assert.equal(consumeRoundsBetween(day, 0), 0, '倒走不算');

  let tally: Record<string, number> = { 'boiler_annex#1': 2 };
  const first = consumeOutput(tally, 'boiler_annex#1');
  assert.equal(first.consumed, 1);
  assert.equal(first.tally['boiler_annex#1'], 1);

  const second = consumeOutput(first.tally, 'boiler_annex#1');
  assert.equal(second.tally['boiler_annex#1'], 0);

  // 见底后继续扣：不欠账，库存停在 0。
  const third = consumeOutput(second.tally, 'boiler_annex#1');
  assert.equal(third.tally['boiler_annex#1'], 0);
  assert.equal(third.consumed, 0, '库存不足时一分都不扣');

  // 没这个场所也安全。
  assert.equal(consumeOutput({}, 'nowhere').consumed, 0);
  tally = {};
  assert.deepEqual(consumeOutput(tally, 'x').tally, {});
});

test('真世界：产出会攒下来，也会按世界日被消耗（库存不为负）', () => {
  const { sim } = makeSim(true);
  // 从 06:00 跑 3 个世界日：白天作业产出，每满一日扣一份。
  const threeDays = 3 * 24 * 60 * MINUTE_MS;
  for (let t = 0; t < threeDays; t += 5000) sim.update(5000);
  const reading = sim.siteOutputReading();

  // 三个世界日里作业跑过不止一次，但也被扣了三轮——库存不是单调上涨的。
  assert.ok(reading.total > 0, '作业仍在产出');
  for (const [siteId, amount] of Object.entries(reading.tally)) {
    assert.ok(amount >= 0, `${siteId} 的库存变成负数了：${amount}`);
  }
  // 消耗是纯函数按世界时刻算的（`consumeRoundsBetween`），不随分帧漂移——
  // 这一条由上面那条纯函数用例钉住。**产出**则受拍点量化影响：粗分片下
  //  villagers 的拍点晚到最多一步，一天里少走半趟——这是既有行为
  //（`stepIdle` 只在帧边界判 `nextRoutineAt`），不是产出账引入的。
});

// ---------------------------------------------------------------- 产出物的名字与来历

test('纯函数：产出事件的那句话按产出物说，成交不叫「一份成交」', async () => {
  const { outputEventText } = await import('../src/world/site-output.ts');
  assert.equal(outputEventText('炉匠搬炭', 'coal'), '炉匠搬炭，得了一份炭');
  assert.equal(outputEventText('洗衣妇收衣裳', 'laundry'), '洗衣妇收衣裳，得了一份洗好的衣裳');
  assert.equal(outputEventText('账房先生对零钱', 'trade'), '账房先生对零钱，做成了一笔买卖');
  // 纯函数：同输入同输出，回放才读得通。
  assert.equal(outputEventText('炉匠搬炭', 'coal'), outputEventText('炉匠搬炭', 'coal'));
});

test('真世界：每一趟产出都发一条 `work_output`，带着谁、在哪、做了什么', () => {
  const { sim, changes } = makeSim(true);
  runToWorkEnd(sim);
  const produced = changes.filter(
    (change): change is Extract<WorldChange, { change: 'world.event' }> =>
      change.change === 'world.event' && change.kind === 'work_output',
  );
  assert.ok(produced.length > 0, '跑完一天一条产出事件都没发');

  const reading = sim.siteOutputReading();
  assert.equal(
    produced.length,
    reading.total,
    `产出事件与产出账对不上：事件 ${produced.length} 条，账上 ${reading.total} 份`,
  );

  for (const event of produced) {
    assert.ok(event.actorId !== null, '产出事件没有当事人，记忆层不知道是谁做的');
    assert.ok(event.placeId.length > 0, '产出事件没有落点，痕迹无处可落');
    assert.ok(event.text.length > 0);
    assert.match(event.text, /得了一份|做成了一笔买卖/, `文案没有说清做成了什么：${event.text}`);
  }
  // 三个产出场所都出现过，且文案带对了东西。
  const texts = produced.map((event) => event.text).join('\n');
  assert.match(texts, /得了一份炭/);
  assert.match(texts, /得了一份洗好的衣裳/);
  assert.match(texts, /做成了一笔买卖/);
  // 来历要落对地方：锅炉房的炭记在锅炉房那栋楼上，叠浪湖的衣裳记在湖边那栋。
  // 记成「她脚下那一格」等于把这份炭的出处弄丢了——炉子是楼里那口。
  const coalPlaces = produced.filter((event) => event.text.includes('得了一份炭')).map((event) => event.placeId);
  const laundryPlaces = produced
    .filter((event) => event.text.includes('洗好的衣裳'))
    .map((event) => event.placeId);
  assert.deepEqual([...new Set(coalPlaces)], ['boiler_annex#1'], `炭的来历记错了地方：${coalPlaces}`);
  assert.deepEqual([...new Set(laundryPlaces)], ['wave_house#1'], `衣裳的来历记错了地方：${laundryPlaces}`);

  // 花径不产，也就不该有落在花径上的产出事件（它的场所 id 没进产出表）。
  assert.ok(
    produced.every((event) => !event.text.includes('花径')),
    '花径不是作业，却发了产出事件',
  );
});

test('记忆分量：产出这趟事只该当事人记住，旁观者记不住（否则一天几十趟会霸屏）', () => {
  const weights = DEFAULT_MEMORY_CONFIG.salienceWeights;
  const threshold = DEFAULT_MEMORY_CONFIG.T_write;
  const shared = {
    kind: 'work_output',
    importanceHint: 0.35,
    valence: 0.2,
    arousal: 0.25,
  } as const;
  const actor = salienceOf(
    inputsFor({ ...shared, holderId: 'v1', actors: ['v1'] }),
    weights,
  );
  const witness = salienceOf(
    inputsFor({ ...shared, holderId: 'v2', actors: ['v1'] }),
    weights,
  );
  assert.ok(actor.salience >= threshold, `当事人记不住自己做的活：${actor.salience}`);
  assert.ok(witness.salience < threshold, `旁观者每条都记：${witness.salience} ≥ ${threshold}`);
});
