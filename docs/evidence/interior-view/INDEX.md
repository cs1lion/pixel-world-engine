# 进入室内 · 第一块（拆屋顶层 + 进门过渡 + 单层内景 + 门退出）

分支 `feat/interior-view`（基于 `feat/env-frame` 的 `d353c26`）。**楼层只给看**：
每层一张烘焙内景，楼层不进世界状态、不动 v5、三枚指纹逐字不变。

## 结论

- **进门**：街景点门格 → 镜头推到楼中心 + 18 帧固定过渡（街景淡出 / 内景淡入）→ 室内。
  真点取证通过：门格命中、`mode=inside`。
- **内景**：按 `wallSeed(building)` 派生家具，第 1 层一张 232×152 烘焙贴图，
  屏幕上恒为 928×608 CSS（不随街景倍率缩放），深度 20000 起、自成一套。
- **门退出**：真点门 → 反向 18 帧 → 回街景，`scroll/zoom` 逐字回到进门前的值（10 次往返同时成立）。
- **楼梯**：坐标已登记（`{x:12,y:26,w:34,h:54}`）、图元已画、点击有琥珀反馈（60 帧），**不切层**。
- **屋顶/前檐**：已拆成独立 `roof` Graphics（`BuildingView.roof`），进场时藏、退出时恢复。

## 复现

```powershell
cd D:\project\pwe-material\world-client
npm run dev            # 5188；取证脚本用 5191，需另一条：npm run dev -- --port 5191
node scripts/interior-capture.mjs     # → docs/evidence/interior-view/{shots,readings.json}
python scripts/interior-analyze.py    # → docs/evidence/interior-view/analysis.json
```

页面开关：

| 开关 | 作用 |
| --- | --- |
| `?interior=instant` | 关过渡：进场/退场当帧完成，验收冻结帧用这一档 |
| `?interior=step` | 过渡不自走，由 `Oracle.stepInterior(n)` 逐帧推（中点帧靠它） |
| `Oracle.interior()` | 读数：`mode / floor / frames / hintFrames / room / door / stairs / view` |
| `Oracle.enterInterior(id)` / `exitInterior()` / `setInteriorTransition(bool)` | 脚本驱动 |
| `Oracle.centerCameraOn(x,y)` | 把镜头摆到指定世界点（真点门之前用） |

## 读数（`readings.json` + `analysis.json`）

| 项 | 读数 | 判据 |
| --- | --- | --- |
| 街景基线 | 27 Graphics / 16130 指令 | 预算 30000 有大量余量 |
| 室内 | 30 Graphics / 16152 指令 | 增量 **+3 / +22**（3 张 Graphics + 1 张贴图） |
| 过渡 | `framesToInside = 18`，`elapsedMs = 307` | 固定 18 帧；中点帧 `frames = 9`、`mode = entering` |
| 往返位姿 | `poseIdentical = true`（1 次与 10 次都读到 `528/416/2`） | 逐字回到原点 |
| 门点击退出 | `modeAfterDoor = street`，`poseAfterDoorMatches = true` | 真点，非 Oracle 驱动 |
| 楼梯点击 | `stairsHintFramesAfterClick = 29`（截了图后剩 29/60） | 有反馈 |
| 内景唯一色数 | **13**（剔除 DOM 调试按钮矩形） | ≤ 24 世界色板；`outsidePalette = []` |
| 内景包围盒 | `934×614` @ `(17,11)`（961×641 的画布里） | 居中、四周各留 8 CSS 暗边 |
| 冻结 1 秒 | **0 像素差**（比对 573 476 px） | `?interior=instant` |
| 过渡中点 vs 室内 | 610 846 px 不同 | 中点帧确实是过渡态 |
| 三枚指纹 | `trace:record` / `trace:replay` 两次逐字相同，与录制一致 | 0 条 `building.*` 事件变化 |
| 存档 | `schemaVersion = 5`、`3ca5663faee59423` | 未动 v5 |

## 做到的

1. 屋顶 / 烟囱拆层（`render/buildings.ts`：`roof` 独立 Graphics，绘制顺序不变 → 街景像素不变）。
2. 进门：门格（`door`）与门框格（`footprint` 最后一行 + `door.x`）都能点进。
3. 固定 18 帧过渡，世界时钟无关（`interiorTransitionProgress(frames)` 只吃帧号）。
4. 每栋楼一张烘焙内景（`bakeLayer`，key = `interior:<instanceId>:f1`），家具由 `wallSeed` 派生。
5. 内景在屏幕坐标上恒定尺寸，深度 20000+，不参与街景 `ALTITUDE` y-sort。
6. 门退出反向过渡 + 位姿逐字还原；`?interior=instant` 可关过渡。
7. 楼梯坐标登记 + 图元 + 点击反馈（不切层）。
8. 视图状态只写 `pwe.interior.view`（UI 独立键），**读档只清不还原** → 回街景。
9. 室内无人 → 空房间；有人用 `insideAt` 取，人画在固定座位上，不造假人。
10. 进屋时隐藏街景 DOM 浮层（`#world-overlay`、`#minimap`），否则人名与小地图压在内景上，且会破坏冻结帧比对。

## 没做到的

- 楼梯**不切层**（本块范围外，下一块做）。
- 只目视验了 `code_forge` 一栋的内景；民居（无炉口）与档案楼只由单测覆盖布局，**没拍图**。
- 内景家具是「贴图上的摆设」，没有碰撞、没有可交互物件（桌椅只是画）。
- `?interior=instant` 时镜头瞬移，没有「推进」的中间帧（这是刻意的验收档）。

