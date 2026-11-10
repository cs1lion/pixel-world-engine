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

---

## 块 6 · 入口配色：理论压进 8 个 UI 位 + 首屏提示

- 开始 / 结束：2026-11-05 / 2026-11-05
- 分支：`feat/behavior-queue`（基于块 5 的 `088b026`），代码+读数提交 `c0a7749`，本记录为第二提交，未 push、未动 main
- 原文取用：链接抓取失败（小红书 300031/300011 登录/风控墙、xiaohongshu 404「请打开 App 扫码」、WebFetch 空）；
  用户随后粘贴了全文，按粘贴原文执行，不再抓链接、不凭标题猜。
- 结论先行：**深色一套装得进 8 位，浅色一套装不进**。
  - 11 级灰 → 5 级灰阶（base/panel/line/dim/ink）+ 1 个纸上墨字（paper-ink）= 6 个灰位；
  - 4 语义 × 2 层 → 1 对（--warn）+ 提示走中性 + 成功复用 --amber = 0 新色；
  - 合计仍是 8/8。浅色套至少要多 2 个 UI 位（浅面板、浅底次要文字），会让 strict 红，
    按纪律未自行扩预算/改审计，列为阻塞待批。详见 `entry-color/mapping.txt`。
- 压缩取舍（用实测，不拍脑袋）
  - 灰阶 Y：0.45% / 1.03% / 1.54% / 2.98% / 29.46% / 76.20%；L*：4.05 → 9.25 → 12.87 → 19.95 → 61.18 → 89.95。
  - 相邻 ΔL*：5.20 / 3.62 / 7.08 / 41.23 / 28.77，全部 ≥3（仓内既有「不可见」阈值）。
    诚实说：这是功能灰阶，不是等距灰阶；11 档等距在 8 位里做不到。
  - 对比度（WCAG 2.x，算法同 audit-palette）：主要字/底 14.90:1、/面板 13.46:1；
    次要字/底 6.32:1、/面板 5.71:1；不可用同 --dim 5.71:1；主按钮字/强调底 7.21:1；
    状态字/面板 5.91:1；边框/底 1.46:1、/面板 1.32:1（低于 3.0 非文本门槛，见真问题 1）。
  - 语义配对：提示没有蓝位 → 中性条（panel + line + ink，靠位置不靠色相）；
    成功没有绿位 → 复用琥珀（世界层本来就用它表示进度/亮灯）；
    警告不抢琥珀 → 与出错共用陶土 --warn，靠文案区分。
- 现状入口清单（改前，文件:行号，详见 `entry-color/entry.txt`）
  - `index.html:888` `#hud-load`；`index.html:913` `#status`；`index.html:902` `#stage`；
    `index.html:921-925` `#oracle` + `#utterance`；`index.html:1072` `#paper-clock`。
  - `main.ts:92` 世界在模块顶层同步建好；`main.ts:123` `new Phaser.Game`；`main.ts:142` 立即启动场景。
  - `SandboxScene.ts:793` preload（`?art=1` 时装位图素材）；`SandboxScene.ts:798` create；807/814 烘焙地形；881-884 镜头 delayedCall(0) 平移到祭坛；1069 setPhase；1081 默认时相；1072-1081 游玩时钟从 0 起算。
  - `SandboxScene.ts:798` create；807/814 烘焙地形；881-884 镜头 delayedCall(0) 平移到祭坛；
    1066 setPhase；1080 默认时相；1071-1080 游玩时钟与自动切换。
  - 默认时刻矛盾：报纸「第 0 分 00 秒」+ 天空按真实本地时相（正午）——未修（属 report/世界语义）。
  - 改前路径：0 次点击可见世界；聚焦(1) + 回车(2) 得到第一句回执；首屏没有任何「能做什么」的说明。
- 方案（代价排序）
  - A（采用，S）：纯 DOM——画布上方一行提示（第一次提交/第一次点画布即收起）、主按钮强调填充、
    次要按钮回中性、回执补成功色。只碰 `index.html` + `ui/shell.ts` + `ui/oracle-panel.ts`。
  - B（否，S）：自动聚焦输入框，2 步→1 步；抢焦点、移动端弹键盘，收益不抵副作用。
  - C（否，M/L）：默认时刻改「第 1 天 08:00」；改世界时钟语义 + 三指纹必变，和 simulation 线冲突。
- 改了什么
  - `index.html`：新增 `#entry-hint`（普通流、不叠画布、只用 var()）；`button.primary` 琥珀底 +
    纸上墨字（唯一强调落点）；`button.secondary` 面板底 + 边框；默认 hover 不再用琥珀；
    `#reply.good` 成功色；`#status` 初始文案具体化；日界提示 yes/no 分主次。
  - `ui/shell.ts:19-26`：提示条在首个 submit 或首个 pointerdown 收起（`once`、即时 hidden，无计时器/过渡）。
  - `ui/oracle-panel.ts:273`：`show(ok)` 同时切 good/bad。
  - 未动 `main.ts` / `SandboxScene.ts` / 世界语义 / 存档 v5 / `projectWorld`。
- 读数
  - `audit-palette --strict`：世界 24/24（超 0）、UI 8/8（超 0）、共享 1、并集 31，退出 0。
  - 同构建两跑（Playwright 假时钟 install + pauseAt + runFor 钉住 rAF）：
    首屏 1010×940 可见差(≥8)=0、精确差 max=0、有差 0/949400、字节相同；
    首次提交（点灯吧）同样 0/0/0/true；连跑 3 次稳定，A/B 无 JS 报错。
  - 入口路径：0 次点击可见世界；Ctrl+K(1) + 回车(2) 得到回执。
    世界时钟口径：首屏纸钟「第 0 分 06 秒」，首次提交「第 4 分 00 秒」（默认 60×，约 4 秒墙钟）。
  - `render-budget`：6 项通过，绘制指令 16130 < 30000、Graphics 27，相对基线 +0。
  - 九道闸门全绿：check 0 / test 2108 通过 0 失败 9 跳过 / build 0 / palette 0 /
    references 0 / citations 0 / sections 0 / claims --strict 0（adr-schema 9/9）/ pytest 0。
  - 浏览器：smoke 125、phases 17、persistence 8、render-budget 6、setting 29。
  - `test:buttons`：退出码 2，`/api/memory/list` 回 404（既有缺口，未改代码）。
  - 五禁忌逐条：鲜艳色 2 个（琥珀/陶土）→ 否；次要按钮不用强调 → 否；无 #000000 → 否；
    彩色底上用纸上墨字（7.21:1）→ 否；深色靠更亮的 --line 分层，不靠反色 → 否。
- 三指纹：世界 outer `a41f4e2e…` / night `6efda574…`、记忆 `fb0847b3…`、造物 `c5198f0f…`，
  与基线逐字相同（未碰世界层）。
- 真问题
  1. `--line` 对底 1.46:1、对面板 1.32:1，低于 3.0 非文本门槛；它不是唯一状态信号
     （焦点/选中用琥珀 8.65:1）。要修需要 1 个新色位 → 阻塞。
  2. 成功与强调共用琥珀：同一位置不并现，但无色相区分；独立绿位需扩预算。
  3. 警告与出错共用陶土，只能靠文案；「天本来就是晴的。」这种无操作被标成 bad 是既有分类，未改。
  4. 00:00 开局问题未修（report/世界时钟语义，留给下一块）。
  5. 首次提交依赖上游意图模型，dev 下会显示 HTTP 400 回执（既有）。
- 被否掉的写法
  - CSS transition/animation 淡出提示条：时长不可枚举，违反纪律 → 动作触发即时收起。
  - 提示条标签用琥珀：稀释唯一强调落点 → 标签 --dim、正文 --ink。
  - 提示条叠在画布上：破坏 canvas 包围盒与调色板截图 → 放到画布上方普通流。
  - 新增绿/蓝语义位：8/8 已满，必须扩预算 → 未做。
  - 自动聚焦输入框：抢焦点、移动端弹键盘 → 未做。
- 没做到 / 未验证
  - 浅色套（阻塞：需 UI 8→10；未自行扩预算或放宽审计）。
  - 00:00 开局问题；`test:buttons` 既有红。
  - 两跑像素比对只在本机 headless + 假时钟下成立（3 次复跑字节相同），
    未在真实 GPU / 不同字体 / 不同 DPR 的设备上验证。
- 证据：`docs/evidence/entry-color/`（`mapping.txt` / `entry.txt` / `palette.txt` / `contrast.txt` /
  `entry-diff.txt` / `entry-feedback-fail.txt` / `render-budget.txt` / `smoke.txt` / `phases.txt` /
  `persistence.txt` / `setting.txt` / `buttons.txt`）。

---

## 块 7 · 入口配色收尾：UI 8 → 9，第九位只给边框；浅色套放弃

- 开始 / 结束：2026-11-05 / 2026-11-05
- 分支：`feat/behavior-queue`；未 push、未动 main
- 结论：块 6 的两条阻塞中，**边框一条按批准修掉了**（`--line` 对底 1.46→3.49、
  对面板 1.32→3.15），**浅色一条经评估后放弃**。世界 24 色一格未动。
- 为什么只加这一位
  - `#2b322c` 对页面底只有 1.46:1、对面板 1.32:1，低于 WCAG 非文本 3:1；
    「深色靠浅边框分层」这条原则在旧值上只是勉强可见。上一轮 8/8 零余量，
    按纪律没自行扩，记成阻塞。本轮只批一个位，所以只修这一处。
- 改了什么
  - `index.html` 变量块：`--line` = `#666a62`（新位）；旧值不删，改名 `--line-faint` = `#2b322c`。
    `--line` 用于结构边线（顶栏、画布框、小地图、提示条、在手、神谕、输入框、按钮、状态条、
    各面板外框、kbd、气泡描边）；`--line-faint` 只用于面板内部细线/点线（面板头分隔、
    `.dbg-row` 点线、引用块左边线）——这些地方 3:1 实线会变噪音。
  - `scripts/audit-palette.mjs`：`BUDGET.ui` 8→9；`PROPOSED_UI` 加 `#666a62` 与角色说明；
    对比度段加 `line/base`、`line/panel`，并保留 `faintLine/*` 两项备查。
  - `test/palette-budget.test.ts`：`UI_BUDGET` 9、`UNION_BUDGET` 32、`PROPOSED_UI` 9 项，
    断言文案同步。
  - `src/world/palette-data.ts`：只改头部注释（9 色 / 并集 32）。
  - `docs/adr/ADR_PALETTE_24.md`：决策段 UI 附注 9 + 「浅色套经评估后放弃：无真实使用场景，
    不为不存在的界面占预算」；判据表 8→9、并集 31→32；10-27 的实测读数保留原文并加现测对照；
    文末加 2026-11-05 补记（为什么加、新边框读数、灰阶不等距口径、浅色套关闭）。
