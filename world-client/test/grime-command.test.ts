import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import type { PropKind } from '../src/world/types.ts';
import { GRIME_CLEAN, GRIME_FILL_MS, GRIME_FULL } from '../src/world/grime.ts';

/**
 * 清洗即还原（SPEC_V2 §4.6）的命令入口半边（SPEC_V2 §5 的第一道接缝）。
 *
 * 纯函数那半在 `grime.test.ts`。这里只问一件事：**这条命令进了世界之后，
 * 世界因此少了什么、多了什么。**
 *
 * 与 `setCarries` / `setNameState` 同一条规矩：它们都只存在于客户端的
 * `WorldCommand` 里，服务端收不到（`server/tests/test_rules_schema.py` 钉着）。
 * 清洗也一样——它是世界侧的一个状态开关，不是上游能说的话。
 */

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

/** 灯潮界不给话，所以这儿给两份：点亮池给 lamp，树种池给 tree。 */
const REVEALS: ReadonlyMap<PropKind, readonly string[]> = new Map([
  ['lamp', ['井底下压着一句话', '潮声记得每一个过客']],
  ['tree', ['根须里缠着半张药方']],
]);

/**
 * 世界。`reveals` 省掉就是「这本设定集一句都没给」——莞尔镇的样子，
 * 于是没有一件摆件会脏。两个夹具只差这一项，所以它是一个参数不是两份。
 */
function makeSim(reveals?: ReadonlyMap<PropKind, readonly string[]>): Simulation {
  const world = buildWorld(blueprints);
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    wallClock: () => 1000,
    ...(reveals !== undefined ? { propReveals: reveals } : {}),
  });
}

/** 走一条命令。命令入口是 enqueue + update，apply 是私有的。 */
function run(sim: Simulation, command: Parameters<Simulation['enqueue']>[0]) {
  sim.enqueue(command);
  const results = sim.update(16);
  return results[results.length - 1]!;
}

/** 送三单 quick，等到一个里程碑落下（一件摆件进世界）。 */
function untilOneProp(sim: Simulation): void {
  const delivered = (): boolean => sim.snapshot().props.length > 0;
  let guard = 0;
  for (const summary of ['第一单', '第二单', '第三单']) {
    sim.enqueue({ kind: 'dispatch', taskKind: 'quick', summary });
  }
  while (!delivered()) {
    sim.update(100);
    if ((guard += 1) > 800) throw new Error('三单走完也没落下摆件');
  }
}

// ------------------------------------------------------------ 洗

test('洗一件脏摆件：污浊度归零，回执把露出来的那句话说出来', () => {
  // 露话是这个动作唯一的报酬，所以它必须出现在玩家看得见的地方。
  // 只把 grime 改成 0 而一句话不说，玩家洗完不知道发生了什么——
  // 那比不洗更糟：他以为自己错过了什么。
  const sim = makeSim(REVEALS);
  untilOneProp(sim);
  const prop = sim.snapshot().props[0]!;
  assert.equal(prop.grime, GRIME_FULL, '夹具：刚落下的摆件是脏的');

  const result = run(sim, { kind: 'cleanProp', propId: prop.id });
  assert.equal(result.ok, true, `洗干净不该被拒：${result.message}`);
  assert.match(result.message, /井底下压着一句话/, '回执里得有那句话');

  const after = sim.snapshot().props[0]!;
  // 不是 0，也远不是满的：命令在这一拍的 `update` 里生效，而同一拍也让世界
  // 走了 16ms，于是脏回来 16/240000 那么一丝丝。这是世界的顺序——
  // 命令在世界时钟里生效，不在它外头。
  assert.ok(after.grime <= GRIME_CLEAN, `洗干净了：从满值掉到 ${after.grime}`);
  assert.equal(after.reveal, prop.reveal, '那句话一直在，只是现在看得见了');
});

