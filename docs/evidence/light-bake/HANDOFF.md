# 光层烘焙 · 交接文档（HANDOFF）

> 2026-11-09 12:3x 生成。**接手人不需要读任何会话记录**，本文自包含。
> 组成：起点核验 → 两件事 → 硬边界 → 已收口 → 待裁决 → 第一小时检查清单。
> 标记：**【核】** = 本轮用当前仓库状态实测核对；**【原文】** = 交接原文，未改；**【建议】** = 可推翻的判断。
> 配套：`DIFF-TABLE.md`（三块单层差表，第 0 步**已实测完成**）与同名 `.html` 预览。本线已收口，见 §2.4。

---

## 0. 起点核验：先看这一节，有若干处与交接原文不一致

| 项 | 【原文】 | 【核】当前实测 | 处置 |
|---|---|---|---|
| `main` | `3a3f553` | **`d1b5bd3`**（`main` = `origin/main` = `HEAD`，`git rev-parse` 三值相同） | `3a3f553` 是「建筑静态层逐层烘焙」，现在是 main 往前两笔的**祖父**。取基线一律用 `d1b5bd3` |
| 工作树 | 干净 | 交接撰写时干净。**收口后**：实验装置已撤，`setting-scenery.ts` 与 HEAD 逐字一致；本线只剩未跟踪 `.workbuddy/`、`docs/evidence/light-bake/`、`world-client/tmp/light-bake/` | **另有三处 tracked 改动不是本线的**：`CLAUDE.md`、`docs/evidence/ENVIRONMENT_BUILDABILITY.md`、`.githooks/pre-push`，是并行会话在做「main 远端保护」加固，仍在实时变化。**本线一行都没碰它们，接手人也别 `git restore` 别人的文件**。阈值 / 天花板 / 基线 / main / PR 一律没动 |
| PR #36 | 四绿未合，分支 `docs/w2-junction`，`80329b6` | **已 MERGED**，`mergedAt 2026-11-09T01:48:51Z`，`mergeCommit = d1b5bd3`，四项 check 全 SUCCESS | **第一件事已完成，不要重复合、不要 force push、不要重建 PR** |
| `80329b6` | PR 分支提交 | 是 `docs/w2-junction` 的原始第一笔；rebase 合入后 main 上对应 `6476c4a`，第二笔是 `d1b5bd3`。分支当前指 `674e022` | 别按 `80329b6` 去 main 里找基线；它是 rebase 前的 SHA |
| 名为 AGENTS.md 的那份文件 | 必读三份之一 | **本仓不存在**（`find` 全仓无匹配） | 等效入口是根目录 `CLAUDE.md`（11 道闸门 / 权限边界 / 断点续跑）+ `GLOSSARY.md`。必读三份实际是：`CLAUDE.md`、`docs/ENGINEERING_DISCIPLINE.md`、`docs/OPEN_ISSUES.md` 的 O4 |
| `25 张` | 与「49 帧 / 40 张」并列成第三组 | 是 **40 张里的子集**（原文「含 25 张基准 + 4× 裁剪」） | 等价证据是两组：49 帧穿行 + 40 张产物；写成三组是重复计数 |
| 纪律条目数 | 44 条 | **45 条**：C1–7 / T1–4 / V1–5 / E1–8 / B1–5 / W1–4 / M1–6 / L1–3 / X1–3，编号连续无跳号 | 按「44 条」去数会漏一条。W2 的 junction 四次事故在 W2 条目内，不受条数影响。O4 是 `OPEN_ISSUES.md` 里 O 节最后一节，其**最新一条账确实是建筑烘焙**（后面全是这一笔的等价证据与纪律，不是新账） |
| main 受保护 | 远端保护 | **2026-11-09 已开**：必须走 PR、四项检查（`world-client` / `world-client-browser` / `repo-harness` / `server`）全绿才能合、禁强推/删除、`enforce_admins=true`。此前「API 404 = 没权限」是误判（404 意为「未受保护」）。本地 `.githooks/pre-push` 为第二道，`core.hooksPath = .githooks` 已装 | 远端现在会挡直推（`GH006`）；`PWE_ALLOW_PUSH_MAIN=1` 只跳过本地那道。新 clone 没继承钩子时，远端仍兜底 |

复核命令（接手人第一遍先跑）：

