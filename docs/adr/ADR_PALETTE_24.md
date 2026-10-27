# ADR：世界 24 色预算——补记一份从未写下的决定

- 状态：已接受（**补记**；被补记的那份文档从未存在）
- 日期：2026-10-27（补记日。决定日据称是 2026-10-21，出处见「不可考」一节）
- 关联票据：**无可考**。本仓其他 ADR 都带票号（`ADR_MEMORY` 的 #7、`ADR_WORLD_FACTS_SOURCE` 的 #16、`ADR_DEFAULT_PACK_BYPASS` 的 #13 #9、`ADR_PACK_SKIPS_WORLD_BUDGET` 的 #9 #13）。这一条查不到对应票据，不编一个填上。
- 上游：`docs/SPEC_V2.md` §4.2「色板：24 色不变，设定集只做映射（用户 2026-10-25 确认）」、`docs/SPEC.md` §4.8 可扩展性、`docs/MIGRATION_FROM_XIAOXI.md` 第五节

## 背景

`world-client/src/world/palette-data.ts` 的文件头写着「依据 `docs/ADR_PALETTE_24.md` 与 `ART_PALETTE_AUDIT` §5.3」；`world-client/test/palette-budget.test.ts` 的文件头写着「2026-10-21 用户批准 24 色 ADR（`docs/ADR_PALETTE_24.md`）」。`docs/MIGRATION_FROM_XIAOXI.md:69` 把 `docs/ADR_PALETTE_24.md` 列为**要从旧仓搬过来**的文档——用途「24 色预算与使用规则」，去向「新仓 `docs/`，改写成『色板预算』通用规则」。

**那份文档从未被写下来。** 补记开始时把 `docs/adr/` 列过一遍，只有五份（`ADR_BUILDING_AT_OPTIONAL`、`ADR_DEFAULT_PACK_BYPASS`、`ADR_MEMORY`、`ADR_PACK_SKIPS_WORLD_BUDGET`、`ADR_WORLD_FACTS_SOURCE`）；在本仓全部历史里（`git log --all`）没有任何提交碰过 `docs/ADR_PALETTE_24.md` 这个路径——它不是被删了，是没来过。同一次盘点里点名要搬的 `scripts/audit-palette.mjs`（`MIGRATION_FROM_XIAOXI.md:72`）跟着代码一起来了，**文档没有跟着来**：把它带进本仓的 `996cbd3`（2026-10-25「搬入世界内核与渲染层，独立跑起来」）落下了 `palette-data.ts`、`palette-budget.test.ts`、`audit-palette.mjs`——前两个从第一版起就带着对那份不存在文档的引用，第三个的文件头也写着「2026-10-21 ADR」，只是没写路径。

所以本 ADR 是 2026-10-27 从代码反推的补记。它能证明的是「代码今天守什么」；它**不能**证明「当初为什么这么定」。两件事在下面分开写，不混——本仓的信条是「证不明就不判」，一条没有出处的理由和一条错的理由一样是 bug。

## 决策（代码今天守的这一份）

1. **世界层 24 个源色、UI 层 8 个、两层共享 1 个、并集 31。** 世界那 24 个是 canvas 上唯一允许出现的世界源色；UI 那 8 个活在 `index.html` 的 `<style>` 里，两层只共享琥珀 `#e3a13c` 一个值。
2. **token 名是闭集。** 加第 25 个色 = 加第 25 个 token = 再走一次 ADR。`docs/SPEC_V2.md` §4.2 把这条定为引擎级约束（「24 色不变，设定集只做映射」），`GLOSSARY.md` 的「24 色预算」条目收的也是这一句。
3. **设定集换值不换名。** `world-client/src/world/theme.ts` 把 `WorldPalette` 定义成 `Readonly<Record<WorldColor, number>>`——槽名来自 `WORLD`，是闭集；设定集手册自己的 11 色只是另一组**值**，落点仍是这 24 个槽。写错一个槽名（`terracota`）要当场编译失败，而不是运行时画出一个 `undefined` 色、安静地什么都不显示。

