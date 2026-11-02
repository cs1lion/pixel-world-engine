/** 记忆客户端：把编年史读进浏览器。
 *
 * 与 `events-client.ts` 同一套纪律，因为面对的是同一个服务端：
 *   - 只做运输与形状校验，不判断一条记忆该排在哪里（那是编年史面板的事）；
 *   - 不重试。记忆是只增的，重试没有副作用，但会让「这一刻读到了什么」
 *     变得不确定；
 *   - **失败返回失败，不抛异常**。读失败只是「这一拍没翻开」，
 *     不该让整个界面停摆。
 *
 * 写入走 `POST /api/memory/write`（`write()`），那条路收的是「已经观测到的事」——
 * 由世界自己发起，不该由界面上的一个按钮发起。所以这里的写只有一条来源：
 * 世界回写日志成功后拿到的事件 id，作为 `evidence` 递回服务端。
 *
 * 写不是每拍发一次：`createMemoryOutbox` 攒着，场景在自动存档那一刻交一条。
 * 记忆是只增的，重发会让同一件事在编年史里出现两次——所以成功才出队，
 * 失败留着下一拍再试，且同一时刻只允许一条在途。
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
  /**
   * 这一页被截断了。
   *
   * 角色档案「逐条追加，只增不改」，写到第几条就会超过 `MEMORY_TEXT_CHARS`。
   * 静默截断的表现是「这条记忆就这么长」——读者无从知道后面还有，
   * 而一份被悄悄切短的档案，读起来像一份写完了的档案。
   */
  readonly truncated: boolean;
}

export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string; readonly status: number | null };

export const MEMORY_LIST_URL = '/api/memory/list';
export const MEMORY_ENTRY_URL = '/api/memory/entry';
export const MEMORY_WRITE_URL = '/api/memory/write';

/**
 * 服务端只认这一种来源（`memory/__init__.py` 的 `ALLOWED_SOURCES`）。
 *
 * 客户端不提供开关：写入的每一句都是世界**观测到**的事，服务端据此核对
 * `evidence` 里的每个 id 是否真的在日志里。模型转述也走这一条——转述的不是
 * 来源，来源仍是观测。
 */
export const MEMORY_SOURCE = 'direct_observation';

/**
 * 一条要写回服务端的记忆。
 *
 * `evidence` 是事件日志里的 id，至少一条——没有依据就不写。`subject` 只对
 * `character` 有意义，是「这个人是谁」（决定文件名），`title` 是这一节的标题。
 */
export interface MemoryDraft {
  readonly kind: 'event' | 'character';
  readonly title: string;
  readonly body: string;
  /** 世界时间毫秒，不是墙钟。 */
  readonly at: number;
  readonly evidence: readonly number[];
  readonly subject?: string;
}

/** 服务端写成功后回的形状（`WrittenMemory.to_json()`）。 */
export interface WrittenMemory {
  readonly kind: string;
  readonly title: string;
  /** 相对 `memory/` 的路径。 */
  readonly path: string;
  readonly evidence: readonly number[];
  readonly appended: boolean;
}

/** 单次读取超时。编年史是人翻开的一次动作，等太久不如先告诉他没读到。 */
export const MEMORY_TIMEOUT_MS = 5000;

/**
 * 摘要里最多留多少字。
 *
 * 服务端也截（同一个 120），这里再截一次是为了防御——服务端换了上限时，
 * 界面不该跟着变形。
 */
export const MEMORY_SUMMARY_CHARS = 120;

/** 全文上限。一份角色档案会越写越长，而抽屉里看得过来的只有这么多。 */
export const MEMORY_TEXT_CHARS = 20000;

export interface MemoryClient {
  /** 列一遍记忆。任何失败都落到 `ok: false`。 */
  list(): Promise<MemoryResult<MemoryListPage>>;
  /** 读一份记忆的全文。`row` 必须是 `list()` 给回来的那一行，原样传。 */
  read(row: MemoryEntryRow): Promise<MemoryResult<MemoryEntry>>;
  /**
   * 写一条记忆。失败返回 `ok: false`，不抛；不重试（记忆只增，重发等于
   * 同一件事在编年史里出现两次）。
   */
  write(draft: MemoryDraft): Promise<MemoryResult<WrittenMemory>>;
}

export interface MemoryClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** 测试注入：便于断言请求地址。 */
  readonly listUrl?: string;
  readonly entryUrl?: string;
  readonly writeUrl?: string;
}

