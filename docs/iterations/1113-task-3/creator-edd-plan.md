# 像素世界造物主（Creator）EDD 评测驱动开发方案与开发明细

本文档面向 [cs1lion/pixel-world-engine](https://github.com/cs1lion/pixel-world-engine) 仓库，基于项目既有的确定性模拟内核、白名单契约与 EDD（评测驱动开发）门禁规范，将最初在 [AI原生像素个人助理世界架构设计](https://docs.google.com/document/d/1go-nGPNpHynC6Dxd72Iu8kjtniGOTaI_OSz1mEG_Op8/edit?usp=drivesdk&ouid=100318929740940700268) 中规划的 **“造物主动态选址、门口自动修路、脚手架施工蜕变、人工审校逆向规则合成与自治熔断爬坡”** 转化为可逐项验收的工程施工清单。

---

## 一、 现状盘点与本次闭合边界

在当前最新断点（`54e625c` / `docs/RESUME.md`）下，`world-client/src/world/creator/` 与 `world-client/src/world/blueprints.ts` 已经完成了底层数据结构定义，但距离“造物主在运行时真正活起来”还差 **评测集门禁** 与 **运行时执行闭环** 两层接线：

| 子模块 | 仓库现有资产（已实现） | 本次 EDD 补齐项（待合入） | 对应验收编号 |
| :--- | :--- | :--- | :--- |
| **1. 蓝图与空间选址** | `blueprints.ts` 已定义 `footprint`、`clearMargin`、`door`、`chimney`；`creator/schema.ts` 已定义 `PlaceBuildingCommand` 与 `runBusinessRulesCheck`。 | 新增 spatial-executor.ts：当外环未传精确坐标时，按确定性螺旋序自动寻找满足 `footprint + clearMargin` 且未淹没的零重叠空地。 | `M1` / `H1` / `H2` |
| **2. 道路自动连通** | `creator/config.ts` 已声明门禁指标 `pathfindingConnectivity: 1.0`，但尚无自动铺路实现。 | 在 spatial-executor.ts 实现 `planRoadToMainNetwork`：从新建筑 `door` 偏移点用确定性四方向 BFS 绕障铺设石板路连入主干道。 | `M2` / `H3` |
| **3. 脚手架施工生命周期** | `render/buildings.ts` 已拆分为 `back`（地面）、`container`（楼体）、`front`（前檐）三层并预留 `progress: Graphics`。 | 新增 `creator-scaffolding-buildings.ts`：建筑入场先置为 `scaffolding` 阶段（绘竹木脚手架+冒施工烟尘+藏前檐），按逻辑拍归零后蜕变为 `completed` 并记入编年史。 | `M3` / `M4` / `H5` |
| **4. 逆向审校与双向熔断** | `creator/synthesizer.ts` 已实现 `RuleSynthesizer`；`creator/fuse.ts` 已实现 `AutonomousFuseController`。 | 将人工挪动（`moved`）/驳回（`rejected`）与连续违规接入 `WorldState` 主循环，持久化 `creatorRules` 与 `fuseState` 到存档字节。 | `M5` / `M6` / `H6` |
| **5. EDD 评测门禁与防假绿** | `eval/interaction/` 已有主集 10 条 + 保留集 6 条及 eval-interaction.mjs。 | 新建 eval/creator/main.json（10 条）、held-out.json（6 条）、scripts/eval-creator.mjs 与 test/creator-eval.test.ts。 | `K1`~`K4` / `V1`~`V2` |

---

## 二、 完整文件级开发明细表（Development Breakdown）

按以下 7 个具体文件推进，严格遵循仓库 `red:first`（先挂红灯测试，再写实现变绿）流程：

| 序号 | 操作类型 | 目标文件路径 | 核心改动明细 | 依赖前置项 | 预计工时 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Step 1** | 新建文件 | world-client/eval/creator/main.json | 写入 6 条核心造物行为用例（`M1`~`M6`）与 4 条回归不变量用例（`K1`~`K4`），锁死零重叠、连通率 `1.0`、脚手架 3 拍完工与 16.6ms 步长预算。 | 无 | 0.5h |
| **Step 2** | 新建文件 | world-client/eval/creator/held-out.json | 写入 6 条防过拟合保留集用例（`H1`~`H4` 边界异常 + `V1`~`V2` 跨时刻/跨潮位档/跨设定集变体）。 | Step 1 | 0.5h |
| **Step 3** | 新建文件 | world-client/scripts/eval-creator.mjs | 封装 Playwright + Code Eval 评分器，实现 `CHECKS` 下的 10 个检查函数，强制调用 `exportSaveBytes()` 验证真实落盘存档。 | Step 1, 2 | 1.0h |
| **Step 4** | 新建文件 | world-client/test/creator-eval.test.ts | 使用 `node:test` 编写 4 组防假绿单测：校验数据集规格、ID 互不相交、`CHECKS` 函数存在性、以及 `V*` 变体开局时刻不重合。 | Step 1~3 | 0.5h |
| **Step 5** | 新建文件 | world-client/src/world/creator/spatial-executor.ts | 实现 `findDeterministicSlot`（曼哈顿螺旋确定性选址）与 `planRoadToMainNetwork`（门口四方向确定性 BFS 铺路），接入 `SpatialConstraintPatch` 过滤。 | Step 4（红灯确认） | 1.5h |
| **Step 6** | 新建/对接 | world-client/src/render/creator-scaffolding-buildings.ts & `buildings.ts` | 实现 `enqueueBuildingConstruction`、`tickBuildingConstruction` 与 `syncBuildingConstructionView`，在 `view.progress` 上绘制 24 色板竹木脚手架并与 work-smoke.ts 联动。 | Step 5 | 1.5h |
| **Step 7** | 扩展接线 | `world-client/src/ui/when-api.ts` & `save-store.ts` & `server/rules/schema.py` | 暴露调试评估桥接方法（`dispatchCreatorCommand`、`applyHumanDiff`、`exportSaveBytes`），将 `creatorRules` 与 `fuseState` 纳入存档序列化，并同步后端白名单。 | Step 5, 6 | 1.0h |

---

## 三、 评测数据集完整内容（可直接保存落盘）

### 1. 主评测集：world-client/eval/creator/main.json

```json
{
  "version": 1,
  "split": "main",
  "spec": {
    "behavior": "造物主创世与动态扩建闭环：蓝图选址零重叠、门口自动连路、脚手架按拍施工落成、人工改位逆向生成规则补丁、违规自动触发熔断降级",
    "when": "通过神谕或创世批次下达 CreateRegion / PlaceBuilding / UpgradeBuilding 及人工审校挪动时",
    "do": [
      "M1: 合法蓝图自动在目标区域内算出满足 footprint + clearMargin 的零重叠坐标",
      "M2: 建筑落位后自动生成从 door 偏移点到最近主干道的可通行路径（pathfindingConnectivity === 1.0）",
      "M3: 新建建筑先进入 scaffolding 脚手架阶段并冒施工烟尘，推进指定逻辑拍后自动蜕变为 completed 并写入编年史回执",
      "M4: 对已完成建筑执行原位升级（UpgradeBuilding）时保留原坐标与道路连接，更新蓝图属性与外观层",
      "M5: 人工挪动（moved）建筑提案后，RuleSynthesizer 产出可自证（isSelfJustifying）的 SpatialConstraintPatch 并在下一次选址中生效",
      "M6: 连续注入非法坐标或越界指令时，AutonomousFuseController 触发 FUSE_TRIPPED 并从 L2 降级至 L1"
    ],
    "dont": [
      "严禁在选址、修路或施工倒计时中使用 Date.now 或 Math.random",
      "严禁仅修改 Phaser 渲染层而不写入存档字节（防假绿）"
    ],
    "keepIntact": [
      "K1: 造物主选址与施工期间，世界时钟与村民作息正常推进（单拍耗时不超 16.6ms）",
      "K2: ?art=0 模式下新增建筑与脚手架保持零外部图片请求（纯 24 色板程序化渲染兜底）",
      "K3: 相同初始存档 + 相同创世指令批次重放两次，最终世界状态哈希与网格快照 100% 一致",
      "K4: 存档 schemaVersion 保持不变，落盘字节包含 buildings、roads、creatorRules 与 fuseState"
    ]
  },
  "examples": [
    {
      "id": "M1",
      "name": "autoSlotZeroOverlap",
      "check": "slotAllocation",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "creator-m1" },
      "input": { "kind": "PlaceBuilding", "prefabId": "workshop_lantern", "region": "industrial" },
      "expect": { "overlapCount": 0, "minClearMargin": 1, "inRegion": "industrial" }
    },
    {
      "id": "M2",
      "name": "doorToRoadConnectivity",
      "check": "roadAutoPave",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "creator-m2" },
      "input": { "kind": "PlaceBuilding", "prefabId": "workshop_lantern", "autoConnectRoad": true },
      "expect": { "pathfindingConnectivity": 1.0, "doorWalkableToAltar": true }
    },
    {
      "id": "M3",
      "name": "scaffoldingToCompletedLifecycle",
      "check": "constructionLifecycle",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "creator-m3" },
      "input": { "kind": "PlaceBuilding", "prefabId": "smithy_lv1", "constructionTicks": 3 },
      "expect": { "stageAtTick1": "scaffolding", "smokeActiveAtTick1": true, "stageAtTick3": "completed", "chronicleAdded": true }
    },
    {
      "id": "M4",
      "name": "inPlaceBuildingUpgrade",
      "check": "buildingUpgrade",
      "env": { "world": "dengchao", "now": 600, "phase": "noon", "feed": "off", "debug": 1, "seed": "creator-m4" },
      "input": { "kind": "UpgradeBuilding", "targetId": "b_smithy_1", "toPrefabId": "smithy_lv2", "constructionTicks": 2 },
      "expect": { "sameOrigin": true, "newPrefabId": "smithy_lv2", "roadPreserved": true }
    },
    {
      "id": "M5",
      "name": "humanMoveDiffToSpatialRule",
      "check": "diffRuleSynthesis",
      "env": { "world": "dengchao", "now": 600, "phase": "noon", "feed": "off", "debug": 1, "seed": "creator-m5" },
      "input": {
        "diffType": "moved",
        "agentProposal": { "kind": "PlaceBuilding", "id": "cmd_1", "prefabId": "fish_dock", "origin": { "x": 18, "y": 14 } },
        "userOutcome": { "kind": "PlaceBuilding", "id": "cmd_1", "prefabId": "fish_dock", "origin": { "x": 6, "y": 14 } }
      },
      "expect": { "patchKind": "SpatialConstraint", "selfJustifying": true, "enforcedOnNextPlace": true }
    },
    {
      "id": "M6",
      "name": "consecutiveViolationsTripFuse",
      "check": "fuseDowngrade",
      "env": { "world": "dengchao", "now": 600, "phase": "noon", "feed": "off", "debug": 1, "seed": "creator-m6" },
      "input": { "role": "LAYOUT_AND_BUILDING", "injectInvalidCount": 3 },
      "expect": { "isFused": true, "fromLevel": 2, "toLevel": 1, "lastEvent": "FUSE_TRIPPED" }
    },
    {
      "id": "K1",
      "name": "worldStillRunsWithinStepBudget",
      "check": "worldStillRuns",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1 },
      "expect": { "clockAdvanced": true, "maxAvgStepMs": 16.6 }
    },
    {
      "id": "K2",
      "name": "artOffZeroExternalRequests",
      "check": "artOffZeroRequests",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "art": 0 },
      "expect": { "imageNetworkRequests": 0 }
    },
    {
      "id": "K3",
      "name": "deterministicReplayBitExact",
      "check": "deterministicReplay",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "replay-seed-42" },
      "expect": { "stateHashMatch": true, "gridSnapshotMatch": true }
    },
    {
      "id": "K4",
      "name": "saveSchemaAndCreatorStateIntact",
      "check": "saveSchemaIntact",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1 },
      "expect": { "schemaVersionUnchanged": true, "persistedFields": ["buildings", "roads", "creatorRules", "fuseState"] }
    }
  ]
}
```

### 2. 备用保留集：world-client/eval/creator/held-out.json

```json
{
  "version": 1,
  "split": "held-out",
  "spec": {
    "behavior": "造物主在满载边界、障碍绕行、中途存档重放、熔断恢复以及不同世界时刻/潮位档下的泛化稳定性",
    "when": "切换世界相位、高潮位淹没档、跨设定集或注入满载/障碍场景时",
    "do": [
      "H1: 区域满载无法满足 footprint + clearMargin 时明确拒绝并返回 REGION_FULL，绝不压盖已有建筑或道路",
      "H2: 门口正前方存在不可通行岩石时，自动修路器绕开障碍连通主干道",
      "H3: 施工倒计时中途导出存档并重载，剩余施工拍数精确延续直至完工",
      "H4: 熔断降级后连续回归批次通过率达 1.0 时，allowResumeToTarget 恢复至目标自治等级",
      "V1: 夜晚高潮位（now=1320, phase=night, tide=high）下自动避开潮水淹没格选址",
      "V2: 清晨时段（now=360, phase=dawn）切换设定集验证蓝图色板与存档结构兼容性"
    ],
    "dont": [
      "严禁对固定开局时刻（now=540, phase=noon）硬编码选址坐标",
      "严禁在高潮位将非水生建筑放置在淹没格"
    ],
    "keepIntact": [
      "所有保留集与环境变体用例均保持 0 页面报错与存档字节可逆回放"
    ]
  },
  "examples": [
    {
      "id": "H1",
      "name": "regionFullGracefulReject",
      "check": "slotAllocation",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "held-h1" },
      "input": { "kind": "PlaceBuilding", "prefabId": "grand_foundry_6x6", "region": "saturated_zone" },
      "expect": { "shouldReject": true, "rejectCode": "REGION_FULL" }
    },
    {
      "id": "H2",
      "name": "roadDetourAroundObstacle",
      "check": "roadAutoPave",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "held-h2" },
      "input": { "kind": "PlaceBuilding", "prefabId": "workshop_lantern", "obstacleInFrontOfDoor": true, "autoConnectRoad": true },
      "expect": { "pathfindingConnectivity": 1.0, "doorWalkableToAltar": true }
    },
    {
      "id": "H3",
      "name": "midConstructionSaveReloadResume",
      "check": "constructionLifecycle",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "held-h3" },
      "input": { "kind": "PlaceBuilding", "prefabId": "smithy_lv1", "constructionTicks": 3 },
      "expect": {
        "reloadMidConstruction": true,
        "stageAtTick1": "scaffolding",
        "smokeActiveAtTick1": true,
        "stageAtTick3": "completed",
        "chronicleAdded": true
      }
    },
    {
      "id": "H4",
      "name": "fuseRecoveryAfterCleanRegression",
      "check": "fuseDowngrade",
      "env": { "world": "dengchao", "now": 540, "phase": "noon", "feed": "off", "debug": 1, "seed": "held-h4" },
      "input": { "role": "LAYOUT_AND_BUILDING", "injectInvalidCount": 3, "thenPassRegressionRate": 1.0 },
      "expect": { "isFused": false, "fromLevel": 1, "toLevel": 2, "lastEvent": "RECOVERY" }
    },
    {
      "id": "V1",
      "name": "nightHighTideAvoidSubmergedSlots",
      "check": "slotAllocation",
      "env": { "world": "dengchao", "now": 1320, "phase": "night", "tide": "high", "feed": "off", "debug": 1, "seed": "held-v1" },
      "input": { "kind": "PlaceBuilding", "prefabId": "workshop_lantern", "region": "coastal_industrial" },
      "expect": { "overlapCount": 0, "minClearMargin": 1, "submergedBuildingCount": 0 }
    },
    {
      "id": "V2",
      "name": "dawnPhaseSaveAndPaletteIntegrity",
      "check": "saveSchemaIntact",
      "env": { "world": "dengchao", "now": 360, "phase": "dawn", "feed": "off", "debug": 1, "seed": "held-v2" },
      "expect": { "schemaVersionUnchanged": true, "persistedFields": ["buildings", "roads", "creatorRules", "fuseState"] }
    }
  ]
}
```

---

## 四、 本地执行与门禁验收指令清单

将配套生成的三个代码文件放到对应目录后，在 `world-client/` 下按顺序执行以下 4 步完成闭环验收：

1. **跑评分器防假绿自检单测（毫秒级静态与结构校验）**：
   ```bash
   node --import tsx --test test/creator-eval.test.ts
   ```
2. **启动本地开发服并跑主评测集（验证 M1~M6 与 K1~K4 共 10/10 全绿）**：
   ```bash
   node scripts/eval-creator.mjs --split=main
   ```
3. **跑防过拟合保留集（验证 H1~H4 与 V1~V2 共 6/6 全绿）**：
   ```bash
   node scripts/eval-creator.mjs --split=heldout
   ```
4. **回归全量工程门禁（确保不破坏既有 2714 项测试与渲染预算硬闸）**：
   ```bash
   npm test && npm run check
   ```
