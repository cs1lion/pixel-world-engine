/**
 * WorldBundle v1 契约的单元测试。
 *
 * 覆盖四件事：
 * 1. 合法 bundle 通过校验（含灯潮界夹具——与既有世界定义逐项对得上）；
 * 2. 居民编制是动态的：3 人、12 人都合法（旧世界 7 人固定编制就此解除）；
 * 3. 越界 / 重名 / 非法气候 / 声线越界 / 蓝图几何全部拦下，violations 带路径与编码；
 * 4. 确定性：同一份输入两次校验逐字节一致，夹具两次构造逐字节一致。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DENGCHAO_RAW, DENGCHAO_CAST_ARCHIVES } from '../src/settings/dengchao/pack.ts';
import type { PrefabBlueprint } from '../src/world/types.ts';
import type {
  WorldBundle,
  WorldBundleCastMember,
  WorldBundlePhase,
  WorldBundlePrefab,
  WorldBundleRegion,
  WorldBundleVoiceProfile,
} from '../src/world/bundle/schema.ts';

/**
 * red-first 适配：基线上 `src/world/bundle/` 尚不存在，静态 import 会在模块
 * 收集期就抛 ERR_MODULE_NOT_FOUND，被 `scripts/red-first-lib.ts` 判成「红得
 * 不对」的 module 类（基础设施错误优先于断言分类）。这里改动态 import + catch：
 * 缺模块时转成一条断言失败，让基线红在断言上；本分支上正常加载后照常跑全部用例。
 *
 * 注意 catch 里的文案**不许**出现「Cannot find module / ERR_MODULE_NOT_FOUND」
 * 等字样——分类器扫全量输出，原文留在断言消息里会直接被判回 module。
 */
let validateWorldBundle: typeof import('../src/world/bundle/validator.ts').validateWorldBundle;
let voiceTempoMax: number;
try {
  const validator = await import('../src/world/bundle/validator.ts');
  validateWorldBundle = validator.validateWorldBundle;
  const schema = await import('../src/world/bundle/schema.ts');
  voiceTempoMax = schema.VOICE_TEMPO_MAX;
} catch {
  assert.fail('WorldBundle 契约模块在基线上尚未落地：动态 import 失败，本测试先红于此。');
}

/**
 * 灯潮界 → WorldBundle v1 的示例夹具：把 `settings/dengchao/pack.ts` 里那张
 * 已上线的地图逐条转写成契约形状。放在 test/ 是有意的——世界数据归设定集
 * 管，`src/world` 里不许抄设定集的名字与编号（pack-owns-world-data 那道闸
 * 扫的正是 src/）；而 test/ 本就是夹具区，这里转写、并对 `DENGCHAO_RAW`
 * 交叉核对，正好就是「新契约完全兼容既有世界定义」的证明。
 */
const GRID = { width: 64, height: 48 };

const REGIONS: readonly WorldBundleRegion[] = [
  { id: 'ferry', label: '渡口站台', x: 5, y: 8, w: 20, h: 10, tags: ['渡口', '站台'] },
  { id: 'shoal', label: '浅滩轨道', x: 1, y: 1, w: 62, h: 13, tags: ['呼吸段', '浅滩'] },
  { id: 'lampstreet', label: '灯街', x: 12, y: 19, w: 40, h: 15, tags: ['街市', '灯'] },
  { id: 'sootbank', label: '积尘滩', x: 37, y: 34, w: 23, h: 13, tags: ['工业', '滩涂'] },
  { id: 'bathhouse', label: '叠浪楼', x: 27, y: 17, w: 12, h: 11, tags: ['楼阁', '浴场'] },
];

/** 与设定集 prefab() 同一个算出来的几何：门在占地外（y = h），工位在占地中心。 */
const prefab = (id: string, w: number, h: number): WorldBundlePrefab => ({
  id,
  footprint: { w, h },
  clearMargin: 1,
  door: { x: Math.floor(w / 2), y: h },
  workSpots: [{ x: Math.floor(w / 2), y: Math.floor(h / 2) }],
});

