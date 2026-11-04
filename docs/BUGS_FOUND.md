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

## 长周期浸泡（feat/soak-30d）

测试分支：`feat/soak-30d`（worktree `D:\project\pwe-soak`，基线 `origin/main` `eab9e36`）。
夹具：`world-client/test/soak-support.ts`；跑数：`node scripts/soak-30d.ts`（30 天）、`node scripts/soak-retrospect.ts`（90 天回溯审计）；读数与曲线：`docs/evidence/soak/REPORT.md`。
`test/soak-30d.todo.test.ts` 现在**没有 `todo` 用例**（BUG-1 修完后已转正）。编号按本小节从 1 起，不与造物/交互混用。

状态：BUG-1 / BUG-3 / BUG-4 已修并翻正；BUG-2 改判为「场景边界 + 可达性测试」，不再是缺陷；BUG-5 的时间轴层**已修**（日摘要三档），事实原句层**部分修**（缺口仍在，见该条「剩下什么」）。

### BUG-1 纯日常世界的 30 日关系账本恒为 0

- **编号**：BUG-1
- **状态**：**已修**，`[SOAK-BUG-1]` 已从 `todo` 转正为普通断言。
- **改前读数**：30 天 ×2 种子，`relations.count = 0`、`incidents = 0`；街头互动 12 次/天（30 天 360 次）全是 `greet` / `yield` / `together`，没有一次 `street_tumble` / `street_water` / `street_help`，所以 `bondsOf()` 从第一天到第三十天都是空数组。
- **分布**：360 次街头互动 `street_greet` 234 / `street_yield` 4 / `street_together` 122，`importanceHint` **全部 0.38**，`≥ 0.4` 的 **0 次**——门槛 0.4 永远跨不过去。
- **选择 (b)，理由**：0.4 量的是「这件事重不重要」，不是「两个人熟不熟」。日常照面另走一条**按天结算**的通道：同一对一天见几次只积一次，familiarity 向 0.75 缓动、warmth 向 0.4 缓动并照常吃 15%/天衰减，trust 不动。这样既不会「聊一次就生死之交」，也不会「全员满格」。
- **改后读数**：30 天 **20 条有向账（10 对 × 双向）**，warmth 0.209–0.250（均值 0.237），familiarity 0.468–0.530（均值 0.495），`|trust|` 最大 **0**。第 1 天只有 16 条（8 对见过），第 30 天 10 对全部有账。
- **影响回填**：第 6 项读数「关系是越处越亲还是震荡」现在可读了——纯日常世界是「慢熟、不震荡」，30 天不会出现生死之交，也不会全员满格。

### BUG-2 记忆压缩层空转：摘要 / 晋升 / 归档全为 0

- **编号**：BUG-2
- **状态**：**改判为场景边界，不是缺陷**（选项 b）。原 `[SOAK-BUG-2]` 的 `todo` 已撤下，可达性由 `test/memory-archive-reach.test.ts` 证明。
- **读数**：30 天 `summaries = 0`、`promoted = 0`、`archived = 0`；日层条目实测显著度 **p50 = p90 = 0.495，p99 = max = 0.5029**（1156 条，分布表见 REPORT 第 1 节），`T_promote = 0.6` 在整条分布之上。
- **为什么不能降阈值**：实测「听来的」（`sourceMode = 'heard'`）条目显著度 **0.575**，「亲历且重要」（`importanceHint = 0.9`）的 **0.775**。降到 0.50 会把传闻也晋升，而 `makeSummary` 写死 `sourceMode: 'witnessed'`、`sourceChain: []`——来源链当场断裂，冲突检测（「听说的和我看见的不一样」）失去输入。0.60 正好卡在两档之间。
- **可达性证据**：`test/memory-archive-reach.test.ts`——每 7 天一件 `importanceHint = 0.95` 的亲历大事，跑 90 世界日，断言日摘要、周摘要、归档三者都非零，且归档的确实是 `long` 层摘要。实测读数：摘要 68 条（其中周摘要 60 条）、归档 30 条（全部是摘要）。
- **剩余风险**：0.575 与 0.60 只隔 0.025；一旦世界事件的可信度/重要性分布变化，要重看这张分布表。

### BUG-3 传说碑文（legend 层）没有预算上限

- **编号**：BUG-3
- **状态**：**已修**，`[SOAK-BUG-3]` 已翻正为普通测试。
- **改前读数**：8 天 95 条，30 天 **500 条 / 311.8 KB**，占全库条目字节的 86.6%；单个 holder 最多 85 条。
- **改法**：`budget.legend = 24` 条/持有者、`budget.bytes.legend = 16_000`；`limitFor()` 不再返回 `Infinity`。
- **改后读数**：30 天 **170 条 / 106.5 KB**；5 位居民 + 3 个地点 holder 全部正好卡在 24 条。条目层总字节从 311.8 KB 级降到 155 KB。
- **90 天预算读数（28 KB 上限，最终配置）**：seed A **120 / 120 条（100%）**、**23.4 KB / 28 KB（85.7%）**，淘汰 130 条；seed B **120 / 120（100%）**、**21.7 KB（79.5%）**，淘汰 69 条。条数侧先卡住，字节侧留有余量。
- **排序修正**：原来 `legends` 同 `reach` 时按 `formedDay` **倒序**（留最新），90 天存活传说最早只到**第 56 天**——世界最早那批碑文先被扔掉，「岁月感」就是从这儿漏的。改成同 `reach` 按 `formedDay` **升序**（留更早）后，存活最早回到**第 4 天**；代价是 reach 为 0 的新传说先被裁，而 reach 0 意味着还没人传它。


