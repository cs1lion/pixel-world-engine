/** 急件请旨：上游 blocked 单在世界里的具身化。
 *
 * 上游在删文件、跑未知脚本这类操作前要人确认。它把这单标成 blocked 并带一个问题。
 *
 * 这里原来写「世界现在只是把它写成状态行的一行字——用户很容易完全没注意到」。
 * 那句话描述的是**本模块要解决的那个旧问题**，不是现状，而模块头读起来像在说
 * 「至今仍然如此」。实际早就具身了：
 *   - `VillagerMode` 有 `'bearingDecree'`（`types.ts`）；
 *   - `Simulation` 有 `decreeBearer` 与每拍调用的 `stepDecrees()`；
 *   - 空闲的人会被派成 `bearingDecree` 举着它跑到祭坛。
 *
 * 这里做的事仍然很有限，是故意的：
 *   - 把「哪一单、问什么」整理成一张可以呈给用户看的急件；
 *   - **不替用户回答，也不自己写日志**。世界是纯投影，改状态是主产品的事。
 *
 * 世界能提供的只是一次**呈现**：让传令官举着它跑到祭坛，让用户点开看全文。
 * 回答的动作走外部通道（上游的 dispatch 接口），不是世界。
 */

import type { WorldSnapshot } from './types.ts';

export interface Decree {
  /** 这单在日志里的 id。 */
  readonly taskId: string;
  /** 完整问题原文。**不截断**：用户要看着它做决定。 */
  readonly question: string;
  /** 这单在做什么，让用户知道上下文。 */
  readonly title: string;
}

/**
 * 当前该呈给用户的那张急件。
 *
 * 一次只呈一张：同时摆三张羊皮卷会把祭坛变成收件箱。
 * 取快照里第一张带问题的单——顺序是 `snapshot.tasks` 的**插入顺序**，稳定可复现。
 *
 * 这里原来写「顺序即任务 id 顺序」——不是。`snapshot.tasks` 就是 `this.tasks.map(...)`
 * 的投影，全链路没有 sort，而上游单的 id 是任意字符串（`this.tasks.push({ id: incoming.id })`），
 * 沙盒单才是 t1/t2… 自增。于是「上游 id 为 c_1 的单后到」会让数组排成 `[t5, c_1]`，
 * 按 id 排序该是 `[c_1, t5]`。「稳定可复现」这半句是真的（插入序确定），
 * 「顺序即任务 id 顺序」是假的——照着它去按 id 找人会找错。
 */
export function awaitingDecree(snapshot: WorldSnapshot): Decree | null {
  for (const task of snapshot.tasks) {
    if (task.blockedQuestion === null) continue;
    const question = task.blockedQuestion.trim();
    if (question === '') continue;
    return {
      taskId: task.id,
      question,
      title: task.summary,
    };
  }
  return null;
}
