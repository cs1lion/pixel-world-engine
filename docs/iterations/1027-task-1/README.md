# 1027 迭代任务 1 · 内环：世界记忆 × 感知与信息传播

> 暂存于 2026-10-27。本目录最初只做「收资料」，截至 2026-11-02 **协议已实现**：22 个 `src/world/memory/` 模块、36 个相关测试文件（核对快照 `251a7ca`）。实现状态见下表；仍未排期的是后续调参与新功能。
>
> **2026-11-02 修正**：本行原来声称本目录没有实现、也不含排期——那句话在代码落地后已经变成假话，现按实情改写。

## 实现状态（18 节 → 模块 / 测试）

| 节 | 代码落点 | 代表测试 | 状态 |
| --- | --- | --- | --- |
| §0 原则与术语 | `world-client/src/world/memory/types.ts` | `memory-protocol.test.ts` | 已实现 |
| §1 世界时钟与天 | `world-client/src/world/memory/config.ts` | `memory-day.test.ts` | 已实现 |
| §2 事件契约 | `world-client/src/world/memory/types.ts`、`perception.ts` | `memory-perception-wiring.test.ts` | 已实现 |
| §3 Holder | `world-client/src/world/memory/world.ts`、`types.ts` | `memory-runtime.test.ts` | 已实现 |
| §4 MemoryEntry | `world-client/src/world/memory/types.ts`、`world.ts` | `memory-claim-birth.test.ts` | 已实现 |
| §5 层级与晋升 | `world-client/src/world/memory/consolidate.ts`、`config.ts` | `memory-day.test.ts` | 已实现 |
| §6 写入路径 | `world-client/src/world/memory/salience.ts` | `memory-flashbulb.test.ts` | 已实现 |
| §7 日终整理 | `world-client/src/world/memory/consolidate.ts`、`world.ts` | `memory-diary.test.ts` | 已实现 |
| §8 遗忘/强化/重构 | `world-client/src/world/memory/salience.ts`、`recall.ts` | `memory-trace-weathering.test.ts` | 已实现 |
| §9 检索协议 | `world-client/src/world/memory/recall.ts` | `memory-reach-ceiling.test.ts` | 已实现 |
| §10 使用点与表现 | `world-client/src/world/memory/hints.ts`、`voice.ts`、`stele.ts` | `stele.test.ts`、`villager-voice.test.ts` | 已实现 |
| §11 建筑与地标沉积 | `world-client/src/world/memory/traces.ts`、`toponym.ts`、`types.ts`、`world.ts` | `memory-trace-wiring.test.ts`、`toponym.test.ts` | 已实现（含补充设计 §1.2） |
| §12 集体记忆传说 | `world-client/src/world/memory/legend.ts` | `memory-legend-life.test.ts`、`legend-merge.test.ts` | 已实现 |
| §13 事件类型 | `world-client/src/world/memory/types.ts` | `memory-protocol.test.ts` | 已实现 |
| §14 边界 | `world-client/src/world/memory/sanitize.ts`、`types.ts` | `memory-no-model-calls.test.ts` | 部分（“是否允许撒谎”仍是开放问题） |
| §15 隐私/删除/级联 | `world-client/src/world/memory/privacy.ts` | `memory-delete-cascade.test.ts` | 已实现 |
| §16 确定性/回放/成本 | `world-client/src/world/memory/seed.ts`、`world.ts` | `replay-property.test.ts` | 已实现 |
| §17 验收测试 | `world-client/test/memory-protocol.test.ts` | `memory-protocol.test.ts` | 已实现 |
| §18 落地顺序与待定问题 | 无代码；开放问题见 `types.ts` | — | 不适用（计划节） |

## 这组资料讲什么

「内环」：世界在零/极低模型调用的前提下确定性运转。事件日志是唯一真相，记忆是某个观察者对事件的主观视图，信息靠五类通道在单位之间传播。与外环（造物主与自治爬梯，1027 迭代任务 2）互为另一环，两环只以契约相接。

两份资料是同一轮设计讨论的产出，且互相引用：记忆协议第 13 节把传播相关的事件（ClaimCreated / ClaimTold / BeliefUpdated / AnnouncementPosted / AnnouncementRead / RumorDebunked）直接指向传播设计；传播设计的「新增事件类型」sheet 也说要进协议与回放。

## 文件

| 文件 | 文档 | 内容 |
| --- | --- | --- |
| `world-memory-protocol-v0.1.md` | 《世界记忆协议 v0.1》 | 18 节完整规格：事件契约、Holder、MemoryEntry、写入路径（0 次模型调用）、日终整理、遗忘/强化/重构性回忆、检索协议、place 的 Trace 沉积、集体 Legend、隐私与删除级联、确定性与回放、9 项验收测试。数字多为建议初值，待调。 |
| `info-propagation-design.xlsx` | 《单位间感知与信息传播设计》 | 9 个 sheet：概览 / 通道 / 关系与传播 / 传言生命周期 / 世界公告 / 架构影响 / 新增事件类型 / 护栏与评测 / 落地顺序。核心约束：单位逻辑只能读自己的信念库，不能读全局世界状态，且这一条要在 API 层强制。 |

