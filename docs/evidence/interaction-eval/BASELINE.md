# 实验 0（baseline）：村民交互 EDD 评测集

> 这一轮**只做 eval，没有写任何 D3 功能代码**。读数来自真实跑过的
> `world-client/scripts/eval-interaction.mjs --split all --run baseline-0`，
> 逐条原始记录同目录下的 `baseline-0.json`。

## 条件

| 项 | 值 |
|---|---|
| 被测版本 | 已接入 7 张分人动作表（C 方案），**交互面板动作尚未实现** |
| URL | 本工作树 preview，`PIXEL_WORLD_URL` 指向 5241，树身份闸通过 |
| 数据集 | `main.json` 10 条 + `held-out.json` 6 条，共 16 条 |
| 环境 | 每条 example 独立 context、清存档、固定 `?now` 与相位 |
| 判定 | 有 fail 即 `exit 1`（真红，不是把输出变长） |

## 结果：4 通过 / 12 失败

| id | 结果 | 首行读数 |
|---|---|---|
| M1 | FAIL | `#villager-panel-actions` 应存在且只有一份 |
| M2 | FAIL | 应有 3 个动作按钮 |
| M3 | FAIL | 每个动作按钮要有一张图标 |
| M4 | FAIL | 派活按钮不存在，往返无从发起 |
| M5 | FAIL | 给东西按钮不存在 |
| M6 | FAIL | 问一句按钮不存在 |
| **K1** | **ok** | 面板打开时世界仍推进：`now 32460000 → 32478000` |
| **K2** | **ok** | `?art=0` 素材请求 0 个（已排除构建产物） |
| **K3** | **ok** | 冻结后变化 `art=1 890 px / art=0 1050 px`，未显著变大 |
| **K4** | **ok** | `schemaVersion 8 → 8`（读自真实存档） |
| H1 | FAIL | 派活按钮不存在 |
| H2 | FAIL | 给东西按钮不存在 |
| H3 | FAIL | 派活按钮不存在 |
| H4 | FAIL | 问一句按钮不存在 |
| V1 | FAIL | 派活按钮不存在，往返无从发起 |
| V2 | FAIL | 派活按钮不存在，往返无从发起 |

**12 条红全部是预期的**：它们都在断言「功能还不存在」，没有一条是超时、
模块错误或页面崩溃。这正是 EDD 的实验 0——先有可判红的失败，才有可爬的坡。

**4 条 keep-intact 全绿**说明当前这版（动作表已接入）没有弄坏世界自己跑、
`?art=0` 退路、存档契约和冻结稳定性。后续每笔 D3 改动都要拿这 4 条当回归线。

## 评分器自身的校准（baseline 之前做的事）

第一次跑出来的读数不能直接当基线——评分器自己有三处口径错误，逐个修掉后
才重跑。这段留下来是因为「固定程序判别」的前提是程序本身可信：

1. `K2` 把 Vite 的 `/assets/index-xxx.js` 也算成素材请求 → 改成与
   `world-client/scripts/check-art-assets.mjs` 同口径，只算 `manifest.json` 与 `*.png`。
2. `K4` 从 `view()` 读 `schemaVersion`，读到 `null → null` 的**假绿** →
   改成读真实存档 `dengchao.pixel-world.save.v1` 的顶层 `schemaVersion`，
   并断言它必须是数字。
3. `K3` 最初要求「刚冻住就连续 8 帧逐字节相同」，但正式
   `world-client/scripts/check-ground-shadow.mjs` 的 `shotStable` 是等出现连续稳定帧，
   且前提更完整。做了 A/B：同样前提下 `art=1` 约 982 px 变化、`art=0` 约 816 px，
   **同量级**，证明零散变化不是动作表引入的。于是把判据改成真正该防的回归
   ——「接入动作表后变化量不比 `art=0` 显著变大」，用浏览器 2D canvas 逐像素比，
   不依赖 Python / PIL。正式 `check-ground-shadow` 的 `shotStable` 前提通过
   （G1 有截图与 hash），它的 4 条既有红是 G2/G3 判据，与稳定性无关。

