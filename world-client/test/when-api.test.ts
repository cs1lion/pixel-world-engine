/**
 * `whenApi`：等世界醒，不等下一帧；等不到就认输。
 *
 * 这里钉的是一个真出过事的缺陷，不是一个假想的健壮性问题。
 *
 * 神谕面板与 HUD 都要等 Phaser 场景在 `create()` 里挂上 `window.Oracle`。
 * 从前两边都用 `requestAnimationFrame(subscribe)` 轮询——那是「下一帧再试」，
 * 可它等的是场景挂载，另一个时钟，而且是个**会停**的时钟：页面不在合成中时
 * （后台标签页、被遮住的窗口、无头浏览器里没聚焦的窗口）Chromium 把 rAF 节流
 * 到近乎不触发。`scripts/smoke-ego.mjs` 记着实测「3 秒真实时间世界时间只走了
 * +0ms」，为此专门写了个 60fps 的 rAF 替身——那脚本明说那是测试专用、不进产物。
 *
 * 帧不来的地方，症状不是「转圈久一点」：`subscribe()` 永远走不到挂订阅那行，
 * 于是 `onResult` 没挂上。屏上留着一句没人来兑的承诺——正是「说谎比不去更糟」
 * 要防的那件事，只是以沉默的形式。
 *
 * 修法是把等待从帧时钟搬到 `setTimeout`：后台页里它会被节流，但照样会来。
 *
 * **可这一笔只换掉了沉默，没有消除沉默。** 场景自己也跑在 rAF 上（Phaser 的
 * `Game.step` 由 `TimeStep` 驱动），所以页面真的一帧都不合成时场景压根不会
 * `create()`——`window.Oracle` 永远不出现。原来那句「输入框确实清了」在这种
 * 情况下是不成立的：`submit()` 第一行就查 `getApi()`，取不到就直接返回，
 * 输入框不会清，什么都不会发生。所以这里补第三条：等是有尽头的，尽头上要说
 * 一句真话（「世界没有醒来」），而不是让「正在醒来」永远挂在屏上。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GIVE_UP_AFTER, whenApi, type Schedule } from '../src/ui/when-api.ts';
import { codeOf } from './source-scan.ts';

/** 一个能一步步手摇的假时钟：测试自己决定「下一次尝试」什么时候发生。 */
function fakeClock(): {
  readonly schedule: Schedule;
  /** 把当前排下的都跑掉；这一轮里新排下的留给下一轮。 */
  tick(): void;
  /** 还排着几次没跑。 */
  queued(): number;
} {
  let pending: (() => void)[] = [];
  return {
    schedule: (run) => {
      pending.push(run);
    },
    tick() {
      const batch = pending;
      pending = [];
      for (const run of batch) run();
    },
    queued: () => pending.length,
  };
}

test('世界已经醒了：立刻交付，一次都不排下一轮', () => {
  const clock = fakeClock();
  const seen: string[] = [];
  whenApi(() => 'world', (api) => seen.push(api), { schedule: clock.schedule });
  assert.deepEqual(seen, ['world']);
  assert.equal(clock.queued(), 0, '已经拿到了就不该再排下一次尝试');
});

test('世界还没醒：等它，不替它假设一个', () => {
  // 第一次问的时候场景多半还没 create() 完。这时候交付一个空壳，
  // 等于让面板对着不存在的东西订阅——比多等 50ms 糟得多。
  const clock = fakeClock();
  let attempts = 0;
  const seen: string[] = [];
  whenApi(
    () => {
      attempts += 1;
      return attempts >= 3 ? 'world' : undefined;
    },
    (api) => seen.push(api),
    { schedule: clock.schedule },
  );

  assert.deepEqual(seen, [], '第一次问不到就交付是不行的');
  clock.tick();
  assert.deepEqual(seen, [], '第二次也还问不到');
  clock.tick();
  assert.deepEqual(seen, ['world'], '第三次该拿到了');
});

test('一帧都没有也能等到：这才是这次修的那一半', () => {
  // 关键在**全程没有产生任何一帧**：时钟只被 tick() 手摇，页面帧率是 0。
  // 从前这里用的是 rAF，帧率 0 就意味着 subscribe() 一次都不跑——
  // onResult 挂不上，用户那句话得不到回执。
  const clock = fakeClock();
  let attempts = 0;
  const seen: string[] = [];
  whenApi(
    () => {
      attempts += 1;
      return attempts >= 4 ? 'world' : undefined;
    },
    (api) => seen.push(api),
    { schedule: clock.schedule },
  );
  for (let i = 0; i < 3; i += 1) clock.tick();
  assert.deepEqual(seen, ['world'], '零帧环境下也必须等到');
});

