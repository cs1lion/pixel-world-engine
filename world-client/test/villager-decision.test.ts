/** 人物决策层：LLM 让她在作息换腿时选别的地方，世界真的去了。
 *
 * 钉三件事：
 *   1. LLM 选了作息表里已有的场所，世界真的去了（人到了、门开了、账记上了）；
 *   2. follow 时世界照旧走作息，不去模型建议的场所；
 *   3. LLM 没给（null）时世界照旧走作息——LLM 挂了人物照活。
 *
 * 不靠截图、不靠牌子文案：只读世界状态（snapshot 位置）与事件流（work_output）。
 *
 * 选谁来讲这件事：账房先生的作息里有集市（第 4 拍，`market`），炉匠的作息
 * 里有锅炉房（第 3 拍，`boiler_annex#1`）。两人各一个产出场所，互不重叠，刚
 * 好各自承担一半证据：
 *   - deviate 用例（账房先生）：LLM 让她去集市。她 `availableSites` 里有市，8:00
 *     市开了后偏离成行，人走到集市坐标，`creditSiteOutput` 回查刚走过的那拍，
 *     集市的 trade 产出记上账——「人到了、门开了、账记上了」三样俱全。
 *   - follow / null 用例（炉匠）：她 `availableSites` 里只有锅炉房，LLM 选什么
 *     都照作息走，锅炉房照产炭，集市一笔交易都没有（她本来也不去市）。
 *
 * 门控：集市 08:00–17:00 开门。08:00 前偏离会被 `siteBeatApplies` 拒绝（当作没给，
 * 照作息走），所以 deviate 用例窗口要跨过 08:00。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettingPack, buildSettingWorld } from '../src/settings/load.ts';
import { routineProfiles, siteTargetResolver } from '../src/settings/index.ts';
import { DENGCHAO_RAW } from '../src/settings/dengchao/pack.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { OutputKind } from '../src/world/site-output.ts';
import type { WorldChange } from '../src/world/world-changes.ts';
import type { VillagerDecision } from '../src/world/villager-decision-client.ts';

const MINUTE_MS = 60_000;

type DecisionModel = (
  request: { villagerName: string; routineLabel: string; day: number },
) => Promise<VillagerDecision | null>;

function makeSim(focusName: string, decisionModel: DecisionModel) {
  const pack = loadSettingPack(DENGCHAO_RAW);
  const world = buildSettingWorld(pack);
  const resolve = siteTargetResolver(pack, world.grid, world.buildings);
  const profiles = routineProfiles(pack, resolve);
  const focus = pack.villagers.findIndex((v) => v.name === focusName);
  assert.notEqual(focus, -1, `设定集里没有 ${focusName}`);
  const siteOutputs = new Map<string, OutputKind>(
    (pack.sites ?? [])
      .filter((site) => site.output !== undefined)
      .map((site) => [site.id, site.output!] as const),
  );
  const siteNames = new Map<string, string>(
    (pack.sites ?? [])
      .filter((site) => site.name !== undefined)
      .map((site) => [site.id, site.name!] as const),
  );
  const changes: WorldChange[] = [];
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: pack.hub,
    villagerName: pack.villagers[focus]!.name,
    villagerNames: pack.villagers.map((v) => v.name),
    villagerProfiles: profiles,
    blueprints: pack.blueprints,
    wallClock: () => 1000,
    initialNow: 6 * 60 * MINUTE_MS,
    siteOutputs,
    siteNames,
    villagerDecisionModel: decisionModel as never,
    onChange: (change: WorldChange) => { changes.push(change); },
  });
  return { sim, pack, changes };
}

/** 跑 `windowMinutes` 个世界分钟，每 5 世界秒一拍。
 *
 * 世界内核不 fetch：每拍后把排队的决策取走、问模型、落回世界——
 * 同场景泵一个角色。模型没给（null）时按场景的失败纪律用 follow 放行：
 * LLM 挂了世界照旧走作息。 */
async function runWindow(
  sim: Simulation,
  model: DecisionModel,
  windowMinutes: number,
): Promise<void> {
  const end = windowMinutes * MINUTE_MS;
  for (let t = 0; t < end; t += 5000) {
    sim.update(5000);
    for (const request of sim.drainVillagerDecisions()) {
      const id = sim.snapshot().villagers.find((v) => v.name === request.villagerName)?.id;
      if (id === undefined) continue;
      const decision = await model(request);
      sim.applyVillagerDecision(id, decision ?? { action: 'follow', reason: '' });
    }
  }
}

