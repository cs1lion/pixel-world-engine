# 世界记忆协议 v0.1

**像素世界运行时 · 叙事记忆层规格**　状态：草案

> 本协议规定世界侧「叙事记忆」（人物、建筑与地标、集体）的数据结构、写入、整理、遗忘、检索与删除规则。agent 侧的真实记忆由上游持有，两边以事件 ID 互相引用。信息如何在单位之间传播（Claim / Belief / 通道），见《信息传播设计》工作表。标注「建议初值」的数字只是起点，需要调参。

## 0. 原则与术语

**原则**

1. 事件日志是唯一真相；记忆是某个观察者对事件的主观视图，不是事件副本。
2. 每条记忆都有出处：至少引用一个真实事件。
3. 视角受限：只记得在场看到、听到、读到的。
4. 会衰减也会强化，并且真的影响行为和表现。
5. 失真受控：只允许丢细节、放大情绪，不允许凭空编造。
6. 可回放：所有随机与模型产物都要记录。
7. 可删除：删除一个源头，所有派生物级联清除。

**术语**

| 术语 | 含义 |
| --- | --- |
| Event | 世界中实际发生的事，只追加，不可改 |
| Holder | 记忆主体：人物、地点（建筑与地标）、集体 |
| MemoryEntry | 某个 Holder 对事件的一条记忆 |
| Episode | 当日片段，日终整理前的原始记忆 |
| DaySummary | 日摘要，日终整理的产物 |
| Salience | 显著度，决定记不记、记多久 |
| Cue | 线索，触发回忆的情境（地点、人物、天气、物件） |
| Trace | 痕迹，建筑与地标上的物质化记忆（装饰层、地名等） |
| Legend | 传说，集体记忆中被反复讲述的事件 |

## 1. 世界时钟与「天」

- `world_day`：从 0 递增的整数，是记忆的基本时间单位；`tick` 是天内的序号。
- 一天对应的现实时长由配置项 `day_length_seconds` 决定，协议本身不假设具体值。
- 天界由运行时发出 `DayClosed(day)` 事件，日终整理由它触发。
- 所有事件与记忆都带 `day`。

## 2. 事件契约

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| event\_id | string | 全局唯一，上游与世界侧共用的键 |
| day, tick | int | 发生时间 |
| kind | string | 事件类型，如 task\_done、conflict、celebration |
| place\_id | string | 发生地点，必填 |
| actors | string\[\] | 参与者 |
| witnesses | string\[\] | 在场并能感知的单位，由运行时在发出事件时按感知模型计算，写入后不可改 |
| parent\_event\_id | string? | 因果父事件 |
| outcome | object | 结果，结构随 kind 定义 |
| visibility | enum | private\_to\_player / world / sanitized，见第 15 节 |
| importance\_hint | float? | 0–1，来源方的重要度提示，可空 |
| source | enum | agent / world / player |

**硬性要求**：世界运行时必须有「地点」和「在场（感知范围）」两个基础概念，否则无法判定谁能记。

## 3. 记忆主体（Holder）

| 类型 | 记什么 | 遗忘策略 | 表现 |
| --- | --- | --- | --- |
| character | 亲历与听说的事、对他人的印象、习惯 | 衰减，被回忆则强化，闪光灯记忆永久 | 气泡、闪回、避开或偏爱某处、日记 |
| place | 在此发生过的事，按空间沉积 | 不遗忘，只被覆盖或风化 | 修补、焦痕、涂鸦、留言牌、地名演变 |
| collective | 反复被讲述的大事 | 靠传播维持，无人讲则淡去 | 公告栏、碑文、节日 |

玩家（上帝）的记忆在上游，不属于本协议。

每个 Holder 带：`holder_id`、`type`、`profile`（性格权重，影响显著度计算）、`budget`（各层条目上限）、`forgetting_policy`、`expression_policy`。

## 4. 记忆条目（MemoryEntry）