## 代码到底怎么守的（这一节全部可验）

### 一、`world-client/test/palette-budget.test.ts`——默认世界 + UI，11 条

补记当天跑过：`palette-budget.test.ts` 11 条 + `setting-palette.test.ts` 4 条，15 条全绿。逐条：

| 断言 | 实际判什么 |
|---|---|
| `世界层正好 24 个源色，且没有重复值` | `Object.values(WORLD).length === 24` **且** `new Set(values).size === 24`。色数与去重两条都查 |
| `UI 层正好 8 个源色` | 从 `index.html` 的 `<style>` 里抓源色：6 位十六进制字面量 + `rgba()`/`rgb()` 的前三个通道（四舍五入成 `#rrggbb`），去重后正好 8 个 |
| `WORLD 的每个 token 值都等于提案 24 色（换值必须变红）` | 与一份**逐字抄在测试里**的 24 项 `名字 → #rrggbb` 表做 `deepEqual`。名字多一个少一个、值换一分，都红 |
| `UI 的源色集合等于提案 8 色（换值必须变红）` | 排序后集合相等 |
| `世界与 UI 只共享 #e3a13c，并集 31` | 共享色必须**正好**是 `[hex(WORLD.amber)]`；并集大小必须正好 31 |
| `render/scenes 里不再有 canvas 颜色字面量（只许引用 WORLD）` | 对 `main.ts`、`render/buildings.ts`、`render/decor.ts`、`render/smoke.ts`、`render/tilemap.ts`、`render/villager.ts`、`render/weather.ts`、`scenes/SandboxScene.ts` 八个文件剥掉块注释后扫 `0xRRGGBB`，必须一个都没有 |
| `全部蓝图 × 4 槽都指向 WORLD token` | `prefabs.json` 每份蓝图的 `palette` 每个槽都必须是字符串、且必须是 `WORLD` 的键；总槽数必须等于蓝图套数 × 4（数字不写死，加一栋楼不用改这里） |
| `解析器兼容旧值：整数与 "#rrggbb" 都解析回同一个数` | `parseBlueprint` 对 token 名、整数、`#rrggbb` 三种写法给出同一个 palette |
| `未知颜色名的报错能看懂` | 抛 `BlueprintError`，且消息里同时有槽位（`调色板槽 body`）、原值（`"sage"`）、可用清单开头（`ink, soil, grass`） |
| `读档后按当前 prefab 重解 palette` | `buildWorldFromSave` 取**当前**蓝图的 palette；存档里留的旧色（`0x6b7a6a` 那一组）不得残留在读档结果里 |
| `读档遇到不存在的 prefab` | 保留存档色、不崩 |

第三条为什么重要，测试自己的注释写明了：`--strict` 只判**色数**，`WORLD.ink` 换成 `#000000` 时它仍是「超出 0」——值这一半的门禁只有这条断言在守。文件头还记了它为什么用纯逻辑断言而不靠 `npm test` 的子进程隔离：沙箱里会 spawn EPERM。

### 二、`world-client/src/settings/load.ts` + `test/setting-palette.test.ts`——设定集这一侧

`loadSettingPack` 把槽名表取成 `Object.keys(WORLD)`，然后：

- **每个槽都必须填**，漏一个抛 `缺少色板槽 <token>`；
- **24 个槽各占一个不同的色值**，不够 24 个不同值就抛 `24 个色板槽必须各占一个不同的色值，实际只有 N 个`。注释记了为什么不能只查上界：`grassLit` 与 `stone` 曾经同填 `#52666a`，只查「不超过 24」会放它过去，而画面上「草地受光面」这个槽根本不存在、调用方却以为 24 色都占着；
- 八种地形各自要落到一个槽上，缺一种抛 `缺少地形配色 <terrain>`，指向不存在的 token 抛 `色 <token> 不在 24 色里`；
- 居民外观的 `cloak` / `scarf` 只能是槽名。

