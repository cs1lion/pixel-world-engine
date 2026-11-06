/**
 * 工作树身份闸：确认这次 check-* 连的是**本工作树**起的 vite。
 *
 * 为什么需要：多工作树并行时，端口只保证「起不来就报错」（strictPort），
 * 保证不了「测的对象是正确的那一棵」。两棵树都忘了设
 * `PIXEL_WORLD_CLIENT_PORT` 时，第二棵的脚本默认仍打 5211，会测到第一棵
 * 的应用，而读数看起来完全正常——这是空判，不是红。
 *
 * 做法：vite dev/preview 侧注册只读 `/__tree-id`，返回本服务的工作树绝对
 * 路径、实际监听端口、启动时间。脚本在等待 HTTP 通过后先取这个端点，与
 * **本脚本所在工作树**比对；不一致、不可达、返回体不合法，一律判红。
 *
 * 什么时候跳过：目标不是本机回环地址（例如指向已部署环境/外部 URL），或
 * 显式 `PIXEL_WORLD_SKIP_TREE_IDENTITY=1`。跳过不是放行：脚本会打印一行
 * 「跳过」并说明原因，读数里看得见。
 *
 * 这个模块是**唯一**一份：25+ 个脚本各自复制一段比对逻辑，修一处漏一处，
 * 比没有更糟。
 */

import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TREE_ID_PATH = '/__tree-id';
export const SKIP_ENV = 'PIXEL_WORLD_SKIP_TREE_IDENTITY';

/** 本脚本所在的工作树：scripts/lib → scripts → world-client → 仓库根。 */
export const SELF_WORKTREE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export class TreeIdentityError extends Error {
  /**
   * @param {'unreachable'|'invalid'|'mismatch'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TreeIdentityError';
    this.code = code;
  }
}

/** @param {string} hostname */
export function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || /^127\./.test(hostname);
}

/**
 * 路径比较口径：绝对路径、统一分隔符；Windows 上大小写不敏感。
 * @param {string} value
 */
export function normalizePath(value) {
  let normalized = resolve(value).split(sep).join('/');
  if (process.platform === 'win32') normalized = normalized.toLowerCase();
  return normalized;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function sameWorktree(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!isAbsolute(a) || !isAbsolute(b)) return false;
  return normalizePath(a) === normalizePath(b);
}

/**
 * @param {URL} baseUrl
 */
export function treeIdentityUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.pathname = TREE_ID_PATH;
  url.search = '';
  url.hash = '';
  return url;
}

/**
 * 返回体只允许三样东西：工作树绝对路径、监听端口、启动时间。
 * 多余的字段不读；缺一项、类型不对，都算「不合法」，判红。
 *
 * @param {unknown} body
 * @returns {{ worktree: string, port: number, startedAt: string }}
 */
export function validateTreeIdentity(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new TreeIdentityError('invalid', `身份端点返回体不是对象：${String(body)}`);
  }
  const record = /** @type {Record<string, unknown>} */ (body);
  const worktree = record.worktree;
  if (typeof worktree !== 'string' || worktree.trim() === '' || !isAbsolute(worktree)) {
    throw new TreeIdentityError(
      'invalid',
      `身份端点的 worktree 必须是绝对路径：${JSON.stringify(worktree)}`,
    );
  }
  const port = record.port;
  if (
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65535
  ) {
    throw new TreeIdentityError(
      'invalid',
      `身份端点的 port 必须是 1–65535 的整数：${JSON.stringify(port)}`,
    );
  }
  const startedAt = record.startedAt;
  if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) {
    throw new TreeIdentityError(
      'invalid',
      `身份端点的 startedAt 必须是可解析的时间串：${JSON.stringify(startedAt)}`,
    );
  }
  return { worktree, port, startedAt };
}

function describeError(error) {
  if (error instanceof Error && error.name === 'TimeoutError') return '请求超时';
  const message = error instanceof Error ? error.message : String(error);
  return message === '' ? '未知错误' : message;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * 等 HTTP 有响应（任何状态码都算「服务起来了」），再把响应交回去。
 *
 * @param {string|URL} target
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, retryMs?:number, attemptMs?:number}} [options]
 * @returns {Promise<Response>}
 */
export async function waitHttp(target, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retryMs = options.retryMs ?? 250;
  const attemptMs = options.attemptMs ?? 2_000;
  if (typeof fetchImpl !== 'function') {
    throw new TreeIdentityError('unreachable', '当前运行时没有 fetch，无法探测身份端点');
  }
  const deadline = Date.now() + timeoutMs;
  let lastReason = '尚未收到响应';
  while (true) {
    const remaining = deadline - Date.now();
    try {
      return await fetchImpl(target, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(attemptMs, remaining))),
      });
    } catch (error) {
      lastReason = describeError(error);
    }
    if (Date.now() >= deadline) {
      throw new TreeIdentityError(
        'unreachable',
        `等待 HTTP 超时（${String(target)}）：${lastReason}。判红：无法确认你连的是哪棵工作树，不能放行`,
      );
    }
    await sleep(retryMs);
  }
}

/**
 * 取 `/__tree-id` 并校验返回体。不可达 / 非 200 / 非 JSON / 形状不对都判红。
 *
 * @param {string|URL} baseUrl
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, retryMs?:number, attemptMs?:number}} [options]
 * @returns {Promise<{ worktree: string, port: number, startedAt: string }>}
 */
