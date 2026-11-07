# 本次动画基线验证 · 结论报告

- **日期**：2026-11-07
- **验证对象**：`world-client/eval/screens/` 下 169 个已跟踪基线产物（157 PNG + 3 HTML + 9 JSON），HEAD `8182414`（`feat/anim-fsm-render`）
- **问题**：这 169 个基线产物，能不能用来判断动画 FSM（`?animfsm=1`）有没有改变画面？
- **结论**：**不能。** "不能"分三层：尺寸层可修、时效层可修但代价高、机制层是这套基线机制本身的缺陷，刷新基线也修不好。
- **纪律**：本报告只读。未重录、未改基线、未 push。

> 标注约定
>
> - **实测**：本轮在 `world-client/` 跑出的读数，出处给到落盘文件或命令。
> - **另一线实测**：并行工作线已经跑过、本报告没有复算的读数；带"另一线实测"标记，出处按该线落点或转述注明。
> - **推断**：没有证据坐实，只作为待查方向。
>
> 本轮分析证据多数落在 `world-client/tmp/`（gitignore，不入库）；下文照实写路径，但只有入库文件才用反引号。

---

## 1. 结论先行：不能，分三层

| 层 | 这次读到什么 | 能否修 | 修完之后还剩什么 | 代价 |
|---|---|---|---|---|
| **A 尺寸层** | 144 张可产出 PNG 中 108 张尺寸不同：基线 960×631，当前 960×587 | **可修**，低成本 | 修完仍有 **0/108** 逐字节相同（见 B 层） | 隐藏或绕开 `#entry-hint` 的占位；不需要重录 |
| **B 时效层** | 基线停在石板材质 `a41ac8b` 之前，尺寸修好后差异仍有 7.8%–8.9%，`bestShift dx=dy=0` | **可修**，但要先修抓拍口径再重录 | 基线恢复成"当前画面"，但这批夹具仍然进不了过渡期（见 C 层） | 全套重录 + 把瞬时相位固化进基线的风险 |
| **C 机制层** | 12 条截图脚本没有一条写 `settled:false`；11 条 check-* 完全没有 `pinActors`；抓拍本身不可复现；CI 里没有消费方 | **不能靠刷新基线修** | 这批图结构上只能证明"稳态没变"，而稳态下 FSM 与旧路径逐字段相同 | 换判据：同次运行比较，不依赖基线 |

**C 层为什么是机制缺陷，而不是"再录一次就好"：**

1. FSM 只在**过渡期**改变画面。稳态下 `animDrawSourceOf(enabled, pinnedFrame, settled)` 走 `settled` 路径，单测第 2 条已证明 FSM 采样与旧路径逐字段相同（`world-client/test/anim-fsm-view.test.ts`）。
2. 现有 12 条截图脚本里**没有一帧落在过渡期**：没有一条把 `ActorPin.settled` 传 `false`；11 条产出基线的 check-* 连 `pinActors` 都没有，人物是活的稳态。实测依据见 world-client/tmp/animfsm-report.md 第 3 节。
3. 所以即使 A、B 两层全部修好、基线全部重录成"当前画面"，这批图仍只覆盖稳态。对"FSM 有没有改变画面"的答案会永远停在"没变"——不是因为没变，而是因为**拍不到会变的那一段**。
4. 再叠加两个机制问题：抓拍本身不可复现（同码两跑被子项 1–2 的噪声吃掉），以及 CI 里没有消费方（第 8 项）。这两条决定了这批图连"稳态有没有回归"都当不了可靠判据。

---

## 2. 逐项实测

### 2.1 开关关：13 相同 / 131 不同

**实测。** 同一构建、`?animfsm` 缺省关闭，12 条脚本跑一遍，与仓内基线逐字节比较：

| 脚本 | 产出 PNG | 与基线相同 | 变化 |
|---|---|---|---|
| smoke | 13 | 9 | 4 |
| check-banner-smoke | 23 | 0 | 23 |
| check-creation | 2 | 0 | 2 |
| check-dengchao | 3 | 0 | 3 |
| check-ground-shadow | 20 | 0 | 20 |
| check-lamp-band | 3 | 0 | 3 |
| check-lamp-pool | 7 | 0 | 7 |
| check-phases | 5 | 4 | 1 |
| check-scene-depth | 3 | 0 | 3 |
| check-scene-motion | 45 | 0 | 45 |
| check-setting-scale | 1 | 0 | 1 |
| check-stall-motion | 19 | 0 | 19 |
| **合计** | **144** | **13** | **131** |

