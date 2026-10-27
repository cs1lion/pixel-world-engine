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
> **节号**：§2 与 §8 是代码已经引用的那两个号，本记录沿用原号，好让那 4 处引用不用改。
> §1 与 §3–§7 是本记录自己补的，代码没有引用它们。

## §1 三条规矩，以及代码里谁在指着它们

搬迁清单给这个主题的摘要是一句话：**时辰只改渲染、编年史不落档、角色是手不是 Agent**。
代码里实际指着它的有四条：

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
它是纯函数，只 import `../world/palette-data.ts` 的 `WORLD`（24 色表），不 import Phaser。

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

**它不进世界**（反向证据，同一次实测）：`src/world/` 下 48 个 `.ts` 文件的
import 目标**只有 `./` 开头的同目录文件，没有一个 `../`**——世界内核不 import 渲染层，
不 import `day-phase.ts`，不 import Phaser。`src/world/` 里唯一出现 `day-phase` 这个词的
是 `weather.ts` 的一处**注释**（在解释萤火那个天气条件没有测试守着），不是 import。
`WorldSnapshot`（`src/world/types.ts`）逐字段列的是 now、角色、楼、工作站、施工、任务、
排队、摆件、石板、氛围实体、迷雾、路、痕迹、祭坛、事件、天气、潮位、信仰、交付、上游连接——
**没有时辰字段**。快照里没有它，世界就没有它。

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
| §2 时辰不进世界 | **没有专门的源码扫描**。成立靠的是 import 图本身（§2 的反向证据）。间接的是 `test/purity.test.ts` 的「src/world 不 import Phaser」与「§4.6 三个状态位不读墙钟」（按文件扫 `types.ts` / `gate.ts` / `simulation.ts` / `grid.ts` / `save.ts` / `faith.ts` / `grime.ts`，只豁免 `deps.wallClock ?? (() => Date.now())` 那一整行） | `npm test` |
| §2 四刻可辨 | `test/day-phase.test.ts`（配方表） | `npm test` |
| §2 暴雨天没有萤火 | `test/day-phase.test.ts` 的「萤火虫只要晴天的那几刻」与「加一档天气不必改这里」（2026-10-27 补；原 §6 缺口 2） | `npm test` |
| §2 四刻在真渲染器上可辨 | `scripts/check-phases.mjs`（截图量像素） | 要 `npm run dev`，**CI 不跑** |
| §3 编年史不落档 | `test/save-fingerprint.test.ts` 钉路径条数与指纹 | `npm test` |
| §3 记忆那扇门是只读的 | `test/purity.test.ts` 的「世界的网络入口是封闭的一份清单」（白名单里 `memory-client.ts` 注明只读不写） | `npm test` |
| §4 角色不是 Agent | `test/purity.test.ts` 的上游词汇扫描 | `npm test` |
| §8 v1→v2 迁移 | `test/save-fingerprint.test.ts` 的「v2 样例仍原样不动」+ `test/save.test.ts` 的 v1→v2 四条 | `npm test` |

**一处缺口，说清楚免得误以为有闸**：

1. **§2 没有「世界不碰时辰」这道扫描。** 明天有人把 `phaseAt` 接进 `Simulation`，
   今天没有一道闸会红——除非他顺手写了 `Date.now()`（那会红，见上表第一行）。
   同族纪律是补得上的：`test/lampoil.test.ts` 的「除了清单上那几个文件，世界没人碰灯油」
   就是因为「只看 `simulation.ts`」失效过（有人把「油尽了不走这条路」写进 `grid.ts` 或
   `bustle.ts`，全套照旧绿），才扩到整个 `src/world/` 目录并递归往下。时辰缺的正是这一道。

**一处已经补上的缺口（2026-10-27，原本列在下面）**：**「暴雨天不该有萤火」没有用例。**
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
2. **`docs/SPEC_V2.md` §3 用户故事 33 对时辰是超前的。** 它说「潮汐、灯油、时辰三者谁读谁
   有一条源码扫描测试锁住」。实测：潮汐有（`purity.test.ts` 的「潮汐逻辑不读墙钟」）、
   灯油有（`lampoil.test.ts` 的「world/simulation.ts 不认识 lampoil」与
   「除了清单上那几个文件，世界没人碰灯油」）、**时辰没有**（见 §6 缺口 1）。
3. **`docs/SPEC.md` §4.3 的 `npc.setSchedule` 不在白名单里**（见 §4 末）。

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
  来源是神迹 `miracle.spawn`（`Simulation.performMiracle` 里 `kind === 'cat'` 那一分支）。
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

- **§2 与 §8 之外**，代码里再没有别处引用 `ADR_WORLD_ALIVE` 的节号。
  §1 与 §3–§7 是本记录自己补的，代码没有引用它们——所以改它们的编号不需要动代码，
  改 §2 / §8 的编号要同步那 4 处引用（§1 的表里列了）。
- `day-phase.ts` 文件头还引着 `proto/day-phase.html` 与「ADR 附录 A」，两者都不在本仓。
- 同一份搬迁清单（`docs/MIGRATION_FROM_XIAOXI.md` §五）里的 `docs/ADR_PALETTE_24.md`
  已由另一份记录补上（`docs/adr/ADR_PALETTE_24.md`）；`docs/LARGE_WORLD.md` 仍不在本仓，
  但它只被搬迁清单自己引用，代码没有指着它说话。
- **本记录没有附录 A**，尽管 `day-phase.ts` 指着要一份。四刻配方的实测数据不在这个仓库里。
