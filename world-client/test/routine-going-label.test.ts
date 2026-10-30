/**
 * 走着的时候，牌子不许说「到了之后」的那句话。
 *
 * 这一条守的不是边角。**2026-10-30 之前**，默认世界里坐标在动的拍多于站着
 * 带牌子的拍——不是这个世界喜欢走路，是停留的钟在她迈第一步时就开始走了：
 * 派路那截写 `nextRoutineAt = now + beat.dwellMs`，路一长（3 格/秒，二十格要
 * 六秒多）表在走到之前就空了，于是「她多数时候在往某处走，而牌子说她已经站
 * 在那儿了」是常态。钟改到到达起算之后这条比值翻了过来——但比值不是本条要
 * 守的东西，真正要守的是「停留真的发生过」，判据见 `longestDwell`。
 *
 * （别在这一句里填比例：这个文件早先写着「76.1%」「16248 拍」四个数，是一次性
 *   探针量出来的，探针删了之后一个都复算不出来。要那个比例，跑一遍看 `moved`
 *   与 `stillLabelled` 两条计数就有了——写进注释只会变成下一颗没人能复核的
 *   数字。上面那句也照这条规矩，只写「翻了过来」，没写翻到几比几。）
 *
 * 假的意思是**可复算的**：牌子说她站在某处，而她的坐标这一拍动了。所以判据
 * 不需要摸世界内部——拿相邻两拍的坐标比一下就知道。这也是本条不用 `path`
 * 当观察口的原因：快照里没有它，而为了能测它给快照加一个字段，是让生产代码
 * 迁就测试。
 *
 * `simulation.ts` 里早就为同一件事立过规矩：`sheltering` 出发时挂「跑向屋檐下
 * 躲雨」、`path` 空掉那一刻换成「在屋檐下看雨」，旁边写着「写『跑到屋檐下』
 * 就是断言她已经到了——她半步还没动」。作息这条路漏了，本条把它堵上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { ALTAR, buildWorld, placeBlueprint } from '../src/world/setup.ts';
import { Simulation } from '../src/world/simulation.ts';
import { routineBeats } from '../src/world/routines.ts';
import { syncCommand } from './feed-helpers.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;
const blueprints = parseBlueprintTable(raw);

const world = buildWorld(blueprints);

function makeSim(): Simulation {
  return new Simulation({
    grid: world.grid,
    buildings: world.buildings,
    altar: ALTAR,
    villagerName: '莞尔',
    spawnBuilding: (prefabId, instanceId) => {
      const blueprint = blueprints.get(prefabId);
      if (blueprint === undefined) return null;
      return placeBlueprint(world.grid, blueprint, instanceId, ALTAR);
    },
  });
}

/**
 * 所有「到了之后」的说法。**半独立**：节拍那半是读过来的数据，天气那半才是
 * 照抄的字面量。
 *
 * 节拍表那几句直接读 `routineBeats`——它们是数据不是逻辑，读过来不构成循环
 * 论证。天气合成那四句在 `routineFor` 里是字面量，所以在这儿照抄。
 *
 * **别把这份集合当成一道「新落脚说法忘了配赶路那句」的闸。** 那种事编译器
 * 早就拦了：`going` 是 `RoutineBeat` 的必填字段，少一个 `npm run check` 就红。
 * 这份集合真正的用处是给下面两条断言一个判据——没有它，「走着的时候牌子说的
 * 是落脚那句」没得可判。
 *
 * 天气那四条**默认世界里一次都跑不到**：`clearWeather()` 的 `remainingMs` 是
 * null，`stepWeather` 看一眼就返回，晴永不下雨。所以第三条测试专门
 * `setWeather` 把雨和暴雨各驱一遍——不然那四条只是死字面量，`routineFor` 的
 * 雨天支路哪天改了也没人知道。
 *
 * **它只覆盖作息这一家，别读成「所有落脚说法」。** 给 `routineLabel` 写字的
 * 另外两处都不在这集合里，也**不该**进来：`startInPlace` 写的是活计那句
 * （`TASK_PROFILES[kind].label`，mode `working`、`path` 清空）——她站着把顺手
 * 活办完，那句话是真的，只是不描述地方；`chaseVerification` 更特殊，它把同一
 * 句同时写进两半（见 `GOING` 上头那段）。这两处由 `GOING` 那道判据兜着。
 * 早先这里只有一句「独立枚举」，读的人会以为站着时牌子不在这个集合里就是错
 * ——那会把一个正在干活的村民判成假话。
 */