`test/setting-palette.test.ts` 四条钉住它：重复值一律拒收（换成另一对也一样，不是只盯 `grassLit` 这个名字）、漏槽拒收、地形缺落点拒收、合法配置装载后 24 个键 24 个不同值。

### 三、输入口：`creator-schema.ts` 与 `blueprints.ts`

- **造物主 schema 只收 token 名**：十六进制一律拒（`palette.<slot> 不接受十六进制 "…"：只能用 24 色表的 token 名，否则会绕开调色板预算`），不在 `WORLD` 里的名一律拒并附上全部 24 个名字。`test/creator-schema.test.ts` 有对位的三条，含「玩家选的配色同样受 24 色约束：造物模式没有特权」。
- **蓝图解析器兼容旧值**：token 名优先，`0..0xffffff` 整数与 `"#rrggbb"` 仍能用，但每种槽只警告一次（`[blueprints] 调色板槽 … 用的是旧值 …`）。

### 四、`world-client/scripts/audit-palette.mjs --strict`——CI 里那条

`.github/workflows/ci.yml` 在 `npm run build` 之后跑 `node scripts/audit-palette.mjs --strict`。它自己有一份 `PROPOSED_WORLD`（24 项，带语义角色）与 `PROPOSED_UI`（8 项），`--strict` 在任一层超预算时退出码 1。**本 ADR 补记当天实测**：世界层唯一色 24（引用 345 处）、UI 层 8（116 处）、共享 1（`#e3a13c`）、并集 31，两层超出都是 0。

## 理由：哪些能证，哪些不能

**能证的：**

- **24 这个数今天成立，而且是被三处独立守着的。** `WORLD` 里 24 个键、24 个互不相同的值（本 ADR 补记时逐个数过）；`palette-budget.test.ts` 判色数与去重；`loadSettingPack` 对每份设定集判「24 个槽各占一个不同值」。
- **色板是要能换的，而且已经换过一次。** `theme.ts` 的闭集槽名 + `settings/types.ts` 要求每份包都带 `palette: WorldPalette` + 灯潮界那份真的给了另一组 24 个值（`settings/dengchao/pack.ts`）。`render/tilemap.ts` 里 `const palette = theme?.palette ?? WORLD;` 然后逐层传下去——渲染层不再自己读全局 `WORLD`，那块注释记着改它之前的两块色板同时出现在一张画面上的事。
- **UI 那 8 色与世界那 24 色是两份预算，只共享琥珀一个值。** 测试里 `shared` 必须正好是 `[hex(WORLD.amber)]`。

**不能证的（本 ADR 不替它编理由）：**

