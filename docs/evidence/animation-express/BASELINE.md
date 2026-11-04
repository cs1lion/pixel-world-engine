# 动画表现力线 · 基线读数（改造前）

时间：2026-11-04
分支：`feat/animation-express`（worktree `D:\project\pwe-anim`）
HEAD：`ab9ac9d`

## 三枚指纹（200 步 × 60 世界秒，默认世界，memory/creator 开启）

```
run1={"world":"50b442c7cdaa95b319c2a34ca1fd0ff80cb630f4b0fc38b0093dc50bf25eee69","memory":"9cf70a7265f477ec03a28ed8ba7611b6f12696218cec209a6bc023e9567fed19","creator":"2f6dfee9717bf2d0c9858814e463fe352988c846a83b9fa8bdf59d47304b4ad1"}
run2={"world":"50b442c7cdaa95b319c2a34ca1fd0ff80cb630f4b0fc38b0093dc50bf25eee69","memory":"9cf70a7265f477ec03a28ed8ba7611b6f12696218cec209a6bc023e9567fed19","creator":"2f6dfee9717bf2d0c9858814e463fe352988c846a83b9fa8bdf59d47304b4ad1"}
identical=true
```

复跑命令：`cd world-client && node scripts/anim-express-probe.ts fingerprints --steps=200`

## 三枚指纹（改造后，同一命令）

```
run1=...（与改造前逐字相同）
run2=...（与改造前逐字相同）
identical=true
```

## 指令 / Graphics 基线（`check-render-budget`，SwiftShader）

- 改造前计分轮：`16162` 指令 / `28` 个 Graphics。
- 改造后计分轮：`15514` 指令 / `28` 个 Graphics（`-648`，`-4.0%`）。
- 差值原因：两次采样不在同一世界时刻；结构没有增删 Graphics 对象。

