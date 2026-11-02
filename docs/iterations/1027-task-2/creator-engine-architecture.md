# 造物引擎架构设计 v1.0

**目标**：整合设定集加载、Fuse（熔断）、Director（导演）、Metrics（指标），实现从 L0 到 L4 的自治爬梯。

---

## 一、核心组件关系图

```
┌─────────────────────────────────────────────────────────────┐
│                     CreatorEngine                            │
│                   (造物引擎入口)                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ SettingPack│   │Autonomous│   │Director  │              │
│  │ 设定集加载 │   │FuseController │  Engine   │              │
│  │          │    │  熔断控制器│   │  导演引擎 │              │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│       │               │                │                     │
│       └───────────────┼────────────────┘                     │
│                       ▼                                      │
│              ┌────────────────┐                              │
│              │ Metrics        │                              │
│              │ 指标统计       │                              │
│              └────────────────┘                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │ BuiltWorld (世界状态)  │
              │ - grid                 │
              │ - buildings            │
              │ - altar                │
              └────────────────────────┘
```

---

## 二、工作流程

### 阶段 1: 初始化（L0 - 人工预制）

```typescript
// 1. 加载设定集（编译、校验、验证布局可达性）
const rawPack: RawSettingPack = { ... }; // JSON/YAML 或硬编码对象
const pack = loadSettingPack(rawPack); // → SettingPack（已编译）

// 2. 构建初始世界状态
const { grid, buildings, altar } = buildSettingWorld(pack);

// 3. 初始化所有造物主角色到 L0
const engine = new CreatorEngine(rawPack, { targetLevel: AutonomyLevel.L3 });

// 此时：世界已建成，但所有命令都需要人工逐项确认
```

### 阶段 2: 执行命令（L1 - 人工确认）

```typescript
// L0/L1 阶段：所有命令都需人工确认
const decision = await engine.executeCommand('interpreter', {
  kind: 'setWeather',
  parameters: { weather: 'rain' },
});

if (!decision.allowed) {
  // 显示在 UI 上等待人类点击"批准"/"拒绝"
  showApprovalPanel({ command, reason: decision.reason });
}
```

### 阶段 3: 质量记录与升降级

```typescript
// 每执行一条命令，记录指标
engine.fuseController.recordCommandResult('interpreter', {
  schemaPassed: true,
  hasConflict: false,
  coverageRate: 0.98,
  pathfindingConnected: true,
  hasCollision: false,
  spatialConstraintSatisfied: true,
  invariantViolated: false,
  traceable: true,
  replayHashConsistent: true,
});

// 每日结算（触发升级检查）
engine.fuseController.endOfDay('interpreter');

// 当连续 3 批 / 14 天达标后，自动升至 L2/L3/L4
```

### 阶段 4: 导演注入（打破死寂）

```typescript
// 日终摘要处理
const vitals = {
  meanValence: 0.2,     // 情绪效价 [-1, +1]
  meanArousal: 0.1,     // 唤醒度 [0, 1] (< 0.25 触发注入)
  infoEntropy: 0.5,
  isolatedHoldersCount: 0,
};

const injectDecision = engine.processDayClosed(vitals);

if (injectDecision.shouldInject) {
  // 注入事件（由 DirectorEngine 确定具体事件类型）
  world.injectEvent(injectDecision.eventKind);
}
```

### 阶段 5: 熔断与恢复

```typescript
// 降级触发（不变式违反 ≥1 次 → 立即降回 L1 并熔断）
engine.fuseController.forceDowngradeToL1('interpreter', '不变式违反');

// 尝试恢复前必须先跑回归集
engine.recordRegressionTest('interpreter', true, { testCount: 100 });

// 回归集通过后才能恢复
engine.tryResumeFusedRole('interpreter'); // → true
```

---

## 三、自治等级爬梯

| 等级 | 名称 | 门禁指标 | 执行策略 |
|------|------|----------|----------|
| **L0** | 人工预制通用裸模骨架 | 全部手动 | 所有指令需人工逐项确认 |
| **L1** | 生成后人工逐项确认 | Schema <100% 或冲突 >0 | 全部走人工确认通道 |
| **L2** | 自动检查免审 / 异常人工 | Schema 100% + 冲突 0 + 要素覆盖≥95% | 直接放行 |
| **L3** | 抽检放行 | L2 + 寻路连通 100% + 碰撞 0% + 约束 100% | 10% 确定性抽检 |
| **L4** | 无人值守例外报警 | L3 + 溯源 100% + 回放哈希一致 | 完全自动化，只发警报 |

---

## 四、质量门禁详解

### L2 门禁（要素覆盖）
```typescript
// 必须观察过且覆盖率 ≥95%
if (rates.coverageRate === null || rates.coverageRate < 0.95) return false;
```

### L3 门禁（空间约束）
```typescript
// 寻路必须 100% 连通
if (rates.pathfindingConnectedRate === null || rates.pathfindingConnectedRate < 1) return false;
// 不能有碰撞
if (rates.collisionRate === null || rates.collisionRate > 0) return false;
// 空间约束必须 100% 满足
if (rates.constraintSatisfactionRate === null || rates.constraintSatisfactionRate < 1) return false;
```

### L4 门禁（可追溯性与可复现性）
```typescript
// 每条指令都必须能溯源到用户意图
if (rates.traceabilityRate === null || rates.traceabilityRate < 1) return false;
// 回放哈希必须一致（确定性保证）
if (rates.replayHashConsistencyRate === null || rates.replayHashConsistencyRate < 1) return false;
```

---

## 五、集成接口

> **这一节现在是代码里的接口**（第三阶段已接）。`CreatorEngine` 住在
> `src/creator/engine.ts`——不是 `world/creator/`：它要把设定集喂给世界，
> 必然同时看得见两边，理由写在该文件头。它由 `SandboxScene` 拥有，
> 世界、种子与时钟都由场景给。

