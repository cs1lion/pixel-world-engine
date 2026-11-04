# 进入室内 · 分块进度

分支 `feat/interior-view`（基于 `feat/env-frame` 的 `d353c26`）。每块独立证据目录，
基线先落盘再改；下文三档分开写：**做到的 / 没做到的 / 未验证的**。

---

## 块 1 · 拆屋顶层 + 进门推进过渡 + 单层内景 + 门退出

- 证据目录：`docs/evidence/interior-view/`（`INDEX.md`、`shots/`、`readings.json`、`analysis.json`）
- 改动：
  - `src/render/buildings.ts`：屋顶/烟囱拆成独立 `roof` Graphics（绘制顺序不变）
  - `src/render/interior-layout.ts`：纯函数——房间尺寸、`wallSeed`、家具布局、过渡进度（固定 18 帧）
  - `src/render/interior-view.ts`：烘焙内景 + 暗场，屏幕坐标（`scrollFactor 0`、`scale=2/zoom`），深度 20000+
  - `src/ui/interior-view-store.ts`：视图状态只写 `pwe.interior.view`，读档只清不还原
  - `src/scenes/SandboxScene.ts`：进门/退出状态机、相机推进、门与楼梯命中、街景 DOM 浮层隐藏、`?interior=instant|step`
  - `scripts/interior-capture.mjs`、`scripts/interior-analyze.py`：取证与读数
  - `test/interior-view.test.ts`：9 条布局/种子/过渡用例

### 验收读数

| 项 | 读数 |
| --- | --- |
| 街景 → 室内 Graphics / 指令 | 27 / 16130 → 30 / 16152（**+3 / +22**） |
| 过渡 | 18 帧；中点帧 `frames=9`、`mode=entering`、相机 `484/352` |
| 往返位姿 | 1 次与 10 次都读到 `528/416/zoom 2`，逐字相同 |
| 真点门退出 | `mode=street`，位姿与进门前逐字相同 |
| 真点楼梯 | 反馈帧数 60（截图时剩 29） |
| 内景唯一色数 | 13（≤ 24）；调色板外 **0** |
| 冻结 1 秒 | **0 像素差**（573 476 px 全同） |
| 三枚指纹 | `trace:record` / `trace:replay` 两次逐字相同、与录制一致 |
| 存档 | v5、`3ca5663faee59423` 未动 |

### 真问题（已修）

1. 内景「缩在左上角」= 世界相机 zoom 下的**裁切**，不是摆歪 → 改屏幕坐标。
2. `cameraCenter` 原本按 `width/(2·zoom)` 算错：Phaser 的中心是 `scroll + width/2`（与 zoom 无关）。
3. 室内点击全灭：`pointerdown` 在室内提前 return，没清 `pressMoved`。
4. 冻结帧 1032 px 差：DOM 人名/小地图压在内景上并继续动 → 进屋隐藏。
5. 唯一色数 321：半透明叠色产出调色板外 RGB → 内景改全不透明。
6. 指令增量读 0：Graphics 塞进 Container 后 `renderStats()` 数不到 → 改数组。
7. 取证点门点空：`locator.screenshot()` 滚动视口 → 每次点击前重读 `boundingBox()`。

### 没做到的

- 楼梯不切层（下一块）。
- 只目视验了 `code_forge` 的内景；民居/档案楼只有单测覆盖布局，没拍图。

### 未验证的

- `npm run test:browser`：第 31 项后「等交付」超时。该流程不经过内景；实测 120 s 只走
  1.81 M ms 世界时间，而 code 活需 1.8 M ms，**预算卡在边界**（既有用例的时间余量问题）。
- `npm run test:buttons`：`/api/memory/list` 回 404，数据源缺，按纪律标未验证。

### 闸门

`check` ✅ / `test` 2099 通过 0 失败 ✅ / `build` ✅ / `audit-palette` ✅ /
`audit-references` ✅ / `audit-sections` ✅ / `audit-citations` ✅ / `audit-claims` ✅（README 测试文件数 223→224）/
`adr-schema` ✅ / `test:persistence` ✅ / `test:phases` ✅ / `test:render-budget` ✅ /
`trace:record` + `trace:replay` ✅ / `test:browser` ❌（见上） / `test:buttons` ⚠️ 未验证

### 阻塞

无阻塞。块 2 的入口：楼梯坐标已登记在 `interiorLayoutFor`（`stairs` 矩形），
点击已经在 `InteriorView.hitTest` 里分流；切层只要把 `floor` 变成状态、用
`interior:<instanceId>:f<floor>` 再烘一张即可——不需要动世界状态与 v5。

---

## 块 2 · 楼梯切层（仍只给看）

