/**
 * Phaser 的空壳。只在跑测试时顶替真的 phaser。
 *
 * 为什么需要它：`src/render/` 下有几个文件**值级**一行都不用 Phaser，只在类型
 * 位置提它（`decor.ts` 是典型——通篇 `Phaser.GameObjects.Graphics` 全是类型注解）。
 * 那些文件的几何因此可以在 Node 里直接跑，而 import 一句 `phaser` 就把路堵死了
 * （真包在 Node 下要 `window`）。
 *
 * 所以测试侧给它一个空对象：类型注解在跑的时候已经被擦掉了，值级一次都不碰它。
 * 谁真在值级用了 Phaser，那个测试会当场炸，不会静悄悄地拿一个空对象跑完——
 * 那正是我们想要的失败方式。
 *
 * 由 `phaser-resolve.mjs` 指过来，入口是 `phaser-hooks.mjs`（`npm test` 带
 * `--import ./test/phaser-hooks.mjs`）。改那条命令前先读这里。
 */
export default {};
