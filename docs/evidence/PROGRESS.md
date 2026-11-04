# 进度记录（按块追加）

> 约定：每块独立证据目录；基线先落盘再改；「做到 / 没做到 / 没验证」三档分开写。
> 分支纪律：不 push、不动 main；端口禁用 5188 / 5191 / 5202 / 5203；不接模型；禁 `Date.now` / `Math.random`。

---

## 块 1 · EnvironmentFrame + ObservationRule 注册表

- 开始 / 结束：2026-11-04（具体时刻未记录，块结束时已汇报）
- 分支：`feat/env-frame`（基于 main），提交 `d353c26`，未 push、未动 main
- 改了什么结构
  - 新增 `src/world/environment.ts`：`environmentAt()` 把天气 / 潮位 / 时辰 / 光照收成一帧，`hasEnvironment()` 做组合条件。
  - `routines.ts` / `weather-effects.ts` / `timetable.ts` / `simulation.ts` 统一从同一帧读，潮汐压线判定只在建帧时定。
  - 新增 `src/world/observation-rules.ts`：把 `SandboxScene.remember()` 的 switch 外置成 `OBSERVATION_RULES`，天气 6 格分组一并搬出。
- 指纹对照：世界 / 记忆 / 造物三条 sha256 与事件数 50 **逐项一致**。
- 闸门：九道全绿；浏览器五道能跑的均通过。
- 真问题：references 审计因行号位移红 9 处，逐条改引用后复跑通过；`pytest` 需在 `server/` 目录跑。
- 被否掉的写法：改存档契约以落决策日志 —— 否；改为运行时只读探针。
- 阻塞：无。
- 证据：`docs/evidence/env-frame/`。

---

## 块 2 · BehaviorRule + 目标队列（等价替换）

- 开始 / 结束：2026-11-04 20:30 左右 / 2026-11-04 21:20
- 分支：`feat/behavior-queue`（基于 `feat/env-frame` 的 `d353c26`），未 push、未动 main
- 改了什么结构
  - 新增 `src/world/behavior.ts`：`BehaviorGoal`、`BehaviorContext`、`BehaviorRule`、`BehaviorPlanner`（按登记顺序评估、首个命中即产出、可运行期换表）、`GoalQueue`（current / queued / suspended / `interrupt(reason)` / `resume()` / 打断计数）。
  - 新增 `src/world/behavior-rules.ts`：`VERIFICATION_RULE`、`PRE_COVER_RULE`、`ROUTINE_RULE`、`DEFAULT_BEHAVIOR_RULES`；避让登记为 `AVOIDANCE_GUARD`（`ROUTINE_GUARDS`）。
  - `Simulation.stepIdle` 不再写死调用链，改为「前置守卫 → 按表评估 → 记决策 → 入队」。
  - 旧链判据与副作用逐字搬进 `verificationGoal` / `preCoverGoal` / `routineGoal`；避让拆成纯判据 `avoidedOther` + 记账 `noteAvoided` + guard 内 `retryLater(20_000)`。
  - 目标队列是运行时读数（`Map<villagerId, GoalQueue>`），不落档；本块没有任何规则调用 `interrupt`。
- 逐拍决策 diff
  - 轨迹 3000 拍 × 60s；决策 480 条；`before` / `after` 两边 sha256 都是 `39aa269d…`。
  - `Compare-Object` 差异 **0 条**，逐行相同（含 rule 来源、goal、target、beatId、routineIndex）。
- 指纹对照：世界 `95ee830c…` / 记忆 `fb0847b3…` / 造物 `c5198f0f…`、事件数 50、记忆读数、绘制指令 16130、Graphics 27 全部一致。
- 新增测试（`test/behavior-queue.test.ts`，6 条）
  1. 逐拍决策与原链逐行相同（对 `decisions-before.txt`）；
  2. 登记顺序即优先级（交换顺序改变结果）；
  3. 运行期新增规则不需改 `Simulation` / Scene；
  4. 默认路径跑两个世界日打断次数 = 0；
  5. `GoalQueue` 的 interrupt / resume 接口本身可用；
  6. 空规则集兜底等于原 `routine`。