test('世界里没有那样东西：拒，而且不碰别的摆件', () => {
  // 摆件只增不删，所以「找不到」只可能是 id 写错了。这时候动的必须
  // 只有回执——顺手洗掉第一件是把世界的记忆改成了玩家的笔误。
  const sim = makeSim(REVEALS);
  untilOneProp(sim);
  const before = sim.snapshot().props[0]!;

  const result = run(sim, { kind: 'cleanProp', propId: 'prop-999' });
  assert.equal(result.ok, false, '没有这件东西');
  assert.match(result.message, /没有/, '得说清是没有，而不是洗不了');

  const after = sim.snapshot().props[0]!;
  assert.equal(after.grime, before.grime, '别的摆件一动都没动');
  assert.equal(after.reveal, before.reveal);
});

test('本来就是干净的：说「没变」，不谎报办成了', () => {
  // `ok: false` 在这里是「世界没变」，与「命令被拒」是两回事——
  // 与 `setWeather` 撞上同一档时返回的那句同一个口径（见那边的注释）。
  const sim = makeSim(REVEALS);
  untilOneProp(sim);
  const prop = sim.snapshot().props[0]!;
  run(sim, { kind: 'cleanProp', propId: prop.id });

  const again = run(sim, { kind: 'cleanProp', propId: prop.id });
  assert.equal(again.ok, false, '第二下什么也没改变');
  assert.match(again.message, /干净/, '得说清它本来就没脏');
  assert.ok(sim.snapshot().props[0]!.grime <= GRIME_CLEAN, '还是没有脏');
});

test('没有露话的摆件没有什么可洗：它从来就不脏', () => {
  // 不给设定集（莞尔镇）时池子是空的，于是一件摆件都不脏。
  // 这时候 `cleanProp` 该照实说「底下没有东西」——编一个「洗好了」
  // 就是世界在演一件没发生的事。
  const bare = makeSim();
  untilOneProp(bare);
  const prop = bare.snapshot().props[0]!;
  assert.equal(prop.grime, 0, '夹具：没有池子就不脏');
  assert.equal(prop.reveal, null, '也没有话');

  const result = run(bare, { kind: 'cleanProp', propId: prop.id });
  assert.equal(result.ok, false, '没什么可洗');
  assert.match(result.message, /没有压着东西/, '说它底下没有话，不说它干净');
});

test('没有露话的摆件走过再久也不脏：规则三得长在攒脏的那一步', () => {
  // 规则三说的是「没有什么可盖的，攒脏只会得到一个『洗了也不怎样』的
  // 噪音」。只在**落件**那一下执行它是做一半：莞尔镇不给话，于是一件
  // 摆件落地 grime 0，而世界自己走上 240 秒后它攒到了满值——
  // 接着 `cleanProp` 会答一句「灯洗干净了。」，底下一句话都没有。
  //
  // 这句话在默认世界里听得见，所以这条钉的是攒的那一步，不是落的那一步。
  // 上一条测试不走时钟，正好看不见这里。
  const bare = makeSim();
  untilOneProp(bare);
  assert.equal(bare.snapshot().props[0]!.grime, 0, '夹具：没有池子，落地就不脏');

  for (let i = 0; i < 30; i += 1) bare.update(GRIME_FILL_MS / 10);
  assert.equal(bare.snapshot().props[0]!.grime, 0, '三个周期过去还是干净的');
});

// ------------------------------------------------------------ 洗完接着脏

test('洗干净之后世界接着攒脏：露话是有时限的，不是永久解锁', () => {
  // 「世界不围着你转」在清洗这一条的落点。洗一次就永远干净的话，
  // `grime: 0..1` 该是个布尔——而它是数，渲染层要拿它渐变。
  //
  // 断言的是**重新攒满**而不是「变脏了一点」：一点点脏在画面上读不出来，
  // 而这个测试要钉的是整条曲线走得回去。
  const sim = makeSim(REVEALS);
  untilOneProp(sim);
  const prop = sim.snapshot().props[0]!;
  run(sim, { kind: 'cleanProp', propId: prop.id });
  assert.ok(sim.snapshot().props[0]!.grime <= GRIME_CLEAN, '夹具：洗完了');

  for (let i = 0; i < 20; i += 1) sim.update(GRIME_FILL_MS / 10);
  assert.equal(sim.snapshot().props[0]!.grime, GRIME_FULL, '两个周期足够再攒满');
});