| 字段 | 说明 |
| --- | --- |
| memory\_id / holder\_id | 主键与主体 |
| kind | episodic（情景）/ summary（摘要）/ impression（对人或事的印象）/ habit（习惯）/ trace（沉积） |
| tier | day / long / legend，见第 5 节 |
| event\_refs | 出处，至少 1 个；摘要需逐句标注各自的 event\_refs |
| source\_mode | witnessed / heard / read / inferred |
| source\_chain | heard 时的来源链（claim\_id 与前手 holder\_id） |
| content | 结构化：what、who\[\]、where、when(day)、detail\_level(0–3)、valence(−1\~1)、arousal(0\~1) |
| salience | 0–1，附分量：emotion、surprise、goal\_relevance、involvement |
| confidence | 0–1 |
| strength | 当前强度，随时间衰减 |
| created\_day / last\_recalled\_day / recall\_count | 时间与回忆次数 |
| flags | flashbulb、pinned、redacted |
| derived\_from | 派生来源，删除级联用 |
| generated\_by | by（rule 或 llm）、ruleset\_version、input\_hash、seed、model\_id，回放用 |

示例（YAML 示意）：

```
memory_id: m_0192
holder_id: char_baker
kind: episodic
tier: day
event_refs: [ev_3071]
source_mode: witnessed
content: {what: 工坊三号房的灯在夜里熄灭, who: [char_courier], where: place_workshop_3, when: 12, detail_level: 3, valence: -0.4, arousal: 0.6}
salience: 0.72
confidence: 0.9
strength: 1.0
generated_by: {by: rule, ruleset_version: r1, seed: 88231}
```

## 5. 层级与晋升

事件 → 当日片段（day）→ 日摘要（day → long）→ 周或里程碑摘要（long）→ 传说（legend，集体层）。

- **晋升**：显著度达到 `T_promote` 的片段进入日摘要；连续多日的摘要按 `week_length`（建议初值 7 天）合并为周摘要；极高显著度（`T_flash`）标记为 flashbulb。
- **预算**：每个 Holder 对每层有条目上限，超限时淘汰强度最低且未被固定的条目。

## 6. 写入路径

1. 事件发出，`witnesses` 已由运行时写好。
2. 对每个 witness（及 place Holder）按其 profile 计算 salience：`salience = w_e·emotion + w_s·surprise + w_g·goal_relevance + w_i·involvement`。权重由 Holder 的 profile 决定，建议初值均为 0.25。全部由规则计算，写入路径不调模型。
3. salience ≥ `T_write`（建议初值 0.3）则写入 Episode，否则丢弃。
4. place Holder：由后果规则（第 11 节）生成痕迹，不走 salience。
5. 发出 `MemoryWritten`。

听说类记忆走传播协议：单位收到 `ClaimTold` 并更新信念后，生成 source\_mode = heard 的条目。

## 7. 日终整理（Consolidation）

触发：`DayClosed`。对每个 Holder 依次执行：

1. 收集当日 Episode。
2. 选择：按 salience 取前 N（N 由 budget 决定），其余降一级细节或丢弃。
3. 生成日摘要：默认用规则模板；重要角色可开启模型生成，每个 Holder 每天最多 1 次调用。
4. 校验：摘要里的人物、地点、日期必须出现在其 event\_refs 对应的事件中，校验不过则回退到模板版本。
5. 关联：按同地点、同参与者、同 kind 建立 links。
6. 衰减与晋升：见第 5、8 节。
7. 可选的表现产物：日记（书面）、梦（仅表现）。
8. 发出 `MemoryConsolidated(holder_id, day, stats)`。

模型产物连同 input\_hash、seed 一并记录，回放时直接使用，不重新生成。

## 8. 遗忘、强化与重构性回忆

- **衰减**：`strength ← strength × (1 − decay_rate × tier_factor)`，每日整理时执行。flashbulb 与 pinned 不衰减。
- **归档**：strength 低于 `T_forget` 时归档，不再参与默认检索，但仍可被强线索触发；place 的痕迹不适用。
- **强化**：每次被回忆，`strength ← strength + boost × (1 − strength)`，并更新 last\_recalled\_day、recall\_count。
- **重构性回忆**：回忆（commit = true）时以 `p_blur` 的概率按规则变形：detail\_level 降一级，或放大 |valence|。**不得新增事实**；每次变形记录在 `MemoryRecalled` 的 mutation 字段里。