const PREFABS: readonly WorldBundlePrefab[] = [
  prefab('wave_house', 7, 6),
  prefab('lamp_lodge', 5, 4),
  prefab('tea_stall', 5, 4),
  prefab('ferry_station', 6, 4),
  prefab('lamp_workshop', 4, 4),
  prefab('boiler_annex', 4, 3),
  prefab('waiting_shelter', 4, 3),
  prefab('ledger_house', 4, 4),
  prefab('lamp_archive', 4, 4),
  prefab('soot_forge', 4, 4),
];

type Bond = { to: string; trust: number; warmth: number; debt: number; familiarity: number };

const CAST: readonly WorldBundleCastMember[] = [
  member('stranger', '迷路人', '外来者，不隶属灯潮界任何一铺', [
    { to: 'xi', trust: 0.35, warmth: 0.4, debt: 0, familiarity: 0.45 },
    { to: 'lujiang', trust: 0.2, warmth: 0.3, debt: 0.1, familiarity: 0.3 },
  ]),
  member('xi', '汐', '渡守，隶属渡口站台与迎灯舍', [
    { to: 'stranger', trust: 0.3, warmth: 0.35, debt: 0, familiarity: 0.45 },
    { to: 'chendengfuren', trust: 0.25, warmth: 0.1, debt: 0.15, familiarity: 0.5 },
  ]),
  member('lujiang', '炉匠', '炉匠铺炉工，隶属叠浪楼炉底入口', [
    { to: 'chendengfuren', trust: 0.3, warmth: 0.2, debt: 0, familiarity: 0.4 },
  ]),
  member('chendengfuren', '沉灯夫人', '叠浪楼掌柜，镇上的债与账都归她管', [
    { to: 'lujiang', trust: 0.35, warmth: 0.1, debt: 0.1, familiarity: 0.45 },
    { to: 'zhangfang', trust: 0.3, warmth: 0.15, debt: 0, familiarity: 0.5 },
  ]),
  member('denglongtou', '灯笼头', '灯街的提灯人，隶属灯街', [
    { to: 'xi', trust: 0.4, warmth: 0.3, debt: 0, familiarity: 0.5 },
  ]),
  member('zhangfang', '账房先生', '账房，隶属账房与集市；镇上唯一认全部零钱的人', [
    { to: 'chendengfuren', trust: 0.35, warmth: 0.1, debt: 0, familiarity: 0.55 },
    { to: 'lujiang', trust: 0.25, warmth: 0.15, debt: -0.1, familiarity: 0.45 },
  ]),
  member('xiyifu', '洗衣妇', '叠浪楼洗衣工，隶属叠浪楼', [
    { to: 'chendengfuren', trust: 0.3, warmth: 0.05, debt: 0.15, familiarity: 0.5 },
    { to: 'xi', trust: 0.25, warmth: 0.3, debt: 0, familiarity: 0.4 },
  ]),
];

const PHASES: readonly WorldBundlePhase[] = [
  { id: 'first-low-tide', label: '首次退潮', kind: 'countdown', afterTicks: 240 },
  { id: 'monsoon-turn', label: '季风转向', kind: 'climate', toClimate: 'tropical', afterTicks: 1440 },
  { id: 'lamp-council', label: '灯会投票', kind: 'vote', condition: '镇心石旁聚满五位居民' },
  { id: 'lamp-famine', label: '灯油危机', kind: 'crisis', condition: '全界灯油同时低于一成' },
];