- 读数（详见 `docs/evidence/palette-9/`）
  - 色位并集：世界 24/24（引用 335）、UI 9/9（引用 183）、共享 1（`#e3a13c`）、
    并集 **32**、两层超出 0；`--strict` 退出 0。
  - 四条对比度（WCAG 2.x 相对亮度，算法同 `audit-palette`）：
    主要字/底 **14.90:1**（不变）、次要字/底 **6.32:1**（不变）、
    占位与不可用/面板 **5.71:1**（不变）、边框/底 **3.49:1**（旧 1.46，≥3.0）、
    边框/面板 **3.15:1**（旧 1.32，≥3.0）。
  - 灰阶不等距：按可用色位数压到 6 档，优先保证最低档 ≥3、文字档 ≥7:1，牺牲等距。
    ΔL* 实测 5.20 / 3.62 / 7.08 / 41.23 / 28.77，不重排；`#666a62` 是功能位
    （非文本 3:1），不插进这六档序列。
  - 同构建两跑（Playwright 假时钟冻结到 2026-11-05T12:00，`?time=noon&ledger=off`）：
    首屏整页 / 首屏画布 / 首次提交后整页 / 首次提交后画布 **四组 PNG 逐字节相同**，
    可见差(≥8)=0、精确差=0；A/B 报错 0。
  - 三枚指纹：世界 `a41f4e2e…`、记忆 `fb0847b3…`、造物 `c5198f0f…` 与基线逐字相同；
    夜雨那条世界指纹 `6efda574…` 在其单测里同样通过。
  - 九道闸门全绿：check 0 / test 2108 通过 0 失败 9 跳过 / build 0 / palette --strict 0 /
    references 0 / citations 0 / sections 0 / claims --strict 0 / pytest 0。
  - 浏览器：smoke 125、phases 17（EVAL_OUT 指到 tmp，未写 `eval/screens`）、persistence 8
    （存档 v5 / 14984 字节）、render-budget 6（指令 16130、Graphics 27，相对基线 +0）、
    setting 全项 ok。`test:buttons` 退出 2（`/api/memory/list` 404，既有缺口，未改代码）。
  - 截图基线：跑闸门时 `eval/screens/` 被脚本重写，已 `git checkout` 还原，未进提交。
- 真问题
  1. 第一次并跑五个浏览器脚本时 `render-budget` 的「回到前台恢复满帧」失败
     （恢复 47.0 vs 前台 57.0）；单独重跑通过（50.0 / 52.0）。是并跑帧率噪声，不是颜色回归。
  2. 60× 加速下 3:1 的边框在小地图与 1px 实线上仍偏细；再亮一档会与次要文字（5.71:1）抢。
     没有第 10 个位之前不调。
  3. 浅色套仍无实现；本轮把它从阻塞降级为「明确不做」（无使用场景）。
- 被否掉的写法
  - 直接把 `--line` 换成 `#666a62`、丢掉 `#2b322c`：UI 仍是 8 色，拿不到批准的第九位，
    且面板内点线会变得刺眼 → 保留为 `--line-faint`。
  - 新边框取 `#63675f`：对面板 3.01:1，贴门槛没有余量 → `#666a62`（3.15）。
  - 把新边框插进六档灰阶并重排 ΔL*：违反「不重排」→ 只作功能位记录。
  - 重排灰阶求等距：9 位预算做不到 11 级等距，且会牺牲文字档 → 保留不等距并如实标注。
- 没做到 / 未验证
  - 真实 GPU / 不同 DPR / 不同字体下的两跑像素一致性未验证（仅本机 headless）。
  - `test:buttons` 既有红；`#clock-align-check` 默认 disabled 未动。
- 证据：`docs/evidence/palette-9/`（`audit.txt` / `palette.txt` / `contrast.txt` /
  `diff.txt` / `fingerprints.txt` / `gates.txt` / `smoke.txt` / `persistence.txt` /
  `render-budget.txt` / `setting.txt` / `buttons.txt`）。

---

## 块 8 · 疲劳与睡眠（原型线第 6 块，本轮只做疲劳）

- 开始 / 结束：2026-11-05 / 2026-11-05
- 分支：`feat/behavior-queue`；未 push、未动 main；未占 5188/5191/5202/5203
- 原型线顺序：**疲劳 → 社会结构 → 经济**。这一轮只做疲劳，社会结构与经济未动。
- 结构（纯值对象 + 纯函数，与 `needs.ts` 的 `hungerAt` 同构）
  - 新文件 `src/world/fatigue.ts`：常量 `NEEDS_FATIGUE_PER_DAY = 1/2`（两个世界日 0→1）、
    `NEEDS_SLEEP_DECAY_PER_DAY = 4`（0.8→0 要 0.2 天 = 4.8 小时）、
    阈值 `NEEDS_SLEEP_THRESHOLD = 0.8`、醒线 `NEEDS_WAKE_THRESHOLD = 0`、
    跨阈间隔 `NEEDS_SLEEP_CROSS_MS = 1.6 天`（= 阈值/速率，纯算术）。
    纯函数四个：`fatigueAt`（清醒线性升 / 睡着线性降，clamp [0,1]）、
    `fatigueReadingOf`（`{fatigue, sleepy, asleep}`）、`sleepCrossedAtMs`（跨阈的确切时刻）、
    `wakeUpAtMs`（这一段睡到何时醒）。
    不读 `Date.now()` / `performance.now()` / `Math.random()`；不落档。
  - **不进 `EnvironmentFrame`**：那是世界环境（天气/时刻），疲劳是某个人的状态。
  - 行为走已有规则表：`behavior.ts` 的 `kind` 加 `'sleep'`、`BehaviorContext` 加 `sleepGoal()` 口子；
    `behavior-rules.ts` 新增 `SLEEP_RULE`，登记顺序
    `verification → pre-cover → sleep → eat → routine`——`sleep` 排在 `eat` 之前，
    睡着的人不会因为饿了被拽起来。`Simulation` 主循环结构未改（仍是「问规则表 → 拿第一个目标」）。
  - `simulation.ts` 新增三个运行时字段（挨着 `lastMealAt`）：
    `lastRestAt`（每人上次睡醒的世界时刻）、`asleepSpans`（睡着段的起点 + 入睡疲劳）、
    `sleepLog`（跨阈/入睡/醒来三时刻）。构造与 `fromSave` 都把 `lastRestAt` 重锚到 `world.now`
    （读档不继承疲劳、不继承没睡完的觉），`asleepSpans` / `sleepLog` 清空。
    `sleepGoal()`：跨阈 → **就地睡**（落点 = 脚下这一格，`path` 清空）；
    `nextRoutineAt` 直接拨到 `wakeUpAtMs(span)`，所以一整段觉只记 **1 条** `sleep` 决策；
    到点 → `wakeUp()`（撤牌、补 `wokeAt`、`lastRestAt = now`），同一拍返回 `null`
    把决策交还给 eat/routine——没有第三个分支。不 announce（睡觉不是新的世界事实，与吃饭同纪律）。
  - 状态可见性用**已有字段**：`routineLabel = "实在熬不住，就地睡下了"`，由
    `src/ui/unit-status.ts:327` 的 `villager.routine ?? '没有接活'` 原样上屏；
    不新增快照字段、不新造渲染概念。
  - **未跨分支引用**：`homecoming` / `homesOf` 在 `src/` 下 grep **0 次**。
    「睡觉必须回家」在本版不成立，先做就地睡；与回家线（`feat/interior-view`）的对接
    是**显式后续依赖**，本轮不写代码。
- 判据读数（详见 `docs/evidence/fatigue/`）
  - 跨阈次数与时刻：**2 次**（两个村民各一次），都在 **228,240,000 ms = 第 2.6417 个世界日**。
    入睡 v1 229,320,000 / v0 229,560,000（跨阈后 18 / 22 世界分钟——跨阈是算出来的，
    入睡是「下一次重排」真被看到的第一拍，不是迟滞）；醒来 246,780,000 / 247,020,000。
  - 睡眠段长度分布：两段 **4.85 h / 4.85 h**，差 0.00 h。段长不是写死的：= 入睡疲劳 / 4 天，
    可手算。跨阈前一个睡眠窗无（第 1.04 → 2.64 天之间没到阈值）。
  - 完整回路一次（跨阈 → 入睡 → 醒来）：229,320,000 入睡（`kind:'sleep'`、落点 56,33、无 path、
    牌子上屏），睡着 **4.85 h** 疲劳按 4/天递减、人不动，246,780,000 醒来（疲劳 0、`asleep:false`、
    牌子清空）同一拍回到 `routine`；决策行 `229320000|v1|sleep|sleep|56,33|-|-`（整段只有这一条）。
  - 同种子两跑：`trace:replay` 两次，世界 / 记忆 / 造物三枚指纹各两次逐字相同，且与重录值一致。
  - 480 条决策 diff：**480 → 468**（净 −12）。被删的旧行 36 条全是 `routine`；
    新增 24 条 = `sleep` 2 + `routine` 22；永久少掉 14 条 `routine`（4.85 小时睡觉窗口里本会排的作息）。
    逐行 diff 起点第 445 条（229,320,000，v1 入睡那一拍）。
    夜雨轨迹 2 条决策 digest 逐字不变（`5aa11118…`）——那里才第 12 分钟，离 1.6 天很远。
  - 存档：**v5 不动**，`src/world/save.ts` 一行未改；`test/fatigue.test.ts` 直查 `toSave()` 的 JSON，
    确认没有 `fatigue` / `lastRest` / `asleep` / `sleepLog` / `sleepSpan` 任一字样。
    浏览器 `test:persistence` 8 项通过，存档仍是 v5。没有升 v6。
  - 九道闸门：check 0 / test **2113 通过 0 失败 9 跳过**（旧 2108 + 新增 fatigue 5）/
    build 0 / palette --strict 0 / references **154 处 0 存疑**（插入 74 行后逐条重指；含本条记录）/
    citations 0 / sections 0 / claims --strict 0 / pytest 0。
  - 浏览器：smoke 125、phases 17（EVAL_OUT 指到 tmp，未写 `eval/screens`）、persistence 8、
    render-budget 6（指令 16130、Graphics 27）、setting 全项 ok；
    `test:buttons` 退出 2（`/api/memory/list` 404，既有缺口，未改代码）。
  - 截图基线：跑闸门时脚本重写 `eval/screens/` 16 张，已 `git checkout` 还原，未进提交。
