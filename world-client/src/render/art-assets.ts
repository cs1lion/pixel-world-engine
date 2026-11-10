/** 位图素材（生图管线产出）的装载与查询。
 *
 * 素材由 `server/scripts/gen_asset.py` 离线生成，落在 `public/assets/<kind>/<id>.png`，
 * `manifest.json` 记着每件的尺寸与来历。运行时只读，不生成。
 *
 * **默认开，`?art=0` 才关。** 关闭时一张纹理都不装，`hasArt` 恒为 `false`，
 * 渲染走原来的程序化绘制——这是排障与像素基线比对用的退路。
 * 打开与否的差别只在画面；世界与存档不知道有这回事。
 * 装了图但清单里没有这一件（莞尔镇、没生成过的楼）时 `hasArt` 也是 `false`，
 * 照样落到程序化路径：**素材缺一件不该让世界缺一块**。
 */

import Phaser from 'phaser';

export type ArtKind = 'building' | 'villager' | 'scenery';

interface ArtManifest {
  readonly artScale: number;
  readonly assets: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
}

const MANIFEST_KEY = 'art-manifest';

export function artEnabledOf(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  // **默认开**（2026-11-10 起）。`?art=0` 是唯一的关法：它是排障与基线比对
  // 用的退路，不是日常状态。理由见 `ADR_ART_DEFAULT_ON`：素材已经从 4 件长到
  // 19 件、观感验收做过，再让它默认关着就等于用户永远看不到这批图。
  return params.get('art') !== '0';
}

export function artKey(kind: ArtKind, id: string): string {
  return `art:${kind}:${id}`;
}

export function hasArt(scene: Phaser.Scene, kind: ArtKind, id: string): boolean {
  return scene.textures.exists(artKey(kind, id));
}

/** 素材纹理相对世界逻辑像素的倍率；显示时按 `1 / artScale` 缩回。 */
export function artScaleOf(scene: Phaser.Scene): number {
  const manifest = scene.cache.json.get(MANIFEST_KEY) as ArtManifest | undefined;
  return manifest?.artScale ?? 1;
}

/**
 * 位图建筑的显示缩放。
 *
 * `fit_to_footprint` 只按占地**宽度**缩放，高度完全由图的长宽比决定——
 * 于是矮胖图（实测 `waiting_shelter` 仅 40 逻辑 px，楼体 48 px）贴在地上
 * 像贴纸。这里给一个「至少占楼体高的 80%」的兜底，但不强行拉满：
 * 拉满会把矮图纵向拉变形，比贴纸更难看。
 *
 * 上限是楼体 + 屋顶 + `BAKE_PAD.top` 留白，防止高图（`wave_house`）
 * 把屋顶画进上方 HUD 区。屋顶高度口径与 `render/decal.ts::roofHeight` 一致。
 *
 * 宽度由生成端 `fit_to_footprint` 保证，这里只管高度。
 * 纯函数：不碰 Phaser，可单测。
 */
export function artBuildingScale(
  textureH: number,
  bodyH: number,
  artScale: number,
): number {
  const base = 1 / artScale;
  const roofH = Math.max(10, Math.round(bodyH * 0.34));
  const maxH = bodyH + roofH + 32; // BAKE_PAD.top
  const floorH = bodyH * 0.8;
  const atBase = textureH * base;
  if (atBase >= maxH) return Math.min(base, maxH / textureH);
  if (atBase >= floorH) return base;
  // 放大到 floorH，但不能越过 maxH
  return Math.min(floorH / textureH, maxH / textureH);
}

/**
 * 在场景 `preload` 里调用：先取清单，再按清单排队装图。
 * 清单取不到（没生成过素材）就静默跳过——没有素材等于没开。
 */
export function preloadArt(scene: Phaser.Scene): void {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const root = `${base}assets/`;
  scene.load.json(MANIFEST_KEY, `${root}manifest.json`);
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (_key: string, _type: string, data: ArtManifest) => {
    for (const path of Object.keys(data.assets)) {
      const [kind, id] = path.split('/') as [ArtKind, string];
      const key = artKey(kind, id);
      scene.load.image(key, `${root}${path}.png`);
      scene.load.once(`filecomplete-image-${key}`, () => {
        // 素材是缩过的高清图，最近邻缩小会出锯齿；线性滤波在 2× 缩回 1× 时等价于 2×2 平均。
        scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      });
    }
  });
}
