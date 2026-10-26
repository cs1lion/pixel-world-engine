/** 镇志抽屉：把 `memory/` 读成一本能翻开的编年史。
 *
 * 票据 #7 的验收原话是「我能读到这座镇子过去发生过什么，像读一本编年史」。
 * 所以这里两件事都得成立：**按时间排**，而且**翻得开**。只有标题一行摘要的
 * 是目录；点不开的目录，人翻两下就走了。
 *
 * 三条纪律，都是这个仓库一贯的：
 *
 * 1. **中文不进 canvas**（SPEC §4.8）。所以这是 DOM 覆盖层，不是 Phaser 文本，
 *    也不用 `no-cjk-canvas` 那道检查去饶它。
 * 2. **不渲染 HTML**。全文是 Markdown 原文，来自服务端读回来的文件。
 *    用 `innerHTML` 就等于把一份文件交给浏览器执行——所以这里只有一个
 *    很小的块解析器，每个字都经 `textContent` 落到 DOM 上。
 * 3. **纯函数负责组数据**，DOM 只负责开关与翻页。可离线单测。
 *
 * 面板不改变仿真：它只读服务端，跟 `debug-panel` 一样。
 */

import type { MemoryEntry, MemoryEntryRow } from '../world/memory-client.ts';
import { MEMORY_TEXT_CHARS } from '../world/memory-client.ts';

/** 第几天的标签。`null` 表示这条记忆没有世界时间，标签就空着，不写「第 undefined 天」。 */
export function dayLabel(day: number | null): string {
  return day === null ? '' : `第 ${day} 天`;
}

/** 种类标签。客户端不决定种类的含义，只把它翻译成人话；认不出的原样显示。 */
const KIND_LABELS: Readonly<Record<string, string>> = {
  event: '事件',
  character: '居民',
  day: '日志',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export interface ChronicleRow {
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly kind: string;
  readonly kindText: string;
  readonly dayText: string;
  /** 世界时间毫秒。排序用它，界面不显示它。 */
  readonly at: number | null;
  /** 这一行是档案里的哪一节。`null` 表示一事一文件，读的时候不用带。 */
  readonly section: string | null;
  /** 第几个世界日。读的时候要原样带回服务端。 */
  readonly day: number | null;
  /** 没有世界时间的排最后。 */
  readonly untimed: boolean;
}

/**
 * 列表 → 行。按世界时间排，同一时刻的按路径（事件序号）。
 *
 * **不按文件名字典序排。** `characters/` 排在 `events/` 前面——那是字典序，
 * 不是任何事发生的顺序，而编年史要的正是顺序。
 *
 * 服务端也排了一遍。这里再排不是为了不信它，是为了让「编年史是按时间排的」
 * 成为一条客户端自己守得住的断言：服务端哪天改了主意，这里会看得出来。
 */
export function chronicleRows(entries: readonly MemoryEntryRow[]): readonly ChronicleRow[] {
  return entries
    .map((entry) => ({
      path: entry.path,
      title: entry.title,
      summary: entry.summary,
      kind: entry.kind,
      kindText: kindLabel(entry.kind),
      dayText: dayLabel(entry.day),
      at: entry.at,
      section: entry.section,
      day: entry.day,
      untimed: entry.at === null,
    }))
    .sort((left, right) => {
      if (left.untimed !== right.untimed) return left.untimed ? 1 : -1;
      if (left.at !== right.at) return (left.at ?? 0) - (right.at ?? 0);
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });
}

// ------------------------------------------------------------------ Markdown

/** 一块内容。每个字段都是已经过 `textContent` 的纯文本，没有 HTML。 */
export type MemoryBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'item'; readonly text: string }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'field'; readonly key: string; readonly value: string };

/**
 * 把一份记忆的 Markdown 切成块。
 *
 * **这不是一个 Markdown 渲染器**，也不打算变成一个：记忆文件只有五种形态
 * （frontmatter、标题、列表、旁注、段落），认不出来的一律当段落——
 * 段落是安全的默认值，它至少把原文原样显示出来。
 *
 * 认得少的代价是「不那么漂亮」，认得多的代价是「多一条能执行代码的路」。
 * 这里选前者。
 *
 * **只有一条循环。** frontmatter 与正文走同一个分类器，区别仅在于
 * 「`键: 值` 这一行算不算字段」。早先分两段写，frontmatter 里认不出的行
 * （YAML 列表的 `- 1`）就被整行丢掉了——而 `evidence` 正是铁律二要的证据链。
 * 丢一行就是丢一个字的原文，那不是排版，是失忆。
 */
