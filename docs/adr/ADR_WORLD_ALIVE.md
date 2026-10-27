# ADR_WORLD_ALIVE：世界变活

> **这份记录的来历（先说清楚）**：代码里从 2026 年起就有 4 处引用
> `ADR_WORLD_ALIVE §2` 与 `§8`——`src/render/day-phase.ts` 文件头、
> `src/world/save.ts` 的 `SCHEMA_V2_FINGERPRINT` 注释与 `MIGRATIONS[1]` 注释、
> `scripts/check-phases.mjs` 文件头。而 `docs/adr/` 下**从来没有这个文件**。
> `docs/MIGRATION_FROM_XIAOXI.md` 的搬迁清单里列着它（§五：用途「时辰只改渲染、
> 编年史不落档、角色是手不是 Agent」，注「这三条继续有效」），但**从未被写下来**——
> 它不是被删了，是没来过。
>
> 2026-10-27 从代码反推出本记录。凡是从代码里读得出来的一律给出证据（**指名，不叫行号**——
> 行号会漂，而仓库的引用审计只查「那一行有没有代码」，查不出「那一行是不是说的那个东西」）。
> 凡是从代码里读不出来的（当初为什么这么定、否掉了什么替代方案），**这里明说读不出来**，不编。
> 本记录因此是一份「现状说明」，不是「决策复述」——它证明这些规矩现在成立，
> 不证明它们当初被这样论证过。
>
> **节号**：§2 与 §8 是代码已经引用的那两个号，本记录沿用原号，好让那几处引用不用改。
> §1 与 §3–§7 原本也是自己补的、代码没有引用——2026-10-27 起**这句不再成立**：
> 补「暴雨天没有萤火」那道闸时，代码新增了两处引 §6（`src/render/day-phase.ts` 与
> `test/day-phase.test.ts`），§6 现在是被引用的。所以改 §6 的编号**也要动代码**——
> 这次就改了编号（把萤火那条移出编号列表）而没动代码，两处新引用当场变成空引用，
> 见 §6 与文末附录。
> 同一天补「世界不碰时辰」那道闸时又加了一处（`test/phase-purity.test.ts`，
> 同时引 §2 与 §6）。**今天共九处**，见文末附录。
>
> **2026-10-28 复审补记：上一段原来还写着「`test/purity.test.ts` 的时辰那一层
> 也引 §6」。那一层引的是 §2，不是 §6**（但这条自己也错了一个数：「全文只有一条
> § 引用」假，带 § 的是**六行**——144/152/175 引 §4.6、213-214 提 §6 但那是「原属
> §6 缺口 1、已移除」的旧记录、只有 201 引 §2）。所以 §6 的三处是 `day-phase.ts`、
> `day-phase.test.ts`、`phase-purity.test.ts`，`purity.test.ts` 属于 §6 是
> 文末附录已经改准的一件事，而这段 §节号 还留着旧说法——**读者从上往下读，
> 先读到的是错的那个**。同样，下面 §1 那句「补萤火时三处」也一并作废——那句话
> 自己的单位是**文件**（下一句「又加了一处」说的就是 `phase-purity.test.ts`
> 一个文件），而补萤火那一笔（`97abc54`）动过的代码文件只有两个：
> `day-phase.ts` 与 `day-phase.test.ts`。「三条」数的是 §6 **提及**（前者两行、
> 后者一行），或者把 ADR 自己表里那一行也算进去了；`phase-purity.test.ts`
> 那一处属于更早的 `2c8dae5`，与补萤火无关。

## §1 三条规矩，以及代码里谁在指着它们

搬迁清单给这个主题的摘要是一句话：**时辰只改渲染、编年史不落档、角色是手不是 Agent**。
代码里实际指着它的，立传时有四条（今天九处；另五处是 2026-10-27 补的两道闸加的——
补萤火时三处、补「世界不碰时辰」时一处同时引 §2 与 §6，都见文末附录）：

| 引用处 | 原话 | 指向 |
|---|---|---|
| `src/render/day-phase.ts` 文件头 | 「时辰只喂渲染层，否则固定步长与确定性回放就不再成立」 | §2 |
| `src/world/save.ts`，`SCHEMA_V2_FINGERPRINT` 上方 | 「v2 冻结指纹（ADR_WORLD_ALIVE §8）。由 docs/save-v2.sample.json 算出，单测核对」 | §8 |
| `src/world/save.ts`，`MIGRATIONS[1]` 上方 | 「v1 → v2：世界变活」 | §8 |
| `scripts/check-phases.mjs` 文件头 | 「判据来自 ADR_WORLD_ALIVE §2『验收阈值』，数字改动必须同步改这里的常量」 | §2 的验收阈值 |

所以本记录的 §2 是「时辰只改渲染」连它的验收阈值，§8 是「世界变活」这一次存档迁移。
另外两条规矩（编年史不落档、角色是手不是 Agent）没有任何代码引用，本记录按 §3、§4 立。

**顺带记一笔**：`day-phase.ts` 文件头还引着「依据见 `proto/day-phase.html` 与 ADR 附录 A」。
本仓没有 `proto/` 目录，本记录也没有附录 A——那两处引用的内容不在这个仓库里，
所以四刻配方当初的实测数据（3.43 luma、1.3% 像素那两个数）在这里**无法复核**，
只能转引。

## §2 时辰只喂渲染层

**规矩**：时辰（`PhaseId` 四刻：晨雾 / 正午 / 黄昏 / 夜）只决定怎么打光，不决定世界怎么运转。
`Simulation` 永远不调用 `day-phase.ts`。

