# 交付失败进正式事件流（提案）

状态：实现前提案。落档契约不动（v5 冻结）。

## 1. 结论

把「吃紧的那单交付失败」记成一条**世界事件**：

- 事件种类：`world.event` 下新增闭集成员 **`delivery_failed`**；
- 载荷带五个必需信息：谁（`actorId`）、哪单（`failure.taskId`）、哪个地点（`placeId` + `where`）、失败原因枚举（`failure.reason`）、是否重复失败（`failure.repeat`）；
- 权重接进现有三张表：重要度 `worldEventImportance`、效价 `worldEventValence`、唤醒 `worldEventArousal`；
- 目击直接复用 `perception.ts` / `hearing.ts` 的既有规则，不新写一套；
- 报纸的失败数改为数事件账（`WorldSnapshot.deliveryFailures`），不再数 `TaskRecord.status === 'failed'`；
- 存档 v5 **不加字段**；世界/记忆/造物三枚指纹中只有世界指纹变，原因见 §7。

## 2. 种类与载荷

```ts
{
  change: 'world.event',
  kind: 'delivery_failed',
  text: '阿禾饿得手抖，磨坊这一趟没送到。',
  placeId: '<楼实例 id>' | 'place:x,y',   // 有楼用楼，原地单用摊位的格子
  where: { x, y },
  actorId: '<当事人 villagerId>',
  failure: {
    taskId: '<任务 id>',
    taskKind: '<TaskKind>',
    reason: 'hunger',        // 失败原因枚举；当前闭集只有这一项
    repeat: false,           // 这一单此前是否已经失败过
  },
}
```

- `actorId` 必填且非空（服务端对 `delivery_failed` 单独校验）。
- `failure.repeat` 取「推送前 `deliveryFailures` 里有没有同 `taskId`」的真实测量值，不是常量。今天恒为 `false`，因为 `hungerFailedTasks` 保证每单只走一次失败分支（块 4 的既有断言）。
- 闭集修改：客户端 `WorldEventKind` 与 `server/events/world_changes.py` 的 `WORLD_EVENT_KINDS` 同步加一项；`failure` 是 `world.event` 载荷的唯一新增可选子对象，只允许 `delivery_failed` 带。
- 不复用 `task.delivered` 那种独立 change：失败要落在「世界自己发生的事」这条流上，才能吃到既有的三张权重表与感知/听见规则；独立 change 得再配一套权重，反而离现有模型更远。
- 地点语义：有楼时 `placeId` 是楼实例、`where` 是楼门口、`indoor = true`（由 `atOfBuilding(placeId)` 判定）；原地单没有楼，`placeId` 用 `place:x,y`、`where` 是当事人脚下、`indoor = false`。

## 3. 三张权重表

数值不是拍脑袋：下表同时给出与相邻既有条目的对照，以及按 `salience.ts` 的默认四等权（0.25）算出的落点。

| 轴 | 新值 | 既有锚点 | 依据 |
|---|---|---|---|
| 重要度 `worldEventImportance` | **0.70** | `task_done` 0.45、`street_help` 0.65、`workshop_accident` 0.80 | 比一次普通交付重要（它让村子少了一单、还暴露出有人饿着），比炸炉事故轻（没人受伤、没有损毁）。0.70 也高于史诗候选下限 0.55，但 `irreversibilityOf('delivery_failed') = 0`，所以最多被讲成地方传说，不会立碑。 |
| 效价 `worldEventValence` | **-0.60** | `street_water` -0.55、`discipline` -0.60、`workshop_accident` -0.70 | 明确为负：当事人挨饿、村子丢单。但没人受伤，所以不比事故更负；又比「打翻水」更负，因为损失落在别人身上而不只是湿了地。 |
| 唤醒 `worldEventArousal` | **0.60** | `street_tumble` 0.55、`weather_anomaly` 0.70 | 一次当众的、带身体反应的失手（手抖、没送到），比摔倒更抓人，但远不到全村骚动的程度。 |

配套的 kind 先验（`salience.ts` 的 `KIND_PRIORS['delivery_failed']`）：

| emotion | surprise | goalRelevance | involvement（旁观者） |
|---|---|---|---|
| 0.65 | 0.70 | 0.60 | 0.20 |

四轴与 `task_done`（0.35 / 0.45 / 0.50 / 0.30）逐项对照：更负面、更意外、更挡事；旁观者的参与度更低，当事人由 `inputsFor` 拉满到 1。

默认四等权下的显著性落点（配置阈值：写入 0.30、整理进摘要 0.60、闪光记忆 0.85）：

- 当事人：`0.25 × (0.65 + 0.70 + 0.60 + 1.00) = 0.7375`；
- 旁观目击者：`0.25 × (0.65 + 0.70 + 0.60 + 0.20) = 0.5375`；
- 对照 `task_done`：当事人 0.575、旁观者 0.40。

所以：**当事人会写、且够进当日摘要；目击者会写、但不够进摘要；两者都够不上闪光记忆 0.85**——一次失败值得被记住，但不该变成永久扭曲的纪念碑。这个落点就是「为什么值得记住」的量化答案。

## 4. 目击规则（复用既有感知）

`observationOf` 产出 `indoor` 与 `placeId/where`，之后完全交给 `MemoryRuntime.witnessesFor` / `hearersFor`：

