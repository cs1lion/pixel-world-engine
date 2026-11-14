/** 作业牌子客户端：问主服务要一句「她此刻在做什么」。
 *
 * 只做运输，不做判断——失败一律回 `null`，调用方保留原文案。
 *
 * **牌子是装饰，不是世界事实**：它失败不该让世界停摆、也不该在页面上留红字。
 * 所以这里不抛错、不重试。世界等不起，而牌子本来就有原文案兜底。
 *
 * 与 `intent-client.ts` 同一套超时纪律，但阈值不同：意图那一句玩家在等，
 * 给 40s；牌子是背景装饰，12s 没回就放弃，否则一个慢请求会压着后面所有拍。
 */

export const WORK_NOTE_URL = '/api/world/work-note';
export const WORK_NOTE_TIMEOUT_MS = 12_000;

export interface WorkNoteRequest {
  /** 谁在做这一趟（牌子要挂到她身上，不靠坐标猜）。 */
  readonly villagerId: string;
  readonly site: string;
  readonly siteName: string;
  readonly activity: string;
  readonly stock: number;
  readonly day: number;
  readonly people: readonly string[];
  /** 原来的牌子文案（权威事实；模型只换说法，不许改事实）。 */
  readonly canonical: string;
}

export type WorkNoteModel = (request: WorkNoteRequest) => Promise<string | null>;

export function createWorkNoteClient(
  options: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number } = {},
): WorkNoteModel {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? WORK_NOTE_TIMEOUT_MS;

  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(WORK_NOTE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { ok?: unknown; text?: unknown };
      if (body.ok !== true || typeof body.text !== 'string' || body.text.trim() === '') return null;
      return body.text.trim();
    } catch {
      // 超时、断网、JSON 坏——一律当「这回没写出来」，保留原文案。
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
