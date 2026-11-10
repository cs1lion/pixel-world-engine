import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  assertSave,
  collectSavePaths,
  fingerprintOfPaths,
  SAVE_SETTLED_KEYS,
  SAVE_TASK_KEYS,
  SAVE_V1_ALLOWED_PATHS,
  SAVE_V1_OPTIONAL_PATHS,
  SAVE_V1_PATHS,
  SAVE_V2_ADDED_PATHS,
  SAVE_V3_ADDED_PATHS,
  SAVE_V4_ADDED_PATHS,
  SAVE_V5_ADDED_PATHS,
  SAVE_V6_ALLOWED_PATHS,
  SAVE_V7_ALLOWED_PATHS,
  SCHEMA_V1_FINGERPRINT,
  SCHEMA_V2_FINGERPRINT,
  SCHEMA_V4_FINGERPRINT,
  SCHEMA_V5_FINGERPRINT,
  SCHEMA_V6_FINGERPRINT,
  migrateSave,
  saveFingerprint,
  type SettledRecord,
  type WorldSaveV1,
  type WorldSaveV2,
  type WorldSaveV3,
  type WorldSaveV4,
  type WorldSaveV5,
  type WorldSaveV6,
  type WorldSaveV7,
  type WorldSaveV8,
} from '../src/world/save.ts';
import * as saveModule from '../src/world/save.ts';

/** v7 常量在 base 上不存在：从命名空间取，缺了让断言红，而不是模块错误（B7）。 */
const SCHEMA_V7_FINGERPRINT =
  (saveModule as unknown as { SCHEMA_V7_FINGERPRINT?: string }).SCHEMA_V7_FINGERPRINT ?? '';
const SCHEMA_V8_FINGERPRINT =
  (saveModule as unknown as { SCHEMA_V8_FINGERPRINT?: string }).SCHEMA_V8_FINGERPRINT ?? '';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Assert<T extends true> = T;
// 编译期 Equal：当前版本的存档类型必须与 v7 冻结样例逐键一致。
// v1–v6 的样例只用于「旧档仍能自证」，不再与运行期类型对齐。
import type sampleJson from '../../docs/save-v8.sample.json';
type _TopLevel = Assert<Equal<keyof typeof sampleJson, keyof WorldSaveV8>>;
type _World = Assert<Equal<keyof (typeof sampleJson)['world'], keyof WorldSaveV8['world']>>;
type _Meta = Assert<Equal<keyof (typeof sampleJson)['meta'], keyof WorldSaveV8['meta']>>;
type _Settled = Assert<
  Equal<keyof (typeof sampleJson)['world']['settled'][number], keyof SettledRecord>
>;
export type _FingerprintAssertions = [_TopLevel, _World, _Meta, _Settled];

/** v7 样例是新增文件；「提交 A」上没有它时把 v6 样例迁过来，让这一组红在断言而不是 ENOENT。 */
const sample = existsSync(new URL('../../docs/save-v8.sample.json', import.meta.url))
  ? (JSON.parse(
      readFileSync(new URL('../../docs/save-v8.sample.json', import.meta.url), 'utf8'),
    ) as WorldSaveV8)
  : (migrateSave(
      JSON.parse(
        readFileSync(new URL('../../docs/save-v7.sample.json', import.meta.url), 'utf8'),
      ) as unknown as Record<string, unknown>,
    ) as unknown as WorldSaveV8);