- 闸门：`npm run check` 绿；`npm test` 2096 通过 / 9 跳过；`npm run build` 绿；五道 audit + adr-schema 绿；`pytest` 518 通过；`worktrees:audit --strict` 绿；浏览器 `browser` / `phases` / `persistence` / `render-budget` / `setting` 通过。
- 未验证：`test:buttons` —— 开发服务在，但 `/api/memory/list` 回 HTTP 404，脚本按设计退出码 2，**本块无法验证**。
- 真问题：references 审计因行号位移红 8 处（`simulation.ts:118/675/688/1822/1884/2158/2784/2081`），逐条改到当前行；README 测试文件数 223 → 224。
- 被否掉的写法及原因
  - 把「避让」硬塞成 `Goal | null`：它必须在同一拍继续试下一拍，收益是「跳过这一拍」不是「产出目标」，塞进规则表会改行为；故记为 guard。
  - 为记「安静段坐回锚点」而改行为：否；只在探针里补一条记录，行为不动（基线由 474 条更正为 480 条）。
- 阻塞：无（`test:buttons` 属于环境限制，非本块失败）。
- 证据：`docs/evidence/behavior-queue/`（baseline / after / decisions-before / decisions-after / decisions-diff / manifest / render-budget / 四道浏览器输出）。

---

## 块 3 · 需求层第一版：饥饿一个标量

- 开始 / 结束：2026-11-04 21:28 / 2026-11-04 21:45
- 分支：`feat/behavior-queue`，未 push、未动 main
- 改了什么结构
  - 新增 `src/world/needs.ts`：纯值对象 `NeedsReading { hunger, hungry }`、纯函数 `hungerAt` / `needsAt`；常量 `NEEDS_HUNGER_PER_DAY = 1/3`、`NEEDS_HUNGER_EAT_THRESHOLD = 0.9`、`NEEDS_HUNGER_AFTER_MEAL = 0`。
  - `Simulation` 只记一个运行时读数 `lastMealAt`（每人上次吃饭的世界时刻），**不落档、不进快照**；读档时按存档时刻重锚为「刚吃过」。
  - 行为规则新增 `EAT_RULE`（id `eat`），默认顺序 `verification → pre-cover → eat → routine`；`eat` 阈下返回 `null`，逐字沿用旧链。
  - 吃饭落点只用现有地点：`stallsAt` 有摊子取最近摊子，否则回祭坛；消费只把 `lastMealAt` 拨到此刻，不 `announce`、不新增世界事实种类。
- 读数（`docs/evidence/needs/after.txt`）
  - 三条指纹、事件数 50、记忆读数、绘制指令 16130 / Graphics 27 **全部与 baseline 相同**。
  - 冻结轨迹逐拍决策 480 条，sha256 `39aa269d…`，逐行 diff 0（`eat` 未出现）。
  - 专项场景（`hunger-scenario.txt`）：开局 `hunger=0.9333` 跨阈 → 第一拍 `rule=eat target=(6,6)`（现有摊子）→ 消费后 `hunger=0.0000`，`interrupts=0`，世界事件条数不增。
- 新增测试（`test/needs.test.ts`，4 条）
  1. 读数纯函数（单调、封顶、时钟回拨不出现负值）；
  2. 速率 / 阈值可枚举，跨阈 = 2.7 个世界日，且 > 冻结轨迹 50 小时；
  3. 跨阈 → 吃饭目标 → 摊子上消费，读数回 0、打断 0；
  4. 存档里不出现 `hunger` / `lastMeal`。
- 闸门：`check` / `build` / 五道 audit + adr-schema / `pytest`（524 通过 1 跳过）/ `worktrees:audit --strict` 全绿；浏览器 `browser` / `phases` / `persistence` / `render-budget` / `setting` 通过。
- 未验证：`test:buttons`（同上：`/api/memory/list` 404，脚本退出码 2）。
- 真问题：`fromSave` 构造时 `now` 还是 0，若只在构造里锚 `lastMealAt`，读档即全员饿（实测决策从 480 变 484）；修法是读档后按 `world.now` 重锚。
- 被否掉的写法及原因
  - **为了让饥饿在冻结轨迹里真的触发而重录 `outer-two-days.json` 并重生成回归断言的指纹**：否。那会改断言/夹具，违反「不许改断言凑绿」；改为「第一版速率刻意慢 + 专项场景证明」，冻结读数逐字不变。
  - 把饥饿写进存档或快照：否，违反「不落档」；只保留运行时 `lastMealAt`。
  - 为吃饭新增 `announce` 种类（如 `ate`）：否，属于新增世界事实种类；只走 `routineLabel` / 决策日志，不 announce。
- 阻塞：无。
- 证据：`docs/evidence/needs/`（baseline / after / hunger-scenario / decisions-needs / manifest / 四道浏览器输出）。

---

## 块 4 · 失败原型：饿到顶 → 交付失败一次

