#!/usr/bin/env node
/**
 * 按钮审计：界面上每一个按得动的按钮，点下去世界都得给一句话。
 *
 * 为什么单独立一项：这个仓库的信条是「说谎比不去更糟」（`docs/SPEC.md`、
 * `world-client/src/world/routines.ts` 开头那段）。那句话原本管世界对用户说的
 * 话，可按钮是同一件事的另一面——一个摆在界面上的按钮就是一句承诺：「点我，
 * 会发生某事」。承诺了而什么都不发生，比没有这个按钮更糟：用户点了，屏幕
 * 安静，他不知道是世界坏了、是自己点错了、还是这事根本不该由他点。
 *
 * 这项审计不做语义判断（那句话说得准不准），只查一件机械的事：**每个按钮
 * 点下去之后，界面上有没有出现一句新的话**。没有就是 silence，也就是
 * `bindOraclePanel` 用 `requestAnimationFrame` 等 `window.Oracle` 时出过的
 * 毛病——世界照办，回执一个字都不显示。见 `src/ui/when-api.ts`。
 *
 * 「一句话」不止 `#reply` 一处。各面的反馈落在各自的表面上：
 *   - 神谕栏的话 → `#reply` / `#save-io-reply`
 *   - 世界的状态   → `#slab-count`、`#queue`
 *   - 抽屉的开关   → `#chronicle` / `#debug-panel` 的 hidden
 *   - 镇志的内容   → `#chronicle-heading` 与列表里的行
 * 只盯 `#reply` 会把好按钮审成沉默——第一版就这么冤了 `#chronicle-refresh`：
 * 它的反馈是标题翻成「镇志正在翻…」，压根不往神谕栏写。
 *
 * 按钮也不全摆在同一层上：镇志抽屉里有「重读」「关闭」「返回」，还有一按钮
 * 一条的记忆条目行；调试面板里有「关闭」。所以枚举要走过三层各自开/关的组合
 * ——只枚举一种状态，抽屉里那几颗一次都没被点到，那不是它们没反应，是审计
 * 没给它们机会。
 *
 * 两张图都过：默认世界（莞尔镇）与灯潮界。两张图的蓝图登记册不一样，
 * `oracle-panel` 的缺口按钮和静态造房按钮是按它显隐的，只测一张会漏一半。
 *
 * rAF 替身：与 `scripts/smoke-ego.mjs` 同一套（那段注释里有完整的实测记录）。
 * 无头 Chromium 里页面不合成时 rAF 近乎不触发，Phaser 场景不会 `create()`，
 * 世界时间不走——按钮点得下去，命令一个都不结算，于是每个按钮都会被审成
 * 「点了什么都不说」。那是脚本的毛病，不是按钮的。
 *
 * 用法：
 *   node scripts/dev-live.mjs &            # 或任何在 5188 的 vite
 *   node scripts/check-buttons.mjs         # 默认打 5188
 *   PIXEL_WORLD_URL=http://127.0.0.1:5175/ node scripts/check-buttons.mjs
 *
 * 退出码：测出问题就是 1（沉默、点不动、审到一半页面没了，三类都算）；
 * 一样都没测出来（背后没有服务端、镇志是空的）是 2。**0 只代表「跑完了且干净」。**
 */

import { chromium } from '@playwright/test';
import { waitForQuiet } from './quiesce.ts';

const BASE = process.env.PIXEL_WORLD_URL ?? 'http://127.0.0.1:5188/';