/** 灯潮界的 WorldBundle v1 实例。每次调用返回同值的新对象。 */
function dengchaoWorldBundle(): WorldBundle {
  return {
    schemaVersion: 1,
    meta: {
      id: 'dengchao',
      title: '灯潮界',
      loreSummary: '末班渡船走后，灯街上的七个人靠潮汐过日子：涨潮收灯，退潮拾芯。',
      seed: 20261025,
    },
    climate: {
      kind: 'temperate',
      weatherWeights: { clear: 0.5, rain: 0.3, storm: 0.1, fog: 0.1 },
    },
    grid: GRID,
    regions: REGIONS,
    prefabs: PREFABS,
    cast: CAST,
    phases: PHASES,
  };
}

function member(
  id: string,
  name: string,
  persona: string,
  bonds: readonly Bond[],
): WorldBundleCastMember {
  return {
    id,
    name,
    persona,
    initialRelations: bonds,
    voiceProfile: voiceFromName(name),
  };
}

/**
 * FNV-1a：小的确定性整数哈希，只服务「同名同参」这一件事。
 * 三位声线参数都从 hash 的不同位段切出来，落在各自安全区间内。
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const ch of text) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function voiceFromName(name: string): WorldBundleVoiceProfile {
  const hash = fnv1a(name);
  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    pitch: round(0.3 + (hash % 50) / 100),
    tempo: round(0.8 + (Math.floor(hash / 50) % 9) / 10),
    warmth: round(0.2 + (Math.floor(hash / 450) % 8) / 10),
  };
}

interface RawPrefab {
  readonly footprint: { readonly w: number; readonly h: number };
  readonly clearMargin: number;
  readonly door: { readonly x: number; readonly y: number };
  readonly workSpots: readonly { readonly x: number; readonly y: number }[];
}

/**
 * 以灯潮界夹具为底，换掉某个字段后做「应当被拦」的对照。
 * draft 故意是 any：这些用例写的就是非法状态，类型系统帮倒忙。
 */
function bundleWith(mutate: (draft: any) => void): WorldBundle {
  const draft: any = JSON.parse(JSON.stringify(dengchaoWorldBundle()));
  mutate(draft);
  return draft as WorldBundle;
}

function voice(pitch = 0.5, tempo = 1, warmth = 0.5) {
  return { pitch, tempo, warmth };
}

function castOf(size: number): WorldBundleCastMember[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `v${index}`,
    name: `居民${index}`,
    persona: `第 ${index} 位居民，原创人设`,
    initialRelations: [],
    voiceProfile: voice(),
  }));
}

test('灯潮界夹具通过校验，且与既有世界定义逐项对得上', () => {
  const bundle = dengchaoWorldBundle();
  const result = validateWorldBundle(bundle);
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.violations, []);

  // 网格与分区：抄的是 pack.ts 同一组事实。
  assert.equal(bundle.grid.width, DENGCHAO_RAW.grid.width);
  assert.equal(bundle.grid.height, DENGCHAO_RAW.grid.height);
  const packRegions = DENGCHAO_RAW.regions;
  assert.equal(bundle.regions.length, packRegions.length);
  packRegions.forEach((region, index) => {
    const mine = bundle.regions[index];
    assert.equal(mine.id, region.id);
    assert.equal(mine.label, region.name);
    assert.deepEqual(
      { x: mine.x, y: mine.y, w: mine.w, h: mine.h },
      { x: region.x, y: region.y, w: region.w, h: region.h },
    );
  });

  // 蓝图几何：与设定集 prefabs 表逐栋对得上（门在占地外、工位在占地内由校验器兜底）。
  const packPrefabs = DENGCHAO_RAW.prefabs as Record<string, RawPrefab>;
  assert.equal(bundle.prefabs.length, Object.keys(packPrefabs).length);
  for (const prefab of bundle.prefabs) {
    const source = packPrefabs[prefab.id];
    assert.notEqual(source, undefined, `夹具里找不到 ${prefab.id}`);
    assert.deepEqual(prefab.footprint, source.footprint);
    assert.equal(prefab.clearMargin, source.clearMargin);
    assert.deepEqual(prefab.door, source.door);
    assert.deepEqual(prefab.workSpots, source.workSpots);
  }

  // 居民：七位编制、姓名与档案一致；关系指向的都在编制内。
  const archiveNames = Object.keys(DENGCHAO_CAST_ARCHIVES);
  assert.deepEqual(bundle.cast.map((member) => member.name), archiveNames);
  const ids = new Set(bundle.cast.map((member) => member.id));
  for (const member of bundle.cast) {
    for (const relation of member.initialRelations) {
      assert.ok(ids.has(relation.to), `${member.id} 的关系指向不存在的 ${relation.to}`);
    }
  }
});