## 未验证的

- `npm run test:browser`（smoke）：跑到第 31 项后在「等交付」处超时。该流程不经过内景，
  实测世界时间 120 s 只走了 1.81 M ms，而 code 活本身要 1.8 M ms——**预算刚好卡在边界**，
  属于既有用例的时间余量问题；本块未改仿真，也没有把它改绿。
- `npm run test:buttons`：服务端活着但 `/api/memory/list` 回 404（数据源缺），按纪律标未验证。
- 多栋楼 / 多楼层的内景注册：未做（后续块）。

## 真问题（都修了，写在这里免得再踩）

1. **内景被「裁成左上角」**：世界相机 zoom=2 时，232×152 的内景按世界坐标摆会铺成 928×608 CSS，
   超出 480×320 画布——截图里看到的「缩在左上角」其实是裁切。改成 `scrollFactor 0` +
   `scale = 2/zoom`（1 texel 恒 2 内部像素）。
2. **镜头中心公式错**：Phaser 的屏幕中心是 `scroll + width/2`，**与 zoom 无关**；
   按 `width/(2·zoom)` 算会多推 120/80 世界像素（正是上面那条裁切的直接原因）。
3. **室内点击全部失效**：`pointerdown` 在室内模式下提前 return，没清 `pressMoved`；
   上一次街景拖拽留下的 `true` 让每次抬手都被当成拖拽吞掉。
4. **冻结帧差 1032 像素**：DOM 人名/小地图压在内景上，且跟着自己的世界继续动。
5. **唯一色数 321 > 24**：内景原稿用了 `0.18/0.25/0.35` 几层半透明填色，叠出调色板外的 RGB。
   改成不透明现成色后降到 13。
6. **指令增量读到 0**：内景 Graphics 曾塞进 Container，而 `renderStats()` 只数顶层 → 预算闸门里隐身。
   改成 `layers` 数组，增量变成真实的 +3 / +22。
7. **取证脚本点门点空**：`locator.screenshot()` 会把画布滚进视口，页面纵向位置变了；
   点之前必须重新读 `boundingBox()`。

## 被否掉的写法

- **按世界坐标摆内景**（依赖相机 zoom）：就是上面第 1 条，已废。
- **把内景放进 Container**：`renderStats()` 数不到，预算对照会变成假读数。
- **用 `Date.now`/`delta` 驱动过渡**：`?speed=6` 会把 300 ms 过渡压进一帧；改为只吃帧号。
- **`cam.centerOn` + `cam.midPoint`**：语义上是对的（`scroll + width/2`），但当时误判成「忽略 zoom」，
  改成了更错的公式；现在自己写 `centerCameraAt` 只为把这条注释留在代码里。

---

## 块 2 · 楼梯切层（本文件上面几节的「楼梯不切层」已被本块取代）

证据目录改为 `docs/evidence/interior-view-block2/`；上面的块 1 截图已被重跑覆盖，
块 1 的数值以本节之前记下的文字为准。

- 每栋楼按剪影读层数：`flat = 1`、`gable = 2`、`tower = 3`（`interiorFloorsFor`，**不进世界状态**）。
- 楼梯一竖两段：上半 = 上楼、下半 = 下楼；越界（顶层再上 / 底层再下）只闪 60 帧提示，不循环。
- 切层与进出场同一套：固定 **18 帧**，第 **9** 帧换图；只淡房间、保留 ink 暗场，
  中点截图室内区只有 **1 色**（`#14110d`）。
- 第 1 层 13 色 / 第 2 层 12 色，均 ≤ 24 且调色板外 0；两层包围盒逐字相同 `934×614 @ (17,11)`。
- 切层相机 `440/288/zoom 2` 前后不动；同页 Graphics / 指令增量 **0 / 0**。
- 真点上/下楼各 18 帧；中心层往返后位姿与第 1 层读数逐字相同。
- 版本档仍 v5；三枚指纹两次逐字相同、与录制一致。
- 修正块 1 读数：室内 **16145 指令**（不是 16152），相对街景真实增量 **+15**——
  旧读数里混了一个残留的 7 指令人形图元（`show()` 未清 `actorG`，已修）。

细节与三档清单见 `docs/evidence/PROGRESS.md` 的「块 2」一节。

## 块 3 / 块 4 · 边界与多栋楼

- 证据目录：`docs/evidence/interior-view-block3/`、`docs/evidence/interior-view-block4/`。
- 块 3：连续 10 次进出位姿 10/10 逐字回原点；过渡开关关闭时冻结 1 秒 **0 像素差**；
  中午工业楼与夜里 5 栋民居的 `occupants` 全为 `[]`——**空房路径已验证，有人路径未验证**
  （模拟只在 `working` 时置 `visible=false`，本机没有上游派活）。
- 块 4：橡木小屋（2 层）/ 石砌小屋（3 层）/ 远郊农舍（2 层）各拍首层，塔楼另拍第 3 层；
  每间 12 色、调色板外 0、包围盒统一 `934×614 @ (17,11)`，Graphics/指令恒为 30 / 16145。
- 注册方式：`interior:<instanceId>:f<floor>` 每栋每层一张烘焙图；墙体/窗/楼梯/门共用同一套
  232×152 剖面模板，家具由 `wallSeed` 派生。**没有按楼型分模板，也没有多楼层世界态。**