**它是什么**：定义全在 `src/render/day-phase.ts`——`PhaseId`、`PHASE_ORDER`、
`PHASES`（四刻配方：压暗色、压暗浓度、暖光强度、亮窗数、屋脊受光、贴地雾带、萤火）、
`phaseAt(epochMs)`（本地时刻 → 相位）、`parsePhaseParam(raw)`（URL 参数 → 相位）。
它是纯函数，不 import Phaser。它 import 两样，两样都在 `src/world/` 下，而方向是对的
（世界提供数据给时辰，不是时辰驱动世界）：`palette-data.ts` 的 `WORLD`（24 色表）与
`types.ts` 的 `Weather` 这个**类型**（`import type`，编译后不存在）。
（这里原来写着「只 import `../world/palette-data.ts` 的 `WORLD`」——少了一个
`import type { Weather }`。2026-10-27 补记。）

**谁消费它**（正向证据，2026-10-27 实测）：

- `src/render/phase-view.ts`——主消费者，import `PHASES` / `PhaseId` / `PhaseRecipe`，
  把配方画成压暗层、暖光 ADD 叠加、萤火、雾带，两刻之间按 `FADE_MS` 插值渐变。
- `src/render/ambience.ts` 与 `src/render/ambience-view.ts`——只 import `PhaseId` 这个**类型**，
  按 `AMBIENCE_BY_PHASE` 决定白天出几只鸟、黄昏与夜里出几只蝙蝠。
- `src/scenes/SandboxScene.ts`——`parsePhaseParam` / `phaseAt(Date.now())`，
  管 URL 的 `?time=` 入口、`?night=1` 旧入口、15 秒一个的对表定时器、N 键切换。
- `src/world/bustle.ts` 的 `litWindowCount(phase, working)`——**它不 import `day-phase.ts`**。
  它的参数是结构类型 `{ readonly litWindows: number }`，恰好接得住配方里那个数。
  世界内核因此对「时辰」这个概念一无所知，只收到了一个数。
- 测试侧：`test/day-phase.test.ts`（配方表）、`test/ambience.test.ts`（`PHASE_ORDER`）、
  `scripts/check-phases.mjs`（浏览器截图量像素）。

**它不进世界**（反向证据）：`src/world/` 下的 import 目标**只有 `./` 与落在
`src/world/` 里面的 `../`**——世界内核不 import 渲染层，不 import `day-phase.ts`，
不 import Phaser。`src/world/` 里出现 `day-phase` 这个词的只有 `weather.ts` 的
注释——`renderIntensity` 上方那一段解释萤火条件为什么搬了家的话里提了四次
`day-phase`（**指名，不叫行号**：那几行会随我自己的编辑漂，而引用审计只认
「那一行有没有代码」，认不出那一行是不是说的那个东西），**不是 import**。
（**逼着词汇扫描走 `codeOf()` 的不是 `day-phase`。** 它压根不在词表里，提四次
也红不了；真正必须走 `codeOf()` 的是同一段注释里的 `PHASES`——那一个在表里。
这一段原来写的是「……不是 import——所以词汇扫描走 `codeOf()`，注释不算」，
把原因安在了 `day-phase` 头上。安错原因比没有原因更坏：下一个人会去删那四处
`day-phase`，删完照旧红，还以为是别的地方漏了。2026-10-28 改，实测见
`test/phase-purity.test.ts` 那段注释。）
`WorldSnapshot`（`src/world/types.ts`）的 23 个字段是 now、villager、villagers、
buildings、startupBuildingIds、workstations、constructions、tasks、pending、props、
oracle、critters、fog、roads、trails、altar、events、weather、tide、faith、deliveries、
deliveriesByVillager、feed——**没有时辰字段**。快照里没有它，世界就没有它。
（这一列原来是分组写的，20 组，漏了 `startupBuildingIds` 与 `deliveriesByVillager`
两个字段；2026-10-27 改成逐字段列全 23 个。）

**这条的反向证据原来的说法是「48 个文件、没有一个 `../`」，那个说法已经不能用了。**
它是 2026-10-27 在 `src/world/` 还是**平铺**的时候实测的（`git ls-tree -r HEAD` 数出来
正是 48 个 `.ts`，`git grep` 也确实是零个 `../`）。后来 `src/world/memory/` 开了子目录，
`memory/perception.ts` 里的 `from '../types.ts'` 解析到 `world/types.ts`——那是世界内核
**自己**，不是它上面的一层。于是「没有一个 `../`」这句话当场变成假的，而更糟的是
`test/purity.test.ts` 的闸照着字面判，会把这种世界内部的子目录依赖一并禁掉。

**所以判据从字面改成了落点**：把 import 说明符真的解析一遍，再问落点还在不在
`src/world/` 里面。守的东西没变（不越过 `src/world/` 的边界），跟上的是目录结构。
这件事值得记下来，是因为它与 §6 那条「一道长得很像的闸可以是空的」是同一类错误：
**一条扫描写明的判据，与它实际检查的东西，会在别处改代码的时候悄悄分开**——
而分开之后测试照绿，人还以为规矩还守着。

代码自己把这句话写了两遍：`SandboxScene.setPhase` 的注释「时相是纯渲染态：不写世界、
不写事件日志」；`phase-view.ts` 文件头第一句「时相渲染层：把四刻配方画到世界上。
纯渲染态，不写世界快照、不写事件日志」。

**这条规矩真正防的事**：`phaseAt` 读的是**墙钟**——`new Date(epochMs).getHours()`，
本地时间。而墙钟在世界里只有一个合法读者：`Simulation` 构造时收下的
`deps.wallClock ?? (() => Date.now())`，它的产出只喂 `settled[].completedAt` 与
`meta.savedAtWallClock`，不喂任何世界判定（`test/purity.test.ts` 的 §4.6 扫描把这条
写明在注释里，并且按**整行字面量**豁免那一行——那行被改坏了就不再等于这串字面量，扫描立刻咬住）。
时辰一旦进世界，「现在几点」就成了第二个墙钟读者，而第二个读者进来那一刻，
「同一个存档回放出同一条曲线」当场不成立。

