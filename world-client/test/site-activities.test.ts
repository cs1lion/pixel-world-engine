/**
 * 场所活动词（`SiteDef.activities`）的消费方：谁允许在这里做什么。
 *
 * 三档判据，强弱不同，注释里各自标清：
 *
 * 1. **强红（行为面）**：带 `site` 的拍写了该场所不允许的词，装载期必须 throw。
 *    base 上没有这条交叉校验 ⇒ 不 throw ⇒ `assert.throws` 红在**行为**。
 * 2. **强红（能力面）**：`siteDefOf('park')` 必须 throw 且说「没有门控行」。
 *    base 上没有这个导出 ⇒ 红在**能力缺失**，不是文案。
 * 3. **弱红（接线面）**：经 `loadSettingPack` 喂 `kind:'park'` 的场所，消息含「没有门控行」。
 *    **这条红在消息，只改文案也能变绿，不构成事实源迁移的证明。**
 *    它只证明「装载路径确实走到了那张表」，不证明「表是唯一事实源」。
 *
 * 其余几条是性质钉（部分 base 绿），钉不变量而不是条数：
 * 词挂在门控行上、许可按行判不按 kind 判、许可 = 门开着 ∧ 词在清单里、
 * `SITE_KINDS` 由表派生且每个 kind 恰一行。
 *
 * 动态 import 是刻意的：base 上模块缺这些导出，必须红在断言/能力，
 * 不能变成 `ERR_MODULE_NOT_FOUND`（`red:first` 会把它记成 ERROR，不算红）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldMinutes } from '../src/world/pace.ts';

type SiteBandLike = {
  readonly fromMinute: number;
  readonly toMinute: number;
  readonly phase: 'open' | 'night';
};

type SiteDefLike = {
  readonly id: string;
  readonly kind: string;
  readonly bands: readonly SiteBandLike[];
  readonly activities?: readonly string[];
};

type TimetableLike = {
  readonly SITE_TABLE?: readonly SiteDefLike[];
  readonly SITE_KINDS?: readonly string[];
  readonly siteDefOf?: (kind: string) => SiteDefLike;
  readonly activityAllowedAt?: (site: SiteDefLike, activity: string, worldNow: number) => boolean;
};

/** 深拷贝一份设定集原始数据：测试只改副本，不污染模块里那份。 */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 把某个人的「场地拍」填上指定活动词（base 上这个字段只是多余的属性）。 */
function stampActivity(
  raw: Record<string, unknown>,
  villagerName: string,
  siteId: string,
  activity: string,
): void {
  const villagers = raw.villagers as { name: string; routine: Record<string, unknown>[] }[];
  const villager = villagers.find((item) => item.name === villagerName);
  assert.ok(villager !== undefined, `设定集里应该有 ${villagerName}`);
  const stop = villager.routine.find((item) => item.site === siteId);
  assert.ok(stop !== undefined, `${villagerName} 的作息里应该有指向 ${siteId} 的拍`);
  stop.activity = activity;
}

test('站点挂了自己场所不允许的活动词 ⇒ 装载期 throw（强红：行为面）', async () => {
  const { loadSettingPack } = await import('../src/settings/load.ts');
  const { DENGCHAO_RAW } = await import('../src/settings/dengchao/pack.ts');
  const raw = clone(DENGCHAO_RAW) as unknown as Record<string, unknown>;
  // 花径（kind: courtyard）只允许 rest / stroll；trade 是集市那边的词。
  stampActivity(raw, '汐', 'courtyard', 'trade');

  assert.throws(
    () => loadSettingPack(raw as never),
    /不允许活动 trade/,
    '场所词与场所不匹配必须在装载期失败，不许等到行为层静默退回锚点',
  );
});

test('siteDefOf 对没有门控行的 kind throw（强红：能力面）', async () => {
  const table = (await import('../src/world/timetable.ts')) as unknown as TimetableLike;
  assert.equal(typeof table.siteDefOf, 'function', 'timetable.ts 必须导出 siteDefOf(kind)');

  assert.throws(
    () => table.siteDefOf!('park'),
    /没有门控行/,
    'kind 的事实源是 SITE_TABLE；表里没有这一行就必须 throw，不许当成「今天关着」',
  );
});