const ARRIVAL = new Set<string>([
  ...routineBeats(ALTAR, world.grid).map((beat) => beat.label),
  '缩进屋檐下躲暴雨',
  '躲到屋檐下看雨',
  '在祭坛边缩着等暴雨过去',
  '在祭坛边看雨',
]);

/**
 * 只属于赶路的说法。站着的时候冒出其中任何一句，就是「路走完了而牌子还挂在
 * 半路上」——这次修掉的那个形状，留一道回归。
 *
 * `chaseVerification` 那句**故意不进来**：「心里存着疑，去现场看看」它同时
 * 写进两半，因为走到之后照样成立——她人就在现场，疑也没消。那句既不是纯粹
 * 的「到了之后」也不是纯粹的「赶路中说」，两个集合都容不下它，而它跟哪道
 * 判据都不冲突。硬把它塞进任一个，只会让那道判据平白多响一次。
 */
const GOING = new Set<string>([
  ...routineBeats(ALTAR, world.grid).map((beat) => beat.going),
  '跑向屋檐下躲暴雨',
  '跑向屋檐下躲雨',
  '去祭坛边',
]);

/**
 * 三世界分钟。够她把一圈作息（祭坛→农田→街口→祭坛，`DWELL_MS` 5200 起）
 * 走完好几轮，也够天气合成那条支路轮到；再长只是让这条测试跑得更久，
 * 不增加它验得到的东西。
 */
const TICKS = 60 * 180;

/** 一次 `update` 走多久。停留的连续拍数要乘回毫秒，才跟作息表比得了。 */
const TICK_MS = 16;

/**
 * 作息表里最短的一次停留。停留跑没跑成，拿它当尺子。
 *
 * 读数据不读字面量：`DWELL_MS` 在 `routines.ts` 里是私有常量，而这把尺子要
 * 量的正是「节拍表说要站多久」。哪天有人把某一拍调短，这里跟着动。
 */
const MIN_DWELL_MS = Math.min(...routineBeats(ALTAR, world.grid).map((beat) => beat.dwellMs));

/**
 * 天气合成那七句（四条落脚 + 三条赶路）。**只为证明雨天那条支路真的跑到了。**
 *
 * 晴永不下雨，所以默认世界里这七句一句都不会出现；第三条测试专门去
 * `setWeather` 把它们驱出来，再核这七句确实露过面。少了这个数，「跑了三分钟
 * 没红」与「那条支路一次没执行」在报告里长得一模一样。
 */
const SHELTER_SAID = new Set<string>([
  '缩进屋檐下躲暴雨',
  '躲到屋檐下看雨',
  '在祭坛边缩着等暴雨过去',
  '在祭坛边看雨',
  '跑向屋檐下躲暴雨',
  '跑向屋檐下躲雨',
  '去祭坛边',
]);

interface Survey {
  /** 坐标动了的拍数——她在赶路。 */
  readonly moved: number;
  /** 坐标没动、而牌子有值的拍数——她真在某处站着。 */
  readonly stillLabelled: number;
  /** 赶路时牌子说着落脚那句的处数。这条要为零。 */
  readonly walkingLies: readonly string[];
  /** 赶路时牌子整个是空的处数。把牌子收走也一样是假，这条也要为零。 */
  readonly walkingSilent: readonly string[];
  /** 站着时牌子还挂着赶路那句的处数——路走完了而说法没跟上。 */
  readonly standingWrong: readonly string[];
  /** 牌子说到天气合成那七句的拍数。证明雨天支路跑到了，不是死字面量。 */
  readonly sheltered: number;
  /**
   * 最长的一段「站着不动、牌子是作息落点那句」的连续拍数。
   *
   * **这是「停留真的发生过」的唯一判据。** `moved` 与 `stillLabelled` 的比值
   * 说明不了这件事：一个从不停留的世界照样凑得出站着带牌子的拍——等下一拍的
   * 1600ms 兜底、原地办活、躲雨，都算。只有连续站着超过作息表里最短的一次
   * 停留那么久，才不可能来自那些地方。
   */
  readonly longestDwell: number;
}