**注意这条理由的确切形状**：不是「时辰跟着世界时间走，所以不影响回放」，而是
**「时辰根本不看世界时间，所以碰不上回放」**。`GLOSSARY.md` 的两条词条原来都
把时辰算进「按世界时间走」的那一边（「世界时间」词条写着「事件、潮位、时辰都按它走」，
「确定性回放」词条写着「潮汐、灯油、时辰三者都必须只是世界时间的纯函数」）——
那两句对时辰都是错的，2026-10-27 已按本节改掉，见 §7 第 1 条。

**同族的另一条纪律**（说明这不是时辰一处的怪癖）：`VillagerSnapshot.umbrella` 的注释
「下雨时渲染层给她打把伞；**世界不判断『她淋不淋湿』**」。天气是世界的事实，
「要不要打伞」是画面的事。时辰同一个分法：钟点是世界外的事，打光是画面的事。

### §2 的验收阈值

`scripts/check-phases.mjs` 指着这一节。两个数：

- `MIN_REGION_DIFF = 0.03`——任意两刻在整屏（`REGION_TOP = 0` 到 `REGION_BOTTOM = 640`）
  至少 3% 的像素 luma 差 ≥ 8。
- `MIN_LUMA_STEP = 1.5`——整屏平均亮度严格递减，晨 > 午 > 昏 > 夜，相邻两步至少差 1.5。

采样区为什么是整屏而不是早先那条固定的建筑带：单屏时代建筑总在同一位置，
大世界里相机可以停在任意位置，固定带可能整块都是草地或天空，差异就被稀释到门槛以下
——实测晨/昏只剩 0.6%。改成整屏，四刻截图统一对准祭坛。

**阈值为什么存在**：`day-phase.ts` 文件头记着实测——只改压暗浓度时，晨与昏只差
3.43 luma、1.3% 像素，屏幕上分不出来。所以每刻同时改三样：压暗的色与浓、亮光强度、
内容态（亮窗数、屋脊受光、贴地雾带、萤火）。三样一起改，四刻才分得开。

单测侧同一族断言在 `test/day-phase.test.ts`，不量像素、量配方：亮度严格递减、
黄昏用 `ink` 不用 `ember`（暖色叠草地会提亮，会让黄昏比正午还亮）、萤火只在夜里、
亮窗只在黄昏与夜里、压暗色必须在 24 色表里、浓度不超 0.46。

**代价（看得见）**：阈值那道验收挂在浏览器回归脚本上，要 `npm run dev` 起真渲染器，
`npm test` 不跑它。所以「四刻可辨」不是每次提交都执行的那道闸。

## §3 编年史不落档

**规矩**：编年史（`memory/` 目录，客户端读成镇志抽屉）与上游事件日志都不进存档。
存档里只有世界自有的事实。

**证据**：

- 「编年史」在代码里就是 `memory/` 目录。`src/world/memory-client.ts` 文件头第一句
  「记忆客户端：把编年史读进浏览器」，且只有 `list()` 与 `read()` 两个方法——
  写入走服务端 `POST /api/memory/write`，那条路收的是「已经观测到的事」，
  「不该由界面上的一个按钮发起」。`src/ui/chronicle-panel.ts` 文件头：
  「把 `memory/` 读成一本能翻开的编年史」，并且「面板不改变仿真：它只读服务端」。
  `src/main.ts` 装配处同一句：「只读 memory/，不改变仿真」。
- 存档的合法路径全集（`SAVE_V1_ALLOWED_PATHS` / `SAVE_V2_ALLOWED_PATHS` /
  `SAVE_V3_ALLOWED_PATHS` / `SAVE_V4_ALLOWED_PATHS`，逐级 `...` 展开）里
  **没有任何一条指向记忆或编年史**——每条都以 `world.` 或 `meta.` 开头。
  `test/save-fingerprint.test.ts` 按样例钉死路径条数（v1 99 条、v2 114 条、v4 121 条），
  多一条就红。
- 上游事件日志同理：`src/world/events-client.ts` 只做运输与形状校验（读 + `record()` 回写
  `world.changed`），它的 `WorldEventRow` 不在任何存档形状里。
- 同族的另一条写在类型上：`WorldSnapshot.trails` 注明「**不落档**——能从走动重新累积，
  存起来只会让存档无限膨胀」。`src/render/ambience.ts` 文件头把同一条理由说了三遍：
  它们不是世界的事实（鸟停在枝头不该进存档——读档时鸟还在原处，那才是错的）、
  确定性靠 `now` 就能成立、不占快照（「快照多一个字段就要动 `save.ts` 的叶子清单，
  而这份清单是 v1 冻结的形状」）。

**这条规矩真正防的事**：编年史是只增的、无上界的。把它塞进存档，存档就跟着无上界地长；
而存档的形状是**冻结**的——v1 那 99 条路径至今不许改，改要升 schema、写迁移、重算指纹。
一份要冻结的东西和一份要无限追加的东西不能是同一份。

**必须说清的一条边界**（这不是我替它圆的，是代码现在的样子）：落档的**确实有**历史感的东西。
`world.settled[]`（已结算记录）超过 `SETTLED_WARN_THRESHOLD` = 5000 只告警一次、不截断；
`world.oracle[]`（神谕石板）硬截断在 `ORACLE_SLAB_LIMIT` = 20 条，超出丢最旧。
所以「编年史不落档」准确的说法是：**无上界的那份不落档；落档的是世界自有的事实，
其中带记录性质的两项各自有界**。

**读不出来的**：当初是否明确对比过「把编年史一起存进存档」。从代码看不出。

## §4 角色是手不是 Agent

**规矩**：世界里的角色（villager）是模拟内核按固定步长驱动的**手**——按作息走、
接活、干活、交付、捎东西回来。她们不是各自有一套判断的 Agent。LLM 在世界**上面**，
不在角色**里面**。

