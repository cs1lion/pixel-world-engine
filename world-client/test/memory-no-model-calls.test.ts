/**
 * 记忆层的零模型调用红线：一道**源码**闸，不是数据闸。
 *
 * ## 今天守这条红线的两道闸，守的都不是它
 *
 * 「写入/回忆/传播路径保持零模型调用」是本组的第一条成本红线。今天有两处
 * 看起来在守它：
 *
 * - `test/creator-config.test.ts:235` 断言
 *   `PROPAGATION_CHANNEL_CONFIG…dailyPropagationCost.llmCalls === 0`——断言的是
 *   **一个配置常量等于 0**。常量是 0，代码照样可以 `fetch`。
 * - `test/memory-protocol.test.ts` 断言某条断言的 `generatedBy.by === 'rule'`——
 *   断言的是**一条路径上一次运行的结果**。
 *
 * 两道都是数据闸：它们只覆盖被跑到的那些分支。往 `src/world/memory/propagate.ts`
 * 里加一个没人调用的 `fetch`，两道闸一条都不会响。
 *
 * ## 实测（2026-10-28）
 *
 * 往 `propagate.ts` 末尾追加
 *
 * ```ts
 * export function __probeModelCall(): Promise<Response> {
 *   return fetch("https://api.example.invalid/v1/messages");
 * }
 * ```
 *
 * 跑全量：**1666 项 1 失败**，而那 1 项是 `audit-references` 里别人正在改的
 * 一处引用，与这次注入无关。也就是说注入前后测试结果一模一样——**这条红线
 * 今天没有任何东西守着**。
 *
 * ## 这道闸怎么补
 *
 * 按**源码**扫 `src/world/memory/`：那里不许出现联网或调模型的写法。
 * 词表在下面，每一条都带「为什么它算违约」。
 *
 * 已知边界，不假装补上：`const f = globalThis['fe'+'tch']` 这种拼出来的名字扫不到。
 * 那是词级扫描的天花板——真要靠一道闸拦住它，得在构建期做标识符解析。
 * 这道闸拦的是**顺手写下一个 `fetch`**，不是拦一个存心绕开的人。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codeLinesText, codeText, sourceFiles, srcRelative } from './source-scan.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEMORY_DIR = `${ROOT}src/world/memory`;

interface Marker {
  readonly name: string;
  /** 在**代码**上匹配（注释与字符串已挖空）。 */
  readonly code?: RegExp;
  /** 在**含字符串的行**上匹配——import 的模块名本身就在字符串里。 */
  readonly importFrom?: RegExp;
  readonly why: string;
}

/**
 * 违约写法。
 *
 * 两条通道分开：`code` 走 `codeOf`（字符串挖空，这样注释里写一句「这里不许
 * `fetch`」不会把自己判红）；`importFrom` 走 `codeLines`（**字符串原样留着**，
 * 否则 `from 'openai'` 会被挖成 `from '      '`，正则永远不命中——这正是
 * `source-scan.ts` 记着的那个坑）。
 */