test('世界一直不醒：前面继续等，不悄悄收手', () => {
  // 反方向也钉：等待不能因为试了几次就悄悄收手。收手了面板就永远停在
  // 「世界正在醒来…」——那是句没人来兑的话。所以有一个明确的边界，
  // 边界之内一次都不许少等。
  const clock = fakeClock();
  let deliveries = 0;
  whenApi(() => undefined, () => {
    deliveries += 1;
  }, { schedule: clock.schedule });
  for (let i = 0; i < GIVE_UP_AFTER - 2; i += 1) clock.tick();
  assert.equal(deliveries, 0, '没拿到就不该交付');
  assert.equal(clock.queued(), 1, '快到边界了也还在排下一轮');
});

test('等不到是有尽头的：尽头上交给调用方说一句真话', () => {
  // 第三条：场景自己也跑在 rAF 上，所以一帧都不合成时它压根不会 create()。
  // 等不到就永远等下去，屏上那句「世界正在醒来…」就是一句没人来兑的承诺——
  // 那正是这个仓库最防的那件事。所以试满就停，并且**告诉调用方**，
  // 由它把那一句换成真的。
  const clock = fakeClock();
  let gaveUp = 0;
  whenApi(() => undefined, () => {}, { schedule: clock.schedule, onGiveUp: () => { gaveUp += 1; } });
  for (let i = 0; i < GIVE_UP_AFTER; i += 1) clock.tick();
  assert.equal(gaveUp, 1, '试满了该认输一次');
  assert.equal(clock.queued(), 0, '认输了就不该再排下一轮');
  clock.tick();
  assert.equal(gaveUp, 1, '认输只说一次，不是每轮都说');
});

test('认输之前醒过来：照常交付，那句「没醒来」不出说', () => {
  // 收边界的另一侧。慢机器不该被报成坏了。
  const clock = fakeClock();
  const seen: string[] = [];
  let gaveUp = 0;
  let attempts = 0;
  whenApi(
    () => {
      attempts += 1;
      return attempts >= GIVE_UP_AFTER - 1 ? 'world' : undefined;
    },
    (api) => seen.push(api),
    { schedule: clock.schedule, onGiveUp: () => { gaveUp += 1; } },
  );
  for (let i = 0; i < GIVE_UP_AFTER; i += 1) clock.tick();
  assert.deepEqual(seen, ['world'], '边界之前醒过来，照常交付');
  assert.equal(gaveUp, 0, '没说没醒来就不该说');
  assert.equal(clock.queued(), 0, '交付了就不再排');
});

test('只交付一次：面板挂两套 onResult 会让每句话回两遍', () => {
  const clock = fakeClock();
  let deliveries = 0;
  whenApi(() => 'world', () => {
    deliveries += 1;
  }, { schedule: clock.schedule });
  assert.equal(deliveries, 1);
  clock.tick();
  clock.tick();
  assert.equal(deliveries, 1, '拿到了就不再排，tick 也不该再触发一次');
});

test('src/ui 的代码里不出现 requestAnimationFrame', () => {
  // 结构上的那道闸。上面几条行为测试只覆盖 `when-api.ts` 一个文件；
  // 这条防的是**调用方**又把 rAF 捡回来。剔掉注释再看——
  // 注释里解释「为什么不用 rAF」正是这个仓库的写法，不能算违规。
  //
  // 后缀不限于 `.ts`：从前只收 `.ts`，于是新加的 `frames.js`、`extra.tsx`
  // 整个绕过去——而它们正是最可能重新捡回 rAF 的地方。
  const ui = fileURLToPath(new URL('../src/ui', import.meta.url));
  const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE.test(path)) files.push(path);
    }
  };
  walk(ui);

  const offenders = files
    .map((file) => ({ file, code: codeOf(file) }))
    .filter((entry) => entry.code.includes('requestAnimationFrame'))
    .map((entry) => entry.file.slice(ui.length + 1).replaceAll('\\', '/'));
  assert.deepEqual(offenders, [], `界面不能把生死绑在帧上：\n${offenders.join('\n')}`);
});

test('行尾注释里提一句 rAF 不算把它接回来', () => {
  // 误报一样毁掉一道闸。`codeOf` 从前只剔整行注释，于是
  // `void whenApi; // 从前这里用 requestAnimationFrame` 会让上面那条红——
  // 而那一行恰恰是在解释为什么不用它。守着这道闸的人会被迫删掉解释。
  const code = codeOf(new URL('./fixtures/trailing-comment.ts', import.meta.url));
  assert.equal(code.includes('requestAnimationFrame'), false, '行尾注释得挖掉');
  assert.equal(code.includes('realCall()'), true, '同一行的代码要留着');
});

test('字符串里的内容不算代码：网址里的双斜杠不能当成行尾注释', () => {
  // 收 `codeOf` 那道防线的另一侧。按行切 `//` 而不先挖字符串，
  // `fetch('http://…')` 会被切成 `fetch('http:`——于是这一行整段消失，
  // 而扫的是「有没有出现某个词」，消失的代码正是最该被扫到的地方。
  const code = codeOf(new URL('./fixtures/string-with-url.ts', import.meta.url));
  assert.equal(code.includes('requestAnimationFrame'), true, '字符串里的词照扫');
  assert.equal(code.includes('fetch('), true, '网址前面的代码不能被切掉');
});