**证据**：

- 角色的一切行为都出自 `Simulation.update(deltaMs)` 这一个函数：潮位、作息
  （`routineFor` 按天气与潮位挑下一拍，`beats` 按角色 id 取）、施工、工作站、急件、
  氛围实体、气泡过期，全在 `update` 里按 `deltaMs` 走。没有一处为某个角色单开一个循环，
  也没有一处为某个角色发一次网络请求。
- LLM 的唯一出口是白名单。`src/world/intent-schema.ts` 的 `ParsedIntent` 就这些：
  `dispatch` / `complete` / `cancelPending` / `setWeather` / `setTide` / `build` /
  `demolish` / `miracle` / `carry` / `unknown`。里面**没有任何一条**「让某个角色自己决定什么」。
  最接近的两条是 `dispatch`（给她一单活）与 `carry`（往她兜里放一件凭证）——
  都是**从外面放进去**，不是她从里面长出来。
- 模型的结果没有特权路径。`classifyLater` 的三条纪律第二条原文：「**结果回队，
  不直接改世界。** 模型的结果和玩家的话走同一条命令队列，这样时序、石板、事件顺序
  都与同步输入一致——没有『特权路径』。」
- 角色嘴上的一句话是**模板选的**，不是生成的：`src/world/villager-words.ts`
  （「单立一个文件，因为它同时供两处说话用」——状态行与《神谕日报》原先各写各的、各错各的）。
  日报也是纯函数：`src/world/report.ts` 文件头「纯函数，从快照推导，不另存一份真相」。
- 世界内核拒绝上游的 Agent 词汇：`test/purity.test.ts` 禁 `agentName` / `agent_id` /
  `ready_to_report` / `blocked_question` / `step_idx` 出现在 `src/world/` 的**代码行**里
  （剔注释靠 `test/source-scan.ts` 的 `codeOf`）。
- SPEC 侧同一句话在 `docs/SPEC.md` §1：「Agent 干活可以是一种输入，但不是主体。」

**「手」这个字在代码里的落点**：`src/world/carry.ts`（干完活捎回来的东西，
「纯视觉：它不影响任务结算……世界没有货币，也不会因为这些『东西』多出什么数值」）、
`VillagerSnapshot.carrying` 与 `deliveriesByVillager`（按人分账的交付）、
`world/bustle.ts`（「活儿多了，窗就亮着」——楼亮不亮窗要看人在不在里面干活）。
角色是这个世界**出力**的那一部分。

**顺带一处对不上**：`docs/SPEC.md` §4.3 的命令清单里有 `npc.setSchedule`（改某个居民的作息），
白名单里没有它。也就是说连「从外面改她的作息」这条路都还没通——角色更没有自己的判断。
SPEC 那一行是超前的。

> **2026-10-28 补记：这段的第二句是假的，第一句的方向也反了。**
> `npc.setSchedule` **在**白名单里：`server/rules/schema.py` 的分发表
> `COMMAND_CHECKS` 收着它（`"npc.setSchedule": _npc_set_schedule`），
> 参数校验完整（`_only(args, {"id", "schedule"})` + `schedule` 过 `SCHEDULES` 域），
> `server/tests/test_rules_schema.py` 有它的用例。
> 准确的说法是**规则层收得下，世界层执行不了**：客户端与世界都没有这条意图，
> 所以服务端自己的注释写的是「在白名单里，但客户端与世界都还没有这条意图」
> （`server/oracle/api.py`、`server/oracle/prompt.py`、`server/rules/schema.py`
> 各一处，`server/scripts/intent_experiment.py` 三处；连提示词都因此不列它）。
> **2026-10-28 复审补记：这一行原来只列三个文件、还说「各一处」，两处都不对。**
> 漏的正是 `server/rules/schema.py`——它把同一句话写在 `COMMAND_CHECKS`
> 正上方，是离白名单最近的一处；`intent_experiment.py` 也不是一处而是三处
> （模块说明、用例分组说明、报告模板各一处）。测试文件里还有四处
> （`test_intent_experiment.py` 一处、`test_orchestrator.py` 两处、`test_intent_api.py` 一处），所以
> 「五个文件」也数不出来——**生产代码是四个文件、六处**。
> 承重的那句（「规则层收得下，世界层执行不了」）不受影响，它核过。
> 顺带：同一个错的另一种数法写在我那笔的 commit message 里（「五个文件」），
> 一并作废。**这条正是「数与清单分开写」的又一例**——清单击一项项列，
> 别给总数。
> 也就是说「从外面改她的作息」这条路**通到了规则层就断了**，不是「还没通」。
> 角色没有自己的判断回路这半句不受影响，仍然为真。
> 同一个错在 `docs/SPEC.md` 已经更正过（2026-10-28 补记：把两个白名单当一个了），
> 本记录落笔比那次更正早，把同一句错话留到了今天。

**读不出来的**：「手」这个比喻当初针对的是什么（是旧仓里「每个村民背后一个 Agent」的做法，
还是别的），以及是否认真否掉过「角色各有各的模型」。代码里没有留这句话的论证。
上面能证的只是：**现在的代码里，角色确实没有自己的判断回路**。

## §5 三条共同的根：世界时间是唯一被允许的时钟

`GLOSSARY.md` 的两条词条把根说明了：「世界时间」是固定步长推进的毫秒数，
是这个世界唯一被允许的时钟；「确定性回放」是同一份存档加同一串固定步长、世界曲线唯一，
是潮汐与灯油两者边界背后的总纪律——两者都必须只是世界时间的纯函数。
（这两条词条原来都把**时辰**一起算进去，那是错的；2026-10-27 已按 §2 改掉，
见 §7 第 1 条的结局。）

三条规矩各占一个面：

