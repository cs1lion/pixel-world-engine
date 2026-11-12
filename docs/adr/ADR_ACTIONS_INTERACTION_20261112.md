# ADR_ACTIONS_INTERACTION_20261112：语义动作集、小素材绑定与玩家交互闭环

- status: aligned
- verified_at: 2026-11-12
- verified_by: agent（EDD 实验序列与十一道闸门读数见 `docs/evidence/interaction-eval/BASELINE.md`）
- evidence: `world-client/src/animation/villager-anim-fsm.ts`, `world-client/src/render/villager.ts`, `world-client/src/world/simulation.ts`, `world-client/src/ui/villager-panel.ts`, `server/rules/schema.py`, `docs/SPEC.md`

## 0. 本 ADR 的状态

**已实现并合并**。初版是设计规格（只设计不实现）；用户随后选定第 9 节的 C 方案
（七人各一张分人动作表，保留个体差异），并按 EDD 的「先写评测集、再写功能」
把 D1–D4 逐笔落地。实现顺序与逐条读数见
`docs/evidence/interaction-eval/BASELINE.md`：实验 0（4/16）→ exp-1（7/10）
→ exp-2（8/10）→ exp-3（10/10）→ exp-4（10/10，素材收口）→ 备用集 6/6。
主集全绿后才把评分器接进 CI 的 browser job。

## 1. 问题

用户三条批评，逐条都有实测依据：

1. **人物动作死板**。`render/villager.ts` 的 `updateVillager` 里，位图立绘只有
   `setFlipX` + 整数像素 `offsetY` 起伏 + `setAlpha`，**单张静态图**；程序化小人
   也只有 2 帧呼吸与走路摆脚（`render/villager-frames.ts` 的 `IDLE_POSES` /
   `WALK_POSES`）。`animation/villager-anim-fsm.ts` 已有 5 个状态，但文件头明写
   「尚未接管渲染」，两套状态没合上。
2. **小素材没用上**。上一轮对十张参考图做过逐图用途审计（结论已并入本文件
   第 7 节，不依赖外部文档）：十张图完整用上 2 张，清单 66 件里至少 14 件
   确定零消费方；真实开局可见的装饰图只有 5 个文件。
3. **交互不足**。`ui/unit-status.ts` 文件头写着「只读、不改世界」「不提供任何
   写入口」；点开村民或楼只能看档案与状态。世界按作息自己跑完，玩家没有
   「对具体对象发起一件事」的入口。

用户的意图不是逐帧动画堆砌，而是：**一组语义动作，一个动作代表一类行为；
小素材绑到用得上的东西上；最重要的是玩家发起 → 世界执行 → 看得见反馈的闭环。**

## 2. 硬边界（先钉死，免得设计走偏）

- **不改 SPEC 三条铁律**，尤其第一条「世界自己跑」。`docs/SPEC.md` 的用户故事
  明写「居民按自己的作息活动，不是围着我转」。所以本设计**不是**让村民围着
  玩家转，也不是把作息改成等指令；而是新增「玩家可发起、世界按自己的法则
  结算、可以被拒绝」的入口。同一份文档的用户故事 7/8/9 正是这个意思：
  我说话，世界按法则反应，拒我时说清为什么，之后自己回到节律。
- **不动存档契约**：不新增存档字段、不改 `schemaVersion`，动作是渲染层状态，
  由确定性输入推出，不进快照。
- **不打破回放一致性**：动作帧由世界时间驱动，不读墙钟、不用随机数；冻结
  世界后画面必须逐帧一致（`check-ground-shadow` 的 `shotStable` 连续 8 帧
  逐字节相同是硬闸）。
- **不把两份白名单当一个**。`docs/SPEC.md` 专门记过这个错：规则层的
  `COMMAND_CHECKS` 管「LLM 能说什么」，客户端的 `WorldCommand` 管
  「玩家/前端能排进世界什么」。两者各自维护，不许互相冒充。
- **不产生「清单里有但没人查」的素材**：上一轮的教训。本设计里每件素材
  必须有唯一、可达的消费点，达不到的直接不生成或从清单删掉。

## 3. 现状事实（本轮只读核对的读数）

