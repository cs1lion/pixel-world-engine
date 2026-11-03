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

**当前状态：BUG-1、BUG-2、BUG-3、BUG-4 均已修复。** 每一条都写清修复前后的实测结果；修复代码与断言在同一个提交里，测试不再用 `todo` 标注期望。

---

### BUG-1 神谕写作没有长度 / 控制字符校验（已修复）

- **修复前的现象**：面板只把输入 `trim()` 一下，空串挡住、其余原样交给 `api.say`。超长文本和不可见控制字符都能直接写进世界，输入框也没有 `maxlength` 兜底。
- **最小复现**：
  1. 打开页面，点开神谕写作面板（`#utterance`）。
  2. 粘贴 10000 个字符后提交；或输入 `"a\u0000b\u0007c"` 后提交。
  3. 面板关闭、文本原样进入神谕，没有拒绝、没有截断、没有提示。
- **修复前实测**（单元 `L3-1b` / `L3-1c` 当时的 `todo` 读数）：`10000 字 → 神谕原样收到`；`"<script>\u0000..." → 原样投递，控制字符仍在`；`#utterance` 没有 `maxlength`。
- **修法**：
  - 上限 200 字，写成常量 [`UTTERANCE_MAX_LENGTH`](../world-client/src/ui/oracle-panel.ts#L13-L22)，由 [`prepareUtterance`](../world-client/src/ui/oracle-panel.ts#L32-L39) 统一裁决（剥控制字符 → `trim` → 判空 → 判上限）。
  - **超长选「整句拒收」而不是截断**：截断会悄悄改掉命令的意思（把「不要拆」截成「不要」），玩家却以为后半句已经生效；拒收并保留原文，问题才看得见。回执写明字数与上限：「这句话 10000 字，超过上限 200 字；删短再发。」
  - **控制字符选「剥除」而不是拒收**（用户给的是「过滤或拒收」二选一）：`\u0000`–`\u001f`、`\u007f` 玩家在输入框里本来就看不见，为一个看不见的字符丢掉整句话没有道理；剥干净后如果什么都不剩，再按空句处理，不投递。
  - 输入框加 `maxlength`（[`input.maxLength = UTTERANCE_MAX_LENGTH`](../world-client/src/ui/oracle-panel.ts#L351-L351)），提交入口（[`submit`](../world-client/src/ui/oracle-panel.ts#L353-L367)）再校验一次——粘贴、脚本、调试写入绕得过 `maxlength`，绕不过 `prepareUtterance`。
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

- **断言**：单元 [`L3-1a`](../world-client/test/interact-l3.test.ts#L190)、[`L3-1b`](../world-client/test/interact-l3.test.ts#L203)、[`L3-1c`](../world-client/test/interact-l3.test.ts#L228)、[`L3-1d`](../world-client/test/interact-l3.test.ts#L270)；浏览器 `check-interact.mjs` 的 `L3-1`（空白）、`L3-2`（控制字符）、`L3-3`（恰好 200 / 201 / 10000 / 粘贴 201）、`L3-3b`（上游拒收回执）。

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

---

### BUG-3 两指捏合不缩放世界（已修复）

- **修复前的现象**：世界只有滚轮缩放（[`SandboxScene`](../world-client/src/scenes/SandboxScene.ts) 的 `wheel`），没有任何双指手势；Phaser 默认也只分一个触屏 pointer。浏览器实测两指 80px→200px，`zoom 2→2`。
- **最小复现**：`check-interact.mjs` 的 `L1-11c`。`hasTouch:true` 的上下文里用 CDP 两指从 80px 间距拉到 200px，读 `window.Oracle.camera().zoom` 前后都是 2。
- **修法**：
  - 输入层补第二根触屏 pointer（[`this.input.addPointer(1)`](../world-client/src/scenes/SandboxScene.ts#L656-L657)）。两指在册才进捏合；第二根落下的同一拍取消长按、拖图与单击（[`beginPinchIfTwo`](../world-client/src/scenes/SandboxScene.ts#L2503-L2516)），抬手时两根手指都被吃掉（`pointerup` 里 `suppressClickUp || pinching`）。
  - 档位复用滚轮那一套 `ZOOM_STEPS` / `stepZoomIndex`，没有另造连续倍率；每一档都锚在两指中点：点住的世界坐标在换档前后不动（[`zoomStepAt`](../world-client/src/render/camera-controller.ts#L168-L193)、[`scrollForZoomAnchor`](../world-client/src/render/camera-math.ts#L45-L68)）。
  - 阈值与迟滞放在纯逻辑里（[`PINCH_STEP_RATIO` / `PINCH_MIN_BASE_PX`](../world-client/src/render/pinch-zoom.ts#L16-L19)、[`pinchZoomStep`](../world-client/src/render/pinch-zoom.ts#L37-L53)）：张开到两倍进一档、收拢到一半退一档，跨档后基准重置；两指起手间距 <24px 不算捏合（双指点击不会顺手缩放）。
  - 两指位置**每帧结算一次**（[`settlePinch`](../world-client/src/scenes/SandboxScene.ts#L2533-L2548)）：Phaser 的 `pointermove` 是逐指派发的，同一拍里另一根手指还停在上一格。拿这种半新半旧的间距算中点，实测中点会从 240 算成 228，画面漂 2 世界px。
  - 锚点公式的浮点尾巴也修了：`scrollForZoomAnchor` 写成差值形式 `(1/to - 1/from) * (size/2 - screen)`，中点处严格为 0；换回的 scroll 取整再落，因为 `roundPixels` 会向下取地板（实测 `423.99999999999994` 被压成 423，凭空漂 1 世界px）。
- **修复后实测**（`check-interact.mjs` 33 项全过）：
  - `L1-11c`：两指 80→200，`zoom 2→3`，两指中点下的世界坐标漂移 **0.00 世界px**；200→80 缩回 `zoom 3→2`，漂移 **0.00 世界px**。两指按住 650ms（单指长按 500ms 就会开面板）与两次抬手都 **0 个面板**。随后用**原来的两指中点**触屏点一下，命中「莞尔」（同一人），**命中偏移 0.00 世界px**。
  - `L1-11d`（新增）：单指触屏拖 (60,45)px，`zoom 2` 不变，镜头平移 (-15.00,-12.00) 世界px（按位移应为 -15.00,-11.25；差 0.75 是 `roundPixels` 逐帧地板吃掉的），抬手 0 个面板——单指拖图没被误判成捏合。
  - 单测：[`pinch-zoom.test.ts`](../world-client/test/pinch-zoom.test.ts#L27-L75) 7 条（80→200 / 200→80、迟滞、一次最多一档、太近不起算、0 间距不会 Infinity）、[`camera-controller.test.ts`](../world-client/test/camera-controller.test.ts#L102-L135) 4 条（中点锚不动 scroll、左边缘锚不漂、到顶不动、与滚轮同档）、[`camera.test.ts`](../world-client/test/camera.test.ts#L110-L146) 4 条（任意屏幕点 / 任意档位对的锚点守恒）。
- **剩下的边界**：相机夹到世界边界时锚点必然漂——这是边界本身的性质，不是捏合算错。`L1-11c` 挑离边界 ≥7 格的样本（3 倍半视野约 5×3.3 格），文档里也写明，不做「边缘同样不漂」的假承诺。

---

### BUG-4 上游异步拒收时，原句已经被清空（已修复）

- **修复前的现象**：`submit` 投递成功就清空输入框；服务端的 4xx 要等模型那一趟回来才到。屏上出现一行「模型调用失败：这句话 250 字……」，输入框却是空的——玩家得把整句重打一遍。回执没有吞，但手里的话没了。
- **最小复现**（浏览器 `E2E-4a`，用 route 注入真服务端会回的那种 422）：面板填一句合法长度的句子 → 提交 → 输入框清空 → 422 回执到 → 输入框仍是空的。
- **修法**：
  - 回执带上原句：[`CommandResult.raw`](../world-client/src/world/types.ts#L533-L543)，`simulation.ts` 在 `oracle` / `intentFromModel` 两条结算路径上把原句带回来（空回执不带，被挤掉的那条不认领）。
  - 面板只认**自己那句**：[`pendingText` 与 `onResult`](../world-client/src/ui/oracle-panel.ts#L307-L330) 比对 `raw`；失败且输入框空着才放回，用户已经重新敲字就不覆盖。
  - 「正在问模型……」是成功回执，不能在它到时清掉 `pendingText`，否则随后真正的拒收无处可还。
- **修复后实测**：
  - 单元 `L3-1e`：投递后输入框空 → 中间回执「正在问模型……」不动输入 → 422 回执原样上屏（错误样式）→ 输入框恢复「让云把水倒下来」。
  - 单元 `L3-1e2`：别的句子的失败不往输入框里塞；成功回执不塞；用户已重新输入「我自己写的新句」时不被覆盖。
  - 浏览器 `E2E-4a`：真服务进程在线，面板收到 422 后回执含「超过上限 200 字」且带错误样式，输入框恢复原句。
- **为什么正常 UI 碰不到这个 4xx**：客户端 200 上限与控制字符剥除让面板发不出会被服务端拒收的句子。能撞上的是版本漂移——缓存里的旧前端（上限 500）配新服务端（上限 200）。`E2E-4a` 的 route 注入复现的就是这一幕。

---

## 服务端同步校验（新增闸，不是缺陷）

客户端挡住了不等于上游挡住了。这一轮把同一套判据在服务端再执行一次，并且**挡在调模型之前**：

- **200 字上限**：`oracle/api.py` 的 `_check_request` 在收到神谕时数长度，超长直接 **422** + 「这句话 N 字，超过上限 200 字；删短再发」，不是 `200 + unknown`——后者会被用户读成「世界没听懂」。上限与客户端 [`UTTERANCE_MAX_LENGTH`](../world-client/src/ui/oracle-panel.ts#L22) 同一个数（`orchestrator.MAX_UTTERANCE_CHARS`），`server/tests/test_intent_api.py` 的 `test_上限与客户端常量是同一个数` 直接读客户端源码里的数字钉住，防止两边各改各的。
- **控制字符**（`\u0000`–`\u001f`、`\u007f`）：服务端 **422 拒收**，回执写明个数。与客户端「剥除」不同，是刻意的：客户端剥掉是为了不因一个看不见的字符丢掉整句话；服务端拒收是因为一条带控制字符的 HTTP 请求本来就说明它不是那面板发出来的，服务端不该替旁路调用方洗数据。理由写在 [`oracle/api.py`](../server/oracle/api.py) 顶部。
- **长度口径对齐**：按 UTF-16 码元数（`utterance_length()`），与 JS 的 `String.length` 一致。用 `len()` 数会把 101 个 emoji 当成 101 字放行，而客户端眼里是 202 字——那正好又是一条「客户端挡住、上游没挡」。
- **实测读数**：
  - pytest 正反例：201 / 10000 → 422（含实际字数与上限）；恰好 200 → 200 + `setWeather`；`100 个 emoji`（200 码元）→ 200，`101 个`（202 码元）→ 422；7 组控制字符各自 422 并报个数；空句仍是 `200 + unknown`（契约不变）；`test_超长先于模型调用被拦` 证明 201 字那次调用者为 0 次。
  - 端到端 `check-oracle-e2e.mjs`：绕过 UI 直接 POST 250 字 → 422「这句话 250 字，超过上限 200 字；删短再发」；10000 字 → 422 且不带 intent；控制字符 → 422「…2 个控制字符…」；恰好 200 字 → 200 + `setWeather`。
  - 客户端在真服务上收到 4xx 的回执：`E2E-2a` 页面里直接 `Oracle.say(250 字)`，屏上是服务端的原话且带错误样式（不吞错）。

---

## 附：并行负载下的假红（2026-11-04，分支 fix/flaky-gates）

三处都只在机器被别的进程压满时红，隔离单跑全绿。取证结果：**都不是产品逻辑坏了**，
两处是测试自己的时序/墙钟判据，一处是跟真实定时器赛跑。
第三处（`接了模型之后……`）是四路并行验收时抓到的，不是最初点名的两条。

记录**取证过**的缺陷：现象 → 复现命令与频率 → 机制 → 修复 → 改前/改后频率与读数。
「看起来像抖动」不算结案。

### 1. `test/intent-async.test.ts`「同一句话连着说三遍，只问模型一次」

**现象**：整套/并行跑时偶发 `2 !== 1`，断言原文「去重是持久的，不是时间窗」，
位置 `intent-async.test.ts:303`（修复后的行号）。隔离单跑连跑 5 次全绿。

**复现命令**（压测工具在 `tmp/stress/`，已被 `.gitignore` 覆盖，不入库）：

```bash
# 8 路并行，每个进程各跑一遍该文件
node tmp/stress/flake-repro.mjs --file world-client/test/intent-async.test.ts \
  --runs 24 --concurrency 8 --tag intent-par8
```

**改前频率**：8 路并行 **5 / 24 = 20.8%**。失败 TAP 落在
`tmp/stress/intent-par8/r1-j0.tap`（`expected: 1 / actual: 2`，
`intent-async.test.ts:303`）。隔离单跑 0 红。

**机制（不是猜的，是打出来的时序）**：

测试里模型是 `classify: async () => { calls += 1; await setTimeout(5); ... }`——
一个**真实 5ms 定时器**。而第三遍「今天好累啊」只 `enqueue`、没有紧跟一拍，
它要等下面 `settle()` 的第一轮 `setImmediate` 才结算。去重表 `pendingClassify`
在答复回来时（`finally`）就删掉；机器一忙，一轮 `setImmediate` 超过 5ms，
于是**答复先落地、第三遍后结算**，第三遍真的又问了一次。

探针 `tmp/stress/probe-intent-dedup.ts` 把同一条时序逐事件打出来：

```bash
DELAY_MS=0 node tmp/stress/probe-intent-dedup.ts     # 把 5ms 换 0ms：同一竞态 100% 触发
1..8 | ForEach-Object -Parallel { $env:DELAY_MS=5; node tmp/stress/probe-intent-dedup.ts } -ThrottleLimit 8
```

- `DELAY_MS=0` 读数：`16.748ms 模型答复落地（pending 即将清空）` →
  `17.212ms settle 拍 1：update 前 calls=1 pending=0` → `17.426ms 模型被问，calls=2`
  → `RESULT calls=2`。**同一竞态 8/8 = 100%**。
- `DELAY_MS=5` 在 8 路并行下：3/8 次 `RESULT calls=2`；隔离单跑全部 `calls=1`。

结论：竞态在**测试**里，不在 `Simulation` 里。`pendingClassify` 的语义本来是
「同一句**还在问的路上**只问一次」，答复回来之后再说是新的一次提问，这是对的。

**修复（只改测试，不动被测代码，不放宽断言、不加 sleep）**：

模型改成**手动放行的闸**（`await answered`，由测试 `release()`），三遍确实都落在
「还在问」的窗口里；于是 `calls === 1` 与「世界时间再走 96ms 仍只问一次」两条断言
都变成确定性事件。判据（`calls === 1`）一个字没动，只是不再和真实时钟赛跑。

**改后频率**：

- 8 路并行 `--runs 32`：**0 / 32**；
- 16 路并行 `--runs 32`：**0 / 32**。

**剩余风险**：其它用真实 `setTimeout` 假装网络延迟的用例有同类结构（例如本文件
之外若有「等 N 毫秒再断言」的写法），本轮只修了这一条；模式是「用真实时钟推进
异步结果」，应改用放行闸。

---

### 2. `test/daily-prop-cost.test.ts`「传播的代价随规模走：holder 少一半的那次不该更贵」

**现象**：约 1/30 偶发红，读数 `half 10.57ms vs all 1.38ms`（82 个 holder 反而比
146 个贵 7.6 倍）；同一文件里「一天的世界时间跑得完」也在四路并行下偶发红
（`54.62ms / 100.28ms > 50ms`）。

**复现命令**：

```bash
node tmp/stress/flake-repro.mjs --file world-client/test/daily-prop-cost.test.ts \
  --runs 64 --concurrency 8 --tag cost-par8
```

**改前频率与读数**：

| 场景 | 次数 | 红 | 读数 |
| --- | --- | --- | --- |
| 规模断言，8 路并行 | 32 | 1（3.1%） | half 10.63ms / all 4.09ms |
| 规模断言，历史现场 | — | 约 1/30 | half 10.57ms / all 1.38ms |
| 绝对预算闸（50ms），8 路并行 | 64 | 3（4.7%） | 51~99.98ms |
| 绝对预算闸，四路并行（2026-11-03） | 10 | 2（20%） | 54.62ms / 100.28ms |

**机制（两条证据，都否掉了「只是抖动」这个说法）**：

1. **一天的真实计算量只有 0.3~1.0ms，读数却能到 10ms 以上。** 探针
   `tmp/stress/probe-cost.ts` 把每次采样都打出来（隔离、原顺序）：

   ```
   #1 half wall=29.562ms   #1 all wall=2.458ms
   #2 half wall=9.947ms    #2 all wall=1.467ms
   #3 half wall=0.807ms    #3 all wall=0.895ms
   ```

   把顺序反过来（`ORDER=all-first`）：`#1 all wall=18.615ms / #1 half wall=1.983ms`。
   **哪一组先采样，哪一组就贵一个量级**——那是首次 `dayClosed` 的 JIT/首次分配，
   与规模无关。`min-of-3` 本该把它剔掉，可并行时一轮 `setImmediate`/一次调度停顿
   就有 5~20ms，三次都撞上就把「最小值」抬到 10ms 以上。
2. **CPU 时间在这个环境里不可用（所以没有改口径）。** 在 Windows / Node 22.23
   实测 `process.cpuUsage()` 粒度约一个系统时钟 tick：忙等 5ms 读数是 `0µs`，
   忙等 2ms 读到 `31000µs`。用它对 0.5ms 的一天做判据只会得到 0 与 1 的抖动。
   同样，「把一天重复 20 次取总时长」（`tmp/stress/probe-cost2.ts`）会把 GC
   压进计时区，信号直接消失：`half 20.40ms / all 20.28ms`（每天约 1.0ms 对 1.0ms）。

**修复（只改度量方式与采样数，判据一个字没动）**：

- 绝对预算闸：`day1` 由**单次采样**改为**采 3 次取最小**（`minOfMilliseconds`）。
  `CEILING_MS = 50` 不变。理由：这条闸自称抓的是「量级退化」（传播改成每步全库扫描），
  单次墙钟采样抓的是「这一拍有没有被别的进程挤开」，两者差两个量级，只有前者是
  要守的东西。
- 「稳态不比第 1 天贵」：两边改用同一个估计量（各 3 次取最小），否则比的是
  「谁的样本撞上停顿」。
- 规模对照：`interleavedMinMilliseconds` 加**一轮不计时预热**、轮数 3 → 5。
  判据 `halfMs < allMs * 2` 不变。噪声只会把读数往上加，最小值是最接近「没有噪声
  时该花多少」的估计；5 轮把「三轮都撞上停顿」的概率从 1/3 级降到 1/5 级。

**改后读数**（探针 `tmp/stress/probe-cost3.ts`，预热 + 交错采样）：

```
N=3 pass(0.71/0.69=1.02)  N=5 pass(0.36/0.69=0.53)  N=7 pass(0.32/0.52=0.62)
N=3 pass(0.66/0.75=0.89)  N=5 pass(0.46/0.75=0.61)  N=7 pass(0.43/0.54=0.79)
N=3 pass(0.49/0.59=0.83)  N=5 pass(0.36/0.59=0.61)  N=7 pass(0.35/0.59=0.59)
```

即 half/all 稳定在 0.5~0.8（`N=3` 偶有 0.89~1.02，正是「三轮不够」的现场写照）；
`all/half` 的历史扫描值 2.04 也还在同一量级。

**闸没有变成摆设（反向验证）**：把 `half` 换成 400 个 holder（真的让小的更大），
同一估计量立刻红：

```
N=3 FAIL(2.29/0.71=3.24)  N=5 FAIL(2.29/0.71=3.24)
N=7 FAIL(2.15/0.54=4.01)  N=9 FAIL(2.15/0.54=4.01)
```

**改后频率**：

- 8 路并行 `--runs 64`：**0 / 64**（改前 3/64 绝对闸 + 规模断言另有 1/32）；
- 16 路并行 `--runs 64`：**0 / 64**。

**剩余风险**：`npm test` 默认每个测试文件一个子进程，墙钟类判据在**极重**负载下
仍可能被单次停顿推到阈值以上；本轮把噪声从「单次」改成「最小值」，但没有在
CI 固定基准机上跑。真要守 §3.2 B 的 10ms 预算，仍需要固定机器 + 单独基准。

---

### 3. `test/intent-async.test.ts`「接了模型之后，投递仍然同步返回，不等网络」

**现象**：四路并行验收 5 轮里第 3 轮红 1 次：`not ok 725`、
`error: '一拍不得等网络'`、位置 `intent-async.test.ts:89`（修复后的行号）、`duration_ms: 177.6`。

**复现命令**：

```bash
node tmp/stress/flake-repro.mjs --file world-client/test/intent-async.test.ts \
  --runs 32 --concurrency 8 --burn 16 --tag intent-burn16
```

**改前频率**：16 个纯忙等进程压满 CPU 时 **1 / 32 = 3.1%**，失败那次
`duration_ms: 372.66`；四路并行 5 轮里 1/5 轮红。8 路/16 路轻载下 0/32（复现不了）。

**机制**：这条拿 `Date.now() - started < 100` 判「一拍不等网络」。这个同步 tick
的真实耗时是几十微秒，读数是 177~372ms——**量的全是这一拍被操作系统挤开了多久**，
不是代码有没有 await 模型。而「不等网络」是结构性质：`tick`/`update` 是同步函数，
里面根本没有机会 await。墙钟判据既抓不到真回归（真 await 了会直接拿到 Promise
而不是超时），又会被负载打成假红。

**修复（判据换得更严，不是放宽）**：模型 promise 落地时把 `settled` 翻真；
`tick(sim)` 返回后断言 `settled === false`——即「tick 已经返回，而网络答复还没到」。
真等过网络的话它不可能是 false；毫秒阈值反而可能放过「等了 90ms」。

**改后频率**：同样 16 个忙等进程 × 32 次：**0 / 32**（`tmp/stress/intent-burn16-after`）。