### BUG-4 存档随事件线性膨胀，30 天撞上导入上限

- **编号**：BUG-4
- **状态**：**已修**，`[SOAK-BUG-4]` 翻正为「每个库都必须落在预算内」的回归测试。
- **改前读数**：存档 76.5 KB（第 1 天）→ **1687.5 KB**（第 30 天），日均 **+55.6 KB**；直线外推 **第 31.5 天**撞 `src/ui/save-store.ts:88` 的 `IMPORT_MAX_BYTES = 2 MB`。`facts` / `claims` / `written` / `beliefs` / `cooldowns` / `tells` 六库无任何预算。
- **改法**：给六个库加条数 + 字节双预算（`config.ts` 的 `libraryBudget`），每层按自己的价值轴淘汰；新增 `memory.pruned` 事件留痕（层 / 条数 / 字节 / 原因 / 剩余）；修正 `memory.archived` 每天重发全部已归档条目的累计口径。
- **改后读数**：30 天 **1374.8 KB**（−312.7 KB，−18.5%；比关系账本上线前多 5.7 KB）；**90 天 seed A 1625.5 KB = 2 MB 的 79.4%**、**seed B 1572.5 KB = 76.8%**，都未撞上限。第 60→90 天 seed A +2.93 KB/天、seed B +1.75 KB/天，改前是 +55.6 KB/天。2 MB 上限没有动，也没有用二进制压缩。
- **facts / 世界事件比**：第 30 天 898 / 898 = 1.000；第 90 天 920 / 2693 = **0.342**。
- **关于 1.7 KB/角色年**：这个基线仍然被打破（90 天存量口径约 1209 KB/角色年）。原因是**吞吐**——这个世界每天约 30 件事，而旧基线按的是稀疏世界；它不是本轮能达到的目标，本轮达到的是「增长有界」。别把这两件事混成一个数字。

### BUG-5 回溯到早期日期时居民时间轴几乎空白（时间轴已修 / 事实部分修）

- **编号**：BUG-5
- **状态**：**已修（时间轴层）/ 部分修（事实原句层）**。改成「旧日压缩成日摘要、逐日降浓度」；没有调 `T_promote=0.60`，也没有动归档/摘要的触发阈值。
- **改前读数（seed A 90 天，分母是当天应有条数）**：

| 回溯到 | 当日世界事件 | 事实可读 / 应读 | 事实缺失 | 时间轴可读 / 当天末 | 时间轴缺失 | 事件可追溯 / 应读 | 事件缺失 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 第 20 天 | 30 | 12 / 30 | 60.0% | 0 / 59 | 100.0% | 12 / 30 | 60.0% |
| 第 45 天 | 30 | 12 / 30 | 60.0% | 1 / 61 | 98.4% | 12 / 30 | 60.0% |
| 第 60 天 | 30 | 12 / 30 | 60.0% | 2 / 57 | 96.5% | 12 / 30 | 60.0% |
| 第 89 天 | 30 | 12 / 30 | 60.0% | 47 / 59 | 20.3% | 12 / 30 | 60.0% |

- **改前实际保留窗**：时间轴只有最近约 6 天（第 84 天 17/55、第 86 天 16/51、第 88 天 35/60、第 89 天 47/59），再往前掉到个位数。原因是日层条目过归档期后被 `day` 桶预算裁掉，而 `T_promote=0.60` 在日常场景不晋升、`summaries=0`，没有摘要层接住它们。
- **改法**：世界级日摘要 [`digest.ts`](../world-client/src/world/memory/digest.ts)，每天一条，三档浓度——
  1. **近档（0–6 天）**：逐条时间轴，现状不动；
  2. **中档（7–30 天）**：`DayDigest` 固定字段 `people` / `firstEvent` / `lastEvent` / `places` / `flags`（`quiet`/`social`/`work`/`dispute`/`anomaly`/`major`/`other`）/ `events`（事件 id + kind 枚举）/ `beats`（谁记下哪一拍），异常原句 ≤3 条，无散文；
  3. **远档（>30 天）**：清空 `places` 与 `anomalies`、事件地点下标置 `-1`，保留 `people` / 首末拍 / `flags` / `events`(id+kind) / `beats`，作为「那天有没有事、大致发生了什么」的指针层。
  上限：每天 ≤1 条 digest + ≤3 条异常原句；`libraryBudget.digests = 120 条 / 160 KB`。