- **「2026-10-21 用户批准」这个日期与这次批准本身。** 它只出现在两个文件头里（`palette-data.ts` 与 `palette-budget.test.ts`），而这两个文件是随 `996cbd3`（2026-10-25）一起搬进本仓的——**这句话是跟着代码进口的，不是在本仓写下的**。本仓没有任何提交信息、文档、票据记录这次批准。它很可能是真的（旧仓 `cs1lion/xiaoxi` 里大概真有那份文档），但**本仓证明不了**。
- **`ART_PALETTE_AUDIT` 是什么，它的 §4.1 / §4.2 / §5.1 / §5.3 说了什么，甚至它是否存在过。** 全仓对 `ART_PALETTE_AUDIT` 的命中只有**四处**，没有一处是定义：`palette-data.ts` 文件头、同文件 `TERRAIN_SPECK` 上面那段、`palette-budget.test.ts` 文件头与提案表那段。**那四处引用本身已修掉**（2026-10-27，见下面「已知对不上的地方」第 1 项）——今天还能搜到的四处，全是记录「原来挂着一个不存在的出处」的说明文字，不再是引用。没有任何文件名、任何目录、任何 git 对象对得上那份文档。**本 ADR 因此不描述一份叫 `ART_PALETTE_AUDIT` 的文档**，好像它存在过一样。
- **为什么是 24、为什么 UI 是 8、为什么两层共享琥珀、为什么是「16 色材料表 + 8 个新增」。** 后者的两个半边在本仓能对上：`palette-data.ts` 说「在 16 色材料表上新增 8 个材料/光色（W17–W24）」，`audit-palette.mjs` 的文件头说「前 16 色为原材料表，W17–W24 为 2026-10-21 ADR 新增材料/光色」——两份独立记载互相印证，所以「24 = 16 + 8，新增的是 W17–W24」可证。但**为什么停在 24**，没有出处。
- **W17–W24 指哪八个。** 可证，而且要说清楚它是什么：`palette-data.ts` 给每个 token 的注释头上编了 W01–W24（按声明顺序），**这些编号只是注释里的标签，不是标识符**——全仓搜不到任何名为 `W17` 的标识符，命中全是注释。按编号对上号，新增的八个是 `plaster`（W17 灰泥墙/浅色纸面）、`terracotta`（W18 陶瓦/砖）、`copper`（W19 铜绿屋顶）、`water`（W20 水）、`moss`（W21 苔）、`deepShade`（W22 冷影）、`warmLight`（W23 暖高光）、`charcoal`（W24 炭黑）。文件头把这八个的用途罗列了一遍，那是一条**记载**，不是一条理由。
- **W05 那段 2026-10-20 明度重排的实测数字**（众数带 67.01% → 45.79%、IQR 9.39 → 13.39、「真实渲染 A/B，同机同时刻双 server」）。这是另一件事（改值，不改色数），本仓没有任何产物对得上这些数。它写在注释里，本 ADR 照抄不了它的出处。
- **这份补记之外的原始备选方案。** 见下节，那一节因此只有形状、没有内容。

## 后果

- 好：**预算是被执行着的，不是一句口号。** 四条互相独立的机关——默认世界与 UI 的值表（`palette-budget.test.ts`）、每份设定集的槽表（`loadSettingPack` + `setting-palette.test.ts`）、两个输入口的白名单（`creator-schema.ts` / `blueprints.ts`）、CI 里的色数审计（`audit-palette.mjs --strict`）。换值、加色、写十六进制、漏槽、重复值，各有至少一条会红。
- 好：**换设定集不破预算这件事有实证。** 灯潮界给了另一组 24 个值，`loadSettingPack` 收下它、`test/setting-palette.test.ts` 证明它装载后仍是 24 个互不相同的值。`docs/SPEC_V2.md` §4.2 那条「24 色不变，设定集只做映射」因此不只是规范文字。
- 代价：**同一份 24 色表在仓库里存在三份。** `palette-data.ts` 的 `WORLD`（权威）、`palette-budget.test.ts` 的 `PROPOSED_WORLD`、`audit-palette.mjs` 的 `PROPOSED_WORLD`。后两份是故意的（测试要「换值必须变红」，脚本要「越界色最近的是谁」），但改一个色值要同时动三处，漏一处就红——这是设计好的摩擦，只是它不是免费的。
- 代价：**`audit-palette.mjs` 看不见设定集。** 它的文件清单是 `src/main.ts`、`src/render/*.ts`、`src/scenes/*.ts`、`src/ui/*.ts`、`index.html`、`src/world/prefabs.json`、`src/world/palette-data.ts`——**没有 `src/settings/`**。所以它审计的是默认世界 + UI，灯潮界的色板它一个都没看见。而盘点文档对它的嘱咐正是「搬，换设定集后改预算」（`MIGRATION_FROM_XIAOXI.md:72`），那一改没有发生。
- 代价：**造物主那条路认的是默认世界的值。** `creator-schema.ts` 的 `readPalette` 用 `WORLD[token]` 取值，`SandboxScene` 用 `tokenNameOf`（同样只翻 `WORLD`）把模板配色反查成 token 名喂回去。于是灯潮界里造一座楼，模型给的 token 名解析出来的是**莞尔镇的色值**。槽名这一层是通用的，取值这一层不是。本条只是如实记下代码现状，**不是**本 ADR 做的决定，也没有对应的决定可引。
- 代价：**24 与 24 个槽名仍然住在 `palette-data.ts` 里。** 那份文件同时是「24 个槽叫什么」的定义处与「默认世界用哪些值」的存放处（`blueprints.ts` 的 `parseBlueprint` 第三个参数默认就是 `WORLD`）。要加第 25 个槽，改的是那个数据表——`GLOSSARY.md` 提醒过「它是**色值数**，不是槽位数」，而在今天的强制执行下这两个数恒相等（`loadSettingPack` 要求 24 个槽 24 个不同值），那条区分目前没有可观测的场合。

