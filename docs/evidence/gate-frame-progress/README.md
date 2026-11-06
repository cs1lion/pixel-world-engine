# 压暗判据改帧进度 + render-budget fps 降为记录项（2026-11-06）

- 分支：`fix/gate-frame-progress`（从 `origin/main` 的 `0f71d9c` 切出）
- 改动位置：
  - [capture.mjs](../../../world-client/scripts/lib/capture.mjs)（`waitFadeSettled`：`capMs` → `maxFrames`）
  - [check-phases.mjs](../../../world-client/scripts/check-phases.mjs)（两处断言文案）
  - [check-phases-negative.mjs](../../../world-client/scripts/check-phases-negative.mjs)（重写为正控 + 反例）
  - [check-render-budget.mjs](../../../world-client/scripts/check-render-budget.mjs)（fps 三类降为记录项）
  - [ci-attempt1-audit.mjs](../../../scripts/ci-attempt1-audit.mjs)（attempt-1 只读查询入口）
- 口径说明：[GATE_CALIBRATION.md](../../GATE_CALIBRATION.md) §9；问题登记：[OPEN_ISSUES.md](../../OPEN_ISSUES.md) E3 / E5

## 一、压暗收敛：墙钟毫秒 → 帧进度

### 判据

`waitFadeSettled` 改为**只数探针取样帧**：取满 `maxFrames = 60` 帧仍未连续 3 帧逐字节相同，
返回 `settled:false`。`waitedMs` 只作读数，不参与判定。

### 为什么帧进度比墙钟可靠

压暗层在 `phase-view` 里按**帧 delta** 累加（`FADE_MS = 900`），推进的是世界/渲染帧的进度。
墙钟只是机器快慢的副产物：同一份代码在共享 runner 上要 6217–8226ms 才凑够同样的帧进度，
本地只要 319–840ms。按毫秒判，阈值等于在赌「最慢的那台机器」；按帧判，判据只问
「压暗层推进完了没有」。

### N = 60 的依据

| 环境 | 实测 | 备注 |
| --- | --- | --- |
| 共享 CI runner（最差） | **8226ms / 31 帧** | run `42162501101`，6fc7b5e |
| 共享 CI runner | 6217ms / 25 帧 | run `42157897952`（attempt 1） |
| 共享 CI runner | 6248ms / 24 帧 | run `42154120584`（attempt 1） |
| 本地 Windows | 319–840ms / 3–14 帧 | 本轮正控 1216ms / 8 帧 |

60 ≈ 31 的 **1.9 倍**，覆盖「比已知最慢 runner 再慢一倍」。留余量的理由：探针每取一帧都要
一次截图，取帧本身也花机器时间；余量不是为了遮红——反例证明跑到第 60 帧仍然红。

### 反向用例（必需，已跑）

命令：

```powershell
node node_modules/vite/bin/vite.js --port 5211 --strictPort
$env:PIXEL_WORLD_URL='http://127.0.0.1:5211/'
node scripts/check-phases-negative.mjs
```

读数（2026-11-06 本机）：

```
[正控] probe frames=8 maxFrames=60 waitedMs=1216 settled=true
ok   night（雨前）压暗层 60 帧内收敛  等待 8 帧（墙钟 1216ms，仅作读数）
[反例] weather=rain say=ok
[反例] probe frames=60 maxFrames=60 waitedMs=7835 settled=false
FAIL night（雨幕）压暗层 60 帧内收敛  等待 60 帧（墙钟 7835ms，仅作读数）
[反例] 反例成立：雨幕逐帧在动，第 60 帧（上限 60）仍未收敛 → 闸门判红。
```

脚本自身**退出 0 = 反例成立**（闸门恰在帧上限处判红）；**退出 1 = 反例失效**
（探针退化成永远绿/永远红）。该脚本不进 CI 绿闸。

> 残留盲区：26×26 小样区在雨幕里可能「连续三帧没有雨滴穿过」而假收敛（实测 2146ms / 15 帧）。
> 本轮只换上限口径，未换采样区，已登记 OPEN_ISSUES E3。

## 二、render-budget：fps 三类降为记录项（**这是放宽**）

### 改了什么

`0.9×` 恢复帧率、拖动帧率、`前台/3` 后台降频三类断言由 `check()` 改为 `record()`：
照常打印、照常写进 `render-budget-samples.json` 的 `records` 数组，但不并入 failures、
不触发 `exit 1`。**硬闸门只剩**：绘制指令数（< 30000）、Graphics 对象数（< 40）；
「全程无 JS 报错」不是 fps 指标，保持硬闸。

### 为什么降级（代价写在这里）

共享 runner 上 fps 读数分不清「机器慢」与「引擎变重」：同一份代码前台 19 帧 vs 57 帧。
`前台/3` 在 19 帧时算出 **6.33**，已经贴到 Chrome 后台约 10 帧的地板，**结构上不可达**；
`0.9×` 的拖动/恢复比值同样在慢机上假红。

**这是放宽**：代价是中小幅度的真实性能退化在 CI 里看不见了。要看那种退化，只能靠本地
口径已钉住的 `scripts/fps-protocol.mjs`（钉世界与机位，两轮中位 59.9/59.9、极差 0），
它是记录项，不是阈值闸。

**保留的硬闸仍能抓住**：大幅退化。绘制指令翻倍即 > 30000，必红；新增常驻 Graphics 会顶到 40。

### 反向用例（必需，已跑）

正常跑（exit 0）：

```
[硬闸门]
ok   [计分轮] 绘制指令低于 30000  [计分轮] 实际 15515
ok   Graphics 对象数量正常  实际 28
ok   全程无 JS 报错
[记录项]（只打印/落盘，不阻塞）
pass 拖动时帧率不明显低于静止（记录项，不阻塞）  静止 52.4 / 拖动 50.8
pass 切到后台真的降频（记录项，不阻塞）  前台 57.0 / 后台 11.0
pass 回到前台恢复满帧（记录项，不阻塞）  恢复整段 59.9 / 末秒 59.9 / 逐秒 59.9/59.9/59.9/59.9
渲染预算：硬闸门 3 项通过；记录项 3 项不阻塞
```

反例（`RENDER_BUDGET_FORCE_COMMANDS=20000`，exit 1）：

```
[硬闸门]
FAIL [计分轮] 绘制指令低于 30000  [计分轮] 实际 35515（实测 15515 + 反例人为抬高 20000）
ok   Graphics 对象数量正常  实际 28
ok   全程无 JS 报错
[记录项]（只打印/落盘，不阻塞）
（三条全部 pass）
渲染预算失败 1 项（硬闸门）
```

即：硬闸门仍然会红，降的只是 fps。该环境变量只给反例用，CI 不设置。

## 三、attempt 1 留痕

GitHub 的默认视图（网页、`gh run list`、不带 `--attempt` 的 `gh run view`）只显示最新 attempt，
重跑成功会把首跑的红藏起来。review 必须：

```powershell
gh run view <run-id> --attempt 1
```

本轮被掩盖的 5 次：`42157897952` / `42154120584` / `41780154730` / `41698910545` / `41686628894`。
只读批量入口（不进 CI）：

```powershell
npm run ci:attempt1 -- --since 2026-11-04
```