```bash
git status --short --branch
git rev-parse main origin/main HEAD
git log -6 --oneline --decorate
gh pr view 36 --json number,state,mergedAt,mergeCommit,statusCheckRollup
npm run check:hooks
```

---

## 1. 第一件事：PR #36 —— 【核】已合，无需执行

W2 那条 junction 纪律改写是纯文档，两笔已线性落在 main 上：

```
6476c4a  docs(discipline): W2 补 junction 三条禁令与取对照的正确顺序（第四次实测）
d1b5bd3  docs(discipline): W2 把「不加 --force 也不安全」改成实测/推断分明   <- main / HEAD
```

四项 CI：`world-client` / `world-client-browser` / `repo-harness` / `server` 全 `SUCCESS`。
**接手人从这里开始就是第二件事。** 若你看到的仍是「未合」，先 `git fetch` 再复核，不要合并。

---

## 2. 第二件事：光层烘焙，约 7,102 条

三块：灯压暗环 **3,078** / 地面光池 **2,552** / 灯体+灯绳 **1,472**。

### 2.1 口径【原文，一条不改】

- **版本向量只放三轴**：「亮/灭 × 潮位 × 相位」。
- **连续量走 alpha**：呼吸、亮度这类连续量走 `Image` 的 `alpha`，**不进闭包**。
- **双缓冲 `a` / `b`**：新烘完才换指针，**不许 `remove` 掉还在用的纹理**。
- **每块先单层量差**：每块单独烘一次，量**逐字节差**和**最大色阶差**，**差非 0 就留活**（这一层退回逐帧绘制，不烘）。
- **三层混一起测会把问题盖掉**：招牌 α 叠色那次 max 差 **31** 就是教训（见 `docs/OPEN_ISSUES.md:1288–1292`）。
- 第一步**不是写代码**，是出三块各自的单层烘焙差表。

> **【核】三轴里有一处要在动代码前补口径**：潮位 `level` 是 0..1 的连续量
> （`lampPoolBands(level)` 连续改光池半径与强度），把它当版本向量的一轴，就必须先**离散成档**，
> 否则每帧潮位都变、纹理每帧重烘，双缓冲 `a`/`b` 等于没有。口径不改，档数待定。

### 2.2 第 0 步已完成：三块单层差表**实测**（2026-11-09 12:5x 起、13:3x 完成）

文件路径 `docs/evidence/light-bake/DIFF-TABLE.md` §3（+ `.html` 预览）。为量差临时加了
`?bake=` 实验装置并起了 5211 服务（**当时的临时装置，未提交、不进主线；收口时已撤，见 §2.4**）；
基线在产品代码未改时抓取，sha256 `ba55dd0ad14d4532`，与建筑烘焙 bisect 基线**同哈希**。

| 配置 | 条数 | 变化像素 | 最大色阶差 | 判定 |
|---|---:|---:|---:|---|
| `none` 自校验 | — | **0 px** | 0 | 装置不污染画面 |
| `blank` 全图空纹理对照 | — | **0 px** | 0 | 全屏透明 quad **无伪影** |
| `shade` 灯压暗环 | 3,078 | **32,688 px** | **14** | **留活** |
| `pool` 地面光池 | 2,552 | **49,400 px** | **17** | **留活** |
| `body` 灯体 + 灯绳（Image 插到末尾） | 1,472 | **3,564 px** | **114** | **留活** |
| `bodySorted` 同上但**保序** | 1,472 | **3,452 px** | **1** | **留活** |

口径与归因见 `DIFF-TABLE.md` §3.1–3.4，四条要点：

1. `shade` / `pool` 是 α<1 叠色「烘一张再叠回地面 = 两次合成」的**本质差**，与建筑
   `back` max 1 / 招牌 max 31 同类。
2. `body` 的 max 114 是**完全不同的颜色**（暗青绿 → 暖橙灯笼色），源于 Image 后 `add`
   改变了同 depth 的 displayList 顺序 —— **装置引入**。
3. **保序对照已实测**：`bodySorted` 把 Image 移回原索引后 max **114 → 1**，只剩 ±1 量化差，
   与建筑 `back`（4,096 px / max 1）同量级同成因。上轮的推断被证实；**但 1 仍非 0，仍留活**。
   包围盒纹理省不掉这一次额外合成，`blank` 已证全图透明 quad 无伪影 ⇒ 第二条岔路走到头了。