export async function readTreeIdentity(baseUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const retryMs = options.retryMs ?? 250;
  const attemptMs = options.attemptMs ?? 2_000;
  const url = treeIdentityUrl(typeof baseUrl === 'string' ? baseUrl : baseUrl.href);
  const deadline = Date.now() + timeoutMs;
  let lastReason = '尚未收到响应';

  while (true) {
    const remaining = deadline - Date.now();
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(Math.max(1, Math.min(attemptMs, remaining))),
      });
    } catch (error) {
      lastReason = describeError(error);
    }

    if (response !== undefined) {
      if (response.status !== 200) {
        throw new TreeIdentityError(
          'invalid',
          `身份端点返回 HTTP ${response.status}（${url.pathname}），不是 200。判红：这个服务没有如实报出工作树身份`,
        );
      }
      let body;
      try {
        body = await response.json();
      } catch (error) {
        throw new TreeIdentityError(
          'invalid',
          `身份端点返回体不是合法 JSON（${url.pathname}）：${describeError(error)}。判红`,
        );
      }
      return validateTreeIdentity(body);
    }

    if (Date.now() >= deadline) {
      throw new TreeIdentityError(
        'unreachable',
        `身份端点不可达（${url.href}）：${lastReason}。判红：无法确认你连的是哪棵工作树，不能放行`,
      );
    }
    await sleep(retryMs);
  }
}

/**
 * 跳过条件：外部地址不参与本机工作树比对；显式跳过必须写明原因。
 *
 * @param {string|URL} baseUrl
 * @param {{env?:Record<string,string|undefined>}} [options]
 * @returns {string|null}
 */
export function skipReasonFor(baseUrl, options = {}) {
  const env = options.env ?? process.env;
  if (env[SKIP_ENV] === '1') return `已显式跳过（${SKIP_ENV}=1）`;
  let url;
  try {
    url = new URL(typeof baseUrl === 'string' ? baseUrl : baseUrl.href);
  } catch {
    return null;
  }
  if (!isLoopbackHost(url.hostname)) {
    return `目标 ${url.host} 不是本机回环地址，外部环境不参与工作树身份比对`;
  }
  return null;
}

function mismatchMessage(identity, expectedWorktree, explicitPort) {
  const standing =
    explicitPort === undefined
      ? `你站在另一棵树（路径 ${expectedWorktree}）`
      : `你站在 ${explicitPort} 这棵树（路径 ${expectedWorktree}）`;
  return [
    `身份不符：你连的是 ${identity.port} 那棵树（路径 ${identity.worktree}），`,
    `${standing}。`,
    '两棵工作树的路径不同 → 判红：这次测的不是本树的应用。',
    `要连本树，先导出本树的 PIXEL_WORLD_CLIENT_PORT（或 PIXEL_WORLD_URL）再跑。`,
  ].join('\n');
}

/**
 * @param {string|URL} baseUrl
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, retryMs?:number, attemptMs?:number, expectedWorktree?:string, env?:Record<string,string|undefined>}} [options]
 * @returns {Promise<{ skipped: true, reason: string } | { skipped: false, identity: { worktree: string, port: number, startedAt: string } }>}
 */
export async function verifyTreeIdentity(baseUrl, options = {}) {
  const skip = skipReasonFor(baseUrl, options);
  if (skip !== null) return { skipped: true, reason: skip };

  // 先等「有 HTTP 响应」，再取身份：服务还没起来时，端点必然是不可达的，
  // 直接判红会把「还没启动」和「连错树」混成同一条，没法排查。
  await waitHttp(baseUrl, {
    fetchImpl: options.fetchImpl,
    timeoutMs: options.waitTimeoutMs ?? options.timeoutMs ?? 15_000,
    retryMs: options.retryMs,
    attemptMs: options.attemptMs,
  });
  const identity = await readTreeIdentity(baseUrl, options);
  const expectedWorktree = options.expectedWorktree ?? SELF_WORKTREE;
  if (!sameWorktree(identity.worktree, expectedWorktree)) {
    const env = options.env ?? process.env;
    throw new TreeIdentityError(
      'mismatch',
      mismatchMessage(identity, expectedWorktree, env.PIXEL_WORLD_CLIENT_PORT),
    );
  }
  return { skipped: false, identity };
}

/**
 * 脚本入口：成功打印一行身份读数；失败打印一眼可见的原因并以 1 退出。
 *
 * @param {string|URL} baseUrl
 * @param {{fetchImpl?:typeof fetch, timeoutMs?:number, retryMs?:number, attemptMs?:number, expectedWorktree?:string, env?:Record<string,string|undefined>}} [options]
 */
export async function assertTreeIdentity(baseUrl, options = {}) {
  let result;
  try {
    result = await verifyTreeIdentity(baseUrl, options);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `身份探测失败：${String(error)}`;
    console.error(`\n[工作树身份闸门] ${message}\n`);
    process.exit(1);
  }
  if (result.skipped) {
    console.log(`[工作树身份] 跳过：${result.reason}`);
    return;
  }
  const { worktree, port, startedAt } = result.identity;
  console.log(`[工作树身份] 一致：${worktree}（端口 ${port}，启动于 ${startedAt}）`);
}
