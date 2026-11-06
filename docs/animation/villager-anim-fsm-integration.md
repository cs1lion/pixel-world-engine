# 村民动画状态机 · 第二版接入预案

> 第一版**不接管渲染**：状态机只作为独立模块存在，渲染仍走
> `world-client/src/render/villager-frames.ts` 的旧路径。本文只写第二版怎么接，
> 这一轮不改任何渲染代码，也不重录截图基线。

## 为什么分两步

接管渲染会改变画面，157 张截图基线要集体重录。那时若画面变了，分不清是
「状态机写错了」还是「基线过期了」。所以第一版先把逻辑单独立住：

- 状态/转移/时长有唯一来源 `villager-anim-fsm.ts`；
- 单测覆盖迁移、打断、连续打断、重复意图；
- 稳态输出与现有 `villagerPose` **逐字段对齐**（见 `anim-fsm.test.ts`）。

逻辑对得上之后，第二版才动渲染。

## 接入点

唯一逐帧入口是 `world-client/src/scenes/SandboxScene.ts` 里对
`updateVillager` 的调用；`updateVillager` 在
`world-client/src/render/villager.ts` 里采样 `villagerPose`。

第二版新增一个薄适配层（建议放在 `world-client/src/render/` 下，文件名第二版再定），
由它持有每个 villager 的 `AnimFsmState`，并把快照映射成意图：

1. 每帧调用 `animIntentOf(villager.mode, villager.walking)`；
2. 用 `advanceAnimFsm(state, intent, presentedNow)` 推进；
3. 用 `sampleAnimFsm(state, presentedNow)` 取当前帧与权重；
4. 把采样结果交给现有排版函数 `villagerLayout`。

`villagerLayout` 的签名接受 `VillagerPose`，适配层把
`AnimLayerSample.pose` 拼成主层姿态；跨层混合在绘制侧完成（见下一节）。

## 开关与新旧并行

沿用仓库已有的「参数开关 + 默认走旧路径」习惯（同类开关见 `?light=` 试点）：

- `?animfsm=1` 打开新路径；默认（不带参数）逐字节走旧路径。
- 同一个场景里两条路径**都算一遍**，但只有一条决定画面：
  - 旧路径的输出 = `villagerPose(mode, walking, presentedNow)`；
  - 新路径的稳态输出 = `sampleAnimFsm` 的当前层。
- 对照结果写进 `window.__animFsmDiff`（环形缓冲，最多 512 条），每条记录
  `{ villagerId, nowMs, field, oldValue, newValue }`，并同时 `console.warn` 一条
  汇总（例如 `animfsm: steady mismatch 3 / 12000 samples`）。

判定口径：

| 场景 | 期望 |
| --- | --- |
| 稳态（无残影） | 帧号、`offsetY`、`footLeft/Right` 与旧路径**逐字段相等** |
| 过渡期（有残影） | 允许不同，但要记录「expected`，不作为缺陷 |
| `poseFrame` 钉住路径 | 不走 FSM，保持截图口径逐字节不变 |

不一致只记录、不自动切换、不修改世界。记录里区分
`steady-mismatch`（缺陷）与 `transition-diff`（预期差异），避免把过渡画成回归。

## 交叉淡入怎么画

第一版只输出权重，第二版才决定怎么消费。像素画不宜直接 alpha 混合整张精灵
（会把 24 色闭集搅出中间色），所以计划用**双层硬画 + 权重择层**：

- 权重 ≥ 0.5 的层决定主体轮廓（主层）；
- 残影层只画一次，按 `weight` 压 `globalAlpha`，叠在主层下面；
- 绘制仍只走 `fillRect`，不新增源色、不改色板预算；
- 过渡结束时残影权重归零，画面回到单层。

这套画法需要截图对照：默认关掉开关时基线不动；打开开关后只允许过渡帧不同。
157 张基线是否重录，由第二版单独决定并显式授权，不在本轮做。

## 不一致时的记录与回滚

- 所有差异进 `window.__animFsmDiff` 与一次汇总日志，不写世界、不写存档。
- 若稳态不一致率 > 0，先把开关默认关掉、保留记录，再定位是状态映射还是
  帧相位的问题；不通过修改判据来凑绿。
- 若接入需要改 `villagerPose` 的既有语义（例如 12fps 或 `modeLift`），先停下
  上报，不自行扩大范围。

## 已知限制（第一版就存在）

- 转移时长是设计值，不是从世界节奏推导出来的；`saluting` 的 700ms 世界里
  只有入场，没有出场动画，这里给了 180ms 的淡出。
- 连续打断超过 4 条残影时会丢掉权重最小的一条，画面会有一处很小的跳变；
  单测钉住层数上限，但不假装跳变不存在。
- `facing`、`carrying`、伞、灯都不进状态机：它们由快照事实驱动，第二版继续
  走现有叠加层。