| 规矩 | 挡住往世界里塞的东西 |
|---|---|
| §2 时辰只喂渲染层 | 墙钟（`phaseAt` 读的是本地时间） |
| §3 编年史不落档 | 无上界（只增的日志进不了冻结的存档） |
| §4 角色是手不是 Agent | 一次网络往返（步进里没有为谁单独问一句模型） |

三者都不反对「世界变活」。`src/render/ambience.ts` 文件头那条「确定性靠 `now` 就能成立」
说的就是：**活可以是 `now` 的纯函数**——那就既活、又可回放，不必二选一。
这正是 §8 那次迁移的立场：世界长了新东西，而旧档一条不废。

## §6 怎么知道它们还成立

| 规矩 | 今天谁在看守 | 跑在哪 |
|---|---|---|
| §2 时辰不进世界 | `test/phase-purity.test.ts` 三条：① 世界代码里没有时辰模块的标识符（抄一份也拦得住）② 时辰那一层不 import Phaser ③ 快照字段清单冻在测试里。另有 `test/purity.test.ts` 的「src/world 不 import 它上面的任何一层」拦 import 这一条路 | `npm test` |
| §2 四刻可辨 | `test/day-phase.test.ts`（配方表） | `npm test` |
| §2 暴雨天没有萤火 | `test/day-phase.test.ts` 的「萤火虫只要晴天的那几刻」与「加一档天气不必改这里」（2026-10-27 补；原 §6 缺口 2） | `npm test` |
| §2 四刻在真渲染器上可辨 | `scripts/check-phases.mjs`（截图量像素） | 要 `npm run dev`，**CI 不跑** |
| §3 编年史不落档 | `test/save-fingerprint.test.ts` 钉路径条数与指纹 | `npm test` |
| §3 记忆那扇门是只读的 | `test/purity.test.ts` 的「世界的网络入口是封闭的一份清单」（白名单里 `memory-client.ts` 注明只读不写） | `npm test` |
| §4 角色不是 Agent | `test/purity.test.ts` 的上游词汇扫描 | `npm test` |
| §8 v1→v2 迁移 | `test/save-fingerprint.test.ts` 的「v2 样例仍原样不动」+ `test/save.test.ts` 的 v1→v2 四条 | `npm test` |

**两处缺口，说清楚免得误以为有闸**：

1. **「世界按时间自己派生一个相位」这道闸拦不住。** 有人不 import、不抄、也不开字段，
   而是在 `Simulation.update` 里写一句 `const hour = (this.now / 3_600_000) % 24`，
   然后按时辰派活。上面的三道闸一条都不会红：没有时辰模块的标识符，快照字段没变，
   也没读墙钟（`this.now` 是世界时间）。这不是扫描漏了一个正则，是**词级扫描的天花板**
   ——`test/source-scan.ts` 开头把这条界线写明着。要拦它得在构建期做标识符解析，
   那不属于一条测试的体量。所以这里说清楚，别让读的人以为三道闸合起来等于
   「时辰不可能进世界」。

**一处已经补上的缺口（2026-10-27，原本列在下面）**：**「世界不碰时辰」一道扫描都没有。**
`ADR_WORLD_ALIVE.md` §6 原来把这一条列在缺口 1：「明天有人把 `phaseAt` 接进 `Simulation`，
今天没有一道闸会红」。同族纪律是补得上的，而且当初正是失效过才补的：
`test/lampoil.test.ts` 的「除了清单上那几个文件，世界没人碰灯油」起先只看 `simulation.ts`，
于是「油尽了不走这条路」写进 `grid.ts` 或 `bustle.ts`，全套照旧绿，才扩到整个
`src/world/` 目录并递归往下。时辰缺的正是这一道。

补的时候发现「一道闸」是不够的——**时辰进世界有三条不同的路**，一条闸拦不住三条：

- **import 进来。** 这条由 `test/purity.test.ts` 的「src/world 不 import 它上面的任何一层」
  拦（`83a8dcf`，在本条之前落地）。它禁的是**解析后落在 `src/world/` 之外**的任何 import，
  所以换个入口（`phase-view.ts`、`ambience.ts`、或者一个新文件）也一样进不来。
  （它原先判的是「这一行有没有 `../`」，`src/world/` 平铺的时候两者等价；
  `world/memory/` 一开子目录就分开了，判据跟着改成落点，见 §2。）
- **抄一份进来。** `phaseAt` 复制粘贴到 `src/world/` 下，import 图一片干净，
  而世界照样知道「现在几点」。由 `test/phase-purity.test.ts` 的词汇扫描拦：
  递归整个 `src/world/`，走 `codeOf()`（注释行整行剔掉，字符串字面量换成等长空白），
  找 `phaseAt` / `PhaseId` / `PhaseRecipe` / `PHASE_ORDER` / `PHASES`。
  （**`day-phase` 不在词表里。** 它不在不是因为「结构上不可能命中」——那句话是
  假的，`codeOf()` 按行切完才挖字符串，块注释不带 `*` 的体行、多行模板字符串、
  正则字面量它都活得过去。它不在是因为**没用**：加进来唯一想抓的那种走法
  （把 `day-phase.ts` 抄进 `src/world/` 再 import 它）恰好抓不到，import 的路径
  在字符串里，被 `codeOf()` 挖掉了；而抄过来的文件里总得有 `phaseAt`，那一个键
  就够了。

  **membership 从来没写错过，写错的是排除它的理由。** 上面那份名单从头到尾是
  五个名字，`day-phase` 一天也没在过；旧版在这儿写的是「它不可能在」——那才是
  假的那半句。我修的时候顺手补了一句「这一行原来把 `day-phase` 列在词表里，是
  本节自己的错」，**那句本身是假的**：翻它之前每一版，名单都是五个。一次散文
  更正被写成了一次成员更正，而那是给下一轮复审白留的靶子——2026-10-28 由复审
  挑出来，连这句话一起改掉。）