export function parseMemoryBlocks(text: string): readonly MemoryBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: MemoryBlock[] = [];
  let paragraph: string[] = [];

  const flush = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') });
    paragraph = [];
  };

  // frontmatter：开头一道 `---` 到下一道 `---`。没有闭合的那一道就整份当正文——
  // 一份手写坏了的文件不该因此少显示几行。
  let close = -1;
  if (lines.length > 0 && lines[0]!.trim() === '---') {
    for (let scan = 1; scan < lines.length; scan += 1) {
      if (lines[scan]!.trim() === '---') {
        close = scan;
        break;
      }
    }
  }

  for (let at = close >= 0 ? 1 : 0; at < lines.length; at += 1) {
    // 收尾那道 `---` 只是边界，不是正文里的分隔线。
    if (at === close) {
      flush();
      continue;
    }
    const stripped = lines[at]!.trim();

    if (stripped === '') {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(stripped);
    if (heading !== null) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(stripped);
    if (item !== null) {
      flush();
      blocks.push({ kind: 'item', text: item[1]!.trim() });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(stripped);
    if (quote !== null) {
      flush();
      blocks.push({ kind: 'quote', text: quote[1]!.trim() });
      continue;
    }
    // 一条分隔线只是排版，不产出块——正文里出现它没有任何信息。
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(stripped)) {
      flush();
      continue;
    }
    // 字段行：frontmatter 里认 ASCII 键，正文里认写面真会写的那三个。
    // 见 `parseField` 与 `parseBodyField`。
    const field = at < close ? parseField(stripped) : parseBodyField(stripped);
    if (field !== null) {
      flush();
      blocks.push(field);
      continue;
    }
    paragraph.push(stripped);
  }
  flush();
  return blocks;
}

/**
 * frontmatter 的 `键: 值`。
 *
 * 值是空的就不当字段：`evidence:` 光有一个键，它的值在下面几行的列表里。
 * 渲染成一个空字段，读的人只会以为文件坏了；当段落留着，列表项还能跟上。
 */
function parseField(line: string): MemoryBlock | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
  if (match === null) return null;
  const value = match[2]!.trim();
  if (value === '') return null;
  return { kind: 'field', key: match[1]!, value };
}

/**
 * 正文里的机器字段行。
 *
 * 写面（`memory/format.py` 的 `render_character` / `_evidence_line`）在每条
 * 记忆的正文开头写出三行：`at:`、`依据：`、`来源：`。它们是这条记忆的出处，
 * 不是人写的话——但**也不是该丢的东西**：铁律二说的正是「每条记忆都带证据链」。
 *
 * 所以这里把它们认成字段，跟 frontmatter 一样压暗一档显示。认不全的代价是
 * 「at: 9000 混在散文里」，认多了的代价是「一句话被拆成键值」——前者每天都在
 * 发生，后者要先有人用英文写记忆。
 *
 * 与 frontmatter 那条分开写，是因为这里要收**全角冒号**：`依据：` 用的是 `：`。
 * 合成一个正则就等于让正文里任何 `词：` 都变成键，那是猜。
 */
const BODY_FIELD = /^(at|依据|来源)\s*[:：]\s*(.*)$/;

function parseBodyField(line: string): MemoryBlock | null {
  const match = BODY_FIELD.exec(line);
  if (match === null) return null;
  const value = match[2]!.trim();
  // 光有一个键没有值是坏行，当普通段落原样显示，不渲染成半截字段。
  if (value === '') return null;
  return { kind: 'field', key: match[1]!, value };
}

/** 抽屉标题上那句话。空目录不该显示「共 0 条」就完了——那读起来像坏了。 */
export function chronicleHeading(count: number): string {
  if (count === 0) return '镇志还空着';
  return `镇志 · 共 ${count} 条`;
}

/** 读一篇时的副标题：第几天 + 种类。没有世界时间就不编一天出来。 */
export function readingSubtitle(row: ChronicleRow): string {
  return [row.dayText, row.kindText].filter((part) => part !== '').join(' · ');
}

