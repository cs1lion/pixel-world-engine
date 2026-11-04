# 动画表现力线 · PROGRESS

分支：`feat/animation-express`（worktree `D:\project\pwe-anim`，从 `main` 的 `ab9ac9d` 起）
日期：2026-11-04
纪律：动画只在渲染层；世界 / 记忆 / 造物三枚 sha256、事件数、`building.*` 计数、记忆读数一律不动；禁用 `Date.now` / `performance.now` / `Math.random`；相位全部由世界拍（1 拍 = 1/12 秒）驱动。

读数基线见 [BASELINE.md](BASELINE.md)。

---

## 第一步：关键姿势 + hold + 预备 / 收招 / 缓冲

### 改了什么

- 新增 `world-client/src/render/villager-frames.ts` 的调度段：`MOTION_SEQUENCES`、`MotionTracker`、`villagerMotionPose`。**帧集一格没加**，只改「什么时候用哪一帧」。
- 走路：预备 `[2,2]` → 循环 `[0,0,1,2,3]`（0 号是关键姿势，停 2 拍）→ 收步 `[3,2]`。
- 干活：预备 `[0,0]` → 循环 `[1,1,0]`（1 号是关键姿势，停 2 拍）→ 收工 `[0,1]`。
- 待机：`[0,1]` 呼吸，不加起势。
- `world-client/src/render/villager.ts`：`VillagerView.motion` 每村民一个播放器，`updateVillager` 改走 `villagerMotionPose`。

### 帧序列 diff

逐拍快照：`docs/evidence/animation-express/frames-before-after.txt`。
- `before` 列来自改造前就存在的 `animFrame(now, frameCount)`（该函数本次保持原样，因此它就是旧行为）；`after` 列来自新调度。
- 24 拍循环段：走路旧 `0,1,2,3,0,1,2,3…` → 新 `0,0,1,2,3,0,0,1…`；干活旧 `0,1,0,1…` → 新 `1,1,0,1,1,0…`。
- hold 占比：walk `5/24`，work `8/24`，都 > 0。
- 关键姿势保持时长可枚举：walk frame 0 / 2 拍；work frame 1 / 2 拍。
- 脚本化过渡段（待机 8 → 走 24 → 待机 8 → 干活 12 → 待机 8）逐拍打印在同一个文件 `# scripted` 段：第 8、9 拍是走路预备 `2,2`；第 32、33 拍是收步 `3,2`；第 46、47 拍是收工 `0,1`。

### 像素差统计（24×30，每拍累加，24 拍）

- 旧/新「帧集像素」差：walk `881`，work `0`。
  - work 的 0 是**真的 0**：干活两帧在帧集里只有 `offsetY` 起落，没有逐格差异。为了避免拿这个 0 当结论，下面再给渲染层读数。
- 渲染层像素差（把整套矩形按姿态 `offsetY` 落到 24×30 网格）：walk `2974`，work `2115`。这一列才是屏幕上会变的像素。

### 指令增量

见「闸门与读数」一节的 `check-render-budget`；本轮计分轮 `15514` 指令 / `28` 个 Graphics，基线计分轮 `16162` / `28`，增量 `-648`（`-4.0%`），在 `< 5%` 内。差值来自世界相位不同（两次采样不在同一世界时刻），不是新增/删除结构。

### 做到 / 没做到 / 未验证

- 做到：两套动作的预备/关键姿势 hold/收招；同种子两跑逐字相同（`test/anim-express.test.ts`）；冻结拍重复采样 0 差异；三枚指纹不变（见下）。
- 没做到：走动中「脚底沿地面摩擦」的读感仍依赖 1px 起落，没有真正的贴地修正；没有新增任何帧。
- 未验证：真实浏览器里 12fps 拍长与显示刷新率的观感（只验证了像素与序列，没有做人眼主观评分）。

---

## 第二步：过渡与打断回位状态机

### 改了什么