## 9. 检索协议

**请求**：`recall(holder_id, cues, budget_k, commit)`。cues 可含：place\_id、actor\_ids、day\_range、kind、tags，以及可选的 text（用于向量检索）。

**流程**

1. 结构化过滤：按地点、天、人物对、kind 取候选，走索引，不调模型。
2. 打分：`score = w_r·recency + w_i·salience + w_v·relevance + w_c·cue_match (+ w_rel·relationship)`，即近因 × 重要度 × 相关度，再加线索匹配与关系权重。权重初值待调。
3. 预算裁剪：取前 `budget_k` 条。
4. 返回条目与出处；commit = true 时执行强化与重构。

**线索自动触发**：运行时在单位走进某地、遇到某人、天气变化、拾起或看到某物时发出 `CueFired`，并据此调用 recall。

**玩家询问**：`ask(holder_id, topic)` 返回相关条目及 event\_refs，界面可展开追溯到真实事件。

**索引**：place、day、actor 对、kind，另可选向量索引。

## 10. 使用点与表现提示

| 使用点 | 做法 |
| --- | --- |
| 行为决策 | 记忆产出 modifier：对某地、某人、某类事的趋避，影响日程与路线 |
| 对话 | 注入 top-k，受 token 预算限制；结合性格与关系渲染，不改记忆内容 |
| 表现 | 输出 ExpressionHint：{type: bubble / flashback / decal / rename / diary / heatmap, holder\_id, memory\_id, intensity} |
| 档案室 | 把记忆层映射成空间：手边、公告板、书架、封存 |

表现层只消费 ExpressionHint，不直接读记忆库。

## 11. 建筑与地标：沉积

place Holder 的记忆是 Trace（痕迹），由后果规则生成：`consequence(event.kind, intensity, place_type) → TraceSpec`。

| 事件类型（示例） | 痕迹（示例） |
| --- | --- |
| 事故、冲突 | 焦痕、修补 |
| 庆祝 | 花环、彩带 |
| 反复发生 | 磨损的路径、固定的座位 |
| 里程碑 | 留言牌、碑文、地名变更 |

Trace 字段：trace\_id、place\_id、event\_ref、layer\_type、intensity、created\_day、visibility\_decay。

**规则**

- 痕迹是叠加的装饰层，不重画建筑本体；每个地点的装饰层有上限，超限时合并或覆盖最旧的。
- 风化只降低可见度，不删除记录。
- 地名演变保存历史链：`ToponymChanged(place_id, old, new, event_ref)`。
- 所有变化带版本，可回滚。

## 12. 集体记忆：传说

- **形成条件**：同一事件的断言被至少 X 个 Holder 持有，且持续至少 Y 天（X、Y 待定）。
- **Legend 字段**：legend\_id、event\_refs、variants（不同讲法）、reach（传播度）、home\_place（碑文或公告栏所在）。
- **淡去**：无人复述则 reach 下降，到阈值后淡去。Legend 的内容同样只允许来自 event\_refs。
- 形成时发出 `LegendFormed`。

## 13. 记忆相关事件类型

| 事件 | 触发 | 关键字段 |
| --- | --- | --- |
| DayClosed | 天界 | day |
| MemoryWritten | 写入 Episode | memory\_id、holder\_id、event\_refs、salience |
| MemoryConsolidated | 日终整理完成 | holder\_id、day、stats |
| MemoryRecalled | 被回忆 | memory\_id、cues、mutation |
| MemoryArchived | 因遗忘归档 | memory\_id |
| MemoryDeleted | 删除级联 | root\_id、counts |
| CueFired | 线索触发 | holder\_id、cue |
| TraceAdded | 新增痕迹 | trace\_id、place\_id、layer\_type |
| ToponymChanged | 地名变更 | place\_id、old、new |
| LegendFormed | 传说形成 | legend\_id、event\_refs |
| DiaryWritten | 日记产生 | holder\_id、day |

