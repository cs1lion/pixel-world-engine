# ADR：场景记忆复用 `world.memory`，只升记忆段自己的版本

- status: aligned
- verified_at: 2026-11-03
- verified_by: agent，按代码与测试核实，用户授权，2026-11-03
- evidence: `world-client/src/world/memory/landmark.ts`, `world-client/src/world/memory/era.ts`, `world-client/src/world/memory/epic.ts`, `world-client/src/world/memory/runtime.ts`, `world-client/test/scene-memory.test.ts`

## 背景

「岁月感 / 史诗感」需要四样今天没有的东西：地标的一生、时代分期、史诗分级，
以及**拆楼之后痕迹还读得到**。最后一条不是新功能，是一个缺陷：拆楼时地点
Holder 被摘掉，而痕迹的两条读路径（`lookAtTraces` 的准入与 `placeHints`）
原先都要经过 Holder，于是痕迹还在库里，却既没人够得着、画面上也一笔不剩。

同时有一条硬约束：**存档契约不动**。v5 的路径白名单与指纹冻结着
（`docs/adr/ADR_SAVE.md` §1.3、§3），新增字段不能静默塞进去。

## 决策

1. **复用 `world.memory` 那一段字符串**，由记忆层自己的 `memorySchemaVersion`
   升版解析；`CURRENT_SCHEMA_VERSION` 仍是 5，`SAVE_V5_ALLOWED_PATHS` 与
   `SCHEMA_V5_FINGERPRINT` 一个字节都不改。
2. **地点坐标与 Holder 分库存**（`world.placeAnchors`，记忆段 v2）：Holder
   名册管的是「谁还活着、谁能传话」，楼拆了就不该继续当听众；坐标是
   「那儿在哪」，痕迹的准入与废墟的渲染都读它。摘 Holder，不摘坐标。
3. **地标的身份是地块，不是实例 id**（`world.landmarks`，记忆段 v3）。
   `plotKey` 由原点 + 占地算出来；拆了重建立起新 `instanceId` 时，
   新旧两条记录靠它接上，`aliases` 留着这块地用过的全部 id。
4. **阶段只引用事件，不复制事件**：每一段记 `state / day / atMs /
   causeEventRef / name / note`。状态闭集是 `built / altered / demolished /
   ruined / rebuilt`；「改」今天唯一的来源是改名（协议 §11），修缮等有
   修缮命令时接在同一个状态上。
5. **时代切段只看「今天 vs 段首」**，不比昨天：比昨天的话，缓慢的长期漂移
   永远切不开。阈值在 `config.ts`（30 天最短段长、效价 0.25、孤立 30%、
   楼 20%、废墟至少 +2 块）。时代标签是规则表，不是模型起名。
6. **史诗判档全部可计算**：重要性、不可逆性、覆盖比例、跨度。门槛 0.55
   让「拆楼」够得着（日常事件里唯一不可逆到 1 的），而同样是 0.55 的
   「口角」不可逆性 0，最高只到 `legend` 档。同一份世界跑两遍必须得到
   同一批条目，`test/scene-memory.test.ts` 钉着。
7. **成长记录这一轮只做 `TurningPoint`**：只在求证闭环里、信念落地成
   `confirmed / debunked` 的那一次写。`BondPhase` / `HabitRecord` 留结构位，
   等它们有生产者时再谈保留策略。转折点**不衰减**。

## 理由

- **为什么复用字符串而不是升 v6**：`world.memory` 本来就是「记忆层的自留地」，
  里面有什么由 `memorySchemaVersion` 说话（`docs/adr/ADR_SAVE.md` §1.3 的
  「校验分两层」）。场景记忆是同一层里的新字段，走同一套版本线，不必为了
  它动世界的路径白名单与指纹——那是给「世界自己的事实」用的。
- **为什么迁移必须无损**：v1 → v2 的坐标是从既有地点 Holder 上读出来的，
  不是新事实；v2 → v3 的四个数组是**空**的（「那段历史没记过」是事实，
  不拿今天的楼倒推一份假历史）。旧档里已有的字段一个都不动。
- **为什么废墟要有自己的痕迹层**：拆楼在 `observe.ts` 里是 `conflict`，
  与一次口角同一个 kind。只按 kind 判，拆楼留下的那道痕迹与口角留下的
  分不开；`placeType === 'building'` 是唯一能分开的输入，所以废墟
  （`ruin`）必须是一层独立的痕迹，而不是焦痕的近似。

## 后果

- 好：老档读到新版本时只补段、不丢条；`assertSave` / 指纹 / 白名单不受影响。
- 好：楼拆了，痕迹与废墟仍读得到、画得出；同一块地上重建，历史接得上。
- 代价：记忆段的体积会随「时代数 × 上下文」缓慢增长（一条时代 ~300B，
  十年约 40–120 条）；地标以「块」计，不随天数增长。
- 代价：`world.memory` 越往后越接近 localStorage 配额；**按日 checkpoint
  必须放到 IndexedDB**，不能进主档。这一条留给下一笔（只读回溯）。

## 备选

| 方案 | 为什么没选 |
| --- | --- |
| 升存档 v6，把场景记忆放进 `world.landmarks` 等新路径 | 要动路径白名单与指纹；而记忆层内部有动态键（`outcome` / `variants`），静态路径穷举不了——v5 当初就是因此只留一个字符串位置 |
| 拆楼后保留地点 Holder 不摘 | 名册会把一栋不存在的楼当成听众，`spreadCandidates` 让它「听得见」任何原地传言；而且它会一直在各面板里出现 |
| 废墟用 `scorch` 近似 | 口角与拆楼分不开；两者的存活期与读法完全不同 |
| 时代交给模型起名 | 同一份存档跑两遍会得到两个名字，「回放一致」直接没了 |
| 史诗按玩家手动「封圣」为主 | 这一轮先把规则判档跑通；玩家开关是后置功能（`promotedBy` 已留字段） |

## 不做的事（这一版明确留白）

- 检查点的分叉（从某天复制继续玩）——只做只读回溯。
- 冷存的 90 天 / 1 年 / 更久分层——先修关账的增量扩散，再做压缩，冷存最后。
- 性格参数从「行为统计推断」——改为从设定集显式 `traits`（这一轮不接）。