- 开始 / 结束：2026-11-04 21:45 / 2026-11-04 22:12
- 分支：`feat/behavior-queue`，未 push、未动 main
- 改了什么结构
  - `needs.ts`：新增 `NEEDS_HUNGER_FAIL_THRESHOLD = 1`（与 0.9 的吃阈值分开枚举，跨阈行为都能单测）。
  - `Simulation` 新增运行时集合 `hungerFailedTasks: Set<string>`（同一单只失败一次；不落档、不进快照）。
  - 两个交付漏斗（`finishInPlace` 原地单、`finishActiveTask` 上游结算）在结算前各问一次 `deliveryFailsFromHunger`；命中即 `failDeliveryFromHunger`，复用 `finishInPlace` 的收尾形状：任务写**已有的** `failed`、`completedAt`、清 `blockedQuestion`、回 idle、清牌子、`nextRoutineAt +1600`、气泡 1400ms（「饿得手抖，没送到。」）。
  - 有楼的单把人挪回门口；原地单（`buildingId === null`）不动位置。不记交付、不加信仰、不发 `world.event`。
- 读数（`docs/evidence/needs/after-failure.txt`）
  - 三条指纹、事件数 50、记忆读数、绘制指令 16130 / Graphics 27 **全部与 baseline 相同**。
  - 冻结轨迹逐拍决策 480 条，sha256 `39aa269d…`，逐行 diff 0（`decisions-failure-diff.txt`）。原因：50 小时轨迹最高读数 0.694，两条新分支都够不着。
  - 专项场景（`failure-scenario.txt`）：饿到顶的那一单 `failed`、`deliveries.local = 0`、气泡含「没送到」；吃一口后再派一单 `done`、`deliveries.local = 1`，第一单仍是 `failed`。
- 新增测试（`test/needs-failure.test.ts`，2 条）
  1. 饿到顶 → 交付失败一次：走已有 `failed` 状态，交付数不涨，气泡说清原因；
  2. 吃一口之后再派一单能正常交付，同一单不会失败第二次。
- 闸门：`check` / `build` / `palette --strict` / `references --strict` / `citations --strict` / `sections --strict` / `claims --strict`（含 adr-schema）/ `pytest`（524 通过 1 跳过）/ `npm test`（2102 通过 0 失败 9 跳过）/ `worktrees:audit --strict` 全绿；浏览器 `browser` / `phases` / `persistence` / `render-budget` / `setting` 通过。
- 未验证：`test:buttons`（同上：`/api/memory/list` 404，脚本退出码 2，属环境限制）。
- **做到 / 没做到 / 没验证**
  - 做到：失败一次、走已有 `failed` 状态、交付数不涨、气泡、清牌子回 idle、同一单不重复失败、吃过后恢复、冻结读数逐字不变、不动存档契约。
  - 没做到：没有让「失败」进入正式事件流（`report.ts` 的失败数只从任务状态里算，`world.event` 不发）——按块 3 的约束，新增事件种类要先提案，本块没做。
  - 没验证：浏览器里的失败气泡在真实画面上的呈现（`test:buttons` 跑不起来，且没有专门的失败场景脚本）。
- 真问题
  1. quick 单的 `estimateMs` 是 300 秒，而测试窗口先写成 30 秒，导致「等了 30000ms 仍未落终态」。这是**测试窗口**的问题，不是交付漏斗的问题；窗口改成 400 秒后两条测试直接通过。没有放宽任何行为断言。
  2. 新增了一条回 idle 且无牌子的路口，`test/labelless-idle.test.ts` 的**源码计数**断言（`routineLabel = null` 出现次数 7 → 8）因此变红。这条断言守的是「路口数量」，数量真的变了：把计数与名单更新为 8 处 / 五个 idle 路口（加 `failDeliveryFromHunger`），注释写清第五条从哪来。行为断言一条没改。
- 被否掉的写法及原因
  - 新增事件类型或落档字段来记「这单失败过」：否。`TaskStatus` 早有 `failed`，运行期集合足够；落档会碰 v5 冻结契约。
  - 在 `stepIdle` 里统一「饿了就拒单」：否。失败要发生在**交付那一刻**，提前拒会让任务连 `working` 都进不去，行为和现在的链路对不上。
  - 直接删掉计数断言或改成 `>= 7`：否，等于把守门断言改绿；按真实数量更新并写清理由。
- 阻塞：无（`test:buttons` 仍属环境限制）。
- 证据：`docs/evidence/needs/`（`baseline.txt` 沿用块 3 的冻结基线；新增 `after-failure.txt` / `failure-scenario.txt` / `decisions-failure-after.txt` / `decisions-failure-diff.txt` / 五道浏览器输出 / `render-budget-failure.txt`）。