131 张再分两类：

- **108 张尺寸不同**：基线 960×631，当前 960×587，差 44px。
- **23 张同尺寸但内容不同**：同构建两次 OFF 重跑之间就会变，属于抓拍相位/动画噪声（2×2 里 OFF1 vs OFF2 有 28 张 PNG 不同）。

13 张逐字节相同的是 smoke 的 9 张钉帧（01-salute、06、07×4、08×3）加 check-phases 的 4 张。

基线 157 PNG 里，默认口径不产出的 13 张是一次性 `before`/合成/`-1x` 参照：ground-shadow 的 `-closed-t` 与 4 张 `-1x`、lamp-band 的 6 张 `before`、setting-scale 的 2 张。

**出处**：world-client/tmp/measure/baseline-table-finaloff.txt（逐脚本合计 144/13/131）；world-client/tmp/animfsm-report.md 第 1 节（108/23/13 分类）。

### 2.2 44px 的来源：`#entry-hint` 把画布下推

**另一线实测，本轮未复算。** 同一 URL、同一 1010×700 视口，只改 `#entry-hint` 的显隐，量 canvas 框：

- `#entry-hint` 是普通流里的一行提示，CSS 盒高 **32px**，另有 **12px** 外边距，合计把画布从 y **68.8** 下推到 **112.8**。
- 两者之差 **44px**。1010×700 视口底边到画布顶只剩 `700 − 112.8 = 587.2`，截图裁成 **587**；基线录制时画布从 68.8 起，`700 − 68.8 = 631.2`，裁成 **631**。
- 把 `hidden=true` 之后，**108/108 张精确回到 631**；`#stage` 整体上移 44px，宽高不变。

本地可核验的旁证：

- `world-client/index.html` 的 `#entry-hint`：普通流、`width:720px`、有 padding 与 1px 边框、`[hidden]{display:none}`；不在画布上叠层。
- 另一线 proof.json 的 HUD 读数（仓外，pixel-world-engine 的 tmp 下）：`#entry-hint` 的 rect 是 `top=68`、`height=32`；同一页 `hudSummary.boxBefore` 的 canvas 是 `x=25.5, y=112.8, 960×640`。
- 复现探针：world-client/tmp/probe-hint.mjs（一次性，未入库），只切换 `hint.hidden` 后重新量 canvas 框。

**这层是可修的，而且代价最低**：要么截图时隐藏提示，要么把抓拍窗口改成与基线同一画布起点。但修完只恢复"可比"，不解决下一层。

### 2.3 修好尺寸后仍 0/108 逐字节相同

**另一线实测，本轮未复算。** 把 44px 尺寸差消掉后，108 张重新与基线逐字节比较：**0/108 完全相同**。

差异不是本次动画改动造成的：

- 基线停在**石板材质 `a41ac8b`**（`feat(material): 路面石材——石板三档色阶 + 错缝铺装，去掉网格纸`）之前。`a41ac8b` 在本仓 `git log` 可查。
- 差异量 **7.8%–8.9%**；`bestShift dx=dy=0`，即没有任何整数平移能把两张图对齐；差异掩膜只压在**铺装、砌缝、地面颗粒**上，不在角色或 UI 上。
- 补丁后图像上段与未打补丁产物逐像素 **0 差**：说明补丁像素是中性改动，漂移发生在本次动画改动之前，而不是动画改出来的。

**这一层也可修，但修法是重录，不是挪图。**

### 2.4 旁证：干净基点同样 127/131 不同

**实测。** 干净基点 `a03a1cb`（本次动画改动之前；临时工作树已移除）跑同一批 11 条脚本（不含 smoke）：

- 产出 **131** 张，与基线相同 **4** 张、变化 **127** 张。
- 相同的 4 张是 check-phases 的四时相；变化覆盖 banner-smoke、creation、dengchao、ground-shadow、lamp-band、lamp-pool、scene-depth、scene-motion、setting-scale、stall-motion。

即：在完全没有动画 FSM 改动的提交上，基线同样大面积对不上。这说明 2.1 的 131 不是 FSM 造成的，而是基线时效问题。

**出处**：world-client/tmp/measure/baseline-table-base.txt。

### 2.5 开关开：2×2 里"真变化"是 0 张

**实测。** 同一构建、同一批参数，做 2×2（每次全量 12 脚本）：