- 证据目录：`docs/evidence/interior-view-block2/`（`shots/`、`readings.json`、`analysis.json`）。
  注意：块 1 的 `interior-view/shots` 被这一轮的取证脚本**覆盖过**，块 1 的读数以本文件与
  `interior-view/INDEX.md` 里记的数值为准；这是本块的流程失误，后续块不再复用同一目录。
- 改动：
  - `src/render/interior-layout.ts`：`interiorFloorsFor(building)`（按剪影派生层数）、
    `InteriorLayout.floor/floors/stairUp/stairDown/canUp/canDown`、`stairDirectionAt()`、
    `INTERIOR_SWITCH_SWAP_FRAME = 9`、`interiorSwitchOpacity(frames)`（两端 1、中点 0）
  - `src/render/interior-view.ts`：`show(..., floor)`、`setFloor(floor)`（换 key 重烘）、
    `stairDirectionAt()`、`flashStairs(direction)`（上/下箭头落在被点的那一段）、
    `setRoomOpacity(alpha)`（只淡房间、不淡暗场）、层标（左上角 4px 方块，亮起几块 = 第几层）
  - `src/scenes/SandboxScene.ts`：新增 `'switching'` 态、`switchInteriorFloor(delta)`、
    `settleInteriorFloor()`、`interiorFloor/interiorSwitchTo`；`interior()` 增读
    `floor/switchTo/floors/canUp/canDown/stairUp/stairDown/occupants`
  - `scripts/interior-capture.mjs`：逐帧推进的切层取证、真点两次上下楼、顶层/底层越界反馈
  - `scripts/interior-analyze.py`：第 2 层色数、切层中点黑场、两层像素差
  - `test/interior-view.test.ts`：新增 6 条（层数派生、越界夹取、上下两段、边界可上可下、
    中点不透明度、楼上无灶）

### 验收读数

| 项 | 读数 |
| --- | --- |
| 层数来源 | `code_forge#1` 剪影 `gable` → **2 层**（flat=1 / gable=2 / tower=3，纯视图读法） |
| 真点上楼 | 楼梯上半 → 第 2 层，过渡 **18 帧**（`switchUp.frames=18`，无超时） |
| 真点下楼 | 楼梯下半 → 第 1 层，**18 帧**（`switchDown.frames=18`） |
| 顶层再点上半 | 楼层仍为 2，只闪提示（`hintFrames=58`），**不绕回底层** |
| 底层再点下半 | 楼层仍为 1，只闪提示（`hintFrames=25`） |
| 切层中点 | `frames=9`、`mode=switching`、贴图 `alpha=0 / visible=false`；截图室内区 **1 色**（`#14110d`，只有 ink 暗场） |
| 第 1 层色数 | **13**（≤24），调色板外 **0** |
| 第 2 层色数 | **12**（≤24），调色板外 **0**；包围盒与第 1 层逐字相同 `934×614 @ (17,11)` |
| 两层画面差 | **38 944 px** 变化（包围盒 `40,42 → 864,566`）：灶台消失、家具重摆、层标多亮一格 |
| 切层相机 | 前后 `440/288/zoom 2` **逐字相同** |
| 屋里此刻有谁 | `occupants = []`（`insideAt` 现取），内景按**空房间**画，不摆假人 |
| Graphics / 指令 | 街景 30 / 16130 → 第 1 层 30 / 16145 → 第 2 层 30 / 16145；同页切层增量 **0 / 0** |
| 往返位姿 | 1 次与 10 次往返都回到 `528/416/zoom 2`（`poseRoundTrip = PASS`） |
| 冻结 1 秒 | **0 像素差**（573 476 px，`?interior=instant`） |
| 三枚指纹 | `trace:record` / `trace:replay` 两次逐字相同、与录制一致（世界 `95ee83…`、记忆 `fb0847…`、造物 `c5198f…`） |

> 块 1 的「+22 指令」有一处旧读数偏差：那时室内 `actorG` 里残留了一个 7 指令的人形图元
> （`show()` 只重置了签名、没有清缓冲区）。本块把 `actorG.clear()` 补进 `show()` 后，
> 室内指令稳定在 **16145**，相对街景的真实增量是 **+15**（+3 Graphics + 15 指令）。

### 做到的

1. 楼梯一竖两段：上半 = 上楼、下半 = 下楼；两段不重叠，点哪段走哪段。
2. 切层是视图状态：`interiorFloor` 只在内存与 `pwe.interior.view` 独立键里，**不进 v5**；
   读档仍回街景。
3. 每层一张烘焙图（key = `interior:<instanceId>:f<floor>`），家具按 `seedAt(wallSeed, floor)` 派生；
   楼上不画灶，层标亮起格数 = 层号。
