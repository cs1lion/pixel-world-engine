/**
 * `npm test` 的 `--import` 入口：装上 `phaser-resolve.mjs`。
 *
 * 一条命令，只做一件事——让 `import ... from 'phaser'` 在测试里落到空壳上。
 * 没有它，`src/render/` 下那几个只把 Phaser 当类型用的文件在 Node 里加载不了，
 * 它们的几何就只能靠肉眼看，而「靠肉眼看」在这个仓库里等于没有验收标准。
 */
import { register } from 'node:module';

register(new URL('./phaser-resolve.mjs', import.meta.url));