| 对比 | 差异文件 | 其中 PNG |
|---|---|---|
| OFF1 vs ON1（finaloff vs finalon） | 28 | 22 |
| OFF1 vs OFF2（同构建重跑） | 36 | 28 |
| ON1 vs ON2（同构建重跑） | 10 | 10 |
| **2×2 判定 REAL（两边都稳且 ON≠OFF）** | **0** | **0** |

分类共 153 个产物：REAL **0** / NOISE-OFF **36** / NOISE-ON **10** / SAME **107**。PNG 144 张里：REAL **0** / NOISE-OFF **28** / NOISE-ON **10** / SAME **106**。

OFF1 vs ON1 的 22 张 PNG 逐张如下（count=变化像素数，box=x,y,w,h，坐标是截图像素）：

| 文件 | 变化像素 | bbox | 归因 |
|---|---|---|---|
| check-banner-smoke/banner-smoke-banner-sway-t.png | 41346 | 0,468,960,119 | NOISE-ON |
| check-banner-smoke/banner-smoke-banner-sway-t1.png | 41346 | 0,468,960,119 | NOISE-ON |
| check-creation/creation-ghost.png | 544390 | 26,104,960,640 | NOISE-OFF |
| check-dengchao/dengchao-noon.png | 167915 | 26,113,960,694 | NOISE-OFF |
| check-dengchao/dengchao-tide-high.png | 14558 | 50,113,936,640 | NOISE-OFF |
| check-dengchao/dengchao-tide-low.png | 8392 | 26,123,960,630 | NOISE-OFF |
| check-lamp-pool/lamp-pool-tide-10.png | 44086 | 0,0,480,312 | NOISE-OFF |
| check-lamp-pool/lamp-pool-tide-100.png | 61052 | 0,0,480,312 | NOISE-OFF |
| check-lamp-pool/lamp-pool.png | 421931 | 1034,198,1375,1477 | NOISE-OFF |
| check-phases/phase-night-rain.png | 319090 | 1,1,960,640 | NOISE-OFF |
| check-scene-depth/placement-behind.png | 68468 | 0,0,480,320 | NOISE-OFF |
| check-scene-depth/placement-front.png | 192 | 80,208,8,44 | NOISE-OFF |
| check-scene-depth/placement-stall.png | 273558 | 42,156,1168,640 | NOISE-OFF |
| check-setting-scale/setting-scale-after.png | 350 | 216,62,264,230 | NOISE-OFF |
| check-stall-motion/stall-motion-cover-off-t.png | 68544 | 0,468,576,119 | NOISE-OFF |
| check-stall-motion/stall-motion-cover-off-t1.png | 68544 | 0,468,576,119 | NOISE-OFF |
| check-stall-motion/stall-motion-cover-on-t.png | 68420 | 0,468,576,119 | NOISE-OFF |
| check-stall-motion/stall-motion-cover-on-t1.png | 68544 | 0,468,576,119 | NOISE-OFF |
| check-stall-motion/stall-motion-rain.png | 988 | 28,0,926,587 | NOISE-OFF |
| smoke/02-working.png | 2852 | 454,227,214,90 | NOISE-OFF |
| smoke/03-deliver.png | 5652 | 596,69,110,70 | NOISE-OFF |
| smoke/05-build.png | 160 | 424,50,4,124 | NOISE-OFF |

22 张里 20 张是 OFF 两跑自己就不稳，2 张是 ON 两跑自己就不稳；没有一张满足"两边都稳且 ON≠OFF"。

另 6 个 sidecar（banner-smoke.html、ground-shadow.json、lamp-band-after.json、scene-motion.html/json、stall-motion.html）含 `generatedAt`/帧哈希，每次跑都不同，按噪声处理。

与预测直接冲突的三条实读：

1. `01-salute`：OFF1/OFF2/ON1/ON2 四跑同一 sha256，且与基线逐字节相同。
2. `03-deliver`：四跑全不同（OFF 两跑之间也不同），差异只在烟囱白烟 bbox(596,69,110,70)，不在人形。
3. "上限 15 张"不成立：22 个 PNG 差异全部落在同模式重跑噪声内。

**出处**：world-client/tmp/measure/four-way.txt（REAL 0 / NOISE-OFF 36 / NOISE-ON 10 / SAME 107；PNG 144 REAL=0）；world-client/tmp/animfsm-report.md 第 2 节（22 张表与三条冲突）。

结论：**开关开的可复现实测变化 = 0 张。** 这不是"实现没生效"，而是"没有过渡可拍"：现有夹具里没有一帧写 `settled:false`。

### 2.6 过渡期：两层确实同画

