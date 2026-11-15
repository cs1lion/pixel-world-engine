/** 人物决策客户端：问她下一步去哪儿。
 *
 * 只做运输，不做判断——失败一律回 `null`，调用方保留原作息。
 *
 * **作息是默认，偏离要有理由**：模型拿不到记忆就不许偏离，所以请求里
 * 必须带记忆快照。失败时（超时、断网、JSON 坏）一律回 `null`，世界照旧
 * 走作息——LLM 挂了人物照活。
 *
 * 与 `work-note-client.ts` 同一套超时纪律：12s 没回就放弃，不抛错不重试。
 * 这个世界等不起一个慢请求。
 */

export const VILLAGER_DECISION_URL = '/api/world/villager-decision';
export const VILLAGER_DECISION_TIMEOUT_MS = 12_000;

export interface VillagerMemoryItem {
  readonly text: string;
  readonly day: number;
}

export interface VillagerDecisionRequest {
  /** 谁在做决定（决策要挂到她身上）。 */
  readonly villagerName: string;
  /** 作息表说的目的地（默认选项）。 */
  readonly routineLabel: string;
  /** 第几天。 */
  readonly day: number;
  /** 她最近记得的事——偏离作息的唯一理由来源。 */
  readonly memories: readonly VillagerMemoryItem[];
  /** 她能去的场所（含作息表的那个），每处带可做的事。 */
  readonly availableSites: readonly {
    readonly siteId: string;
    readonly siteName: string;
    readonly activities: readonly string[];
  }[];
}

export interface VillagerDecision {
  /** follow=照作息走；deviate=去别的地方。 */
  readonly action: 'follow' | 'deviate';
  /** deviate 时的场所 id；follow 时为空。 */
  readonly siteId?: string;
  /** deviate 时的活动 id；follow 时为空。 */
  readonly activityId?: string;
  /** 一句话理由（deviate 必填，follow 可选）。 */
  readonly reason: string;
}

export type VillagerDecisionModel = (
  request: VillagerDecisionRequest,
) => Promise<VillagerDecision | null>;

export function createVillagerDecisionClient(
  options: { readonly fetchImpl?: typeof fetch; readonly timeoutMs?: number } = {},
): VillagerDecisionModel {
  const fetchImpl = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = options.timeoutMs ?? VILLAGER_DECISION_TIMEOUT_MS;

  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(VILLAGER_DECISION_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        ok?: unknown;
        action?: unknown;
        siteId?: unknown;
        activityId?: unknown;
        reason?: unknown;
      };
      if (body.ok !== true) return null;
      if (body.action !== 'follow' && body.action !== 'deviate') return null;
      if (body.action === 'deviate') {
        if (typeof body.siteId !== 'string' || body.siteId === '') return null;
        if (typeof body.activityId !== 'string' || body.activityId === '') return null;
        if (typeof body.reason !== 'string' || body.reason === '') return null;
        return {
          action: 'deviate',
          siteId: body.siteId,
          activityId: body.activityId,
          reason: body.reason,
        };
      }
      return {
        action: 'follow',
        reason: typeof body.reason === 'string' ? body.reason : '',
      };
    } catch {
      // 超时、断网、JSON 坏——一律当「这回没写出来」，照旧走作息。
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