- 新增 `world-client/src/render/villager-transition.ts`：`VillagerTransition`。
  - 转身：固定 `TURN_BEATS = 2` 拍。第 0 拍仍是旧朝向 + 朝新方向 1px 让位，第 1 拍落到新朝向。
  - 进出场：固定 `DOOR_BEATS = 3` 拍，alpha `1 → 0.5 → 0`（离场）/ `0 → 0.5 → 1`（进场）。
  - 验收开关：`setAnimationTransitions(false)` 立即落终态；`window.Oracle.setAnimationTransitions(on)` 暴露给浏览器验收。
- `villager-frames.ts` 的 `MotionTracker` 增加打断回位：只有「干活」算被任务打断；记下打断时的循环拍，回来时跳过预备直接续上；保鲜期 `MOTION_INTERRUPT_RESUME_BEATS = 48` 拍（4 秒），超时按重新开工。
- `SandboxScene` 增加 `animationState()` 调试口：每村民的 `frame / kind / hold / keyPose / visible / alpha / beat`。

### 验收读数

- 转身时长：`2` 拍，误差 `0` 帧（`test/anim-express-transition.test.ts` 断言 exact）。
- 进出时长：`3` 拍，误差 `0` 帧。
- 打断 5 次（循环拍 3/5/2/7/4）：落点与计划帧一致率 `5/5 = 100%`。
- 关闭过渡：转身/进出立即落终态；同一世界拍重复采样逐字段相同（冻结帧 0 差异）。
- 指令增量：`VillagerTransition` 只读姿态，不新增绘制对象。

### 做到 / 没做到 / 未验证

- 做到：转身、进出场淡入淡出、干活被打断后回原拍。
- **没做到：上下楼没有做。** 世界快照里没有楼层/楼梯字段（`world-client/src/world` 下 grep `floor|stairs|level|upstairs` 零命中）。没有输入源就不拿代理几何顶替。
- 没做到：进出场没有「走到门口再消失」的位移段。世界只在 `visible` 上翻转，没有门坐标；本轮用 3 拍淡入淡出遮住位置跳变，不假称有门口路径。
- 未验证：多村民同拍打断时的视觉拥挤度（只验证了状态机落点）。

---

## 第三步：上下半身分层 + 表情覆盖层

### 改了什么

- `villager-layout.ts` 新增 `villagerLayeredLayout`：画序 = 外套（上身姿态）→ 腿（下身姿态）→ 头/围巾/配饰/手持物（上身姿态）。两套姿态相同时与整帧版**逐项相同**。
- `villager.ts`：`VillagerView.upper` 是上半身独立播放器；走路时腿走 5 拍循环（`[0,0,1,2,3]`），上身走待机 2 拍循环（`[0,1]`）。
- 新增 `villager-face.ts`：`emotionOf`（只从 `mode` / `bubble` 推）、`expressionRects`（眉眼口各 1–2px）。
- `VillagerView.face` 是独立 Graphics，画在身体之上；情绪 id 换 cell 时身体 Graphics 逐矩形不变。

### 判据与读数

- 「只换脸时身体区域 sha256 必须不变」：`test/anim-express-layers.test.ts` 把身体矩形栅格化，再把脸框内的格子抠掉后做 sha256；`calm` 与 `joy` 的脸框外哈希相同，整图哈希不同（脸确实变了）。
- 分层等价：7 个外观 × 4 个朝向 × 2 个姿态 × 走/站 = 112 组，`cloth + legs + detail` 与整帧版 `deepEqual`，全部通过。
- 表情 cell：所有 cell `w ≤ 2 && h ≤ 2`，且都夹在 `faceBox` 内。
- 情绪映射：`working → focus`、`delivering → joy`、`bearingDecree → worry`、`bubble != null → joy`、其余 `calm`。

### 做到 / 没做到 / 未验证

- 做到：上下半身各自播序列（走路时帧序列逐拍可查）；眉眼口覆盖层；身体区域 sha256 不变。
- **没做到：没有独立的头部朝向。** 「边干边看」只做到「手上的活与上身的呼吸各自播」+ `focus` 的眉眼 cell；世界快照只有一个 `facing`，本轮不新增字段去造一个第二朝向。
- 没做到：说话没有独立的字/口型帧集，只有嘴 cell 每两拍开合；不新增素材是第一步的硬约束，这里沿用。
- 未验证：表情在 400% 缩放下的可读性（已验像素位置，未做人眼评分）。

