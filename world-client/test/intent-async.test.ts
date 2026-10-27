import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/world/simulation.ts';
import type { SimulationDeps } from '../src/world/simulation.ts';
import type { IntentModel } from '../src/world/intent-router.ts';
import { buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { readFileSync } from 'node:fs';

const templates = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);

function makeSim(model?: IntentModel): Simulation {
  const world = buildWorld(templates);
  const deps: SimulationDeps = {
    grid: world.grid,
    buildings: world.buildings,
    altar: world.altar,
    villagerName: '阿禾',
    blueprints: templates,
    intentModel: model,
    // 给世界一个造物主，模型判出的 build 才有地方落。
    spawnBuilding: (prefabId, instanceId, at, source) => {
      const blueprint = templates.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, world.altar, at, source);
    },
  };
  return new Simulation(deps);
}

/**
 * 推几拍，让命令队列结算。
 *
 * 模型是 async 的：先让微任务队列排空，再推拍子——否则模型还没回来，
 * 队列里就只有原来那一条。
 */
async function settle(sim: Simulation, ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    sim.update(16);
  }
}

/** 同 `settle`，但把这几拍结算出的回执收起来——回执只在当拍有效。 */
async function settleCollect(
  sim: Simulation,
  ticks = 3,
): Promise<readonly { ok: boolean; message: string }[]> {
  const collected: { ok: boolean; message: string }[] = [];
  for (let i = 0; i < ticks; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    collected.push(...sim.update(16));
  }
  return collected;
}

const say = (sim: Simulation, text: string) => sim.enqueue({ kind: 'oracle', raw: text });

/** 推一拍，返回本拍结算出的所有回执。 */
function tick(sim: Simulation): readonly { ok: boolean; message: string }[] {
  return sim.update(16);
}

// ---------------------------------------------------------------- 快环不阻塞

test('接了模型之后，投递仍然同步返回，不等网络', () => {
  let released: (() => void) | undefined;
  const model: IntentModel = {
    classify: () => new Promise((resolve) => { released = () => resolve({ kind: 'complete' }); }),
  };
  const sim = makeSim(model);

  // 关键：模型永远不回来，投递与结算也照常发生。
  say(sim, '把那份报告弄一下');
  const started = Date.now();
  tick(sim);
  assert.ok(Date.now() - started < 100, '一拍不得等网络');
  assert.ok(released !== undefined, '模型已经在后台被问了一次');
});

test('规则认得出的句子根本不问模型', async () => {
  const calls: string[] = [];
  const model: IntentModel = {
    classify: async (text) => { calls.push(text); return { kind: 'complete' }; },
  };
  const sim = makeSim(model);
  say(sim, '帮我写个爬虫');
  await settle(sim);
  assert.deepEqual(calls, [], '规则命中时一次都不问');
});

// ---------------------------------------------------------------- 模型结果回队

test('模型的意图回到命令队列并生效', async () => {
  const model: IntentModel = {
    classify: async () => ({ kind: 'setWeather', weather: 'rain' }),
  };
  const sim = makeSim(model);
  assert.equal(sim.snapshot().weather, 'clear');

  say(sim, '把那份报告弄一下');
  await settle(sim);
  assert.equal(sim.snapshot().weather, 'rain', '模型的意图真的改变了世界');
});

test('模型判出的拨潮，落到与规则同一条有期限的覆盖上', async () => {
  // 模型这条路不能有特权：它拨出来的潮位覆盖与「涨潮」那条规则命令
  // 必须走同一个 `setTideLevel`，否则两条路的到期语义迟早会分叉。
  const model: IntentModel = {
    classify: async () => ({ kind: 'setTide', level: 1, durationMs: 30_000 }),
  };
  const sim = makeSim(model);
  say(sim, '把水涨上来一点');
  await settle(sim);

  const tide = sim.snapshot().tide;
  assert.equal(tide.level, 1);
  assert.equal(tide.overridden, true, '模型拨的潮同样是有期限的覆盖，不是永久设值');
});

test('模型判出的造物，落的还是同一套校验', async () => {
  const model: IntentModel = {
    classify: async () => ({ kind: 'build', templateId: 'workshop_plot' }),
  };
  const sim = makeSim(model);
  const before = sim.snapshot().buildings.length;
  say(sim, '把那份报告弄一下');
  await settle(sim);
  assert.equal(sim.snapshot().buildings.length, before + 1);
});

// ---------------------------------------------------------------- 失败必须不动世界