- 旧 → 新（为什么变，逐项见 `docs/evidence/fatigue/fingerprints-old-new.txt`）
  - 世界 `a41f4e2e…` → `20cd773b…`（变）：两人第 2.64 天跨阈、第 2.65 天就地睡下、
    第 2.86 天醒来，此后作息整体后移 4.85 小时。终局的业务读数（day / buildings / tasks /
    deliveries / weather / faithPoints / eventCount=50）逐项与旧值相同，变的是**过程时刻**与
    末尾位置/牌子。
  - 记忆 `fb0847b3…` → `8712bf39…`（变）：条数逐项相同（facts 47 / entries 45 / claims 38 /
    beliefs 11 / traces 5 / landmarks 2 / bonds 1 / moods 2 / written 6），变的是同一批事实被
    写下的**时刻**。
  - 造物 `c5198f0f…` **不变**：日终 2 次 / 提议 3 条 / 落地 1 栋，与睡眠窗无交集。
  - 夜雨世界 `6efda574…` **不变**：轨迹只到第 12 分钟，`sleep` 一次都不命中。
  - 事件数仍 50、没有新增事件种类；重录 `traces/outer-two-days.json` +
    用 `scripts/trace-to-test.ts` 重新生成 `test/trace-regression-outer-two-days.test.ts`
    （头注「不要手改」），理由只有一句：**新增 `sleep` 行为规则**。
- 真问题
  1. 跨阈 → 入睡有 18/22 个世界分钟的差：规则只在「她空下来重排」的那一拍才被问
     （`nextRoutineAt` 闸门）。这不是迟滞，是作息把下一次重排排在了那里；
     没有为此把睡眠塞进每拍轮询（那会让决策条数爆炸）。
  2. 全量测试里 `daily-prop-cost` 在并行负载下偶发红（135ms > 50ms）；单独连跑两次 3/3 通过。
     本块每计划拍只多一次 Map 读，记为噪声，未改阈值。
  3. `test:buttons` 的 2 是既有缺口（`/api/memory/list` 404、`#clock-align-check` 默认 disabled），
     未为变绿改代码。
- 被否掉的写法
  - 每 1.6 秒重排一次 `sleep`：一整段觉会记几十条决策、把 480 条决策序列冲烂
    → `nextRoutineAt = wakeUpAtMs(span)`，整段只记 1 条。
  - 睡觉必须回家 / 去客栈：需要跨分支引 `homecoming` / `homesOf`（未合入）→ 就地睡 +
    写成显式后续依赖。
  - 把疲劳塞进 `EnvironmentFrame`：「世界的环境」与「某个人的状态」混层 → 独立 `fatigue.ts`。
  - 睡着时把 `kind` 改成 `'routine'` 或复用 `eat`：语义错、面板读不出 →
    新 `kind:'sleep'`，状态走既有 `routineLabel`。
  - 为保住旧指纹去调速率/阈值：违反「不许为指纹扭逻辑」→ 速率按「两日到顶、1.6 天跨阈」定，
    接受世界/记忆指纹变、重建基线。
  - 升 v6 落档疲劳：疲劳与 `lastMealAt` 同类，是运行时投影 → 不落档，v5 不动。
- 没做到 / 未验证
  - **与回家线对接（睡觉必须回家）未做**：显式后续依赖，等 `feat/interior-view` 合入后另起一块。
  - 真实浏览器里长跑观察一次完整睡眠画面（牌子出现 → 4.85 小时后清空）未录屏；
    面板字段已由单测与 `unit-status.ts:327` 的引用确认，但没有肉眼截图。
  - 睡眠期间是否该有可见的动作/姿态（现在人站着不动）未做——那属于渲染概念，需另立设计。
- 证据：`docs/evidence/fatigue/`（`baseline.txt` / `decisions-old.txt` / `decisions-new.txt` /
  `decisions-night-old.txt` / `decisions-night-new.txt` / `decisions-diff.txt` /
  `readings.txt` / `fingerprints-old-new.txt` / `gates.txt` / `smoke.txt` / `persistence.txt` /
  `phases.txt` / `render-budget.txt` / `setting.txt` / `buttons.txt`）。



---

## 块 9 · 收进 main：merge（12 提交原样）+ 两套睡眠裁决 + 指纹先定位后定基线


- 开始 / 结束：2026-11-05 / 2026-11-05
- 分支：`feat/behavior-queue`（worktree `D:\project\pwe-lively`）；**不 push、不改 main**
- 做法：**merge 不用 rebase**，`origin/main` 的 `416eb8b` 合入，12 个原型提交 SHA 原样保留
- 冲突：**18 个路径**（`MERGE_MSG` 留证），逐处处理见下；第四类未覆盖语义 **0**
  1. `README.md`：claims 计数按实测重填（`test-file-count=270`）
  2. `docs/adr/ADR_PACK_SKIPS_WORLD_BUDGET.md`：行号按合并树重指（load 162-479 / saved 416-424 /
     simulation 2284 / pickVenue 2158、2452 / pack 134、237-242）
  3. `docs/adr/ADR_PALETTE_24.md`：两段补记都留（main 2026-11-04 + 分支 2026-11-05），UI 9
  4. `server/tests/test_world_changes.py`：两边测试取并集（`delivery_failed` + 市面四拍）
  5–7. `eval/screens/dengchao-*.png` 三张：两边都不取，代码定稿后用 setting 闸门重生成
  8. `scripts/smoke-ego.mjs`：行号重指（isRaining 2763、3078 / scatterToShelter 2414）
  9. `src/scenes/SandboxScene.ts`：帧读法（`environment({phase,autoAdvancing})`）；
     `forcedPacked ?? (stallsPackedFor(env) || preCoveredToday())`；`pinnedTide ?? env.tideLevel`；
     删掉未用的 `observationOf` import（`creator/ledger.ts` 的别名仍在用）
  10. `src/world/simulation.ts`：`routineFor(frame,beats,index,shelter)` 四参、`hasEnvironment(frame,'quiet')`、
      `fogKeepsClose(frame)` 全部按帧；`routineGoal` 的 quiet 统一成「写 main 的牌子 + `return {kind:'quiet'}`」；
      夜休/黎明登记成 `rest` 规则（`!hasExplicitRoutine` 守卫）；`sleepGoal` 补 `hasExplicitRoutine` 守卫
  11. `src/world/villager-words.ts`：行号 2206 / 2446 / 2154
  12. `test/surface.test.ts`：2019 / 2636
  13–14. 两条 trace 回归测试：**代码定稿后**用 `scripts/trace-to-test.ts` 重生成（头注「不要手改」）
  15. `test/village-coverage.test.ts`：858
  16. `test/villager-words.test.ts`：同 2206 / 2446 / 2154
  17–18. `traces/outer-two-days.json` / `night-rain-build.json`：**代码定稿后**重录
- 裁决 A 落地（两套睡眠共存，所有权写死）
  - 顺序：`verification → pre-cover → sleep → rest → eat → routine`（`DEFAULT_BEHAVIOR_RULES`）
  - 疲劳睡写「实在熬不住，就地睡下了」，独占 `routineLabel` / `nextRoutineAt` 到醒来；
    醒后清空交还。定时夜休 `restGoal` 只在没有疲劳睡占用时生效（`asleepSpans` 判据 + `!hasExplicitRoutine`）
  - 单测：「设定集自带作息的世界里疲劳睡不得触发」（`test/fatigue.test.ts`）
  - **22:00 翻牌修正**：`settleForTheDay` 醒着时把 `nextRoutineAt` 拨到闭市那一刻，
    睡着才拨 05:20。否则合并初版 21:00 写一次「歇下」就整夜不再翻牌（见下「真问题」）
- 裁决 B 落地（先定位，后定基线）
  - 基准 = main `32ba01e7…` / 52 事件；合并后 `0663b93f…` / 52 事件，`eventDigest` 两边都是
    `baad0768…`，逐条事件（seq / 时刻 / 文案）**完全相同**：新增 0 / 消失 0 / 后移 0
  - 世界指纹差的**唯一来源**：本分支 `8f9e0cc` 的 `deliveryFailures` 进了 `projectWorld`。
    终局投影去掉该字段 = `32ba01e7…`；step 0 去掉 = `474d9b96…`（= 基准 step 0）
  - 记忆 `0604c712…`、造物 `c1c83fb2…`（业务 2 / 3 / 1）与基准**逐字相同**
  - 新基线：世界 `0663b93f…` / 记忆 `0604c712…` / 造物 `c1c83fb2…` / 夜雨 `2cb7cdb0…`（不变）
  - 同种子两跑：`trace:record` 的 `verifyTrace` 两次回放，三枚指纹逐字相同（683.1ms / 683.6ms）
- `sleep` 决策：默认轨迹 **0 条**（定时夜休每黎明 05:20 清零疲劳）。
  受控场景 `docs/evidence/merge-main/sleep-scenario.ts` 真睡一次：crossedAt 0 / sleptAt 6,000 /
  wokeAt 17,292,000（4.85h），睡中牌子「实在熬不住，就地睡下了」，两跑 stdout 的 7 行
  逐字相同（不记绝对文件 hash：Windows/CRLF 与 LF 口径会改 sha，读数以 7 行为准）
- 闸门：check 0 / test **2336 tests、2327 pass、0 fail、9 skipped** / build 0 /
  palette --strict 0（世界 24/24、51 引用；UI 9/9、**202 引用**；并集 32；`--line` 3.49 / 3.15）/
  references 172 处 0 存疑 / citations 0 / sections 159 对得上 / claims --strict 0 / pytest **554 passed**
- 浏览器：smoke 全项 ok / phases 17 项 / persistence 8 项 / render-budget 6 项
  （指令 15514、Graphics 28）/ setting 全项 ok；`test:buttons` 60 个按钮 0 个不说话，
  2 处既有审计缺口（`clock-align-check`）照旧记录、未改
- 存档 v5：`save.ts` diff 0 行；`toSave()` 与 main 逐字相同（仅 CRLF 差异）；`outer-baseline-v5.json` diff 0 行
- 决策：442 条（初版 438，+4 = 22:00 再问一拍 × 2 天 × 2 人），digest `b190aecb…`，
  kind 分布 rest 346 / garden 22 / river 20 / promenade 18 / altar 16 / market 10 / quiet 10
