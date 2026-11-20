/** `src/render/art1/atlas-registry.ts` 单测：图集清单查询与缺件回退。
 *
 * 为什么值得测：图集是表现层资产，但「缺一件回退 `?art=0`」是**渲染正确性**
 * 承诺——查询函数多返回一个号，渲染层就会画错一格。清单与类型对齐也在这
 * 条里守着（读 `public/assets/art1/manifest.json` 真件，不抄副本）。
 *
 * 用例形态与 `villager-frames.test.ts` 同口径：纯函数 + 手捏 scene，
 * 不起 Phaser。
 */

import { existsSync, readFileSync } from 'node:fs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ATLAS_MANIFEST_KEY,
  ATLAS_SHEET_PREFIX,
  atlasManifestOf,
  atlasTileScale,
  buildingFramesOf,
  groundTileOf,
  hasTileAtlas,
  isAtlasTileSize,
  preloadTileAtlas,
  villagerWalkFrameOf,
  type TileAtlasManifest,
} from '../src/render/art1/atlas-registry.ts';

/** 磁盘上的真清单：类型与产物对不上时这条先红。 */
const realManifest = JSON.parse(
  readFileSync(new URL('../public/assets/art1/manifest.json', import.meta.url), 'utf8'),
) as TileAtlasManifest;

const stub = (over: {
  manifest?: unknown;
  textures?: Set<string>;
}): {
  load: { json: unknown; spritesheet: unknown; once: unknown };
  cache: { json: { get: (k: string) => unknown } };
  textures: { exists: (k: string) => boolean };
} => ({
  load: { json: null, spritesheet: null, once: null },
  cache: { json: { get: (k: string) => (k === ATLAS_MANIFEST_KEY ? over.manifest : undefined) } },
  textures: { exists: (k: string) => (over.textures ?? new Set<string>()).has(k) },
});

test('图集可用性三态：齐 / 缺 manifest / 缺 sheet 纹理', () => {
  const sheets = Object.keys(realManifest.sheets).map((name) => `${ATLAS_SHEET_PREFIX}${name}`);
  assert.equal(hasTileAtlas(stub({ manifest: realManifest, textures: new Set(sheets) }) as never), true);
  assert.equal(hasTileAtlas(stub({ manifest: undefined, textures: new Set(sheets) }) as never), false);
  assert.equal(hasTileAtlas(stub({ manifest: realManifest, textures: new Set() }) as never), false);
});

test('清单身份字段不对时当作没装，不把坏 JSON 当清单', () => {
  const scene = stub({ manifest: { atlas: 'not-art1', sheets: {} } });
  assert.equal(atlasManifestOf(scene as never), undefined);
  assert.equal(hasTileAtlas(scene as never), false);
});

test('地形 / 石板路 / 水体 / 海岸槽位查询，未登记回 null', () => {
  assert.equal(groundTileOf(realManifest, 'grass'), 0);
  assert.equal(groundTileOf(realManifest, 'coal'), 7);
  assert.equal(groundTileOf(realManifest, 'lava'), null, '清单没有的地形必须回 null，不能瞎指一格');
  assert.equal(realManifest.road, 8, '石板路是独立槽位');
  assert.equal(realManifest.water.river, 9);
  assert.equal(realManifest.shore.river, 11);
});

test('建筑四层格索引：back/body/front/roof 齐全，未登记楼回 null', () => {
  const frames = buildingFramesOf(realManifest, 'code_forge');
  assert.notEqual(frames, null);
  const f = frames!;
  assert.deepEqual([f.back, f.body, f.front, f.roof], [0, 1, 2, 3]);
  assert.equal(buildingFramesOf(realManifest, 'no_such_prefab'), null);
});

test('居民 4 帧步态轮转；帧数不齐的村民宁可不可用', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((s) => villagerWalkFrameOf(realManifest, 'v0', s)), [0, 1, 2, 3, 0]);
  assert.equal(villagerWalkFrameOf(realManifest, 'v6', 2), 26);
  assert.equal(villagerWalkFrameOf(realManifest, 'ghost', 0), null);
  const broken: TileAtlasManifest = {
    ...realManifest,
    villagers: { ...realManifest.villagers, v0: [0, 1, 2] },
  };
  assert.equal(villagerWalkFrameOf(broken, 'v0', 0), null, '不是 4 帧就拒绝，步态不能错位');
});

