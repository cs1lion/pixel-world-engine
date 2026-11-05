/**
 * `?now=` 的解析：0..1439 的整数世界分钟（00:00 起算）。
 *
 * 只认一种写法（整数分钟）。仓库里曾经并存过 `HH:MM` 与整数两套写法，
 * 结果是同一个参数在两套脚本里各说各话；这里把契约收成一个，并且**坏参数
 * 明确失败**：
 * - 没给（null / 空串）：返回 `undefined`，交给调用方按自己的默认时刻开局；
 * - 给了但不合法（非整数、负数、超过一天、小数、`HH:MM` 形式）：抛错。
 *
 * 为什么不再静默回落：静默回落会让一个写坏的 URL 看起来像一次正常运行——
 * 世界悄悄停在 00:00，而脚本以为自己钉到了别的时刻。宁可白屏报错。
 */
export function parseMinuteOfDay(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const text = raw.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`?now= 只接受 0..1439 的整数世界分钟，收到 "${raw}"（HH:MM 形式已废弃）`);
  }
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new Error(`?now= 只接受 0..1439 的整数世界分钟，收到 "${raw}"`);
  }
  return minutes;
}
