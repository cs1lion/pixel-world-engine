/** 灯油：余量模型、渲染层接线、以及那条「世界不许知道」的硬约束。
 *
 * 这一组测试要守三件事：
 *
 * 1. **油真的会烧完，而且烧得看得出来。** 一局之内从满油走到见底，
 *    中间不是只有「满」和「灭」两态。
 * 2. **见底会自己好。** 每天添一次油。没有这条，第一盏灯烧干之后全世界永远是灰的，
 *    一个演示效果就变成了永久状态。
 * 3. **`Simulation` 不知道有灯油这回事。** 这是 #4 的硬约束，也是本组的重点：
 *    它靠源码扫描守，不靠人记得。有人哪天想「油尽了不能派活」，这道扫描先红。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { codeOf } from './source-scan.ts';

import {
  LAMP_DRY,
  LAMP_DAY_MS,
  LAMP_FULL,
  advanceLamp,
  burnFor,
  isLit,
  lampDayOf,
  lampGlow,
  newLamp,
  type LampActivity,
} from '../src/world/lampoil.ts';
import { drawLamp, lampActivityOf, lampBodyAlpha } from '../src/render/lampoil-view.ts';
import { WORLD } from '../src/world/palette-data.ts';
import { DAY_MS } from '../src/world/memory/config.ts';

const SIMULATION = fileURLToPath(new URL('../src/world/simulation.ts', import.meta.url));
const VILLAGER = fileURLToPath(new URL('../src/render/villager.ts', import.meta.url));
const LAMPOIL = fileURLToPath(new URL('../src/world/lampoil.ts', import.meta.url));

/** 走一段路：从 `from` 推进到 `to`，一步一步来，像渲染层每帧那样。 */
function burn(fromMs: number, toMs: number, activity: LampActivity = 'idle', seed = LAMP_FULL) {
  let lamp = advanceLamp(newLamp(), seed, fromMs, activity, lampDayOf(fromMs));
  const step = 1000;
  for (let now = fromMs + step; now <= toMs; now += step) {
    lamp = advanceLamp(lamp, seed, now, activity, lampDayOf(now));
  }
  return lamp.oil;
}

// ---------------------------------------------------------------- 硬约束

test('world/simulation.ts 不认识 lampoil', () => {
  // 小写 `lampoil` 只可能来自 import 路径（'../world/lampoil.ts'）。
  // 存档字段叫 `lampOil`，是驼峰，所以这条扫描不会误伤它——世界可以**搬运**
  // 那个数，只是不许读它、不许为它分支。
  const text = readFileSync(SIMULATION, 'utf8');
  assert.ok(
    !text.includes('lampoil'),
    '灯油只活在渲染层：simulation 一引用它，「固定步长、无内部时钟、可确定性回放」就没了',
  );
});

/** 世界里碰过 `lampOil` 的文件，以及各自被允许怎么碰。
 *
 * 这份清单是**白名单**，不是备忘：新开一个世界文件提到 `lampOil`，下面那条
 * 扫描立刻红，逼人决定「它该不该在这张表里」。
 *
 * - `types.ts`：`VillagerSnapshot` 的字段声明。渲染层从快照读油，走的是这条路。
 * - `simulation.ts`：五处纯搬运——声明、初始化、快照、存、读回。
 * - `save.ts`：读档时的范围校验（0..1）与老档补默认值。那是**形状**检查，
 *   不是世界判定：一个越界的数不会让世界走不同的路，只会让存档被拒。
 * - `lampoil.ts`：模型自己，注释里提到存档字段名。
 */
const MAY_TOUCH_LAMPOIL: Readonly<Record<string, string>> = {
  'types.ts': 'VillagerSnapshot 的字段声明',
  'simulation.ts': '五处纯搬运',
  'save.ts': '读档范围校验与老档补默认值',
  'lampoil.ts': '模型自己',
};