// ------------------------------------------------------------------ DOM

export interface ChronicleSources {
  /** 客户端由调用方给，测试可以整个换掉。 */
  readonly client: {
    list(): Promise<
      | { readonly ok: true; readonly value: { readonly entries: readonly MemoryEntryRow[] } }
      | { readonly ok: false; readonly reason: string }
    >;
    /** 读一行。整行传过去：服务端要 `path` 也要 `section` 才回得了那一节。 */
    read(row: MemoryEntryRow): Promise<
      | { readonly ok: true; readonly value: MemoryEntry }
      | { readonly ok: false; readonly reason: string }
    >;
  };
}

export interface ChronicleHandle {
  readonly dispose: () => void;
  readonly isOpen: () => boolean;
  /** 拉开抽屉并读一遍。供测试与顶栏按钮共用。 */
  readonly open: () => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  return node;
}

/**
 * 造一个 DOM 节点。
 *
 * 抽出来只为一样事：让「每个字都走 textContent」这道关能在没有浏览器的环境里被测。
 * 测试注一个假的 `document.createElement`，谁往 `innerHTML` 里写一个字就炸——
 * 而这道关原先只在注释里（「用 innerHTML 就等于把一份文件交给浏览器执行」）。
 */
export type ElementFactory = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
) => HTMLElementTagNameMap[K];

/** 把一块内容变成一个 DOM 节点。每个字都走 textContent。 */
export function blockNode(block: MemoryBlock, create: ElementFactory = element): HTMLElement {
  switch (block.kind) {
    case 'heading': {
      const tag = (`h${Math.min(block.level + 2, 6)}`) as 'h3' | 'h4' | 'h5' | 'h6';
      const node = create(tag, 'chronicle-heading');
      node.textContent = block.text;
      return node;
    }
    case 'item': {
      const node = create('li', 'chronicle-item');
      node.textContent = block.text;
      return node;
    }
    case 'quote': {
      const node = create('blockquote', 'chronicle-quote');
      node.textContent = block.text;
      return node;
    }
    case 'field': {
      const node = create('div', 'chronicle-field');
      const key = create('span', 'chronicle-field-key');
      key.textContent = block.key;
      const value = create('span', 'chronicle-field-value');
      value.textContent = block.value;
      node.append(key, value);
      return node;
    }
    default: {
      const node = create('p', 'chronicle-paragraph');
      // 段内的换行要留得住：记忆的正文常常一段一句，压成一行就没了呼吸。
      node.textContent = block.text;
      return node;
    }
  }
}

