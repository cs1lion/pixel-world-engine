# 可验证流程总表（2026-11-04 至 2026-11-06）

本文把这几天各条 worker 线产出的东西逐项转成「可复制执行、有数值判据、有反向用例、有产物落点」的流程。

## 0. 规范依据与盘点边界

- 本机存在 `poteto-mode`，来源 `backnotprop/pstack@poteto-mode`，安装命令 `npx skills add backnotprop/pstack@poteto-mode -g -y`，装到 `C:\Users\18712\.agents\skills\poteto-mode`，并已通过 `C:\Users\18712\.trae-cn\skills\poteto-mode` 的 Junction 对 Trae 可见。
- 本文采用的规范文件是 poteto-mode 安装目录下的 SKILL.md（本机路径 C:\Users\18712\.agents\skills\poteto-mode\SKILL.md）的 `## Principles` 与 `## Playbooks`（Investigation），以及本地 pstack 叶技能 `principle-build-the-lever`、`principle-prove-it-works`、`principle-sequence-verifiable-units`、`principle-explain-the-number`、`principle-encode-lessons-in-structure`。
- 盘点阶段按 Investigation 的只读口径执行：只新增文档与脚本，不改任何既有判据的数值、不放宽阈值、不删用例；不 `stash`、不动别人的工作树。入库（合 main 与 push）由用户在本轮单独授权，动作记录见第 7 节。
- 证据标签：`[实测]` 本次实际运行；`[证据]` 读自已归档的证据文件；`[文档]` 只有书面记录、无执行判据。
- 端口纪律：**5188 / 5191 / 5202 / 5203 一律不用**。下面所有浏览器命令都显式改到 `5211`，因为 `smoke.mjs:27`、四个抓拍脚本 `:30/:26/:28/:24`、`check-render-budget.mjs:22` 的默认端口分别落在 5188 和 5202，必须用 `PIXEL_WORLD_URL` 覆盖。

## 1. 总表

| # | 流程 | 触发命令（摘要） | 判据（摘要） | 反向用例 | 产物 | 现状 | 本次执行 | 入汇总 |
|---|---|---|---|---|---|---|---|---|
| 1 | 钉子契约 | `node --import ./test/phaser-hooks.mjs --test test/pin-shot-state.test.ts`；浏览器 `check-shot-actor-pin.mjs` | 三档 1200/2800/5000 精确 0.0000%、可见 0.0000%、结构块 0；未登记渲染字段为空 | `five-shift` 2.6396%、`trail-shift` 0.0104% 必须判红 | `EVAL_OUT/*.png`、`runs.json` | 单测可跑；浏览器需 5211 | 已执行（离线单测）；浏览器半边未执行 | 单测已入 |
| 2 | 三层结构差 | `python scripts/screens-diff.py --old ... --new ... --out ... --structure-spec ...` | 精确差任通道 >0；可见差 RGB ≥8；结构块面积落在 `[minArea,maxArea]` | `verify-screens-diff-selfcheck.py` 5 例，含 2900 与差 7 级必红 | `screens-diff.json`、`masks/*.png` | 自检已跑通；真图需两跑目录 | 已执行 | 已入 |
| 3 | 相位帧弱判据 | `node scripts/check-phase-frames.mjs --ref ... --cur ...` / `npm run verify:phase` | 区外差 0 px；区内面积 ≤ `ceil(union*1.4)`；块数 ≤ `ceil(union*1.5)` | `--self-test` 平移出区、面积 ×1.5 必红 | stdout（无文件） | 仅 pwe-anim，需 Chromium | **未执行**（汇总 SKIP）：主仓无脚本、无 verify:phase、无 phase-regions.json（该文件只在 pwe-anim 分支上）；前置 = pwe-anim 工作树 + Chromium + r1/r2 截图 | 主仓 SKIP |
| 4 | 抓拍夹具与账本 | 四个 `check-*.mjs` + `EVAL_OUT`；`verify:reset`、`verify:compare` | 抓拍脚本只测量不判红；ledger 比对逐像素 sha 全等、尺寸相同 | 改一张 PNG 即 `pixel-diff`，`compare` 退出 1 | `*-pixel-ledger.json` | 需浏览器 + 服务；ledger 仅在 `pwe-anim` | **未执行**：需浏览器 + 5211 本地服务；前置 = 起停 harness + `pixel-ledger`/`compare-ledger` 合入 main | 未入 |
| 5 | render-budget 双条件 | `node --import ./test/phaser-hooks.mjs --test test/render-budget-throttle.test.ts`；浏览器 `check-render-budget.mjs` | 指令 <30000、Graphics <40、拖动 ≥0.9 静止、后台 <前台且 ≤1/3 或 ≤12、恢复 ≥0.5 前台 | 单测 `(60,58)`、`(60,21)`、`(37,12.5)`、`NaN` 必红 | `render-budget-samples.json`（有 `EVAL_OUT` 时） | 单测可跑；浏览器需服务 | 已执行（离线单测）；浏览器六项未执行 | 单测已入 |
| 6 | 入口配色 9 色位 | `node scripts/audit-palette.mjs --strict` + `test/palette-budget.test.ts` | 世界 ≤24、UI ≤9、并集 ≤32、共享恰为 `#e3a13c`；边框对比 3.49/3.15 ≥3.0 | 值层测试换值必红；加第 10 个 UI hex 时 `--strict` 退出 1 | `palette-9/*.txt` | 离线可跑 | 已执行（离线）；**第 10 色红例未执行**：需临时给 `index.html` 加第 10 个 UI hex | 已入 |
| 7 | 疲劳与睡眠 | `node --import ./test/phaser-hooks.mjs --test test/fatigue.test.ts test/homecoming.test.ts` | 0.5/天、睡 4/天、阈 0.8、跨阈 1.6 天、睡段 0.2 天；默认两天 0 次、强制场景 1 次 | 强制跨阈场景必触发 1 次，默认世界必须 0 | 无 | 离线可跑 | 已执行 | 已入 |
| 8 | 行为/环境/需求 | 六个 `test/*.test.ts` | 规则注册表、环境标志闭集、`delivery_failed` 载荷、旁观分桶 | 交换规则顺序结果变、饥饿到顶必失败、室内只同屋记得 | 无 | 离线可跑；`test:buttons` 404 | 已执行 | 已入 |
| 9 | 账本与旁证 | `node scripts/eval-ledger.ts`、`verify-ledger-selfcheck.ts`、`memory-witnessed-corroboration.test.ts` | 12 必填字段；`script_sha` 不符即红；外部来源必须钉输入；旁证 `violations===0` | 自检 1 绿 + 6 红 | `eval/ledger.json`、`witnessed-corroboration.json` | 离线可跑 | 已执行 | 已入 |
| 10 | 动画基线账本 | `node scripts/verify-animation-baseline.mjs` | 157 行、六类 73/29/28/18/2/7、12 位哈希、7 位提交 | `--self-test` 删行/坏哈希/改归类必红 | stdout | 文档在 `pwe-anim`；新增结构校验 | 已执行 | 已入 |