- 真问题（合并初版 → 修法）
  1. 三段 02:00 事件牌面是「祭坛边歇下」而非「睡下了」：main 的定时夜休在 `nextRoutineAt`
     闸门之前每拍调用 `settleForTheDay`，合并后它排进规则表、在闸门之后；21:00 醒着写一次
     就把表拨到 05:20，22:00 不再被问。修法见「22:00 翻牌修正」，修完三处文案差归 0
  2. `audit-references` 两处行号漂：`DOC_GOVERNANCE_REPORT.md` 753→816、
     `memory/config.ts` 引的 `observe.ts` 那处（旧指向 73，现 222）
  3. `audit-claims` 红：README 263 vs 实测 270 → 270
  4. `eval/ledger.json` 的 `script_sha` 首次填错，按 `scripts/audit-palette.mjs` 内容实测
     重算为 `5fea2fbe…`
  5. `func-daily-l2` 红：疲劳睡落在非安静段，非安静离场率 1.02 < 1.2 → 夜休黎明分支写
     `lastRestAt = now`（疲劳清零），恢复 54 / 1.23；默认轨迹从此不再触发疲劳睡
- 没做到 / 未验证
  - 默认种子里「疲劳睡」只是一条 0 命中的规则；功能验证靠受控场景，不算端到端自然发生
  - 睡眠姿态、回家睡、两套睡眠/两套钉法合并——见 `docs/OPEN_ISSUES.md` §D
- 证据：`docs/evidence/merge-main/`（`palette.txt` / `fingerprint.txt` / `decisions.txt` /
  `decisions-night.txt` / `sleep-scenario.ts`）

---

# 进入室内 · 分块进度（feat/interior-view，2026-11-06 合入）

> 以下块号是内景线内部的编号，与上面 main 的块号不是同一序列；原文照录。


分支 `feat/interior-view`（基于 `feat/env-frame` 的 `d353c26`）。每块独立证据目录，
基线先落盘再改；下文三档分开写：**做到的 / 没做到的 / 未验证的**。

---

## 块 1 · 拆屋顶层 + 进门推进过渡 + 单层内景 + 门退出

- 证据目录：`docs/evidence/interior-view/`（`INDEX.md`、`shots/`、`readings.json`、`analysis.json`）
- 改动：
  - `src/render/buildings.ts`：屋顶/烟囱拆成独立 `roof` Graphics（绘制顺序不变）
  - `src/render/interior-layout.ts`：纯函数——房间尺寸、`wallSeed`、家具布局、过渡进度（固定 18 帧）
  - `src/render/interior-view.ts`：烘焙内景 + 暗场，屏幕坐标（`scrollFactor 0`、`scale=2/zoom`），深度 20000+
  - `src/ui/interior-view-store.ts`：视图状态只写 `pwe.interior.view`，读档只清不还原
  - `src/scenes/SandboxScene.ts`：进门/退出状态机、相机推进、门与楼梯命中、街景 DOM 浮层隐藏、`?interior=instant|step`
  - `scripts/interior-capture.mjs`、`scripts/interior-analyze.py`：取证与读数
  - `test/interior-view.test.ts`：9 条布局/种子/过渡用例

### 验收读数

| 项 | 读数 |
| --- | --- |
| 街景 → 室内 Graphics / 指令 | 27 / 16130 → 30 / 16152（**+3 / +22**） |
| 过渡 | 18 帧；中点帧 `frames=9`、`mode=entering`、相机 `484/352` |
| 往返位姿 | 1 次与 10 次都读到 `528/416/zoom 2`，逐字相同 |
| 真点门退出 | `mode=street`，位姿与进门前逐字相同 |
| 真点楼梯 | 反馈帧数 60（截图时剩 29） |
| 内景唯一色数 | 13（≤ 24）；调色板外 **0** |
| 冻结 1 秒 | **0 像素差**（573 476 px 全同） |
| 三枚指纹 | `trace:record` / `trace:replay` 两次逐字相同、与录制一致 |
| 存档 | v5、`3ca5663faee59423` 未动 |

### 真问题（已修）

1. 内景「缩在左上角」= 世界相机 zoom 下的**裁切**，不是摆歪 → 改屏幕坐标。
2. `cameraCenter` 原本按 `width/(2·zoom)` 算错：Phaser 的中心是 `scroll + width/2`（与 zoom 无关）。
3. 室内点击全灭：`pointerdown` 在室内提前 return，没清 `pressMoved`。
4. 冻结帧 1032 px 差：DOM 人名/小地图压在内景上并继续动 → 进屋隐藏。
5. 唯一色数 321：半透明叠色产出调色板外 RGB → 内景改全不透明。
6. 指令增量读 0：Graphics 塞进 Container 后 `renderStats()` 数不到 → 改数组。
7. 取证点门点空：`locator.screenshot()` 滚动视口 → 每次点击前重读 `boundingBox()`。

### 没做到的

- 楼梯不切层（下一块）。
- 只目视验了 `code_forge` 的内景；民居/档案楼只有单测覆盖布局，没拍图。

### 未验证的

- `npm run test:browser`：第 31 项后「等交付」超时。该流程不经过内景；实测 120 s 只走
  1.81 M ms 世界时间，而 code 活需 1.8 M ms，**预算卡在边界**（既有用例的时间余量问题）。
- `npm run test:buttons`：`/api/memory/list` 回 404，数据源缺，按纪律标未验证。

### 闸门

`check` ✅ / `test` 2099 通过 0 失败 ✅ / `build` ✅ / `audit-palette` ✅ /
`audit-references` ✅ / `audit-sections` ✅ / `audit-citations` ✅ / `audit-claims` ✅（README 测试文件数 223→224）/
`adr-schema` ✅ / `test:persistence` ✅ / `test:phases` ✅ / `test:render-budget` ✅ /
`trace:record` + `trace:replay` ✅ / `test:browser` ❌（见上） / `test:buttons` ⚠️ 未验证

### 阻塞

无阻塞。块 2 的入口：楼梯坐标已登记在 `interiorLayoutFor`（`stairs` 矩形），
点击已经在 `InteriorView.hitTest` 里分流；切层只要把 `floor` 变成状态、用
`interior:<instanceId>:f<floor>` 再烘一张即可——不需要动世界状态与 v5。

---

## 块 2 · 楼梯切层（仍只给看）

- 证据目录：`docs/evidence/interior-view-block2/`（`shots/`、`readings.json`、`analysis.json`）。
  注意：块 1 的 `interior-view/shots` 被这一轮的取证脚本**覆盖过**，块 1 的读数以本文件与
  `interior-view/INDEX.md` 里记的数值为准；这是本块的流程失误，后续块不再复用同一目录。
- 改动：
  - `src/render/interior-layout.ts`：`interiorFloorsFor(building)`（按剪影派生层数）、
    `InteriorLayout.floor/floors/stairUp/stairDown/canUp/canDown`、`stairDirectionAt()`、
    `INTERIOR_SWITCH_SWAP_FRAME = 9`、`interiorSwitchOpacity(frames)`（两端 1、中点 0）
  - `src/render/interior-view.ts`：`show(..., floor)`、`setFloor(floor)`（换 key 重烘）、
    `stairDirectionAt()`、`flashStairs(direction)`（上/下箭头落在被点的那一段）、
    `setRoomOpacity(alpha)`（只淡房间、不淡暗场）、层标（左上角 4px 方块，亮起几块 = 第几层）
  - `src/scenes/SandboxScene.ts`：新增 `'switching'` 态、`switchInteriorFloor(delta)`、
    `settleInteriorFloor()`、`interiorFloor/interiorSwitchTo`；`interior()` 增读
    `floor/switchTo/floors/canUp/canDown/stairUp/stairDown/occupants`
  - `scripts/interior-capture.mjs`：逐帧推进的切层取证、真点两次上下楼、顶层/底层越界反馈
  - `scripts/interior-analyze.py`：第 2 层色数、切层中点黑场、两层像素差
  - `test/interior-view.test.ts`：新增 6 条（层数派生、越界夹取、上下两段、边界可上可下、
    中点不透明度、楼上无灶）

### 验收读数

| 项 | 读数 |
| --- | --- |
| 层数来源 | `code_forge#1` 剪影 `gable` → **2 层**（flat=1 / gable=2 / tower=3，纯视图读法） |
| 真点上楼 | 楼梯上半 → 第 2 层，过渡 **18 帧**（`switchUp.frames=18`，无超时） |
| 真点下楼 | 楼梯下半 → 第 1 层，**18 帧**（`switchDown.frames=18`） |
| 顶层再点上半 | 楼层仍为 2，只闪提示（`hintFrames=58`），**不绕回底层** |
| 底层再点下半 | 楼层仍为 1，只闪提示（`hintFrames=25`） |
| 切层中点 | `frames=9`、`mode=switching`、贴图 `alpha=0 / visible=false`；截图室内区 **1 色**（`#14110d`，只有 ink 暗场） |
| 第 1 层色数 | **13**（≤24），调色板外 **0** |
| 第 2 层色数 | **12**（≤24），调色板外 **0**；包围盒与第 1 层逐字相同 `934×614 @ (17,11)` |
| 两层画面差 | **38 944 px** 变化（包围盒 `40,42 → 864,566`）：灶台消失、家具重摆、层标多亮一格 |
| 切层相机 | 前后 `440/288/zoom 2` **逐字相同** |
| 屋里此刻有谁 | `occupants = []`（`insideAt` 现取），内景按**空房间**画，不摆假人 |
| Graphics / 指令 | 街景 30 / 16130 → 第 1 层 30 / 16145 → 第 2 层 30 / 16145；同页切层增量 **0 / 0** |
| 往返位姿 | 1 次与 10 次往返都回到 `528/416/zoom 2`（`poseRoundTrip = PASS`） |
| 冻结 1 秒 | **0 像素差**（573 476 px，`?interior=instant`） |
| 三枚指纹 | `trace:record` / `trace:replay` 两次逐字相同、与录制一致（世界 `95ee83…`、记忆 `fb0847…`、造物 `c5198f…`） |

> 块 1 的「+22 指令」有一处旧读数偏差：那时室内 `actorG` 里残留了一个 7 指令的人形图元
> （`show()` 只重置了签名、没有清缓冲区）。本块把 `actorG.clear()` 补进 `show()` 后，
> 室内指令稳定在 **16145**，相对街景的真实增量是 **+15**（+3 Graphics + 15 指令）。

