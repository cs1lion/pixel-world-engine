/**
 * 「等屏幕安静」——连读两次一样才算安静。
 *
 * 这是 `scripts/check-buttons.mjs` 里唯一拦着**上一颗按钮的迟到效果洗掉下一颗**
 * 的东西，所以它得能被测：页面那一侧没法在单元测试里准时落一个改动，而这道
 * 等法悄悄闭上嘴，整套按钮审计就开始洗白有罪的按钮。
 *
 * 抽成纯函数（读屏、睡眠、时长都从外面给）就是为了这个。真实的那一份在
 * `check-buttons.mjs` 里，读的是 `page.evaluate`，睡的是 `page.waitForTimeout`。
 */

/** 屏幕的一次读数。键由调用方给，这里只比「一样不一样」。 */
export type ScreenReading = Readonly<Record<string, unknown>>;

/** 两次读数一样不一样。逐键比——键集合不同也算不一样。 */
export function sameReading(a: ScreenReading, b: ScreenReading): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/**
 * 读到连读两次一样为止，最多等 `maxMs`。
 *
 * 返回**最后一次**的读数，不是第一次：上一颗的迟到后效若在这段里落到屏幕上，
 * 末次读数就带着它，于是它算在上一颗头上（调用方拿返回值与起点比）。返回第一次
 * 的话，这道等法就白等了。**两条出路共用这一个 return**——安静时走、等满时也走，
 * 别分成两句：等满那一条有 `quiesce.test.ts` 的「一直不安静」盯着（末次读数与
 * 第一次不同，分家就红），可安静那一条只有「屏幕本来就安静」那条间接看着，
 * 分家时先改它仍然是悄无声息的。共用一个 return 是为了让这种分家没有地方可改。
 *
 * 等满 `maxMs` 也收工，不无限等。屏幕一直翻（世界自己在动）时，等下去只是拖慢
 * 全套——那时能说的只是「等过了」，不是「等到了」。睡的是**第一个让累加值不低于
 * `maxMs` 的整步**，所以总数可能比 `maxMs` 多出不到一个 `stepMs`（250/100 睡到
 * 300）：检查安静只能发生在整步末尾，这不是缺陷，但别把它说成「不会多睡」。
 *
 * 时长按睡着的累计算，不看钟：测试里于是能确定性地走到等满那一步，不用真等。
 */
export async function waitForQuiet(
  read: () => Promise<ScreenReading>,
  sleep: (ms: number) => Promise<void>,
  maxMs: number,
  stepMs: number,
): Promise<ScreenReading> {
  let last = await read();
  let waited = 0;
  while (waited < maxMs) {
    await sleep(stepMs);
    waited += stepMs;
    const now = await read();
    const quiet = sameReading(now, last);
    last = now;
    if (quiet) break;
  }
  return last;
}