| 项 | 实测 |
|---|---|
| `VillagerMode` | 8 种：`idle` / `saluting` / `toWork` / `working` / `delivering` / `toAltar` / `sheltering` / `bearingDecree` |
| `AnimStateId` | 5 种：`idle` / `walk` / `salute` / `work` / `deliver`；`animIntentOf` 把 4 种赶路类 mode 全按 `walking` 分流到 `walk` |
| `TASK_PROFILES` | 4 类活：`code` / `research` / `writing` / `quick` |
| 工位状态 | `idle` / `operating` / `overheating` / `cooling`（`overheating` 无生产者） |
| 规则层白名单 | 7 条：`weather.set` / `tide.setLevel` / `building.add` / `building.remove` / `miracle.spawn` / `npc.setSchedule` / `villager.carry`；`npc.setSchedule` 未实现客户端意图 |
| 提示词 | `oracle/prompt.py` 的 `COMMAND_LINES` 只列 6 条，刻意不列 `npc.setSchedule` |
| 玩家现有入口 | `dispatch`（派活）/ `finish`（人工交付）/ `build` / `miracle` / `say`（神谕）都经 `sim.enqueue`，**不走规则层白名单**；点击面板全是只读 |
| `villager-sprite-sheet.png` | 5472×3072，背景投影实测真实网格 **4 列 × 6 行**（每行一个动作、每列一帧），6 组有效帧数 `3 / 4 / 4 / 2 / 4 / 4` = **21 帧** |
| 动作表内容 | 行 0 待机站立 3 帧；行 1 前 2 帧空手赶路、后 2 帧推车搬运；行 2 敲锤干活 4 帧（含火花）；行 3 擦汗休息 2 帧；行 4 倾倒/取水 4 帧；行 5 欢呼 4 帧 |
| **风格冲突** | 动作表是**侧面草帽少年、棕衣、约 3 头身**；引擎 7 张立绘是**正面 chibi、深墨描边、七人各异**。视角 / 体型 / 笔触都不同，直接贴上去就是新一轮风格断裂 |

## 4. 决策 D1：语义动作集（7 个主动作 + 3 个叠加态）

动作 = 一类行为，不是一段随便播的动画。7 个主动作与动作表 6 行 1:1
（行 1 拆成「赶路」与「搬运」两个语义），21 帧全部有归属，零浪费。

| 动作 id | 代表的行为 | 对应 `VillagerMode` | 对应 `AnimStateId` | 帧来源（动作表） | 帧数 | 触发源 | 绑定的小素材 |
|---|---|---|---|---|---|---|---|
| `idle` | 什么都没在做 | `idle` | `idle` | 行 0 | 3 | 世界 | — |
| `walk` | 去某处（赶路 / 避雨 / 送急件） | `toWork` / `toAltar` / `sheltering` / `bearingDecree` | `walk` | 行 1 前 2 帧 | 2 | 世界作息 **或玩家派活** | 目的地贴片（HUD 提示） |
| `carry` | 搬运 / 拿着东西走 | `delivering`（持物段） | `deliver` | 行 1 后 2 帧（推车） | 2 | **玩家给东西** / 世界搬运 | `icon/role-05` 手推车 |
| `work` | 在工位干活 | `working` | `work` | 行 2 | 4 | 到工位 / 玩家派活 | 任务图标（见 D4） |
| `rest` | 歇一下 / 擦汗 | `sheltering`（停下时） | `idle` | 行 3 | 2 | 天气 / 长途之后 | `emote-02` 汗滴 |
| `pour` | 倾倒 / 取水 / 点灯 | `working`（灯油类） | `work` | 行 4 | 4 | 世界 / 玩家给灯油 | `emote-10` 水花 |
| `cheer` | 活干完了 / 交付达成 | `delivering`（完成瞬间） | `deliver` | 行 5 | 4 | **玩家点交付** / 世界自动交付 | `emote-11` 金币、`state/workshop-03` |

**3 个叠加态不新增帧**，用「现有立绘 + 程序化姿态 + 表情/气泡」表达，避免
为了凑数再切一批没人看的 PNG：

| 叠加态 | 对应 mode | 做法 | 小素材 |
|---|---|---|---|
| `salute` 行礼 | `saluting` | 沿用 `anim-fsm` 的下沉 2px + 抬手排版 | `emote-00` 感叹 |
| `talk` 交谈 | 玩家「问一句」时 | 朝向翻向玩家 + 世界已有的 DOM 气泡 | `emote-01` 问号 / `emote-05` 对话 |
| `shelter` 避雨 | `sheltering`（行进中） | 复用 `walk` 帧 + 程序化雨具叠加 | `emote-02` 汗滴 |

