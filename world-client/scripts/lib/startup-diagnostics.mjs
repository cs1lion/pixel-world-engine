/**
 * creation-ledger 集成测试的就绪探针诊断（只做信息，不改判据）。
 *
 * 背景：B13 那次「日志已打印 Uvicorn running，但 20 秒轮询没拿到 200」根因未证。
 * 下次再红时，失败信息必须能回答三个问题：最后一次拿到什么 status、最后一次
 * fetch 报什么错（带错误码）、距 spawn 过了多少毫秒 —— 没有这三个读数，就只能
 * 继续把它当「环境偶发」。
 *
 * 这里只负责格式化；20s 阈值、200 判据、200ms 间隔都在测试侧，不在这里。
 */

/**
 * @param {string} reason
 * @param {string} logs
 * @param {{lastStatus: number|null, lastError: string|null, msSinceSpawn: number}} probe
 * @returns {string}
 */
export function startupFailureMessage(reason, logs, probe) {
  const status = probe.lastStatus === null ? '无响应' : String(probe.lastStatus);
  const error = probe.lastError === null ? '无' : probe.lastError;
  return `${reason}（lastStatus=${status}，lastError=${error}，msSinceSpawn=${probe.msSinceSpawn}）：\n${logs}`;
}

/**
 * fetch 错误的可读形式：消息 + `cause.code`（如 ECONNREFUSED），没有码就只给消息。
 *
 * @param {unknown} error
 * @returns {string}
 */
export function describeFetchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error?.cause;
  const code = cause?.code;
  return typeof code === 'string' ? `${message}（${code}）` : message;
}