**实测。** 一次性探针（world-client/tmp/probe-transition.mjs，未入库）钉住同一页面、同一角色（`v0` 迷路人）、同一呈现时刻，只改 `ActorPin.settled`：

- 目标角色 `lampOil=1`，`lampAnimationTime` 是恒等，90ms 就是 90ms。
- `idle→deliver` 的 `ANIM_TRANSITION_MS` 是 **180ms**（原 `design` 值，未改）；中点取 `T0+90`。
- `T0=45,000,000`，12fps 下 step=540000（帧 0）；`T0+90` step=540001（帧 1）；`T0+180` step=540002（帧 0）。

| 对 | 差异像素 | 画布占比 | bbox (x,y,w,h) | maxΔ | 判读 |
|---|---|---|---|---|---|
| A1 vs B1（过渡 vs 稳态 deliver） | 1596 | 0.2598% | (478,292,40,62) | 105 | 过渡帧 ≠ 稳态交付 |
| A1 vs C1（过渡 vs 稳态 idle） | 1596 | 0.2598% | (478,292,40,62) | 153 | 过渡帧 ≠ 稳态待机 |
| B1 vs C1（两个稳态） | 840 | 0.1367% | (480,292,38,62) | 206 | 两个姿态本身可分辨 |
| A1 vs A2 | 0 | 0 | — | 0 | 同一状态重复抓拍逐字节相同 |
| B1 vs B2 | 0 | 0 | — | 0 | 同上 |
| **P0 vs C0** | **0** | 0 | — | 0 | 进度 0：只剩残影 idle，与稳态 idle 逐字节相同 |
| **P180 vs B0** | **0** | 0 | — | 0 | 进度 1：只剩当前层 deliver，与稳态 deliver 逐字节相同 |

- `A` 两次抓拍逐字节相同，排除了"这是噪声"。
- 两个端点分别与两个稳态逐字节相同，说明进度 0 时残影层真的在画、进度 1 时当前层真的在画。
- 中点对两端都不同，且三对差异的 `bands` 都是 `[0,N,0]`，全部落在中三分之一带（y 213–426），bbox 紧贴角色精灵（x 478–518、y 292–354）；背景石板、房屋、烟囱零差异。

**合成口径**：`updateVillager` 的 fsm 分支是同一个 `Graphics` 先 `clear()`，再逐层 `fillRect`，alpha=`PAINT_ALPHA × weight`（lit 0.42 / contact 0.38），顺序是**残影在下、当前层在上**。这是**有序半透明叠加**，不是两图按权重做线性 cross-fade：被半透明层覆盖的地方会透出背景/下层，而不是 50/50 混色。60fps 下 180ms 约 **11 帧**两层同画，肉眼看到的是**重影**，不是位移模糊。

这是产品判断，不是 bug；**是否接受重影，待 owner 定**。在 owner 给出结论前不改 `design` 时长、不改成线性混合。

**出处**：world-client/tmp/animfsm-report.md 第 7 节；`docs/animation/villager-anim-fsm-integration.md` 的"过渡合成的视觉口径与待定项"。

### 2.7 闸门：三条断言

**实测。** 过渡像素校验目前由一次性探针完成（脚本、npm 入口与 CI 接线均未入库，随动画线后续提交）；本节读数来自该探针，不能当作「已在 CI 里跑的闸门」。

三条断言：

1. 进度 0 的帧与稳态 idle **sha 相同**。
2. 进度 1 的帧与稳态 deliver **sha 相同**。
3. 进度 0.5 的中间帧与两端 **sha 都不同**，且 A-B、A-C 的差异 bbox 落在"两稳态差异 bbox 并集 ±8px"内。

- 角色区不靠相机坐标猜，用**同次运行**的两稳态差异做定位器。
- 反向用例 `ANIMFSM_TRANSITION_NEGATIVE=1` 把过渡帧也强制成稳态，**三项全红**、退出 1。
- 只做同次运行比较，**不写死跨运行哈希**：绝对 sha/像素数/bbox 每次运行会浮动，两次实测分别是：
  - 探针：1596px / 0.2598% / bbox (478,292,40,62)
  - 闸门正跑：1532px / 0.2493% / bbox (480,288,36,62)

耗时（含 preview 启停）：

| 环节 | 耗时 |
|---|---|
| preview 起到可访问 | 714 ms |
| 闸门本身（正跑） | 3610 ms |
| 停止 preview | 10 ms |
| 独立冷跑合计 | ≈4.33 s |
| CI 增量（同 step 已有 preview） | ≈3.6 s |