test('包里声明了没有门控行的 kind ⇒ 装载期 throw（弱红：只证明接线）', async () => {
  const { loadSettingPack } = await import('../src/settings/load.ts');
  const { DENGCHAO_RAW } = await import('../src/settings/dengchao/pack.ts');
  const raw = clone(DENGCHAO_RAW) as unknown as Record<string, unknown>;
  const sites = raw.sites as { id: string; kind: string }[];
  const courtyard = sites.find((item) => item.id === 'courtyard');
  assert.ok(courtyard !== undefined, '设定集里应该有 courtyard 锚');
  courtyard.kind = 'park';

  // 注：这条红在消息，只改文案也能变绿，不构成事实源迁移的证明。
  assert.throws(
    () => loadSettingPack(raw as never),
    /没有门控行/,
    '包里声明了没有门控行的 kind，装载期必须说清是哪一行缺了',
  );
});

test('每个场所的许可词挂在门控行上', async () => {
  const table = (await import('../src/world/timetable.ts')) as unknown as TimetableLike;
  const rowOf = (id: string): SiteDefLike => {
    const row = (table.SITE_TABLE ?? []).find((item) => item.id === id);
    assert.ok(row !== undefined, `SITE_TABLE 里应该有 ${id}`);
    return row;
  };
  const words = (id: string) => [...(rowOf(id).activities ?? [])].sort();

  assert.deepEqual(words('market'), ['stroll', 'trade'], '集市：饮食街的交易与走动');
  assert.deepEqual(words('courtyard'), ['rest', 'stroll'], '花径：坐下与走看');
  assert.deepEqual(words('workshop'), ['work'], '工坊只做活');
});

test('许可按行判，不按 kind 判（同 kind 不同清单的探针）', async () => {
  const table = (await import('../src/world/timetable.ts')) as unknown as TimetableLike;
  assert.equal(typeof table.activityAllowedAt, 'function', 'timetable.ts 必须导出 activityAllowedAt');

  // 探针：kind 仍是 market，但这一行只允许 work。实现若按 kind 分支，这两条必错。
  const probe: SiteDefLike = {
    id: 'probe',
    kind: 'market',
    bands: [{ fromMinute: 6 * 60, toMinute: 22 * 60, phase: 'open' }],
    activities: ['work'],
  };
  const noon = worldMinutes(12 * 60);
  assert.equal(table.activityAllowedAt!(probe, 'trade', noon), false, '探针行不允许 trade');
  assert.equal(table.activityAllowedAt!(probe, 'work', noon), true, '探针行允许 work');
});

test('许可 = 门开着 ∧ 词在清单里', async () => {
  const table = (await import('../src/world/timetable.ts')) as unknown as TimetableLike;
  const rowOf = (id: string): SiteDefLike => {
    const row = (table.SITE_TABLE ?? []).find((item) => item.id === id);
    assert.ok(row !== undefined, `SITE_TABLE 里应该有 ${id}`);
    return row;
  };
  const allowed = (id: string, activity: string, minute: number) =>
    table.activityAllowedAt!(rowOf(id), activity, worldMinutes(minute));

  assert.equal(allowed('market', 'trade', 8 * 60 + 30), true, '早市里可以交易');
  assert.equal(allowed('market', 'trade', 22 * 60 + 30), false, '闭市后不行');
  assert.equal(allowed('courtyard', 'rest', 14 * 60 + 10), true, '花径午后可以休息');
  assert.equal(allowed('courtyard', 'rest', 12 * 60), false, '午间安静段花径还没开');
  assert.equal(allowed('workshop', 'work', 10 * 60), true, '工坊白天可以干活');
  assert.equal(allowed('workshop', 'work', 17 * 60 + 30), false, '收工后不行');
});

test('SITE_KINDS 由表派生，每个 kind 恰有一条门控行', async () => {
  const table = (await import('../src/world/timetable.ts')) as unknown as TimetableLike;
  const rows = table.SITE_TABLE ?? [];
  const kinds = table.SITE_KINDS;
  assert.ok(Array.isArray(kinds), 'timetable.ts 必须导出 SITE_KINDS');
  assert.deepEqual(
    [...kinds!].sort(),
    rows.map((row) => row.kind).sort(),
    'SITE_KINDS 必须从 SITE_TABLE 派生，不许另写一份',
  );
  for (const kind of new Set(rows.map((row) => row.kind))) {
    assert.equal(
      rows.filter((row) => row.kind === kind).length,
      1,
      `${kind} 只能有一条门控行（多于一行时按 kind 取行就说不清取哪条）`,
    );
  }
  for (const row of rows) {
    // 省略 = 这个场所不承载活动；写空表 = 疑似漏填，装载期会 throw。
    assert.ok(
      row.activities === undefined || row.activities.length > 0,
      `场所 ${row.id} 的活动清单不许是空表`,
    );
  }
});