export function createMemoryClient(options: MemoryClientOptions = {}): MemoryClient {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? MEMORY_TIMEOUT_MS;
  const listUrl = options.listUrl ?? MEMORY_LIST_URL;
  const entryUrl = options.entryUrl ?? MEMORY_ENTRY_URL;
  const writeUrl = options.writeUrl ?? MEMORY_WRITE_URL;

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
      // 世界时间也带回去。同一个人对同一件事的两次观测会有两个同名小节，
      // 列表里那两行只有 at 不同；不带 at 服务端答 422 说明要带，
      // 而不是静默返回第一条——那等于在两条真相里挑一条，
      // 而读者看到的两行一模一样，永远不知道自己读的是哪一条。
      if (row.at !== null) query.set('at', String(row.at));
      const outcome = await getJson(fetchImpl, `${entryUrl}?${query.toString()}`, timeoutMs, '记忆');
      if (!outcome.ok) return outcome;
      const parsed = parseEntry(outcome.body);
      if (parsed === null) {
        return { ok: false, reason: '记忆响应形状不对', status: outcome.status };
      }
      return { ok: true, value: parsed };
    },

    async write(draft: MemoryDraft): Promise<MemoryResult<WrittenMemory>> {
      const problem = draftProblem(draft);
      if (problem !== null) return { ok: false, reason: problem, status: null };
      const outcome = await postJson(fetchImpl, writeUrl, timeoutMs, '记忆写入', {
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        source: MEMORY_SOURCE,
        evidence: [...draft.evidence],
        at: draft.at,
        ...(draft.subject === undefined ? {} : { subject: draft.subject }),
      });
      if (!outcome.ok) return outcome;
      const parsed = parseWritten(outcome.body);
      if (parsed === null) {
        return { ok: false, reason: '记忆写入响应形状不对', status: outcome.status };
      }
      return { ok: true, value: parsed };
    },
  };
}

/**
 * 出队器：攒着世界观测到的事，一次只交一条。
 *
 * 存在的理由是**节流**：世界每拍都可能发生一件事，而服务端写记忆是落文件，
 * 每拍一次等于拿磁盘当日志。场景只在自动存档那一刻调一次 `flush()`，
 * 与存档共用 30s / 状态变化那一条节流。
 *
 * 三条规矩：
 *   - 空队不请求（每帧调也没有副作用）；
 *   - 同一时刻只有一条在途，第二次 `flush()` 直接返回 `null`；
 *   - 写成功才出队，失败留着下一拍再试——记忆只增，丢了就是历史缺一段。
 */
export interface MemoryOutbox {
  enqueue(draft: MemoryDraft): void;
  readonly size: number;
  /** 交一条。空队或上一条还没回来时返回 `null`。 */
  flush(): Promise<MemoryResult<WrittenMemory> | null>;
}

export function createMemoryOutbox(client: MemoryClient): MemoryOutbox {
  const queue: MemoryDraft[] = [];
  let inFlight = false;
  return {
    enqueue(draft: MemoryDraft): void {
      queue.push(draft);
    },
    get size(): number {
      return queue.length;
    },
    async flush(): Promise<MemoryResult<WrittenMemory> | null> {
      if (inFlight) return null;
      const draft = queue[0];
      if (draft === undefined) return null;
      inFlight = true;
      try {
        const result = await client.write(draft);
        if (result.ok) queue.shift();
        return result;
      } finally {
        inFlight = false;
      }
    },
  };
}

/** 本地先挡一次明显写不进去的草稿：省一次往返，也让调用方早一点看见问题。 */
function draftProblem(draft: MemoryDraft): string | null {
  if (draft.kind !== 'event' && draft.kind !== 'character') {
    return `记忆种类只能是 event 或 character，收到 ${String(draft.kind)}`;
  }
  if (typeof draft.title !== 'string' || draft.title.trim() === '') return '记忆缺标题';
  if (typeof draft.body !== 'string' || draft.body.trim() === '') return '记忆缺正文';
  if (!Number.isFinite(draft.at) || draft.at < 0) return '记忆的世界时间必须是非负有限数';
  if (draft.evidence.length === 0) return '没有依据就不能写记忆';
  for (const id of draft.evidence) {
    if (!Number.isInteger(id) || id < 1) return `证据 ${String(id)} 不是事件 id`;
  }
  if (draft.kind === 'character' && (draft.subject === undefined || draft.subject.trim() === '')) {
    return 'character 记忆必须带 subject';
  }
  return null;
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

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  label: string,
  payload: unknown,
): Promise<RawResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      const why = controller.signal.aborted ? `超时 ${timeoutMs}ms` : errorText(error);
      return { ok: false, reason: `${label}不可达：${why}`, status: null };
    }
    if (!response.ok) {
      // 422 是服务端在说「这条记忆不该写」，detail 里的话该原样给人看。
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
    truncated: text.length > MEMORY_TEXT_CHARS,
  };
}

/** 服务端写成功后的形状。任何一处不对就整条作废——调用方据此判「真的落盘了」。 */
export function parseWritten(body: unknown): WrittenMemory | null {
  if (!isRecord(body)) return null;
  const { kind, title, path, evidence, appended } = body;
  if (!isText(kind)) return null;
  if (!isText(title)) return null;
  if (!isText(path)) return null;
  if (!Array.isArray(evidence)) return null;
  // 一条记忆必须至少有一条依据：空数组说明服务端没把请求里的 evidence 当回事，
  // 落盘的东西就无从核对，按失败处理。
  if (evidence.length === 0) return null;
  for (const id of evidence) {
    if (!isNonNegativeInt(id) || id < 1) return null;
  }
  if (typeof appended !== 'boolean') return null;
  return { kind, title, path, evidence, appended };
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