/**
 * 牌子在**这一拍开始时的样子**，与这一拍有没有走动，一起看。
 *
 * 必须先取样再 `update`：到了的那一拍她也动了（最后一步走完，`path` 空掉，
 * 牌子在同一拍换成落脚那句）。事后取样的话，那一拍会同时「动了」又「说着
 * 落脚那句」——而那是真的到了，不是假。事前取样问的是「她动身时嘴上说的是
 * 什么」，那才是屏上演给她看的那句话。
 *
 * 但事前取样会冤枉一种拍：**牌子在这一拍里被改写的那些**。改写生效于
 * `update` 之内，而它描述的是改写前那一帧——她那会儿确实站在那儿。典型的是
 * `scatterToShelter`：一句「下雨吧」让它在同一拍里交出路线、写下「跑向屋檐下
 * 躲雨」、并且迈出第一步。事前取样看到的是旧的那句，于是像说了假话。
 * 所以判据收成一句：**牌子这一拍没变，而她的坐标动了**——那才叫牌子在描述
 * 一个已经过去的位置。原来这一版把「动了」全算上，第一次跑雨天就红在这里。
 */
function survey(sim: Simulation): Survey {
  const before = new Map(sim.snapshot().villagers.map((v) => [v.id, { pos: { ...v.pos }, routine: v.routine }]));
  const walkingLies: string[] = [];
  const walkingSilent: string[] = [];
  const standingWrong: string[] = [];
  let moved = 0;
  let stillLabelled = 0;
  let sheltered = 0;
  let longestDwell = 0;
  /** 每个人当前连着站了几拍（只数「站着 + 牌子是落点那句」）。 */
  const stillRun = new Map<string, number>();

  for (let t = 0; t < TICKS; t += 1) {
    sim.update(TICK_MS);
    for (const villager of sim.snapshot().villagers) {
      const was = before.get(villager.id)!;
      const isMoving = villager.pos.x !== was.pos.x || villager.pos.y !== was.pos.y;
      const label = was.routine;
      if (label !== null && SHELTER_SAID.has(label)) sheltered += 1;
      before.set(villager.id, { pos: { ...villager.pos }, routine: villager.routine });
      // 牌子这一拍没被改写，才轮得到它挨判。
      const stale = label === villager.routine;
      // 停留：站着不动，而牌子说的是作息表上的落点。
      const dwelling = !isMoving && label !== null && ARRIVAL.has(label);
      const run = dwelling ? (stillRun.get(villager.id) ?? 0) + 1 : 0;
      stillRun.set(villager.id, run);
      if (run > longestDwell) longestDwell = run;
      if (isMoving) {
        moved += 1;
        if (!stale) continue;
        if (label === null) walkingSilent.push(`t=${t} ${villager.name}`);
        else if (ARRIVAL.has(label)) walkingLies.push(`t=${t} ${villager.name}「${label}」`);
        continue;
      }
      if (label === null) continue;
      stillLabelled += 1;
      if (stale && GOING.has(label)) {
        standingWrong.push(`t=${t} ${villager.name}「${label}」`);
      }
    }
  }
  return { moved, stillLabelled, walkingLies, walkingSilent, standingWrong, sheltered, longestDwell };
}

/**
 * 两条断言看的是同一趟巡视，**所以只跑一次**。
 *
 * 这个文件原来两条 test 各调一遍 `survey(makeSim())`，同一批观察被完整重算了
 * 一遍。观察是确定性的（同一份世界加同一串固定步长），重算只会得到同一组数，
 * 第二遍不增加任何覆盖，只是把这条测试的耗时翻倍。提到模块级还顺带一件事：
 * 用 `--test-name-pattern` 单跑其中一条时，另一条要用的数也已经在那儿了。
 */