### 做到的

1. 楼梯一竖两段：上半 = 上楼、下半 = 下楼；两段不重叠，点哪段走哪段。
2. 切层是视图状态：`interiorFloor` 只在内存与 `pwe.interior.view` 独立键里，**不进 v5**；
   读档仍回街景。
3. 每层一张烘焙图（key = `interior:<instanceId>:f<floor>`），家具按 `seedAt(wallSeed, floor)` 派生；
   楼上不画灶，层标亮起格数 = 层号。
4. 切层过渡与进出场同一套：固定 18 帧、第 9 帧换图；只淡房间、保留暗场，
   中点截图是纯 ink，换图看不见接缝。
5. 边界不循环：顶层再上 / 底层再下只闪对应那一段 60 帧，楼层不动。
6. 切层后相机与指令数不动（同页增量 0 / 0），退回底层的读数与上楼前逐字相同。

### 没做到的

- 楼上仍然共用同一个门框作为出口（`door` 每层都在原位）。这是**视图层的出口约定**，
  不是「楼上真有一扇门」；要做得更真，得让出口从楼梯走回底层，属于交互范畴，本块没改。
- 只有 `code_forge`（gable，2 层）拍了图。tower 的第 3 层只有单测覆盖，**没拍图**。
- 层标是 4px 方块，不写数字/文字——够截图判读，但不是玩家能读懂的 UI。
- 楼层只影响「看」，不影响世界：屋里的人不按层分、楼上没有独立居民。

### 未验证的

- `npm run test:browser`（smoke）：与块 1 同一处「等交付」超时风险；本块重跑结果见下方闸门。
- `npm run test:buttons`：服务端活着但 `/api/memory/list` 回 **404**，数据源缺，按纪律标未验证。

### 真问题（都修了）

1. **第 2 层整张截图全黑**：`setFloor` 新烘的 `Image` 没有继承 `scrollFactor 0`，跟着相机 scroll
   跑出屏外。补在 `bake()` 里（新贴图创建时立刻设 `scrollFactor 0`）。
2. **中点露出街景**：沿用进场的 `setReveal` 会把暗场一起收掉，切层中点变成「透过地板看大街」。
   新增 `setRoomOpacity`：只淡房间（贴图/人/提示），暗场留在 ink 上。
3. **指令数一次性 −7**：`show()` 只重置 `occupantSignature`/`occupantIds`，没清 `actorG`；
   一个旧人形图元会跨进屋留到第一次换层才被 `setFloor` 清掉。补 `actorG.clear()`。
4. **层标被调试按钮盖住**：层标原放右上角，正好压在 `#debug-toggle` 的 DOM 矩形里；
   移到左上角（`x=8,y=8`）。

### 被否掉的写法

- **切层复用 `entering/exiting` 两个态**：进场要从街景淡出，切层必须留在屋里；
  共用一套 `setReveal` 会把街景翻出来。最终保留 `switching` 独立态 + `setRoomOpacity`。
- **点楼梯循环切层**：顶层再点就往底层绕——用户会以为「点坏了」。改成越界只闪提示。
- **把层数写进 `PlacedBuilding` / 存档**：本块不需要世界知道楼层；一旦写进去，
  寻路、目击判定、v6 与夹具全要跟着改，超出「只给看」的范围。
- **切层换图放在帧 0 或末帧**：帧 0 换会看到旧图熄灭、新图亮起前的空档；末帧换会闪一帧旧图。
  中点是唯一看不见接缝的位置。

### 阻塞

无阻塞。块 3 的入口：`Oracle.interior()` 已带 `occupants`（`insideAt` 现取），
连续往返与冻结帧的取证脚本沿用 `interior-capture.mjs` 的第 8 段。

---

## 块 3 · 进出场的边界情形

- 证据目录：`docs/evidence/interior-view-block3/`。
- 代码改动：**只有一处**——`Oracle.interior().buildings[]` 多暴露一个 `zone`，
  让取证脚本能按「民居 / 工业」挑楼；世界逻辑、存档、渲染都没有动。
- 读数（全部来自 `interior-capture.mjs` / `interior-analyze.py` 的同一轮输出）：

| 判据 | 读数 |
| --- | --- |
| 连续进出 10 次 | 每次都 `528/416/zoom 2`，10/10 `matches=true`，与初始街景位姿逐字相同 |
| 退场后位姿 | 点门退出后 `528/416/zoom 2`，`poseAfterDoorMatches=true` |
| 关闭过渡后冻结 1 秒 | `frozen-a` 与 `frozen-b` **0 像素差**（573 476 px） |
| 过渡开关关闭时进出 | `?interior=instant`，进场/出场/切层都直接落位，无中间帧 |
| 空房间 | 中午 `code_forge#1`、夜里 5 栋民居（橡木/灰泥/石砌/远郊/山脊）逐个进门，`occupants` 全为 `[]`；内景按空房画 |
| 指令预算 | 室内 16145 < 30000；Graphics 30 不变 |

### 做到的

- 空房路径：连续 10 次往返位姿逐字回原点、冻结帧 0 差、过渡开关关闭后无中间帧。
- 「不造假人」：房间的人只从 `insideAt`（`!visible` 且占地判到本楼）取，取证时取不到就不画。

### 没做到的

- **「屋里有谁」这条只验到空房**：夜里 5 栋民居、中午工业楼，`insideAt` 都没有人。
  模拟里只有 `working` 时才会 `visible=false`（`simulation.ts:4017`），而本机没有上游派活
  （`/api/memory/list` 404），所以这一天里没有人真的进屋。**有人时的站位/配色没有被验证**，
  也没有为了让截图好看去伪造在场者。

### 未验证的

- 有人在屋内的渲染（座位分配、人数 > 座位时的门口站位）——原因同上，缺真实在场者。

### 阻塞

- **非阻塞但挡住了「有人」验收**：需要一条真实的上游派活（或模拟里让居民回家也置
  `visible=false`）。前者属服务端数据、后者会改世界语义，都不在本块授权范围内，记在这里等决定。

---

## 块 4 · 多栋楼的内景注册（验证现有入口，不新增楼型模板）

- 证据目录：`docs/evidence/interior-view-block4/`。
- 注册方式：**每栋楼按实例自动注册**，键是 `interior:<instanceId>:f<floor>`；
  墙体、窗、楼梯、门位共用同一张 232×152 剖面模板，家具与灶口由 `wallSeed(building)`
  与层号派生。没有按楼型分模板，也没有把楼层写进世界状态。
- 读数：

| 楼 | 剪影 / 层数 | 首层色数 | 调色板外 | 与 `code_forge` 的画面差 | Graphics / 指令 |
| --- | --- | --- | --- | --- | --- |
| 橡木小屋 `cottage_oak#1` | gable / 2 | 12 | 0 | 38 672 px | 30 / 16145 |
| 石砌小屋 `cottage_stone#1` | tower / 3 | 12 | 0 | 37 536 px | 30 / 16145 |
| 远郊农舍 `homestead_far#1` | gable / 2 | 12 | 0 | 38 656 px | 30 / 16145 |
| 石砌小屋第 3 层 | — | 12 | 0 | 39 040 px | — |

- 三个房间的包围盒都是 `934×614 @ (17,11)`，即同一套屏幕位置；差异只在墙内内容。
- 塔楼 `canUp=false` 落在第 3 层，说明楼层夹取的上边界与剪影层数一致。

### 做到的

- 换楼就换图：不同 `instanceId` 各自一张烘焙图，家具按 `wallSeed` 重摆；
  三栋楼的画面差异都在 3.7–3.9 万像素量级，不是同一张图复用。
- 塔楼第 3 层实拍：`floor=3 / floors=3 / canUp=false`，色数与调色板约束都成立。

### 没做到的

- **按楼型分剖面模板**没做：目前所有楼共用一张剖面（同宽同高、同窗位），
  只有家具/灶口不同。分模板是美术扩充（比如农舍更矮、塔楼更窄），不是机制缺口；
  用户划的边界也只到「每类楼一张剖面模板 + wallSeed 家具」，本块只做到后半句。
- 多楼层世界态没做（居民不按层生活、寻路不认楼层），与块 2 的边界一致。

### 未验证的

- 无新增未验证项；「有人时的内景」仍未验证，原因见块 3。

### 阻塞

- 无代码阻塞。要再往前一步（按楼型分剖面 / 居民分层），必须先决定是否动世界状态与 v6。

---

## 闸门（块 2–4 之后重跑）