## 已知对不上的地方

**这一节前三项已在补记当天（2026-10-27）修掉**，第四项仍开着。修法都遵从同一条纪律：
指名，不叫行号——本仓的引用审计只查「那一行有没有代码」，查不出「那一行是不是说的那个东西」，
而行号在任何一次编辑之后都会漂。

1. ~~**`ART_PALETTE_AUDIT` 四处悬空引用**~~ **已修。** 本仓没有任何对得上的文件
   （全仓 4 处命中全是引用、零处定义）。修法不是把那份文档补出来——补一份没人见过的审计
   等于编造；而是把四处引用删掉，各留一句「那份文档不存在，出处删了，理由照留」。
   本 ADR 自己也因此**不**描述一份叫 `ART_PALETTE_AUDIT` 的文档，好像它存在过一样。
2. ~~**`docs/ADR_PALETTE_24.md` 仍然不存在，而两处文件头拿它当依据。**~~ **已修，
   但不是靠改路径修好的。** 两处文件头原来写的是 `docs/ADR_PALETTE_24.md`（少了 `adr/`），
   而本 ADR 的落点是 `docs/adr/ADR_PALETTE_24.md`。所以即便本 ADR 补上了，原来那条路径
   仍然指不到它。修的时候两处一并改成 `docs/adr/ADR_PALETTE_24.md`。
   本 ADR 补上的是「代码守什么」，补不上「当初为什么」——这一半仍然成立。
3. ~~**`palette-data.ts` 的亮度分布那段，三个括号和它们头上的三个数对不上。**~~
   **已修。** 原文：「暗部 11（W01–W09、W13、W14、W22）、中间调 7（W08、W15、W17–W21、W24）、
   亮部 6（W10–W12、W16、W23）」。逐项数三张名单：12 / 8 / 5，与头上的 11 / 7 / 6 都不符；
   且 W08（`timber`）同时出现在「暗部」与「中间调」两张名单里——三张名单加起来是 25，
   比 24 个 token 多一个。三个头上的数加起来刚好是 24，所以那段读起来像一次干净的三分，
   而它其实是「某一色跨了两档」。按 sRGB 相对亮度逐色算过也复原不出 11/7/6：
   `timber` 13.1% 列在暗部，而 `charcoal` 6.9% 列在中间调。
   现在按数出来的写：12 / 8 / 5，并明说 W08 跨档、三档不是亮度规则。
