import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntentSchemaError, parseIntent } from '../src/world/intent-schema.ts';
import { TIDE_OVERRIDE_MAX_MS } from '../src/world/tide.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { readFileSync } from 'node:fs';

const templates = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);
const WORLD = { width: 96, height: 72 };

const ok = (raw: unknown) => parseIntent(raw, templates, WORLD);
const bad = (raw: unknown): string => {
  try {
    ok(raw);
  } catch (error) {
    if (error instanceof IntentSchemaError) return error.message;
    throw error;
  }
  throw new Error('期望被拒绝，但通过了');
};

// ---------------------------------------------------------------- 合法意图

test('派活：任务类型与摘要都要合法', () => {
  assert.deepEqual(ok({ kind: 'dispatch', taskKind: 'code', summary: '写个爬虫' }), {
    kind: 'dispatch',
    taskKind: 'code',
    summary: '写个爬虫',
  });
});

test('交付与撤销没有载荷', () => {
  assert.deepEqual(ok({ kind: 'complete' }), { kind: 'complete' });
  assert.deepEqual(ok({ kind: 'cancelPending' }), { kind: 'cancelPending' });
});

test('天气三档：晴、雨、暴雨', () => {
  for (const weather of ['clear', 'rain', 'storm'] as const) {
    assert.deepEqual(ok({ kind: 'setWeather', weather }), { kind: 'setWeather', weather });
  }
  assert.throws(() => ok({ kind: 'setWeather', weather: 'snow' }), /不在取值域里/);
});

test('拨潮：潮位与时长都要在域内，上限与世界那条命令同源', () => {
  assert.deepEqual(ok({ kind: 'setTide', level: 1, durationMs: 30_000 }), {
    kind: 'setTide',
    level: 1,
    durationMs: 30_000,
  });
  // 上限从 `tide.ts` 取，不在这里另抄一个常量——抄了就会有一个先改一个漏改。
  assert.match(
    bad({ kind: 'setTide', level: 1, durationMs: TIDE_OVERRIDE_MAX_MS + 1 }),
    /最多 120000/,
  );
  assert.match(bad({ kind: 'setTide', level: 1, durationMs: 0 }), /正数毫秒/);
  assert.match(bad({ kind: 'setTide', level: 1.5, durationMs: 1000 }), /0\.\.1/);
  assert.match(bad({ kind: 'setTide', level: 'high', durationMs: 1000 }), /必须是数字/);
});

test('拨潮不接受多余的字段：reason 不能混进来', () => {
  assert.match(
    bad({ kind: 'setTide', level: 1, durationMs: 1000, reason: '因为' }),
    /不接受字段 "reason"/,
  );
});

test('造物：模板必须是注册表里有的', () => {
  assert.deepEqual(ok({ kind: 'build', templateId: 'code_forge' }), {
    kind: 'build',
    templateId: 'code_forge',
    at: null,
  });
});

test('造物：位置可省略，也可给整数格', () => {
  assert.deepEqual(ok({ kind: 'build', templateId: 'code_forge', at: { x: 32, y: 14 } }), {
    kind: 'build',
    templateId: 'code_forge',
    at: { x: 32, y: 14 },
  });
});

test('拆：实例 id 指名道姓，原样保留', () => {
  // 实例 id **不查注册表**：它是世界的身份，不是模板名。查表会把它当成
  // 未知模板拒掉，而世界其实认得它。
  assert.deepEqual(ok({ kind: 'demolish', instanceId: 'ink_house#2' }), {
    kind: 'demolish',
    instanceId: 'ink_house#2',
  });
});

test('拆：只说模板也行，那是「拆掉抄书斋」这一种说法', () => {
  assert.deepEqual(ok({ kind: 'demolish', templateId: 'ink_house' }), {
    kind: 'demolish',
    templateId: 'ink_house',
  });
});

test('拆：两个都给、两个都不给，都拒', () => {
  assert.match(
    bad({ kind: 'demolish', templateId: 'ink_house', instanceId: 'ink_house#2' }),
    /不能同时给/,
  );
  assert.match(bad({ kind: 'demolish' }), /需要 instanceId/);
  assert.match(bad({ kind: 'demolish', instanceId: '  ' }), /instanceId 不能为空/);
});

test('神迹：三件，可带坐标', () => {
  assert.deepEqual(ok({ kind: 'miracle', miracle: 'tree', at: { x: 40, y: 45 } }), {
    kind: 'miracle',
    miracle: 'tree',
    at: { x: 40, y: 45 },
  });
});

test('unknown 是一等公民：听不出就该说听不出', () => {
  assert.deepEqual(ok({ kind: 'unknown', reason: '这句话没有要求世界做任何事' }), {
    kind: 'unknown',
    reason: '这句话没有要求世界做任何事',
  });
});

// ---------------------------------------------------------------- 拒绝

test('未知意图被拒，并列出可选值', () => {
  const why = bad({ kind: 'teleport' });
  assert.match(why, /未知意图 "teleport"/);
  assert.match(why, /dispatch/);
});

