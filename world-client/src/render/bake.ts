/** 把静态图层烘焙成纹理。
 *
 * 为什么：Phaser 的 Graphics 不是缓存纹理。每一帧它都会遍历 commandBuffer，
 * 把每条 fillRect 重新三角化成 quad、重新上传。地形与迷雾都是**一次性画完就不再变**
 * 的静态内容，不该每帧重付这笔钱。
 *
 * 这里原来写着「地形一次性画进去 51 万条指令，迷雾 24 万条——每帧 77 万 quad，
 * 而可见区域只占世界的 12.5%」。三个数都不成立：
 *
 * - **迷雾那个数不可能。** `fog-view.ts` 的循环跑 (1536/4)×(1152/4) = 110592 次，
 *   每次最多发一条 `fillStyle` 加一条 `fillRect`，上限 221184 条——比「24 万」
 *   还少。半径内那批直接 `continue`，实际更少。
 * - **可见区域是 8.7%，不是 12.5%。** `main.ts` 里 `VIEW_WIDTH` / `VIEW_HEIGHT`
 *   是 30×20 格 = 480×320 px，世界 96×72 格 = 1536×1152 px，
 *   480×320 / (1536×1152) = 0.0868。12.5% 对应的是 480×320 / (1280×960)，
 *   也就是 **80×60 格**的世界——那个尺寸从来没存在过（`fog.ts` 的文件头记着
 *   「80×60 是个从来没存在过的尺寸，这个世界从一开始就是 96×72」）。
 *   （这一条我第一笔写错了，写成「480×320 / 960×640」，而那是 25% 不是 12.5%；
 *   已改。教训是：连"反证的算术"也要真算一遍。）
 * - **地形那个数（51 万）没有单独的量。** 数得出来的只有下限：底色那一趟就是
 *   6912 格 × 2 条 = 13824 条（`tilemap.ts` 的第一次遍历），上面还有材质结构、
 *   拼接边、种植带、篱笆、dressing、水线六趟，总数随地形配比变，不是常数。
 *   **但「没人量过」这句话我说错了。** 仓库里确实有一份量：
 *   `scripts/check-render-budget.mjs`（npm 的 `test:render-budget`）记着「实测 77 万条，
 *   其中 87% 在屏幕外」与「烘焙后实测约 2 万」。这三个数自 `996cbd3` 写下那天起没被动过
 *   ——`cff1bed` 后来碰过**那个脚本**一次，只改了 playwright 的 import 路径
 *   （`'../../node_modules/@playwright/test/index.mjs'` → `'@playwright/test'`），
 *   数字一行没动。注意那笔动的不是本文件：`bake.ts` 自 `996cbd3` 之后只被注释修订
 *   碰过（`0d70cad` / `6bf0a57` / `46ec540` / `d36aad2`），没有一笔改过实现。
 *   它也不是 CI 会重跑的东西：脚本要一个活在 5188 的开发服务器（`ci.yml` 跑的是
 *   check / test / build / audit-palette / audit-references，没有它），所以那是一份
 *   **手工记下的量**，不是每次提交都在复核的量。
 *   所以「指令总量这个量级有人量过」是真的，被删掉的那个「77 万」总数也确实有出处；
 *   站不住的只是**地形/迷雾那个拆分**——迷雾那半已由上面的算术证伪，地形那半
 *   （51 万）没有任何记录把 77 万拆成 51 + 24。而那 87% 在屏幕外，正是与这句
 *   被删的「可见区域只占世界的 12.5%」最接近的仓内数字（87% 在屏幕外 = 13% 在屏内）。
 *   而这三个数还被另外两处照抄：`SandboxScene.ts` 里地形烘焙那一笔、`fog-view.ts`
 *   文件头。两处都在 `0d70cad` 那一笔里改了——**不是写下这段的 `6bf0a57`**，
 *   那一笔只动了 `bake.ts` / `tide-view.ts` / `villager.ts`。
 *
 * 原来还引着「实测（`docs/VIEW_CULLING_RESEARCH.md`）：拖动时主线程一半以上时间
 * 花在 `GraphicsWebGLRenderer` 与 `batchQuad` 上」——那份文档不在仓库里，
 * `git log --all --diff-filter=A` 全史也查无此文件，`GraphicsWebGLRenderer` /
 * `batchQuad` 在源码与文档里也只出现在本注释里。所以那句「实测」没有出处，
 * 一并删掉。结论（该烘）不依赖这些数：Graphics 每帧重算 commandBuffer 这件事
 * 本身就够构成理由，数只是量级。
 *
 * 烘焙之后，静态内容变成一个 quad。代价是内容变化时要重烘一次——而地形只在
 * 扩建后变，迷雾只在揭示半径变时变，都不是每帧的事。
 */

import Phaser from 'phaser';

export interface BakedLayer {
  readonly image: Phaser.GameObjects.Image;
  /** 重烘：内容变了就调它。 */
  readonly rebake: () => void;
  readonly destroy: () => void;
}

/**
 * 用 `draw` 画一遍，把结果存成纹理并贴到 `depth`。
 *
 * `key` 必须是全局唯一的纹理名：同名会复用旧纹理，画面就停在上一版。
 */
export function bakeLayer(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  depth: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): BakedLayer {
  let image: Phaser.GameObjects.Image | null = null;

  const rebake = (): void => {
    // 先画到一个不进场景的 Graphics 上。
    const g = scene.make.graphics({}, false);
    draw(g);
    // 旧纹理要先删：同 key 的 generateTexture 会直接复用，画面不更新。
    if (scene.textures.exists(key)) scene.textures.remove(key);
    g.generateTexture(key, width, height);
    g.destroy();

    if (image === null) {
      image = scene.add.image(0, 0, key).setOrigin(0, 0);
      image.setDepth(depth);
    } else {
      image.setTexture(key);
    }
  };

  rebake();

  return {
    get image(): Phaser.GameObjects.Image {
      if (image === null) throw new Error('烘焙失败：纹理没有创建');
      return image;
    },
    rebake,
    destroy() {
      image?.destroy();
      image = null;
      if (scene.textures.exists(key)) scene.textures.remove(key);
    },
  };
}