const SEEN = survey(makeSim());

test('坐标动了的那些拍，牌子不是一句「已经到了」', () => {
  const seen = SEEN;

  assert.ok(seen.moved > 1000, `只观察到 ${seen.moved} 拍在动，像是世界没跑起来`);
  assert.ok(seen.stillLabelled > 1000, `只观察到 ${seen.stillLabelled} 拍站着带牌子，这条什么都没验`);
  // 停留真的发生过：连着站满一次最短的停留，只可能来自作息表，不来自
  // 兜底的 1600ms、原地办活或躲雨（那几处都短于这把尺子）。
  assert.ok(
    seen.longestDwell * TICK_MS >= MIN_DWELL_MS,
    `最长一次停留只有 ${seen.longestDwell * TICK_MS}ms，短于作息表最短的 ${MIN_DWELL_MS}ms——她一次也没停下来过`,
  );
  assert.deepEqual(
    seen.walkingSilent.slice(0, 5),
    [],
    `走着却什么都没说的拍有 ${seen.walkingSilent.length} 个——把牌子整个收走，与说错地方是同一种假`,
  );
  assert.deepEqual(
    seen.walkingLies.slice(0, 5),
    [],
    `走着却说着到了之后的话，共 ${seen.walkingLies.length} 处：\n${seen.walkingLies.slice(0, 5).join('\n')}`,
  );
});

test('不动的那些拍，牌子不还挂在半路上', () => {
  const seen = SEEN;

  assert.ok(seen.stillLabelled > 1000, `只观察到 ${seen.stillLabelled} 拍站着带牌子，这条什么都没验`);
  assert.deepEqual(
    seen.standingWrong.slice(0, 5),
    [],
    `站着却还挂着赶路那句，共 ${seen.standingWrong.length} 处：\n${seen.standingWrong.slice(0, 5).join('\n')}`,
  );
});

/**
 * 雨天与暴雨：屋檐那两句也得成对。
 *
 * 这条不是为了覆盖率好看。`routineFor` 的雨天支路是**手写的字面量**，不是数据
 * ——节拍表少一个字段编译器会响，那儿少一句不响。而默认世界晴永不下雨，这条支路
 * 默认一次都不执行：不专门去 `setWeather`，`ARRIVAL` 里那四条就是死的，改了也
 * 没人知道。
 */
test('雨天与暴雨：屋檐那两句也得成对', () => {
  for (const weather of ['rain', 'storm'] as const) {
    const sim = makeSim();
    // 「下雨吧」是玩家说的一句话。`setWeather` 会把户外的人叫醒，`routineFor`
    // 这才真的走到屋檐那一支。
    sim.enqueue({ kind: 'setWeather', weather });
    const seen = survey(sim);

    assert.ok(seen.sheltered > 0, `${weather} 下一句天气合成的话都没出现——那条支路还是死的`);
    assert.deepEqual(
      seen.walkingSilent.slice(0, 5),
      [],
      `${weather} 下走着却什么都没说的拍有 ${seen.walkingSilent.length} 个`,
    );
    assert.deepEqual(
      seen.walkingLies.slice(0, 5),
      [],
      `${weather} 下走着却说着到了之后的话，共 ${seen.walkingLies.length} 处：\n${seen.walkingLies.slice(0, 5).join('\n')}`,
    );
    assert.deepEqual(
      seen.standingWrong.slice(0, 5),
      [],
      `${weather} 下站着却还挂着赶路那句，共 ${seen.standingWrong.length} 处：\n${seen.standingWrong.slice(0, 5).join('\n')}`,
    );
  }
});