test('未知字段被拒，不静默忽略', () => {
  assert.match(
    bad({ kind: 'complete', confidence: 0.9 }),
    /不接受字段 "confidence"/,
    '多写字段说明模型对形状的理解已经偏了',
  );
  assert.match(bad({ kind: 'unknown', reason: '不懂', at: { x: 1, y: 1 } }), /不接受字段 "at"/);
});

test('模型不能发明建筑', () => {
  assert.match(bad({ kind: 'build', templateId: 'dragon_tower' }), /未知模板 "dragon_tower"/);
});

test('越界的坐标被拒，且说清范围', () => {
  const why = bad({ kind: 'build', templateId: 'code_forge', at: { x: 96, y: 0 } });
  assert.match(why, /在世界之外/);
  assert.match(why, /0\.\.95/);
});

test('非整数坐标被拒', () => {
  assert.match(
    bad({ kind: 'build', templateId: 'code_forge', at: { x: 1.5, y: 2 } }),
    /at\.x 必须是整数/,
  );
});

test('at 里多一个字段也被拒', () => {
  assert.match(
    bad({ kind: 'build', templateId: 'code_forge', at: { x: 1, y: 2, z: 3 } }),
    /at 不接受字段 "z"/,
  );
});

test('枚举外取值被拒，并列出取值域', () => {
  assert.match(bad({ kind: 'setWeather', weather: 'snow' }), /snow.*clear \/ rain/);
  assert.match(bad({ kind: 'miracle', miracle: 'dragon' }), /dragon.*light \/ tree \/ cat/);
  assert.match(bad({ kind: 'dispatch', taskKind: 'cook', summary: '做饭' }), /cook/);
});

test('空摘要与空理由被拒', () => {
  assert.match(bad({ kind: 'dispatch', taskKind: 'code', summary: '  ' }), /summary 不能为空/);
  assert.match(bad({ kind: 'unknown', reason: '   ' }), /reason 不能为空/);
});

test('整份 JSON 不是对象时被拒', () => {
  for (const raw of [null, 'hello', 42, [1, 2]]) {
    assert.match(bad(raw), /意图必须是对象/);
  }
});

// ---------------------------------------------------------------- 边界

test('quick 是合法任务类型：短活也走派活', () => {
  assert.equal(ok({ kind: 'dispatch', taskKind: 'quick', summary: '顺手看一眼' }).kind, 'dispatch');
});

test('at 为 null 与省略等价', () => {
  assert.deepEqual(
    ok({ kind: 'miracle', miracle: 'cat', at: null }),
    ok({ kind: 'miracle', miracle: 'cat' }),
  );
});

test('未知模板时把可选模板全列出来，模型才有机会改对', () => {
  const why = bad({ kind: 'build', templateId: 'nope' });
  for (const id of templates.keys()) assert.ok(why.includes(id), `提示里缺 ${id}`);
});

// ---------------------------------------------------------------- 渡有仪式

test('给谁什么凭证：按名字点人，不按 id', () => {
  // 上下文喂给模型的是**名字**（`intent-context.ts` 的 busy 只有 name），
  // 所以意图也必须说名字。叫 id 就是 demolish 那个 bug 重演：
  // 模型手里根本没有 id 可填，只能编一个。
  assert.deepEqual(ok({ kind: 'carry', villager: '莞尔', carries: ['lamp'] }), {
    kind: 'carry',
    villager: '莞尔',
    carries: ['lamp'],
  });
});

test('两手空空也是说得出口的：空数组不是缺字段', () => {
  // 「让她把灯放下」和「给她一盏灯」是同一条命令的两半。
  // 只有给、没有收，那道门就永远开着——世界再也回不到没人有灯的样子。
  assert.deepEqual(ok({ kind: 'carry', villager: '莞尔', carries: [] }), {
    kind: 'carry',
    villager: '莞尔',
    carries: [],
  });
});

test('凭证是闭集：写错的一个字都进不了世界', () => {
  // 表现成「她明明带着灯，那道门就是不认」——只有截图才看得见的那种 bug。
  // 说法跟 readOneOf 一致（` / `，给模型看）；世界那条回执用「、」是给人看的。
  assert.match(bad({ kind: 'carry', villager: '莞尔', carries: ['torch'] }), /torch/);
  assert.match(bad({ kind: 'carry', villager: '莞尔', carries: ['torch'] }), /lamp \/ shoes/);
  // 一锅端的也要拒，不能收下 lamp 放过 torch——部分接受比整条拒更难查。
  assert.match(bad({ kind: 'carry', villager: '莞尔', carries: ['lamp', 'torch'] }), /torch/);
});

test('carry 要点名一个人，也要说带什么', () => {
  assert.match(bad({ kind: 'carry', carries: ['lamp'] }), /villager/);
  assert.match(bad({ kind: 'carry', villager: '莞尔' }), /carries/);
  assert.match(bad({ kind: 'carry', villager: '  ', carries: ['lamp'] }), /villager 不能为空/);
});