**迁移规则**：动作切换只由「世界快照的 mode / walking / 玩家指令」三个输入
决定，沿用 `anim-fsm` 已有的 `animIntentOf` 与 `transitionDurationMs`，
不另造一套状态机；`anim-fsm` 从「未接管渲染」升级为渲染层的唯一姿态来源，
`render/villager-frames.ts` 的旧路径退为等价性对照（现有
`test/anim-fsm.test.ts` 已逐字段对齐，接入时保持绿）。

## 5. 决策 D2：帧来源与风格统一（已按 C 落地）

设计阶段写的是「从 11-11 动作表 4×6 切格、96×96 画布」。**实现时按用户选的
C 方案改成**：每人一次模型调用生成自己的 4×6 动作表，逐格抠底后等比装进
96×120，拼成 384×720 的整表（`server/scripts/art_action_sheets_1111.py`）；
引擎在这张整表上注册 21 个帧、按帧名切格，清单只 +7 件而不是 147 个小文件。
原动作表退为**结构与锚点参考**，不再直接切帧上屏，风格冲突由此消失。

但**这些帧不能直接上屏**（风格冲突，见第 3 节）。三个方案：

| 方案 | 做法 | 代价 | 风险 |
|---|---|---|---|
| A | 动作帧只给 1 个角色，其余 6 人保持立绘 | 0 次模型调用 | 新一轮风格断裂，正是被批评过的问题，**否掉** |
| **B（推荐）** | 动作表只作**节奏 / 姿态 / 帧数的基准数据**，不直接渲染；以「动作表 + 七张立绘」双锚点生成**一张通用正面 chibi 动作表**（7 动作 × 2~4 帧），7 人共用，个体差异靠 `VillagerLook` 的色槽 / 配件程序化叠加 | 1~2 次模型调用 | 牺牲一部分个体外观差异 |
| C | 7 人各一张动作表 | 7 次模型调用 | 成本最高，但个体与风格都保留 |

**用户选了 C**，理由是「有差异好」。7 次调用全部一次通过（v5 重试 1 次），
每张 21 帧齐全、7 人外观各异、同一行内角色一致。

**实现顺序守住了纪律**：先写 `world-client/src/render/action-frames.ts`
与 4 条测试、再把 `villager.ts` 的接入点接好（没有动作表时逐字节退回立绘），
**然后**才生成 7 张表；没有先切一堆 PNG 再找地方挂。

## 6. 决策 D3：玩家交互闭环（3 个动作，落在记忆面板）

**落点**：`#villager-panel`（右键 / 长按打开的记忆面板）新增独立容器
`#villager-panel-actions`。**明确不放 `#unit-status`**，理由见第 8 节：
`check-interact` 的 L2-1 断言 `nodeCount - 3 * lines` 恒定，往状态菜单里加
任何节点都会红。也**不塞进 `villager-panel-body`**（既有
`test/villager-panel.test.ts` 的空态 `body.children.length === 1` 断言）。

| 面板动作 | 排进世界的 `WorldCommand` | 世界侧结算 | 看得见的反馈 |
|---|---|---|---|
| 派活（4 类） | `{kind:'dispatch', taskKind, summary}`（**已有**） | 现有 `dispatch` 分支；不合时宜则按世界规则排队 / 拒绝 | 村民切 `salute` → `walk` → `work`；按钮图标 + 回执 + 记忆落账 |
| 给东西 | `{kind:'carry', villager, carries\|remove}`（**已有**，与规则层 `villager.carry` 同形） | 现有 `carry` 分支；按名字点人，人不在要说清 | 村民切 `carry` / `pour`；物品图标 + 回执 |
| 问一句 | `{kind:'ask', villager, text}`（**新增 1 条**） | 新增分支：不调模型，用世界已有的 `memoryVoice` / `villager-words` 生成一句可核查的话，写回记忆与回执 | 村民切 `talk` 叠加态 + 气泡 + 问号表情；那句话进编年史 |

**为什么只新增 1 条、且不扩规则层白名单**：
`dispatch` / `carry` 都是现成 `WorldCommand`，面板按钮走 `sim.enqueue`，
这条路径**不经过 LLM**，所以规则层 `COMMAND_CHECKS`、`oracle/prompt.py`
的 `COMMAND_LINES`、`test_orchestrator.py` 的提示词一致性断言都不必动——
这也避免了把两份白名单混为一谈。新增的 `ask` 只改 `world/simulation.ts` 的
`WorldCommand` 联合类型与 `applyCommand` 分支，加一条输入校验。