---

## 闸门与读数

九道闸门（前端 8 条 + 服务端 pytest）逐条在 `D:\project\pwe-anim` 的 `feat/animation-express` 上跑过：

| # | 闸门 | 命令 | 结果 |
|---|------|------|------|
| 1 | 类型/语义 | `npm run check` | `语法 0 处 / 语义 0 处` |
| 2 | 单元测试 | `npm test` | `2311 tests / 2302 pass / 0 fail / 9 skipped` |
| 3 | 构建 | `npm run build` | `182 modules transformed`，`built in 781ms` |
| 4 | 调色板 | `node scripts/audit-palette.mjs --strict` | 世界 `24` / UI `8` / 并集 `31`，越界 `0` |
| 5 | 行号引用 | `node scripts/audit-references.ts --strict` | 查 `161` 处，存疑 `0` |
| 6 | 文件引用 | `node scripts/audit-citations.ts --strict` | 受查 `2666` 处，未解析 `0` |
| 7 | 节号 | `node scripts/audit-sections.ts --strict` | 受查 `158` 处，全部对得上 |
| 8 | 标注断言 | `node scripts/audit-claims.ts --strict` | `markers=5 passed=5 failed=0`；`adr-schema 10/10` |
| 9 | 服务端 | `python -m pytest` | `544 passed, 1 skipped` |

浏览器三道 CI 闸门：`test:persistence` 8/8、`test:render-budget` 6/6（计分轮 `16162` 指令 / `28` Graphics，峰值 `19145` < `30000`）、`test:phases` 17/17。

三枚指纹（`--steps=200`，两跑）：world `50b442c7…ee69`、memory `9cf70a72…ed19`、creator `2f6dfee9…4ad1`，`identical=true`；与本目录 `BASELINE.md` 的改造前读数逐字相同。

`test:buttons`：**跑完了，但不算全绿，如实记在这里**。用隔离后端（`PIXEL_WORLD_EVENT_DB=tmp/buttons-events.db`、`PIXEL_WORLD_MEMORY_DIR=tmp/buttons-memory`、前端 `5262` 代理到 `8016`）往镇志写了 3 条记忆后，审到 `58` 个按钮、`0` 个「一句话都不说」；`2` 处「点不动」都是同一个 `#clock-align-check`（两张图各一次）。原因是 `src/ui/clock-align.ts:66-79` 只在 `available` 时解除 `disabled`，而 `available` 仅在 `?clock=real` 下为真；审计跑的是默认时钟模式，按钮按设计是灰的，Playwright 等它可点自然超时。这是审计自身的判据缺口（把 disabled 按钮也算作可点），与本次动画改动无关，改动画也没碰这条；不把它改成绿，按「不许把变化说成回归」的相反方向同样处理：不把既有缺陷说成通过。

## 截断点与截图基线

162 张验收图的具体变更清单见同目录 `SCREENSHOT_BASELINE_CHANGES.md`（逐张「旧基线 / 新基线 / 为什么变 / 对应提交」）。本文件只记汇总。

---

## 被否掉的写法及原因

1. **用 `performance.now` / `Date.now` 驱动相位**：会破坏「同种子两跑逐字相同」，也会让冻结帧截图抖动。全改世界拍。
2. **新增走路/干活帧**：第一步的边界是「不新增素材」，否掉。
3. **用 CSS/DOM 做表情**：表情必须随镜头缩放与画布像素网格走，DOM 会错位；且「身体区域 sha256」无法在画布层判定。否掉。
4. **把上半身也按走路帧画**：这样上下半身仍在同一条序列上，「各自播」不可验证。否掉。
5. **打断回位用「重播预备」**：落点会晚 2 拍，达不到「回原拍」。改为记循环拍直接续上。
6. **给上下楼造代理几何**：世界没有楼层字段，造出来就是假证据。否掉，并在上面明写「没做到」。