- **改后读数（同脚本、同口径、最终 28 KB legend 配置）**：

| 回溯到 | 事实可读 / 应读 | 事实缺失 | 时间轴可读 / 当天末 | 时间轴缺失 | 事件可追溯 / 应读 | 事件缺失 |
| --- | --- | --- | --- | --- | --- | --- |
| 第 20 天 | 12 / 30 | 60.0% | 59 / 59 | **0.0%** | 20 / 30 | 33.3% |
| 第 45 天 | 12 / 30 | 60.0% | 61 / 61 | **0.0%** | 20 / 30 | 33.3% |
| 第 60 天 | 12 / 30 | 60.0% | 57 / 57 | **0.0%** | 20 / 30 | 33.3% |
| 第 89 天 | 12 / 30 | 60.0% | 59 / 59 | **0.0%** | 20 / 30 | 33.3% |

  seed B 同形：四天时间轴缺失均 0.0%（49/49、39/39、42/42、47/47），事实缺失均 60.0%。第 45 天 <10% 的目标达成；第 89 天不再需要「浓度递减」豁免。
- **预算代价**：90 天末存档 seed A 1621.3 → **1625.5 KB**（79.4%）、seed B 1570.0 → **1572.5 KB**（76.8%）；第 60→90 天日增 A 2.88 → **2.93 KB/天**、B 1.75 → **1.75 KB/天**。日摘要 A 116.9 KB / 160 KB（74.8%）、B 112.5 KB（72.0%），90 条 / 112 条。都未撞 1800 KB / 3 KB 的线，2 MB 上限没动，也没用二进制压缩。
- **剩下什么（部分修的那部分）**：事实原句仍缺 60%——日摘要存的是「那天怎么过的」，不是「每件事实的原句」。远档只留 id 指针与枚举：**玩家翻回第 20 天，能知道「5 个人、从晨市到黄昏、出过一次争执、去过磨坊与井边」，但不知道那句原话、具体时刻、争执的具体内容**。面板对补回的行写「时刻不明」，`what=null`。
- **淘汰事实是否永久消失（口径已修）**：旧脚本的引用索引只收「对象属性值是字符串」的引用，`eventRefs: ['soak-1']` 与摘要 `events` 里的数组 id 全被漏掉。修索引后实测 seed A 1773 条被淘汰事实里 **873 条（49.2%）** 仍能在存活条目 / 传说 / 日摘要找到指针（其中 **403 条仅摘要指针**）；seed B **872 条**（仅摘要 374）。结论修正为：**原文永久消失，指针多数找得回**。

### 已补覆盖：「被裁掉的事实写时刻不明」

- 改前 30 天 `trimmedTimelineEntries = 0`、`unknownPlaceEntries = 0`，这条口径一次也没被触发——不能拿 0 当绿。
- 现在 `dayTimelineFor` 给每一格 `whenKnown`：事实被预算裁掉、或这一格是摘要（`when` 是日号）时为 `false`；`unit-status` 把它渲染成 **`clock: '时刻不明'`**，不再用 `clockOf(day)` 编出一个 00:00。
- 样本：`test/memory-budget.test.ts`（裁掉 `ev_low` 后 `whenKnown=false`、`what=null`、`placeId=null`，`ev_high` 仍为 `true`）；`test/unit-status.test.ts`（渲染出 `时刻不明`）。
- 真跑样本：第 90 天事实库裁掉 1773 条后，面板上有 **8 格** `unknownWhenEntries`（第 30 天是 0，因为时间线只覆盖昨天、昨天的条目所指事实还在）。所以这条不只是测试断言。

### 确定性基线随淘汰顺序重录（不是放宽断言）

- **改动**：淘汰比较器补上用户要求的后两级，最终为 `固定/闪光灯 → 强度 → 显著度 → 新 → memoryId`。
- **为什么轨迹会变**：这只在「日层溢出、且强度打平」时改变保留集合；一旦保留集合变了，后面的整理与造物读数就跟着变。`traces/outer-two-days.json` 的记忆指纹从 `803a26d4…` 变为 `59db174d…`；**世界指纹 `32ba01e7…` 与 52 条事件完全不变**，说明变化只在记忆/造物层。
- **怎么处理**：用仓库自带的两步流程重录——`node scripts/trace-record.ts`（再录 3 条轨迹与基线存档）+ `node scripts/trace-to-test.ts`（重生成回归用例）。生成的用例仍断言**精确指纹与条数**，没有改成「只要求不报错」之类的弱断言；回放结论 `replayable`，三枚指纹三次运行逐字相同。

### 已修：`tideLevelAt` 随世界时间线性变慢（提交在本分支）

- 见 `docs/evidence/soak/REPORT.md` 第 2 节与 `test/tide-checkpoint.test.ts`：`stepTide` p50 0.3 µs → 17.9 µs（60×），30 日整轮 73.6 s → 50.3 s；曲线逐点与原实现一致。