---

## 块 5 · 交付失败进正式事件流（新增 `delivery_failed`）

- 开始 / 结束：2026-11-05
- 分支：`feat/behavior-queue`，提交 `8f9e0cc`（未 push、未动 main）
- 提案：`docs/DELIVERY_FAILURE_EVENT_PROPOSAL.md`（先写提案再实现）
  - 种类与载荷：`world.event` 新成员 `delivery_failed`；`actorId`（谁）、
    `failure.taskId`（哪单）、`placeId` + `where`（在哪）、`failure.reason`（原因闭集
    `hunger`）、`failure.repeat`（是否重复失败）。
  - 三张权重表：重要度 0.70（`task_done` 0.45 / `street_help` 0.65 /
    `workshop_accident` 0.80 之间）、效价 -0.60（`street_water` -0.55 /
    `discipline` -0.60 / `workshop_accident` -0.70 之间）、唤醒 0.60
    （`street_tumble` 0.55 / `weather_anomaly` 0.70 之间）；每条都写了对照锚点，
    不是填空。`KIND_PRIORS` 四轴 0.65 / 0.70 / 0.60 / 0.20。
    默认四等权落点：当事人 0.7375（≥摘要线 0.6、<闪光 0.85）、
    旁观目击者 0.5375（≥写入线 0.3、<摘要线 0.6）。
  - 目击：复用 `perception.ts`（室内同房间、室外 8 格 + 遮挡）与 `hearing.ts`
    （缺省半径 6；6–8 格「看得见听不见」；屋内心者对外部事件「只听到、看不见」）。
  - report：失败数 = `snapshot.deliveryFailures.length`，不再数 `task.status`。
  - 存档：v5 不动（失败事实的持久副本在记忆段；`deliveryFailures` 是运行时投影）。
  - 指纹：只有世界指纹变（`projectWorld` 增列），记忆/造物不变。
  - 「不记这条会怎样」：基线 facts=47 / entries=45，`delivery_failed` 事实 0、
    目击者记忆 0、`outcome` fail/deny 0/47 = 0.0%；失败只留 `task.status='failed'`
    与 12 条窗口日志，读档后原因与目击者永久丢失。
- 改了什么结构
  - 客户端：`world-changes.ts` 闭集加 `delivery_failed`（`failure` 载荷类型放
    独立 `delivery-failure.ts`，避免服务端「`readonly taskKind:` 恰好一次」的
    值域锚点变成两处）；`types.ts` 加 `DeliveryFailure` 与 `WorldSnapshot.deliveryFailures`；
    `simulation.ts` 在 `failDeliveryFromHunger` 末尾组事件并 `announce`；
    `observe.ts` 三张表 + `status:'fail'` 的 outcome；`salience.ts` KIND_PRIORS；
    `trace/runtime.ts` 的 `projectWorld` 增列；`report.ts` 改数据源。
  - 服务端：`WORLD_EVENT_KINDS` 加项、`FAILURE_REASONS` 闭集、
    `_check_world_event` 对 `failure` 五个字段做单选校验（`failure` 只许
    `delivery_failed` 带）。
- 读数（`docs/evidence/failure-event/`）
  - 冻结轨迹 outer：事件 50（失败 0）、失败账 0、日报没办成 0 行（0 = 0）、
    事实 47（`delivery_failed` 0）、条目 45、fail/deny 0/47 = 0.0%。
  - 专项场景：失败事件 1、失败账 1、日报 1 行（1 = 1）、事实 1（fail/deny 1/1 = 100%，
    从基线 0/47 = 0.0% 到可见）、目击条目 2（v0 当事人 + v1 同在八格内）；
    吃一口后第二单 done，失败事件仍 1、失败账仍 1（第一单没有二次失败）。
  - 同种子两跑：失败账与世界指纹逐字相同（`test/needs-failure.test.ts` 第 3 条；
    场景指纹 `0717c031…` 两跑相同）。
- 指纹旧 → 新 → 为什么变 → 对应提交
  - 世界 outer `95ee830c…` → `a41f4e2e…`；世界 night `576259f5…` → `6efda574…`；
    原因：**新增事件种类**（`projectWorld` 增列 `deliveryFailures`，规范化 JSON 变）。
  - 记忆 `fb0847b3…` 不变；造物 `c5198f0f…` 不变：冻结轨迹最高饥饿 0.694 < 1.0，
    没有失败事件；造物不读事件流。
  - 输入摘要不变（`47412864…` / `ed7319b9…`）——输入没动，只重录投影。
  - 存档基线 `outer-baseline-v5.json` hash 不变（`6451bb8b…`）。
  - 两条轨迹的回归断言由 `trace:record` / `trace:to-test` 重生成，未手改期望值。