### 共用的补充设计（横跨两环，全文只在 task-2 存一份）

同一份文档在仓库里存两处会互相漂移，所以两组索引都指向同一份全文：

| 文档 | 归属 | 说明 |
| --- | --- | --- |
| [architecture-supplement-v0.2.md](../1027-task-2/architecture-supplement-v0.2.md) | 第 1 节属内环 | 补充架构设计 v0.2，数式排版版 |
| [architecture-supplement-v0.2-alt.md](../1027-task-2/architecture-supplement-v0.2-alt.md) | 第一部分属内环 | 同上，散文要点版；两份以其一致处为准 |
| [architecture-supplement-v1.0-params.md](../1027-task-2/architecture-supplement-v1.0-params.md) | **第 1 节 + 第 3.1 & 3.2 节** | 补充架构设计与**全量待定参数规格书 v1.0**。本组最要紧的一份：把记忆协议与传播设计里所有「待定」补成了具体数字 |

**v1.0 对内环的意义**：前面几份文档说「这个阈值需要调参」，v1.0 直接给出初值（`T_write=0.30`、`perception_radius=8 格`、`max_fanout=3 人/天`、`max_hops=3 跳`、`coverage ≤35%/天` 等），可以当作第一版 Config 落地。它的第 0 节还划了调用边界：本组**只做**记忆与传播，除日终摘要（每 Holder 每天 ≤ 1 次）与屏幕内关键对话外，写入/检索/传播保持 0 次模型调用，并且**绝不实现任何造物主或导演的生成逻辑**。

## 迭代时要回答的问题

1. **先立 API 层强制**：传播设计的核心约束是「单位逻辑只能读自己的信念库，不能读全局世界状态」，且要在 API 层强制——这是内环一切的地基，优先于任何算法。
2. **五类通道，一个抽象**：直接感知 / 交谈 / 广播 / 书面 / 痕迹，都由同一组参数定义（接收范围、延迟、保真度、容量、权限）。原表的「待定」已由 v1.0 第 3.2 节补成定稿值：交谈单次 ≤ 2 条 Claim、需 `trust ≥ -0.2`（带 secret 则 `≥ 0.7`）、公告栏同时最多 5 张、痕迹最多暴露 3 层。
3. **变形的边界**：传言变形只能按规则发生——丢细节、放大情绪、来源换手，并全部记录；模型只负责把结构化断言说成话，不能改断言本身。这是「不允许凭空编造」原则在传播侧的落地。
4. **LOD 与可回放**：屏幕外用图扩散批量近似，屏幕内才展开成具体对话，两边结果必须一致；传播的随机性用种子（天、单位对、断言）派生。落地顺序里两处都把这放在早期。
5. **防信息同质化**：护栏与评测 sheet 明确警告「全员一天内全知」，宁可慢一点、不均匀一点；断言测试的第一条是「孤立的单位永远不会知道某件事」。
6. **两份落地顺序要合并**：记忆协议第 18 节六步与传播设计六阶段的第一步相同（Claim/Belief 数据模型 + 感知 API），但后续排序不同，迭代时要合成一条路线。
7. **待定问题清单**：感知半径与遮挡、日摘要是否默认启用模型、`private_to_player` 的外显粒度、是否允许撒谎（`distorted_by`）、全部权重与阈值初值——记忆协议第 18 节列全了。**其中绝大多数已由 v1.0 第 3.1 节给出初值**；`day_length_seconds` 由第 8 条定死；唯「是否允许撒谎」仍是开放问题（v1.0 未表态）。
8. **✅ 一天有多长：已定，采用 24 世界小时。** v1.0 把 `day_length_seconds` 写成常态 900 秒、挂机 3600 秒（按现实时长计），与仓库差一个量级。2026-10-27 定：**以仓库为准，一天 = 24 个世界小时**，`server/memory/snapshot.py` 的 `DAY_MS` 不变，v1.0 该字段按 `86400` 秒读。

   于是 900 / 3600 的含义变了：它们不再是「一天有多长」，而是**「现实里看完一天要多久」的节奏目标**，由时间倍率承担——`timeScale = 86400 / 900 = 96`（挂机态 24）。现状是前端默认 `timeScale = 6`（一天 ≈ 现实 4 小时），`?speed=` 上限 60（一天 ≈ 现实 24 分钟）：要按 v1.0 的节奏跑就得把上限放到 96，否则只能把节奏目标放宽到 24 分钟。**所有衰减、归档、传说的天数阈值按 `DAY_MS` 算，与节奏目标无关**——这条定下来之后它们不会再因「一天多长」而变。
