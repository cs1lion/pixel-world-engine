# 村民动画状态机 · 状态与转移

> 本文件由 `world-client/scripts/export-anim-graph.ts` 从 `villager-anim-fsm.ts` 生成；手改会在单测里变红。

## 边界：只做组合与转移，不产生新动作

- 覆盖的 5 个状态只对应**现有画面**：idle / walk / salute / work / deliver。
- 「跑」「坐」「挥手」这类动作**没有对应的帧序列与排版数据**，状态机不产生新帧，也不负责把它画出来。
- 新增一个动作，六样东西要一起补：
  1. 帧序列（`villager-frames.ts` 的 12fps 采样表）；
  2. 排版数据（`villager-layout.ts` 里该 mode 的像素叠加）；
  3. 世界状态（`VillagerMode` 及触发、结束条件）；
  4. 本模块的状态；
  5. 转移（下表 20 个方向里的新增行）；
  6. 时长（初始值，未验证）与单测。
- 状态机真正解决的是「动作之间的组合与打断」，不解决「多一个动作」。

## 状态

| 状态 | 帧数 | 循环时长 | 动作位移 | 说明 |
| --- | --- | --- | --- | --- |
| idle | 2 | 167ms | 0px | 站着呼吸：2 帧，整体上下 1px。 |
| walk | 4 | 333ms | 0px | 走路步态：4 帧，左右脚交替前伸，整体 1px 起伏。 |
| salute | 2 | 167ms | -2px | 行礼：待机两帧 + 下沉 2px；抬手像素由排版层按 mode 叠加。 |
| work | 2 | 167ms | 0px | 干活：待机两帧 + 手持工具每两帧上下 1px。 |
| deliver | 2 | 167ms | -1px | 交付：待机两帧 + 下沉 1px；双手纸片每两帧上下 1px。 |

## 转移

任意两个不同状态之间都有显式时长；下表 20 条覆盖全部打断方向。

⚠️ 所有时长都是**设计初始值，未经验证**。现有系统没有过渡（切表是突变），这些数字不是从既有行为推导出来的，也不是已定契约；第二版接入时以截图对照逐条校准。
世界常量 `SALUTE_MS=700`、`DELIVER_MS=1400`、`estimateMs` 决定的是「停留多久」，不是「淡入淡出多久」；本表没有一条由它们推出（来源列全部是 design）。

| 从 | 到 | 时长 | 来源 | 条件 |
| --- | --- | --- | --- | --- |
| idle | walk | 120ms | design（未验证） | 意图为 walk：walking=true（脚下还有没走完的路）。（从 idle 打断） |
| idle | salute | 90ms | design（未验证） | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 idle 打断） |
| idle | work | 150ms | design（未验证） | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 idle 打断） |
| idle | deliver | 180ms | design（未验证） | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 idle 打断） |
| walk | idle | 140ms | design（未验证） | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 walk 打断） |
| walk | salute | 160ms | design（未验证） | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 walk 打断） |
| walk | work | 150ms | design（未验证） | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 walk 打断） |
| walk | deliver | 200ms | design（未验证） | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 walk 打断） |
| salute | idle | 120ms | design（未验证） | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 salute 打断） |
| salute | walk | 180ms | design（未验证） | 意图为 walk：walking=true（脚下还有没走完的路）。（从 salute 打断） |
| salute | work | 160ms | design（未验证） | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 salute 打断） |
| salute | deliver | 200ms | design（未验证） | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 salute 打断） |
| work | idle | 140ms | design（未验证） | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 work 打断） |
| work | walk | 180ms | design（未验证） | 意图为 walk：walking=true（脚下还有没走完的路）。（从 work 打断） |
| work | salute | 160ms | design（未验证） | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 work 打断） |
| work | deliver | 220ms | design（未验证） | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 work 打断） |
| deliver | idle | 160ms | design（未验证） | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 deliver 打断） |
| deliver | walk | 200ms | design（未验证） | 意图为 walk：walking=true（脚下还有没走完的路）。（从 deliver 打断） |
| deliver | salute | 160ms | design（未验证） | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 deliver 打断） |
| deliver | work | 200ms | design（未验证） | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 deliver 打断） |

## 混合权重

- 当前层权重 = `1 - Σ残影权重`；残影权重 = `startWeight × (1 - 进度)`。
- 稳态只有一层；一次打断是两两混合；连续打断时残影目标上限为 4 条。
- 超过 4 条时，只有最轻残影的权重低于 0.12 才允许丢弃；高于它时改为**延长保留**（最多 12 条硬上限）。
- 延长保留的理由：把两个不同状态合并成一层会丢掉身份，硬丢高权重又会直接跳；多画一层残影比跳一下便宜。
- 硬上限保证被迫丢弃时最轻的一条 ≤ 1/13 ≈ 0.077 < 0.12，所以任何被丢的残影都低于下限；权重和恒为 1（浮点误差除外）。
- 同一意图重复调用不会重新开始过渡。

## 采样

- 12fps：`frame = floor(now / (1000/12)) % frameCount`。
- `now` 是世界时刻，由调用方传入；不读真实时钟、不用随机数。
- 姿态偏移全是整数像素；跨层加权后再四舍五入到整数。