4. ~~**`audit-palette.mjs` 里 `soil` 的角色说明已过期。**~~ **已修。** 原文写着
   「当前 soil 定义未引用，保留槽」，而 `WORLD.soil` 这个写法今天在 `src/` 与 `test/` 下
   23 处、横跨 7 个文件——它不是保留槽。这行只是报告里的一个标签，不改任何判定，
   但按本仓的标准它是一句假话，所以照实改了。

   **这两个数补记时也写错了，一并记下（而且错得不只一处）。** 补记写的是
   「约 50 处引用、横跨 9 个文件」，三种数法数不出这个组合。重新数过之后，
   这一段的原样也是错的，错在三个地方：

   - **数法写错了。** 原文说「数法是 `grep -rc`，照着能重算」，而它给的两个数
     （23/7 与 74/12）里，窄的那个能用 `grep -rc` 重算，裸词那个不能。
   - **裸词那个数今天已经重算不出来。** 它是补记那天数的，此后仓里长了新文件
     （`terrain-edge-pixels.test.ts`、`terrain-edges.test.ts` 里的用例都多了），
     今天 `grep -rc "soil" src test` 是 **81 处 / 13 个文件**。
     所以这里不再报一个"今天的数"——报了就是下一句假话。要数的时候自己重跑。
   - **给裸词更大编的理由是假的。** 原文说「因为色板里不止 `soil` 一个槽带这个词」
     ——`palette-data.ts` 里**只有一个**键叫 `soil`（`soil: 0x1b211c`，W02）。
     翻遍色板找不到第二个带这个词的槽，想据此改个名的人会白花时间，更糟的是他
     可能反过来"修"这句话，凭想象添一个槽名进去。

   真实的原因是三样，都能指到文件：`palette.soil` 这种**解构后的本地名**
   （`src/render/tilemap.ts` 11 处，全仓只有这一个文件这么写）、设定集里的
   **地形键映射**（`src/settings/dengchao/pack.ts` 把 `tree` / `mud` 映到 `soil`）、
   以及**散文**（`terrain-edges.ts` 与 `tide-view.ts` 的注释在解释为什么某个材质
   不用 soil）。所以裸词大不是因为色板里有重名，是因为 `WORLD.soil` 只是同一个
   颜色的其中一种写法。

   窄写法那个数（`WORLD.soil`，23 处 / 7 个文件）复核过，逐文件一个不差：
   `src/render/buildings.ts` 4、`decor.ts` 6、`terrain-edges.ts` 1、`villager.ts` 1、
   `src/scenes/SandboxScene.ts` 1、`src/world/palette-data.ts` 3、
   `test/terrain-edges.test.ts` 7。**它也会漂**——同一天数的裸词就已经从 74 漂到 81。
   所以这条结论（"它不是保留槽"）不依赖任何一个具体数：`palette-data.ts` 自己
   写着 `tree: WORLD.soil`、`grass: WORLD.soil`、`farm: WORLD.soil`，三个地形槽
   都在用它，这一条就够定性了。

**仍然开着的一项**：

5. **「2026-10-21 用户批准」这个日期与这次批准本身，本仓证明不了。** 它只出现在两个文件头里，
   而这两个文件是随 `996cbd3`（2026-10-25）一起搬进本仓的——这句话是跟着代码进口的，
   不是在本仓写下的。本 ADR 无法补上它，只能把它标成「不可考」，见上面「不能证的」一节。

## 备选

**这一节只剩形状。** 原始 ADR 考虑过哪些方案、为什么否掉，本仓没有任何记载——`git log --all -S` 找不到，`docs/adr/` 里没有，五个已存 ADR 也没有一处引用过它。下面三行是**本 ADR 补记时能看见的、今天仍然开放的选项**，不是原始备选方案的复原；把它们写成「当年否过」会是编造。

| 今天的选项 | 现状 |
|---|---|
| 把 24 改成别的数（20、32……） | 要动 `palette-data.ts`、两份提案表、`GLOSSARY.md`、`docs/SPEC_V2.md` §4.2，并且按本 ADR 第 2 条要再走一次 ADR。**为什么当年定 24，无出处。** |
| 让 `audit-palette.mjs` 也审设定集（把 `src/settings/` 加进文件清单、预算随包走） | 未做。做之前要先回答「一份包的预算是 24 还是它自己声明的」——`loadSettingPack` 今天按 `Object.keys(WORLD)` 这个全局表判，没有「每包一份预算」的槽位 |
| 让造物主那条路认当前包的色值 | 未做。要改的是 `creator-schema.ts` 的取值来源与 `SandboxScene` 的反查，不是 schema 的形状 |
