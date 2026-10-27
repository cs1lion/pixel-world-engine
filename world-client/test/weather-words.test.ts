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
  // 一、状态行：`statusLine()`（`SandboxScene.ts:1496`）里 `WEATHER_LABEL` 原样
  //（`SandboxScene.ts:1509`）。
  //
  // 这两个坐标是本测试最脆的地方，值得记下它们为什么还在这儿。
  //
  // 早先这一行只写「`WEATHER_LABEL` 原样」后面缀一个坐标——没有名字。审计的
  // `CALL_REF` 要求「名字()」挨着坐标才查，光坐标它不查，于是那一处悄悄地
  // 偏了十几行也没人知道。把名字写上去之后，偏了会红。
  //
  // 但「偏了会红」只对一半。审计偏到一行**没有代码**的代码上才响（`hasCode()`
  // 不放行）；偏到另一行**有代码**的代码上，它照放行，一声不出。所以这两个
  // 坐标仍然要靠人跟——`SandboxScene.ts` 每长几十行，它们就得跟着走。
  //
  // 曾经想在这里写一段「当初偏到第 N 行、真正的说法在第 M 行」的历史，写完才
  // 明白那是在注释里又钉了一个会漂的坐标：`SandboxScene.ts` 再长一截，那个 N
  // 落到一行只有 `},` 的地方，审计照样红。**历史不需要坐标**——要的是它当初
  // 错在哪一步，而这一步与第几行无关。
  //
  // 而这两个坐标**本身**就错过一次，错法值得记：上一版写的是 1509 / 1522，两个
  // 都读自**工作区**——那一刻 `SandboxScene.ts` 带着别人未提交的 13 行，
  // `statusLine` 在 1509、`WEATHER_LABEL` 在 1522。提交进去的树里它们是 1496 与
  // 1509，于是 `statusLine()` 那个坐标落到了 `WEATHER_LABEL` 那一行上：一行有
  // 代码的别行，`hasCode()` 放行，`CALL_REF` 因为名字对不上才响。**坐标只能对着
  // 即将提交的那棵树核**（`git show HEAD:<file> | grep -n`），对着磁盘核等于没核。
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
