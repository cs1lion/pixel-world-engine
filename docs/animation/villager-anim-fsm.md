# 村民动画状态机 · 状态与转移

> 本文件由 `world-client/scripts/export-anim-graph.ts` 从 `villager-anim-fsm.ts` 生成；手改会在单测里变红。

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

| 从 | 到 | 时长 | 条件 |
| --- | --- | --- | --- |
| idle | walk | 120ms | 意图为 walk：walking=true（脚下还有没走完的路）。（从 idle 打断） |
| idle | salute | 90ms | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 idle 打断） |
| idle | work | 150ms | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 idle 打断） |
| idle | deliver | 180ms | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 idle 打断） |
| walk | idle | 140ms | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 walk 打断） |
| walk | salute | 160ms | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 walk 打断） |
| walk | work | 150ms | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 walk 打断） |
| walk | deliver | 200ms | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 walk 打断） |
| salute | idle | 120ms | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 salute 打断） |
| salute | walk | 180ms | 意图为 walk：walking=true（脚下还有没走完的路）。（从 salute 打断） |
| salute | work | 160ms | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 salute 打断） |
| salute | deliver | 200ms | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 salute 打断） |
| work | idle | 140ms | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 work 打断） |
| work | walk | 180ms | 意图为 walk：walking=true（脚下还有没走完的路）。（从 work 打断） |
| work | salute | 160ms | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 work 打断） |
| work | deliver | 220ms | 意图为 deliver：mode=delivering（活干完，交付并准备去祭坛）。（从 work 打断） |
| deliver | idle | 160ms | 意图为 idle：walking=false（到站、雨停、交付结束或撤单后站稳）。（从 deliver 打断） |
| deliver | walk | 200ms | 意图为 walk：walking=true（脚下还有没走完的路）。（从 deliver 打断） |
| deliver | salute | 160ms | 意图为 salute：mode=saluting（接到派活，世界侧行礼 700ms）。（从 deliver 打断） |
| deliver | work | 200ms | 意图为 work：mode=working（原地短活，或已到铺子开工）。（从 deliver 打断） |

## 混合权重

- 当前层权重 = `1 - Σ残影权重`；残影权重 = `startWeight × (1 - 进度)`。
- 稳态只有一层；一次打断是两两混合；连续打断最多保留 4 条残影。
- 超过上限时丢掉此刻权重最小的残影。这是已知损失，不藏。
- 权重和恒为 1（浮点误差除外）；同一意图重复调用不会重新开始过渡。

## 采样

- 12fps：`frame = floor(now / (1000/12)) % frameCount`。
- `now` 是世界时刻，由调用方传入；不读真实时钟、不用随机数。
- 姿态偏移全是整数像素；跨层加权后再四舍五入到整数。
