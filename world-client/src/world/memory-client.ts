/** 记忆客户端：把编年史读进浏览器。
 *
 * 与 `events-client.ts` 同一套纪律，因为面对的是同一个服务端：
 *   - 只做运输与形状校验，不判断一条记忆该排在哪里（那是编年史面板的事）；
 *   - 不重试。记忆是只增的，重试没有副作用，但会让「这一刻读到了什么」
 *     变得不确定；
 *   - **失败返回失败，不抛异常**。读失败只是「这一拍没翻开」，
 *     不该让整个界面停摆。
 *
 * 与事件客户端有一处根本不同：这里是**读面**，没有写。写入走
 * `POST /api/memory/write`，而那条路收的是「已经观测到的事」——
 * 由世界自己或转述观测的调用方发起，不该由界面上的一个按钮发起。
 * 所以这个客户端只有 `list()` 与 `read()`。
 *
 * 中文不进 canvas（SPEC §4.8），所以编年史是 DOM 覆盖层，不是 Phaser 文本。
 */

/** 一条记忆在列表里的样子。`kind` 故意不收紧成联合：客户端不决定种类的含义。 */
export interface MemoryEntryRow {
  readonly kind: string;
  readonly title: string;
  /** 相对 `memory/` 的路径。读全文时原样传回，客户端不解析它。 */
  readonly path: string;
  /**
   * 这一行是档案里的哪一节。事件与每日快照是 `null`（一事一文件）；
   * 居民档案里一个 `## ` 就是一条记忆，所以一行一节。
   *
   * 读的时候原样传回：列表答应的是一条记忆，点开它就该读到那一条。
   */
  readonly section: string | null;
  readonly summary: string;
  /** 世界时间毫秒。没有 frontmatter 的记忆是 `null`，客户端不替它猜一个。 */
  readonly at: number | null;
  /**
   * 第几个世界日。由服务端算，客户端不自己除一遍——「一天有多长」这个常数
   * 在两边各写一份，迟早有一边忘了改，而那一错的表现是「同一天的记忆被拆成两天」。
   */
  readonly day: number | null;
}

export interface MemoryListPage {
  readonly entries: readonly MemoryEntryRow[];
  readonly count: number;
}

/** 一份记忆的全文。`text` 是 Markdown 原文。 */
export interface MemoryEntry {
  readonly path: string;
  readonly section: string | null;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
}

export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

export const MEMORY_LIST_URL = '/api/memory/list';
export const MEMORY_ENTRY_URL = '/api/memory/entry';

/** 单次读取超时。编年史是人翻开的一次动作，等太久不如先告诉他没读到。 */
export const MEMORY_TIMEOUT_MS = 5000;

/** 摘要里最多留多少字。服务端也截（120），这里再截一次是为了防御—— */
/** 服务端换了上限时，界面不该跟着变形。 */
export const MEMORY_SUMMARY_CHARS = 120;

/** 全文上限。一份角色档案会越写越长，而抽屉里看得过来的只有这么多。 */
export const MEMORY_TEXT_CHARS = 20000;

export interface MemoryClient {
  /** 列一遍记忆。任何失败都落到 `ok: false`。 */
  list(): Promise<MemoryResult<MemoryListPage>>;
  /** 读一份记忆的全文。`row` 必须是 `list()` 给回来的那一行，原样传。 */
  read(row: MemoryEntryRow): Promise<MemoryResult<MemoryEntry>>;
}

export interface MemoryClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** 测试注入：便于断言请求地址。 */
  readonly listUrl?: string;
  readonly entryUrl?: string;
}