若后续要让玩家用**自然语言神谕**也说「问汐一句」，那是第二阶段，需要同步
改：`server/rules/schema.py` 的 `COMMAND_CHECKS` 与校验函数、
`oracle/prompt.py` 的 `COMMAND_LINES`、`world-client/src/world/intent-schema.ts`
的 `IntentRecord` 闭集、`intent-router.ts` 的分支、`docs/SPEC.md` 的命令表、
以及提示词一致性测试。**这一轮不做**。

**闭环顺序**（每一步都可回放）：玩家点动作 → `sim.enqueue` 排队 →
下一逻辑拍结算（可能被拒，回执说清原因）→ 村民 mode 变化驱动动作帧 →
小素材与面板回执给出反馈 → 事件进日志、记忆落账 → 编年史 / 日历可读。
玩家离开后世界照常按作息跑，指令不常驻、不接管作息。

## 7. 决策 D4：小素材语义绑定表（把 14 件死素材接上）

上一轮审计确定的零消费方素材，逐件给**唯一可达**的消费点，不再按序号轮转：

| 素材 | 语义 | 消费点 |
|---|---|---|
| `icon/role-05` 手推车 | 搬运 / 派活 | 「给东西」「派活」按钮图标；`carry` 动作的 HUD 提示 |
| `icon/role-06` 蓝水晶 | 灯油 / 资源 | 给灯油动作；`unit-status` 的灯油读数旁 |
| `icon/role-07` 卷轴 | 查资料 `research` | 「问一句」按钮 + 派活菜单的 `research` 项 |
| `icon/role-08` 宝箱 | 交付 / 入库 | 交付按钮 + `cheer` 动作反馈 |
| `icon/role-09` 文件堆 | 写代码 / 整理便笺 `code`・`writing` | 派活菜单对应两项 |
| `emote/emote-09` | 参考图里那格是两个色块，不是表情 | **从清单与目录删除** |
| `emote-00..08,10,11`（11 张） | 事件 / 回执 / 记忆类型 | 语义表：`alert`=接到指令、`question`=听来的、`think`=往日、`storm`=不平静、`reward`=交付达成、`water`=取水…；**每个 kind 有且只有一个入口** |
| `plate/map-00..03`（4） | 四个区域 | 镇志页眉固定展示（按当前镜头所在区域切换），不再靠日历周数轮转 |
| `plate/village-00..03`（4） | 村庄 / 篝火 / 酒馆 / 农田 | 日历周视图页眉固定展示（每周一张，按周序号取模 4） |
| `plate/ui-00..01`（2） | 桌面 UI 设计稿的局部 | 楼面板页眉的「界面参考」标注位，固定可见 |
| `plate/scholarly-00` / `plate/tileset-00` / `plate/cast-00`（3） | 学者区 / tileset / 角色动作 | 画廊页 `docs/art/reference-20261111/gallery.html` 用真的 `<img>` 展示 |

**验收口径**：绑定后重跑上一轮的用途审计脚本，要求「确定零消费方 = 0」，
且真实开局（不注入示例日卡）可见的装饰图 ≥ 交互按钮数 + 固定页眉数。
不再用注入数据的截图充当「接线已上屏」的证据。

## 8. 闸门影响清单（实现前逐条对照）