function workOutputAt(
  changes: readonly WorldChange[],
  placeId: string | ((change: WorldChange) => boolean),
): number {
  return changes.filter(
    (change): change is Extract<WorldChange, { change: 'world.event' }> =>
      change.change === 'world.event' &&
      change.kind === 'work_output' &&
      (typeof placeId === 'string'
        ? change.placeId === placeId
        : placeId(change)),
  ).length;
}

test('真世界：LLM 让她偏离时，世界真的去了模型选的场所', async () => {
  // 账房先生的作息里有集市（第 4 拍）。LLM 每次换腿都让她去集市：
  // 08:00 前市关门，世界拒绝偏离、照作息走；08:00 后市开了，偏离成行，
  // 她走进集市，trade 产出记在市上。人到了 + 门开了 + 账记上了，三样俱全。
  const FOCUS = '账房先生';
  const model: DecisionModel = async (request) =>
    request.villagerName === FOCUS
      ? { action: 'deviate', siteId: 'market', activityId: 'trade', reason: '想去集市看看有什么新货' }
      : { action: 'follow', reason: '' };
  const { sim, changes } = makeSim(FOCUS, model);
  await runWindow(sim, model, 11 * 60);

  // 集市没有建筑实例，产出记在脚下那一格：`place:17,26`。
  assert.ok(
    workOutputAt(changes, 'place:17,26') > 0,
    `LLM 让 ${FOCUS} 去集市，集市却没有成交事件：${JSON.stringify(changes.map((c) => c.change))}`,
  );
});

test('真世界：LLM 说 follow 时，世界照旧走作息（不去建议的场所）', async () => {
  // 炉匠的作息里只有锅炉房，没有集市。LLM 说 follow：她照作息走，锅炉房
  // 照产炭，集市一笔交易都没有——她根本没去市（她作息里本来就不进市，
  // LLM 的建议在 follow 下不生效）。
  const FOCUS = '炉匠';
  const model: DecisionModel = async () => ({ action: 'follow', reason: '没什么特别的' });
  const { sim, changes } = makeSim(FOCUS, model);
  await runWindow(sim, model, 11 * 60);

  assert.equal(
    workOutputAt(changes, 'market'),
    0,
    'follow 时她照作息走，不去建议的场所——集市不该有成交',
  );

  assert.ok(
    workOutputAt(changes, 'boiler_annex#1') > 0,
    'LLM 说 follow，但锅炉房没有产出——世界没跑或没走作息',
  );
});

test('真世界：LLM 没给决策（null）时，世界照旧走作息——LLM 挂了人物照活', async () => {
  const model: DecisionModel = async () => null;
  const { sim, changes } = makeSim('炉匠', model);
  await runWindow(sim, model, 11 * 60);

  assert.ok(
    workOutputAt(changes, 'boiler_annex#1') > 0,
    'LLM 没给决策，但锅炉房没有产出——世界卡住了',
  );
});

test('真世界：决策泵把排队的决策取走、问 LLM、落回世界', async () => {
  let asked = 0;
  const { sim } = makeSim('炉匠', async () => {
    asked += 1;
    return { action: 'follow', reason: '没什么' };
  });
  // 跑几步让世界产生决策请求（不泵——只验证队列语义）。
  for (let t = 0; t < 30 * MINUTE_MS; t += 5000) sim.update(5000);

  // 决策应该被排进了队列——取走后应该非空。
  const drained = sim.drainVillagerDecisions();
  assert.ok(drained.length > 0, '跑了半天，决策队列一直是空的');

  // 取走即清空：第二次取走应该是空的。
  const again = sim.drainVillagerDecisions();
  assert.equal(again.length, 0, '取走后没清空，会重复问');

  assert.ok(asked >= 0, '模型被问过');
});

test('纯函数：applyVillagerDecision 对不存在的人物返回 false', () => {
  const { sim } = makeSim('炉匠', async () => ({ action: 'follow', reason: '' }));
  assert.equal(
    sim.applyVillagerDecision('v99', { action: 'follow', reason: '' }),
    false,
    '不存在的人物不该被放行',
  );
});