执行状态口径：`已执行` = 本次实际跑过且退出 0；`未执行` = 本次没有跑，哪怕同一流程在汇总入口里记 SKIP 也不算通过；`浏览器半边未执行` = 一条流程里只有离线半边跑了，浏览器部分登记在第 4 节。

**未执行清单（3 项，均不计入通过）**

1. **流程 3 相位帧真跑**。原因：主仓没有 check-phase-frames.mjs、没有 verify:phase、没有 phase-regions.json（三者在 pwe-anim 分支上才有），汇总入口因此记 SKIP。前置：切到 D:\project\pwe-anim（`feat/animation-express`），备好 `tmp/anim-verify/r1|r2` 两跑截图，并安装 Chromium/Playwright。
2. **流程 4 抓拍与账本比对**。原因：四支抓拍要浏览器 + 5211 本地服务，账本工具只在 pwe-anim 分支上。前置：一个能自动起停 dev server 的 harness；把 pixel-ledger.mjs 与 compare-ledger.mjs（当前 main 上不存在，只在 pwe-anim 分支上）合进 main。
3. **流程 6 的 `--strict` 第 10 色红例**。原因：构造红样要临时给 `index.html` 加第 10 个 UI hex，本次只读约束下没有改文件。前置：在一次性 worktree 里改样、跑 `--strict`、确认退出 1 后丢弃该改动。

## 2. 每条流程

### 流程 1：钉子契约

**触发命令**

```powershell
# 离线：23 条守卫单测
cd D:\project\pixel-world-engine\world-client
node --import ./test/phaser-hooks.mjs --test test/pin-shot-state.test.ts

# 浏览器：先起 5211，再拍六图 + 两次偏移对照
node node_modules/vite/bin/vite.js --port 5211 --strictPort
cd D:\project\pixel-world-engine\world-client
$env:PIXEL_WORLD_URL='http://127.0.0.1:5211/'
$env:EVAL_OUT='tmp/actor-pin'
node scripts/check-shot-actor-pin.mjs
```

**输入**：`pinShotState` / `pinActors` / `pinTrails` / `unpinShotState`（`world-client/src/render/pin-shot-state.ts`）；渲染输入登记表 `docs/evidence/pin-shots/04-RENDER-INPUT-TABLE.md`；抓拍夹具 `check-shot-actor-pin.mjs`。钉住的画面是 07:34、潮位 0、相机锚 (52,32)×16 px、收尾静置 2600 ms；角色 v0 `(52,32) down idle frame0`、v1 `(48,36) up idle frame1`，痕迹 `(49,36) strength 2`。

