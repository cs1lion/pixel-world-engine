# ADR_WORK_OUTPUT_MEMORY：产出物的名字与来历进记忆

- status: aligned
- verified_at: 2026-11-10
- verified_by: agent（用户「做循环，另外根据第一轮对话分析接下来怎么走」→ 5 步路线第 2 步）
- evidence: `world-client/src/world/world-changes.ts`, `world-client/src/world/simulation.ts`, `world-client/src/world/site-output.ts`, `world-client/src/world/memory/salience.ts`, `world-client/src/world/memory/observe.ts`, `server/events/world_changes.py`, `world-client/test/site-output.test.ts`, `server/tests/test_world_changes.py`

## 1. 问题

产出账（`ADR_SITE_OUTPUT`）只有三个数：炭 2、洗好的衣裳 2、成交 3。
**谁做的、什么时候、在哪儿做的，一样都没留下**。世界自己的记忆层于是完全
看不见作业：一个村民干了一整天活，她的一天里没有一件「我做成了什么」。

## 2. 决策

- **新开一种 `world.event` 的 kind：`work_output`。** 不复用 `routine_done`：
  后者是「她在镇上停了一会儿」，前者是「炉匠搬炭，得了一份炭」——
  一个村子的账本上多了一件东西。文案由 `outputEventText` 这个纯函数给，
  成交说「做成了一笔买卖」，不说「得了一份成交」。
- **落点优先记在场所本身那栋楼上。** 设定集里的场所 id 与楼实例 id 是同一个词
  （`boiler_annex#1`），所以这一份炭的来历是锅炉房，而不是「她脚下那一格」。
  露天的场所（集市）才退回落点（够得着楼门记楼门，否则记格子）。
- **分量只让它落在当事人的记忆里。** `KIND_PRIORS.work_output` 取
  `{emotion 0.25, surprise 0.15, goalRelevance 0.4, involvement 0.15}`：
  当事人 `(0.25 + 0.35 + 0.4 + 1) / 4 = 0.5` 过 `T_write`（0.3）；
  旁观者 `0.2875` 压在门槛下。**实测一天 10 条 `work_output`**（同一天
  其它 `world.event` 31 条），如果旁观者也条条都记，闲话会被这件事淹掉。
- **走既有的 `world.event` 回写通道**，不另开一条：事件流先记，记忆层从
  `observationOf` 读，`world.changed` 的日志与 `memory/` 的证据引用都是现成的。
- **服务端白名单跟着加。** `WORLD_EVENT_KINDS` 与客户端 `WorldEventKind`
  是同一个域，各写一遍；只改一边的表现是「世界做完了、回写被自己的服务端
  拒掉，那一刻什么也没留下」。

## 3. 不在范围

- **不做产出的消耗语义**（炭烧了什么、衣裳给了谁）：消耗现在只是按世界日
  扣一份（`ADR_SITE_OUTPUT` 后续那次循环改动），没有对手方。
- 不做产出物的个体身份（「第 7 块炭」）：记忆记的是「一趟作业做出了一份什么」，
  不是每一件的编号。
- 不改 `routine_done` 的分量与文案。

## 4. 代价与已知边界

- **事件量涨了约四分之一**（一天 +10 条）。这是有意的：产出是村子每天真的
  发生的事，只是以前没人记。如果以后作业频次涨上来，先动的是这一条的分量
  与节流，不是把它删掉。
- **记忆里的「一份」没有去处**：她知道今天搬了三趟炭，但不知道那三份炭后来
  怎样了。要接上得等消耗链有了对手方。
- **红证据的位置**：新断言写在 `test/site-output.test.ts` 里，那个文件因为
  依赖 base 上不存在的 `src/world/site-output.ts` 已在 `red:first` 的
  例外清单里；这次没有另造一份重复用例去凑红证据。

## 5. 验证

- `test/site-output.test.ts` 9/9：新增三条——`outputEventText` 纯函数按产出物
  说话；真世界跑一天，`work_output` 事件条数与产出账逐份对上，每条都有
  当事人与落点，炭记在 `boiler_annex#1`、衣裳记在 `wave_house#1`；
  记忆分量当事人过线、旁观者不过线。
- `server/tests/test_world_changes.py` 72/72：新增一条——`work_output` 能写进
  事件账，`text` 与 `actorId` 原样回来。
- 全量前端 2668 通过 0 失败；服务端 571 通过 1 跳过；十一道闸门 11/11。