/**
 * 举急件跑向祭坛的路上，牌子不留在上一拍站在的那一处。
 *
 * 这条守的是一个真漏过的地方。`stepDecrees` 从 idle 里挑人，只翻 mode、交路线，
 * 没碰牌子——她 `routineLabel` 里还留着上一拍作息的落脚那句，而 `snapshotVillager`
 * 对非 idle 的 mode 一律吐 `routineLabel`。于是她举着急件跑向祭坛的整条路上，纸上
 * 印的是她站在街口，而她的坐标正在动。`toWork` 那条早在 `routeToBuilding` 就把这
 * 句清了，漏的只有急件。
 *
 * 与上面两条不同，这条得先有一张带问题的活才派得出急件，所以它自己造一张。
 * 步长用 100ms 与 `decree.test.ts` 一致——16ms 一拍拍 400 下不够她走到被派上。
 */
test('举急件跑向祭坛的路上，牌子不留在上一拍的那一处', () => {
  const sim = makeSim();
  sim.enqueue(
    syncCommand({
      tasks: [
        { id: 'c_block', kind: 'code', title: '清理临时目录', question: '要删掉 ./temp_build 吗？' },
      ],
    }),
  );

  let bearing = 0;
  const said: string[] = [];
  for (let i = 0; i < 400; i += 1) {
    sim.update(100);
    for (const villager of sim.snapshot().villagers) {
      if (villager.mode !== 'bearingDecree') continue;
      bearing += 1;
      if (villager.routine !== null) said.push(villager.routine);
    }
  }

  // 先证明这条真的跑到了：派得出人、也真的跑过。修好之后她一路都是空牌子，
  // 所以判据不能写成「收到过一句话」——那等于要求 bug 在场。
  assert.ok(bearing > 0, '一趟急件都没派出来——这条什么都没验');
  const stale = said.filter((label) => ARRIVAL.has(label));
  assert.deepEqual(
    stale.slice(0, 5),
    [],
    `举急件的路上牌子还说着上一拍站的那一处，共 ${stale.length} 处：\n${stale.slice(0, 5).join('\n')}`,
  );
});

/**
 * 站着带牌子的时候，她真站在牌子说的那一处。
 *
 * 上面四条判的都是**形状**：走着不说落脚那句，站着不挂赶路那句。可形状对不等于
 * 地方对。「在街口站着看了一会儿」这句话本身没毛病——她人站在祭坛边上时，它照样
 * 是句通顺的话。所以 `ARRIVAL` / `GOING` 那两个集合 membership 一放就过，
 * **而那是假话**。
 *
 * 这条补位置。`RoutineBeat` 带着 `target`，所以判据是硬的：她站着而牌子是某一句
 * 落脚那句话，她的坐标就必须是那一拍的 `target`。落点判据不带容差：
 * `walk()` 最后一步 `pos = next`，落点就是 `target` 本身，实测距离恒为 0.000。
 *
 * 它抓得住上面漏过去的那一整类：举急件那位到了祭坛还挂着「在街口站着看了一会儿」，
 * 形状对、集合 membership 对，而距离是 8.54。`stepDecrees` 清牌子修掉的是那一个
 * 生产者；这条修掉的是**这一类判据看不见东西**。
 *
 * 范围只说作息这一家：天气合成那四句的落点是门廊，随她当时在哪而变，不在这张表
 * 里（那四句由 `GOING`/`ARRIVAL` 配对着守）。`startInPlace` 的活计那句与
 * `chaseVerification` 那句也不在——前者不描述地方，后者她人就在现场。
 *
 * 每个局面核到多少拍，跑一遍就知道，**不在这儿报数**——它随 `TICKS`、种子、
 * 世界布局一起漂。`minChecked` 红着的时候，消息里带的就是当次的真数。
 */
