/** 位图素材（生图管线产出）的装载与查询。
 *
 * 素材由 `server/scripts/gen_asset.py` 离线生成，落在 `public/assets/<kind>/<id>.png`，
 * `manifest.json` 记着每件的尺寸与来历。运行时只读，不生成。
 *
 * **开关 `?art=1`，缺省关闭。** 关闭时一张纹理都不装，`hasArt` 恒为 `false`，
 * 渲染走原来的程序化绘制，一个字节都不变——所以 157 张基线与十一道闸门不受影响。
 * 打开与否的差别只在画面；世界与存档不知道有这回事。
 */

import Phaser from 'phaser';

export type ArtKind = 'building' | 'villager';

interface ArtManifest {
  readonly artScale: number;
  readonly assets: Readonly<Record<string, { readonly width: number; readonly height: number }>>;
}

const MANIFEST_KEY = 'art-manifest';

export function artEnabledOf(search: string | URLSearchParams): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return params.get('art') === '1';
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