export function bindChronicle(sources: ChronicleSources): ChronicleHandle {
  const drawer = document.querySelector<HTMLElement>('#chronicle');
  const listButton = document.querySelector<HTMLButtonElement>('#chronicle-open');
  const closeButton = document.querySelector<HTMLButtonElement>('#chronicle-close');
  const backButton = document.querySelector<HTMLButtonElement>('#chronicle-back');
  const refreshButton = document.querySelector<HTMLButtonElement>('#chronicle-refresh');
  const heading = document.querySelector<HTMLElement>('#chronicle-heading');
  const listPane = document.querySelector<HTMLElement>('#chronicle-list');
  const readerPane = document.querySelector<HTMLElement>('#chronicle-reader');
  const readerTitle = document.querySelector<HTMLElement>('#chronicle-reader-title');
  const readerSubtitle = document.querySelector<HTMLElement>('#chronicle-reader-subtitle');
  const readerBody = document.querySelector<HTMLElement>('#chronicle-reader-body');

  const missing =
    drawer === null ||
    heading === null ||
    listPane === null ||
    readerPane === null ||
    readerTitle === null ||
    readerSubtitle === null ||
    readerBody === null;
  if (missing) {
    // 缺一块就整个不装：装一半的抽屉比没有抽屉更糟——它会安静地不干活。
    return { dispose: () => {}, isOpen: () => false, open: () => {} };
  }

  let rows: readonly ChronicleRow[] = [];
  let open = false;
  let loading = false;

  const setOpen = (next: boolean): void => {
    open = next;
    drawer.hidden = !next;
    listButton?.setAttribute('aria-expanded', String(next));
  };

  const paintList = (): void => {
    heading.textContent = chronicleHeading(rows.length);
    listPane.replaceChildren();
    if (rows.length === 0) {
      const empty = element('p', 'chronicle-empty');
      empty.textContent = '还没有人记下什么。世界自己跑着，观测到了就会落下来。';
      listPane.append(empty);
      return;
    }
    for (const row of rows) {
      const item = element('button', 'chronicle-row');
      item.type = 'button';
      item.dataset.chroniclePath = row.path;
      const title = element('span', 'chronicle-row-title');
      title.textContent = row.title;
      const meta = element('span', 'chronicle-row-meta');
      meta.textContent = [row.dayText, row.kindText].filter((part) => part !== '').join(' · ');
      const summary = element('span', 'chronicle-row-summary');
      summary.textContent = row.summary;
      item.append(meta, title, summary);
      item.addEventListener('click', () => {
        void readEntry(row);
      });
      listPane.append(item);
    }
  };

  const paintReader = (title: string, subtitle: string, blocks: readonly MemoryBlock[]): void => {
    readerTitle.textContent = title;
    readerSubtitle.textContent = subtitle;
    readerBody.replaceChildren(...blocks.map((block) => blockNode(block)));
  };

  const showList = (): void => {
    readerPane.hidden = true;
    listPane.hidden = false;
    // 「返回」只在读一篇时出现。列表上放一个回不去的返回键，是骗人。
    if (backButton !== null) backButton.hidden = true;
  };

  const showReader = (): void => {
    listPane.hidden = true;
    readerPane.hidden = false;
    if (backButton !== null) backButton.hidden = false;
  };

  const load = async (): Promise<void> => {
    if (loading) return;
    loading = true;
    heading.textContent = '镇志正在翻…';
    const result = await sources.client.list();
    loading = false;
    if (!result.ok) {
      rows = [];
      paintList();
      heading.textContent = `读不到镇志：${result.reason}`;
      return;
    }
    rows = chronicleRows(result.value.entries);
    showList();
    paintList();
  };

  const readEntry = async (row: ChronicleRow): Promise<void> => {
    showReader();
    readerTitle.textContent = row.title;
    readerSubtitle.textContent = readingSubtitle(row);
    readerBody.replaceChildren();
    const pending = element('p', 'chronicle-paragraph');
    pending.textContent = '正在翻开…';
    readerBody.append(pending);

    // 整行传过去：服务端要 `section` 才知道该回哪一节。
    // 只传 path 的话，居民档案会整本翻开，而列表答应的是那一条。
    const result = await sources.client.read({
      kind: row.kind,
      title: row.title,
      path: row.path,
      section: row.section,
      summary: row.summary,
      at: row.at,
      day: row.day,
    });
    if (!result.ok) {
      paintReader(row.title, readingSubtitle(row), [
        { kind: 'paragraph', text: `翻不开这一页：${result.reason}` },
      ]);
      return;
    }
    // 截断了就要说出来。静默截断的表现是「这条记忆就这么长」——
    // 读者无从知道后面还有，而一份被悄悄切短的档案，读起来像一份写完了的档案。
    const blocks = parseMemoryBlocks(result.value.text);
    const shown = result.value.truncated
      ? [
          ...blocks,
          {
            kind: 'paragraph' as const,
            text: `这一页只读到前 ${MEMORY_TEXT_CHARS} 字，后面还有。档案是逐条追加的，原文在 memory/ 里。`,
          },
        ]
      : blocks;
    paintReader(result.value.title, readingSubtitle(row), shown);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) return;
    // 读一篇时 Esc 先回列表，再按才关抽屉——不然一页没看完就整个没了。
    if (!readerPane.hidden) {
      showList();
      return;
    }
    setOpen(false);
  };

  listButton?.addEventListener('click', () => {
    setOpen(!open);
    if (open) void load();
  });
  closeButton?.addEventListener('click', () => setOpen(false));
  backButton?.addEventListener('click', () => showList());
  refreshButton?.addEventListener('click', () => {
    void load();
  });
  document.addEventListener('keydown', onKey);

  return {
    dispose: () => {
      document.removeEventListener('keydown', onKey);
    },
    isOpen: () => open,
    open: () => {
      setOpen(true);
      void load();
    },
  };
}
