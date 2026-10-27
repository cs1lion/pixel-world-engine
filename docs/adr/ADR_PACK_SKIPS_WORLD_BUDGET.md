# ADR：编译后的设定集不跑 assertWorldInvariants——包这条路漏掉的世界校验

- 状态：已接受（补记代码里既有的分叉；附两处待办）
- 日期：2026-10-27
- 关联票据：#9 #13
- 关联 ADR：`ADR_DEFAULT_PACK_BYPASS`（默认世界为何绕开编译器；本ADR 展开它末尾一句，并改正其中一处错的理由）
- 上游：`docs/SPEC.md` §4.8 可扩展性；代码 `world/setup.ts` 的 `validateCoverage`/`assertWorldInvariants`、`settings/load.ts` 的 `buildSettingWorld`
- 术语：本ADR 的「世界法则」专指 `setup.ts` 对**已建成世界/蓝图表**跑的校验（空间 + 预算 + 覆盖）；它与 SPEC §4.2 的 L1「命令必须过 Schema」是两层不同的东西，全文不混用。

## 背景

两条建世界的路，对世界法则的校验态度不同：

- **程序生成的默认世界**：`buildLargeWorld → buildWorld` 落地后跑 `validateCoverage`（`setup.ts:258`）和 `assertWorldInvariants`（`setup.ts:324`）；读档路 `buildWorldFromSave` 跑 `assertWorldInvariants`（`setup.ts:602`）。
- **编译后的设定集**：`loadSettingPack → buildSettingWorld`（`load.ts:340-405`）——新建路与 `saved` 读档路（`load.ts:340-356`）**两个都不跑**上面任何一个。（`world-client/src` 内对 `assertWorldInvariants` 的调用只有 `setup.ts:324`、`setup.ts:602`，定义在 `setup.ts:629`；测试直接调它：`test/world.test.ts:120,126`、`test/large-world.test.ts:106`；`simulation.ts:1657` 还在散文里援引它。）

`buildSettingWorld` 并非不校验，它的 docstring 把承诺划了界：「显式落位也走生产的占地/留白/门口检查；不能由设定集绕过世界法则」（`load.ts:341`）。它确实把每处落位交给 `placeBlueprint`（内部走 `checkPlacement`，调用 `setup.ts:455`、规则 `setup.ts:201-245`：出界、分区、占用、留白、门口可建），并核居民出生点可走、作息点可达（`load.ts:356-381`）。但这句话第二分句「不能由设定集绕过世界法则」没带限定词，而它实际只兑现了**空间**那一类——预算与覆盖这两类世界法则，包这条路一概没人跑。这就是本ADR 的主题：一处主动豁免（预算，合理），两处无人认领（门口可达、venue 覆盖）。

## 决策

**编译后的设定集不跑 `assertWorldInvariants`。** 这是补记，代码早已如此。包的空间法则在 `buildSettingWorld` 内联执行（`placeBlueprint` + 居民可达性）；属于程序生成世界的铺子预算/分区上限，不套到包上。

同时如实记下包这条路**还漏掉的两类校验**——它们不是本决策主动豁免的，是根本没被调用：`validateCoverage`（venue 覆盖）与 `assertWorldInvariants` 里唯一 generic 的那条「门口可达 hub」。各记一个待办（见后果）。

## 理由

**预算校验对包不是「恰好无害」，是「跑了就整体拒掉」。** `assertWorldInvariants` 要求每种 `WORKSHOP_TASKS`（`tasks.ts:17` = code/research/writing）恰好 1–2 栋铺子承接，否则记 problem（`setup.ts:644-648`），末尾 `throw`（`setup.ts:685`）。灯潮界每个模板都过同一个 `prefab()` 助手、`boundTask` 硬编码 null（`settings/dengchao/pack.ts:14`），于是每种活 0 栋 ⇒ 对三种活各记一条 ⇒ 开工即抛。所以「让包也跑 assertWorldInvariants」不是保守，是把灯潮界连壳拒了。`ADR_DEFAULT_PACK_BYPASS` 原写「今天无害（boundTask 都为 null）」是**错的**——null 不是「不参与」，是「0 栋」，正触发下限；本ADR 已回改那条。

**`assertWorldInvariants` 是三类检查的混合，只有一类 generic。**

| 段 | 查什么 | 行 | 对包 |
|---|---|---|---|
| 铺子预算 | 每种活 1–2 栋 | `setup.ts:644-648` | 不适用（生成器口味）；跑了还误杀 |
| 分区上限 | 每分区铺子 ≤2（未校验「镇内/郊野各一」） | `setup.ts:664-670` | 不适用 |
| 门口卫生 | 门口不开在 altar 区、可通行、与 altar 有通路 | `setup.ts:672-683` | 仅「与 hub 有通路」generic 且包拿不到；另两条对包是空转（见下） |

## 后果