export function createMemoryClient(options: MemoryClientOptions = {}): MemoryClient {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? MEMORY_TIMEOUT_MS;
  const listUrl = options.listUrl ?? MEMORY_LIST_URL;
  const entryUrl = options.entryUrl ?? MEMORY_ENTRY_URL;

  return {
    async list(): Promise<MemoryResult<MemoryListPage>> {
      const outcome = await getJson(fetchImpl, listUrl, timeoutMs, '记忆目录');
      if (!outcome.ok) return outcome;
      const parsed = parseList(outcome.body);
      if (parsed === null) {
        return { ok: false, reason: '记忆目录响应形状不对', status: outcome.status };
      }
      return { ok: true, value: parsed };
    },

    async read(row: MemoryEntryRow): Promise<MemoryResult<MemoryEntry>> {
      if (typeof row.path !== 'string' || row.path.trim() === '') {
        return { ok: false, reason: '没说读哪一份记忆', status: null };
      }
      const query = new URLSearchParams({ path: row.path });
      // 小节名也原样带回去：列表答应的是一条记忆，服务端据此只回那一节。
      if (row.section !== null) query.set('section', row.section);
      const outcome = await getJson(fetchImpl, `${entryUrl}?${query.toString()}`, timeoutMs, '记忆');
      if (!outcome.ok) return outcome;
      const parsed = parseEntry(outcome.body);
      if (parsed === null) {
        return { ok: false, reason: '记忆响应形状不对', status: outcome.status };
      }
      return { ok: true, value: parsed };
    },
  };
}

// ------------------------------------------------------------------ 请求

type RawResult =
  | { readonly ok: true; readonly body: unknown; readonly status: number }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  label: string,
): Promise<RawResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      const why = controller.signal.aborted ? `超时 ${timeoutMs}ms` : errorText(error);
      return { ok: false, reason: `${label}不可达：${why}`, status: null };
    }
    if (!response.ok) {
      // 422 是服务端在说「这条记忆不该被读」， detail 里的话该原样给人看。
      const detail = await detailOf(response);
      return {
        ok: false,
        reason: detail ?? `${label}返回 ${response.status}`,
        status: response.status,
      };
    }
    try {
      return { ok: true, body: await response.json(), status: response.status };
    } catch {
      return { ok: false, reason: `${label}返回的不是 JSON`, status: response.status };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function detailOf(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.detail === 'string' && body.detail.trim() !== '') {
      return body.detail;
    }
  } catch {
    // 不是 JSON 就退回状态码，不猜。
  }
  return null;
}

// ------------------------------------------------------------------ 形状

export function parseList(body: unknown): MemoryListPage | null {
  if (!isRecord(body)) return null;
  const raw = body.entries;
  const count = body.count;
  if (!Array.isArray(raw)) return null;
  if (!isNonNegativeInt(count)) return null;
  // 客户端自己数一遍。服务端少数一条，列表就会静悄悄地少一行，
  // 而这种偏差在界面上只是「好像没什么可看的」。
  if (count !== raw.length) return null;

  const entries: MemoryEntryRow[] = [];
  for (const item of raw) {
    const entry = parseRow(item);
    if (entry === null) return null;
    entries.push(entry);
  }
  return { entries, count };
}

function parseRow(item: unknown): MemoryEntryRow | null {
  if (!isRecord(item)) return null;
  const { kind, title, path, section, summary, at, day } = item;
  if (!isText(kind)) return null;
  if (!isText(title)) return null;
  if (!isText(path)) return null;
  // 小节名可以没有（一事一文件那种），但给了就不能是空白。
  const sectionValue = section ?? null;
  if (sectionValue !== null && !isText(sectionValue)) return null;
  if (typeof summary !== 'string') return null;
  // `at` 与 `day` 要么都有，要么都没有：只有一个说明两边对这条记忆的认知
  // 已经不一致（服务端换了版本、或者中间有个代理把它们拆开了）。
  if (('at' in item) !== ('day' in item)) return null;
  const atValue = at ?? null;
  const dayValue = day ?? null;
  // 没有 frontmatter 的手写记忆两个都是 null，那是允许的。
  if ((atValue === null) !== (dayValue === null)) return null;
  if (atValue !== null && !isWorldTime(atValue)) return null;
  if (dayValue !== null && !isNonNegativeInt(dayValue)) return null;
  return {
    kind,
    title,
    path,
    section: sectionValue,
    summary: summary.slice(0, MEMORY_SUMMARY_CHARS),
    at: atValue,
    day: dayValue,
  };
}

function isWorldTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseEntry(body: unknown): MemoryEntry | null {
  if (!isRecord(body)) return null;
  const { path, section, kind, title, text } = body;
  if (!isText(path)) return null;
  const sectionValue = section ?? null;
  if (sectionValue !== null && !isText(sectionValue)) return null;
  if (!isText(kind)) return null;
  if (!isText(title)) return null;
  if (typeof text !== 'string') return null;
  return {
    path,
    section: sectionValue,
    kind,
    title,
    text: text.slice(0, MEMORY_TEXT_CHARS),
  };
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