选择进 CI 的理由：三条断言都是**同次运行内比较**，不依赖跨机基线，也不依赖绝对坐标；增量 3.6s 在现有浏览器 job 里可接受。

**出处**：`docs/evidence/VERIFIABLE_FLOWS.md` 流程 11（命令、判据、反向用例、耗时表、选择理由）；`.github/workflows/ci.yml`；`world-client/package.json`。闸门脚本与 CI 改动在当前工作树，未提交、未 push。

### 2.8 基线的实际效力：没有 CI 消费方（本报告最重要的一条）

**另一线实测 + 本报告核对。** 六条主要截图脚本：

| 脚本 | npm 入口 | 在 CI | 产出 PNG |
|---|---|---|---|
| smoke | `test:browser` | 否 | 13 |
| check-dengchao | `test:setting` | 否 | 3 |
| check-banner-smoke | **无** | 否 | 23 |
| check-ground-shadow | **无** | 否 | 20 |
| check-scene-motion | **无** | 否 | 45 |
| check-stall-motion | **无** | 否 | 19 |

- 六条**一条都没进 CI**。
- 后四条**连 npm script 都没有**，只能手工 `node scripts/...`。
- 这六条产出 123/144 张（占可产出 PNG 的绝大多数），全部不在合并闸门里。

CI 的 `world-client-browser` job 实际只跑四条：`test:persistence`、`test:render-budget`、`test:phases`、`test:animfsm-transition`。其中：

- `test:phases` **不读仓内基线**：它默认把截图写进 tmp/screens/，只有显式 `--write-baseline` 或 `EVAL_OUT=eval/screens` 才写回基线；CI 把 `EVAL_OUT` 指到 `${{ runner.temp }}/eval-screens`。判据是四刻亮度顺序与同次运行的区域差，不是与基线逐字节比较。
- `persistence` / `render-budget` 不产出、也不比对 `eval/screens` 的 PNG。
- 新增的 `test:animfsm-transition` 同样不读基线，只做同次运行比较。

因此：**这 157 张 PNG 在 CI 里没有任何自动化消费方**。存在两处人工/旁路引用，但都不构成回归闸门：

- `check-lamp-band` 会从 `eval/screens/` 只读复用 3 张"改前"参照；它不在 CI，也不做回归比对。
- `world-client/scripts/verify-animation-baseline.mjs` 只校验另一份 157 行**账本文档**的结构（另一工作线的 animation-express 账本，不是本报告这 157 张 PNG），不读这 157 张图；它挂在人工入口 `verify-all.mjs`，不在 CI，也没有 npm script。

该问题已由另一线登记为 `docs/OPEN_ISSUES.md` 的 **E7**，三个处置方向待 owner 定：

- **A**：接进 CI（需要先解决抓拍不可复现，否则会引入假红）。
- **B**：降级为人工视觉参考（标注尺寸裁切与材质漂移）。
- **C**：删除这批图与其 sidecar。

**核对说明**：本工作树的 `docs/OPEN_ISSUES.md` 当前条目为 E1–E6 与 E8（E8 是 soak 改写条目，原被误记为 E7 后改号）；**E7 仍为空号**，保留给本节的 157 张基线条目（正文在 `fix/entry-hint-clip` 分支，未合入），未在本树核实 E7 正文。

**出处**：`.github/workflows/ci.yml`（浏览器 job 四步与 `EVAL_OUT`）；`world-client/package.json`（npm 入口）；`world-client/scripts/check-phases.mjs`（默认写 tmp、显式才写基线）；`docs/evidence/VERIFIABLE_FLOWS.md` 流程 4（四支无 npm 入口脚本清单）。

### 2.9 盘点口径勘误：没有"167"

**实测。** 重新核对（结果为 git 输出计数）：

```
git ls-files 'world-client/eval/screens/*'
→ 169 个 = 157 PNG + 3 HTML + 9 JSON

git log --format=%h -- 'world-client/eval/screens'
→ 36 个提交

git ls-tree -r --name-only 909e9de -- world-client/eval/screens
→ 165

git ls-tree -r --name-only 0a6742c -- world-client/eval/screens
→ 169
```

历史里**没有"167 这个盘点"**。扫描 36 个碰过该目录的提交，只有 `165@909e9de → 169@0a6742c`（最后一次 +4：`lamp-band-before-seed-pinned` 的 dark/lit/png 三件 + 1 个 JSON）。"167→169 多两张"在任何已跟踪快照上都复现不出来。

