# 05 · `phase-night-rain.png` 基线漂移读数（2026-11-06）

> **结论**：这张图和已提交基线**不同**，差异不在雨丝相位，而在**居民精灵**。
> 已按「生成物如实还原」纪律执行 `git checkout -- world-client/eval/screens/phase-night-rain.png`，
> 工作树里的文件恢复为 HEAD 版本，`git status` 里 `eval/screens` 干净。
> 漂移成因是 night-rain 这一镜**没有钉居民、没有冻钟**，不是渲染器变了。

## 1. 两个 sha256（逐字节比对）

| 版本 | sha256 | 字节数 |
|---|---|---|
| HEAD / 还原后工作树 | `58de4e1dd491b1a694b46223f226079dc044b5ee479692f1caae623220d37435` | 22373 |
| 闸门重写后的工作树（还原前测得） | `f7fa5a623e33d7cb6ab6938227a08391277d13f394297324d0ca04111d106f5a` | 22169 |

判定：**不同** → 按用户裁决不保留漂移文件，执行还原；还原后两者再次逐字节相同。

复算命令（Node 读 Buffer，不经 PowerShell 文本管道，避免编码污染）：

```text
node -e "const {execFileSync}=require('child_process'),c=require('crypto'),fs=require('fs');const root='<worktree>';const rel='world-client/eval/screens/phase-night-rain.png';const head=execFileSync('git',['-C',root,'show','HEAD:'+rel]);const wt=fs.readFileSync(root+'/'+rel);const h=b=>c.createHash('sha256').update(b).digest('hex');console.log(h(wt),wt.length,h(head),head.length)"
```

## 2. 「渲染器没变」的旁证：同组四张 phase 图逐字节相同

同一次 `check-phases` 计分轮重写了四张计分 phase 图，它们与 HEAD **逐字节相同**：

| 文件 | sha256 | 字节数 |
|---|---|---|
| `phase-dawn.png` | `f887c58ee5c32f1fab3820af628f599697a176889b46764ffd05c1b935e1b902` | 25329 |
| `phase-noon.png` | `e1a25565bcab9ee063c02de0d9652c7dc7bb527d3746eeea1d927a173ca8b35e` | 21853 |
| `phase-dusk.png` | `5a829c01aad761aef108750d702c5d9073493d9832c61aa414aa7aad08908f28` | 21973 |
| `phase-night.png` | `271dfbe1d33020c6617c67218f73eda3c5dbbafe80ba47eebdfc14880f2494b2` | 21725 |

四张计分图都走 `villagers-inside + clock-pin(00:35) + fade-probe`，重写后字节不变；
只有 night-rain 漂了。⇒ 渲染路径整体没变，漂移是**这一镜的取样条件**造成的。

## 3. 像素级读数（还原前测得）

- 尺寸 `961×641` = **616,001 px**；alpha 通道差 **0**（无透明变化）。
- 单通道绝对差分布：

| 阈值 | 像素数 | 占比 |
|---|---|---|
| ≥1 | 427,246 | 69.358% |
| ≥2 | 14,496 | 2.353% |
| ≥5 | 5,580 | 0.906% |
| ≥10 | 5,451 | 0.885% |
| ≥20 | 3,224 | 0.523% |
| ≥30 | 1,808 | 0.294% |
| ≥60 | 736 | 0.120% |

- 最大单通道差 **91**，RGBA 平均绝对差 **0.517**。
- **≥10 的 5,451 px 集中在顶部中央的居民精灵**：约 `x545–672 / y28–128`，
  最密行 `43–47`、最密列 `553–564`（走路/站立的中间态不同）。
- 全帧普遍的 ±1–2（那 421,795 px）是**雨幕亮度相位**：固定等 3000ms 后雨丝落在不同相位上。

## 4. 成因：哪条 gate 重写、它钉了什么

重写来源：[`check-phases.mjs`](../../../world-client/scripts/check-phases.mjs) 的 night-rain 分支。

- 已钉：`waitFadeSettled`（雨前压暗层收敛）、`Oracle.say('下雨吧')`、固定 `waitForTimeout(3000)`。
- 未钉：**没有** `waitVillagersSettled`、**没有** `jumpWorldClock(35)` / `freezeWorldClock()`、
  **没有** `pinShotState`。抓拍读数如实记成 `method: 'fixed(rain)'`、`frames: -1`。
- 因此居民在雨前仍可能处于不同的行走相位，雨丝也落在任意相位——两跑不可复现。

## 5. 一次误判的更正（写下来避免重犯）

先前读数把差异判为「落在雨丝区域」；细查后高差异块是**顶部中央居民精灵**，
雨丝只贡献整个画面的 ±1–2 底噪。

误判成因：先看到全帧 69% 的 ±1 差异，就把高差块也归给雨幕，没有先算
`≥10` 掩码的 bbox。以后固定顺序：**先按阈值分层 → 再对最高阈值层求 bbox → 才归因**。

## 6. 与 `SCREENSHOT_BASELINE_CHANGES.md` 的关系

该清单在 `pwe-anim` 工作树的分支 `feat/animation-express`
（`docs/evidence/animation-express/SCREENSHOT_BASELINE_CHANGES.md`），共 157 张
（`eval/screens` 152 + `eval/live` 5），其中「基线不可复现」29 张。
**这 29 张里没有 `phase-*` 系列**（清单不含 phase 图），所以 night-rain 之前不在名单内。

本条即该名单的缺项补录：`phase-night-rain.png` 属「三跑/两跑不可复现、每次跑都漂」一类。
该分支合入时，请把本条并入 29 张名单或单列一行，并链接回本文件。

## 7. 处置（本轮）

- 文件：已还原，不保留漂移版本，不更新基线。
- 判据：不改（仍按现状当硬基线跑），待 `docs/OPEN_ISSUES.md` 的登记项拍板后再决定。
