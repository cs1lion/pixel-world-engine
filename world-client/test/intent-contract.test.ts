import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseIntent } from '../src/world/intent-schema.ts';
import { ALLOWED_KEYS } from '../src/world/intent-schema.ts';
import { CARRY_ITEMS } from '../src/world/gate.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';

/**
 * 服务端 `/api/world/intent` 说出来的意图，客户端必须认得。
 *
 * 两份实现（`server/oracle/wire.py` 与 `src/world/intent-schema.ts`）各自校验一遍，
 * 各写一遍就一定会漂。这条测试拿**冻结样例**当输入，喂给客户端真正的校验器。
 *
 * 为什么是文件而不是这里手写一张表：手写的表只钉住「写这条测试的那天两边一致」。
 * `docs/intent.sample.json` 同时被 `server/tests/test_intent_api.py` 读，
 * 那边断言端点真的产出这些形状——于是这条测试钉的是**端点**，不是我的记性。
 * 任一端改了形状而没改样例，两份测试里必有一份先红。
 */

const templates = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);
const WORLD = { width: 96, height: 72 };

const SAMPLE = JSON.parse(
  readFileSync(new URL('../../docs/intent.sample.json', import.meta.url), 'utf8'),
) as {
  responses: { why: string; command: Record<string, unknown> | null; intent: Record<string, unknown> }[];
};

test('样例里服务端会返回的每一种意图，客户端的校验器都收得下', () => {
  assert.ok(SAMPLE.responses.length > 0, '样例空了，这条测试就等于没跑');
  for (const { why, intent } of SAMPLE.responses) {
    assert.doesNotThrow(
      () => parseIntent(intent, templates, WORLD),
      `「${why}」被客户端拒了——两边的形状已经漂了`,
    );
  }
});

test('样例覆盖了客户端的每一种意图，除了只能由规则产出的那三种', () => {
  // dispatch / complete / cancelPending 不经模型，服务端没有对应的白名单命令，
  // 所以它们不该出现在意图线样例里。反过来，其余每一种都必须有一条样例——
  // 少了就是一种「服务端会返回、但没人验证客户端认得」的形状。
  const covered = new Set(SAMPLE.responses.map((item) => String(item.intent.kind)));
  assert.deepEqual(
    [...covered].sort(),
    ['build', 'carry', 'demolish', 'miracle', 'setTide', 'setWeather', 'unknown'],
  );
});

test('服务端不会返回的「第十种意图」被客户端拒掉', () => {
  // 反过来钉：客户端不是什么都收。这条保证上面那条不是因为校验器太松才绿的。
  assert.throws(
    () => parseIntent({ kind: 'teleport', to: 'anywhere' }, templates, WORLD),
    /未知意图/,
  );
});

test('服务端的拨潮时长受同一个上限约束', () => {
  // 服务端 `rules/schema.py` 的 TIDE_OVERRIDE_MAX_MS 与这里必须一致。
  // 不一致的表现是：模型给 3 分钟，服务端收了，客户端拒了——用户看到"没听懂"，
  // 而实际上世界已经准备好执行了。样例里那条「正好等于上限」就是这条的正面用例。
  assert.doesNotThrow(() =>
    parseIntent({ kind: 'setTide', level: 0.5, durationMs: 120_000 }, templates, WORLD),
  );
  assert.throws(
    () => parseIntent({ kind: 'setTide', level: 0.5, durationMs: 120_001 }, templates, WORLD),
    /最多 120000/,
  );
});

test('凭证闭集两边各声明一次，而且说的是同一套词', () => {
  // `CARRY_ITEMS` 从前在三处各写一遍：客户端 `gate.ts`、服务端
  // `rules/schema.py`、服务端 `oracle/wire.py`。「各写一遍就一定会漂」
  // 这句话于是在服务端内部就先应验了——`wire.py` 早就 import 了 `rules.schema`，
  // 却还是自己又写了一个元组。
  //
  // 所以这里数的是**声明**，不是出现：`wire.py` 该引那一份，不许再写。
  // 它再写一个，这条测试就得改，而改的时候就会看见为什么不该写。
  const client = [...CARRY_ITEMS].sort().join(',');
  // 正则容忍注解与换行：`CARRY_ITEMS: tuple[str, ...] = (\n  "lamp",\n)`。
  // 钉死 `= (` 挨在一起的那种匹配，将来有人给这个元组加个类型注解，
  // 这条会一声不响地找不到它——而找不到和「只有一处」在这条里不是一回事。
  const declaration = /^CARRY_ITEMS\b[^=]*=\s*\(([^)]*)\)/m;
  const declaredIn: string[] = [];
  for (const path of ['../../server/rules/schema.py', '../../server/oracle/wire.py']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const found = declaration.exec(source);
    if (found === null) continue;
    declaredIn.push(path);
    const server = (found[1] ?? '')
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter((item) => item !== '')
      .sort()
      .join(',');
    assert.equal(server, client, `${path} 的凭证闭集与客户端不一致：${server} ≠ ${client}`);
  }
  assert.deepEqual(
    declaredIn,
    ['../../server/rules/schema.py'],
    `凭证闭集只该在 rules/schema.py 声明一次；实际声明在 ${declaredIn.join(' 与 ')}——别处要引它，不许再写`,
  );
});