const MARKERS: readonly Marker[] = [
  {
    name: 'fetch',
    code: /\bfetch\b/,
    why: '联网取数。记忆层的每一条都必须来自世界事件，不能来自网络。',
  },
  {
    name: 'XMLHttpRequest',
    code: /\bXMLHttpRequest\b/,
    why: '另一条联网通道，绕开 fetch 也一样违约。',
  },
  {
    name: 'WebSocket',
    code: /\bWebSocket\b/,
    why: '长连接同样是把世界外的数据接进记忆层。',
  },
  {
    name: 'EventSource',
    code: /\bnew\s+EventSource\b/,
    why: '服务端推送。注意只匹配 `new EventSource`：`types.ts` 里有个同名的领域类型，裸词会误伤。',
  },
  {
    name: 'sendBeacon',
    code: /\bsendBeacon\b/,
    why: '发出去也算：记忆层不该有对外写的通道。',
  },
  {
    name: 'dynamic import',
    code: /\bimport\s*\(/,
    why: '动态 import 能把一个模型 SDK 藏在一行里，静态 import 的禁令看不见它。',
  },
  {
    name: 'model SDK',
    importFrom: /from\s+['"](openai|@anthropic-ai\/[^'"]*|@google\/genai|cohere-ai|replicate|ollama|@langchain\/[^'"]*)['"]/,
    why: '模型 SDK 的 import。静态 import 禁令覆盖不到动态拼的路径，但这一条至少拦得住照抄文档的那一行。',
  },
  {
    name: 'node:http',
    importFrom: /from\s+['"]node:(http|https|net|dgram)['"]/,
    why: '底层网络模块。浏览器里跑不到，写进来就说明这一层被当成服务端用了。',
  },
];

interface Violation {
  readonly file: string;
  readonly marker: string;
  readonly line: number;
}

/** 扫一段源码原文，返回命中的行。 */
export function violationsIn(raw: string, file = '<snippet>'): Violation[] {
  const codeRows = codeText(raw).split('\n');
  const importRows = codeLinesText(raw).split('\n');
  const out: Violation[] = [];
  for (const marker of MARKERS) {
    for (let index = 0; index < codeRows.length; index += 1) {
      if (marker.code?.test(codeRows[index]) === true) {
        out.push({ file, marker: marker.name, line: index + 1 });
      } else if (marker.importFrom?.test(importRows[index]) === true) {
        out.push({ file, marker: marker.name, line: index + 1 });
      }
    }
  }
  return out;
}

test('记忆层里没有联网、没有调模型：一处都没有', () => {
  const hits: Violation[] = [];
  for (const file of sourceFiles(MEMORY_DIR)) {
    hits.push(...violationsIn(readFileSync(file, 'utf8'), srcRelative(file, `${ROOT}src`)));
  }
  assert.deepEqual(
    hits,
    [],
    '记忆层出现了联网或调模型的写法。零模型调用是内环的成本红线——'
      + '要接上游，走 `ingestUpstream` 的事件入口，不要在记忆层里自己发请求。',
  );
});

test('词表每一条都真的会响：拿一行最小样本逐个验', () => {
  // 「一道从来没响过的闸等于没有」——这张表就是那种闸的高危区：
  // 正则写错一个字，它永远不命中，而它守的东西照旧没人管。
  const samples: readonly (readonly [string, string])[] = [
    ['fetch', 'const r = fetch(url);'],
    ['fetch', 'const f = fetch;'],
    ['XMLHttpRequest', 'const x = new XMLHttpRequest();'],
    ['WebSocket', 'const ws = new WebSocket(url);'],
    ['EventSource', 'const es = new EventSource(url);'],
    ['sendBeacon', 'navigator.sendBeacon(url, body);'],
    ['dynamic import', "const m = await import('./model.ts');"],
    ['model SDK', "import Anthropic from '@anthropic-ai/sdk';"],
    ['model SDK', "import OpenAI from 'openai';"],
    ['node:http', "import { request } from 'node:https';"],
  ];
  for (const [marker, source] of samples) {
    const hits = violationsIn(source);
    assert.ok(
      hits.some((hit) => hit.marker === marker),
      `词表里的「${marker}」没能命中样本 ${JSON.stringify(source)}——这条禁令是空的`,
    );
  }
});

test('注释和字符串里的同名词不算违约：否则这道闸会把自己的说明判红', () => {
  // 这条不是形式主义。本文件与 `runtime.ts`、`recall.ts` 的注释里都会写到
  // 「不许 fetch」这几个字；一道把注释也算上的闸，第一件事就是红在自己身上，
  // 而修它的办法只有删掉说明——那正是最坏的结局。
  const harmless = [
    '// 记忆层不许 fetch，要接上游走 ingestUpstream',
    '/* 这里从前有个 fetch，删了 */',
    'const label = "fetch";',
    "const path = 'openai';",
    'const name = `EventSource`;',
  ];
  for (const source of harmless) {
    assert.deepEqual(violationsIn(source), [], `这句不该被判红：${source}`);
  }
});

test('`new EventSource` 会响，而 `EventSource` 这个领域类型不会', () => {
  // `src/world/memory/types.ts:16` 有 `export type EventSource = 'agent' | 'world' | ...`。
  // 裸词匹配会把它判红，于是唯一的修法是给领域类型改名——那是让闸改代码，
  // 而不是让代码过闸。所以只认 `new EventSource`。
  assert.deepEqual(violationsIn("export type EventSource = 'agent' | 'world';"), []);
  assert.ok(violationsIn('const es = new EventSource(url);').length > 0);
});