/**
 * 先问一句「背后有没有服务端，且镇志里有没有条目」，没有就拒跑。
 *
 * 这项审计的结论分两种：「按钮是哑的」和「我什么都没测出来」。把后者印成
 * 前者就是它自己在说谎——而这个仓库最不容的就是那一件。
 *
 * 实测踩过：对着一个裸 `vite`（没起服务端）跑，镇志那条 `/api/memory/list`
 * 回 404，列表一条都没有。于是阅读页永远打不开（`setLayers` 里那一等
 * 8 轮等不到 `.chronicle-row`），抽屉里四颗按钮一次都没被点到；镇志标题
 * 停在「读不到镇志：Not Found」上不再翻，「重读」于是被审成沉默。
 * 那次报出「46 个按钮、3 个一句话都不说」——三个全是冤的，同一份代码对着
 * 带后端的 5188 是 56 个按钮、0 个沉默。
 *
 * 一条后端就够了：`/api/memory/list` 是镇志的数据源，它拿不出条目时这半界
 * 界面都不该拿来下结论。
 *
 * **三种拒跑的理由分开说**，因为它们不是一回事：
 *   1. 连不上（`fetch` 抛）——背后真的没有服务端。
 *   2. 连上了但回非 2xx——服务端明明在，是那一个端点不高兴。原先这里也印
 *      「背后没有服务端：… HTTP 500」，前半句是假的：服务端在。
 *   3. 回了 200 但 `entries` 是空的——服务端在，可镇志里没有条目。阅读页
 *      照样打不开（没有 `.chronicle-row` 可点），抽屉里那几颗照样审不到，
 *      结论照样是冤的。所以这也算拒跑。
 */
async function requireBackend() {
  const url = new URL('api/memory/list', BASE);
  let status = 0;
  let detail = '';
  let entries = null;
  try {
    const response = await fetch(url);
    status = response.status;
    if (!response.ok) {
      detail = `HTTP ${response.status}`;
    } else {
      // 形状是 `{entries, count}`（`server/memory/api.py:94`）。解析不了就当
      // 没有条目——别拿一个猜出来的数去放行。
      try {
        const payload = await response.json();
        entries = Array.isArray(payload?.entries) ? payload.entries.length : null;
        if (entries === null) detail = '可里面没有 entries 数组';
      } catch {
        detail = '可响应体不是 JSON';
      }
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error);
  }

  // 1. 连不上：服务端不在。
  if (status === 0) {
    console.error(
      `背后没有服务端：${url.href} ${detail}\n` +
        '这项审计要连着后端跑（镇志条目、意图端点都靠它）。\n' +
        '  node scripts/dev-live.mjs &     # 服务端 + 前端，5188\n' +
        '对着裸 vite 跑，测不出沉默也测不出说话——它只会把好按钮冤成哑巴。',
    );
    process.exit(2);
  }
  // 2. 连上了但那一端不高兴：别把服务端说成不在。
  if (status < 200 || status >= 300) {
    console.error(
      `服务端在，但 ${url.href} 回了 ${detail}。\n` +
        '服务端活着而这条数据源拿不到，审计的结论一样是冤的——镇志条目靠它，\n' +
        '没有条目，阅读页打不开，抽屉里那几颗一次都点不到。',
    );
    process.exit(2);
  }
  // 3. 服务端在、端点也高兴，可镇志拿不出条目（空数组，或响应体不是想要的形状）。
  if (entries === null) {
    console.error(
      `服务端在，${url.href} 也回了 200，${detail}。\n` +
        '不知道镇志里有没有条目，就不该拿这一屏下结论。',
    );
    process.exit(2);
  }
  if (entries === 0) {
    console.error(
      `服务端在，可镇志里一条条目都没有（${url.href} 的 entries 是空的）。\n` +
        '阅读页打不开（没有 .chronicle-row 可点），抽屉里那几颗按钮一次都审不到——\n' +
        '那种「沉默」是这条数据源造成的，不是按钮的毛病。先往镇志里写几条：\n' +
        '  POST /api/memory/write，或跑一次带神谕的会话。',
    );
    process.exit(2);
  }
}
await requireBackend();

/** MessageChannel 门控到 60fps。测试专用，不进产物。 */
const RAF_PATCH = `(() => {
  const realNow = performance.now.bind(performance);
  const channel = new MessageChannel();
  const cbs = [];
  let scheduled = false;
  let last = -1e9;
  const FRAME = 1000 / 60;
  const pump = () => {
    const t = realNow();
    if (t - last < FRAME) { channel.port2.postMessage(0); return; }
    last = t;
    scheduled = false;
    const batch = cbs.splice(0, cbs.length);
    for (const cb of batch) { try { cb(t); } catch (e) {} }
  };
  channel.port1.onmessage = () => { pump(); };
  window.requestAnimationFrame = (cb) => { cbs.push(cb); if (!scheduled) { scheduled = true; channel.port2.postMessage(0); } return cbs.length; };
  window.cancelAnimationFrame = () => {};
  window.__rafPatched = '60fps';
})();`;