test('服务端的意图清单就是客户端的那一份：少一种，线协议就比世界少说一句话', () => {
  // `wire.py` 的文档说 `INTENT_KINDS` 与这里的 `IntentKind`「逐个对上」。
  // 这句话从前没有任何东西守着，于是它假了一次：`setTide` 加进客户端和冻结样例之后，
  // 服务端那份元组没跟着加——`validate_intent({"kind":"setTide"})` 抛「未知意图」，
  // 而客户端收得下、样例里也躺着一条。两边对同一句话说不一样的话，
  // 只有真的走到那条分支才看得见。
  //
  // 所以直接比源，跟上面那条凭证闭集同一个道理：手写的表只钉住写表那天。
  const clientSource = readFileSync(new URL('../src/world/intent-schema.ts', import.meta.url), 'utf8');
  // 收到声明结束的那个分号：分号后面还得跟着换行。联合里某个成员的注释
  // 也可能带分号，`[\s\S]*?;` 会在那儿提前收尾，于是拿半个联合去比——
  // 比出来的"不一致"是真的，但缺的那几种是假的。
  const union = /export type IntentKind =([\s\S]*?);\s*\n/.exec(clientSource);
  assert.ok(union !== null, 'intent-schema.ts 里找不到 IntentKind 联合了——它被改名或删了');
  const client = [...(union[1] ?? '').matchAll(/'([A-Za-z]+)'/g)]
    .map((found) => found[1] ?? '')
    .sort();

  const serverSource = readFileSync(new URL('../../server/oracle/wire.py', import.meta.url), 'utf8');
  const tuple = /^INTENT_KINDS\b[^=]*=\s*\(([^)]*)\)/m.exec(serverSource);
  assert.ok(tuple !== null, 'wire.py 里找不到 INTENT_KINDS 了——它被改名或删了');
  const server = (tuple[1] ?? '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter((item) => item !== '')
    .sort();

  assert.deepEqual(
    server,
    client,
    `服务端的意图清单与客户端不一致：${server.join(',')} ≠ ${client.join(',')}`,
  );
});

test('每种意图允许的字段两边是同一张表：客户端放过的字段，服务端不能 502', () => {
  // 上一句只说「意图有哪几种」，这一句说「每种意图带哪些字段」。
  // 清单对上了、字段表没对上，是同一类漂的另一种形状，而且更难看：
  // 客户端规规矩矩校验过的一份意图发到服务端，被 `ALLOWED_KEYS` 一句拒掉，
  // 端点转成 502，用户只看到「没听懂」——而那句话在客户端明明是说得通的。
  //
  // 这里比的是**集合**，不是顺序：字段的先后不影响语义，而顺序一有出入
  // 这条就会红，红得跟真漂了一模一样。
  const client = new Map(
    Object.entries(ALLOWED_KEYS).map(([kind, keys]) => [kind, [...keys].sort().join(',')]),
  );

  const serverSource = readFileSync(new URL('../../server/oracle/wire.py', import.meta.url), 'utf8');
  const table = /^ALLOWED_KEYS[^=]*=\s*\{([\s\S]*?)\n\}/m.exec(serverSource);
  assert.ok(table !== null, 'wire.py 里找不到 ALLOWED_KEYS 了——它被改名或删了');
  const server = new Map(
    [...(table[1] ?? '').matchAll(/^\s*"?([A-Za-z]+)"?:\s*frozenset\(\{([^}]*)\}\)/gm)].map(
      ([, kind, keys]) => [
        kind ?? '',
        (keys ?? '')
          .split(',')
          .map((key) => key.trim().replace(/^["']|["']$/g, ''))
          .filter((key) => key !== '')
          .sort()
          .join(','),
      ],
    ),
  );

  assert.ok(server.size > 0, 'ALLOWED_KEYS 一条都没解析出来——正则跟不上它的写法了');
  assert.deepEqual(
    server,
    client,
    `服务端的字段表与客户端不一致：${[...server.keys()].join(',')} ≠ ${[...client.keys()].join(',')}`,
  );
});