test('合法 bundle 经 JSON 往返后仍然合法', () => {
  const roundTripped = JSON.parse(JSON.stringify(dengchaoWorldBundle())) as WorldBundle;
  assert.equal(validateWorldBundle(roundTripped).ok, true);
});

test('居民编制是动态的：3 人与 12 人都合法', () => {
  for (const size of [3, 12]) {
    const bundle = bundleWith((draft) => {
      draft.cast = castOf(size);
    });
    const result = validateWorldBundle(bundle);
    assert.equal(result.ok, true, `${size} 人编制被拒：${JSON.stringify(result.violations)}`);
    assert.equal(bundle.cast.length, size);
  }
});

test('分区越界被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((draft) => {
      draft.regions[0] = { ...draft.regions[0], x: 60, w: 10 };
    }),
  );
  assert.equal(result.ok, false);
  const hit = result.violations.find((v) => v.code === 'region.outOfBounds');
  assert.notEqual(hit, undefined);
  assert.match(hit!.path, /^regions\[0\]/);
});

test('分区尺寸非法被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((draft) => {
      draft.regions[1] = { ...draft.regions[1], w: 0 };
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((v) => v.code === 'region.bounds.range'));
});

test('居民重名与重 id 都被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((draft) => {
      draft.cast[1] = { ...draft.cast[1], name: draft.cast[0].name, id: draft.cast[0].id };
    }),
  );
  assert.equal(result.ok, false);
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('cast.duplicateName'), `没有重名拦截：${codes}`);
  assert.ok(codes.includes('cast.duplicateId'), `没有重 id 拦截：${codes}`);
});

test('非法气候被拦截，天气权重必须非负、有限且至少一个大于 0', () => {
  const badKind = validateWorldBundle(bundleWith((d) => { d.climate.kind = 'desert'; }));
  assert.equal(badKind.ok, false);
  assert.equal(badKind.violations[0]!.code, 'climate.kind.unsupported');

  const allZero = validateWorldBundle(
    bundleWith((d) => { d.climate.weatherWeights = { clear: 0, rain: 0, storm: 0, fog: 0 }; }),
  );
  assert.ok(allZero.violations.some((v) => v.code === 'climate.weatherWeights.allZero'));

  const negative = validateWorldBundle(
    bundleWith((d) => { d.climate.weatherWeights = { clear: -0.2, rain: 1, storm: 0, fog: 0 }; }),
  );
  assert.ok(negative.violations.some((v) => v.code === 'climate.weatherWeights.range'));

  const unknown = validateWorldBundle(
    bundleWith((d) => { d.climate.weatherWeights = { clear: 0.5, rain: 0.5, snow: 1 }; }),
  );
  assert.ok(unknown.violations.some((v) => v.code === 'climate.weatherWeights.unknown'));
});

test('声线参数越界被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((draft) => {
      draft.cast[0] = {
        ...draft.cast[0],
        voiceProfile: { pitch: 1.5, tempo: voiceTempoMax + 0.1, warmth: -0.1 },
      };
    }),
  );
  assert.equal(result.ok, false);
  const paths = result.violations.map((v) => v.path);
  assert.deepEqual(paths, [
    'cast[0].voiceProfile.pitch',
    'cast[0].voiceProfile.tempo',
    'cast[0].voiceProfile.warmth',
  ]);
});

