import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIntentMessages, buildIntentPrompt } from '../src/world/intent-prompt.ts';
import { parseBlueprintTable } from '../src/world/blueprints.ts';
import { readFileSync } from 'node:fs';

const templates = parseBlueprintTable(
  JSON.parse(readFileSync(new URL('../src/world/prefabs.json', import.meta.url), 'utf8')),
);
const prompt = buildIntentPrompt(templates);

test('提示词里的模板表与注册表一致，不多不少', () => {
  // 这条是防漂移的核心：手抄的模板表迟早会和注册表对不上，
  // 对不上的表现是"模型说了个不存在的模板"——模型没错，是提示词在骗它。
  for (const [id, template] of templates) {
    assert.ok(prompt.includes(id), `提示词缺模板 ${id}`);
    assert.ok(prompt.includes(template.displayName), `提示词缺 ${id} 的显示名`);
  }
  const listed = prompt.match(/^  - (\w+)（/gm) ?? [];
  assert.equal(listed.length, templates.size, '提示词列出的模板数与注册表不符');
});

test('提示词把三档天气都讲了，模型才知道有暴雨', () => {
  // 只写 clear|rain 的话，模型会把「下暴雨」折叠成 rain——用户说了更大的雨，
  // 世界给了同一场雨。这条钉住取值域在提示词里也是三档。
  assert.match(prompt, /"clear"\|"rain"\|"storm"/);
  assert.match(prompt, /暴雨/);
});

test('提示词覆盖每一种意图——从联合类型问，不手写清单', () => {
  // 从前这里手写九个名字。于是 carry 加进 `IntentKind` 时这条没红：
  // 提示词少讲一种意图，模型就永远不说它，而全套测试照旧绿。
  // 手写的表只钉住写表那天，所以从 `intent-schema.ts` 的联合类型问。
  const source = readFileSync(new URL('../src/world/intent-schema.ts', import.meta.url), 'utf8');
  const union = /export type IntentKind =([\s\S]*?);/.exec(source);
  assert.ok(union !== null, 'intent-schema.ts 里找不到 IntentKind 联合了');
  const kinds = [...(union[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((found) => found[1] ?? '');
  assert.ok(kinds.length > 0, 'IntentKind 联合里数不出种类了');
  for (const kind of kinds) {
    assert.ok(prompt.includes(`"${kind}"`), `提示词没讲 ${kind}`);
  }
});

test('提示词把拨潮的时长上限写出来，并禁止模型自己改数', () => {
  // 模型最爱做的「贴心事」就是把 5 悄悄改成 1，然后回一句办好了。
  // 那正是世界要拒绝的事——用户以为他要的办成了。
  assert.match(prompt, /durationMs/);
  assert.match(prompt, /120000/);
  assert.match(prompt, /不要自己改数/);
});

test('提示词把 unknown 说成一等公民，而不是失败', () => {
  assert.match(prompt, /听不出就答 unknown/);
  assert.match(prompt, /宁可不动/);
});

test('提示词明确禁止解释与代码块', () => {
  assert.match(prompt, /只输出 JSON/);
  assert.match(prompt, /不要解释/);
});

test('问句与抱怨的正例都在，防止模型把闲聊当命令', () => {
  assert.match(prompt, /外面在下雨吗.*unknown/s);
  assert.match(prompt, /怎么写都不对.*unknown/s);
});

test('不接活的模板也被如实说明', () => {
  // workshop_plot 的 boundTask 是 null。说它「接某某活」会误导模型。
  assert.match(prompt, /workshop_plot（新工坊，不接活）/);
});

test('活类型四类都讲到', () => {
  for (const kind of ['code', 'research', 'writing', 'quick']) {
    assert.ok(prompt.includes(`- ${kind}：`), `提示词没讲 ${kind}`);
  }
});

test('消息只有 system + user 两条，user 就是原话', () => {
  const messages = buildIntentMessages(templates, '帮我写个爬虫');
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, 'system');
  assert.equal(messages[1]?.role, 'user');
  assert.equal(messages[1]?.content, '帮我写个爬虫', '不许改写用户原话');
});

test('两份提示词在「不许替用户改主意」上说同一句话', () => {
  // 这一份是**离线推演**那一侧，线上模型看的是 `server/oracle/prompt.py`。
  // 两份讲的是不同的命令词汇（这边是 intent kind，那边是白名单命令），
  // 所以不可能逐字相同；但「防偷换」那几句是**同一条纪律**，漂了就要出事。
  //
  // 漂过：线上那份补了毫秒换算、「表里没有的现象不许往邻居身上靠」、
  // 「永久不是可省略」，这一份一个字都没有。离线推演于是会给出一个
  // 与线上不同的 durationMs，或者把「下雪」翻译成 rain——而推演的人
  // 以为自己在看线上的行为。三处都是这次手工 grep 才发现的。
  const offline = readFileSync(new URL('../src/world/intent-prompt.ts', import.meta.url), 'utf8');
  const online = readFileSync(new URL('../../server/oracle/prompt.py', import.meta.url), 'utf8');
  // 两边的措辞不同（这边是 markdown 反引号，那边是中文破折号），所以钉**关键词**，
  // 不钉整句。关键词任何一个被删掉，这一侧就不再防那一种偷换。
  const shared = [
    ['600000', '分钟换算成毫秒——少了它，「十分钟」会被折算成一个在上限内的数'],
    ['不许往邻居身上靠', '表里没有的现象（雪、雾、风）会被换成最近的一档'],
    ['永久', '「永久」会被当成「可省略」，于是拿到两分钟'],
  ] as const;
  for (const [needle, why] of shared) {
    assert.ok(offline.includes(needle), `离线提示词没有「${needle}」：${why}`);
    assert.ok(online.includes(needle), `线上提示词没有「${needle}」：${why}`);
  }
});

test('两份提示词都讲「收」那条路，都不许拿 carries 表达减法', () => {
  // 加 `remove` 的那次只改了 schema、wire、rules 三处，两份提示词里那句仍是
  // 「或收回（carries 给 [] 就是两手空空）」——正好在教模型用**整锅换上**
  // 去表达收一件。用户说「收回她的鞋」，模型答 carries:["shoes"]，
  // 她提着的灯跟着消失，而用户只要收鞋。
  //
  // 上面那条 `test_提示词列出每一种世界能执行的命令` 只数命令**名**，
  // args 写成什么样它一声不响。所以形状在这里单独钉，而且两边一起钉——
  // 漂任何一边，离线推演与线上模型就会对同一句话给出不同的世界。
  const offline = readFileSync(new URL('../src/world/intent-prompt.ts', import.meta.url), 'utf8');
  const online = readFileSync(new URL('../../server/oracle/prompt.py', import.meta.url), 'utf8');
  for (const [name, text] of [
    ['离线', offline],
    ['线上', online],
  ] as const) {
    assert.ok(text.includes('remove'), `${name}提示词没讲 remove——模型只会给，不会收`);
    assert.ok(text.includes('整锅换上'), `${name}提示词没说出 carries 是替换——模型会拿它表达减法`);
    // 那一句不许回来：它把「放下一切」说成了「收一件」的办法。
    assert.ok(
      !text.includes('就是两手空空'),
      `${name}提示词还在教 carries: [] 当收一件用`,
    );
  }
});