test('攒脏按世界时间走：每一拍多出来的脏是个已知数', () => {
  // 三个新状态位都必须进存档、都必须是纯函数判定，不许读墙钟
  // （SPEC_V2 §8 的风险段）。这条是它在清洗上的样子。
  //
  // 断言**逐拍增量**而不是「两次回放一样」：步长取的是「从干净到积满」的
  // 二十分之一，所以每拍该多 0.05。只比两次回放的话，把 `stepGrime`
  // 整个删掉它还是绿的——两次都是十二个 0，那它就没在守任何东西。
  const sim = makeSim(REVEALS);
  untilOneProp(sim);
  run(sim, { kind: 'cleanProp', propId: sim.snapshot().props[0]!.id });

  const seen: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    sim.update(GRIME_FILL_MS / 20);
    seen.push(sim.snapshot().props[0]!.grime);
  }
  for (let i = 1; i < seen.length; i += 1) {
    const step = seen[i]! - seen[i - 1]!;
    assert.ok(Math.abs(step - 0.05) < 1e-9, `第 ${i} 拍只该多 0.05，实际多了 ${step}`);
  }
  assert.ok(seen[11]! < GRIME_FULL, `十二拍还没积满：${seen[11]}`);
});

test('同一串步长回放出同一条曲线：攒脏不读墙钟', () => {
  const trace = (): number[] => {
    const sim = makeSim(REVEALS);
    untilOneProp(sim);
    run(sim, { kind: 'cleanProp', propId: sim.snapshot().props[0]!.id });
    const out: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      sim.update(GRIME_FILL_MS / 20);
      out.push(Number(sim.snapshot().props[0]!.grime.toFixed(6)));
    }
    return out;
  };
  assert.deepEqual(trace(), trace(), '两次跑出同一条曲线');
  assert.ok(trace().every((value) => value >= 0 && value <= 1), '每一拍都在 0..1 里');
});

// ------------------------------------------------------------ 落件即脏

test('神迹点的灯也一样落地就脏：两条落件的路走同一条规则', () => {
  // 落件有两个调用点（里程碑、神迹）。只在一边装上「落地即脏」的话，
  // 另一边会静静地不脏——而它的露话从落地那一瞬就明面上摆着，
  // 玩家拿到手的东西和设定集写的不是一回事。
  const sim = makeSim(REVEALS);
  const result = run(sim, { kind: 'miracle', miracle: 'light' });
  assert.equal(result.ok, true, `神迹点灯不该被拒：${result.message}`);

  const prop = sim.snapshot().props[0]!;
  assert.equal(prop.kind, 'lamp', '夹具：落下的是一盏灯');
  assert.equal(prop.grime, GRIME_FULL, '神迹落的灯也是脏的');
  assert.equal(prop.reveal, '井底下压着一句话', '第一件配池子里第一句');

  run(sim, { kind: 'cleanProp', propId: prop.id });
  assert.ok(sim.snapshot().props[0]!.grime <= GRIME_CLEAN, '它洗得干净');
});

test('第二件配第二句：露话按世界上已有几件来取，不是永远第一句', () => {
  // 序数取 `props.length`。两件都配第一句的话，池子从第二件起就是死的——
  // 而设定集写的每一句话都该有被读到的那一天。
  const sim = makeSim(REVEALS);
  run(sim, { kind: 'miracle', miracle: 'light' });
  run(sim, { kind: 'miracle', miracle: 'light' });
  const props = sim.snapshot().props;
  assert.equal(props.length, 2, '夹具：落了两盏灯');
  assert.equal(props[0]!.reveal, '井底下压着一句话');
  assert.equal(props[1]!.reveal, '潮声记得每一个过客');
});