**判据**：三档等待 1200/2800/5000 的精确差 0.0000%、可见差 0.0000%、结构块 0（`04-RENDER-INPUT-TABLE.md:94-108`，`[证据]`）；`five-2800`/`five-5000` 必须与 `five-1200` 逐字节相同，`five-shift`/`trail-shift` 必须不同（`check-shot-actor-pin.mjs:243-253`）。逻辑守卫 `unregisteredRenderFields(snapshot)` 与 `missingRenderFields(snapshot)` 必须为空，pin 字段集合恰为 `['now','tide','trails','villagers']`，25 个快照键 = 4 pin + 10 stable + 11 dom，11 个 dom 字段在绘制路径 0 命中（`test/pin-shot-state.test.ts:403-479`）。`[实测]` 本次单测通过。

**反向用例**：`five-shift` 把 v0 `pos.x` +1 格，读数精确 2.6396%、可见 2.4920%、最大块 14704 px（148×124）；`trail-shift` 把痕迹从 `(49,36)` 移到 `(48,36)`，精确=可见 0.0104%（64 px，8×8）。两条都在原阈值下判红，不需要改阈值。

**产物落点**：`<EVAL_OUT>/<name>.png` 六张与 `<EVAL_OUT>/runs.json`；归档在 `docs/evidence/pin-shots/actor-pin/<组>/screens-diff.json` 与 `masks/`。

**现状**：离线单测可直接跑。浏览器夹具需要 5211 的 dev server；`world-client/eval/screens/actor-pin` 当前为空，六图与 `runs.json` 未落盘，要重跑生成。文档有一处矛盾：`03-ACTOR-PIN.md:11-12` 记五钉 1200 vs 2800 = 0.0104%，`04-RENDER-INPUT-TABLE.md:106` 记 0；以 `04`（第六钉加入后）为准。

### 流程 2：三层结构差

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
python scripts/screens-diff.py --old <旧图目录> --new <新图目录> --out <输出目录> --structure-spec docs/evidence/pin-shots/structure-spec.json

# 判据自检（不需要浏览器，5 例）
python scripts/verify-screens-diff-selfcheck.py

# 生成物默认落在 world-client/tmp（gitignore）；要写到仓外就设 VERIFY_FLOWS_OUT
$env:VERIFY_FLOWS_OUT='D:\project\pwe-verify-out\screens-diff'
python scripts/verify-screens-diff-selfcheck.py
```

**输入**：旧/新两跑的同名 PNG；`docs/evidence/pin-shots/structure-spec.json` 里 smoke 类 `02/03` 为 3000–5200、rain 类 `04` 为 38–85、`05` 为 60–160；自检脚本自己合成 200×200 PNG。

**判据**：精确差 = 任一 RGBA 通道 ≠0（`screens-diff.py:259-260`）；可见差 = RGB 任一通道 ≥8（`:261`）；结构差 = 可见掩膜 8 邻接连通块，最大块面积落在 `[minArea,maxArea]`（`:184-222`）。不满足结构断言时 `SystemExit(1)`（`:374-376`）。没有块数上限，也没有最小块尺寸；区域清单另有 `min_area=16` 且只保留前 25 条。

**反向用例**：`docs/evidence/pin-shots/reverse-structure-check.py` 四例：真实 02 两跑、真实 04 两跑、合成「烟柱 2900 px」、合成「雨丝全无」；`2900` 与 `0` 都必须判红。新增的 `verify-screens-diff-selfcheck.py` 把这条链变成可重跑脚本，`[实测]` 5/5：`pass-3000` 绿、`fail-2900` 红、差 7 级红（可见掩膜 0）、差 8 级绿、同图两跑红。

**产物落点**：`<out>/screens-diff.json`（含 `structureFailures` 与逐文件 `records`）和 `<out>/masks/<stem>-exact.png`、`<stem>-visible.png`；自检产物在 `world-client/tmp/verify-flows/screens-diff/`。

**现状**：脚本与 spec 齐备，Python 依赖（numpy/PIL）在。真图需要两跑截图目录；主仓没有 `pin-d/run1..3`，`pwe-anim` 的 `tmp/anim-verify/r1|r2|r3` 有 18 张可代用。自检不需要真图。

### 流程 3：相位帧弱判据

**触发命令**

```powershell
cd D:\project\pwe-anim\world-client
npm run verify:phase -- --ref ../tmp/anim-verify/r1/screens --cur ../tmp/anim-verify/r2/screens
# 反向自检
node scripts/check-phase-frames.mjs --self-test --ref ../tmp/anim-verify/r1/screens --cur ../tmp/anim-verify/r2/screens
```

**输入**：pwe-anim 分支上的 scripts/lib/phase-regions.json（当前 main 上不存在；schema:1、outsidePixels:0、margin.area:1.4、margin.components:1.5，18 张图的 bbox 与 observed.unionPixels/unionComponents）；同分支的 PHASE_FRAME_CRITERIA.md；两跑截图目录。

**判据**：区外差异像素必须为 0（RGBA 逐像素、容差 0）；区内面积 ≤ `ceil(unionPixels × 1.4)`；区内连通块 ≤ `ceil(unionComponents × 1.5)`；尺寸不一致直接 FAIL。例：`01-salute.png` 观测 24663 px/9 块，本次允许 34529 px/14 块；`06` 为 2173 px/9 块；`ground-shadow-*` 为 174/2 或 168/2。`[证据]` PHASE_FRAME_CRITERIA.md 第 54-73 行（pwe-anim 分支）。

**反向用例**：`--self-test` 把真实差区平移到画面底部，期望区外 >0；再把面积沿四邻域生长到 `ceil(union × 1.5)`，期望超上限。两条都必须红，否则脚本退出 1。`[证据]` 已记录实测。

**产物落点**：只有 stdout 的 `ok/FAIL/missing` 与总计，**没有 JSON、没有掩膜**。这是本条流程的证据缺口。

**现状**：只存在于 D:\project\pwe-anim（`feat/animation-express`），主仓没有脚本、没有 verify:phase、没有 phase-regions.json（后两者在 pwe-anim 分支上）。需要 Chromium/Playwright；r1/r2/r3 三套 18 张齐备，今天可跑。主仓 `verify-all.mjs` 显式 SKIP。

### 流程 4：抓拍夹具与账本

**触发命令**

```powershell
# 起服务，端口必须避开 5188/5191/5202/5203
cd D:\project\pixel-world-engine\world-client
npm run dev -- --port 5211