- 好：手写包不会因「工坊数量不合生成器口味」被整体拒；包作者守的是空间律 + 自己的结构铁律（居民至少一位、不重名，`loadSettingPack` 编译期查）。
- **待办 A（窄，真实）：包的新建路拿不到「门口可达 hub」这一条。** `assertWorldInvariants` 的 `setup.ts:679-683` 会为默认世界拦下与祭坛无通路的楼；`buildSettingWorld` 只核居民 `at→stop`（`load.ts:356-381`），不核每栋楼门口到 hub。但今天的前馈数据构造不出这个失败：`prefabs.json` 12 份蓝图 `clearMargin` 均为 1、灯潮界同样为 1（`pack.ts:11`），margin 环（`grid.ts:325-332`）让自由内部恒四连通、门口侧邻永不被封。要复现得靠三种之一：`clearMargin: 0` 的蓝图（合法，`blueprints.ts:45`、`test/placement.test.ts:91` 已练过）、门口偏移到很远的蓝图（合法，`blueprints.ts:52` 只拒门口落在占地内）、或 `saved` 读档路（`load.ts:345` 直接 `grid.place`，无留白/分区/门口检查）。而且新建路本就**尝试**连 hub：`placeBlueprint` 锚在 `pack.hub`，`paveFrom` 算 `door→hub` 路径（`setup.ts:489`）——失败形态是「没铺出路、也不报错」，不是「没尝试」。最小修点就在 `paveFrom`：空路由时它静默丢（`setup.ts:548-552`），在此发一处信号能同时惠及两个世界，比在 `buildSettingWorld` 单补一条更小。
  - **已于 2026-10-27 补上。** 信号落在 `doorReaches`（`setup.ts`）——「这扇门连不连得出去」的两侧共用定义，`paveFrom` 的 `reachable` 与 `assertWorldInvariants`、`buildSettingWorld` 都从它取。包的新建路在**全部落完再查**（不是落一栋查一栋：后一栋能把前一栋的门围死），读档路照旧不查（存档是照着一份当年通过的世界写的）。复现见 `test/pave-reachable.test.ts`：四栋 `clearMargin: 0` 的蓝图把一栋 2×2 的孤屋围住，`buildSettingWorld` 当场抛。顺带修掉 `assertWorldInvariants` 同一处潜在误报——门就开在祭坛上时 `grid.path` 返回空数组（「她人已经在那儿了」），照抄它会把一扇最好的门报成没有通路。
  - 另两条门口检查对包是空转，勿计入损失：「门口可通行」由 `grid.place` 强制（`grid.ts:298-299` 把门口设成 walkable 的 stone）；「门口不开在 altar 区」需要真有名为 `altar` 的分区（`setup.ts:673`），灯潮界只声明 industry/street，永不触发。
- **待办 B（宽，2026-10-27 已决：可以，且引擎早就容得下）：包这条路没有任何「venue 覆盖」法则。** 蓝图表层面有 `validateCoverage`（`blueprints.ts:96-118`）：每种活 1–2 栋常驻铺子，理由写得很直白——「0 栋等于这类活无处可去；超过 2 栋则是蓝图表失控」（`blueprints.ts:103-104`），并顺带查 `upgradeTo` 有落点（`:111-115`）。它只被 `buildWorld` 调（`setup.ts:258`），`loadSettingPack`/`buildSettingWorld` 都不调。于是灯潮界三种活各 0 个 venue——正是 `validateCoverage` 要防的状态，在包这条路静静成立；`intent-context.ts:110` 只是按 `WORKSHOP_TASKS` 逐类算 capacity 喂给提示词，没有谁据此拒。**一座包可不可以正当地图一地没有工坊？**
  - **答案是可以。** 引擎在派活那一侧本来就拒，不编一座铺子出来：`pickVenue()`（`venue.ts:56`）挑不到就回一句原因，两条派活路径——事件流 `pickVenue()`（`simulation.ts:1612`）、神谕 `pickVenue()`（`simulation.ts:1874`）——据它拒绝，谁都不造假铺子。所以这不是个漏洞，是个已经成立的设计。
  - **L1 命令的归宿也清楚了，而且比原先问的更干脆：在这张图上根本造不出接活的铺子。** 灯潮界的 `prefab()` 助手把 `boundTask` 写死成 `null`（`pack.ts:14`），七个模板一视同仁——连白名单里唯一建得成的候车亭（`pack.ts:85-90` 说明了为什么留它）也不接活。所以那三类活在灯潮界不是「暂时办不到」，是**这个世界不办的事**。派单时如实说没有，就是全部正确的行为；要真给它一个 venue，改的是设定集（给某栋楼填 `boundTask`），不是引擎。
  - **要修的是拒的时候说的那句话。** 原话是「没有空闲的 code 铺子。」——那是假的：它暗示有、只是忙，而这里一栋都没有，照着它去找的用户会去找一座不存在的铺子。`pickVenue` 因此从 `VenueCandidate | null` 改成 `VenuePick`，挑不到时连原因一起回：`none` 是镇子的事，`busy` 是楼的事，两句话对用户是不同的真话。复现与钉住见 `test/zero-venue-pack.test.ts`（含一条默认世界的对照组，防「派活本来就崩」冒充修好）。这也意味着**待办 B 不需要给 `loadSettingPack` 接上 `validateCoverage`**——那会拒掉一张合法且自洽的图。
- 运行期提醒：`assertWorldInvariants` 只在开工/读档跑。造物主/玩家的落位接缝 `placeFromPlan`（`setup.ts:412-433`）走 `placeBlueprint` 后**不复检**，`src` 内别无调用。所以「默认世界两条路都拦」只对**建成/读档那一刻**成立；运行期 `building.add` 引入的门口问题，两个世界都不拦。门口缺口因此是建时/读档时的分叉，不是运行期的。

## 备选

| 方案 | 为什么没选 |
| --- | --- |
| 包也整体跑 `assertWorldInvariants` | 误杀：预算/分区是生成器口味；灯潮界 0 栋/活会被 `575-580`+`603` 整体拒掉 |
| 拆 `assertWorldInvariants` 成 generic/procedural 两半，包只跑 generic 半 | 方向对，是待办 A 的正式形态；但对稳定、被测函数是重构，单开一项，不夹带 |
| 只在 `buildSettingWorld` 补「门口可达 hub」 | 待办 A 的最小候选；但更小的修点在 `paveFrom`（已算该路径、空路由静默丢），一处信号惠及两个世界 |
| 让 `loadSettingPack` 顺手接上 `validateCoverage` | 待办 B 的一侧；但是个设计决定（包能否无工坊），要先定 L1 命令的归宿，不能顺手接上 |