4. 第一次跑（烘在第一次 `update()`）的 34,284/max 32、52,716/max 18、5,996/max 177
   是**错帧脏读数，已作废**；以显式触发后的 after2 / after3 为准。

**结论：三块差全非 0 → 按「差非 0 就留活」，三块全部留活，本轮不烘任何一块。**
装置只量像素差，各配置 `totalCommands` 一律 **28,339**，**没有产生命令数下降**。
`body` 在两次独立跑里 hash 同为 `42772f29599dcd8e`，读数可复现。

差表里另外三条仍要带进后续决策：

1. **3,078 不是「只有压暗环」**：`root.19` 是整张 `lampLight`（depth 700）——三档 `ink` 压暗环 + 灯体光晕/灯芯 + 桥灯亮灭两态 + 店面窗光（见 `setting-scenery.ts` 的 `update()` 里 `lampLight` 那一段）。按「单层」量之前要先决定切不切开，否则「单层」指的不是一块。
2. **1,472 在逐对象读数里没有单独成组**：`lampRows` 与 `stallRows` / `bannerRows` 共用 `sceneryDepth(row, altitude)`，13xx–14xx 段 12 个 Graphics 混着别人的内容。实现时用 `__layerCmds`（建筑烘焙那套）单列，才有可核验的 1,472。
3. **读数来自建筑烘焙工作期的旧构建**（`world-client/tmp/budget-map/{noon,dusk,night}.json`）。建筑烘焙没碰 `setting-scenery.ts`，故条数在 main 上应仍成立——**这是推断，未同构建复测**。`34,037 / 34,613` 与建筑烘焙后的 `28,076` 不同源、不相减（B4）。

**「烘前/烘后」三行现已由实测填上，没有拿建筑烘焙的差（4,096 px/max 1、招牌 max 31）
或雾烘焙（max 2/255）顶数，也没有按 α 推一个数字填进去。**

### 2.3 判据【原文】

1. 两道闸各自报**改造前 / 改造后**读数：`check-ground-shadow` 与 `check-render-budget`。
2. **49 帧逐字节 0**：16:00→20:00 每 5 分钟、潮位钉 1、晴、默认镜头、8 帧沉降；基线双跑 49/49 同哈希。
3. **补 18:00 点灯与 05:00 熄灯前后各 5 分钟**——亮/灭切换是版本向量的第一轴，只测稳态会漏掉换纹理那一帧。
4. **一份烘焙 Image 的对齐断言**：落点 / 原点 / 尺寸 / **四边 alpha=0**，照 `scripts/check-building-bake.mjs` 抄（每层一张、不重不漏）。

### 2.4 本轮实际做了什么 / 还没做什么

- **已做**：`?bake=shade|pool|body|bodySorted|blank` 实验装置（临时工作区改动，**收口时已撤并导出
  patch 存档**）、`world-client/tmp/light-bake-shots.mjs`、改造前基线 + 六组截图与 after2 / after3
  读数，逐块算 `count / max / maxAt / bbox`，并做 `body` vs `bodySorted` 的**保序对照**。
  取改造前对照用「**先跑基线再改代码**」，未开 worktree、未用 `git stash`、未切分支
  （W2 的目的已满足，见 §3）。
- **未做（不是遗漏）**：两道闸前后读数 / 49 帧逐字节 0 / 18:00 点灯与 05:00 熄灯前后各 5 分钟 /
  Image 四边 alpha=0 断言 —— 这四项是**实现后的验收**；三块都留活 ⇒ 本轮没有实现可验。
- **两个岔路的处理**：① 收口 / ② 修保序重试 body —— **② 已走完并关闭**：保序把 body 的 max
  从 114 压到 1，但 1 是两次合成的本质舍入，包围盒纹理也消不掉；三块结论不变，仍全部留活。
  **已按 ① 收口（2026-11-09）**：`setting-scenery.ts` 用 `git restore --source=HEAD` 恢复，
  对该文件 `git diff` 为空；原 +83 行装置导出为 `world-client/tmp/light-bake/light-bake-experiment.patch`
  （104 行，`git apply` 可重放）。7,102 条不省。**复跑必须先 apply patch**，否则脚本读不到
  `?bake=` 开关会得到全 0 的假绿，详见 `DIFF-TABLE.md` §5。要翻案只有「改判据允许容差 ≥1」或
  「换合成路径」，两者都需单独裁决，**不要在本轮差表上直接调参凑 0**。