const sampleV7 = JSON.parse(
  readFileSync(new URL('../../docs/save-v7.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV7;

const sampleV6 = JSON.parse(
  readFileSync(new URL('../../docs/save-v6.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV6;

const sampleV5 = JSON.parse(
  readFileSync(new URL('../../docs/save-v5.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV5;

const sampleV4 = JSON.parse(
  readFileSync(new URL('../../docs/save-v4.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV4;

const sampleV3 = JSON.parse(
  readFileSync(new URL('../../docs/save-v3.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV3;

const sampleV2 = JSON.parse(
  readFileSync(new URL('../../docs/save-v2.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV2;

const sampleV1 = JSON.parse(
  readFileSync(new URL('../../docs/save-v1.sample.json', import.meta.url), 'utf8'),
) as WorldSaveV1;

test('v1 冻结样例原样不动：99 条路径、旧指纹仍然成立', () => {
  const paths = [...new Set(collectSavePaths(sampleV1))].sort();
  assert.equal(paths.length, 99, 'v1 冻结路径条数');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V1_FINGERPRINT);
  assert.equal(sampleV1.meta.schemaFingerprint, SCHEMA_V1_FINGERPRINT);
  assert.equal(saveFingerprint(sampleV1), SCHEMA_V1_FINGERPRINT);
});

test('v2 样例仍原样不动：114 条路径、旧指纹仍然成立', () => {
  const paths = [...new Set(collectSavePaths(sampleV2))].sort();
  assert.equal(paths.length, 114, 'v2 路径条数');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V2_FINGERPRINT);
  assert.equal(sampleV2.meta.schemaFingerprint, SCHEMA_V2_FINGERPRINT);
  assert.equal(saveFingerprint(sampleV2), SCHEMA_V2_FINGERPRINT);
});

test('v4 样例仍原样不动：121 条叶子路径、旧指纹仍然成立', () => {
  const paths = [...new Set(collectSavePaths(sampleV4))].sort();
  assert.equal(paths.length, 121, 'v4 路径条数（v3 的 117 + 4 个新槽位）');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V4_FINGERPRINT);
  assert.equal(sampleV4.meta.schemaFingerprint, SCHEMA_V4_FINGERPRINT);
  assert.equal(saveFingerprint(sampleV4), SCHEMA_V4_FINGERPRINT);
});

test('v5 样例：122 条叶子路径，指纹等于 v5 常量', () => {
  const paths = [...new Set(collectSavePaths(sampleV5))].sort();
  assert.equal(paths.length, 122, 'v5 路径条数（v4 的 121 + 一条 world.memory）');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V5_FINGERPRINT);
  assert.equal(sampleV5.meta.schemaFingerprint, SCHEMA_V5_FINGERPRINT);
  assert.equal(saveFingerprint(sampleV5), SCHEMA_V5_FINGERPRINT);
});

test('v6 样例：123 条叶子路径，指纹等于 v6 常量（历史冻结）', () => {
  const paths = [...new Set(collectSavePaths(sampleV6))].sort();
  assert.equal(paths.length, 123, 'v6 路径条数（v5 的 122 + 一条 world.terrainEdits[]）');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V6_FINGERPRINT);
  assert.equal(sampleV6.meta.schemaFingerprint, SCHEMA_V6_FINGERPRINT);
  assert.equal(saveFingerprint(sampleV6), SCHEMA_V6_FINGERPRINT);
});

test('v6 路径全集 = v5 全集 + 新增一条，没有漏加也没有重复', () => {
  const v6Only = [...new Set(collectSavePaths(sampleV6))].filter(
    (path) =>
      !SAVE_V1_ALLOWED_PATHS.includes(path) &&
      !SAVE_V2_ADDED_PATHS.includes(path) &&
      !SAVE_V3_ADDED_PATHS.includes(path) &&
      !SAVE_V4_ADDED_PATHS.includes(path) &&
      !SAVE_V5_ADDED_PATHS.includes(path),
  );
  assert.deepEqual([...new Set(v6Only)].sort(), ['world.terrainEdits[]']);
});

test('v7 样例：124 条叶子路径，指纹等于 v7 常量（历史冻结）', () => {
  const paths = [...new Set(collectSavePaths(sampleV7))].sort();
  assert.equal(paths.length, 124, 'v7 路径条数（v6 的 123 + 一条 world.autonomy）');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V7_FINGERPRINT);
  assert.equal(sampleV7.meta.schemaFingerprint, SCHEMA_V7_FINGERPRINT);
  assert.equal(saveFingerprint(sampleV7), SCHEMA_V7_FINGERPRINT);
});

test('v8 样例：125 条叶子路径，指纹等于当前常量', () => {
  const paths = [...new Set(collectSavePaths(sample))].sort();
  assert.equal(paths.length, 125, 'v8 路径条数（v7 的 124 + 一条 world.siteOutput）');
  assert.equal(fingerprintOfPaths(paths), SCHEMA_V8_FINGERPRINT);
  assert.equal(sample.meta.schemaFingerprint, SCHEMA_V8_FINGERPRINT);
  assert.equal(saveFingerprint(sample), SCHEMA_V8_FINGERPRINT);
});

test('v8 路径全集 = v7 全集 + 新增一条', () => {
  const v8Only = [...new Set(collectSavePaths(sample))].filter(
    (path) => !SAVE_V7_ALLOWED_PATHS.includes(path),
  );
  assert.deepEqual([...new Set(v8Only)].sort(), ['world.siteOutput']);
});

test('v7 路径全集 = v6 全集 + 新增一条，没有漏加也没有重复', () => {
  const v7Only = [...new Set(collectSavePaths(sampleV7))].filter(
    (path) => !SAVE_V6_ALLOWED_PATHS.includes(path),
  );
  assert.deepEqual([...new Set(v7Only)].sort(), ['world.autonomy']);
});

test('v5 路径全集 = v4 全集 + 新增一条，没有漏加也没有重复', () => {
  const v5Only = [...new Set(collectSavePaths(sampleV5))].filter(
    (path) =>
      !SAVE_V1_ALLOWED_PATHS.includes(path) &&
      !SAVE_V2_ADDED_PATHS.includes(path) &&
      !SAVE_V3_ADDED_PATHS.includes(path) &&
      !SAVE_V4_ADDED_PATHS.includes(path),
  );
  assert.deepEqual([...new Set(v5Only)].sort(), [...SAVE_V5_ADDED_PATHS].sort());
});

test('样例能通过当前版本校验（字段与 v6 一致）', () => {
  assertSave(sample);
  assert.equal(sample.schemaVersion, 8);
  assert.equal(sample.world.memory, '', '样例没有记忆，空串是明确的「没有」');
  assert.equal(sample.world.autonomy, null, '旧档没有外环状态，从 L0 重新开始');
  assert.equal(sample.world.siteOutput, '', '样例没有产出，空串是明确的「没有」');
  assert.deepEqual(sample.world.terrainEdits, [], '样例没有地形改动');
  assert.equal(sample.world.villagers.length, 2);
  assert.equal(sample.world.settled.length, 2);
  // 三个 v3 字段的缺省值：满油、无覆盖、零次改变。
  for (const villager of sample.world.villagers) assert.equal(villager.lampOil, 1);
  assert.equal(sample.world.tideOverride, null);
  assert.equal(sample.world.worldChangeVersion, 0);
});

test('嵌套键集合冻结：样例 tasks[] / settled[] 与常量逐键一致', () => {
  for (const task of sample.world.tasks) {
    assert.deepEqual(
      Object.keys(task).sort(),
      [...SAVE_TASK_KEYS].sort(),
      'world.tasks[] 键集合必须与冻结常量一致（多一个字段就是漂移）',
    );
  }
  assert.ok(sample.world.tasks.length > 0, '样例必须有 task 可供嵌套校验');
  for (const record of sample.world.settled) {
    assert.deepEqual(
      Object.keys(record).sort(),
      [...SAVE_SETTLED_KEYS].sort(),
      'world.settled[] 键集合必须与冻结常量一致',
    );
  }
});

test('变异探针：字段变了但版本没升 → 指纹变化、测试必须红', () => {
  const mutated = JSON.parse(JSON.stringify(sample)) as Record<string, unknown> & {
    world: Record<string, unknown>;
  };
  mutated.world.unexpectedField = 1;
  assert.notEqual(saveFingerprint(mutated), SCHEMA_V7_FINGERPRINT, '加字段必须改变指纹');

  const removed = JSON.parse(JSON.stringify(sample)) as Record<string, unknown> & {
    world: Record<string, unknown>;
  };
  delete removed.world.faith;
  assert.notEqual(saveFingerprint(removed), SCHEMA_V7_FINGERPRINT, '删字段必须改变指纹');

  // 加载时按 meta.schemaFingerprint 判坏档：值不符 → 拒绝。
  const wrongMeta = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    meta: { schemaFingerprint: string };
  };
  wrongMeta.meta.schemaFingerprint = 'deadbeefdeadbeef';
  assert.throws(() => assertSave(wrongMeta));
});

// ------------------------------- P2：路径集合包含校验（只防新增路径，不重算双常量）

test('v1 冻结路径全集：99 条、与 v1 样例逐条一致、指纹等于常量', () => {
  const fromSample = [...new Set(collectSavePaths(sampleV1))].sort();
  assert.equal(SAVE_V1_PATHS.length, 99);
  assert.deepEqual([...SAVE_V1_PATHS].sort(), fromSample, '常量必须与 docs 样例路径逐条一致');
  assert.equal(fingerprintOfPaths(SAVE_V1_PATHS), SCHEMA_V1_FINGERPRINT);
  // 允许集合 = 样例 99 条 + 正在走路才会出现的可选嵌套路径。
  assert.deepEqual(
    new Set(SAVE_V1_ALLOWED_PATHS),
    new Set([...SAVE_V1_PATHS, ...SAVE_V1_OPTIONAL_PATHS]),
  );
});

test('P2：顶层 / world / meta / 任意数组元素加字段 → 拒绝，且报错指名越界路径', () => {
  const mutate = (
    apply: (copy: Record<string, unknown> & { world: Record<string, unknown>; meta: Record<string, unknown> }) => void,
  ): unknown => {
    const copy = JSON.parse(JSON.stringify(sample)) as Record<string, unknown> & {
      world: Record<string, unknown>;
      meta: Record<string, unknown>;
    };
    apply(copy);
    return copy;
  };
  const cases: [string, unknown, string][] = [
    ['顶层', mutate((copy) => { copy.unexpectedTopLevel = 1; }), 'unexpectedTopLevel'],
    ['world', mutate((copy) => { copy.world.unexpectedWorldField = 1; }), 'world.unexpectedWorldField'],
    ['meta', mutate((copy) => { copy.meta.unexpectedMetaField = 1; }), 'meta.unexpectedMetaField'],
    [
      'villagers 元素',
      mutate((copy) => {
        const villagers = copy.world.villagers as Record<string, unknown>[];
        villagers[0].unexpectedVillagerField = 1;
      }),
      'world.villagers[].unexpectedVillagerField',
    ],
    [
      'buildings 元素',
      mutate((copy) => {
        const buildings = copy.world.buildings as Record<string, unknown>[];
        buildings[0].unexpectedBuildingField = 1;
      }),
      'world.buildings[].unexpectedBuildingField',
    ],
  ];
  for (const [label, mutated, path] of cases) {
    assert.throws(
      () => assertSave(mutated),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /字段漂移/);
        assert.ok(error.message.includes(path), `${label}报错必须指名越界路径 ${path}：${error.message}`);
        return true;
      },
      `${label}加字段必须被 assertSave 拒绝`,
    );
  }
});

test('P2：meta.schemaFingerprint 缺失或不是字符串 → 拒绝', () => {
  const missing = JSON.parse(JSON.stringify(sample)) as {
    meta: Record<string, unknown>;
  };
  delete missing.meta.schemaFingerprint;
  assert.throws(() => assertSave(missing), /缺 meta\.schemaFingerprint/);

  const notString = JSON.parse(JSON.stringify(sample)) as { meta: Record<string, unknown> };
  notString.meta.schemaFingerprint = 12345;
  assert.throws(() => assertSave(notString), /缺 meta\.schemaFingerprint/);

  const nulled = JSON.parse(JSON.stringify(sample)) as { meta: Record<string, unknown> };
  nulled.meta.schemaFingerprint = null;
  assert.throws(() => assertSave(nulled), /缺 meta\.schemaFingerprint/);
});

test('P2：伪造 meta 字段骗不过校验（改值 / 加字段都拒）', () => {
  const wrongValue = JSON.parse(JSON.stringify(sample)) as { meta: Record<string, unknown> };
  wrongValue.meta.schemaFingerprint = 'deadbeefdeadbeef';
  assert.throws(() => assertSave(wrongValue), /指纹不符/);

  const spoofed = JSON.parse(JSON.stringify(sample)) as Record<string, unknown> & {
    world: Record<string, unknown>;
    meta: Record<string, unknown>;
  };
  // 加字段 + meta 里仍写着"看起来合法"的常量：指纹层放行，包含校验必须拒绝。
  spoofed.world.smuggledField = 1;
  spoofed.meta.schemaFingerprint = SCHEMA_V8_FINGERPRINT;
  assert.throws(() => assertSave(spoofed), /字段漂移/);
});

// --------------------------------------------- v3 扩位置：三个字段的读写与迁移

test('v3 新增三个字段：缺省值符合约定（满油 / 无覆盖 / 零次改变）', () => {
  // 迁移链给的就是这三个缺省；样例即迁移产物，所以这里同时锁住两件事。
  assert.equal(sample.world.tideOverride, null, '旧档没有覆盖，迁移后必须是 null 而不是 {}');
  assert.equal(sample.world.worldChangeVersion, 0, '旧档没记过改变次数，从零开始数');
  for (const villager of sample.world.villagers) {
    assert.equal(villager.lampOil, 1, '旧档没有灯，迁移后读作满油');
  }
});

test('v3 新增三个字段：tideOverride 非空时元素键也合法', () => {
  // 样例里是 null，元素键不在样例路径里——运行中覆盖一生效就必须合法，
  // 否则「我说涨潮」的那一刻存档会把自己判成坏档。
  const withOverride = JSON.parse(JSON.stringify(sample)) as {
    world: { tideOverride: unknown };
    meta: { schemaFingerprint: string };
  };
  withOverride.world.tideOverride = { level: 0.8, until: 999_999 };
  // 路径集合变了，指纹自然对不上；这里要验的是**路径集合包含校验**放行。
  // 直接把指纹改成重算值，再跑一次完整校验。
  withOverride.meta.schemaFingerprint = saveFingerprint(withOverride);
  assert.throws(() => assertSave(withOverride), /指纹不符/, '指纹是冻结常量，重算值必须被拒');

  // 所以：换一条更贴近真实的路——覆盖生效时存档**仍然**写冻结指纹。
  const live = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    world: { tideOverride: unknown };
  };
  live.world.tideOverride = { level: 0.8, until: 999_999 };
  assert.doesNotThrow(
    () => assertSave(live),
    '覆盖生效时，存档必须仍然通过校验（元素键在允许集合里）',
  );
});

test('v3 新增三个字段：越界值被拒（灯油 >1 / 覆盖 >1 / 计数为负）', () => {
  const lampOver = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    world: { villagers: { lampOil: number }[] };
  };
  lampOver.world.villagers[0].lampOil = 1.5;
  assert.throws(() => assertSave(lampOver), /lampOil 必须在 0\.\.1/);

  const lampMissing = JSON.parse(JSON.stringify(sample)) as {
    world: { villagers: Record<string, unknown>[] };
  };
  delete lampMissing.world.villagers[0].lampOil;
  assert.throws(() => assertSave(lampMissing), /lampOil 缺失/);

  const tideOver = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    world: { tideOverride: { level: number; until: number } | null };
  };
  tideOver.world.tideOverride = { level: 2, until: 1 };
  assert.throws(() => assertSave(tideOver), /tideOverride\.level 必须在 0\.\.1/);

  const negativeCount = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    world: { worldChangeVersion: number };
  };
  negativeCount.world.worldChangeVersion = -1;
  assert.throws(() => assertSave(negativeCount), /worldChangeVersion 必须 ≥ 0/);
});

// --------------------------------------------- v4 扩位置：四个槽位的缺省与校验

test('v4 四个槽位：缺省值符合约定（名牌在身 / 两手空空 / 干净 / 无话）', () => {
  // 迁移链给的就是这四个缺省；样例即迁移产物，所以这里同时锁住两件事。
  for (const villager of sample.world.villagers) {
    assert.equal(villager.nameState, 'held', '旧档没人抵押过名牌');
    assert.deepEqual(villager.carries, [], '旧档没有带着灯或鞋通行这回事');
  }
  for (const prop of sample.world.props) {
    assert.equal(prop.grime, 0, '旧档的摆件是干净的——读作脏等于凭空弄脏它');
    assert.equal(prop.reveal, null, '旧档的摆件没藏话');
  }
});

test('v4 四个槽位：越界值被拒（污浊度 >1 / 名牌第三态 / 未知凭证）', () => {
  const grimeOver = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    world: { props: { grime: number }[] };
  };
  grimeOver.world.props[0].grime = 1.4;
  assert.throws(() => assertSave(grimeOver), /grime 必须在 0\.\.1/);

  // 坏值要从"任意 JSON"那一侧灌进来，所以先落成宽松记录再改——
  // 直接 `as WorldSaveV4` 会让 TypeScript 替我们把这两个字面量拦在编译期，
  // 那就测不到运行期的 assertSave 了。
  const badNameState = JSON.parse(JSON.stringify(sample)) as {
    world: { villagers: Record<string, unknown>[] };
  };
  badNameState.world.villagers[0].nameState = 'lost';
  assert.throws(() => assertSave(badNameState), /nameState 只能是 held\/pawned/);

  const badCarry = JSON.parse(JSON.stringify(sample)) as {
    world: { villagers: Record<string, unknown>[] };
  };
  badCarry.world.villagers[0].carries = ['torch'];
  assert.throws(() => assertSave(badCarry), /carries\[\] 只能是 lamp\/shoes/);

  // 缺一个键也拒：路径集合会因删字段而合法缩小，这一半必须逐字段点名。
  const missingGrime = JSON.parse(JSON.stringify(sample)) as {
    world: { props: Record<string, unknown>[] };
  };
  delete missingGrime.world.props[0].grime;
  assert.throws(() => assertSave(missingGrime), /grime 缺失/);
});

test('v4 槽位运行时才出现的形状也合法：carries 非空、reveal 有字', () => {
  const live = JSON.parse(JSON.stringify(sample)) as WorldSaveV7 & {
    world: { villagers: { carries: string[] }[]; props: { reveal: string | null }[] };
  };
  live.world.villagers[0].carries = ['lamp', 'shoes'];
  live.world.props[0].reveal = '井底下压着一句话';
  assert.doesNotThrow(() => assertSave(live));
});

// --------------------------------------------- 迁移链

test('v5→v8 迁移：补空 terrainEdits / autonomy / siteOutput，直接过当前校验', () => {
  const migrated = migrateSave(JSON.parse(JSON.stringify(sampleV5))) as unknown as WorldSaveV8;
  assert.doesNotThrow(() => assertSave(migrated), '迁移产物必须直接过 v8 校验');
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.meta.schemaFingerprint, SCHEMA_V8_FINGERPRINT);
  assert.deepEqual(migrated.world.terrainEdits, [], '老档没改过地形，补空数组而不是编一条改动');
  assert.equal(migrated.world.memory, sampleV5.world.memory);
  assert.deepEqual(migrated.world.villagers.map((v) => v.id), sampleV5.world.villagers.map((v) => v.id));
});

test('v4→v8 迁移：v4 样例一路迁移，迁移产物直接过当前校验', () => {
  const migrated = migrateSave(JSON.parse(JSON.stringify(sampleV4))) as unknown as WorldSaveV8;
  assert.doesNotThrow(() => assertSave(migrated), '迁移产物必须直接过 v8 校验');
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.meta.schemaFingerprint, SCHEMA_V8_FINGERPRINT);
  assert.equal(migrated.world.memory, '', '老档没有记忆段，补空串而不是塞一份假记忆');
  assert.deepEqual(migrated.world.terrainEdits, []);
  assert.deepEqual(migrated.world.villagers.map((v) => v.id), sampleV4.world.villagers.map((v) => v.id));
});

test('v3→v8 迁移：v3 样例完整可迁移，迁移产物直接过当前校验', () => {
  const migrated = migrateSave(JSON.parse(JSON.stringify(sampleV3))) as unknown as WorldSaveV8;
  assert.doesNotThrow(() => assertSave(migrated), '迁移产物必须直接过 v8 校验');
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.meta.schemaFingerprint, SCHEMA_V8_FINGERPRINT);
});

test('v3→v8 迁移：原有数据一个不丢', () => {
  const migrated = migrateSave(JSON.parse(JSON.stringify(sampleV3))) as unknown as WorldSaveV8;
  assert.deepEqual(
    migrated.world.villagers.map((v) => v.id),
    sampleV3.world.villagers.map((v) => v.id),
  );
  assert.deepEqual(migrated.world.buildings, sampleV3.world.buildings);
  assert.deepEqual(migrated.world.tasks, sampleV3.world.tasks);
  assert.deepEqual(migrated.world.settled, sampleV3.world.settled);
  assert.deepEqual(migrated.world.props.map((p) => p.id), sampleV3.world.props.map((p) => p.id));
  assert.equal(migrated.world.now, sampleV3.world.now);
});

test('v2→v8 一条链走完：v2 样例迁移后直接过当前校验', () => {
  const migrated = migrateSave(JSON.parse(JSON.stringify(sampleV2))) as unknown as WorldSaveV8;
  assert.doesNotThrow(() => assertSave(migrated));
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.meta.schemaFingerprint, SCHEMA_V8_FINGERPRINT);
});