test('模型抛错 → 世界不动，也不猜', async () => {
  const model: IntentModel = {
    classify: async () => { throw new Error('timeout'); },
  };
  const sim = makeSim(model);
  const before = sim.snapshot();
  say(sim, '把那份报告弄一下');
  await settle(sim);
  const after = sim.snapshot();
  assert.equal(after.weather, before.weather);
  assert.equal(after.buildings.length, before.buildings.length);
  assert.equal(after.tasks.length, before.tasks.length);
});

test('模型输出非法 → 世界不动', async () => {
  const model: IntentModel = { classify: async () => ({ kind: 'teleport' }) };
  const sim = makeSim(model);
  const before = sim.snapshot();
  say(sim, '瞬移吧');
  await settle(sim);
  assert.equal(sim.snapshot().buildings.length, before.buildings.length);
  assert.equal(sim.snapshot().weather, before.weather);
});

test('模型说 unknown → 世界不动', async () => {
  const model: IntentModel = {
    classify: async () => ({ kind: 'unknown', reason: '在征求意见' }),
  };
  const sim = makeSim(model);
  const before = sim.snapshot();
  say(sim, '你觉得该怎么办');
  await settle(sim);
  assert.equal(sim.snapshot().buildings.length, before.buildings.length);
});

// ---------------------------------------------------------------- 原因要送到用户手里

test('模型说听不懂的理由，原样出现在回执上', async () => {
  // 「这句话没有要求世界做任何事」与「模型超时」对用户意味着完全不同的下一步：
  // 前者该换句话，后者该去看服务端。一句通用的「没听懂」把这两件事抹平了。
  const model: IntentModel = {
    classify: async () => ({ kind: 'unknown', reason: '这句话没有要求世界做任何事' }),
  };
  const sim = makeSim(model);
  say(sim, '你觉得该怎么办');
  const receipts = await settleCollect(sim);
  const receipt = receipts.find((item) => !item.ok);
  assert.ok(receipt !== undefined, '应当有一条拒绝回执');
  assert.equal(receipt.message, '这句话没有要求世界做任何事');
});

test('模型那一段出错时，回执说的是那条错，不是「没听懂」', async () => {
  const model: IntentModel = {
    classify: async () => {
      throw new Error('调用模型超时 10000ms');
    },
  };
  const sim = makeSim(model);
  say(sim, '把那份报告弄一下');
  const receipts = await settleCollect(sim);
  const receipt = receipts.find((item) => !item.ok);
  assert.ok(receipt !== undefined, '应当有一条拒绝回执');
  assert.match(receipt.message, /超时/);
  assert.doesNotMatch(receipt.message, /没听懂/);
});

// ---------------------------------------------------------------- 离线降级

test('没有模型时，认不出就是认不出', () => {
  const sim = makeSim();
  say(sim, '把那份报告弄一下');
  const result = tick(sim)[0];
  assert.ok(result !== undefined, '应当有一条回执');
  assert.equal(result.ok, false);
  assert.match(result.message, /没听懂/);
});

