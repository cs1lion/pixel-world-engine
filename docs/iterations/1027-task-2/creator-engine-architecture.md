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

> **这一节是拟议接口，不是今天的代码。** 下面两段都引用 `CreatorEngine`，
> 而它今天编译不过（见第六节末）。本节说的是「接上之后长什么样」。

### 从 `SandboxScene` 调用

```typescript
import { CreatorEngine } from './world/creator/engine.ts';

class SandboxScene extends Phaser.Scene {
  private engine: CreatorEngine;

  async preload() {
    const rawPack = loadLocalSettingPack(); // 读取本地 JSON
    this.engine = new CreatorEngine(rawPack);
  }

  async onUserUtterance(utterance: string) {
    // 1. 解析为意图（外部 oracle）
    const intent = await parseIntent(utterance);

    // 2. 请求造物引擎决策
    const decision = await this.engine.executeCommand('interpreter', intent);

    if (!decision.allowed) {
      // 3. 显示审批面板
      await showApprovalPanel(intent, decision.reason);
    } else {
      // 4. 直接执行
      applyIntentToWorld(this.world, intent);
    }
  }
}
```

### 从记忆系统调用

```typescript
// 日终广播心电图快照
function broadcastVitalsSnapshot(vitals: WorldVitalsSnapshot) {
  const engine = getGlobalCreatorEngine();
  const decision = engine.processDayClosed(vitals);

  if (decision.shouldInject) {
    // 注入事件到世界
    world.injectEvent(decision.eventKind);
  }
}
```

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

**`CreatorEngine`（本文第一节那个入口）还没有落地。** 它**不在这个仓库里**——只有一份
未入库的草稿，停在某个开发者的工作区。那份草稿今天过不了 `npm run check`（8 处语义错：
`MemoryConfig` / `computeMemoryConfig` / `DirectorEngine` / `RawSettingPack` 四个名字
没导入），它对应的测试文件另有 40 处。它还有两处越界：
`creator-boundary.test.ts` 拦的是它 `import` 了 `memory/types.ts`，
`purity.test.ts` 拦的是它从 `world/` 往上层 `settings/` 里 import。

（这里原来写的是「它的草稿在 `<那个路径>`」——路径写成反引号里的仓内形状，于是
`audit-citations.ts` 会去磁盘上找它。磁盘上确实有一份，**而 git 里没有**：闸门按磁盘
解析，CI 按 clone 解析，两边对同一句话给出相反的答案。这个仓库的引用审计只保证
「文件在」，不保证「你 clone 下来能拿到」——所以这种引用不该被写成路径。）

所以上面那张表里**没有它**——把一份编译不过的草稿列成「新增」，就是本文档最该
避免的那种假话。第一节的组件图是**目标形态**，不是今天的形态：Fuse、Director、
Metrics、Synthesizer、Schema 五个模块各自跑着、各自有测试，但它们之间今天还没有
那个把它们串起来的东西，也还没有任何生产代码 import 它们
（`grep -rn "world/creator/" src --include=*.ts` 在 `src/` 下零命中）。

---

## 七、待办事项

- [ ] 添加 `BuilderContext` 参数传递到各个子系统
- [ ] 完善 `executeCommand` 的实际执行逻辑（目前仅返回决策建议）
- [ ] 连接实际的世界变更 API（`world.applyCommand()`）
- [ ] 添加内存持久化机制（保存角色状态到本地存储）
- [ ] 补充可视化监控界面（展示各角色的当前等级和指标）

---

## 八、参考文档

- 《补充架构设计 v1.0》第 2.2 节（熔断机制）
- 《补充架构设计 v1.0》第 3.3 节（自治等级爬梯）
- `SPEC.md` §4.3（命令清单 v1）
- `docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md`