test('格边长只认 16/32；缩放按 TILE_PX 归一', () => {
  assert.equal(isAtlasTileSize(16), true);
  assert.equal(isAtlasTileSize(32), true);
  assert.equal(isAtlasTileSize(24), false);
  assert.equal(isAtlasTileSize(undefined), false);
  assert.equal(atlasTileScale(16), 1);
  assert.equal(atlasTileScale(32), 0.5);
});

/** `preloadTileAtlas` 只用 load 的三个入口；用记录器 stub 接住，顺带手动 fire
 *  一次 `filecomplete`——真 Phaser 是异步事件，测试里不等事件，直接拿回调跑。 */
const preloadStub = (manifest: unknown) => {
  const queuedJson: [string, string][] = [];
  const queuedSheets: [string, string, { frameWidth: number; frameHeight: number }][] = [];
  const handlers: [string, (...args: unknown[]) => void][] = [];
  const scene = {
    load: {
      json: (key: string, url: string) => { queuedJson.push([key, url]); },
      spritesheet: (
        key: string,
        url: string,
        opts: { frameWidth: number; frameHeight: number },
      ) => { queuedSheets.push([key, url, opts]); },
      once: (event: string, cb: (...args: unknown[]) => void) => { handlers.push([event, cb]); },
    },
    cache: { json: { get: () => manifest } },
    textures: { exists: () => false },
  };
  /** 触发清单装载完成事件，返回实际排队的 sheet。 */
  const fireManifestComplete = (data: unknown) => {
    const handler = handlers.find(([event]) => event.startsWith('filecomplete-json-'))?.[1];
    if (handler === undefined) throw new Error('preloadTileAtlas 没有监听 manifest 装载完成');
    handler('k', 'json', data);
    return queuedSheets;
  };
  return { scene, queuedJson, queuedSheets, fireManifestComplete };
};

test('preload：先取清单再按清单排队；坏清单一帧都不装', () => {
  const bad = preloadStub({ atlas: 'not-art1', sheets: { ground: { file: 'g.png', tileWidth: 16, tileHeight: 16 } } });
  preloadTileAtlas(bad.scene as never);
  assert.deepEqual(bad.queuedJson, [[ATLAS_MANIFEST_KEY, '/assets/art1/manifest.json']]);
  bad.fireManifestComplete({ atlas: 'not-art1', sheets: { ground: { file: 'g.png', tileWidth: 16, tileHeight: 16 } } });
  assert.deepEqual(bad.queuedSheets, [], '身份字段不对就一帧都不该装');

  const good = preloadStub(realManifest);
  preloadTileAtlas(good.scene as never);
  const queued = good.fireManifestComplete(realManifest);
  assert.equal(queued.length, Object.keys(realManifest.sheets).length, '每张登记的 sheet 都要排队');
  for (const [name, sheet] of Object.entries(realManifest.sheets)) {
    const hit = queued.find(([key]) => key === `${ATLAS_SHEET_PREFIX}${name}`);
    assert.notEqual(hit, undefined, `sheet ${name} 要排队`);
    assert.equal(hit![1].endsWith(sheet.file), true, '装载路径要落在 sheet 文件上');
    assert.deepEqual(hit![2], { frameWidth: sheet.tileWidth, frameHeight: sheet.tileHeight });
  }
});

test('preload：清单里格边长非法的 sheet 跳过，不把坏尺寸喂给 Phaser', () => {
  const mixed = {
    ...realManifest,
    sheets: {
      ...realManifest.sheets,
      ground: { file: 'ground.png', tileWidth: 24 as never, tileHeight: 16, columns: 8, rows: 8 },
    },
  };
  const scene = preloadStub(mixed);
  preloadTileAtlas(scene.scene as never);
  const queued = scene.fireManifestComplete(mixed);
  assert.equal(queued.some(([key]) => key === `${ATLAS_SHEET_PREFIX}ground`), false);
  assert.equal(queued.length, Object.keys(realManifest.sheets).length - 1);
});

test('清单与磁盘产物同址：manifest 的 sheet 指向 public/assets/art1/ 下真实文件', () => {
  for (const sheet of Object.values(realManifest.sheets)) {
    assert.equal(
      existsSync(new URL(`../public/assets/art1/${sheet.file}`, import.meta.url)),
      true,
      `图集文件 ${sheet.file} 必须真实存在，缺件回退才有东西可回`,
    );
  }
});