传播相关的 ClaimCreated、ClaimTold、BeliefUpdated、AnnouncementPosted、AnnouncementRead、RumorDebunked，见传播设计。

## 14. 边界

- 世界侧持有叙事记忆存储；agent 的真实记忆在上游，世界侧只通过事件 ID 引用，不持有主存储。
- 上游事件（任务完成、受阻等）以 source = agent 进入世界，成为 Event，之后按本协议被感知、记忆。
- 单位不得读取全局世界状态做决策，只能通过自己的记忆与信念行动。
- 记忆档案室展示上游记忆层时为只读镜像。

## 15. 隐私、删除与级联

**可见性**

- private\_to\_player：不写入任何单位记忆的明文，最多写入抽象化的 sanitized 版本。
- world：可正常写入。
- sanitized：仅写入脱敏后的内容。
- 记忆继承事件的 visibility；气泡、碑文等表现输出前再过一次脱敏。

**删除**：`delete(root)`，root 可以是 event\_id、memory\_id 或 claim\_id。

1. 沿 derived\_from 与 event\_refs 找出所有派生物：记忆、摘要、信念副本、痕迹、传说。
2. 摘要里仅含该事件的语句直接删除；其余语句保留，并在下次整理前标记 redacted。
3. 痕迹移除或中性化；传说移除该 event\_ref，空了则整条删除。
4. 发出 `MemoryDeleted(root_id, counts)`。

删除后不得再被检索命中，也不得再次被整理写回。

## 16. 确定性、回放与成本

- 随机数种子：`seed = hash(world_id, day, holder_id, op_id)`。
- 规则带 `ruleset_version`；模型产物记录 `input_hash` 与输出，回放用已记录的输出。
- 操作幂等：以 (day, holder\_id, op) 为键，重复执行结果相同。
- 成本预算：写入 0 次模型调用；整理每个 Holder 每天 ≤ 1 次；检索不调模型；对话注入受 token 预算限制。
- 细节层级：屏幕外的 Holder 用批量规则整理；屏幕内的才展开成可见的行为与对话，两者结果必须一致。

## 17. 验收测试

| 测试 | 断言 |
| --- | --- |
| 溯源 | 每条 MemoryEntry 的 event\_refs 非空且都存在，溯源率 100% |
| 视角 | 不在 witnesses 里的单位不会产生 witnessed 记忆 |
| 不编造 | 重构性回忆后，条目的事实集合是原条目的子集 |
| 摘要校验 | 摘要中出现未被 event\_refs 覆盖的实体时，校验必须拒绝 |
| 该记该忘 | 高显著度事件在 N 天后仍可检索；低显著度事件在 M 天后归档 |
| 回放一致 | 同一事件流两次回放得到完全相同的记忆库 |
| 删除级联 | 删除一个事件后，所有派生物不可检索，且整理不会写回 |
| 隐私 | private\_to\_player 事件不会出现在任何气泡或碑文的明文中 |
| 预算 | 每个 Holder 每天模型调用 ≤ 1 次 |

## 18. 落地顺序与待定问题

**落地顺序**

1. 事件契约 + 地点与在场模型 + 按天分片的日志。
2. MemoryEntry + 写入路径 + 规则版日终整理。
3. recall 与 CueFired + 记忆气泡。
4. place 沉积（后果规则 + 装饰层）与地名演变。
5. 传说、日记与梦；模型生成的日摘要。
6. 与传播协议对接（heard 记忆、传闻）。

**待定问题**

- day\_length\_seconds 取多少，是否随游玩状态变速。
- 感知半径与遮挡如何定义（影响 witnesses）。
- 日摘要是否默认启用模型生成，还是只对重要角色启用。
- private\_to\_player 事件对世界的外显粒度。
- 是否允许角色撒谎；若允许，是否把 distorted\_by 纳入本协议。
- 各权重与阈值的初值，需要在 demo 中调参。