- **快照里开一个字段。** 不 import、不抄，只在 `WorldSnapshot` 上加一个 `phase`，
  渲染层读快照就拿到了时辰。由 `test/phase-purity.test.ts` 的字段清单拦：
  它不猜字段名，把**今天的 23 个字段**列死，加一个字段就得先改那个文件。

**词汇为什么挑这几个词，以及为什么不是裸词 `phase`**：`src/world/bustle.ts` 的
`litWindowCount` 有一个参数就叫 `phase: { readonly litWindows: number }`，函数体里读
`phase.litWindows`。那是「楼里亮着几扇窗」的入参，与时辰无关——§2 把这件事当作正向证据记着
（世界内核因此对「时辰」这个概念一无所知，只收到了一个数）。拿裸词扫，今天就会误报；
而误报一样毁掉一道闸，只是毁得慢一点：下次真出事时，人会先学会忽略这条红。
同理不拿 `dawn` / `noon` / `dusk` / `night` 四个档位名当键——它们是普通英文词，
将来完全可能名一个别的东西。要拦「开了一个时辰字段」，字段清单比任何词表都准。

**第三道用例守的是可验证性，不是时辰本身**：`test/phase-purity.test.ts` 里
「时辰那一层不 import Phaser」看起来反向，其实与 §6 缺口 2 是同一件事——
`phase-view.ts` 的萤火条件当初就是因为它 import Phaser、node 下构造不出来，
才一直「有注释、没用例」。时辰模块自己一旦依赖渲染后端，本文件三道闸的用例
就都跑不起来了，而闸跑不起来与没有闸在这份仓里的后果是一样的。

**这道闸不是形式上的，而且第三道第一次是假的**：mutation 实测三种走法各自会不会红，
结果是——往 `src/world/bustle.ts` 末尾粘一个用到 `phaseAt` 的函数，词汇扫描**红**；
往 `Simulation.snapshot()` 的返回对象里加一个 `phase` 字段，字段清单**红**；
往 `src/render/day-phase.ts` 里加一句 `import Phaser from 'phaser'`，**三条全绿**。

第三道不红，是因为它走错了助手：`codeOf()` 把字符串字面量的内容换成等长空白，
`from 'phaser'` 一变就只剩 `from '       '`，正则永远不命中。**这道闸从上线第一秒
起就是空的**，而它看上去与另外两道一模一样。同一个坑 `test/purity.test.ts` 的时辰
那一层已经踩过一次并写在注释里（`83a8dcf` 那次），我这次又踩了——所以修法不是
"把正则改宽"，而是把 import 扫描与词汇扫描的分工写明：词汇用 `codeOf()`（注释里提一句
旧词不算），**import 只能裸读 + 剔注释行**。`test/source-scan.ts` 为此新增 `codeLines()`，
并把两边的坑都记在它的说明里。改完再 mutation，第三条红了，还原后 3/3 绿。

**教训值得单独记**：一道长得很像的闸可以是空的，而"测试写着、跑着、绿着"完全不构成
它在干活的证据。这份仓里因此凡是新增扫描，都要附一次 mutation 实测——包括**先证明它会红**，
不是只证明它现在是绿的。

**另一处已经补上的缺口（2026-10-27，更早）**：**「暴雨天不该有萤火」没有用例。**
`phase-view.ts` 的 `drawFireflies` 在天气不是晴时直接 return，`PHASES.night` 的注释也写着
「下雨时隐藏」，但 `test/day-phase.test.ts` 只断言 `PHASES.night.fireflies` 这个**配置值**，
没有一条用例把「夜里下雨了所以没有萤火」跑成红。`src/world/weather.ts` 的注释自己记着这件事，
还写着「想让它真的会红，得先给 `phase-view` 的萤火虫条件补一条用例」。

补法有两半，缺一半都不成立：

- **把条件搬出 `phase-view.ts`。** 用例原先没法写，不是因为懒——`phase-view.ts` import Phaser，
  node 下一 import 就 `window is not defined`（实测：往 `day-phase.test.ts` 里加一句
  `import ... from '../src/render/phase-view.ts'`，整个文件直接崩，一条用例都跑不到）。
  所以条件搬到 `day-phase.ts` 的 `firefliesVisible(view, weather)`——那个文件不碰 Phaser，
  测试本来就在跑。`drawFireflies` 改为调它。
- **补两条用例。** 「萤火虫只要晴天的那几刻」把四刻 × 三种天气全走一遍；
  「加一档天气不必改这里」拿三种已知之外的天气词断言一律没有萤火虫——这条钉的正是
  `weather.ts` 里那句「再加一档天气渲染层不用改」：改回列举两种雨，红的是它。

**这道闸不是形式上的**：实测把 `=== 'clear'` 改回 `!== 'rain' && !== 'storm'`，
「加一档天气不必改这里」立刻红；把天气那一半整条删掉，两条全红。还原后 15/15 绿。

## §7 现在证不出来的，以及已经对不上的地方

**证不出来的**（明说，不编）：

1. 「时辰只改渲染」当初的替代方案（让世界也读时辰，比如按时辰派活、按时辰关铺子）
   是否被认真否掉。代码只留下结论。
2. 「编年史不落档」当初是否与「把编年史一起存」对比过。
3. 「角色是手不是 Agent」里的「手」针对什么。
4. `day-phase.ts` 文件头引的 `proto/day-phase.html` 与「ADR 附录 A」都不在本仓——
   四刻配方那两个实测数（3.43 luma、1.3% 像素）在这里无法复核，只能转引。

**已经对不上的（2026-10-27 实测，未修）**：