4. 切层过渡与进出场同一套：固定 18 帧、第 9 帧换图；只淡房间、保留暗场，
   中点截图是纯 ink，换图看不见接缝。
5. 边界不循环：顶层再上 / 底层再下只闪对应那一段 60 帧，楼层不动。
6. 切层后相机与指令数不动（同页增量 0 / 0），退回底层的读数与上楼前逐字相同。

### 没做到的

- 楼上仍然共用同一个门框作为出口（`door` 每层都在原位）。这是**视图层的出口约定**，
  不是「楼上真有一扇门」；要做得更真，得让出口从楼梯走回底层，属于交互范畴，本块没改。
- 只有 `code_forge`（gable，2 层）拍了图。tower 的第 3 层只有单测覆盖，**没拍图**。
- 层标是 4px 方块，不写数字/文字——够截图判读，但不是玩家能读懂的 UI。
- 楼层只影响「看」，不影响世界：屋里的人不按层分、楼上没有独立居民。

### 未验证的

- `npm run test:browser`（smoke）：与块 1 同一处「等交付」超时风险；本块重跑结果见下方闸门。
- `npm run test:buttons`：服务端活着但 `/api/memory/list` 回 **404**，数据源缺，按纪律标未验证。

### 真问题（都修了）

1. **第 2 层整张截图全黑**：`setFloor` 新烘的 `Image` 没有继承 `scrollFactor 0`，跟着相机 scroll
   跑出屏外。补在 `bake()` 里（新贴图创建时立刻设 `scrollFactor 0`）。
2. **中点露出街景**：沿用进场的 `setReveal` 会把暗场一起收掉，切层中点变成「透过地板看大街」。
   新增 `setRoomOpacity`：只淡房间（贴图/人/提示），暗场留在 ink 上。
3. **指令数一次性 −7**：`show()` 只重置 `occupantSignature`/`occupantIds`，没清 `actorG`；
   一个旧人形图元会跨进屋留到第一次换层才被 `setFloor` 清掉。补 `actorG.clear()`。
4. **层标被调试按钮盖住**：层标原放右上角，正好压在 `#debug-toggle` 的 DOM 矩形里；
   移到左上角（`x=8,y=8`）。

### 被否掉的写法

- **切层复用 `entering/exiting` 两个态**：进场要从街景淡出，切层必须留在屋里；
  共用一套 `setReveal` 会把街景翻出来。最终保留 `switching` 独立态 + `setRoomOpacity`。
- **点楼梯循环切层**：顶层再点就往底层绕——用户会以为「点坏了」。改成越界只闪提示。
- **把层数写进 `PlacedBuilding` / 存档**：本块不需要世界知道楼层；一旦写进去，
  寻路、目击判定、v6 与夹具全要跟着改，超出「只给看」的范围。
- **切层换图放在帧 0 或末帧**：帧 0 换会看到旧图熄灭、新图亮起前的空档；末帧换会闪一帧旧图。
  中点是唯一看不见接缝的位置。

### 阻塞

无阻塞。块 3 的入口：`Oracle.interior()` 已带 `occupants`（`insideAt` 现取），
连续往返与冻结帧的取证脚本沿用 `interior-capture.mjs` 的第 8 段。

---

## 块 3 · 进出场的边界情形

- 证据目录：`docs/evidence/interior-view-block3/`。
- 代码改动：**只有一处**——`Oracle.interior().buildings[]` 多暴露一个 `zone`，
  让取证脚本能按「民居 / 工业」挑楼；世界逻辑、存档、渲染都没有动。
- 读数（全部来自 `interior-capture.mjs` / `interior-analyze.py` 的同一轮输出）：

| 判据 | 读数 |
| --- | --- |
| 连续进出 10 次 | 每次都 `528/416/zoom 2`，10/10 `matches=true`，与初始街景位姿逐字相同 |
| 退场后位姿 | 点门退出后 `528/416/zoom 2`，`poseAfterDoorMatches=true` |
| 关闭过渡后冻结 1 秒 | `frozen-a` 与 `frozen-b` **0 像素差**（573 476 px） |
| 过渡开关关闭时进出 | `?interior=instant`，进场/出场/切层都直接落位，无中间帧 |
| 空房间 | 中午 `code_forge#1`、夜里 5 栋民居（橡木/灰泥/石砌/远郊/山脊）逐个进门，`occupants` 全为 `[]`；内景按空房画 |
| 指令预算 | 室内 16145 < 30000；Graphics 30 不变 |

### 做到的

- 空房路径：连续 10 次往返位姿逐字回原点、冻结帧 0 差、过渡开关关闭后无中间帧。
- 「不造假人」：房间的人只从 `insideAt`（`!visible` 且占地判到本楼）取，取证时取不到就不画。