- 新增测试
  - `test/delivery-failure-event.test.ts`（5 条）：载荷五件事；`status:'fail'` 与
    三张权重；显著度落点（0.7375 / 0.5375，摘要/写入/闪光线）；
    室内失败只有同房间记得（worker+mate，1 事实 / 2 条目）；
    室外失败（两格看见、屋内只听到、远处看不见）。
  - `test/needs-failure.test.ts` 扩展：事件载荷与事件账逐项一致、日报 1 行；
    吃一口后仍只有 1 条失败事件；同种子两跑指纹逐字相同。
  - 服务端 `test_world_changes.py` 新增 7 条：白名单 201、缺 `failure` 422、
    非 `delivery_failed` 带 `failure` 422、`actorId` null 422、
    `reason/taskKind/repeat/taskId` 非法 422、`failure` 多字段 422。
- 闸门：`check`（语法 0 / 语义 0）/ `npm test`（2108 通过 0 失败 9 跳过）/
  `build` 通过 / `palette --strict` 0 / `references`（146 处行号 0 存疑，
  2433 处引用 0 未解析）/ `citations` / `sections`（158 处）/ `claims`
  （markers=5 passed=5，adr-schema files=9 valid=9）/ `pytest`（533 通过 1 跳过）。
- 浏览器：`browser` 125 / `phases` 17 / `persistence` 8 / `render-budget` 6
  （绘制指令 16130 / Graphics 27）/ `setting` 29，均在本块实现后跑过。
- 未验证 / 阻塞
  - `test:buttons`：`/api/memory/list` 回 HTTP 404，脚本退出码 2（既有缺口，未改代码）。
  - `worktrees:audit --strict`：本工作树没有该脚本（MODULE_NOT_FOUND），无法执行；
    此前记录的外部红（`pwe-anim` 未登记）本块未修。
  - 读档后报纸只数本会话新失败事件（提案 §6 已写明；事件本身在记忆段，不丢）。
- 真问题
  1. 服务端 `test_value_domains.py` 要求 `readonly taskKind:` 在 `world-changes.ts`
     中恰好一次；把 payload 嵌进事件类型时命中两处、闸门变红。修法是把
     `DeliveryFailurePayload` 移到 `delivery-failure.ts`，`world-changes.ts` 只剩
     一处引用 —— 没有改那条值域断言。
  2. `simulation.ts` 插入约 20 行导致 7 处文档行号引用漂移（`pickVenue` /
     `isRaining` / `scatterToShelter` / `startInPlace` / `WEATHER_ALREADY` /
     `tasks.push` 等），`audit-references` 变红；逐项更新为当前行号。
  3. `phase-purity` 的快照键清单少了 `deliveryFailures`：字段是真新增，
     清单加一项、注释 24 → 25；没有放宽断言。
  4. `audit-adr-schema` 不是独立脚本（`audit-claims` 内含 `adr-schema`），
     单独调用会 MODULE_NOT_FOUND —— 不是闸门失败。
- 被否掉的写法及原因
  - 新增独立的 `task.failed` change 种类：否。那样得再配一套权重与观测规则，
    离既有三张表更远；失败本来就该是「世界发生的事」。
  - 把「哪单/原因/重复」塞进 `text`：否，机器读不了；用 `failure` 子对象承载。
  - 为存档加字段或升 v6：否。事件持久副本在记忆段，运行时投影不必落档。
  - 为了让旧轨迹不红而去掉这条事件、或放宽任何既有断言：否。指纹变化按
    「新增事件种类」显式重录，旧的期望值没有一条被改小/改松。
  - 把探针脚本留在仓库：否。读数进 `docs/evidence/failure-event/probe.txt`，
    脚本跑完即删（未进提交）。
- 多线冲突收敛
  - payload 拼装与文案集中在独立 `delivery-failure.ts`；`simulation.ts` 只碰
    三处（运行时字段、失败漏斗末尾、`snapshot()` 一行），减少与另一条线
    「回家判成在室内」的冲突面积。
- 证据：`docs/evidence/failure-event/`（`baseline.txt` / `after.txt` / `probe.txt`）。
- 待办：无（浏览器失败场景仍未验证，见上）。