/** 三层：调试面板、镇志抽屉、镇志的阅读页。各自开/关。 */
const LAYER_STATES = [
  { debug: false, chronicle: false, reader: false },
  { debug: true, chronicle: false, reader: false },
  { debug: false, chronicle: true, reader: false },
  { debug: true, chronicle: true, reader: false },
  { debug: false, chronicle: true, reader: true },
  { debug: true, chronicle: true, reader: true },
];

/** 两张图。`?debug=1` 才展开维护条——产品页默认只有世界、神谕栏和镇志。 */
const WORLDS = [
  { label: '莞尔镇（默认）', query: '?debug=1' },
  { label: '灯潮界', query: '?world=dengchao&debug=1' },
];

/**
 * 点了会离开当前界面的，不进循环：刷新会把后半截按钮全测成「没反应」，
 * 而那不是它们的毛病。
 */
const SKIP = new Set(['load-save', 'save-import']);

/**
 * 每颗按钮前后各等一次「屏幕安静」：连读两次一样才算安静，最多等这么久。
 *
 * 镇志的 `load()` 慢过那 900ms 时，它的后效会落进**下一颗**按钮的窗口——
 * 下一颗的 `before` 是它之前读的，`after` 就凭空多出几行条目，于是一颗
 * 什么都没说的按钮被判「说了话」。等满再收工，迟到的效果才落到它自己那颗
 * 头上。上限 3 秒：再等下去只是在拖慢全套，而真实的镇志读取是几十毫秒。
 */
const SETTLE_MS = 3000;
const SETTLE_STEP_MS = 100;

/**
 * 反馈在「某一层开没开」上的按钮，不在 `#reply` 上。
 *
 * 判它们看的是「可见性翻没翻」，不指定方向——这一组里既有开层的（镇志、
 * 调试面板、条目行）也有关层的（两个「关闭」与「返回」）。
 */
const LAYER_IDS = new Set([
  'chronicle-open',
  'chronicle-close',
  'chronicle-back',
  'debug-toggle',
  'debug-close',
]);

/** 条目行没有 id，按选择器认。选择器长这样：`button[data-chronicle-path="…"]`。 */
const isEntryRow = (selector) => selector.startsWith('button[data-chronicle-path=');

const opensLayer = (button) => LAYER_IDS.has(button.id) || isEntryRow(button.selector);

/**
 * 提交神谕那一颗：得先往输入框里放一句话。
 *
 * 空句子本来就说不出话（`submit` 挡在 trimmed.length === 0），拿空输入去点
 * 会把一颗好按钮审成 silence。放的是一句世界**认不出**的话：这样它会回一句
 * 拒绝的理由，而世界一个比特都不改——后面的按钮还在同一份界面上被审。
 */
const FILL_BEFORE = new Map([['#oracle button[type="submit"]', '今天天气不错']]);

const browser = await chromium.launch({ headless: true });

/** 一句话都说不出来的按钮。 */
const silent = [];
/**
 * 没能审完的按钮：点不动的，和它之后页面就没了的。
 *
 * 与 `silent` 分开记，因为这两类**不是按钮的毛病，是审计的**——可它们一样
 * 得让退出码非 0。原先只把 `silent` 算进 `process.exitCode = 1`，于是
 * 「点不动」与「这一颗之后页面不在了」都退 0：一个按钮摆在界面上点不动，
 * 比它不说话更糟，而脚本说没事。页面不在了更重——那意味着**后半截一颗都
 * 没审**，而汇总里读起来像审完了。
 */
const blocked = [];
/** 每一行的记录，最后整张打出来。 */
const rows = [];