> **【核】一个会毁掉读数的坑**（保留）：O4 记载单时刻 `peakCommands` 会因村民走位漂 **±120 条**
> （`docs/OPEN_ISSUES.md:1234–1271`）。量「单层差」若读命令数，必须**多时刻取最大**或**钉姿态采样**，
> 否则把走位噪声记成烘焙增量。逐字节截图差不受此影响，但两道闸的前后读数受影响。
> 本轮各配置的 `totalCommands` 全为 28,339，正是「只量像素差、不量命令数」的结果。

---

## 3. 硬边界【原文 + 仓内出处】

| 边界 | 原文 | 【核】出处 / 复核 |
|---|---|---|
| 端口 | 只用 **5210–5299** + `--strictPort` | `ENGINEERING_DISCIPLINE.md:319–324`（W3）。**坑**：`audit:ports` 只禁 5188/5191/5202/5203，**不检查 5210–5299 范围**；连接前跑树身份闸 `/__tree-id`，避开 5212（给 accept-live） |
| push | push 前必须 `git fetch` | 本地 hook 不查这个；靠人执行 |
| main | 受保护，走 PR | **【核】远端已开保护**：`gh api` 查 `branches/main/protection` 实测 `enforce_admins=true`、禁强推 / 禁删除、四项必需检查（world-client / browser / repo-harness / server）、`required_approving_review_count=0`。本地 `.githooks/pre-push` 是第二道，`core.hooksPath` 已装。交接原文「API 404 = 没权限」是误判，404 意为「当时未受保护」 |
| 阈值 | **不许改阈值、不许改天花板**（`check-ground-shadow` 34,666 / `check-render-budget` 33,488） | 常量实测：`check-ground-shadow.mjs:85` = `34_666`；`check-render-budget.mjs:106` = `33_488`（原文写作 34,666 / 33,488，**同一常量、两种写法**）；`scripts/policy-ceilings.json` 两个值同。`test/policy-ceilings.test.ts` 会红 |
| 基线 | **不许重录基线** | `eval/screens/` 下已跟踪件；出图 gate 默认写 `world-client/tmp/screens/<脚本名>/`，写回基线须显式 `--write-baseline` |
| 临时 worktree | **不要开**：`Remove-Item -Recurse`、`rmdir /s`、`git worktree remove --force` 三个都会顺 `node_modules` junction 删掉主树依赖，本机踩过**四次** | `ENGINEERING_DISCIPLINE.md:304–316`（W2，四次事故逐条有读数）。回收后必跑 `npm ls --all | Select-String invalid`（须空）与 `npx vite build`（须成功） |
| 取改造前对照 | 先提交 → `git switch --detach <base>` → 跑 → `git switch` 回；产物用 `git show HEAD:<path>` / `git archive`；**不用 `git stash`** | `ENGINEERING_DISCIPLINE.md:309`；共用同一份 `node_modules`，锁文件没变不重装 |
| 红先 | 像素等价重构**不要求红先**（revert 与纯重构在 base 上都会绿，硬凑是假红）；但**提交信息必须写明为什么没有红先**，并用「峰值下降实测 + 逐字节 0」替代 | 建筑烘焙 `tmp/pr-body.md` §「无红先」是现成模板 |

---

## 4. 已收口，别再碰

- **建筑烘焙**：`check-ground-shadow` **34,573 → 28,076**（余量 **6,590**）、`check-render-budget` **33,445 → 25,167**（债务归零）；49 帧 + 40 张产物全 0 diff（`docs/OPEN_ISSUES.md:1273–1283`）。72 张烘焙 Image 在 `renderStats` 里记 **0 条**——是「从统计里消失」，不是 GPU 少画。
- **HD-2D P2**：已按停手判据关闭，负面结论在 `docs/investigations/HD2D_P2_TILT_BAKE_NEGATIVE.md`（PR #34 已合）。**不做 P3、不换实现重试**；S-9 已关。
- **花径几何 / 作息**：`x2..11`、中央 2 格净空、南口 6 宽、两人并排进花径停留，已落（`OPEN_ISSUES.md:1133–1137`）。别重开。
- **两条远端分支**：`exp/hd2d-p1`（PR **#30 仍 OPEN + draft**，标题写明「仅供 CI/审阅，不合并」；含 H1/H3 高度渲染与 E15 号占用）、`feat/hd2d-p2`（无开放 PR）。
  **【建议】都不合**，保留只读实验记录；花径线也占 E15，撞号已有防御（提交前 grep、顺延 E16）。