test('v1→v8 一条链走完：v1 样例迁移后直接过当前校验', () => {
  const migrated = migrateSave(JSON.parse(JSON.stringify(sampleV1))) as unknown as WorldSaveV8;
  assert.doesNotThrow(() => assertSave(migrated));
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.meta.schemaFingerprint, SCHEMA_V8_FINGERPRINT);
});

test('迁移链不洗白被改过的旧档：v2 / v3 / v4 / v5 各试一次', () => {
  const tamperedV2 = JSON.parse(JSON.stringify(sampleV2)) as Record<string, unknown> & {
    world: Record<string, unknown>;
  };
  tamperedV2.world.smuggledField = 1;
  assert.throws(() => migrateSave(tamperedV2), /字段漂移/);

  const tamperedV3 = JSON.parse(JSON.stringify(sampleV3)) as Record<string, unknown> & {
    world: Record<string, unknown>;
  };
  tamperedV3.world.smuggledField = 1;
  assert.throws(() => migrateSave(tamperedV3), /字段漂移/);

  const tamperedV4 = JSON.parse(JSON.stringify(sampleV4)) as Record<string, unknown> & {
    world: Record<string, unknown>;
  };
  tamperedV4.world.smuggledField = 1;
  assert.throws(() => migrateSave(tamperedV4), /字段漂移/);

  const tamperedV5 = JSON.parse(JSON.stringify(sampleV5)) as Record<string, unknown> & {
    world: Record<string, unknown>;
  };
  tamperedV5.world.smuggledField = 1;
  assert.throws(() => migrateSave(tamperedV5), /字段漂移/);
});