1. **`GLOSSARY.md` 的「世界时间」词条原来对时辰说错了。** 它原来写着「事件、潮位、
   **时辰**都按它走」，而「确定性回放」那条原来也写着「潮汐、灯油、**时辰**三者都必须
   只是世界时间的纯函数」。代码不是这样：`phaseAt` 的入参来自 `SandboxScene` 的
   `Date.now()`，是**墙钟本地时间**，不是世界时间。`test/lampoil.test.ts` 里那条
   「一个世界日就是 24 小时」的注释把实情说对了：「`render/day-phase.ts` 的朝夕午夜
   用的是墙钟本地时间，与 simulation 时间无关」。
   所以 §2 的理由要按「它根本不看世界时间，所以碰不上回放」理解，不是按词典那句理解。
   **2026-10-27 已修**：两条词条都把时辰摘出去了，并各补一句「别把时辰列进来」，
   说明它为什么不在回放的管辖范围内。本记录落笔时它还是错的，改词典也不在本记录的
   职权内（本记录只新增一个文件）——所以这里记的是「当时错、后来改了什么」。
2. **`docs/SPEC_V2.md` §3 用户故事 33 对时辰曾经是超前的。** 它说「潮汐、灯油、时辰三者谁读谁
   有一条源码扫描测试锁住」。本记录落笔时实测：潮汐有（`purity.test.ts` 的「潮汐逻辑不读墙钟」）、
   灯油有（`lampoil.test.ts` 的「world/simulation.ts 不认识 lampoil」与
   「除了清单上那几个文件，世界没人碰灯油」）、**时辰一条也没有**（见 §6 缺口 1）。
   **2026-10-27 已修**：缺口 1 补上了，`test/phase-purity.test.ts` 三条加上
   `purity.test.ts` 的 import 闸，时辰与另两者对齐；§3 故事 33 的括注也跟着改成
   「时辰原来没有，现在有了」。所以这条现在**不再是「对不上」**，留着它是为了记下
   「规范曾经比代码超前」这件事发生过一次——而它的代价是那句超前的话在仓里躺了几天。
3. **`docs/SPEC.md` §4.3 的 `npc.setSchedule` 不在白名单里**（见 §4 末）。

   > **2026-10-28 补记：这一条不再是「对不上」，是说错了。** 它在白名单里
   > （`server/rules/schema.py` 的 `COMMAND_CHECKS`），断在客户端与世界没有这条意图。
   > 本节的小节标题是「已经对不上的（2026-10-27 实测，未修）」——「对不上」说的是
   > 规范与代码各有各的说法，而这里只有一边说法是假的。改正见 §4 末的补记。

## §8 世界变活：v1 → v2 存档迁移

**规矩**：v1 → v2 这一次升级叫「世界变活」。它**不写任何业务**，只把新路径的位置扩好；
缺省值一律读作「这件事没发生过」，不猜。

**v2 加了什么**（`MIGRATIONS[1]` 与 `SAVE_V2_ADDED_PATHS`，15 条路径，横跨四类）：

| 类 | 路径 | v1 档迁移后的缺省 |
|---|---|---|
| `buildings[]` | `sourceTaskId` / `sourceSummary` | `null` |
| `props[]` | `sourceTaskKind` / `sourceTaskId` / `sourceSummary` | `null` |
| `critters[]` | 数组本身 + `id` / `kind` / `at.x` / `at.y` / `leavesAt` | 空数组 |
| `oracle[]` | 数组本身 + `at` / `raw` / `receipt` | 空数组 |

外加 `settled[].completedAtClock` 的兜底 `'local'`——它在 v1 冻结路径集里已必填
（`world.settled[].completedAtClock` 就在 `SAVE_V1_PATHS` 中），所以对合法 v1 档是**无操作**，
只防极早的非样例档。

`world` 的键从 v1 的 14 个变成 v2 的 16 个：多 `critters` 与 `oracle`。
样例的叶子路径从 99 条到 114 条（99 + 15），`docs/save-v2.sample.json` 里
`critters` 是一条猫（`miracle-1`，`leavesAt: 45000`）、`oracle` 是两条（「帮我写个爬虫」「下雨吧」），
`props[0]` 与 `buildings[0]` 都带上了 `sourceTask*`。

**为什么叫「变活」**（这部分读得出来）：v2 之后，世界里第一次有了**自己会走的活物**
与**自己记得玩家说过什么**：

- `critters` 是氛围实体。`Critter.kind` 今天只有 `'cat'`，带 `leavesAt`——
  「离开世界的逻辑时刻。到点自己走，不需要调用方清理」（`types.ts` 注释）。
  来源是神迹 `miracle.spawn`（**这是 `docs/SPEC.md` 白名单里的命令名，不是代码标识符**；
  代码里是 `Simulation.performMiracle` 的 `kind === 'cat'` 那一分支）。
- `oracle` 是神谕石板：「只记真正改变了世界的那句话，和当时世界的回执」
  （`OracleRecord` 注释），`at` 是「逻辑时刻（sim.now），不是墙钟：石板要能确定性回放」，
  硬截断在 `ORACLE_SLAB_LIMIT` = 20，超出丢最旧（`Simulation` 里那句 `splice`）。
- `sourceTask*` 三个字段让楼与摆件记得自己是哪一单活留下来的。

**指纹**：`SCHEMA_V2_FINGERPRINT = '72c4a6c0f1f444f7'`，由 `docs/save-v2.sample.json` 算出。
`test/save-fingerprint.test.ts` 的「v2 样例仍原样不动：114 条路径、旧指纹仍然成立」
一条钉三件事：样例去重后的路径条数、`fingerprintOfPaths(paths)`、`sampleV2.meta.schemaFingerprint`。
同文件另有「加字段必须改变指纹」「删字段必须改变指纹」两条，钉指纹对形状真敏感。

**缺省值的理由**：`MIGRATIONS[1]` 注释原话的方向是「历史摆件不编造来源。
`null` 在世界里读作『来路不明』，这是诚实的默认值」。v1 没有活物也没有石板，
迁移后是空数组——不是缺字段。