/**
 * 四种局面，都核同一件事。第四种是真漏过的那一种。
 *
 * `decree` 那一局面非有不可：举急件的那位到了祭坛会**站住举牌**，而她是从
 * idle 里挑出来的——`routineLabel` 里留着上一拍作息的落脚那句。`stepDecrees`
 * 曾经不清它，于是她站在祭坛上，屏上与纸上印的是「在街口站着看了一会儿」。
 * 那一幕**形状完全正确**，`ARRIVAL` / `GOING` 两个集合 membership 都放行，
 * 只有位置判据看得见：祭坛 (15,9) 与街口 (23,6) 差 8.54。
 *
 * 没有这一局面，这条测试对急件那一整段是瞎的——实测过：把 `free.routineLabel = null`
 * 从 `stepDecrees` 删掉，只有第四条（举急件的路上）会红，这一条照旧绿。
 *
 * **这一局面的「核到多少拍」与前三面不同，别一律要求 >500。** 修好之后她一路
 * 空牌子，另一个村民又被那张带问题的活占着不来逛，于是这一局面**一拍都核不到**
 * （实测 `checked = 0`）。那不是没验：判据只在「她带着牌子站着」的时候看得见她，
 * 而修好之后她就不带着了。所以这一面改问「她确实在祭坛上站过」——那才是缺陷
 * 需要的那幕。实测（缺陷在场时）：`decree t=623 阿雾「在街口站着看了一会儿」
 * 站在 (15,9)，那一拍该在 (23,6)，差 8.544`。
 */
const REGIMES: readonly (readonly [string, (sim: Simulation) => void, number])[] = [
  ['clear', () => {}, 500],
  ['rain', (sim) => sim.enqueue({ kind: 'setWeather', weather: 'rain' }), 500],
  ['storm', (sim) => sim.enqueue({ kind: 'setWeather', weather: 'storm' }), 500],
  [
    'decree',
    (sim) => {
      sim.enqueue(
        syncCommand({
          tasks: [
            { id: 'c_pos', kind: 'code', title: '清理临时目录', question: '要删掉 ./temp_build 吗？' },
          ],
        }),
      );
    },
    0,
  ],
];

test('站着带牌子的时候，她真站在牌子说的那一处', () => {
  const beats = routineBeats(ALTAR, world.grid);
  const byLabel = new Map(beats.map((beat) => [beat.label, beat]));

  for (const [name, setup, minChecked] of REGIMES) {
    const sim = makeSim();
    setup(sim);

    const wrong: string[] = [];
    let checked = 0;
    let stoodAtAltar = 0;
    let before = new Map(sim.snapshot().villagers.map((v) => [v.id, { pos: { ...v.pos } }]));
    for (let t = 0; t < TICKS; t += 1) {
      sim.update(16);
      for (const villager of sim.snapshot().villagers) {
        const was = before.get(villager.id)!;
        const moved = villager.pos.x !== was.pos.x || villager.pos.y !== was.pos.y;
        const atAltar =
          Math.abs(villager.pos.x - ALTAR.x) < 1.5 && Math.abs(villager.pos.y - ALTAR.y) < 1.5;
        if (!moved && atAltar) stoodAtAltar += 1;
        // 到了的那一拍她也动了（`walk()` 先落位再清 path），由「没动」自动排除。
        if (moved || villager.routine === null) continue;
        const beat = byLabel.get(villager.routine);
        if (beat === undefined) continue;
        checked += 1;
        const d = Math.hypot(
          villager.pos.x - beat.target.x,
          villager.pos.y - beat.target.y,
        );
        if (d !== 0) {
          wrong.push(
            `${name} t=${t} ${villager.name}「${villager.routine}」`
            + ` 站在 (${villager.pos.x},${villager.pos.y})，那一拍该在`
            + ` (${beat.target.x},${beat.target.y})，差 ${d.toFixed(3)}`,
          );
        }
      }
      before = new Map(sim.snapshot().villagers.map((v) => [v.id, { pos: { ...v.pos } }]));
    }

    assert.ok(checked >= minChecked, `${name} 下只核到 ${checked} 拍，这条什么都没验`);
    // 只有急件那一面需要这句：那一位得真在祭坛上站过，缺陷才演得出来。
    if (name === 'decree') {
      assert.ok(stoodAtAltar > 0, '没有人在祭坛上站过——那一幕根本没上演，这条对急件是瞎的');
    }
    assert.deepEqual(wrong.slice(0, 5), [], `牌子说的地方与她站的地方不是一处：\n${wrong.slice(0, 5).join('\n')}`);
  }
});