test('关系悬空、自指与参数越界被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((draft) => {
      draft.cast[0].initialRelations = [
        { to: 'ghost', trust: 0.5, warmth: 0.5, debt: 0, familiarity: 0.5 },
        { to: 'xi', trust: 1.5, warmth: 0.5, debt: 2, familiarity: 0.5 },
      ];
      draft.cast[1].initialRelations = [
        { to: 'xi', trust: 0.5, warmth: 0.5, debt: 0, familiarity: 0.5 },
      ];
    }),
  );
  assert.equal(result.ok, false);
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('cast.relation.to.unknown'));
  assert.ok(codes.includes('cast.relation.to.self'));
  assert.ok(codes.filter((c) => c === 'cast.relation.range').length >= 2);
});

test('蓝图几何：门在占地内、工位在占地外、空工位、零占地都被拦截', () => {
  const doorInside = validateWorldBundle(
    bundleWith((d) => {
      d.prefabs[0] = { ...d.prefabs[0], door: { x: 3, y: 3 } };
    }),
  );
  assert.ok(doorInside.violations.some((v) => v.code === 'prefab.door.insideFootprint'));

  const spotOutside = validateWorldBundle(
    bundleWith((d) => {
      d.prefabs[0] = { ...d.prefabs[0], workSpots: [{ x: 99, y: 99 }] };
    }),
  );
  assert.ok(spotOutside.violations.some((v) => v.code === 'prefab.workSpots.outsideFootprint'));

  const noSpots = validateWorldBundle(
    bundleWith((d) => {
      d.prefabs[0] = { ...d.prefabs[0], workSpots: [] };
    }),
  );
  assert.ok(noSpots.violations.some((v) => v.code === 'prefab.workSpots.empty'));

  const flat = validateWorldBundle(
    bundleWith((d) => {
      d.prefabs[0] = { ...d.prefabs[0], footprint: { w: 0, h: 4 } };
    }),
  );
  assert.ok(flat.violations.some((v) => v.code === 'prefab.footprint.range'));
});

test('剧本阶段的必备字段按 kind 分别拦截', () => {
  const result = validateWorldBundle(
    bundleWith((draft) => {
      draft.phases = [
        { id: 'p1', label: '倒计时', kind: 'countdown', afterTicks: 0 },
        { id: 'p2', label: '气候', kind: 'climate', toClimate: 'desert' },
        { id: 'p3', label: '投票', kind: 'vote' },
        { id: 'p4', label: '未知', kind: 'raid' },
      ];
    }),
  );
  assert.equal(result.ok, false);
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('phase.afterTicks.range'));
  assert.ok(codes.includes('phase.toClimate.unsupported'));
  assert.ok(codes.includes('phase.condition.empty'));
  assert.ok(codes.includes('phase.kind.unsupported'));
});

test('元数据与版本号：缺字段、种子越界、版本不对都被拦截', () => {
  const noSeed = validateWorldBundle(
    bundleWith((d) => { delete d.meta.seed; }),
  );
  assert.ok(noSeed.violations.some((v) => v.code === 'meta.seed.range'));

  const bigSeed = validateWorldBundle(
    bundleWith((d) => { d.meta.seed = 2147483648; }),
  );
  assert.ok(bigSeed.violations.some((v) => v.code === 'meta.seed.range'));

  const wrongVersion = validateWorldBundle(
    bundleWith((d) => { d.schemaVersion = 2; }),
  );
  assert.equal(wrongVersion.violations[0]!.code, 'schemaVersion.unsupported');

  const emptyTitle = validateWorldBundle(
    bundleWith((d) => { d.meta.title = ''; }),
  );
  assert.ok(emptyTitle.violations.some((v) => v.code === 'meta.title.empty'));
});

