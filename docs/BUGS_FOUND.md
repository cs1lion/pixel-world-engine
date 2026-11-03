# 功能测试发现的缺陷

## 造物构建（feat/func-creator）

测试分支：`feat/func-creator`（worktree `D:\project\pwe-funccreator`，基线 `54139dd`）。
测试入口：`world-client/test/creator-functional-l1.test.ts`、`creator-functional-l2.test.ts`、`creator-functional-l3.test.ts`。
下列两条原先用 `test(..., { todo: 'BUG-x' }, ...)` 保留失败读数；已在提交 `f58179d` 修复，对应用例翻成正常断言并通过。下面同时记录修复前后读数。

---

### BUG-1 覆盖率分母为 0 时，`creationCoverage` 返回 0 而不是「没测」

- **编号**：BUG-1
- **状态**：**已修**，提交 `f58179d`。
- **依据**：账本侧既定契约 `coverageAfterBuild()` 在 `blueprintCount <= 0` 时返回 `null`，并由 `reading()` 统一落成 `passed=null` / `reason=not_measured`（`src/creator/ledger.ts:172-214`）。业务规则侧必须同口径，「没测」不能写成 0 分。
- **修复**：`creationCoverage()` 返回类型改为 `number | null`，0 分母直接 `return null`；引擎 `submitHumanApproval` 只在 `typeof coverageRate === 'number'` 时记观测；`SandboxScene` / `trace/runtime.ts` 把 `null` 原样交给 `evaluateLandingGates`（该处已按 `null → passed=null` 处理）。`checkLandedBuilding` 只跑空间/不变式业务规则，不消费覆盖率，无需 null 分支。
- **修复前读数**：`creationCoverage(...) = 0`；落地门禁 `passed=false`、`reason=below_requirement`；计数器 `coverageChecks=1`（把没测算成一次 0 分观测）。
- **修复后读数**：`creationCoverage(...) = null`；落地门禁 `passed=null`、`reason=not_measured`；计数器 `coverageChecks=0`。
- **证据**：
  - 测试 `[L3] creationCoverage 在 0 分母时给 null，落地门禁与计数器都记 not_measured`，`creator-functional-l3.test.ts:130`，已通过；
  - 同文件 `[L3] 覆盖率分母为 0：账本记 not_measured，不是 0/1` 仍通过。
- **影响范围**：修复前，0 模板设定集/空世界会把「没测」误报成「覆盖率 0，低于 95%」，并给角色记一次假的 0 分覆盖率证据；修复后不再产生该错误读数。

---

### BUG-2 L0 熔断「降级」会把角色升到 L1

- **编号**：BUG-2
- **状态**：**已修**，提交 `f58179d`。
- **依据**：《补充架构设计与全量待定参数规格书 v1.0》§2.2「自治爬梯（L0–L4）的『双向熔断与自动降级机制』」明写熔断对象是「**处于 L2/L3 的模块**」，动作是「立即将该模块实时降级回 **L1**」（`docs/iterations/1027-task-2/architecture-supplement-v1.0-params.md:80-85`）；v0.2 §2.2 同样表述为「从 L3/L2 降级回 L1」（`architecture-supplement-v0.2.md:101-105`）。文档没有「从 L0 升到 L1」的规则，且「降级」只能向下。因此无条件写 L1 是行为写反，不是有意设计。
- **修复**：`triggerDowngrade()` 取 `Math.min(oldLevel, AutonomyLevel.L1)`：L0 留 L0、L1 留 L1、L2/L3 才落到 L1；`isFused` 与窗口清零逻辑保持不变。
- **修复前读数**：`currentLevel = 1`（被「降级」抬高），`isFused = true`，事件 `fromLevel=0 → toLevel=1`。
- **修复后读数**：`currentLevel = 0`，`isFused = true`，事件 `fromLevel=0 → toLevel=0`。
- **证据**：
  - 测试 `[L3] 熔断降级不能把 L0 升成 L1`，`creator-functional-l3.test.ts:315`，已通过；
  - 原有 `creator-fuse.test.ts` 的「不变式被违反一次就当场熔断回 L1」「人类回滚一次就降级」「等级变化如实记下 from 与 to」全部通过，证明 L1/L2 路径未回退。
- **影响范围**：修复前 L0 人工拒绝一次就会「升层 + 熔断」，与「L0→L1 是升级爬梯、拒绝是降级」的语义相反；修复后各等级只降不升。

---

### 已通过、未记为缺陷的边界读数

以下边界在本轮测试中通过，说明实现是正确的；列出来避免后续误判：

