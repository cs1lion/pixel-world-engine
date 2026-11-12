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

/**
 * 2026-11-11 参考图集带来的三类装饰素材。前三类贴在世界画布上（有 `hasArt` 消费方），
 * 这三类只给 DOM 面板当徽记用，不进 Phaser 纹理查询——但一样走 `preloadArt`，
 * 所以 `?art=0` 时它们也一张都不装。
 */
export type ArtKind = 'building' | 'villager' | 'scenery' | 'state' | 'icon' | 'emote' | 'plate' | 'action';

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

/** DOM 装饰图的相对路径；与 `preloadArt` 用的是同一个 `BASE_URL` 前缀。 */
export function artAssetPath(kind: ArtKind, id: string): string {
  return `assets/${kind}/${id}.png`;
}

/** 楼的四态 -> 工坊四态切图。`id` 与切图脚本的 `workshop-0N` 一一对应。 */
const ACTIVITY_DECOR: Readonly<Record<string, string>> = {
  idle: 'workshop-00',
  operating: 'workshop-01',
  overheating: 'workshop-02',
  cooling: 'workshop-03',
};

export function activityDecorId(activity: string): string | null {
  return ACTIVITY_DECOR[activity] ?? null;
}

/** 七个村民共用五张角色徽记，按 id 序号轮转；不是身份对应，只作视觉区分。 */
export function villagerBadgeId(villagerId: string): string {
  const seq = /^v(\d+)$/.exec(villagerId);
  const n = seq === null ? 0 : Number(seq[1]);
  return `role-0${((n % 5) + 5) % 5}`;
}

/** 表情按序轮转。`emote-09` 是参考图里那格纯色块，不是表情，跳过。 */
const EMOTE_IDS: readonly string[] = [
  'emote-00', 'emote-01', 'emote-02', 'emote-03', 'emote-04', 'emote-05',
  'emote-06', 'emote-07', 'emote-08', 'emote-10', 'emote-11',
];

export function emoteIdFor(index: number): string {
  const i = ((Math.trunc(index) % EMOTE_IDS.length) + EMOTE_IDS.length) % EMOTE_IDS.length;
  return EMOTE_IDS[i]!;
}

/** 语义 -> 表情。十一张可用图各有一个入口，不靠行序碰运气。 */
const EMOTE_BY_KIND: Readonly<Record<string, string>> = {
  alert: 'emote-00', question: 'emote-01', sweat: 'emote-02', search: 'emote-03',
  think: 'emote-04', talk: 'emote-05', storm: 'emote-06', calm: 'emote-07',
  smoke: 'emote-08', water: 'emote-10', reward: 'emote-11',
};

export function emoteIdForKind(kind: string): string {
  return EMOTE_BY_KIND[kind] ?? EMOTE_IDS[0]!;
}

/** 一句记忆 -> 该配哪张表情。听来的、当天的、往日的分三路，再按行序兜底。 */
export function emoteIdForLine(line: { readonly age: string; readonly heardFrom: unknown }, index: number): string {
  if (line.heardFrom !== null && line.heardFrom !== undefined) return emoteIdForKind('question');
  if (line.age.includes('今天')) return emoteIdForKind('alert');
  if (line.age.includes('昨天')) return emoteIdForKind('think');
  return emoteIdFor(index);
}

/** 神谕祭坛三态：null = 待机，true = 降下，false = 出错 / 过载。 */
export function altarStateId(ok: boolean | null): string {
  return ok === null ? 'altar-00' : ok ? 'altar-01' : 'altar-02';
}

/** 日历周视图的构图贴片，按周序号轮转十三张。 */
const PLATE_COUNT = 13;

export function plateIdFor(index: number): string {
  const i = ((Math.trunc(index) % PLATE_COUNT) + PLATE_COUNT) % PLATE_COUNT;
  if (i < 4) return `map-0${i}`;
  if (i < 8) return `village-0${i - 4}`;
  if (i < 10) return `ui-0${i - 8}`;
  return ['scholarly-00', 'tileset-00', 'cast-00'][i - 10]!;
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
