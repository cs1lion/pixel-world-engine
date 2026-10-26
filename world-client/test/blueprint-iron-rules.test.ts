/**
 * 蓝图表的编译期铁律——代码里 enforced、却没被别处钉住的那几条。
 *
 * `world.test.ts` 已钉了蓝图表解析的几条近亲：id 与键名不符、门口落在占地内、
 * 铺子与活对不上、接活的铺子开在住宅区（`:86-112`）；`palette-budget.test.ts`
 * 钉了调色板槽。这个文件收**另外几条没人碰的铁律**（不是全部——剩下的整数格、
 * 非空串、取值闭集多是琐碎防线，不逐一钉）：
 *
 *   1. **空蓝图表皮拒。** `prefabs: {}` 编译成一张空表。默认世界那边 `buildWorld`
 *      还会跑 `validateCoverage` 兜底，但**包那条路 `buildSettingWorld` 不问
 *      coverage**（`load.ts` 只 `parseBlueprintTable`）——所以只有 `blueprints.ts:91`
 *      这道拦得住，否则一份空 prefabs 的包会静默长出一座空镇。
 *   2. **工位必须落在占地内。** 门口落在占地外是铁律（已测），工位是同一条铁律
 *      的另一半：工位在占地外，工人照着它走会走到一个到不了或莫名其妙的格子。
 *   3. **upgradeTo 必须有落点。** 这条**全库只有 `validateCoverage` 查**——
 *      `assertWorldInvariants` 不碰它，`src` 里也没有谁在读它（升级路径眼下还不
 *      存在）。表一写错就带着走，所以先在这时把它的契约钉住。
 *   4. **upgradeTo 有落点时不误报。** 第 3 条的对偶：落点在表里就不该记 problem，
 *      否则一份正当的升级链会被拦。
 *   5. **每种活 1–2 栋。** `validateCoverage` 自己有这条（`blueprints.ts:101-110`），
 *      和 `assertWorldInvariants` 的那条（`setup.ts:637-638`）是**两份独立实现、
 *      各带各的消息**——测一边护不住另一边，而 `validateCoverage` 的失败侧此前
 *      一条测试都没有。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBlueprintTable,
  validateCoverage,
  BlueprintError,
} from '../src/world/blueprints.ts';

const raw = JSON.parse(
  readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;

// ------------------------------------------------------- 空表皮拒

test('空蓝图表编译不过：一张没有楼可摆的表，不该静默开工', () => {
  // 包那条路 buildSettingWorld 不问 coverage，所以只有 blueprints.ts:91 这道拦得住；
  // 不拦的表现是「设定集里写了、场景里空的」——最难在浏览器里定位的静默失败。
  assert.throws(
    () => parseBlueprintTable({}),
    (error: unknown) => {
      assert.ok(error instanceof BlueprintError, `该是蓝图的错：${String(error)}`);
      assert.match(error.message, /蓝图表为空/);
      return true;
    },
  );
});

// ------------------------------------------------------- 工位在占地内

test('工位落在占地外时拒绝加载：门口铁律的另一半', () => {
  // 门口落在占地外已由 world.test.ts 钉；工位是同一条铁律的另一半——
  // 工位在占地外，工人照着它走会走到一个到不了或莫名其妙的格。
  assert.throws(
    () =>
      parseBlueprintTable({ code_forge: { ...raw.code_forge, workSpots: [{ x: 99, y: 99 }] } }),
    (error: unknown) => {
      assert.ok(error instanceof BlueprintError, `该是蓝图的错：${String(error)}`);
      assert.match(error.message, /工位落在占地外/);
      return true;
    },
  );
});

// ------------------------------------------------------- upgradeTo 有落点

test('upgradeTo 指向表里没有的蓝图：validateCoverage 记一条', () => {
  // 这条全库只有 validateCoverage 查；assertWorldInvariants 不碰 upgradeTo，
  // src 里也没有谁在读它（升级路径眼下还不存在）——表一写错就带着走。
  const table = parseBlueprintTable({
    code_forge: { ...raw.code_forge, upgradeTo: 'ghost' },
  });
  const problems = validateCoverage(table);
  assert.ok(
    problems.some((p) => p.includes('ghost')),
    `该记一条指向 ghost 的 problem，实际：${JSON.stringify(problems)}`,
  );
});

test('upgradeTo 有落点时不误报：落点在表里就不该记', () => {
  // 上一条的对偶。落点在表里还记 problem，会拦一份正当的升级链。
  // anvil→foundry 都在表里，upgradeTo 不该记；剩下的只该是 research/writing
  // 各 0 栋那两条计数 problem（两栋都承 code_forge 接 code 活，code 计 2 栋合规）。
  const table = parseBlueprintTable({
    anvil: { ...raw.code_forge, id: 'anvil', upgradeTo: 'foundry' },
    foundry: { ...raw.code_forge, id: 'foundry' },
  });
  const problems = validateCoverage(table);
  assert.equal(problems.length, 2, `只剩计数那两条，实际：${JSON.stringify(problems)}`);
  assert.ok(!problems.some((p) => p.includes('upgradeTo')));
});

// ------------------------------------------------------- 每种活 1–2 栋

test('每种活 1–2 栋：0 栋与 3 栋都记 problem', () => {
  // validateCoverage 自己有这条（blueprints.ts:101-110），和 assertWorldInvariants
  // 的那条（setup.ts:637-638）是两份独立实现、各带各的消息——测一边护不住另一边。
  const under = validateCoverage(parseBlueprintTable({ code_forge: raw.code_forge }));
  assert.ok(
    under.some((p) => p.includes('research') && p.includes('0 栋')),
    `0 栋该记，实际：${JSON.stringify(under)}`,
  );
  const over = validateCoverage(
    parseBlueprintTable({
      a: { ...raw.code_forge, id: 'a' },
      b: { ...raw.code_forge, id: 'b' },
      c: { ...raw.code_forge, id: 'c' },
    }),
  );
  assert.ok(
    over.some((p) => p.includes('code') && p.includes('3 栋')),
    `3 栋该记，实际：${JSON.stringify(over)}`,
  );
});