test('问模型的路上出了岔子，不会变成一次未捕获的 Promise 拒绝', async () => {
  // `speak()` 用 `void` 调 `classifyLater()`，没人 await 它。`routeIntent`
  // 只把**模型那一段**吞成 unknown——它的 try 从 `classify` 才开始，前面的
  // 规则段（`matchRules` → 各解析器 → 查模板表）在外面。那里抛出来的东西
  // 会一路逃到浏览器，成为一次 unhandledRejection。
  //
  // 让模板表在**第二次**查表时抛：第一次是 `speak()` 的同步解析（它必须活着
  // 才能走到"去问模型"），第二次是 `classifyLater` 里 `routeIntent` 的规则段。
  // 这样打中的正是那条没人 await 的路径，而不是同步那条。
  // 「造物主不可用时世界照常运行」要是靠运气成立，就不算成立。
  const rejections: unknown[] = [];
  const onRejection = (why: unknown): void => {
    rejections.push(why);
  };
  process.on('unhandledRejection', onRejection);
  try {
    let lookups = 0;
    const broken = {
      has(): boolean {
        lookups += 1;
        if (lookups > 1) throw new Error('注册表坏了');
        return false;
      },
      get(): undefined {
        return undefined;
      },
    } as unknown as ReadonlyMap<string, never>;

    const world = buildWorld(templates);
    const sim = new Simulation({
      grid: world.grid,
      buildings: world.buildings,
      altar: world.altar,
      villagerName: '阿禾',
      blueprints: broken,
      intentModel: { classify: async () => ({ kind: 'unknown', reason: '闲聊' }) },
    });

    say(sim, '建一间书阁');
    await settle(sim);
    sim.update(16);
    // Node 在微任务排空之后才报未捕获拒绝，多等一轮才查得到。
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(rejections, [], '没人 await 的 async 方法必须自己接住');
    assert.ok(sim.snapshot().now > 0, '世界照常在走');
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('同一句话连着说三遍，只问模型一次', async () => {
  let calls = 0;
  const model: IntentModel = {
    classify: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { kind: 'unknown', reason: '闲聊' };
    },
  };
  const sim = makeSim(model);
  say(sim, '今天好累啊');
  tick(sim);
  say(sim, '今天好累啊');
  tick(sim);
  say(sim, '今天好累啊');
  await settle(sim, 6);
  assert.equal(calls, 1, '去重是按原话，不是按时间窗');
});

// ---------------------------------------------- 迟到的答复不抢回执那一行

/** 一个要等人放行的模型：`release()` 之前它永远不回来。 */
function gatedModel(answer: unknown): { readonly model: IntentModel; readonly release: () => void } {
  let release: (() => void) | undefined;
  const model: IntentModel = {
    classify: () => new Promise((resolve) => { release = () => resolve(answer); }),
  };
  return { model, release: () => release?.() };
}

test('用户又说了话，迟到的模型答复不抢回执那一行', async () => {
  // 一次真事的回归，在真的浏览器里复现过（`scripts/_probe-late.mjs`）：
  // 「今天天气不错」送进模型，紧接着说「下雨了」，屏上先是对的
  // 「雨落下来了。」，4.8 秒后那一行变成「你只是在感叹天气……所以世界
  // 不动」——而屏上正在下雨。
  //
  // 那不是盖掉一句话的事，是一句假话：回执说世界没动，世界动了。
  // 与上游轮询每 4 秒擦一次回执（`feed-quiet-offline.test.ts`）是同一条规矩：
  // 回执那一行是**用户自己的话**的归宿，不是任何别的东西的归宿——
  // 包括用户自己早先说过的另一句。
  const { model, release } = gatedModel({ kind: 'unknown', reason: '在感叹天气' });
  const sim = makeSim(model);

  say(sim, '今天天气不错');
  const [asked] = tick(sim);
  assert.equal(asked!.message, '这句话规则认不出，正在问模型……');

  // 用户紧接着说了第二句：规则认得出，当场就办。
  say(sim, '下雨了');
  const [rained] = tick(sim);
  assert.equal(rained!.message, '雨落下来了。');

  // 模型那边现在才回来。世界效果照算（这里是「不动」），话不往那一行上说。
  release();
  const late = await settleCollect(sim);
  for (const result of late) {
    assert.equal(result.message, '', `迟到的答复该安静，实际说的是「${result.message}」`);
  }
});

test('迟到的答复改了世界，也不抢回执那一行', async () => {
  // 上一条的反方向：别把安静做成「世界也不动了」。模型判出来的是一条真命令，
  // 该下的雨照样下、石板照样刻。要拦的只是那句话别落到 `#reply` 上——
  // 那一行归用户最新那句话。
  const { model, release } = gatedModel({ kind: 'setTide', level: 1, durationMs: 30_000 });
  const sim = makeSim(model);

  say(sim, '把水弄一弄');
  tick(sim);
  say(sim, '下雨了');
  const [rained] = tick(sim);
  assert.equal(rained!.message, '雨落下来了。');

  release();
  const late = await settleCollect(sim);
  for (const result of late) {
    assert.equal(result.message, '', `迟到的答复该安静，实际说的是「${result.message}」`);
  }
  const tide = sim.snapshot().tide;
  assert.equal(tide.level, 1, '潮照样拨——拦的是那句话，不是那件事');
  assert.equal(tide.overridden, true, '落的还是那条有期限的覆盖，不是永久设值');
  assert.ok(sim.snapshot().oracle.length > 0, '石板照样刻：世界自己的记忆不归回执那一行管');
});

test('没人插话，模型的答复照常上回执那一行', async () => {
  // 反方向：别把这条规矩做成永久的沉默。模型答的就是用户刚说的那一句时，
  // 它该出现——包括模型说听不懂的理由（那正是用户下一步的依据）。
  const { model, release } = gatedModel({ kind: 'unknown', reason: '这句话没有对应的世界命令' });
  const sim = makeSim(model);

  say(sim, '你觉得该怎么办');
  tick(sim);
  release();
  const late = await settleCollect(sim);
  assert.ok(
    late.some((result) => result.message === '这句话没有对应的世界命令'),
    `该说的没说：${late.map((r) => r.message).join(' / ')}`,
  );
});
