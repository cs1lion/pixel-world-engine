import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindChronicle,
  blockNode,
  chronicleHeading,
  chronicleRows,
  dayLabel,
  kindLabel,
  parseMemoryBlocks,
  readingSubtitle,
  type ElementFactory,
} from '../src/ui/chronicle-panel.ts';
import type { MemoryEntryRow } from '../src/world/memory-client.ts';
import type { MemoryBlock } from '../src/ui/chronicle-panel.ts';

/** 取一块的正文。frontmatter 字段没有 text（它 key/value 分开），所以这里要收窄。 */
const textOf = (block: MemoryBlock | undefined): string =>
  block !== undefined && 'text' in block ? block.text : '';

const entry = (extra: Partial<MemoryEntryRow> = {}): MemoryEntryRow => ({
  kind: 'event',
  title: '渡口的第一夜',
  path: 'events/E0001-渡口的第一夜.md',
  summary: '我在旧站牌下点了一盏灯。',
  at: 1500,
  day: 0,
  section: null,
  ...extra,
});

// ------------------------------------------------------------------ 标签

test('第几天与种类都翻成人话', () => {
  assert.equal(dayLabel(0), '第 0 天');
  assert.equal(dayLabel(7), '第 7 天');
  // 没有世界时间就不编一天出来。
  assert.equal(dayLabel(null), '');
  assert.equal(kindLabel('event'), '事件');
  assert.equal(kindLabel('character'), '居民');
  assert.equal(kindLabel('day'), '日志');
  // 认不出的种类原样显示，不猜它是谁。
  assert.equal(kindLabel('miracle'), 'miracle');
});

test('空目录不说「共 0 条」', () => {
  // 那读起来像坏了，不像「还没有」。
  assert.equal(chronicleHeading(0), '镇志还空着');
  assert.equal(chronicleHeading(3), '镇志 · 共 3 条');
});

test('副标题把空的那一半去掉', () => {
  assert.equal(readingSubtitle(chronicleRows([entry()])[0]!), '第 0 天 · 事件');
  assert.equal(readingSubtitle(chronicleRows([entry({ day: null, at: null })])[0]!), '事件');
});

// ------------------------------------------------------------------ 排序

