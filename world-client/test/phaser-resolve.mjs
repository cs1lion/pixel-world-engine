/**
 * 把 `phaser` 指到 `phaser-stub.mjs`，其余一概放行。
 *
 * 为什么用 loader 而不是在测试里 `vi.mock`／手写一份副本：
 *  loader 让测试 import 的是**真的那个文件**（`src/render/decor.ts`），
 *  量出来的剪影就是这个仓库明天的剪影。抄一份副本的话，量的是抄来的那一份，
 *  decor.ts 改了它不会红——那跟把数抄在注释里没有区别。
 *
 * 只拦 `phaser` 这一个说明符，别的原样交给下一个 resolver：整个测试套件
 * （`node --test test/*.test.ts`）都从这条路过，多拦一个都是给全仓加风险。
 */
export async function resolve(specifier, context, next) {
  if (specifier === 'phaser') {
    return { url: new URL('./phaser-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