### 从 `SandboxScene` 调用

```typescript
import { CreatorEngine } from '../creator/engine.ts';

// 不另建第二份世界：吃的是场景这一份。种子与时钟也不自造。
this.creator = new CreatorEngine(pack, {
  worldSeed: pack.id,
  worldTime: () => this.snapshot.now,
  world: this.world,
});

// 玩家在造物模式里确认：引擎校验形状与配色，场景负责入队。
const plan = this.creator.proposeCreation({ templateId, at, palette, worldSize });
this.sim.enqueue({
  kind: 'build',
  prefabId: plan.templateId,
  instanceId,
  at: plan.at,
  source: { taskId: `creation-${instanceId}`, summary },
});
// 门口连通与回放一致**要等楼真的落地**：这里只登记，由 `building.built`
// 回写触发结算。落位前算这两项会偏乐观（楼还没占格、世界已经变了）。
this.pendingCreationObservations.set(instanceId, { plan, day, recompute });

// 落地之后（`settleCreationObservation`）：
this.creator.submitHumanApproval('mapper', instanceId, true, undefined, {
  coverageRate,
  pathfindingConnected: landingReachable(this.world, landed), // 落地后的真实网格
  replayHashConsistent: verifyCreationReplay({ plan, replayed, landed, day, blueprints }),
  hasCollision: false,
  spatialConstraintSatisfied: true,
  traceable: true,
});
```

### 从记忆系统调用

```typescript
// 记忆层关账（跨日）时，场景先结算外环，再决定要不要让引擎自己提议。
this.creator.closeWorldDay();
this.creator.processDayClosed(vitals);

if (this.creator.getFuseDecision('mapper').action === 'allow') {
  const plan = this.creator.planCreation(this.creatorWorldView());
  if (plan !== null) {
    this.sim.enqueue({
      kind: 'build',
      prefabId: plan.templateId,
      instanceId: this.sim.nextInstanceId(plan.templateId),
      at: plan.at,
      source: { taskId: `creator-${plan.templateId}`, summary: plan.reason },
    });
  }
}
```

L0–L2 的门禁是「要人点头」，所以自动提议只在 `allow` 时发生；
`planCreation` 本身不写世界，它只返回一份可复现的计划。

---

## 六、测试用例覆盖

| 模块 | 测试文件 | 测试数 |
|------|----------|--------|
| Fuse 控制器 | `test/creator-fuse.test.ts` | 30 |
| Director 引擎 | `test/creator-director.test.ts` | 21 |
| 指标系统 | `test/creator-metrics.test.ts` | 20 |
| 边界守护 | `test/creator-boundary.test.ts` | 6 |
| 命令白名单 | `test/creator-commands.test.ts` | 28 |
| 设定集常量 | `test/creator-config.test.ts` | 29 |
| 逆向审校合成器 | `test/creator-synthesizer.test.ts` | 14 |
| 造物指令 schema | `test/creator-schema.test.ts` | 21 |
| 引擎接线 | `test/creator-wire.test.ts` | 9 |
| 落地后观测 | `test/creator-landing.test.ts` | 8 |

**`CreatorEngine` 已经入库并接线。** 它住在 `src/creator/engine.ts`，由
`SandboxScene` 在 `create()` 里构造，吃场景这一份 `BuiltWorld`；计划经
`Simulation.enqueue` 落地；世界日由 `closeWorldDay()` 结算。`src/` 下现在
`grep "creator/engine"` 有生产命中——「零命中」是它入库前的读数。

（本文早先写过「它不在这个仓库里，草稿在某个开发者的工作区」。那是当时的
真实状态，不是今天的：草稿最终以 `src/creator/engine.ts` 入库，位置从
`world/creator/` 挪到 `src/creator/`，理由是它必须同时看见世界与设定集。
上面那张表也曾经故意不列它——把一份编译不过的草稿写成「新增」正是本文档
要避免的假话。第一节的组件图是目标形态，第三阶段之后它才真的连起来。）

另外，原来的草稿链路里有两处越界：`creator-boundary.test.ts` 拦的是
`import` 了 `memory/types.ts`；`purity.test.ts` 拦的是从 `world/` 往上层
`settings/` 里 import。入库版本把这两处都避开了——它位于 `src/creator/`，
世界内核一格不越界。

---

## 七、待办事项

- [x] 把世界现状传给引擎（`CreatorWorldView`：已落地模板 + 与手动造物同一套落点判据）
- [ ] `executeCommand` 仍只返回决策建议，没有把「允许」变成一次实际执行
- [x] 连接世界变更入口：计划经 `Simulation.enqueue({ kind: 'build' })` 落地
- [ ] 内存持久化：熔断等级、导演历史目前不进存档，重进世界从 L0 重来
- [ ] 补充可视化监控界面（展示各角色的当前等级和指标）
- [ ] `conflictCount` / `invariantViolationCount` 仍把「没观测」当 0：
      L2 的两道门禁因此是白送的。要么加检查分母把未观测记为不通过，
      要么在造物落地时真跑一遍 `runBusinessRulesCheck`——两条都还没做。
- [ ] `metrics.ts` 的 `relationSymmetryRate` 只有 `null` 路径（没有关系图数据源）。
      它不在 `fuse.ts` 的生产门禁里（那里 L4 只查溯源与回放），所以今天不挡人，
      但 `metrics.ts` 一旦接线就会挡。

---

## 八、参考文档

- 《补充架构设计 v1.0》第 2.2 节（熔断机制）
- 《补充架构设计 v1.0》第 3.3 节（自治等级爬梯）
- `SPEC.md` §4.3（命令清单 v1）
- `docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md`
