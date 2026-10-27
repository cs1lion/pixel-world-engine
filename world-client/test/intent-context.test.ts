/**
 * 意图层把世界状态喂给模型。
 *
 * 三条要锁住的性质：
 *
 *   1. **上下文只描述现状，不接管判定。** 已经有某栋楼时模型仍该输出 build，
 *      让世界给出准确拒绝；把这一点写进提示词并被测试盯住，是因为它最容易
 *      在"接上状态"之后被顺手改成"有楼就答 unknown"。
 *   2. **省略上下文时整段不出现。** 写「世界状态未知」会让模型以为该去猜。
 *   3. **不发可推断的细节。** 只有建筑名与产能计数，没有坐标、占地、任务 id。
 *
 * （这里原来写着「`docs/WORLD_INTENT.md` §八 原先的已知边界」——**那个文档不存在**：
 * `git log --all --diff-filter=A -- 'docs/WORLD_INTENT.md'` 全史为空，`WORLD_INTENT`
 * 这个字样在全仓也只出现在这一行里。§八 更指不上：没有那本书，就没有第八章。
 * 引用已删；这三条性质的真实出处就是本文件 import 的那两个模块——
 * `src/world/intent-context.ts`（现状摘要）与 `src/world/intent-prompt.ts`（提示词）。）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { buildLargeWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { summarizeForIntent, renderIntentContext } from '../src/world/intent-context.ts';
import { buildIntentPrompt } from '../src/world/intent-prompt.ts';
import { createIntentClient } from '../src/world/intent-client.ts';
import { routeIntent } from '../src/world/intent-router.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

function makeSim(): Simulation {
  const world = buildLargeWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '莞尔',
    blueprints,
  });
}

// ------------------------------------------------------------ 上下文归纳

test('上下文按镇内 / 郊野分组列出已有建筑', () => {
  const context = summarizeForIntent(makeSim().snapshot());
  const townIds = context.built.town.map((entry) => entry.templateId);
  const wildIds = context.built.wild.map((entry) => entry.templateId);
  assert.ok(townIds.includes('code_forge'), '镇内应当有炼码工坊');
  assert.ok(wildIds.includes('crawler_mine'), '郊野应当有爬虫矿洞');
  // 民居不接活，但它确实在世界里——按郊野/镇内分组，不按接不接活分。
  assert.ok(
    [...townIds, ...wildIds].some((id) => id.startsWith('cottage_')),
    '镇内民居应当出现在镇内那一组',
  );
});

test('产能按活类型数，静息的也算', () => {
  const context = summarizeForIntent(makeSim().snapshot());
  const byKind = new Map(context.capacity.map((entry) => [entry.taskKind, entry.count]));
  for (const kind of ['code', 'research', 'writing'] as const) {
    assert.equal(byKind.get(kind), 2, `${kind} 应当有镇内 + 郊野各一栋`);
  }
});

test('开始没人干活，派活之后有人忙', () => {
  const sim = makeSim();
  const before = summarizeForIntent(sim.snapshot());
  assert.equal(before.busy.length, 0, '开局没人忙');
  assert.equal(before.queued, 0, '开局没有排队');

  sim.enqueue({ kind: 'dispatch', taskKind: 'code', summary: '写个爬虫' });
  sim.update(16);
  // 走几拍让她真的接单上路。
  for (let i = 0; i < 20; i += 1) sim.update(100);

  const after = summarizeForIntent(sim.snapshot());
  assert.ok(after.busy.length > 0, '派活之后应当有人忙着');
  assert.equal(after.busy[0]?.taskKind, 'code');
});

test('已建模板列在 exhausted 里：与世界的拒绝一致', () => {
  const context = summarizeForIntent(makeSim().snapshot());
  assert.ok(context.exhausted.includes('code_forge'));
  assert.ok(context.exhausted.includes('workshop_plot') === false, '还没建的模板不算耗尽');
});

test('不出现坐标：模型拿不到可推断的实现细节', () => {
  const context = summarizeForIntent(makeSim().snapshot());
  const text = renderIntentContext(context);
  assert.doesNotMatch(text, /\d+\s*,\s*\d+/, '渲染结果里不该有坐标对');
  // 结构层面也确认：条目只有 instanceId / templateId / name 三个键。
  // `instanceId` 与坐标不同——它不是实现细节，是**这栋楼的唯一名字**。
  // 没有它，模型说「拆掉 2 号抄书斋」时只能给模板，世界就得替它挑一栋。
  for (const entry of [...context.built.town, ...context.built.wild]) {
    assert.deepEqual(Object.keys(entry).sort(), ['instanceId', 'name', 'templateId']);
    assert.ok(entry.instanceId.length > 0);
  }
});

test('上下文里的实例 id 与世界里的建筑一一对应', () => {
  const snapshot = makeSim().snapshot();
  const context = summarizeForIntent(snapshot);
  const fromContext = [...context.built.town, ...context.built.wild]
    .map((entry) => entry.instanceId)
    .sort();
  const fromWorld = snapshot.buildings.map((building) => building.instanceId).sort();
  assert.deepEqual(fromContext, fromWorld, '模型看到的 id 必须是世界真的认的那些');
});

test('三档天气在给模型的现状里各说各的，暴雨不会被说成「下雨」', () => {
  // 说成「在下雨」时，模型会把用户说的「雨太大了」当成已经在办的事而答 unknown。
  const base = summarizeForIntent(makeSim().snapshot());
  const textFor = (weather: 'clear' | 'rain' | 'storm'): string =>
    renderIntentContext({ ...base, weather });

  assert.match(textFor('clear'), /天晴/);
  assert.match(textFor('rain'), /在下雨/);
  assert.match(textFor('storm'), /暴雨/);
  assert.notEqual(textFor('storm'), textFor('rain'), '暴雨不能和雨说成同一句');
});

// ------------------------------------------------------------ 提示词

test('提示词包含世界现状，并说明它不改变判断规则', () => {
  const context = summarizeForIntent(makeSim().snapshot());
  const prompt = buildIntentPrompt(blueprints, context);
  assert.match(prompt, /世界现在长什么样/);
  assert.match(prompt, /炼码工坊/);
  // 这四条是实测逼出来的：接上现状后模型一度开始替世界判可行性，
  // 「给我整个新铺子」从 build 退成 unknown（理由："没有指定铺子类型"）。
  assert.match(prompt, /现状不改变你输出的命令/, '少了这句，模型会拿现状当判据');
  assert.match(prompt, /仍然照常输出 build/, '已有建筑时仍要输出 build，让世界拒绝');
  assert.match(prompt, /只有用户在问现状时才答 unknown/, '要分清「打听」与「要求」');
  assert.match(
    prompt,
    /看用户.*要你做什么.*不看世界/s,
    '判断口诀要写明：看要求，不看现状',
  );
});

test('不给上下文时整段不出现，也不写「未知」', () => {
  const prompt = buildIntentPrompt(blueprints);
  assert.doesNotMatch(prompt, /世界现在长什么样/);
  assert.doesNotMatch(prompt, /世界状态未知/);
});

// ------------------------------------------------------------ 请求

test('客户端把上下文放进请求体', async () => {
  const calls: { body: string }[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: String(init?.body) });
    return new Response(JSON.stringify({ intent: { kind: 'complete' }, model: 'm', source: 'model' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const context = summarizeForIntent(makeSim().snapshot());
  const client = createIntentClient(() => blueprints, {
    fetchImpl: impl,
    context: () => context,
  });
  await client.classify('建个工坊');

  const body = JSON.parse(calls[0]!.body) as { context?: { exhausted: string[] } };
  assert.ok(body.context !== undefined, '应当带上 context');
  assert.ok(body.context.exhausted.includes('code_forge'));
});

test('不提供 context 时请求体里没有这个字段', async () => {
  const calls: { body: string }[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push({ body: String(init?.body) });
    return new Response(JSON.stringify({ intent: { kind: 'complete' }, model: 'm', source: 'model' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const client = createIntentClient(() => blueprints, { fetchImpl: impl });
  await client.classify('收工');

  const body = JSON.parse(calls[0]!.body) as Record<string, unknown>;
  assert.equal('context' in body, false, '省略而不是发 null');
});

// ------------------------------------------------------------ 路由

test('上下文送到模型手上，但不改变校验', async () => {
  const context = summarizeForIntent(makeSim().snapshot());
  let received: unknown = null;

  // 「把那间新工坊张罗起来」——规则三连都认不出（没有建/盖/造开头，
  // 也没有派活动词），才会落到模型那一路。
  const result = await routeIntent('把那间新工坊张罗起来', {
    templates: blueprints,
    worldSize: { width: 96, height: 72 },
    context,
    model: {
      async classify(_utterance, passed) {
        received = passed ?? null;
        // 模型照常输出 build，即使 workshop_plot 已经在 exhausted 里。
        return { kind: 'build', templateId: 'workshop_plot' };
      },
    },
  });

  assert.deepEqual(received, context, '模型应当收到上下文');
  assert.equal(result.intent.kind, 'build', '校验不看上下文：仍是一份合法的 build');
  assert.equal(result.source, 'model');
});

test('规则认得出时根本不问模型，上下文也就不参与', async () => {
  let asked = 0;
  const result = await routeIntent('下雨吧', {
    templates: blueprints,
    worldSize: { width: 96, height: 72 },
    context: summarizeForIntent(makeSim().snapshot()),
    model: {
      async classify() {
        asked += 1;
        return { kind: 'unknown', reason: '不该被问到' };
      },
    },
  });
  assert.equal(asked, 0, '规则命中就不该调模型');
  assert.equal(result.source, 'rule');
  assert.equal(result.intent.kind, 'setWeather');
});

// -------------------------------------------------- 渡有仪式进了现状

test('一道门都没有时，现状里一行都不多：莞尔镇不因此多出一句', () => {
  // 默认世界从来没有 `requires`。给它写一行「叠浪楼要一盏灯」是撒谎，
  // 而模型会拿这句话去解释用户明明在说的另一件事。
  const context = summarizeForIntent(makeSim().snapshot());
  assert.deepEqual(context.gated, [], '没有门就不该有这一项');
  assert.ok(
    !renderIntentContext(context).includes('才进得去'),
    '没有门的现状里不该出现门的说法',
  );
});

test('现状说出那道门：要什么、谁进得去、谁进不去', () => {
  const context = summarizeForIntent(
    makeSim().snapshot(),
    [{ id: 'bathhouse', name: '叠浪楼', needs: 'lamp' }],
  );
  assert.deepEqual(
    context.gated,
    [{ region: '叠浪楼', needs: 'lamp', passed: [], blocked: ['莞尔', '阿雾'] }],
    '默认世界的人两手空空，所以谁都进不去',
  );
  const rendered = renderIntentContext(context);
  assert.match(rendered, /叠浪楼要一盏灯才进得去/, '得说清是哪道门、要什么');
  assert.match(rendered, /莞尔、阿雾进不去/, '得说清此刻谁被拦着——两个都点名');
  assert.match(rendered, /carry/, '得告诉模型这件事能改——否则它只能答 unknown');
});

// -------------------------------------------------- 呼吸段进了现状

test('一处呼吸都没有时，现状里一行都不多：莞尔镇不因此多出一句', () => {
  // 与门同一条规矩：默认世界从来没有 `breathing`。给它写一行「浅滩轨道在呼吸」
  // 是撒谎，而模型会拿这句话去解释用户明明在说的另一件事。
  const context = summarizeForIntent(makeSim().snapshot(), [], []);
  assert.deepEqual(context.breathing, [], '没有呼吸段就不该有这一项');
  assert.ok(
    !renderIntentContext(context).includes('呼吸段'),
    '没有呼吸段的现状里不该出现呼吸段的说法',
  );
});

test('现状说「呼吸段」不说「留白」：留白在这个仓里另有所指', () => {
  // 落楼时四周要空出来的那一圈 margin 叫留白（`setup.ts` 的占地/留白/门口
  // 三查）。模型既要为 build 判那块 margin、又要读这一行，两个词混一个就说岔了。
  // SPEC_V2 §4.7 的标题「呼吸段（留白）」是给人看的 gloss，不是给模型的词。
  const context = summarizeForIntent(makeSim().snapshot(), [], [{ id: 'shoal', name: '浅滩轨道' }]);
  const rendered = renderIntentContext(context);
  assert.match(rendered, /浅滩轨道是呼吸段/, '给模型的那个词是呼吸段');
  assert.ok(!rendered.includes('留白'), '同一句里不能再出现留白——那是 margin 的词');
  assert.match(rendered, /没有命令能改它/, '得连「改不了」一起说，否则模型会去找一道门');
});

test('现状说出哪几处是留白：世界自己的节律也是能说出口的事', () => {
  // §4.7 说「留白也是规则，不是没内容」。不说出来，它就只是配置里的一行字——
  // 用户看到世界静了一瞬，不知道那是设定，会以为它卡了。
  const context = summarizeForIntent(
    makeSim().snapshot(),
    [],
    [{ id: 'shoal', name: '浅滩轨道' }],
  );
  assert.deepEqual(context.breathing, [{ region: '浅滩轨道' }]);
  assert.match(renderIntentContext(context), /浅滩轨道/, '得说清是哪一处在留白');
});

test('带上灯的人就在「进得去」那一侧：这是快照，不是永久属性', () => {
  const sim = makeSim();
  sim.enqueue({ kind: 'setCarries', villagerId: 'v0', carries: ['lamp'] });
  sim.update(16);
  const context = summarizeForIntent(sim.snapshot(), [
    { id: 'bathhouse', name: '叠浪楼', needs: 'lamp' },
  ]);
  assert.deepEqual(context.gated[0]?.passed, ['莞尔'], '她兜里有灯了，人就过得去');
  assert.deepEqual(context.gated[0]?.blocked, ['阿雾'], '另一个人还两手空空');
  assert.ok(!renderIntentContext(context).includes('没人进得去'));
});

test('提示词不许模型看见门就擅自发凭证：用户没说就不给', () => {
  // 与「看到没人干活不要自己补一句派活」是同一条纪律。现状里说出那道门，
  // 是为了让「让她进得去」这句话听得懂；不是为了请模型随手发灯。
  const prompt = buildIntentPrompt(blueprints, summarizeForIntent(makeSim().snapshot(), [
    { id: 'bathhouse', name: '叠浪楼', needs: 'lamp' },
  ]));
  assert.match(prompt, /不要自己给她一件/, '得把这条禁忌写进提示词');
});