| 闸门 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test` | 2114 个用例，2105 通过、9 跳过、0 失败 |
| `npm run build` | 通过 |
| 五个审计（palette / references / sections / citations / claims） | 5/5 通过 |
| `test:persistence` / `test:phases` / `test:render-budget` / `test:setting` | 全部通过 |
| `trace:record` / `trace:replay` | 通过；三枚指纹两次逐字相同 |
| `test:browser` | **通过**（退出码 0，尾部用例全 `ok`；块 1 的「等交付」超时本轮未复现） |
| `test:buttons` | **未验证**：`/api/memory/list` 回 404，数据源缺失 |

---

## 结论（块 2–4）

- 做到：楼梯两段切层、每层一张烘焙图、18 帧切层过渡、上下层边界夹取、多栋楼换图、
  塔楼第 3 层实拍；楼层始终只在视图态与 `pwe.interior.view`，v5 未动。
- 没做到：每类楼的独立剖面模板、居民按层生活、有人时的内景渲染。
- 未验证：`test:buttons`（服务端数据缺）。
- 下一步入口（只判断不动手）：要验「有人」必须先有真实在场者——或接一条上游派活，
  或让模拟在夜间把回家的居民也置 `visible=false`。后者会改世界语义，需要单独拍板。

---

## 块 5 · 回家的人真的进屋了（**世界语义变更**，提交 `7169a7d`）

- 证据目录：`docs/evidence/homecoming/`——`readings.json`（逐拍轨迹/目击/记忆/两跑确定性）、
  `shots.json`（浏览器实拍与渲染读数）、`analysis.json`（色数/调色板外色）、`shots/*.png`。
- 语义变更，不是视图层：入夜（22:00–06:00）居民**先走到自家门口格**，下一拍位置落进
  住宅占地、`visible = false`；天亮在门口格重新出现。外面的人看到的是
  「走到门口 → 进屋消失」。世界真值、目击口径、记忆条数都随之改变。

### 改了什么（提交 `7169a7d`）

| 文件 | 改动 |
| --- | --- |
| `src/world/homecoming.ts`（新） | 家 = 居住分区按 `instanceId` 排序、按 id 派家；入夜/天亮时刻；占地中心格；事件文案。纯函数，不碰世界状态 |
| `src/world/simulation.ts` | `stepIdle` 顶部接 `stepHomecoming`；新增 `homeOf / stepHomecoming / enterHome / wakeAtHome / ensureAwake`；5 处 `visible` 过滤（街面落点、活跃度、空闲块、应答神谕、派活前叫人）；import 一行 |
| `src/world/world-changes.ts` | `WorldEventKind` 增 `'home_entry'`（与 `routine_done` 分开：后者是作息完成，前者是空间状态翻转） |
| `server/events/world_changes.py` | `WORLD_EVENT_KINDS` 同步 |
| `src/world/memory/observe.ts` | `home_entry` importance 0.4 / valence 0.1；**显式 `indoor: false`**（见下文目击） |
| `src/world/memory/salience.ts` | `KIND_PRIORS.home_entry = {emotion .4, surprise .4, goalRelevance .55, involvement .15}` → 0.375 ≥ 0.3 门槛 |
| `src/scenes/SandboxScene.ts` | ① `interior()` oracle 的 `buildings[]` 增 `occupants`（只供取证）；② `?debug=1&now=HH:MM` 把**模拟时钟**钉住（见「真问题 1/5」） |
| `test/homecoming.test.ts`（新，6 条） | 翻转时机与占地位置、天亮门口、夜里被叫名从门口出来、无住宅不进屋、两跑逐字、**门口按室外记账** |
| `test/labelless-idle.test.ts` | 清牌子 7→8、路口 4→5（`wakeAtHome` 是新增的合法清牌子点）——语义变更导致的诚实计数，不是顺手更新 |
| `README.md` | `test-file-count` 224→225（新增一个测试文件） |
| `scripts/homecoming-trace.ts`（新） | headless 逐拍取证 + 两跑确定性 + 快照 sha256 |
| `scripts/homecoming-capture.mjs`（新） | 浏览器实拍室内有人；等「有人的家」用**轮询次数**，不读墙钟 |
| `scripts/homecoming-analyze.py`（新） | 色数/调色板外色/bbox |

### 逐拍轨迹（`readings.json`，cottage_oak#1 / v0）

格式：拍, 世界分钟, visible, x, y, routine

```
57,1317,1,50,34,去街口   58,1318,1,51,34,去街口   59,1319,1,52,34,去街口
60,1320,1,52,34,回家     61,1321,1,51,34,回家     62,1322,1,50,34,回家
63,1323,1,50,35,回家     64,1324,1,50,36,回家     65,1325,1,50,37,回家
66,1326,1,50,38,回家     67,1327,1,49,38,回家     68,1328,1,49,39,回家
69,1329,1,49,40,回家     70,1330,1,49,41,回家     71,1331,1,49,42,回家
72,1332,1,49,43,回家     73,1333,1,49,44,回家     74,1334,1,50,44,回家
75,1335,1,51,44,回家     76,1336,0,52,42,在家里歇下了
77–120：一直 0,52,42,在家里歇下了
```

- **翻转时刻 = 第 76 拍 / 世界 22:16**；翻转前最后一拍（75）站在**门口格 (51,44)**。
- 翻转后位置 **(52,42)** 在住宅占地内（占地中心），`visible = false`。
- 没有在街角消失：60–75 拍逐格从街口绕到门口，第 76 拍才翻。

### 屋内与人（验收 1、2）

- `occupants`：`cottage_oak#1:[v0]`、`cottage_plaster#1:[v1]`，其余三栋 `[]`。
- 室内实拍 `shots/interior-occupied.png`：**14 色**，**调色板外 0 色**（空房 13 色，+1 就是人）；
  bbox 934×614 @(17,11)；`renderStats` 17112 条指令 / 30 个 Graphics（预算 30000）。
- 同机位夜街 313 色（灯光合成会出调色板外色，属既有）；与块 4 的白天 16145 条不可直接比，
  本块是夜里（灯光/雨幕叠加）。

### 目击读数（验收 3）

- 翻转那一拍，门外街上只有 v1：pos (49,51)，Chebyshev **7** 格、欧氏 **7.28** 格（≤ 8），`visible = true`。
- v1 记忆里读到的是「莞尔走进了橡木小屋，门在身后合上。」（`home_entry`），salience **0.375**，
  tier `day`；**没有**「她还在街上」这类事实。v0 自记同一条 0.5875；v1 自记 0.5875。
- 接线要点：`home_entry` 的 `where` 是**门外那格**，`placeId` 绑住宅。生产的 `placeIndoor`
  只看 `placeId`，会把这一幕判成室内（只剩她自己看得见）。所以 `observationOf` 对它
  **显式写 `indoor: false`**；`test/homecoming.test.ts` 用「街上七格外 true / 屋内 false」
  两条钉住。取证脚本用**与 `SandboxScene` 一字不差**的 `placeIndoor`，读数仍成立。

### 感知口径：改与不改的依据

| 模块 | 改？ | 依据 |
| --- | --- | --- |
| `weather-witness` | 不改 | 已按 `visible` 排除（=「没进屋」）；进屋后自动不参与户外观测 |
| `perception` | 只加 `home_entry` 的 `indoor:false` | `inside` 每拍按占地算，进屋后自动成立；缺的不是判据，是事件落点的室内外标注 |
| `hearing` | 不改 | 进屋不发声音（`home_entry` 只进记忆，不发声）；「室内外按 `inside` 分」在位置落进占地后自然正确 |
| `privacy` | 不改 | `writeMode` 与位置无关，私密写入规则不变 |

### 指纹新旧对照（验收 4）

| 轨迹 | 旧读数（录制值） | 新读数 | 为什么变 | 对应提交 |
| --- | --- | --- | --- | --- |
| outer-two-days 世界 | `95ee830c…` | `95ee830c…`（两跑逐字相同） | **不变**：LEGACY_PACK `placements: []`，回放里只造出 `star_archive`/`code_forge`，没有 `living`；`homesOf` 空 → `homeFor` null → `stepHomecoming` 立即 false | `7169a7d` |
| 记忆 | `fb0847b3…` | `fb0847b3…` | 同上，无 `home_entry` | `7169a7d` |
| 造物 | `c5198f0f…` | `c5198f0f…` | 同上 | `7169a7d` |
| 大世界夜间（本块新基线） | 世界真值里没有「进屋」这件事 | 新增 `home_entry` 事件与 3 条记忆；快照 sha256 `5dfc40b3…` 两跑相同 | **语义变更**：回家真的把人在世界真值里置为屋内 | `7169a7d` |

`npm run trace:replay`：`replayable`——世界/记忆/造物三枚指纹两次逐字相同，且与录制值逐项一致。
**没有替换既有夹具**：受影响的是「有大世界住宅的夜间」这一场景，既有夹具里没有它；
本块为它**新录**了 `readings.json` 作为基线。没有任何旧夹具被改写成新值。

### 计数变化（验收 6，逐项）

| 项 | 旧 | 新 | 为什么 |
| --- | --- | --- | --- |
| `business.buildings`（trace） | 2 | 2 | 回放里两栋楼都不是住宅；回家不增删楼 |
| 事件条数（trace） | 50 | 50 | 同上 |
| facts / entries / claims / beliefs | 47 / 45 / 38 / 11 | 同 | 同上 |
| 大世界建筑数（persistence） | 11 | 11 | 回家不改建筑；摆件 2、雾 38 也不变 |
| 大世界记忆（本块取证 21:00→23:00） | 0（旧语义夜间无新事实） | 3 条记忆 + 2 件 `home_entry` | 语义变更 |
| 用例数 | 2114（2105 通 / 9 跳） | 2120（2111 通 / 9 跳） | +6（`homecoming.test.ts`） |
| 测试文件数 | 224 | 225 | 新增一个文件；README claim 同步 |

### 遇到的真问题

1. **`?time=` 只改画面，不改模拟时钟**：页面从世界 00:00 起跑。有了回家语义后，
   一开门两名居民就各回各家，前六分钟街面变空；`test:browser` 后半段所有「户外的她」断言
   也因此落空。处理：加调试层参数 `?debug=1&now=HH:MM` 把模拟起点钉住，回归脚本改成
   `time=noon&now=10:00`（12:00–14:00 是安静段，全镇坐着，「自己走动」等不到，故用 10:00）。
   **断言一条没动**，只是让脚本的时间前提和它自己注释里说的一致。
2. **「在屋里永远不接活」是过度设计**，并且当场把 `test:browser` 弄红：第二单派给睡着的 v1
   永不接手，脚本死等 120 秒。改成**被点到名的人先从自家门口出来再出发**（`ensureAwake`
   在派活三条路径上都调用）；翻转仍在门口格完成，不是街角凭空出现。
3. **门口的室内外标注**：生产 `placeIndoor` 只看 `placeId`，会吞掉门口这一幕（见上）。
4. `test:buttons` 仍因 `/api/memory/list` 404 无法验证（既有缺口，**未改代码**）。
5. `eval/screens/*.png` 被浏览器闸门重写，且**四个时段全都有约 42% 像素差异**（含正午），
   无法归因到回家（正午没有居民进屋）；属既有底图漂移，**未提交**，也没有写成「顺手更新」。

### 被否掉的写法

1. **在街角直接 `visible=false`**：用户硬约束禁止；也会让「门口目击」的落点变成街角，8 格口径失真。
2. **给 `Villager` 加 `homeId` / 新增 `mode:'inside'`**：要升存档 v6，寻路/渲染/夹具全要跟着改；
   家纯派生即可，`save.ts` 的 v5 白名单本来就含 `visible`（`test:persistence` 8/8 通过）。
3. **复用 `routine_done` 表达进屋**：那个事件是「作息做完」，与「空间状态翻转」的目击/显著度不同。
4. **把事件锚点放进占地**：那就真成室内事件，街上的人看不见，验收 3 直接不成立。
5. **为让目击一定写入而把 `home_entry` 抬到传说级**：改的是记忆口径，不是本块目的；
   0.375 已过 0.3 门槛，实测写入。

### 做到 / 没做到 / 未验证

- 做到：逐拍走到门口才翻转；占地内 `visible=false`；`occupants` 非空并实拍；
  8 格内目击读到「进屋」；同种子两跑逐字相同（sha256 `5dfc40b3…`）；
  `npm test` 2120（0 失败）、`test:browser` 125/125。
- 没做到：同一栋楼多人同住的站位（每户目前只有 1 人）；不同住宅的起床错峰。
- 未验证：`test:buttons`（`/api/memory/list` 404，退出码 2）；
  `SMOKE_TIME=dawn|dusk|night` 的整套回归（夜里居民在家，后半段断言天然不成立，已不再当作全绿口径）。

### 闸门（块 5 之后重跑）

| 闸门 | 结果 |
| --- | --- |
| `npm run check` | 语法 0 / 语义 0 |
| `npm test` | 2120 用例：2111 通过 / 9 跳过 / **0 失败** |
| `npm run build` | 通过 |
| 五个审计 | palette、references（146 处 0 存疑）、citations、sections（158 处）、claims（5/5）+ adr-schema 9/9 全过 |
| `test:persistence` | 8/8（v5、11 栋、摆件 2、雾 38） |
| `test:phases` | 17/17 |
| `test:render-budget` | 6/6 |
| `test:setting` | 通过 |
| `trace:record/replay` | `replayable`，三枚指纹两次逐字一致且等于录制值 |
| `test:browser` | **125/125 通过**（`time=noon&now=10:00`；断言未改） |
| `test:buttons` | **未验证**：`/api/memory/list` 返回 404（退出码 2，既有缺口，未改代码） |

### 阻塞

- 无代码阻塞。**待你拍板**：新世界/新存档的模拟起点仍是 00:00（夜里），
  是否要把开局挪到白天——这会影响所有「开局街面」的观感与存档起点，我没有擅自改。


## 块 6 · 抓拍口径自证（第 0 步）：四时段过、smoke 未过，熔断 ①③ 命中

详细清单见 `docs/evidence/SCREENS_CAPTURE_GATE.md`，逐张原始读数见 `docs/evidence/screens-capture-gate.json`。

### 改了什么（只动抓拍口径与调试钩子，世界语义零改动）

- `world-client/src/scenes/SandboxScene.ts`：新增 `pinnedClock` 与 `update()` 里的冻钟分支（`sim.update(0)` + 正常重绘），
  以及 `jumpWorldClock(minuteOfDay)` / `freezeWorldClock()` / `unfreezeWorldClock()` / `worldClockPinned()` 四个只读调试钩子。
  **没有碰 `simulation.ts`**（那条线有人在改）。
- `world-client/scripts/lib/capture.mjs`（新）：`waitFadeSettled`（画布内左下角 26×26 草地取样，连续 3 帧字节相同即收敛，上限 6 s）、
  `waitVillagersSettled`（pos/visible 连续 3 拍不变）。
- `world-client/scripts/check-phases.mjs`：开局 `setCameraMode('free')` + `centerCameraOn(祭坛)` 钉取景 → 等居民落定 →
  `jumpWorldClock(35)`（00:35）+ 冻钟 → 压暗层探针；night-rain 雨前先探针、雨后固定 3000 ms。
- `world-client/scripts/smoke.mjs`：01–06 钉相机；07/08 在 12:30 静段等两人空闲 → 冻钟 → 相机钉 `(768,576)`；
  08 循环前把 `overflowY` 钉成 `scroll`（修 400% 那张 16px 尺寸漂移）；把"展开注入区"移到过滤截图之前、
  把 `feed` 与 `ext-1` 注入移到解冻之后（冻钟期间注入的活永远做不完，会把"等两人空闲"拖黄）。
- `world-client/eval/screens/`：**一张未动**（没有重录）。

### 第 0 步两次读数（判据：可见差 = 任一通道 ≥8 级的像素占比）

四时段（`43eb9c9` worktree，只加调试钩子，两跑）：

| 图 | 精确差 | 可见差 |
| --- | --- | --- |
| phase-dawn / noon / dusk / night | 0.00% | 0.00% |
| phase-night-rain | 39.51% | 1.30% |

新树复测：四刻仍 0.00 / 0.00；night-rain 1.62% / 0.62%。

smoke 13 张（同一棵 HEAD `eae8553` 两跑，B1 vs B2，均 130 项全绿）：

| 图 | 精确差 | 可见差 |
| --- | --- | --- |
| 01-salute | 25.10% | **24.765%** |
| 02-working | 8.66% | 0.186% |
| 03-deliver | 50.44% | **1.128%** |
| 04-rain | 0.06% | 0.063% |
| 05-build | 0.01% | 0.005% |
| 06-faith | 10.42% | 0.085% |
| 07 四张 | 12.95–12.98% | 0.099% |
| 08 三张 | 35.37–36.48% | 0.151–0.152% |

08 三张尺寸两跑一致：`964×643 / 1931×1285 / 3904×2569`。

### 熔断

| 熔断 | 命中 | 说明 |
| --- | --- | --- |
| ① 两次可见差 >0.2% | **是** | 01 = 24.765%、03 = 1.128% |
| ② 探针 6 s 不收敛 | 否 | 四刻探针 496–578 ms 收敛；night-rain 雨前 962 ms |
| ③ 07/08 钉死后仍不同 | **是** | 可见差 0.099%（判据要求 0）；差异是同一世界上两个 32–44px 小物件，`bestShift=0` |
| ④ 重录后冒出原本没有的渲染变化 | 不适用 | 没有重录 |

### 诊断（都不是回归）

- **01-salute**：`bestShift=(0,0)`、HUD 0 差 → 没有整体位移；差异集中在暗色地面/植被（蓝通道恒 +9），
  石墙区均值 ≈0；再叠人物 1–2px 落脚差。归因 **d**（抓拍时刻差一个世界分钟 → 环境染色档位不同）。
- **03-deliver**：可见差异只有 1 个 104×170 区域，坐标恰好是烟囱烟柱；粒子按帧发射 + 1.4 s 生命周期，
  冻世界时钟也停不下 `scene.update` 的粒子推进。归因 **d**（活动粒子）。
- **07/08**：两跑同位置的两个小物件"时有时无"，属按世界毫秒走的装饰动画相位；不是面板文本/时间戳（HUD 像素 0 差）。

### 做到 / 没做到 / 未验证

- 做到：四时段在未改世界代码的树上一连两跑 exact/vis 全 0；smoke 两次都 130 项全绿；08 尺寸钉死；
  所有抓拍等待的实际毫秒都落进日志（四刻 29.75–30.06 s，其中居民落定 29.25–29.48 s、压暗层 0.50–0.58 s）。
- 没做到：第 3 步（逐张旧/新 sha256 与重录）、第 4 步（四道复跑）**均未执行**；基线一张未改。
- 未验证：01–06 加压暗层探针 + 固定分钟钉钟能否把 01 压到 ≤0.2%；坐定后跳到固定分钟再冻能否让 07/08 到 0；
  03 的烟能不能靠"冻钟后等 1.4 s 再拍"消掉；`check-phases` 有一次在 dawn 后中断（重跑即全绿，原因未查明）。

---

## 块 7 · `01-salute` 两跑归因：性质 = 代码/状态，不是 GPU（已修，基线待重录）

- 证据目录：`docs/evidence/salute-nondeterminism/`（`01-NONDETERMINISM.md` + 逐张 diff JSON + 探针原始记录 + 开关矩阵）
- 目标：**同构建、同机器、同脚本，两跑可见差必须为 0**

### 性质判定

**代码/世界状态不确定，不是浏览器/WebGL/GPU。**
01 的抓拍落在「等 `#reply`」之后，世界在 `speed=30` 下继续跑；两跑停在不同世界时刻 →
潮位跨过草地淹没阈值（`TERRAIN_HEIGHT.grass = 0.3`）→ 整片草地多一层 `ink + water`（蓝通道恒 +9）；
同时两个居民还在走，精灵位移 1–2px。

### 证据链（哪一步排除了哪一半）

| 步 | 做法 | 结果 | 排除了什么 |
| --- | --- | --- | --- |
| 1 | 像素归因 | 235,124 px（24.765%）中 92% 是 `(45,59,46)→(46,63,55)`，四块草地矩形；石板/墙 0 差 | 排除整屏滤镜/调色板/编码 |
| 2 | 潮位扫描（同进程 7 个世界时刻） | 草地色随 `tide.level` 单调变化（0.027→`(45,59,46)`，0.977→`(34,45,42)`） | 定位到潮位覆盖层 |
| 3 | 算术复核 | level 刚过 0.3：压暗 0.05 + water α 0.138 → `(46,64,55)` | 与观测色对一致 |
| 4 | `gl.readPixels` vs PNG | 逐字节相同 | 排除截图链路（DPR/合成/编码） |
| 5 | 同进程冻钟隔 3 s 连拍 | exact/visible 0.0000%、maxdelta 0（两个进程都 0） | 排除每帧渲染抖动/量化/浮点 |
| 6 | 跨进程冻钟（差 1 个逻辑步） | exact 24.2368%、visible 0.1045%（992 px 全在小人/气泡） | 证明差异只来自「冻在哪一拍」 |
| 7 | 开关矩阵：硬件 GL vs SwiftShader | 同状态 A1/A2、跨后端 A1/A1′ **全部 0.0000%** | **彻底排除 GPU/驱动/ANGLE/MSAA** |
| 8 | 代码审查 | 渲染路径无 `Math.random`/`Date.now`/`performance.now`；bake 用整数 hash；无最近色浮点比较；相机 `scrollX/Y=528/416` 整数 | 没有「渲染本身不确定」的点 |

### 修法（最小，夹具，不动判据/基线/世界语义）

- `SandboxScene.ts`：新增 `pinnedPresentedNow` / `pinnedTideLevel` 与 `pinShotState()` / `unpinShotState()`，
  `renderSnapshot` 里 7 个跟时间走的调用点改用 `presentedNow` / `tideLevel`（钉住时才生效）。
- `smoke.mjs` 01 段：**看到两个人都站定** → 就地 `freezeWorldClock()` + `pinShotState(当天 12:30, 潮位 0)` →
  钉相机 → 提交 → 行礼 → 拍照 → `unpinShotState()` + `unfreezeWorldClock()`。
- 判据、阈值、`eval/screens/` 基线**一个没动**；存档 v5 未动。

### 读数（同构建、同机器、同脚本）

| 阶段 | 01 精确差 | 01 可见差 | maxdelta |
| --- | --- | --- | --- |
| 修前 B1 vs B2 | 25.096% | **24.765%**（235,124 px） | 220 |
| 修前 A2 vs B1（参考） | 26.103% | 25.727% | 212 |
| 修后第一版 run1 vs run2 | 0.0000% | 0.0000% | 0 |
| 修后第一版 run1 vs run3 | 1.0248% | 0.9495% | 220 |
| **修后最终 run4 vs run5** | **0.0000%** | **0.0000%** | **0** |
| **修后最终 run4 vs run6** | **0.0000%** | **0.0000%** | **0** |
| **修后最终 run5 vs run6** | **0.0000%** | **0.0000%** | **0** |

三跑 13 张全部算过；01 之外的镜头仍有同类残余（见下）。

### 被否的写法

1. 只 `freezeWorldClock()`：冻在哪一拍仍随机，跨进程冻钟仍差 0.1045%。
2. 只冻在「看到行礼那一拍」+ 钉呈现态：两跑 0、第三跑 0.9495%（另一个角色阿雾还在路上，多走约 4px）。
   → 必须等「两个人都站定」。**这条也说明「两跑为 0」可能只是运气。**
3. `TideOverride` 压潮位：上限 2 分钟世界时间（`speed=30` 下 4 秒实时），压不住，且会改 HUD 文案与事件语义。
4. 只改相机：镜头本来就在整数格，差异不在镜头。
5. 调慢 `speed`：摊薄概率，不是确定性。
6. 放宽可见差判据 / 改 Δ 阈值：明令禁止。

### 做到 / 没做到 / 未验证

- 做到：性质判定与证据闭环；01 三跑两两个 0（exact 与 visible 都是 0、maxdelta 0）；SW/HW 同状态逐字节相同。
- 没做到：其它镜头没修 —— 06-faith 三跑里两对 10.4%（同一对草地色，潮位阈值）、04-rain 两对 10.1%（相机取整跨格平移 16px）、
  03 烟柱 0.87–1.84%、07/08 0.05–0.16%。
- 没做到：01 的**构图变了**（等站定的几十秒里莞尔被作息带到齿轮塔，原基线在祭坛边）→ **01 基线必须重录**。
- 未验证：`test:phases` / `test:persistence` / `test:render-budget` 三门没跑（改动只在钉住分支与 01 抓拍段）；
  跨天场景（`dayStart` 平移）未验证；`pinShotState` 无单测。

### 阻塞（给下一步的输入）

- **不能开始整套重录**：01 可以重录，但 06/04/03/07/08 还会翻；要么先把同一套夹具推过去，要么明确接受这些镜头非零。
- 01 若要保留祭坛构图，需要把世界时钟拨到「两人都在锚点且莞尔在祭坛」的确定时刻（本轮没做）。

## 块 8 · 剩余 12 张的「钉住可复现性」：世界侧全绿，剩下全是动画与截图链路（只测不改）

- 口径：`PIN_SHOTS=1`（`smoke.mjs` 的环境开关，默认关闭，正常抓拍一字未改）。逐张冻世界钟 +
  `pinShotState(当天 12:30, 潮位 0)` + 镜头钉整格，拍完解钉解冻；`07/08` 保持原口径不加钉。
- 三跑：run1 / run2 / run3，同构建、同机器、同脚本、端口 5210。**未重录基线、未改阈值、未动存档 v5。**
- 证据：`docs/evidence/pin-shots/01-REPRO-MATRIX.md`、`diff-pinned-3runs.json`（含新增的"结构差"：
  可见差掩膜的 8 连通块、最大块面积/bbox/尺寸）、`crops/`（逐块三行对比图）、`day-scan.json`、`composition.json`。

### 性质判定（按用户五类）

| 类 | 张数 | 图 |
| --- | --- | --- |
| 甲 钉住即 0 | 1 | 01-salute |
| 乙 同病因（时刻/潮位/相机未钉干净） | **0** | —— 钉住时刻+潮位后草地色阶差全部消失 |
| 丙 位置量化（跨格 16px） | **0** | —— 逐整数平移搜索最优位移全是 dx=0,dy=0 |
| 丁 内建动画 | 4 | 02、03（烟柱）、04（雨丝）、05（烟柱细股） |
| 戊 其它 | 8 | 06（底栏世界时钟文字）、07×4（画布半像素 + 面板文字）、08×3（合成器 1 级差 + 元素截图尺寸不稳） |

关键数字：

- 02：三对可见差 0.3253 / 0.3269 / 0.3834%，最大块 58×120 @[624,193]，裁图确认是烟柱。
- 03：0.5410 / 0.4807 / 0.4554%，104×66 @[610,69]，同一根烟柱。
- 04：0.0169 / 0.0079 / 0.0209%，一根雨丝 + 底栏"第 N 分 SS 秒"数字。
- 05：0.0312 / 0.0512 / 0.0293%；run1↔run3 另有 58,552 px（6.2%）**只差 1 级**（合成器半像素）。
- 06：0 / 0.0384 / 0.0384%；所有块都在底栏时钟（run1/run2 同为 893 分 30 秒 → 0）。
- 07：run1 是离群跑（16.52%/4.12%，画布左边缘 13×640 竖条），run2↔run3 只有 0.175%/0.140%
  （面板事件行文字）；12% 画面只差 1 级 → 合成器重采样。
- 08-100：35.2% 精确差里 212,578 px 只差 1 级；08-200 宽度三跑 1935/1931/1935；08-400 宽度 3920/3920/4008，
  run1↔run2 可见差 37.79%、最大块 3,301,512 px → 元素截图拼接不稳。

### 口径建议（不实现）

- 乙：钉 `presentedNow` + `tide.level`（本轮已做）；代价是画面固定在 12:30/退潮，快照仍报真实值。
- 丙：只能钉相机整格 / 精灵落点；代价是镜头不再跟拍，构图最多偏一格。
- 丁：只能降级成结构判据（存在性 + 面积区间）或把 `renderSnapshot` 的 `delta` 也冻成 0；
  降级损失是动画颜色/形状回归会漏。
- 戊：底栏时间钉死或隐藏；`#stage` 整数定位或只截元素；`08` 固定视口 + 常驻滚动条。
  **这一条只能靠夹具兜住，不能靠判据。**

### 01 构图结论

- 存在确定的"状态"，**不存在只由时刻决定的时刻**：同一 07:05，扫描路径落到 (48,36)/(40,40)，
  一次直达却落到 (40,40)/(56,33) —— 作息走 `routineIndex`，不看 `now`。
- 可用路径：`jumpWorldClock(750)` → 等 `莞尔 pos == altar (48,36)` → 派单 → 在祭坛行礼；
  代价是安静段两人都回锚点、**重叠在 (48,36)**，回不到基线那种"莞尔祭坛 + 阿雾街口/农田"。
- 若坚持原构图，只能等状态（莞尔祭坛 + 阿雾 (40,40) 或 (56,33)），最长约一个作息周期（≈200 秒实时 @speed=30）。

### 三道闸门

- 不跑：`check-phases` / `check-persistence` / `check-render-budget` 都不调用 `pinShotState`；
  默认 `pinnedPresentedNow === null` → 渲染路径与改前等价。
- 待补：`pinShotState` 8 条单测（钉 now、钉 tide、解钉、不改快照、不动冻钟、非法输入、幂等、phaseView 拷贝分支）。

### 被否的写法

1. 把 01 的"站定"夹具原样推到所有镜头：02 的语义是"在铺子里干活"，等站定会拍到别处。
2. 只冻世界钟、不钉潮位：草地色阶差会原样回来（本轮 06 之前 10.4% 就是这个）。
3. 用整页截图比 07/08：面板宽度变化会让画布落在半像素，全屏 1 级差无论如何都清不掉。
4. 把 08-400 当逐像素判据：元素截图尺寸本身就不稳定（3920 vs 4008）。

### 没做到 / 未验证

- 07/08 的"半像素"只做到相关性（面板宽度 → 画布 x 偏 1px），没有直接读 `getBoundingClientRect()`，也没改 `index.html`/CSS。
- 08-400 的 3.3M px 大块没有逐块定位到滚动/切片策略。
- 三门闸未跑；`pinShotState` 无单测；跨天与存档 v5 读入未验证。
- 12 张里 0 张到 0。**不能开始重录。**

## 2026-11-05 12 张验证重录（pin-d）

- 01-salute：三对差值全 0；戊 8 张（06 / 07×4 / 08×3）：三对差值全 0，尺寸 963×642 / 1926×1284 / 3852×2568。
- 夹具三处：站定（idle + 不走 + 无活，连拍三下不变）→ 回拨整点 12:30 冻钟 → 钉呈现态；`#stage` 整数盒钉死 + 固定整型视口 + 每次换视口 `scrollTo(0,0)`。
- 丁：03 / 05 结构断言通过；02（最大块 1068～1964）、04（80 ↔ 27,292）不通过——差分度量测的是两跑相位差，不是存在性。
- 九道非浏览器 + 浏览器五道全绿；`pinShotState` 单测 9/9；反向用例（烟柱 2,900 / 雨丝全无）均判红。
- 详见 `pin-shots/02-STRUCTURE-GATE.md`；5 张 `phase-*.png` 与 3 张 `dengchao-*.png` 已撤回，待定稿后统一重录。

## 2026-11-06 合并后重录（内景线合入 main）

- 01-salute 重锚：不用 `jumpWorldClock` 伪造；独立页面 `?now=300&speed=30&time=dawn` 从 05:00
  自然跑到 07:34（河湾 52,32 + 祭坛 48,36），冻钟 + 钉呈现 07:34 + 钉潮位 0。旧基线
  （底栏 07:05 + noon 光照）作废。三对逐字节相同（sha 相同，1010×940）。
- 06-faith 改用 07/08 同一条「站定」判据（`waitVillagersSettled`）：PIN 模式先推世界到
  12:30 安静段，等两人 `idle`/不走/无活且位置连拍三下不变，再冻钟取景。修复前 1-2 差
  0.19%（阿雾名字标签与身体），修复后 06 / 07×4 / 08×3 三对全 0。
- 三跑两两（1-2 / 2-3 / 1-3）精确差 / 可见差 / 最大结构块：01、06、07×4、08×3 全部 0/0/0；
  02 1428·2080·2292，03 4116·4632·3952，04 480·480·80，05 292·292·0。
- 05 由上一轮全绿变为 2/3 红：门边 292px 施工进展线，冻结点未归一的固有抖动；
  阈值 60–160 一字未动、无豁免，按既有口径记红，口径是否要改留待裁决。