- 同 prefabId 第二栋：真实 `Simulation` 返回 `这种铺子已经有一栋了。`，建筑数不变（L3）。
- 覆盖率 0 分母：`coverageAfterBuild` 返回 `null`，`evaluateProposalGates` 记 `passed=null`、`reason=not_measured`，`buildCreationRecord` 记 `rejectionGate=coverage`、`kind=not_measured`（L3）。
- 账本去重：重复 `recordId` 返回旧记录 `duplicate=true`，`seq` 不变、文件字节数不变（L3）。
- 队列上限：`maxItems=2` 时第三条入队丢第一条，`dropped=1`，持久化只剩最新两条；出队只发后两条（L3）。
- 重启：`seq` 从文件续号 `1→2→3`，时钟回拨时 `recordedAt` 保持上一条时间，不倒退（L3）。
- 7 日观测三态：`still_present` / `removed` / `modified` 均在第 7 世界日各出一条真实观测（L2）。
- 爬梯：真实造物 + 真实覆盖率/冲突/不变量观测，L0→L1→L2；只补 schema、覆盖率/冲突分母为 0 时 13 天仍停在 L1（L2）。

---

## 交互（feat/func-interact）

分支 `feat/func-interact` 的功能测试（`world-client/test` 下的 `interact-l1`、`interact-l2`、`interact-l3` 三个用例文件，加 `world-client/scripts/check-interact.mjs`）覆盖到的真实问题。

**当前状态：BUG-1、BUG-2 都已修复，断言已翻正（原来的 `todo` 归零）。** 每一条都写清修复前后的实测结果；修复代码与断言在同一个提交里，测试不再用 `todo` 标注期望。

---

### BUG-1 神谕写作没有长度 / 控制字符校验（已修复）

- **修复前的现象**：面板只把输入 `trim()` 一下，空串挡住、其余原样交给 `api.say`。超长文本和不可见控制字符都能直接写进世界，输入框也没有 `maxlength` 兜底。
- **最小复现**：
  1. 打开页面，点开神谕写作面板（`#utterance`）。
  2. 粘贴 10000 个字符后提交；或输入 `"a\u0000b\u0007c"` 后提交。
  3. 面板关闭、文本原样进入神谕，没有拒绝、没有截断、没有提示。