- **看见**（`perception.ts`）：
  - 室内事件：只有 `perceiver.inside === placeId` 的**同房间**人在场；屋外贴墙站着也看不见。
  - 室外事件：欧氏距离 ≤ 8 格，且 `hasLineOfSight` 不被墙挡。
  - 观察者自己在室内时，看不见任何室外事件。
- **只听见**（`hearing.ts`，`delivery_failed` 未单独登记，按缺省的 `speech`，半径 6）：
  - 室内事件：只有同房间的人听见；屋外没人听见。
  - 室外事件：距离 ≤ 6 格且视线不被墙挡；`6 < d ≤ 8` 的人**看得见但听不见**。
  - 室外事件 + 观察者在屋内：看不见；若距离 ≤ 6 且视线未被墙挡，会得到一条 `source_mode = heard` 的记忆（“只听到、没看见”的唯一通道）。
- 当事人永远在 `actors` 里，且排在见证者序列最前（既有 `witnessesOf` 输入顺序约定）。

## 5. 对 `report.ts` 的影响

- 现在：`failed = snapshot.tasks.filter(t => t.status === 'failed')`，失败数从任务状态推。
- 改为：`failed = snapshot.deliveryFailures`，只数事件账。`WorldSnapshot.deliveryFailures` 是世界在失败发生那一刻追加的 `DeliveryFailure[]`（`at / taskId / summary / workerId / source / reason / repeat / placeId / where`），与 `deliveriesByVillager` 同层、运行时生成、不落档。
- 逐项一致：每次失败恰好写一条事件账；`hungerFailedTasks` 保证每单只失败一次，所以 `deliveryFailures.length === 事件流里 delivery_failed 的条数`。

## 6. 存档 v5

**不加字段，v5 不动。**依据：

- 失败事件本身已经落在记忆段（`WorldFact`，`kind = delivery_failed`，`outcome.status = 'fail'`），记忆段随 v5 的 `world.memory` 字符串一起存；世界侧再存一份 `deliveryFailures` 就是重复。
- `deliveryFailures` 与块 3 的 `lastMealAt`、块 4 的 `hungerFailedTasks` 同类：运行时投影，读档即重建/清空，不写进 `WorldSave`。
- 因此 `schemaVersion` 仍是 5，`SCHEMA_V5` 的字段清单与冻结指纹不动；没有 v6。

已知边界（写进 PROGRESS 的“没做到”一档）：读档后，报纸只数**本会话**产生的新失败事件；上一会话的 `failed` 任务仍存在于 `tasks` 里，但世界快照不持有记忆事实，不会回溯计数。事件本身没有丢——它在记忆段里。

## 7. 对三枚指纹的影响

| 指纹 | 会变吗 | 为什么 |
|---|---|---|
| 世界（`projectWorld`） | **会** | `projectWorld` 新增 `deliveryFailures` 投影。冻结轨迹里即使 0 条失败，规范化 JSON 也多一个空数组，所有 checkpoint 的世界 sha 都会变。这是“新增事件种类”的直接投影结果，不是顺手更新。 |
| 记忆（`memoryFingerprint`） | **不会** | 冻结轨迹最高饥饿 0.694 < 失败阈值 1.0，一次失败都不发生，没有新观察、没有新事实，记忆段逐字不变。 |
| 造物主（`creatorFingerprint`） | **不会** | 新种类只属于世界事件流；造物主的输入摘要与事件数不变。 |

需要重新录制 `traces/outer-two-days.json`、`traces/night-rain-build.json` 与新基线，并逐项记录「旧 → 新 → 为什么变 → 对应提交」。

## 8. 不记这条会怎样（现状读数）

块 4 的失败原型（`docs/evidence/needs/failure-scenario.txt`）里的现状：

- 一次失败后，世界只留下 `task.status = 'failed'` 与一条 12 条窗口的日志行；
- 记忆段**一条事实都没有**：`kind = delivery_failed` 的事实 0 条，目击者记忆 0 条，`outcome` 里 `status = fail/deny` 的占比 **0 / 47 = 0%**（基线 facts=47、entries=45、事件 50 条）；
- 报纸能说“有 1 单没办成”，但说不清是谁、在哪、为什么；这个“为什么（hunger）”只活在那条会滚出窗口的日志里；
- 读档后连日志也没了，只剩一个 `failed` 状态，原因与目击者永久丢失；
- 同一个人第二天再失败一次，记忆层没有“她昨天也这样”的底子，重复失败无法被看见。

这就是信息损失：**一件事发生了，却没有进入任何人的记忆**。记这条事件之后，同一次失败会产生 1 条事实、至少当事人与同房间/8 格内目击者的记忆，并在事实的 `outcome.status` 里留下 `fail`，供后续断言与简报使用。

## 9. 验收口径

1. 失败事件条数（`deliveryFailures` 与记忆事实）、目击者记忆条数、`facts.outcome` 中 `deny/fail` 的可见占比；
2. `report.ts` 的失败数与事件条数逐项一致；
3. 专项：饿到顶第一单失败 → 事件入库 → 吃一口第二单成功，第一单不再失败；
4. 同种子两跑指纹逐字相同；
5. 九道闸门全绿；`test:buttons` 如实记录，不为变绿改代码。
