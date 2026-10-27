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
 * - **可见区域是 8.7%，不是 12.5%。** `main.ts:72-73` 的视野是 30×20 格 =
 *   480×320 px，世界 96×72 格 = 1536×1152 px，480×320 / (1536×1152) = 0.0868。
 *   12.5% 只在 480×320 / 960×640 这种不存在的世界上成立——这个世界从一开始
 *   就是 96×72（`fog.ts:25` 记着「80×60 是个从来没存在过的尺寸」，同一笔账）。
 * - **地形那个数没人量过。** 数得出来的只有下限：底色那一趟就是 6912 格 × 2 条
 *   = 13824 条（`tilemap.ts:47-52`），上面还有材质结构、拼接边、苗圃、篱笆、
 *   dressing、水线六趟，总数随地形配比变，不是常数。**没有实测就不要引一个数**——
 *   原来那个数正是这么来的，而它还被另外两处照抄：`SandboxScene.ts` 里地形烘焙
 *   那一笔、`fog-view.ts` 文件头。两处都在这同一笔里改了。
 *
 * 原来还引着「实测（`docs/VIEW_CULLING_RESEARCH.md`）：拖动时主线程一半以上时间
 * 花在 `GraphicsWebGLRenderer` 与 `batchQuad` 上」——那份文档不在仓库里，
 * `git log --all --diff-filter=A` 全史也查无此文件。所以那句「实测」没有出处，
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