# 四支抓拍，各自独立 EVAL_OUT
cd D:\project\pixel-world-engine\world-client
$env:PIXEL_WORLD_URL='http://127.0.0.1:5211/'
$env:EVAL_OUT='tmp/capture/run1'
node scripts/check-scene-motion.mjs
$env:EVAL_OUT='tmp/capture/run1'; node scripts/check-stall-motion.mjs
$env:EVAL_OUT='tmp/capture/run1'; node scripts/check-banner-smoke.mjs
$env:EVAL_OUT='tmp/capture/run1'; node scripts/check-ground-shadow.mjs

# 两跑账本比对（仅 pwe-anim 有 verify:compare）
cd D:\project\pwe-anim\world-client
npm run verify:compare -- <左目录> <右目录>
```

**输入**：`EVAL_OUT` 目录；四支脚本的默认输出是 `world-client/eval/screens`（`check-scene-motion.mjs:31`、`check-stall-motion.mjs:27`、`check-banner-smoke.mjs:29`、`check-ground-shadow.mjs:25`）；pixel-ledger.mjs（当前 main 上不存在，只在 pwe-anim 分支上）给每张图记 file + 逐像素 sha256 + 尺寸 + now + tide + camera。

**判据**：四支抓拍脚本是**测量器，不是闸门**：全仓这四个文件没有 `process.exit`，唯一失败路径是页面报错抛异常。读数里「应为 0」的对照是全关 0.00%、暂停 0.00%、残留 0.00%、池指令 灭0/亮2552/再灭0、确定性 13/13。真正的硬判据在 compare-ledger.mjs（当前 main 上不存在，只在 pwe-anim 分支上）：逐像素 sha256 全等且尺寸相同，counts.ok === total 才退出 0，否则退出 1。`[证据]` `scene-motion/README.md:76-79,267`、compare-ledger.mjs 第 102-136 行。

**反向用例**：复制 `run1` 为 `run2`，只改其中一张 PNG 的 1 个像素，再 `verify:compare run1 run2`，该图变 `pixel-diff`，整体退出 1；或把 `capturePair` 两边都传 `motion: null`，ROI 差立刻非 0。不需要改阈值。

**产物落点**：`<EVAL_OUT>/*.png`、`*.json`、`*.html`；`pwe-anim` 还会写 `<name>-pixel-ledger.json`。

**现状**：需要浏览器 + 本地服务；主仓没有 pixel-ledger.mjs、compare-ledger.mjs、verify:reset、verify:compare，这些只在 pwe-anim 分支上。主仓 `verify-all.mjs` 未纳入，原因见第 4 节。

### 流程 5：render-budget 双条件

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
node --import ./test/phaser-hooks.mjs --test test/render-budget-throttle.test.ts

# 浏览器六项
node node_modules/vite/bin/vite.js --port 5211 --strictPort
cd D:\project\pixel-world-engine\world-client
$env:PIXEL_WORLD_URL='http://127.0.0.1:5211/'
$env:EVAL_OUT='tmp/render-budget'
node scripts/check-render-budget.mjs
```

**输入**：`scripts/render-budget-threshold.ts` 的纯函数；`test/render-budget-throttle.test.ts`；`docs/evidence/render-budget-threshold/README.md`。

**判据**：绘制指令 `stats.totalCommands < 30000`（`check-render-budget.mjs:39,308-312`）；Graphics 对象 `<40`（`:313-317`）；拖动帧率 ≥ 静止 ×0.9（`:41,319-324`）；后台降频 `back < front` 且（`back ≤ front/3` 或 `back ≤ 12`）（`render-budget-threshold.ts:18-27`，调用点 `check-render-budget.mjs:333-339`）；回前台末秒中位 ≤ `front/0.9` 且每个 1 秒窗 ≥ `front × 0.5`（`:44-46,349-366`）；`session.errors.length === 0`（`:368`）。采样 4 次 × 1 秒，丢首个取后 3 次中位。`[证据]` README 记 5322 端口实测：指令 15514、Graphics 28、静止 42.3/拖动 51.4、前台 57.0/后台 11.0、恢复 59.9、6 项通过；另一份 `fatigue/gates.txt` 记 16130/27。两处读数来自不同树/日期，**不一致本身是盘点缺口**。

**反向用例**：单测的四条必红边界：`(60,58)` 不降载、`(60,21)` 半降载、`(37,12.5)` 既超 1/3 又超地板 12、`NaN`；同时 `(19,10)` 在旧规则下 false、新规则 true，证明修的是假红不是放宽。`[实测]` 本次单测通过。

**产物落点**：`render-budget-samples.json`（仅在 `EVAL_OUT` 存在时写，`check-render-budget.mjs:371-402`）。

**现状**：离线单测可直接跑；浏览器六项需要服务，主仓 CI 用 5188，本次命令改 5211。

### 流程 6：入口配色 9 色位

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
node scripts/audit-palette.mjs --strict
node --import ./test/phaser-hooks.mjs --test test/palette-budget.test.ts
```

**输入**：`scripts/audit-palette.mjs`、`test/palette-budget.test.ts`、`docs/adr/ADR_PALETTE_24.md`、`docs/evidence/palette-9/*.txt`。

**判据**：`BUDGET = {world:24, ui:9}`（`audit-palette.mjs:31`）；测试 `WORLD_BUDGET=24`、`UI_BUDGET=9`、`UNION_BUDGET=32`，共享色必须恰为 `[hex(WORLD.amber)]`（`palette-budget.test.ts:21-24,118-124`）；`--strict` 只在 `overBudgetWorld>0 || overBudgetUi>0` 时退出 1。九个 UI 槽是 U1 ink `#e8e2d2`、U2 paper-ink `#24211b`、U3 dim `#8e968c`、U4 panel `#171b18`、U5 line `#666a62`、U5b line-faint `#2b322c`、U6 amber `#e3a13c`、U7 base `#0c0f0d`、U8 warn `#c8876a`。边框对比 `line/base=3.49`、`line/panel=3.15`，门槛 3.0。`[证据]` `palette-9/contrast.txt:9-17`；`audit.txt` 记世界 24/335 引用、UI 9/183 引用、并集 32、超 0。

**反向用例**：值层测试对 `WORLD`/`UI` 逐 token deepEqual 提案表，换值必红（`palette-budget.test.ts:109-116`）；另有八个 render/scenes 文件禁裸 `0xRRGGBB`（`:126-142`）。`--strict` 的红样是给 `index.html` 加第 10 个 UI hex（UI=10 → 退出 1），但这种构造要改文件，本次没有执行。`[实测]` 本次 `--strict` 与测试都通过。

**产物落点**：stdout；`--json`/`--md` 输出；归档在 `docs/evidence/palette-9/`。

**现状**：纯静态文件扫描，不需要浏览器/服务/端口。`palette-9/audit.txt` 的 root 写的是 `D:\project\pwe-lively\world-client`，是从另一棵树录的；`palette.txt:180` 的复跑段落路径已过时。

### 流程 7：疲劳与睡眠

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
node --import ./test/phaser-hooks.mjs --test test/fatigue.test.ts test/homecoming.test.ts

# 只跑 homecoming 的三个新用例
node --import ./test/phaser-hooks.mjs --test --test-name-pattern "进屋即睡下|默认大世界连跑两天|睡眠账与疲劳读数" test/homecoming.test.ts
```

**输入**：`world-client/src/world/fatigue.ts`、`homecoming.ts`、`simulation.ts` 的 `settleRestAt`；`docs/evidence/fatigue/`。

**判据**：`NEEDS_FATIGUE_PER_DAY=1/2`、`NEEDS_SLEEP_DECAY_PER_DAY=4`、`NEEDS_SLEEP_THRESHOLD=0.8`、`NEEDS_WAKE_THRESHOLD=0`、跨阈 `1.6` 世界日、睡段 `0.2` 世界日（`fatigue.test.ts:84-89`）；`settleRestAt` 三个入口是 `enterHome`、黎明 `restGoal`、`wakeUp`，外加读档重锚 `simulation.ts:906`。三个新用例分别断言：进屋那一拍疲劳归零；默认大世界连跑两天 `crossings===0`、`spans.length===0`；同初始时刻两跑逐拍 pos/visible/疲劳/睡眠账逐字相同。`[证据]` `fatigue/readings.txt` 记跨阈 228,240,000 ms（第 2.6417 天）、睡段 4.85 h、差值 0.00 h、终局疲劳 0.1330/0.1344。

**反向用例**：`fatigue.test.ts:134` 在强制场景断言 `crossings===1`，并断言睡段 `|sleptMs - 0.2*DAY_MS| <= 4000`、就地睡标签、`rules.filter(r=>r==='sleep').length===1`、疲劳归零、`goalInterruptCount()===0`；而 `homecoming.test.ts` 新用例 2 断言默认世界 `crossings===0`。这就是「必须触发」与「必须不触发」的双向对照，不改阈值。

**产物落点**：测试本身不落盘；证据在 `docs/evidence/fatigue/readings.txt`、`gates.txt`、`fingerprints-old-new.txt`、`decisions-diff.txt`。

**现状**：离线可跑，`[实测]` 通过。`gates.txt` 记全量 `npm test` 2113 通过 / 0 失败 / 9 跳过；`test:buttons` 退出 2（已知缺口，见流程 8）。

### 流程 8：行为/环境/需求

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
node --import ./test/phaser-hooks.mjs --test --test-concurrency=1 `
  test/environment-frame.test.ts test/observation-rules.test.ts test/behavior-queue.test.ts `
  test/needs.test.ts test/needs-failure.test.ts test/delivery-failure-event.test.ts
```

**输入**：`environment.ts`、`observation-rules.ts`、`behavior.ts`、`behavior-rules.ts`、`needs.ts`、`delivery-failure.ts`；`scripts/behavior-decisions.ts`、`scripts/needs-probe.ts`。

**判据**：环境标志闭集 10 项（`rain|storm|wet|fog|lowTide|highTide|quiet|workEnded|lampsLit|lampsOut`，`environment.ts:29-39`）；观察规则 9 个键、一次改变只命中一条（`observation-rules.ts:111-135`）；行为规则顺序 `[verification, pre-cover, sleep, rest, eat, routine]`（`behavior-rules.ts:71-78`）；需求速率 `1/3` 每天、饿阈 `0.9`、失败阈 `1`、跨阈约 2.7 天（`needs.ts:19-50`）；`delivery_failed` 载荷是 `{taskId, taskKind, reason:'hunger', repeat}`，文本 `${workerName}饿得手抖，${summary}这一趟没送到。`（`delivery-failure.ts:51-91`），服务端 `FAILURE_REASONS=("hunger",)`（`server/events/world_changes.py:110`）。`[实测]` 本次六文件通过。

**反向用例**：`behavior-queue.test.ts:128` 交换规则顺序后 `orderedIds()` 变、决策结果变；`needs-failure.test.ts:72` 强制 `hunger===1` 后 `runUntilSettled==='failed'`、`deliveries.local===0`、气泡 `/没送到/`、`events.length===1`、`failure.reason==='hunger'`；`delivery-failure-event.test.ts:133` 室内失败只有同房间两个角色记得（`['worker','mate']`、`facts.length===1`、`entries.length===2`）；`observation-rules.test.ts:156` 断言源码里不允许直接写 `change.change === 'weather'` 分支。

**产物落点**：无；证据在 `docs/evidence/fatigue/`、`docs/evidence/needs/` 及测试本身。

**现状**：离线可跑。只能浏览器演示的部分仍卡住：`test:buttons` 因 `/api/memory/list` 回 404 退出 2，镇志抽屉点不到；`smoke` 125 项、`phases` 17 项、`persistence` 8 项、`setting` 29 项需要浏览器与服务。

### 流程 9：账本与旁证

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
node scripts/eval-ledger.ts
node scripts/verify-ledger-selfcheck.ts
node --import ./test/phaser-hooks.mjs --test test/memory-witnessed-corroboration.test.ts
```

**输入**：`eval/ledger.json`；`world-client/scripts/eval-ledger-lib.ts`；`docs/evidence/soak/witnessed-corroboration.json`；`test/memory-witnessed-corroboration.test.ts`。旁证测试会从 `$PWE_SOAK/docs/evidence/soak/soak-a/save-90d.json`、仓库内同名文件、或 `../pwe-soak/...` 三处找快照。

**判据**：12 个必填字段 `id/value/unit/seed/weather/rainSeed/denominator/source/script_sha/judge/measured_at/gate`（`eval-ledger-lib.ts:24-37`）；`script_sha` 是 64 位小写 sha256 或 `not_measured`，填了 `script` 就按当前文件内容复核（CRLF→LF 归一化，`:62-64,135-150`）；`value===0 && source==='not_measured'` 直接红；外部来源 `pwe-soak/` 必须给 `input_sha` 或 `input_status='not_measured'` + 非空 `input_note`（`:152-174`）。旁证断言 `violations.length===0`，即 71 条 witnessed 里 12 条未解析 `eventRef` 都必须至少被 `claims`/`beliefs`/`legends` 引用一次（分桶 0 / 10 / 2）。`[实测]` 本次账本 25 条 metrics 校验通过；`verify-ledger-selfcheck` 1 绿 + 6 红；旁证测试通过。

**反向用例**：新增的 `verify-ledger-selfcheck.ts` 在内存副本上构造六种坏账本：缺 `seed`、`value=0` 且 `source=not_measured`、`script_sha` 篡改、外部来源删 `input_sha`、重复 `id`、`version=2`。六种都必须红且错误含指定关键词，否则脚本退出 1。

**产物落点**：`eval/ledger.json`（`eval-ledger-sha.ts --write` 才会回写）；旁证测试会覆盖写 `docs/evidence/soak/witnessed-corroboration.json`（固定键序、无时间戳、末尾 `\n`）。主仓当前该文件显示 ` M`，`git diff` 为空、只有 LF→CRLF 警告，是 EOL-only 修改。

**现状**：离线可跑，但旁证测试依赖 `pwe-soak` 90 天快照；快照不随仓提交时这条会红，不能当绿。

### 流程 10：动画基线账本

**触发命令**

```powershell
cd D:\project\pixel-world-engine\world-client
node scripts/verify-animation-baseline.mjs
node scripts/verify-animation-baseline.mjs --self-test
```

**输入**：pwe-anim 分支上的 docs/evidence/animation-express/SCREENSHOT_BASELINE_CHANGES.md（232 行，157 行逐张清单）。

**判据**：新增的结构校验断言标题声明 157 张、行数 157、编号连续 1..157、六类计数恰为 `甲·可信=73 / 甲·基线不可复现=29 / 乙=28 / 丙=18 / 丁=2 / 参照=7`、每行旧/新基线是 12 位小写哈希、对应提交是 7 位哈希。`[实测]` 本次通过。

**反向用例**：`--self-test` 三种变异必须红：删掉第 157 行、打坏一个新基线哈希、改掉一行归类。`[实测]` 3/3 红。

**产物落点**：stdout；文档本身在 `pwe-anim`。

**现状**：这份账本原来没有任何脚本校验，只有 `PROGRESS.md:125` 与 PHASE_FRAME_CRITERIA.md 第 7 行（pwe-anim 分支）两处引用。现在能校验「账本自己的结构」，仍不能校验「哪张图真的该变」；语义真值仍需重录后由人确认。

## 3. 汇总入口

```powershell
cd D:\project\pixel-world-engine\world-client
$env:VERIFY_ALL_OUT='D:\project\pwe-verify-out\verify-all'
node scripts/verify-all.mjs
```

**定位（写死）**：这是**人工手动入口**，不得接进 CI、不得挂进 `npm test`/`npm run ci`、不得作为合并闸门。它会拉起浏览器与本机服务，接进 CI 会把机器差异变成假红。已核对：根 `package.json` 只有 `check:hooks`/`worktrees:audit`，`world-client/package.json` 的 scripts 没有 `verify-all`，`.github/workflows/ci.yml` 也没有引用它。

`VERIFY_ALL_OUT` 指到仓外，避免往仓库里写生成物；不设时默认 `world-client/tmp/verify-all`（gitignore）。已知副作用只有一项：旁证测试会用 `\n` 覆盖写 `docs/evidence/soak/witnessed-corroboration.json`；入口在跑完后按原始字节还原，本次实测改前/改后 SHA-256 相同（`762EB77A…0FFD4672`），不会污染工作树。

`[实测]` 2026-11-06 的读数：

```text
汇总口径：8 通过 / 0 失败 / 1 跳过 / 3 未执行
verify-all 原始：pass=8 fail=0 skip=1 elapsed=4769ms
读数：D:\project\pwe-verify-out\verify-all\last-run.json
```

`8 通过` 是 `verify-all` 实测 pass 的 8 条；`1 跳过` 是汇总入口里的 `phase-frames`；`3 未执行` 是流程 3 真跑、流程 4、流程 6 的 `--strict` 第 10 色红例，原因与前置见第 1 节未执行清单。三者都不计入通过，也不把 SKIP 折算成绿。流程 1、流程 5 的浏览器半边只在第 4 节登记，不计入这四个数字。

入口自身的反向验证：

```powershell
node scripts/verify-all.mjs --self-test
```

`[实测]` 注入 `node -e "process.exit(1)"` 后整体判红，脚本打印「自检通过：必红项使整体判红」并退出 0。证明入口不是永远绿。

`--list` 会逐条打印 RUN/SKIP 与原因；`--only palette-9,eval-ledger` 只跑指定流程；任一 FAIL 退出 1。

## 4. 还不能进汇总入口的流程

| 流程 | 不能进的原因 | 卡在哪 |
|---|---|---|
| 钉子六图 `check-shot-actor-pin.mjs` | 需要浏览器 + 本地服务 | 5211 dev server；`eval/screens/actor-pin` 当前为空 |
| 抓拍四支 `check-*-motion/smoke/shadow` | 需要浏览器 + 本地服务 | 5211 dev server；脚本本身无阈值、无退出码 |
| `verify:compare` 跨进程账本 | 工具只在 pwe-anim 分支上 | 主仓无 pixel-ledger.mjs / compare-ledger.mjs |
| 相位帧真跑 | 需要 Chromium + 两跑截图 | 主仓无脚本；`pwe-anim` 需 r1/r2/r3 |
| render-budget 浏览器六项 | 需要浏览器 + 本地服务 | 5211 dev server；离线只覆盖纯函数边界 |
| smoke / phases / persistence / buttons | 需要浏览器 + 本地服务 | `test:buttons` 仍因 `/api/memory/list` 404 退出 2 |

这些流程不是「没写」，是「当前 checkout 不能无浏览器复算」。要进汇总，需要先补两样东西：一个能自动起停 dev server 的 harness，以及把 `pwe-anim` 的 `pixel-ledger`/`compare-ledger`/`phase-frames` 合进 main。两者都不在本次只读盘点的范围内。

## 5. 盘点结论

1. **能立刻重跑的流程有 8 条**，已全部进 `verify-all.mjs`；每条都有反向用例，入口本身也有必红自检。本次口径是 `8 通过 / 0 失败 / 1 跳过 / 3 未执行`，SKIP 与未执行都不算通过。
2. **最大的空判风险在流程 4**：四个抓拍脚本没有阈值、没有 `process.exit`，0.00% 与 13/13 只是读数，不是闸门。真正能判红的是 `compare-ledger` 的逐像素 sha 全等。
3. **第二个空判风险在流程 3**：相位帧只有 stdout，没有 JSON/掩膜；判据本身有效（区外 0 + 面积/块数上限），但证据不可复算。
4. **流程 10 只能校验账本结构，不能校验语义**：157 行、六类计数、哈希与提交都能钉住，但「哪张图该变」仍要重录后由人确认。
5. **主仓当前只有一处脏文件**：`docs/evidence/soak/witnessed-corroboration.json`，`git diff` 为空、仅 LF→CRLF 警告，是 EOL-only 修改；来源是旁证测试以 `\n` 写盘。
6. **端口纪律必须写进每条浏览器命令**：脚本默认 5188/5202，恰好落在禁用名单；不覆盖就会占用被禁端口。
7. **读数不一致要如实列出**：render-budget 有 15514/28 与 16130/27 两套；`03-ACTOR-PIN.md` 与 `04-RENDER-INPUT-TABLE.md` 对五钉 1200 vs 2800 记了 0.0104% 与 0；`palette-9/audit.txt` 的 root 指向 `pwe-lively`。这些不是「新发现」，是盘点时必须标出的证据缺口。

## 6. 本次新增文件

| 文件 | 作用 |
|---|---|
| `docs/evidence/VERIFIABLE_FLOWS.md` | 本文，流程总表与逐条口径 |
| `world-client/scripts/verify-all.mjs` | 汇总入口，任一 FAIL 退出 1；`--self-test` 证明会判红 |
| `world-client/scripts/verify-screens-diff-selfcheck.py` | 结构差判据的 5 例正/反向自检 |
| `world-client/scripts/verify-ledger-selfcheck.ts` | 账本校验器 1 绿 + 6 红自检 |
| `world-client/scripts/verify-animation-baseline.mjs` | 157 行动画基线账本的结构校验与 3 例反向自检 |

未改任何既有判据的数值、阈值或用例；未 `stash`、未动别人的工作树。

## 7. 入库记录

由用户授权，在盘点完成后执行 `--no-ff` 合 main 与 push；动作与 CI 结果记录在提交说明与最终交接中，本表不因此改动任何判据。