/** 判定一行是不是在**拿油量做决定**。 */
const DECIDES_ON_OIL = /[<>]=?|===?|!==|[+*/]|\?|&&|\|\||\bif\b|\bwhile\b|\bfor\b/;

/** `src/world/` 下所有 `.ts` 的相对路径，子目录也往下走。
 *
 *  为什么递归：这条扫描当初失效，正是因为「只看 simulation.ts」一层。
 *  扩到整个目录之后，同样的坑还在——`readdirSync` 不递归，多一层子目录
 *  就又是一片安静的盲区，而测试照绿。
 */
function worldSources(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return worldSources(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
    return entry.name.endsWith('.ts') ? [`${prefix}${entry.name}`] : [];
  });
}

test('除了清单上那几个文件，世界没人碰灯油', () => {
  // SPEC §4.2 的铁律是「灯油衰减只活在渲染层，不进 Simulation」。
  // 原先那条扫描只看 `simulation.ts`——于是「油尽了不走这条路」写进 `grid.ts`
  // 或 `bustle.ts`，全套照旧绿。铁律守的是整个 `world/`，不是一个文件。
  //
  // 走 `codeOf()` 而不是裸 `readFileSync`：注释里提一句 `lampOil` 是解释历史
  // （`save.ts:48` 就在讲 v3 扩了哪几个字段），不是把词汇接回来。裸读会把注释行
  // 也喂给 `DECIDES_ON_OIL`——今天扫出来是 0 处（注释里那几个 `lampOil` 都在
  // 被豁免的 `save.ts` / `lampoil.ts` 里），所以这是**潜在**误报，不是正在误报。
  // 但「代码里有没有」和「文件里有没有」是两件事，这条界线 `test/source-scan.ts`
  // 开头写着，而这里原先自己抄了一份 `codeOf`——正是那份文件说要消灭的第四份抄写。
  //
  // 递归往下走：`src/world/` 今天是平的，但这条扫描当初就是因为「只看一个文件」
  // 失效过才扩到整个目录的。哪天多一层子目录，不该又安静地漏一片。
  const worldDir = fileURLToPath(new URL('../src/world', import.meta.url));
  const strays: string[] = [];
  for (const rel of worldSources(worldDir)) {
    const text = codeOf(`${worldDir}/${rel}`);
    if (!text.includes('lampOil')) continue;
    if (MAY_TOUCH_LAMPOIL[rel] === undefined) {
      strays.push(`${rel}：提到了 lampOil，而它不在清单里（${Object.keys(MAY_TOUCH_LAMPOIL).join(' / ')}）`);
      continue;
    }
    // 在清单里的，也只许搬运。`save.ts` 例外：那里的 `>` 是读档校验，不是世界判定。
    if (rel === 'save.ts' || rel === 'lampoil.ts') continue;
    for (const [index, line] of text.split('\n').entries()) {
      if (!line.includes('lampOil')) continue;
      if (DECIDES_ON_OIL.test(line)) {
        strays.push(`${rel}:${index + 1} 在拿油量做决定：${line.trim()}`);
      }
    }
  }
  assert.deepEqual(strays, [], `灯油只活在渲染层：\n${strays.join('\n')}`);
});

