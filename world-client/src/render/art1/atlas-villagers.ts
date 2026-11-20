/** 图集居民的 4 帧步态（`?art=1` 表现层）。
 *
 * 与位图单件（`art-assets.ts` 的 `art:villager:<id>` 立绘）的分工：立绘是
 * 「一人一张静态图」，没有步态；图集给的是**一人四帧**。这一支只在没有动作表、
 * 也没有立绘的人身上接管，优先级排在两者之后——已经有的观感不因为图集上线
 * 而倒退。
 *
 * 帧号从哪来：**沿用程序化小人的同一套采样**（`villager-frames.ts` 的
 * `villagerPose` / `villagerPoseAtFrame` 给出的 `pose.frame`），不在这里另起
 * 一条时钟。世界暂停时 `nowMs` 不推进，帧号就不变——「连 8 帧逐字节相同」
 * 那类钉子判据才继续成立。停下时姿态取四帧的第一帧，但**呼吸的 1px 起伏照用**
 * （`pose.offsetY` 仍在交替），静止的人不会变成一张死图。
 *
 * 缺件回退：清单没这个人、四帧不齐、sheet 没装上，一律回 `null`，调用方
 * 保持原来的程序化小人。
 */

import Phaser from 'phaser';

import {
  atlasManifestOf,
  atlasSheetKey,
  atlasTileScale,
  hasTileAtlas,
  villagerWalkFrameOf,
  type TileAtlasManifest,
} from './atlas-registry.ts';

const SHEET = 'villagers';

/**
 * 这一步该用图集里哪一格。纯函数（不碰 Phaser），所以「走 vs 停」的取舍
 * 本身可测。
 *
 * - 走：`poseFrame` 就是步态序号（程序化四帧与图集四帧同一口径）；
 * - 停：第一帧（清单里的 idle 格）——程序化 idle 只有两帧，图集不该被
 *   那两帧的序号牵着走出半步。
 */
export function atlasVillagerFrameFor(
  manifest: TileAtlasManifest,
  villagerId: string,
  args: { readonly walking: boolean; readonly poseFrame: number },
): number | null {
  const step = args.walking ? args.poseFrame : 0;
  return villagerWalkFrameOf(manifest, villagerId, step);
}

/** 图集居民精灵：贴在容器原点（= 脚底世界坐标）的一张图集格。 */
export interface AtlasVillagerSprite {
  readonly image: Phaser.GameObjects.Image;
  /**
   * 贴一步。清单里这个人没有四帧时回 `false`（宁可不画也不画错步态）。
   * `liftPx` 沿用程序化小人的整数像素起伏。
   */
  readonly step: (args: {
    readonly frame: number;
    readonly walking: boolean;
    readonly facingLeft: boolean;
    readonly liftPx: number;
    readonly alpha: number;
  }) => boolean;
}

/** 图集居民是否可用（清单在 + villagers sheet 装上）。 */
export function atlasVillagersReady(scene: Phaser.Scene): boolean {
  if (!hasTileAtlas(scene)) return false;
  const manifest = atlasManifestOf(scene);
  if (manifest === undefined) return false;
  return scene.textures.exists(atlasSheetKey(SHEET));
}

/**
 * 为某个居民建图集精灵。清单没登记这个人（或四帧不齐）回 `null`。
 *
 * 32×32 的图集格按 `atlasTileScale` 缩回逻辑像素（建的时候一次性 setScale，
 * 不是每帧算）；16×16 时倍率是 1，与原来逐像素一致。
 */
export function createAtlasVillagerSprite(
  scene: Phaser.Scene,
  villagerId: string,
): AtlasVillagerSprite | null {
  if (!atlasVillagersReady(scene)) return null;
  const manifest = atlasManifestOf(scene);
  if (manifest === undefined) return null;
  const first = atlasVillagerFrameFor(manifest, villagerId, { walking: false, poseFrame: 0 });
  if (first === null) return null;

  const image = scene.add
    .image(0, 0, atlasSheetKey(SHEET))
    .setOrigin(0.5, 1)
    .setScale(atlasTileScale(manifest.tile.w));
  image.setFrame(first);

  // 上一帧的图集格号：帧号没变就一个 setter 都不发。
  let applied = first;
  image.setFrame(applied);

  return {
    image,
    step({ frame, walking, facingLeft, liftPx, alpha }) {
      const next = atlasVillagerFrameFor(manifest, villagerId, { walking, poseFrame: frame });
      if (next === null) return false;
      if (next !== applied) {
        applied = next;
        image.setFrame(next);
      }
      image.setFlipX(facingLeft);
      // 脚底贴容器原点（= 脚底世界坐标）；起伏是整数像素。
      image.setY(2 + liftPx);
      image.setAlpha(alpha);
      return true;
    },
  };
}