### 没做到的

- **「屋里有谁」这条只验到空房**：夜里 5 栋民居、中午工业楼，`insideAt` 都没有人。
  模拟里只有 `working` 时才会 `visible=false`（`simulation.ts:3176`），而本机没有上游派活
  （`/api/memory/list` 404），所以这一天里没有人真的进屋。**有人时的站位/配色没有被验证**，
  也没有为了让截图好看去伪造在场者。

### 未验证的

- 有人在屋内的渲染（座位分配、人数 > 座位时的门口站位）——原因同上，缺真实在场者。

### 阻塞

- **非阻塞但挡住了「有人」验收**：需要一条真实的上游派活（或模拟里让居民回家也置
  `visible=false`）。前者属服务端数据、后者会改世界语义，都不在本块授权范围内，记在这里等决定。

---

## 块 4 · 多栋楼的内景注册（验证现有入口，不新增楼型模板）

- 证据目录：`docs/evidence/interior-view-block4/`。
- 注册方式：**每栋楼按实例自动注册**，键是 `interior:<instanceId>:f<floor>`；
  墙体、窗、楼梯、门位共用同一张 232×152 剖面模板，家具与灶口由 `wallSeed(building)`
  与层号派生。没有按楼型分模板，也没有把楼层写进世界状态。
- 读数：

| 楼 | 剪影 / 层数 | 首层色数 | 调色板外 | 与 `code_forge` 的画面差 | Graphics / 指令 |
| --- | --- | --- | --- | --- | --- |
| 橡木小屋 `cottage_oak#1` | gable / 2 | 12 | 0 | 38 672 px | 30 / 16145 |
| 石砌小屋 `cottage_stone#1` | tower / 3 | 12 | 0 | 37 536 px | 30 / 16145 |
| 远郊农舍 `homestead_far#1` | gable / 2 | 12 | 0 | 38 656 px | 30 / 16145 |
| 石砌小屋第 3 层 | — | 12 | 0 | 39 040 px | — |

- 三个房间的包围盒都是 `934×614 @ (17,11)`，即同一套屏幕位置；差异只在墙内内容。
- 塔楼 `canUp=false` 落在第 3 层，说明楼层夹取的上边界与剪影层数一致。

### 做到的

- 换楼就换图：不同 `instanceId` 各自一张烘焙图，家具按 `wallSeed` 重摆；
  三栋楼的画面差异都在 3.7–3.9 万像素量级，不是同一张图复用。
- 塔楼第 3 层实拍：`floor=3 / floors=3 / canUp=false`，色数与调色板约束都成立。

### 没做到的

- **按楼型分剖面模板**没做：目前所有楼共用一张剖面（同宽同高、同窗位），
  只有家具/灶口不同。分模板是美术扩充（比如农舍更矮、塔楼更窄），不是机制缺口；
  用户划的边界也只到「每类楼一张剖面模板 + wallSeed 家具」，本块只做到后半句。
- 多楼层世界态没做（居民不按层生活、寻路不认楼层），与块 2 的边界一致。

### 未验证的

- 无新增未验证项；「有人时的内景」仍未验证，原因见块 3。

### 阻塞

- 无代码阻塞。要再往前一步（按楼型分剖面 / 居民分层），必须先决定是否动世界状态与 v6。

---

## 闸门（块 2–4 之后重跑）

| 闸门 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test` | 2114 个用例，2105 通过、9 跳过、0 失败 |
| `npm run build` | 通过 |
| 五个审计（palette / references / sections / citations / claims） | 5/5 通过 |
| `test:persistence` / `test:phases` / `test:render-budget` / `test:setting` | 全部通过 |
| `trace:record` / `trace:replay` | 通过；三枚指纹两次逐字相同 |
| `test:browser` | **通过**（退出码 0，尾部用例全 `ok`；块 1 的「等交付」超时本轮未复现） |
| `test:buttons` | **未验证**：`/api/memory/list` 回 404，数据源缺失 |

---

## 结论（块 2–4）

- 做到：楼梯两段切层、每层一张烘焙图、18 帧切层过渡、上下层边界夹取、多栋楼换图、
  塔楼第 3 层实拍；楼层始终只在视图态与 `pwe.interior.view`，v5 未动。
- 没做到：每类楼的独立剖面模板、居民按层生活、有人时的内景渲染。
- 未验证：`test:buttons`（服务端数据缺）。
- 下一步入口（只判断不动手）：要验「有人」必须先有真实在场者——或接一条上游派活，
  或让模拟在夜间把回家的居民也置 `visible=false`。后者会改世界语义，需要单独拍板。