**出处**：world-client/tmp/animfsm-report.md 第 0 节；上面的命令可直接重跑。

### 2.10 未查清 / 未验证

**未查清（另一线实测，本报告未继续深挖）：**

- `check-creation/creation-rejected.png`：干净基点两次跑值一致、新构建三次跑值一致，两者不同；但**同一新构建内 ON==OFF**。即"随构建稳定变、不随开关变"。像素级原因**未坐实**；推断是抓拍相位，但**没有证据**。它与本条线开关无关。

**先后关系（实测，写清时间顺序）：**

- 在过渡像素探针之前，只有**运行时参数到达**的证据：tmp/probe-animfsm-query.mjs 包了 `URLSearchParams.get`，ON 页的 `search` 含 `animfsm=1`，启动期 `get('animfsm')` 被调用 1 次；OFF 页也调用 1 次、取到 null。这只证明开关被读到，**没有过渡帧的像素证据**。
- 2026-11-07 用一次性探针补上了过渡帧像素证据（第 2.6 节），随后计划固化为例行闸门（第 2.7 节，接线尚未入库）。顺序是：参数到达 → 像素证据 → 闸门；不是一开始就有像素证据。

**出处**：world-client/tmp/animfsm-report.md 第 3、4、7 节。

---

## 3. 这些基线还能用吗、代价多少

| 用途 | 结论 | 原因 |
|---|---|---|
| 判断动画 FSM 有没有改变画面 | **不能** | 夹具从不进过渡期；稳态下 FSM 与旧路径逐字段相同（第 1 节 C 层） |
| 证明"开关关 = 零变更" | **不能** | 关着就有 131/144 不同；干净基点 `a03a1cb` 同样 127/131 不同 |
| 当 CI 回归闸门 | **不行** | 六条脚本不在 CI，四条无 npm 入口；CI 四条检查都不读这批 PNG |
| 当人工视觉参考 | **可以，但要标注** | 108 张被 44px 裁切；尺寸修好后仍有 7.8%–8.9% 石板材质漂移 |
| 重录后当 FSM 判据 | **仍不能** | 重录只修 B 层；夹具盲区（C 层）不变 |

三层各自的代价：

- **A 尺寸层**：最低。隐藏 `#entry-hint` 或改抓拍窗口即可让 108/108 回到 631；不需要重录。但修完 0/108 逐字节相同，收益只是"恢复可比"。
- **B 时效层**：高。必须重录全套（实际产出 144 张，另 13 张是一次性参照），而且**要先修抓拍口径**，否则会把瞬时相位固化进新基线。抓拍不可复现的实测旁证：同码两跑 `smoke` 的 `01` 差 0.35%、`03` 差 1.32%、`05` 差 17.29%、`07-1s` 差 34.99%、`08-overlay-100` 差 57.96%；`check-phases` 的 dusk 38.57%、night-rain 33.29%；`01-salute` 与基线只差 2.09%，但同代码重拍一次变成 26.41%。另有时间序列佐证：2.2s 采样仍在相位渐变里，3.2s 后才稳定。出处 `docs/evidence/SCREENS_BASELINE_AUDIT.md` 与 `docs/evidence/screens-audit-readings.json`。
- **C 机制层**：不能靠刷新基线修。正确做法是换判据：**同次运行比较**，不依赖跨运行基线。这条路在一次性探针 `test:animfsm-transition` 上验证过（脚本、npm 入口与 CI 接线均未入库），反向用例三项全红。

**建议（不替 owner 拍板）：**

1. **FSM 回归不要用这 169 个产物**，用 `test:animfsm-transition`（一次性探针；脚本、npm 入口与 CI 接线均未入库，不能当作「已在 CI 里跑的闸门」），且只做同次运行比较。
2. 这批基线按 E7 的三选一处置：A 接 CI、B 降级人工参考、C 删除。若选 A，必须先解决抓拍不可复现与过渡盲区，否则接进去只会产出假红或恒绿。
3. 无论选哪个，**不要在没有修抓拍口径前重录**：那会把某一刻的相位渐变固化，下一轮又对不上。

---

## 4. 一句话总结

这 169 个产物能证明的是"当前画面与旧基线不一样"，不能证明"FSM 改没改画面"。前者由 44px 布局裁切与石板材质漂移造成，后者需要拍到一个只有 180ms 的过渡期——而现有夹具从未拍过它。修尺寸、重录基线都只是让"不一样"变小；真正能回答 FSM 问题的判据，是同次运行比较的过渡闸门。
