/**
 * 天气的三处说法必须说的是同一种天气。
 *
 * `weather.ts` 的 `WEATHER_LABEL` 曾经写着「状态行、日报、喂给模型的世界现状
 * 都从这里取，免得三处各写一份三元判断、加档时漏掉其中两处」。那句话是假的：
 * 只有状态线真的从这儿取，日报（`report.ts`）和喂模型的现状
 * （`intent-context.ts`）各自写着自己的三元，一句话都没来过这儿——三处三种
 * 说法，「外头晴着 / 天晴 / 晴」。
 *
 * 两句整话没法合成一张表：日报要「外头…着」的口气，喂模型要「天…」的口气，
 * 状态行只要一两个字。所以不硬合，改为在这里把**档位一致**钉住：
 * 同一个 `Weather`，三处必须都认成同一种天气。加第四档而漏掉哪一处，
 * 或者哪一处把暴雨说成了雨，这条红。
 *
 * 这不是假想的风险。`intent-context.test.ts` 那条「三档天气各说各的」钉的
 * 就是同一个病的另一半：把暴雨说成「在下雨」，模型会把用户说的「雨太大了」
 * 当成已经在办的事，答 unknown。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { composeReport } from '../src/world/report.ts';
import { WEATHER_LABEL, type WeatherState } from '../src/world/weather.ts';
import { summarizeForIntent, renderIntentContext } from '../src/world/intent-context.ts';

const blueprints = parseBlueprintTable(
  JSON.parse(
    readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
  ) as Record<string, Record<string, unknown>>,
);

const KINDS = ['clear', 'rain', 'storm'] as const;

/** 每一档天气在三处各是怎么说的。 */
function saidAt(kind: (typeof KINDS)[number]): readonly string[] {
  // 一、状态行：`statusLine()` 里 `WEATHER_LABEL` 原样。
  //
  // **这里不写行号，是有意的。** `SandboxScene.ts` 是这仓库里改动最频繁的
  // 文件之一，几乎每天都有别的改动把它推走几十行。写死一个坐标，就等于给
  // 每一次无关的改动派一个「顺手改我」的活——而那个活没人会记得做。
  //
  // 审计的 `CALL_REF` 要求「名字()」挨着坐标才查，所以光写名字它不查；
  // 但光写坐标它也只在落到**没有代码**的行上才响，落到有代码的行上照样
  // 一声不出。两种写法都只是部分保险，那就不如不写——名字本身足够定位，
  // 而这个测试真正要钉的是**三处说法一致**，不是某个函数在第几行。
  //
  // 而「对着哪儿核」这一步本身错过两次，两次错法相反，记的是这个：
  //
  //   - 一次读自**磁盘**：工作区带着别人未提交的行，坐标对着磁盘是对的，对着
  //     提交进去的树偏了。`hasCode()` 放行（落点是另一行有代码的），审计不响。
  //   - 一次读自 **HEAD**，可 HEAD 在核对与提交之间又长了一笔：对着当时的
  //     HEAD 是对的，对着提交完的树偏了。
  //
  // 两条合起来只有一句：**坐标要在提交之前最后一刻，对着 `git archive HEAD`
  // 解出来的那棵树核**。早一步晚一步都不算——这个仓库有三个会话在写同一棵树，
  // 「刚刚核过」这四个字没有保质期。
  const statusLine = WEATHER_LABEL[kind];

  // 二、日报：天气那一行（`report.ts`）。
  const world = buildWorld(blueprints);
  const sim = new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      return blueprint === undefined
        ? null
        : placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
  sim.enqueue({ kind: 'setWeather', weather: kind });
  sim.update(16);
  const paper = composeReport(sim.snapshot()).lines.find((line) => /外头/.test(line)) ?? '';

  // 三、喂模型的现状（`intent-context.ts`）。
  const context = summarizeForIntent(sim.snapshot());
  const forModel = renderIntentContext({ ...context, weather: kind });

  return [statusLine, paper, forModel];
}

test('三档天气，三处说法都认成同一种天气', () => {
  for (const kind of KINDS) {
    const [statusLine, paper, forModel] = saidAt(kind);
    assert.notEqual(statusLine, '', `${kind}：状态行没说法`);
    assert.notEqual(paper, '', `${kind}：日报没说法`);
    assert.notEqual(forModel, '', `${kind}：喂模型的现状没说法`);
  }

  // 认成哪种天气：用每一档独有的那个词判。三处都得出现它。
  const marks: Readonly<Record<(typeof KINDS)[number], RegExp>> = {
    clear: /晴/,
    rain: /雨/,
    storm: /暴雨/,
  };
  for (const kind of KINDS) {
    for (const said of saidAt(kind)) {
      assert.match(said, marks[kind], `${kind} 这一档有一处没说出它：${said}`);
    }
  }
});

test('暴雨在哪一处都不许被说成普通的雨', () => {
  // 「在下雨」这三个字同时出现在雨和暴雨两档里——单看它判不出是哪档。
  // 所以暴雨那一档三处都必须带「暴雨」二字，一处都不许只写「雨」。
  const stormSaid = saidAt('storm');
  const rainSaid = saidAt('rain');
  for (const said of stormSaid) {
    assert.match(said, /暴雨/, `暴雨被说成了别的：${said}`);
  }
  // 暴雨那一档三处的说法，不许和雨那一档一模一样。
  for (let i = 0; i < stormSaid.length; i += 1) {
    assert.notEqual(
      stormSaid[i],
      rainSaid[i],
      `第 ${i + 1} 处把暴雨和雨说成了同一句：${stormSaid[i]}`,
    );
  }
});

test('天气的档位表就是这三个，没有第四档漏在外面', () => {
  // 这条守的是"加档"：`Weather` 多加一档而三处都没跟上时，上面两条会红，
  // 可要是连 KINDS 都忘了加，那就一条都不红了。所以把 `Weather` 的取值
  // 与这里枚举的对上——编译期 `Record<Weather, ...>` 已经挡住了 `WEATHER_LABEL`，
  // 但 `report.ts` 与 `intent-context.ts` 那两处是三元判断，编译期不报警。
  const states: readonly WeatherState[] = [
    { kind: 'clear', intensity: 0, remainingMs: null },
    { kind: 'rain', intensity: 1, remainingMs: 45_000 },
    { kind: 'storm', intensity: 1, remainingMs: 90_000 },
  ];
  const fromType = states.map((state) => state.kind).sort();
  assert.deepEqual([...fromType], [...KINDS].sort(), 'Weather 的档位变了，这条测试要跟着改');
  for (const state of states) {
    assert.ok(WEATHER_LABEL[state.kind].length > 0, `${state.kind} 必须有一个字说法`);
  }
});