test('灯油模型不 import Phaser、不 import simulation', () => {
  // 反方向也钉一条：模型自己是纯的，才能在 node 下直接加载、直接单测。
  // 查的是 import 语句，不是字面词——文件里到处都在解释「为什么不 import 它」。
  const text = readFileSync(LAMPOIL, 'utf8');
  assert.ok(!/from\s+['"][^'"]*phaser/.test(text), '油量模型与渲染后端无关');
  assert.ok(!/from\s+['"][^'"]*simulation/.test(text), '油量模型与世界内核无关');
});

test('灯油模型不读墙钟', () => {
  // 文件头第 11 行写着「时钟用 simulation 时间，不用墙钟」。那句话此前**没有任何
  // 测试守着**：往 advanceLamp 里塞一个 Date.now()，21 条测试全绿，而「重放同一个
  // 存档灯走同一条曲线」当场就不成立了——灯会跟着真实时间烧，暂停时也在烧。
  //
  // 与 `purity.test.ts` 里那条「潮汐逻辑不读墙钟」是同一个理由、同一个罚则。
  // 潮汐那条先写，是因为潮汐早在 v1 就是确定性回放的地基；灯油来晚了，就漏到现在。
  const text = readFileSync(LAMPOIL, 'utf8');
  const banned = ['Date.now', 'performance.now', 'new Date('];
  const hits = banned.filter((pattern) => text.includes(pattern));
  assert.deepEqual(hits, [], `灯油不许读墙钟：${hits.join(', ')}`);
});

test('见底发灰是接线接上去的，不是写在注释里的', () => {
  // 「灯暗到阈值以下时角色渲染发灰」是 #4 的验收条件。它发生在 `villager.ts`，
  // 而那个文件引 Phaser、node 下加载不了，所以这里查的是**那行调用确实在**：
  // 有人哪天把 setAlpha 删了、或者改成只在见底那一次设，这条先红。
  const text = codeOf(VILLAGER);
  assert.ok(
    text.includes('setAlpha(lampBodyAlpha(oil))'),
    'villager.ts 没在每帧按余量写回 alpha——回油以后上一帧的灰会留在身上',
  );
});

test('灯是每帧画上去的，不是只在点着那一下', () => {
  // 上一组扫描只盯住了三处接线里的一处（`setAlpha`）。`drawLamp` 那处此前没人守：
  // 把 `villager.ts` 里 `drawLamp(view.body, oil, palette)` 那一行整行删掉，
  // 33 条测试全绿，而灯从此不再出现在画面上——
  // 没人会发现，因为测试里驱动 `drawLamp` 的是个 recorder 假对象。
  // （这里原来写着一个行号。2026-10-27 我往那个文件头加了一段说明，
  // 那一行被推到更下面，而审计查不出这个行号已经指错——那行仍然"有代码"。
  // 所以改成指名要删的是哪一行。）
  const text = codeOf(VILLAGER);
  assert.ok(
    text.includes('drawLamp(view.body, oil, palette)'),
    'villager.ts 没在每帧画灯——灯会从画面上整个消失，而测试还在跟假 graphics 说话',
  );
});

test('油尽时动作采样放慢，也是接线接上去的', () => {
  // SPEC §4.5 的验收条件「动作帧率下降」。`anim-frames.test.ts` 只测了纯函数
  // `lampAnimationTime` 本身；把它在 `villager.ts` 里的实参换成 `nowMs`
  // （等于不放慢），全绿。这一条盯的是那处调用。
  const text = codeOf(VILLAGER);
  assert.ok(
    text.includes('lampAnimationTime(oil, nowMs)'),
    'villager.ts 没把余量喂给动作采样——油尽时动作该放慢，那是画面上的疲惫',
  );
});

// ---------------------------------------------------------------- 衰减

test('满油放着一小时之后明显少了', () => {
  const after = burn(0, 60 * 60 * 1000);
  assert.ok(after < 0.2, `一小时该烧到见底附近，实际 ${after}`);
  assert.ok(after >= LAMP_DRY || after === 0, '可以见底，不能为负');
});

test('一局之内看得见灯在暗：每过一刻钟都更暗', () => {
  // 「肉眼能看出」不是形容词。这里把它钉成一个可测的说法：
  // 连续四个一刻钟，余量严格递减，且首尾差得开。
  const quarters = [0, 15, 30, 45].map((minutes) => burn(0, minutes * 60 * 1000));
  for (let i = 1; i < quarters.length; i += 1) {
    assert.ok(quarters[i]! < quarters[i - 1]!, `第 ${i} 刻钟没有更暗：${quarters.join(' → ')}`);
  }
  assert.ok(quarters[0]! - quarters[3]! > 0.3, `首尾差得太小，看不出：${quarters.join(' → ')}`);
});

test('干活比站着费油，跑路居中', () => {
  const hour = 60 * 60 * 1000;
  const idle = burnFor(hour, 'idle');
  const walk = burnFor(hour, 'walk');
  const work = burnFor(hour, 'work');
  assert.ok(idle < walk && walk < work, `耗油该递增：${idle} / ${walk} / ${work}`);
});

test('时间不动油就不动：暂停世界时灯也停', () => {
  // 用 simulation 时间推进就有这条。换成墙钟的话，暂停画面灯还在烧，
  // 而重放同一个存档会得到另一条曲线。
  const lamp = advanceLamp(newLamp(), LAMP_FULL, 5000, 'idle', 0);
  const again = advanceLamp(lamp, LAMP_FULL, 5000, 'work', 0);
  assert.equal(again.oil, lamp.oil, '同一时刻重复推进不该再烧');
});

test('存档里的余量只起一次头，不被每帧拽回去', () => {
  // 每帧都拿存档值当基准的话，灯永远暗不下去——存档那个数是退出时的快照。
  let lamp = advanceLamp(newLamp(), 0.5, 0, 'idle', 0);
  assert.equal(lamp.oil, 0.5, '第一次推进按存档起头');
  lamp = advanceLamp(lamp, 0.5, 30 * 60 * 1000, 'idle', 0);
  assert.ok(lamp.oil < 0.5, '之后是渲染层自己烧出来的，不该被存档拽回 0.5');
  lamp = advanceLamp(lamp, 1, 60 * 60 * 1000, 'idle', 0);
  assert.ok(lamp.oil < 0.5, '改成传 1 也不该把油添回去');
});

test('见底之后 clamp 在 0，不会变成负数', () => {
  const oil = burn(0, 10 * 60 * 60 * 1000);
  assert.equal(oil, 0);
});

// ---------------------------------------------------------------- 自己好

test('过了世界日就添满油', () => {
  const start = LAMP_DAY_MS - 1000;
  let lamp = advanceLamp(newLamp(), LAMP_FULL, start, 'idle', lampDayOf(start));
  lamp = advanceLamp(lamp, LAMP_FULL, LAMP_DAY_MS + 5000, 'idle', lampDayOf(LAMP_DAY_MS + 5000));
  assert.equal(lamp.oil, LAMP_FULL, '新的一天该满油，否则全世界永远是灰的');
});

test('添油那一帧不把昨晚一起结清', () => {
  // 跨过午夜那一段若也算进去，灯会在添油的同一帧先被扣成 0 再满上——
  // 一次跳变，而那不是任何真实发生过的事。
  const start = LAMP_DAY_MS - 60 * 1000;
  let lamp = advanceLamp(newLamp(), LAMP_FULL, start, 'idle', lampDayOf(start));
  const before = lamp.oil;
  lamp = advanceLamp(lamp, LAMP_FULL, LAMP_DAY_MS, 'idle', lampDayOf(LAMP_DAY_MS));
  assert.equal(lamp.oil, LAMP_FULL);
  assert.ok(before > 0, '昨晚那一分钟不该把油烧干');
});

test('同一天之内不添油', () => {
  const oil = burn(60 * 60 * 1000, 3 * 60 * 60 * 1000);
  assert.ok(oil < LAMP_FULL, '一天还没过完就满油，等于没有余量这回事');
});

test('昨天烧干的灯，今天自己满回来', () => {
  // 上面两条「添油」测试有个共同的前提毛病：它们都从**满油**出发，
  // 跨过午实时只烧了 1 秒 / 60 秒。把添油整条分支删掉，灯在边界上本来就还是
  // LAMP_FULL，`assert.equal(lamp.oil, LAMP_FULL)` 照样过——**一次真话也没说**。
  //
  // 所以这里先把灯烧到见底，再跨午夜。删掉添油的话返回 0，
  // 也就是「第一个世界日之后全世界永远是灰的」——正是文件头第 15 行警告的那件事。
  const yesterday = LAMP_DAY_MS - 1;
  let lamp = advanceLamp(newLamp(), LAMP_FULL, 0, 'idle', lampDayOf(0));
  // 满油只够烧一小时，走完一整天必然见底。
  for (let now = 0; now <= yesterday; now += 60 * 1000) {
    lamp = advanceLamp(lamp, LAMP_FULL, now, 'idle', lampDayOf(now));
  }
  assert.equal(lamp.oil, 0, '一整天下来该烧干了，否则这条测试没在测添油');

  const today = LAMP_DAY_MS + 1;
  lamp = advanceLamp(lamp, LAMP_FULL, today, 'idle', lampDayOf(today));
  assert.equal(lamp.oil, LAMP_FULL, '新的一天该满油，否则昨天烧干的人今天还是灰的');
});

test('一个世界日就是 24 小时——灯油这一份与记忆层那一份是同一个数', () => {
  // 把它改成 365 天，上面每条测试**照样全绿**：它们都拿 `LAMP_DAY_MS` 当符号用，
  // 没人说过它必须等于一天。于是一盏一年才添一次油的灯可以悄悄上线，
  // 而任何一局游戏里它都只是一盏越来越暗、永远不会再亮的灯。
  //
  // **这里原来的标题写的是「这个数现在是全世界唯一的地方」，注释写的是「世界里
  // 目前没有别的『一天有多长』的常量可对齐」。两句在写下时都是实话，2026-10-27
  // 21:20 的 `6514cae` 之后都不是了。** 那天记忆内核落地，`memory/config.ts`
  // 有了自己的 `DAY_MS`；服务端 `server/memory/snapshot.py` 本来也有一份。本用例
  // 写于同日 03:22，早了 18 小时，而那句话我没跟着改——于是它从「事实」变成了
  // 「过期的事实」。过期的事实比错话更难发现：它读起来完全像真的。
  //
  // 今天的对齐关系是**三处代码常量**：`lampoil.ts` 的 `LAMP_DAY_MS`、
  // `memory/config.ts` 的 `DAY_MS`、`server/memory/snapshot.py` 的 `DAY_MS`，
  // 由 `test/memory-day.test.ts` 钉住（服务端那份是从源码读的，不是再抄一个数）。
  // **这个数不在这儿手写第二遍**——旧句子的病根就是手写，而手写的数一定会漂。
  // 下面第一条断言只是把「不止一处」这件事摆在翻到这一页的人眼前，
  // 免得他信了我上面那句话就去找一个不存在的东西。
  assert.equal(LAMP_DAY_MS, DAY_MS, '灯油的一天与记忆层的一天不是同一个长度');
  assert.equal(LAMP_DAY_MS, 24 * 60 * 60 * 1000, '灯油的一天必须是 24 小时');
});

// ---------------------------------------------------------------- 亮度

test('亮度在见底与满油之间连续，两头各是一刀', () => {
  assert.equal(lampGlow(LAMP_FULL), 1);
  assert.equal(lampGlow(LAMP_DRY), 0);
  assert.equal(lampGlow(0), 0);
  const mid = lampGlow((LAMP_DRY + LAMP_FULL) / 2);
  assert.ok(mid > 0.4 && mid < 0.6, `中点该在中间：${mid}`);
  // 严格递增：油一点点少，光一点点暗，中间没有台阶。
  let previous = -1;
  for (let oil = LAMP_DRY; oil <= LAMP_FULL; oil += 0.05) {
    const glow = lampGlow(oil);
    assert.ok(glow > previous, `${oil} 处没有更暗`);
    previous = glow;
  }
});

test('亮与灭分得开：见底是道坎，不是渐变', () => {
  assert.equal(isLit(LAMP_DRY), true, '刚好到底线还算亮');
  assert.equal(isLit(LAMP_DRY - 0.001), false);
  assert.equal(isLit(LAMP_FULL), true);
});

// ---------------------------------------------------------------- 人发灰

test('见底的人发灰，油一补回来就恢复', () => {
  // 每帧显式写回才有这条。只在见底那一次设的话，回油之后灰留在身上。
  assert.equal(lampBodyAlpha(LAMP_FULL), 1);
  assert.equal(lampBodyAlpha(LAMP_DRY), 1, '刚好到底线还亮着，不该开始灰');
  assert.equal(lampBodyAlpha(LAMP_DRY - 0.001), 0.8);
  assert.equal(lampBodyAlpha(0), 0.8);
});

test('发灰看得见，又不至于读成「他病了」', () => {
  const dim = lampBodyAlpha(0);
  assert.ok(dim < 1, '不灰等于没有这条验收条件');
  assert.ok(dim > 0.7, `灰得太狠就开始读作生病：${dim}`);
});

test('怪形状的油量不当机', () => {
  assert.equal(lampGlow(Number.NaN), 0);
  assert.equal(burnFor(Number.NaN, 'idle'), 0);
  assert.equal(burnFor(-1, 'idle'), 0);
  assert.equal(burnFor(1000, 'idle') >= 0, true);
  const lamp = advanceLamp(newLamp(), Number.NaN, 0, 'idle', 0);
  assert.equal(lamp.oil, LAMP_FULL, '坏档读出来的 NaN 当满油，别把画面搞死');
});

// ---------------------------------------------------------------- 忙碌档

test('跑动的人费油，干活的人更费，站着的最省', () => {
  assert.equal(lampActivityOf('idle'), 'idle');
  assert.equal(lampActivityOf('saluting'), 'idle');
  assert.equal(lampActivityOf('toWork'), 'walk');
  assert.equal(lampActivityOf('toAltar'), 'walk');
  assert.equal(lampActivityOf('sheltering'), 'walk');
  assert.equal(lampActivityOf('bearingDecree'), 'walk', '举着急件跑也是跑');
  assert.equal(lampActivityOf('working'), 'work');
  assert.equal(lampActivityOf('delivering'), 'work');
});

// ---------------------------------------------------------------- 画

/** 记下每一次 fillRect 的假 graphics：连当时生效的 alpha 一起记。 */
function recorder() {
  const calls: { x: number; y: number; w: number; h: number; alpha: number }[] = [];
  let alpha = 1;
  return {
    calls,
    fillStyle(_color: number, a: number) {
      alpha = a;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ x, y, w, h, alpha });
    },
  };
}

test('油越多，那圈光晕越大也越浓', () => {
  const dim = recorder();
  drawLamp(dim, LAMP_DRY + 0.01, WORLD);
  const bright = recorder();
  drawLamp(bright, LAMP_FULL, WORLD);

  // 第一笔就是光晕。只比它——灯身与提手的 alpha 恒为 1，比它们什么也说明不了。
  const dimGlow = dim.calls[0]!;
  const brightGlow = bright.calls[0]!;
  assert.ok(brightGlow.w > dimGlow.w, `满油的光晕该更宽：${brightGlow.w} vs ${dimGlow.w}`);
  assert.ok(brightGlow.h > dimGlow.h, `满油的光晕该更高：${brightGlow.h} vs ${dimGlow.h}`);
  assert.ok(brightGlow.alpha > dimGlow.alpha, '满油的光晕该更浓');
  assert.ok(brightGlow.alpha <= 0.12, '光晕浓度不放宽：0.12 是这盏灯被接受的值');
});

test('灭了还留着一只灯身，读作「有灯，没油了」', () => {
  const g = recorder();
  drawLamp(g, 0, WORLD);
  assert.ok(g.calls.length >= 2, '灭了至少还有灯身与提手');
  assert.ok(g.calls.every((call) => call.w > 0 && call.h > 0), '没有零面积的方块');
});

test('画出来的坐标全是整数像素', () => {
  const g = recorder();
  drawLamp(g, 0.42, WORLD);
  for (const call of g.calls) {
    for (const value of [call.x, call.y, call.w, call.h]) {
      assert.equal(Number.isInteger(value), true, `出现了非整数像素：${JSON.stringify(call)}`);
    }
  }
});