| 改动 | 会碰哪道闸 | 规避方式 |
|---|---|---|
| 新增本 ADR 到 `docs/adr/` | `audit-claims` 的 adr-schema（只校验头部格式） | 按 `status` / `verified_at` / `evidence` 格式写，不写 claim 标记 |
| **不放** `docs/iterations/` | `iterations-tracked-count=12` 按 `git ls-files docs/iterations` 计数，新增文件即红 | 本文件放 `docs/adr/` |
| 新增动作帧 PNG | `check-art-assets`（清单每件必须被请求且 200）、首屏装载量 | 只在渲染接入点落地后生成；每件有唯一消费点 |
| 动作帧逐帧推进 | `check-ground-shadow` 的 `shotStable` 连续 8 帧逐字节相同 | 帧索引由世界时间推导；`debugHoldWorld(true)` 后不推进；不读墙钟 / 不用随机数 |
| 画面像素变化 | `check-phases` 四刻亮度递减、`check-lamp-band` ROI 差 | 复跑；动作帧只用现有 24 色槽附近的色调，不引入高亮块 |
| 面板新增按钮 | `check-interact` L2-1 的 `nodeCount - 3*lines` | 动作容器放 `#villager-panel`，**不碰 `#unit-status`** |
| 面板 DOM 顺序 | `test/villager-panel.test.ts` 的 `body.children` 断言 | 独立容器，不进 `body` |
| 新增 `WorldCommand` 分支 | `npm test` / `red:first` | 先写测试，在 base 上红在断言 |
| 规则层白名单 | `test_prompt_whitelist_agreement.py` / `test_orchestrator.py` | **本轮不扩**，零影响 |
| 新增 CSS | `audit-palette --strict` 的 UI 9 色预算 | 只用现有变量，不写颜色字面量 |
| 改 `src/` 行数 | `audit-references --strict` 的行号引用 | 改完逐条核锚点；`audit-references` 只查行是否存在，查不出语义漂移 |
| 新增脚本 / 文档文件 | `audit-ports` 扫描面（基线 187，过期线 225） | 余量 36，文件数受控；若越线按政策刷新基线并记 note |

## 9. 当初待拍板的点，以及最终选择

1. **D2 风格方案**：用户选了 **C**（7 张分人动作表、7 次模型调用），理由是
   「有差异好」。已按 C 落地，7 人外观各异、同一行内角色一致。
2. **个体差异**：C 方案完整保留，不需要色槽叠加的妥协。
3. **神谕自然语言入口**：**未做**，3 个动作只走面板 `WorldCommand`，
   规则层白名单、提示词与 SPEC 都没动。仍列为第二阶段。

### 实现结果相对设计的两处收紧

- 动作集从「7 主动作 + 3 叠加态」落成 **7 个主动作、21 帧**，叠加态没有
  另造帧（沿用 `animIntentOf` 的姿态与气泡），避免多切没人看的 PNG。
- 交互只新增 2 条 `WorldCommand`（`assign` / `ask`），`carry` 复用现有
  `setCarries`；规则层 `COMMAND_CHECKS` 一条没加，提示词一致性闸零影响。

## 10. 边界（实现后仍然成立）

- 没改 `docs/SPEC.md` 的三条铁律与「世界自己跑」用户故事；村民作息没改成
  等玩家指令。
- 没动存档契约，`schemaVersion` 仍是 8（K4 逐实验核对）。
- 没加楼面板动作，交互只在村民面板 3 个。
- 没新增 `docs/iterations/` 文件、没写 claim 标记、没写 `file:line` 引用。
- 规则层 `COMMAND_CHECKS`、提示词 `COMMAND_LINES` 一条没加。
- 确定性没破：动作帧由快照与世界时间推导，冻结后不推进（K3 逐实验核对）。

## 11. 验证结果

十一道闸门全套 + 浏览器 job 全绿：check 0/0、test 2721 / 2712 pass、
pytest、五道文档审计、`audit-palette`、`audit-ports`（191 文件）、
`audit-baseline` 166/166、`check-art-assets` 72 件全装 / `?art=0` 零请求、
`smoke` 132 项、`test:phases` 40 项、`test:persistence` 8 项、
`test:render-budget` 硬闸 3 项、`test:building-bake` 72 张。

三条本设计专属的判据也已落地：

1. **动作语义测试** `test/action-frames.test.ts` 4 条：7 动作 / 21 帧都在
   4×6 网格内、帧名与帧矩形循环、快照到动作的映射、同输入帧号不变。
2. **EDD 评测集** `world-client/eval/interaction/`：主集 10/10、备用集 6/6，
   逐条读数与实验序列见 `docs/evidence/interaction-eval/BASELINE.md`。
3. **素材收口**：`emote-09` 已从清单与目录删除；13 张贴片与 5 张道具图标
   在 `docs/art/reference-20261111/gallery.html` 用真的 `<img>` 固定可见，
   三枚图标直接绑到三个面板按钮。

`check-interact` 32/33（只剩既有 L3-6，未改的 L3-4 保持绿）、
`check-ground-shadow` 红 4 条既有 G2/G3 判据；两者都在未改一行的
`origin/main` 对照树上复现过，与本轮无关。