---

## 5. 待裁决四项 + 一条建议

| # | 事项 | 【建议】 | 依据 |
|---|---|---|---|
| 1 | 12 条翻书核对单 | **按 B 档做，文档里如实标 B**；拍图才升 A | 本机画册 99 页、无文字层，出处 `docs/SPEC_V2.md:12`（《The Art of Spirited Away》99 页扫描版）；p110–111 的降级清单在 `docs/OPEN_ISSUES.md:1082`。**两者确实不是同一份来源**，花墙/木栅/石垣/瓦顶/庭心石作/配膳间全是仓库转述 |
| 2 | 粉紫（第 25 色） | **不开**，维持现值 24 | 藤紫原话语义是「神秘事件、神灵」，铺花床属换用途；杜鹃/绣球只有转述。加色需 `docs/adr/ADR_PALETTE_24.md` 走 ADR |
| 3 | 夜里补光 **+306** | **认它是「新增功能」，但这一轮不做** | 预算障碍已解封（余量 6,590），但 `OPEN_ISSUES.md:1165–1206` 的 11-09 更正实测：花径夜间平均亮度 **61.4**、`luma<8` 为 **0.00%**，关掉 28 盏街灯主街也只变 **11.80%** 像素。边际观感撑不起一次 B2 单独记账；先吃 +0 的花墙形制与庭心石作 |
| 4 | 配膳间 **+1,008** | **不做** | 零依据（C 档）与钱无关。本仓 `docs/` 全文只有 `OPEN_ISSUES.md:1230` 一处转述「设定集有配膳间，本包 placements 里没有」；设计手册原文不在本仓，**「全文搜 0 处」无法在本树复核** |
| + | 第二轮烘焙池（美术静态 4,450 / 摆件 3,353 / 街面+桥 3,913 / 辉光 2,160） | **同意明写「不建议再做」**：债务已归零，继续压只是数字好看 | 同一把尺子下，**光层 7,102 也落在「债务已归零」里**。它排第 5「等额度」而额度已不是障碍——开工前把做它的理由（性能？帧率？还是数字）说清，否则差表量完仍不知道为什么烘 |

---

## 6. 接手人第一小时：可粘贴检查清单

```bash
cd /d/project/pixel-world-engine

# 1) 起点（对照 §0）
git status --short --branch
git rev-parse main origin/main HEAD
git log -6 --oneline --decorate
git fetch
gh pr view 36 --json number,state,mergedAt,mergeCommit
npm run check:hooks

# 2) 必读三份（AGENTS.md 本仓没有，读 CLAUDE.md）
#    CLAUDE.md / docs/ENGINEERING_DISCIPLINE.md（W2 :304-316、W3 :319-324、B1-B5 :254-292）
#    docs/OPEN_ISSUES.md 的 O4 :1177-1214 与建筑烘焙账 :1216-1261

# 3) 差表与模板
#    docs/evidence/light-bake/DIFF-TABLE.md
#    world-client/scripts/check-building-bake.mjs（Image 对齐断言）
#    world-client/tmp/bake-bisect.mjs（单层 diff 函数，一次性脚本、不提交）

# 4) 起服务（端口在 5210-5299，避开 5212）
cd world-client
npm run dev -- --port 5211 --strictPort
# 另开一个 shell，连接前树身份闸：
#   PIXEL_WORLD_URL=http://127.0.0.1:5211/ ...

# 5) 改造前对照：先提交 -> git switch --detach d1b5bd3 -> 跑 -> git switch feat/light-bake
#    产物导出用 git show HEAD:<path> 或 git archive；禁止 git stash / 临时 worktree
#    注意：本树可能有并行会话留下的 tracked 改动（见 §0），切分支前先确认归属，
#    别把别人的改动带过去，更不要 git restore 别人的文件（W1）
```

**停手线**：任何一块单层烘完，逐字节差 ≠ 0 或最大色阶差 ≠ 0 → **该块留活**，不做「调参让它变绿」，不合并三块一起测。

---

## 一句话

**PR #36 早已合、三块单层差表已实测（32,688/max 14、49,400/max 17、3,564/max 114；保序把 body 压到 3,452/max 1 但仍非 0）⇒ 三块全部留活；第二条岔路已走到头，装置已撤、patch 存档、7,102 条不省，本线收口，不要调参凑 0。**