- **修复前实测**（单元 `L3-1b` / `L3-1c` 当时的 `todo` 读数）：`10000 字 → 神谕原样收到`；`"<script>\u0000..." → 原样投递，控制字符仍在`；`#utterance` 没有 `maxlength`。
- **修法**：
  - 上限 200 字，写成常量 [`UTTERANCE_MAX_LENGTH`](../world-client/src/ui/oracle-panel.ts#L13-L22)，由 [`prepareUtterance`](../world-client/src/ui/oracle-panel.ts#L31-L39) 统一裁决（剥控制字符 → `trim` → 判空 → 判上限）。
  - **超长选「整句拒收」而不是截断**：截断会悄悄改掉命令的意思（把「不要拆」截成「不要」），玩家却以为后半句已经生效；拒收并保留原文，问题才看得见。回执写明字数与上限：「这句话 10000 字，超过上限 200 字；删短再发。」
  - **控制字符选「剥除」而不是拒收**（用户给的是「过滤或拒收」二选一）：`\u0000`–`\u001f`、`\u007f` 玩家在输入框里本来就看不见，为一个看不见的字符丢掉整句话没有道理；剥干净后如果什么都不剩，再按空句处理，不投递。
  - 输入框加 `maxlength`（[`input.maxLength = UTTERANCE_MAX_LENGTH`](../world-client/src/ui/oracle-panel.ts#L330-L331)），提交入口（[`submit`](../world-client/src/ui/oracle-panel.ts#L333-L347)）再校验一次——粘贴、脚本、调试写入绕得过 `maxlength`，绕不过 `prepareUtterance`。
- **修复后对比（同一组输入实测）**：

  | 输入 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 10000 字 | 原样投递 | 整句拒收，输入保留，回执「这句话 10000 字，超过上限 200 字；删短再发。」 |
  | 201 字 | 原样投递 | 整句拒收，输入保留，回执「这句话 201 字，超过上限 200 字；删短再发。」 |
  | 恰好 200 字 | 原样投递 | 收下并清空输入（`maxlength` 也是 200） |
  | `"\u0000\u0001\u0007拆掉祭坛\u007f"` | 控制字符原样投递 | 剥离 4 个控制字符后投递「拆掉祭坛」 |
  | 纯控制字符 / 全空白 | 纯控制字符原样投递 | 按空句处理：0 次投递，输入保留 |
  | 粘贴 201 字 | 原样投递 | 被 `maxlength` 截到 200 后收下 |
  | 上游在线但拒收 | 回执照抄（本来就这样） | 回执照抄、输入保留、只送一次（`L3-3b` 钉住，防止二次校验把它重试成两次） |

- **断言**：单元 [`L3-1a`](../world-client/test/interact-l3.test.ts#L174)、[`L3-1b`](../world-client/test/interact-l3.test.ts#L187)、[`L3-1c`](../world-client/test/interact-l3.test.ts#L212)、[`L3-1d`](../world-client/test/interact-l3.test.ts#L254)；浏览器 `check-interact.mjs` 的 `L3-1`（空白）、`L3-2`（控制字符）、`L3-3`（恰好 200 / 201 / 10000 / 粘贴 201）、`L3-3b`（上游拒收回执）。

---

### BUG-2 长按期间单位自己走开，500ms 后仍会弹出面板（已修复）

- **修复前的现象**：长按用 `pointerdown` 时的单位引用起 500ms 定时器。玩家手指不动时不会有 `pointermove`，定时器回调里只用 `still !== null` 判断（恒真），没有重新做一次「指针此刻是否还压在这个单位上」的命中测试。单位自己走开（或被人挤走）仍会开记忆 / 楼志面板。
- **最小复现**：
  1. 60 倍速打开页面（`?speed=60`）。
  2. 在一个正在走路的村民格子上按住 650ms，手指全程不动。
  3. 村民在按住期间换格（修复前实测 `莞尔 45,37 → 44,37`，0 个 `pointermove`），650ms 时仍弹出了这个村民的记忆面板。
- **修复前实测**：`莞尔 从格 (47,36) 走到 (46,36)，手指没动、也没有 pointermove，500ms 定时器照样开了记忆面板「莞尔」`。
- **修法**：按下时同时记下目标引用与格坐标（[`longPressRef` / `longPressCell`](../world-client/src/scenes/SandboxScene.ts#L2467-L2470)）；定时器触发前用**同一个格**重新查一次 [`unitAtCell`](../world-client/src/scenes/SandboxScene.ts#L2478-L2484)，命中为空、换人（kind 或 id 不同）、离场都取消。原来那条恒真判据换成 `stillOnTarget`。
- **修复后实测**：

  | 场景 | 修复前 | 修复后 |
  | --- | --- | --- |
  | 目标在 500ms 内自己走出该格（实测 `莞尔` 在 348ms 走出 `(40,39) → (40,40)`，手指不动） | 照开记忆面板 | 0 个面板 |
  | 手指在 200ms 时移到隔壁格（实测移出 1 格 = 64px） | 0 个面板（原有守卫） | 0 个面板（保持） |
  | 按住不动 650ms | 开面板 | 开面板（正控制，`L1-10a`） |
  | 目标离场 | 开面板 | 取消（单元 `L1-5` 用 `withVillagers([])` 覆盖） |

  浏览器里造不出「村民离场」（本作村民不会离开世界），所以「离场」这一支由单元 [`L1-5`](../world-client/test/interact-l1.test.ts#L250) 的「快照里没了」覆盖；`L1-10b` 保留 `during === undefined` 的分支，真出现离场时也会按取消断言。
- **断言**：单元 [`L1-5`](../world-client/test/interact-l1.test.ts#L250)（原地不动 true；只留她时走出格 → `null`；两人同格走开 → 换人 false；清空快照 → `null`）；浏览器 `check-interact.mjs` 的 `L1-10a`（正控制）、`L1-10b`（500ms 内自己走出该格）、`L1-10c`（手指移出 1 格）。

---

### 补测的两条缺口（行为基线，不是缺陷）

这一轮把之前只列在缺口清单里的两条补成了断言；先测现状，再把选定的规则写进注释钉住。

- **面板打开时的拖图 / 键盘移动**（`check-interact.mjs` 的 `L2-7`，规则写在用例注释里）：
  - 状态菜单锚在格子上，每帧重算，拖图 / 缩放后跟随（实测拖图后锚点误差 0.54px、位置挪 33.94px）。
  - 记忆面板随「镜头离开跟随」收起：拖图即收起（不是跟随）。
  - 楼志是打开瞬间的静态快照：拖图后仍开、标题不变。
  - 本作没有键盘平移入口：方向键后 `camera.scrollX/scrollY` 不变，面板仍贴格（误差 ≤2px）。
- **两人同格时只有后选中的那个出内容**（`check-interact.mjs` 的 `L3-9`）：同格是瞬态，用 debug 入口在同一帧先选 A 再选 B，断言只剩后选中的 B 的内容与标题、只有一个面板；人 / 楼 / 记忆的互斥仍由 `L3-5` 覆盖。