for (const world of WORLDS) {
  // 一张图一个浏览器。多个页面挤在一个浏览器里时，Chromium 会把不是当前标签的
  // 那几个的定时器节流到 1 秒一拍（`scripts/verify-reply.mjs` 的注释里记着实测）。
  // 这项审计不等页内定时器，可世界那一侧等——别让浏览器怎么调度掺进来。
  const worldBrowser = await chromium.launch({ headless: true });
  const page = await worldBrowser.newPage({ viewport: { width: 1180, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // 每张图都从一份干净的存档开始：上一张图写下的单槽会让这张图一开局就
  // 「读档重建」，测的就不是这张图自己的开局了。
  await page.addInitScript(() => {
    try {
      localStorage.clear();
    } catch {
      /* 隐私模式等场景忽略 */
    }
  });
  await page.addInitScript(RAF_PATCH);

  await page.goto(`${BASE}${world.query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__rafPatched === '60fps', null, { timeout: 10000 });
  await page.waitForFunction(() => window.Oracle !== undefined, null, { timeout: 20000 });

  // 等界面真画上：`whenApi` 挂上之后 `#world-state` 才会离开占位那句。
  await page.waitForFunction(
    () => {
      const line = document.querySelector('#world-state')?.textContent ?? '';
      return line.length > 0 && !line.includes('正在醒来');
    },
    null,
    { timeout: 20000 },
  );

  const worldState = await page.textContent('#world-state');
  const gapButtons = await page.$$eval('#build-row button[data-gap]', (nodes) => nodes.map((n) => n.textContent));
  const hiddenStatic = await page.$$eval('button[data-build], button[data-create]', (nodes) =>
    nodes.map((n) => `${n.dataset.build ?? n.dataset.create}=${n.hidden ? 'hidden' : 'shown'}`),
  );

  /**
   * 页面被重载过几次。开发服务器上每次保存文件都整页重载（Vite 的
   * `page reload`），执行上下文当场销毁——实测踩到：同伴在改 `render/` 下的文件，
   * 这一轮审计连着三颗按钮报「点不动」，其中一颗是「下雨」。那不是按钮的毛病，
   * 是屏幕在它脚底下换了。
   *
   * 而这个仓库最不容的就是冤判——脚本自己那份注释里记着被冤的三个按钮。所以
   * 每一次点完都问一句「这中间页面换过没有」：换过就记成「赶上页面重载」，
   * 不记成「点不动」。
   */
  let reloads = 0;
  page.on('framenavigated', () => {
    reloads += 1;
  });

  /** 此刻三层各开着没有。 */
  const layersNow = () =>
    page.evaluate(`({
      debug: !(document.querySelector('#debug-panel')?.hidden ?? true),
      chronicle: !(document.querySelector('#chronicle')?.hidden ?? true),
      reader: !(document.querySelector('#chronicle-reader')?.hidden ?? true),
    })`);

  /** 把三层调到想要的状态。 */
  const setLayers = async (want) => {
    for (let guard = 0; guard < 8; guard += 1) {
      const now = await layersNow();
      if (now.debug === want.debug && now.chronicle === want.chronicle && now.reader === want.reader) return;
      if (now.debug !== want.debug) await page.click('#debug-toggle');
      else if (now.chronicle !== want.chronicle) await page.click('#chronicle-open');
      else if (now.reader !== want.reader) {
        // 开阅读页：点列表里第一行。关阅读页：点「返回」。
        // 镇志刚开时 `load()` 还在飞，行可能还没画出来——下一轮 guard 再试。
        if (want.reader) {
          const clicked = await page.evaluate(() => {
            const row = document.querySelector('.chronicle-row');
            if (row === null) return false;
            row.click();
            return true;
          });
          if (!clicked) {
            await page.waitForTimeout(250);
            continue;
          }
        } else {
          await page.click('#chronicle-back');
        }
      }
      await page.waitForTimeout(300);
    }
  };

  /**
   * 此刻看得见的按钮，每颗带一个**稳定的**选择器。
   *
   * 不能靠下标：`paintWorldState` 每次 `onStatus` 都把缺口按钮删了重加，下标会漂。
   *
   * 可见性用 `checkVisibility()`，不用 `offsetParent !== null`：`#debug-toggle` 是
   * `position: fixed`，它的 `offsetParent` 永远是 null——第一版就这么把那颗按钮
   * 整颗从审计里漏掉了，而它恰是开调试面板的那一颗。
   */
  const visibleButtons = () =>
    page.$$eval('button', (nodes) =>
      nodes
        .filter((n) => n.checkVisibility({ checkVisibilityCSS: true }))
        .map((n) => {
          let selector = null;
          if (n.id !== '') selector = `#${n.id}`;
          else if (n.dataset.kind !== undefined) selector = `button[data-kind="${n.dataset.kind}"]`;
          else if (n.dataset.build !== undefined) selector = `button[data-build="${n.dataset.build}"]`;
          else if (n.dataset.create !== undefined) selector = `button[data-create="${n.dataset.create}"]`;
          else if (n.dataset.miracle !== undefined) selector = `button[data-miracle="${n.dataset.miracle}"]`;
          else if (n.dataset.gap !== undefined) selector = `button[data-gap="${n.dataset.gap}"]`;
          else if (n.dataset.chroniclePath !== undefined) {
            selector = `button[data-chronicle-path="${n.dataset.chroniclePath}"]`;
          } else if (n.type === 'submit') selector = '#oracle button[type="submit"]';
          return {
            id: n.id || '(anon)',
            text: (n.textContent || '').trim(),
            selector,
          };
        })
        .filter((entry) => entry.selector !== null),
    );

  // 六种界面状态各枚举一遍，按选择器合并。记下每颗按钮在哪几种状态下看得见：
  // 点它之前要先把界面调成那样。
  const seen = new Map();
  for (const state of LAYER_STATES) {
    await setLayers(state);
    await page.waitForTimeout(150);
    for (const button of await visibleButtons()) {
      const key = button.selector;
      if (!seen.has(key)) seen.set(key, { ...button, states: [] });
      seen.get(key).states.push(state);
    }
  }
  const buttons = [...seen.values()];

  console.log(`\n=== ${world.label} · ${world.query} ===`);
  console.log(`世界状态：${worldState}`);
  console.log(`缺口按钮：${gapButtons.length === 0 ? '（无）' : gapButtons.join(' / ')}`);
  console.log(`静态造房按钮：${hiddenStatic.join(' / ')}`);
  console.log(`六种界面状态合起来 ${buttons.length} 个按钮\n`);

  /** 界面上几处该看的表面，一次读完。 */
  const readScreen = () =>
    page.evaluate(`({
      reply: (document.querySelector('#reply')?.textContent ?? '').trim(),
      bad: document.querySelector('#reply')?.classList.contains('bad') ?? false,
      io: (document.querySelector('#save-io-reply')?.textContent ?? '').trim(),
      slab: document.querySelector('#slab-count')?.textContent ?? '',
      queue: document.querySelector('#queue')?.hidden ?? true,
      chronicle: document.querySelector('#chronicle')?.hidden ?? true,
      heading: (document.querySelector('#chronicle-heading')?.textContent ?? '').trim(),
      entries: document.querySelectorAll('.chronicle-row').length,
      reader: document.querySelector('#chronicle-reader')?.hidden ?? true,
      debug: document.querySelector('#debug-panel')?.hidden ?? true,
    })`);

  /** 两块屏幕之间，哪一样翻了都算「说了话」。 */
  const saidSomething = (before, after) =>
    after.reply !== before.reply ||
    after.io !== before.io ||
    after.slab !== before.slab ||
    after.queue !== before.queue ||
    after.chronicle !== before.chronicle ||
    after.heading !== before.heading ||
    after.entries !== before.entries ||
    after.reader !== before.reader ||
    after.debug !== before.debug;

  /**
   * 等到屏幕连读两次一样，或等满 `SETTLE_MS`。返回末一次的读数。
   *
   * **这是为了不把一颗沉默的按钮洗干净。** 镇志的 `load()` 是异步的，慢过
   * 900ms 时它的后效落在**下一颗**按钮的窗口里：下一颗的 `before` 若是那时
   * 之前读的，`after` 就比 `before` 多出几行条目——于是下一颗明明什么都没说，
   * 却因为上一颗的迟到效果被判「说了话」。原先只有 900ms 一拍，这个洞一直开着。
   *
   * 两头等：点之前等一次（起点干净），点之后也等一次（迟到效果落到它自己那颗
   * 头上——`changed` 拿末次读数与起点比，所以算它的）。
   *
   * 判据本身在 `scripts/quiesce.ts`，那边有单元测试：页面这一侧没法在测试里
   * 准时落一个改动，而这道等法闭上嘴时整套审计就开始洗白，不能没有守卫。
   *
   * **别在这里再加一段「把屏幕变了记回上一颗」。** 试过，撤了：`setLayers` 就在
   * 上一行跑过，每颗按钮的层状态本来就未必相同，于是「屏幕变了」几乎每颗都命中
   * （实测 18 次里 12 次 true），而判据只拦沉默行——那是一台洗白机，比不修更糟。
   * 末了那次等已经够，见上面第二段。
   */
  const settleScreen = (ms = SETTLE_MS) =>
    waitForQuiet(readScreen, (n) => page.waitForTimeout(n), ms, SETTLE_STEP_MS);

  /**
   * 点下去之前页面重载过几次。出错时拿来分「按钮点不动」与「屏幕换了」。
   */
  let reloadsAtClick = 0;

  /** 审一颗按钮。抛出去由外层接（见那边关于「崩在半路上」的注释）。 */
  const auditButton = async (button) => {
    // 只在某几种界面状态下看得见的按钮（抽屉里那几颗），先把界面调成那样再点——
    // 否则它会被前面调层时关掉的抽屉挡住，报成「藏起来了」，读起来像按钮坏了。
    await setLayers(button.states[button.states.length - 1]);

    // 等屏幕安静下来，再取这一颗的起点。
    //
    // **别在这儿把「屏幕变了」记回上一颗头上。** 试过，撤了：`setLayers` 就在
    // 上一行跑过，每颗按钮的层状态本来就未必相同，于是「屏幕变了」几乎每颗都
    // 命中（实测 18 次里 12 次 true）。判据只拦 `verdict === '一句话都不说'`，
    // 所以那是一台**洗白机**：一颗真沉默的按钮，只要下一颗的层状态跟它不同，
    // 就被改判成「在别处说了话」——比不修更糟。
    //
    // 而且它本来就是多余的：末了那次 `settleScreen()` 已经把迟到效果收在这一颗
    // 头上了（见那边）。迟到效果唯一的漏网之路是「本颗等满了才落」，那窗口窄，
    // 拿一台洗白机去换不值。
    const before = await settleScreen();

    // 每颗按钮都从同一份界面状态起点问起：把上一颗留下的回执清掉，
    // 否则「这一颗什么都没说」会被上一颗的话冒充。
    //
    // 清完得把 `before` 里那两个字段一起改掉，不能重新读一遍屏：上一颗的异步
    // 后效可能正在这时落下来，重读就把它并进了起点，下一颗又洗白了。而这两个
    // 字段是我们自己清的，清成什么我们知道——照着改，不用问屏幕。
    // （`bad` 那个 class 不动：`textContent = ''` 不会摘掉它，所以它还是上一颗
    // 留下的样子。`saidSomething` 不比它，别去改一个不是我们改的东西。）
    await page.evaluate(() => {
      const reply = document.querySelector('#reply');
      if (reply !== null) reply.textContent = '';
      const io = document.querySelector('#save-io-reply');
      if (io !== null) io.textContent = '';
    });
    before.reply = '';
    before.io = '';

    // 到了点击这一刻再问一次可见性。照着枚举时的那份状态去点，只会等到一个
    // 超时——那读起来像按钮坏了，其实是它已经不在界面上。
    const visible = await page.evaluate(
      (selector) => {
        const node = document.querySelector(selector);
        return node !== null && node.checkVisibility({ checkVisibilityCSS: true });
      },
      button.selector,
    );
    if (!visible) {
      rows.push({ world: world.label, ...button, verdict: '藏起来了（点它之前它已经不在界面上）', reply: '' });
      console.log(`  -- ${button.id.padEnd(16)} ${button.text.slice(0, 20)}  → 藏起来了：点它之前它已经不在界面上`);
      return;
    }

    const fill = FILL_BEFORE.get(button.selector);
    if (fill !== undefined) await page.fill('#utterance', fill);

    reloadsAtClick = reloads;
    await page.click(button.selector, { timeout: 5000 });

    // 早读一次：有的反馈是瞬态的。「重读」把标题翻成「镇志正在翻…」，本地
    // 取数几十毫秒就翻回来了——只读末态会一样都没看见，于是把一颗好按钮
    // 审成沉默。读两头，任一头翻了都算它说了话。
    await page.waitForTimeout(150);
    const early = await readScreen();
    // 再给世界几拍。命令的结算在下一个逻辑拍，结果走 onResult → #reply。
    await page.waitForTimeout(opensLayer(button) ? 350 : 900);
    const after = await readScreen();
    // 末了再等一次：异步的后效（镇志的 load）可能比那 900ms 还慢。不等着，
    // 它就落到下一颗的窗口里，把下一颗洗干净。
    const settled = await settleScreen();

    const said = after.reply || after.io;
    const changed =
      saidSomething(before, early) || saidSomething(before, after) || saidSomething(before, settled);

    // 判词问的是「界面上有没有哪一面翻了」，不是「`#reply` 有没有字」。
    //
    // 曾按后者判：于是 `chronicle-refresh` 被审成沉默——它的反馈是标题翻成
    // 「镇志正在翻…」，压根不往神谕栏写。还有条目行：它开的是阅读页，
    // 反馈在 `#chronicle-reader` 的 hidden 上。只盯一处就会把好按钮冤死。
    //
    // 翻在了哪儿另说一句：`#reply` / `#save-io-reply` 是神谕栏的回执，
    // 别处翻了的（层开关、镇志内容、世界状态）记成「在别处说了话」——
    // 那也是说了话，只是不在那一行。
    let verdict;
    let note = '';
    if (!changed) {
      verdict = '一句话都不说';
      silent.push({ world: world.label, id: button.id, text: button.text.slice(0, 20) });
    } else if (said.length > 0) {
      verdict = after.bad ? '拒了（说了理由）' : '办了';
      if (fill !== undefined) {
        note = `（输入框先放了「${fill}」——世界认不出它，正好有个理由可说，且一个比特都不改）`;
      }
    } else {
      verdict = '在别处说了话';
    }

    rows.push({ world: world.label, ...button, verdict, reply: said.slice(0, 70) });
    const mark = verdict === '办了' ? 'ok' : verdict === '一句话都不说' || verdict === '点不动' ? '!!' : '~ ';
    console.log(`  ${mark} ${button.id.padEnd(16)} ${button.text.slice(0, 20).padEnd(22)} → ${said.slice(0, 60) || verdict}${note}`);
  };

  for (const button of buttons) {
    if (SKIP.has(button.id)) {
      rows.push({ world: world.label, ...button, verdict: '跳过（会离开当前界面）', reply: '' });
      console.log(`  -- ${button.id.padEnd(16)} ${button.text.slice(0, 20)}  → 跳过：点了会离开当前界面`);
      continue;
    }

    // 每颗按钮单独接错。
    //
    // 审计做到一半抛一个栈出来，是最坏的收场：前面几十颗的结果全没了，
    // 而读的人只看见一个崩溃。实测崩过一次——某颗按钮让页面重载
    // （`location.reload` 在 `loadSave` 与存档导入两处，`save-export`
    // 走 blob 下载，无头下偶发也被当成导航），下一颗的 `page.evaluate`
    // 就报「Execution context was destroyed」。
    //
    // 接住之后分两种：页面还在，那是这一颗点不动，记下来往下走；
    // 页面不在了，剩下的按钮这一轮审不到，说清楚审到第几颗，别装作审完了。
    try {
      await auditButton(button);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 这一颗点下去之后页面换过没有？换过就不是按钮的毛病——屏幕在它脚底下
      // 换了，点什么都一样。别把这种记成「点不动」：那是冤判，而冤判比漏判更糟。
      const navigated = reloads > reloadsAtClick;
      if (navigated) {
        blocked.push({ world: world.label, id: button.id, text: button.text.slice(0, 20), kind: '页面重载' });
        rows.push({ world: world.label, ...button, verdict: '赶上页面重载，这一颗审不了', reply: message.slice(0, 80) });
        console.log(`  ~~ ${button.id.padEnd(16)} ${button.text.slice(0, 20)}  → 赶上页面重载：审这一颗的中间屏幕换了，不是它的毛病`);
        continue;
      }
      const alive = await page.evaluate(() => document.readyState).then(() => true).catch(() => false);
      if (!alive) {
        const rest = buttons.length - rows.length;
        blocked.push({ world: world.label, id: button.id, text: button.text.slice(0, 20), kind: '页面不在了' });
        rows.push({ world: world.label, ...button, verdict: '这一颗之后页面不在了', reply: message.slice(0, 80) });
        console.log(`  !! ${button.id.padEnd(16)} ${button.text.slice(0, 20)}  → 这一颗之后页面不在了`);
        console.log(`\n${world.label}：审到第 ${rows.length} 颗，剩下 ${rest} 颗这一轮没审到。`);
        console.log(`原因：${message.slice(0, 120)}`);
        break;
      }
      blocked.push({ world: world.label, id: button.id, text: button.text.slice(0, 20), kind: '点不动' });
      rows.push({ world: world.label, ...button, verdict: '点不动', reply: message.slice(0, 80) });
      console.log(`  !! ${button.id.padEnd(16)} ${button.text.slice(0, 20)}  → 点不动：${message.slice(0, 60)}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\n页面报错：\n${errors.join('\n')}`);
  }
  await worldBrowser.close();
}

await browser.close();

console.log(`\n=== 汇总 ===`);
console.log(`两张图共 ${rows.length} 个按钮，其中 ${silent.length} 个点下去一句话都不说。`);
for (const item of silent) {
  console.log(`  [${item.world}] #${item.id} 「${item.text}」`);
}
if (blocked.length > 0) {
  // 单独一段、分开数：这几类不是按钮的毛病，可它们一样得让退出码非 0。
  // 混在 silent 里念，读的人会以为界面上多了几个哑巴。
  const dead = blocked.filter((item) => item.kind === '点不动');
  const cut = blocked.filter((item) => item.kind === '页面不在了');
  const reloaded = blocked.filter((item) => item.kind === '页面重载');
  console.log(`\n没能审完的 ${blocked.length} 处（这些是审计自己的问题，不是按钮的毛病，但一样不让它过）：`);
  for (const item of dead) console.log(`  [${item.world}] #${item.id} 「${item.text}」点不动`);
  for (const item of cut) console.log(`  [${item.world}] #${item.id} 「${item.text}」之后页面不在了，后面的没审到`);
  for (const item of reloaded) console.log(`  [${item.world}] #${item.id} 「${item.text}」赶上页面重载（开发服务器保存文件就会整页重载），这一颗没审到`);
  if (dead.length > 0) {
    console.log('点不动的比不说话更糟：它还在界面上，玩家点了，什么都没有。');
  }
  if (reloaded.length > 0) {
    console.log('页面重载不是按钮的毛病，可它意味着这一颗确实没审——对着一个正在改代码的开发服务器跑，就会出现这种。');
  }
}
if (silent.length > 0) {
  console.log('\n一个按钮就是一句承诺。承诺了而屏幕安静，比没有这个按钮更糟。');
}
if (silent.length > 0 || blocked.length > 0) {
  process.exitCode = 1;
}