## 一条被纠正的判断：L3-4 不是 spec 变更

实验 0 之后、动功能之前核对了 `world-client/scripts/check-interact.mjs` 的
L3-4：它查的是 `#unit-status` 里的输入控件数量与「干涉世界」提示语，而交互
动作按钮放在 `#villager-panel` 的独立容器，`#unit-status` 完全不变。
**那条断言不会红，也不需要改。**

先前把它判断成「有意的 spec 变更」是错的；若照那个判断去改一条本来绿的断言，
反而是在覆盖已工作的行为（EDD 文章里 VPN 那个例子的同型错误）。更正为：
L3-4 原样保留，「动作按钮不许漏进 unit-status」由本数据集的 M1 用
`forbiddenIn` 自己守。这一条更正本身也是 baseline 校准的一部分。

## 接 CI 的时机

现在不接：主集还红着，接进去只会挡住所有 PR。等主集 10 条全绿那一笔，把
`node scripts/eval-interaction.mjs --split main` 加进
`.github/workflows/ci.yml` 的 browser job 作为阻断；备用集与环境变体维持
合并前 / 夜跑，迭代过程中不看。

## 实验序列（EDD 的爬坡）

`baseline-0` 是 `--split all`（16 条），`exp-1..4` 是 `--split main`（10 条），
`heldout-1/2` 是 `--split heldout`（6 条）；口径不同，比较时按各自分母看。
逐条原始读数同目录的 `.json`。

| run | 做了什么 | 结果 | 逐条变化 |
|---|---|---|---|
| `baseline-0` | 只有动作表，无交互功能 | 4/16 | 4 条 keep-intact 绿，12 条交互红在「功能不存在」 |
| `exp-1` | 笔 1：只加「派活」+ `assign` 命令 | 7/10 | M1 / M3 / M4 转绿；回执「给炉匠派了活。神谕已送达 炉匠铺。」；M2 仍红（1/3 按钮） |
| `exp-2` | 笔 2：只加「给东西」（`setCarries` 来回） | 8/10 | M5 转绿；M3 变 2 张图标；M2 仍红（2/3） |
| `exp-3` | 笔 3：只加「问一句」（`ask` 命令，世界自己答） | **10/10** | M2 / M6 转绿；回执「炉匠说：躲到屋檐下看雨。」 |
| `exp-4` | 笔 4：D4 素材收口 + 删 `emote-09` + 接 CI | **10/10** | 4 条 keep-intact 全程未红 |
| `heldout-1` | 功能完成后补齐备用集判据 | **6/6** | H1 拒收说明原因、H2 只改被点名的人、H3 连点不多出任务、H4 不留半截任务；V1/V2 两条环境变体通过 |
| `heldout-2` | 最终版复跑 | **6/6** | 同上 |

**逐条比较而非看通过数**：从实验 0 到实验 3，每次都是新用例转绿、
4 条 keep-intact 保持绿，没有任何一条先绿的用例被后续改动弄红。
`exp-2` 曾因类型错误导致 build 没过、测到旧构建，那份读数已作废重跑。

## 一处纪律妥协（如实登记）

备用集 `H1..H4` 的判据是在功能完成之后才补齐的（实验 0 里它们是占位
`assert.fail`）。严格 EDD 应当**先写全部 eval 再写功能**，所以这一轮在
备用集上没有完全做到 eval-first。主集 M1..M6、K1..K4 是 eval-first。
下一次新行为应当把两集的判据都先写完。

## 接 CI

主集在 `exp-3` 全绿后才把 `node scripts/eval-interaction.mjs --split main`
加进 `.github/workflows/ci.yml` 的 browser job，作为真阻断（有 fail 即
`exit 1`，不用 `continue-on-error`）。备用集与环境变体维持合并前 / 夜跑，
迭代过程中不看。