test('确定性：同一份输入两次校验结果逐字节一致', () => {
  const raw = JSON.stringify(dengchaoWorldBundle());
  const first = validateWorldBundle(JSON.parse(raw));
  const second = validateWorldBundle(JSON.parse(raw));
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);

  // 坏输入也一样：两次跑出来的 violations 顺序与内容完全相同。
  const bad = bundleWith((d) => {
    d.regions[0].x = 999;
    d.cast[0].voiceProfile.tempo = 9;
  });
  assert.deepEqual(validateWorldBundle(bad), validateWorldBundle(JSON.parse(JSON.stringify(bad))));
});

test('夹具工厂本身是确定性的：两次构造逐字节一致', () => {
  assert.equal(JSON.stringify(dengchaoWorldBundle()), JSON.stringify(dengchaoWorldBundle()));
});

test('校验器不抛：乱七八糟的输入也只回 violations', () => {
  for (const garbage of [null, undefined, 42, 'world', [], [1, 2], { meta: 'nope' }]) {
    const result = validateWorldBundle(garbage);
    assert.equal(result.ok, false, `输入 ${JSON.stringify(garbage)} 竟然合法`);
    assert.ok(result.violations.length > 0);
  }
});

test('空 cast 与空 prefabs/regions 的边界：居民不可省，分区与蓝图可空', () => {
  const noCast = validateWorldBundle(bundleWith((d) => { d.cast = []; }));
  assert.ok(noCast.violations.some((v) => v.code === 'cast.empty'));

  const emptyRegions = validateWorldBundle(bundleWith((d) => { d.regions = []; }));
  assert.equal(emptyRegions.ok, true);

  const emptyPrefabs = validateWorldBundle(bundleWith((d) => { d.prefabs = []; }));
  assert.equal(emptyPrefabs.ok, true);
});

test('缺整段 schema 时每段各报一条，不连带刷屏', () => {
  const result = validateWorldBundle({ schemaVersion: 1 });
  const codes = result.violations.map((v) => v.code);
  assert.deepEqual(codes, ['meta.missing', 'climate.missing', 'grid.missing', 'regions.missing', 'prefabs.missing', 'cast.missing']);
});

test('门为负坐标、工位为负坐标也被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((d) => {
      d.prefabs[0] = { ...d.prefabs[0], door: { x: -1, y: 5 } };
      d.prefabs[1] = { ...d.prefabs[1], workSpots: [{ x: 1, y: -2 }] };
    }),
  );
  const codes = result.violations.map((v) => v.code);
  assert.ok(codes.includes('prefab.door.negative'));
  assert.ok(codes.includes('prefab.workSpots.negative'));
});

test('灯潮界夹具的蓝图口径与 PrefabBlueprint 一致（door 在占地外、workSpots 在占地内）', () => {
  // 这条是把契约与既有蓝图口径钉在一起：工厂转写出来的几何，
  // 用老蓝图的同一套规则再判一次，结论必须相同。
  for (const prefab of dengchaoWorldBundle().prefabs) {
    const raw = DENGCHAO_RAW.prefabs[prefab.id] as unknown as PrefabBlueprint;
    assert.deepEqual(prefab.footprint, raw.footprint);
    const doorInside = prefab.door.x >= 0 && prefab.door.y >= 0 &&
      prefab.door.x < prefab.footprint.w && prefab.door.y < prefab.footprint.h;
    assert.equal(doorInside, false, `${prefab.id} 的门落在占地内`);
    for (const spot of prefab.workSpots) {
      assert.ok(spot.x >= 0 && spot.y >= 0 && spot.x < prefab.footprint.w && spot.y < prefab.footprint.h);
    }
  }
});

test('分区标签是字符串数组，空标签被拦截', () => {
  const result = validateWorldBundle(
    bundleWith((d) => {
      const region: WorldBundleRegion = { ...d.regions[0], tags: ['渡口', ''] };
      d.regions[0] = region;
    }),
  );
  assert.ok(result.violations.some((v) => v.code === 'region.tag.empty'));
});