test('按世界时间排，不按文件名字典序', () => {
  // `characters/` 排在 `events/` 前面——那是字典序，不是事情发生的顺序。
  // 阿雨那件事发生在 9000，比两件「夜」都晚，所以她在最后。
  const rows = chronicleRows([
    entry({ path: 'characters/阿雨.md', kind: 'character', title: '阿雨', at: 9000, day: 0 }),
    entry({ path: 'events/E0002-第二夜.md', title: '第二夜', at: 4200, day: 0 }),
    entry({ path: 'events/E0001-渡口的第一夜.md', at: 1500, day: 0 }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ['渡口的第一夜', '第二夜', '阿雨'],
  );
});

test('同一天里按路径排，也就是按事件序号', () => {
  const rows = chronicleRows([
    entry({ path: 'events/E0003-丙.md', title: '丙' }),
    entry({ path: 'events/E0001-甲.md', title: '甲' }),
    entry({ path: 'events/E0002-乙.md', title: '乙' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ['甲', '乙', '丙'],
  );
});

test('没有世界时间的排在最后，不猜它是几点', () => {
  const rows = chronicleRows([
    entry({ path: 'events/E0009-手写的.md', title: '手写的', at: null, day: null }),
    entry({ path: 'events/E0001-第一夜.md', title: '第一夜' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ['第一夜', '手写的'],
  );
  assert.equal(rows[1]!.dayText, '');
  assert.equal(rows[1]!.untimed, true);
});

// ------------------------------------------------------------------ Markdown

test('一份记忆被切成它本来的那几种块', () => {
  const text = [
    '---',
    'kind: event',
    'id: E0001',
    'at: 1500',
    '---',
    '',
    '# 渡口的第一夜',
    '',
    '依据：#1 `world.changed`',
    '来源：direct_observation',
    '',
    '我在旧站牌下点了一盏灯。',
    '她把伞留在了渡口。',
    '',
    '- 潮水退了',
    '- 楼盖了起来',
    '',
    '> 单人档案。逐条追加，只增不改。',
  ].join('\n');

  const blocks = parseMemoryBlocks(text);
  assert.deepEqual(
    blocks.map((block) => block.kind),
    // frontmatter 三行是字段；正文开头那三行机器字段也是字段——
    // 「依据：」「来源：」「at:」是这条记忆的出处，不是人写的话，
    // 但也不是该丢的东西（铁律二要的正是证据链）。
    [
      'field', 'field', 'field',
      'heading',
      'field', 'field',
      'paragraph', 'item', 'item', 'quote',
    ],
  );
  assert.deepEqual(blocks[0], { kind: 'field', key: 'kind', value: 'event' });
  assert.deepEqual(blocks[3], { kind: 'heading', level: 1, text: '渡口的第一夜' });
  assert.deepEqual(blocks[4], { kind: 'field', key: '依据', value: '#1 `world.changed`' });
  assert.deepEqual(blocks[5], { kind: 'field', key: '来源', value: 'direct_observation' });
  // 段内的换行要留住：一句一行是记忆正文的呼吸。
  assert.equal(textOf(blocks[6]), '我在旧站牌下点了一盏灯。'
    + '\n她把伞留在了渡口。');
  assert.deepEqual(blocks[7], { kind: 'item', text: '潮水退了' });
  assert.deepEqual(blocks[9], { kind: 'quote', text: '单人档案。逐条追加，只增不改。' });
});

test('居民档案的一节里，机器字段行也是字段', () => {
  // `render_character` 在每条记忆的正文开头写 at / 依据 / 来源。
  // 混在散文里读就是「at: 9000」这么一句机器话。
  const blocks = parseMemoryBlocks([
    '---',
    'kind: character',
    'subject: 莞尔',
    'at: 9000',
    '---',
    '',
    '# 莞尔',
    '',
    '## 她记得那场雨',
    '',
    'at: 9000',
    '依据：#1 `world.changed`',
    '来源：direct_observation',
    '她记得那场雨。',
  ].join('\n'));
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['field', 'field', 'field', 'heading', 'heading', 'field', 'field', 'field', 'paragraph'],
  );
  assert.deepEqual(blocks[5], { kind: 'field', key: 'at', value: '9000' });
  assert.deepEqual(blocks[6], { kind: 'field', key: '依据', value: '#1 `world.changed`' });
  assert.deepEqual(blocks[7], { kind: 'field', key: '来源', value: 'direct_observation' });
  assert.equal(textOf(blocks[8]), '她记得那场雨。');
});

test('frontmatter 的列表值一个都不丢', () => {
  // 事件的 frontmatter 把 evidence 写成 YAML 列表：
  //
  //     evidence:
  //     - 1
  //
  // 早先只认 `键: 值`，于是 `- 1` 整行被丢掉——而 evidence 正是铁律二要的
  // 证据链。表现是在阅读器里「依据」还在、它引用的那串 id 却没了。
  const blocks = parseMemoryBlocks([
    '---',
    'kind: event',
    'evidence:',
    '- 1',
    'evidenceKinds:',
    '- world.changed',
    '---',
    '',
    '# 甲',
  ].join('\n'));
  const texts = blocks.map((block) => textOf(block));
  assert.ok(texts.includes('1'), `事件 id 不该丢：${JSON.stringify(blocks)}`);
  assert.ok(texts.includes('world.changed'), `事件种类不该丢：${JSON.stringify(blocks)}`);
  // 光有键没有值的那两行也不是垃圾：它们说明下面几行属于谁。
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['field', 'paragraph', 'item', 'paragraph', 'item', 'heading'],
  );
});

test('认不出的行当段落——那是安全的默认值', () => {
  // 一个不认识的记号至少该把原文原样显示出来，不该被吞掉。
  const blocks = parseMemoryBlocks('| 甲 | 乙 |\n|---|---|\n| 1 | 2 |');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.kind, 'paragraph');
  assert.match(blocks[0]!.text, /甲/);
});

test('机器字段行只认写面真会写的那三个', () => {
  // 「他说：今天下雨」不是机器字段——中文冒号不该让任何一句话变成键值。
  // 猜的代价是正文被拆碎，而猜错的表现在界面上只是「排版怪」。
  const blocks = parseMemoryBlocks('他说：今天下雨\n\nNote: 带伞');
  assert.deepEqual(blocks.map((block) => block.kind), ['paragraph', 'paragraph']);
  assert.equal(textOf(blocks[0]), '他说：今天下雨');
  // 光有键没有值是坏行，原样当段落，不渲染成半截字段。
  const broken = parseMemoryBlocks('依据：');
  assert.equal(broken.length, 1);
  assert.equal(broken[0]!.kind, 'paragraph');
});

test('正文里的分隔线只是排版，不产出块', () => {
  const blocks = parseMemoryBlocks('# 标题\n\n上文\n\n---\n\n下文');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['heading', 'paragraph', 'paragraph'],
  );
});

test('没有 frontmatter 也从第一行正文开始', () => {
  const blocks = parseMemoryBlocks('# 手写的\n\n没有 frontmatter。');
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ['heading', 'paragraph'],
  );
});

test('开头一道分隔线不会被误当成 frontmatter', () => {
  // 第一行不是 `---`，所以后面那条只是正文里的排版。
  const blocks = parseMemoryBlocks('上文\n\n---\n\n下文');
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((block) => block.kind === 'paragraph'));
});

test('空文件与只有空行的文件都翻得出空列表', () => {
  assert.deepEqual(parseMemoryBlocks(''), []);
  assert.deepEqual(parseMemoryBlocks('\n\n\n'), []);
});

test('块里没有任何一处是 HTML：原文只是数据', () => {
  // 这是整份抽屉的地基：渲染层每个字都走 textContent（`blockNode` 五个分支），
  // 所以一个 <script> 都进不来。解析层**不消毒**——消毒会把读者的记忆改掉，
  // 而记忆是只增不改的。这里钉的是「解析层把原文原样当数据交出来」。
  //
  // 早先这条写的是 `doesNotMatch(joined, /onerror=alert\(1\)"\]/)`：
  // `JSON.stringify` 出来的块里 `)` 后面紧跟的是 `>`，不是 `"]`，
  // 所以那个正则永远不匹配、断言永远通过——换成任何会把 HTML 原样吐进块文本的
  // 实现，它照样绿。防 HTML 的那道关在渲染层，由下面一条钉。
  const blocks = parseMemoryBlocks('# <img src=x onerror=alert(1)>\n\n<script>alert(2)</script>');
  assert.equal(textOf(blocks[0]), '<img src=x onerror=alert(1)>');
  assert.equal(textOf(blocks[1]), '<script>alert(2)</script>');
  // 「没有 html 这种块」不用运行时断言：`MemoryBlock` 的联合里就没有它，
  // tsc 会以「两个类型没有交集」直接拒掉那条比较——那本身就是证明。
});

test('每个字都走 textContent：谁写 innerHTML 就炸', () => {
  // 上面那条管「解析层不消毒」，这条管「渲染层不执行」。
  // 抽屉的全文来自服务端读回来的 Markdown 文件——那是磁盘上的字，
  // 不是本应用写的。`blockNode` 有一个分支漏成 innerHTML，
  // 一份手写的记忆就能在整个镇志里跑脚本。
  //
  // 用一个假 document 钉住：innerHTML / outerHTML / insertAdjacentHTML
  // 三个写入口都是 setter，谁碰谁抛。五种块各走一遍。
  const made: FakeNode[] = [];
  const fake = ((tag: string, className?: string) => {
    const node = new FakeNode(tag, className ?? '');
    made.push(node);
    return node;
  }) as unknown as ElementFactory;

  const source = [
    '# <img src=x onerror=alert(1)>',
    '',
    '依据：#1 `world.changed`',
    '',
    '> 旁注里也带 <script>alert(2)</script>',
    '',
    '- 列表项带 <b>标记</b>',
    '',
    '正文最后一句。',
  ].join('\n');
  for (const block of parseMemoryBlocks(source)) blockNode(block, fake);

  assert.ok(made.length >= 6, '五种块都该造出节点来');
  const has = (needle: string): boolean => made.some((node) => node.textContent.includes(needle));
  // 原文一个字都没丢——它只是不再是标记。
  assert.ok(has('<img src=x onerror=alert(1)>'), '标题原文要在这儿');
  assert.ok(has('<script>alert(2)</script>'), '旁注原文要在这儿');
  assert.ok(has('列表项带 <b>标记</b>'), '列表项原文要在这儿');
  assert.ok(has('world.changed'), '字段原文要在这儿');
  assert.ok(has('正文最后一句。'), '正文原文要在这儿');
  // 孩子们全是造出来的节点：没有一个是把上面的字符串当 HTML 解析出来的。
  assert.ok(
    made.every((node) => node.children.every((kid) => kid instanceof FakeNode)),
    '孩子们只能是造出来的节点',
  );
});

/** 一个只认 textContent / append / className 的假节点。三个 HTML 写入口都是 setter。 */
class FakeNode {
  textContent = '';
  readonly children: FakeNode[] = [];
  readonly tagName: string;
  readonly className: string;

  constructor(tag: string, className: string) {
    this.tagName = tag;
    this.className = className;
  }

  append(...kids: FakeNode[]): void {
    this.children.push(...kids);
  }

  set innerHTML(value: string) {
    throw new Error(`innerHTML 被写了：${value}`);
  }

  set outerHTML(value: string) {
    throw new Error(`outerHTML 被写了：${value}`);
  }

  insertAdjacentHTML(_position: string, value: string): void {
    throw new Error(`insertAdjacentHTML 被写了：${value}`);
  }
}

test('frontmatter 里的值原样留着，不当成标记', () => {
  const blocks = parseMemoryBlocks('---\ntitle: <b>加粗</b>\n---\n\n正文');
  assert.deepEqual(blocks[0], { kind: 'field', key: 'title', value: '<b>加粗</b>' });
});


// ---------------------------------------------- 生产那条渲染路也要过这道关

/** 一个只会 textContent / append / addEventListener 的假元素。三个 HTML 写入口都是 setter。 */
class FakeElement {
  textContent = '';
  type = '';
  hidden = false;
  readonly dataset: Record<string, string> = {};
  readonly kids: FakeElement[] = [];
  readonly listeners: (() => void)[] = [];

  readonly tag: string;
  readonly className: string;

  constructor(tag: string, className: string) {
    this.tag = tag;
    this.className = className;
  }

  append(...nodes: FakeElement[]): void {
    this.kids.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.kids.length = 0;
    this.kids.push(...nodes);
  }

  addEventListener(_kind: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  setAttribute(): void {}

  set innerHTML(value: string) {
    throw new Error(`innerHTML 被写了：${value}`);
  }

  set outerHTML(value: string) {
    throw new Error(`outerHTML 被写了：${value}`);
  }

  insertAdjacentHTML(_position: string, value: string): void {
    throw new Error(`insertAdjacentHTML 被写了：${value}`);
  }
}

/** 一份够用的假 document。`pane` 取某个钩子上的元素，好过从 `made` 里猜第一个。 */
function fakeDocument(body: FakeElement): {
  pane(selector: string): FakeElement;
  querySelector(selector: string): FakeElement;
  addEventListener(): void;
  removeEventListener(): void;
} {
  const cache = new Map<string, FakeElement>();
  const nodeFor = (selector: string): FakeElement => {
    if (selector === '#chronicle-reader-body') return body;
    let node = cache.get(selector);
    if (node === undefined) {
      node = new FakeElement('div', selector);
      cache.set(selector, node);
    }
    return node;
  };
  return {
    pane: nodeFor,
    querySelector: nodeFor,
    addEventListener(): void {},
    removeEventListener(): void {},
  };
}

const NEEDLES = ['<img src=x onerror=alert(1)>', '<script>alert(2)</script>'];

test('真机那条渲染路也走注进来的 factory：列表与读者两处都是', async () => {
  // 上面那条只测了 `blockNode` 本身。`bindChronicle` 原先两处都调默认 factory
  // （`paintList` 用 `element()`，`paintReader` 用 `blockNode(block)`），
  // 于是真机上渲染的那条路没有任何守卫——而抽屉里的每个字都来自服务端
  // 读回来的 Markdown 文件，那是磁盘上的字，不是本应用写的。
  //
  // 这条把假 document 和假 factory 一起注进去，走完「开抽屉 → 点开一篇」。
  // 谁在那两处里写 innerHTML，这里就炸。
  const made: FakeElement[] = [];
  const fake = ((tag: string, className?: string) => {
    const node = new FakeElement(tag, className ?? '');
    made.push(node);
    return node;
  }) as unknown as ElementFactory;
  const readerBody = new FakeElement('div', 'chronicle-reader-body');
  const original = globalThis.document;
  const doc = fakeDocument(readerBody);
  globalThis.document = doc as unknown as Document;

  try {
    const rows: MemoryEntryRow[] = [
      {
        kind: 'event',
        title: NEEDLES[0]!,
        path: 'events/E0001-渡口的第一夜.md',
        summary: NEEDLES[1]!,
        at: 1500,
        day: 0,
        section: null,
      },
    ];
    const handle = bindChronicle({
      client: {
        list: async () => ({ ok: true, value: { entries: rows } }),
        read: async () => ({
          ok: true,
          value: {
            title: NEEDLES[0]!,
            path: 'events/E0001-渡口的第一夜.md',
            section: null,
            kind: 'event',
            text: `# ${NEEDLES[0]!}\n\n> 旁注里也带 ${NEEDLES[1]!}`,
            truncated: false,
          },
        }),
      },
      create: fake,
    });

    handle.open();
    // 让 `load()` 那个 await 落地。
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 列表那一处：标题与摘要都是服务端来的字，必须经过假 factory。
    assert.ok(
      made.some((node) => node.textContent === NEEDLES[0]),
      '列表标题该走注进来的 factory',
    );
    assert.ok(
      made.some((node) => node.textContent === NEEDLES[1]),
      '列表摘要该走注进来的 factory',
    );

    // 点开那一行，读者那几块渲染。列表窗格是 `#chronicle-list` 那个钩子，
    // 不是 `made` 里第一个造出来的节点——第一个是标题那句「镇志 · 共 1 条」。
    const listPane = doc.pane('#chronicle-list');
    const row = listPane.kids.find((kid) => kid.className === 'chronicle-row');
    assert.ok(row !== undefined, '列表里该有一行');
    row.listeners[0]!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 读者那处：正文块也走同一个 factory，原文一个字都没丢。
    assert.ok(
      made.some((node) => node.textContent.includes(NEEDLES[0]!)),
      '读者标题该走注进来的 factory',
    );
    assert.ok(
      made.some((node) => node.textContent.includes(NEEDLES[1]!)),
      '读者旁注该走注进来的 factory',
    );
    // 没有一个是把上面的字符串当 HTML 解析出来的。
    assert.ok(
      made.every((node) => node.kids.every((kid) => kid instanceof FakeElement)),
      '孩子们只能是造出来的节点',
    );
  } finally {
    globalThis.document = original;
  }
});