**旧档自证**：`assertSaveV2` 在 v2 → v3 迁移前按 v2 形状自证（指纹 + 路径集合包含）。
理由是硬的，`ADR_SAVE.md` §1.3 写了：一个版本一旦不再是当前版本，迁移链就会**先改写它再校验**，
那道「先自证」的关口就空了——一个被改过的旧档会被安静地迁成新档。

**这条规矩真正防的事**：v1 的形状是**冻结**的。世界要变活，就不能靠「往 v1 里加字段」——
那会让所有老档当场变成字段漂移。升版本 + 写一条只补位置不猜业务的迁移，
是让世界长大而不让历史作废的唯一路子。

**后果**：

- 好：v1 老档今天仍读得动。`test/save.test.ts` 的「v1→v2 迁移：样例级旧档完整可迁移」
  一路迁到当前版本并直接过 `assertSave`。
- 好：缺省值全是「没发生过」，没有把新世界的经历安到旧世界上。
  「石板从无到空数组，不是缺字段」「老摆件没有来源，记 null 而不是编造」两条钉着这个。
- 好：迁移除了新增字段外不许顺手改别的世界状态——「除新增字段外，世界状态逐字段不变」一条钉着。
- 代价：`critters` 与 `oracle` 在 v1 档里永远是空的——一只猫、一句话都不会从 v1 带过来。
  这是对的（它们确实没发生过），但意味着 v1 老档看起来比新档「死」。
- 代价：每升一次版本，样例、指纹常量、路径条数断言、迁移函数、自证校验五处都要同步。
  漏一处，`test/save-fingerprint.test.ts` 或 `test/save.test.ts` 会红——这是故意的。

**读不出来的**：「世界变活」这四个字当初圈定的范围（是否本来还打算让 v2 做更多，
比如把作息也变成可改的）。代码只留下这一条迁移。

---

## 附：本记录覆盖不到的地方

- **§2 / §6 / §8 三节被代码引用，共九处**（按**位置**数，不按出现次数：一个文件里
  提三次算一处）：§2 三处（`src/render/day-phase.ts` 文件头、
  `scripts/check-phases.mjs` 文件头、`test/phase-purity.test.ts`）；§6 四处
  （`src/render/day-phase.ts` 的 `firefliesVisible` 上方、`test/day-phase.test.ts`
  的萤火用例上方、`test/purity.test.ts` 的时辰那一层、`test/phase-purity.test.ts`）；
  §8 两处（`src/world/save.ts` 的 `SCHEMA_V2_FINGERPRINT` 与 `MIGRATIONS[1]` 上方）。
  **改这三节的编号都要动代码。**
  §1 与 §3–§5、§7 仍没有被引用——改它们的编号不用动代码。

  这一条原来写的是「§2 与 §8 之外，代码里再没有别处引用……那 4 处引用」。
  补萤火那道闸时加了三条引 §6 的，这句没跟着改，于是它说的是一件不再真的事。
  `docs/adr/ADR_SAVE.md` 的附录抄了同一个「4 处」，一起改。
  补「世界不碰时辰」那道闸时又加了一处同时引 §2 与 §6 的（`test/phase-purity.test.ts`），
  于是 7 处变 9 处——**这条自己就是「改编号要动代码」的活证**：它每次跟不上，
  都是因为有人改了节的内容而没数引用。

  > **2026-10-28 补记：上面那张「3 / 4 / 2」的分布是错的，而错的正是它存在的理由。**
  > 这份附录唯一的用途是「改编号之前先看它」，所以一处错的分布比一条错的散文危险：
  > 照它改 §2 的编号会漏两个文件，照它改 §6 会去动一个根本不引 §6 的文件。
  > 逐文件重数（`git grep -n ADR_WORLD_ALIVE HEAD -- world-client | grep §`）之后的实情：
  >
  > - **§2 五处**：`scripts/check-phases.mjs` 文件头、`src/render/day-phase.ts` 文件头、
  >   `test/day-phase.test.ts`（上限 0.46 那条上方）、`test/phase-purity.test.ts`、
  >   `test/purity.test.ts` 的时辰那一层。原清单漏了后两个。
  > - **§6 三处**：`src/render/day-phase.ts` 的 `firefliesVisible` 上方、
  >   `test/day-phase.test.ts` 的萤火用例上方、`test/phase-purity.test.ts`。
  >   原清单把 `test/purity.test.ts` 记在 §6 名下——它引的是 **§2**（「时辰只喂渲染层」那条），
  >   不是 §6。
  > - **§8 一处**：`src/world/save.ts`。原清单数成两处，可两处都在同一个文件里
  >   （`SCHEMA_V2_FINGERPRINT` 与 `MIGRATIONS[1]` 上方），而这一条自己定的规矩是
  >   「一个文件里提三次算一处」——**它违反了自己的数法**。
  >
  > 合起来仍是九处，所以「共九处」这个总数一直蒙对；分布从 3/4/2 变成 5/3/1。
  > 「§1 与 §3–§5、§7 仍没有被引用」这半句核过，**为真**（`villager.ts` 与
  > `scripts/audit-sections.ts` 提的「§6.2」是本记录里没有的小节，不算引用）。
  > **这个分布仍然会漂**——它已经漂了三次。要动编号就现数，别信这张表。
- `day-phase.ts` 文件头还引着 `proto/day-phase.html` 与「ADR 附录 A」，两者都不在本仓。
- 同一份搬迁清单（`docs/MIGRATION_FROM_XIAOXI.md` §五）里的 `docs/ADR_PALETTE_24.md`
  已由另一份记录补上（`docs/adr/ADR_PALETTE_24.md`）；`docs/LARGE_WORLD.md` 仍不在本仓，
  但它只被搬迁清单自己引用，代码没有指着它说话。
- **本记录没有附录 A**，尽管 `day-phase.ts` 指着要一份。四刻配方的实测数据不在这个仓库里。
