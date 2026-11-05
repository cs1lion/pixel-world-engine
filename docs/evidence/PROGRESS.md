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

---

## 块 5 · 回家的人真的进屋了（**世界语义变更**，提交 `7169a7d`）

- 证据目录：`docs/evidence/homecoming/`——`readings.json`（逐拍轨迹/目击/记忆/两跑确定性）、
  `shots.json`（浏览器实拍与渲染读数）、`analysis.json`（色数/调色板外色）、`shots/*.png`。
- 语义变更，不是视图层：入夜（22:00–06:00）居民**先走到自家门口格**，下一拍位置落进
  住宅占地、`visible = false`；天亮在门口格重新出现。外面的人看到的是
  「走到门口 → 进屋消失」。世界真值、目击口径、记忆条数都随之改变。

### 改了什么（提交 `7169a7d`）

| 文件 | 改动 |
| --- | --- |
| `src/world/homecoming.ts`（新） | 家 = 居住分区按 `instanceId` 排序、按 id 派家；入夜/天亮时刻；占地中心格；事件文案。纯函数，不碰世界状态 |
| `src/world/simulation.ts` | `stepIdle` 顶部接 `stepHomecoming`；新增 `homeOf / stepHomecoming / enterHome / wakeAtHome / ensureAwake`；5 处 `visible` 过滤（街面落点、活跃度、空闲块、应答神谕、派活前叫人）；import 一行 |
| `src/world/world-changes.ts` | `WorldEventKind` 增 `'home_entry'`（与 `routine_done` 分开：后者是作息完成，前者是空间状态翻转） |
| `server/events/world_changes.py` | `WORLD_EVENT_KINDS` 同步 |
| `src/world/memory/observe.ts` | `home_entry` importance 0.4 / valence 0.1；**显式 `indoor: false`**（见下文目击） |
| `src/world/memory/salience.ts` | `KIND_PRIORS.home_entry = {emotion .4, surprise .4, goalRelevance .55, involvement .15}` → 0.375 ≥ 0.3 门槛 |
| `src/scenes/SandboxScene.ts` | ① `interior()` oracle 的 `buildings[]` 增 `occupants`（只供取证）；② `?debug=1&now=HH:MM` 把**模拟时钟**钉住（见「真问题 1/5」） |
| `test/homecoming.test.ts`（新，6 条） | 翻转时机与占地位置、天亮门口、夜里被叫名从门口出来、无住宅不进屋、两跑逐字、**门口按室外记账** |
| `test/labelless-idle.test.ts` | 清牌子 7→8、路口 4→5（`wakeAtHome` 是新增的合法清牌子点）——语义变更导致的诚实计数，不是顺手更新 |
| `README.md` | `test-file-count` 224→225（新增一个测试文件） |
| `scripts/homecoming-trace.ts`（新） | headless 逐拍取证 + 两跑确定性 + 快照 sha256 |
| `scripts/homecoming-capture.mjs`（新） | 浏览器实拍室内有人；等「有人的家」用**轮询次数**，不读墙钟 |
| `scripts/homecoming-analyze.py`（新） | 色数/调色板外色/bbox |

### 逐拍轨迹（`readings.json`，cottage_oak#1 / v0）

格式：拍, 世界分钟, visible, x, y, routine

```
57,1317,1,50,34,去街口   58,1318,1,51,34,去街口   59,1319,1,52,34,去街口
60,1320,1,52,34,回家     61,1321,1,51,34,回家     62,1322,1,50,34,回家
63,1323,1,50,35,回家     64,1324,1,50,36,回家     65,1325,1,50,37,回家
66,1326,1,50,38,回家     67,1327,1,49,38,回家     68,1328,1,49,39,回家
69,1329,1,49,40,回家     70,1330,1,49,41,回家     71,1331,1,49,42,回家
72,1332,1,49,43,回家     73,1333,1,49,44,回家     74,1334,1,50,44,回家
75,1335,1,51,44,回家     76,1336,0,52,42,在家里歇下了
77–120：一直 0,52,42,在家里歇下了
```

- **翻转时刻 = 第 76 拍 / 世界 22:16**；翻转前最后一拍（75）站在**门口格 (51,44)**。
- 翻转后位置 **(52,42)** 在住宅占地内（占地中心），`visible = false`。
- 没有在街角消失：60–75 拍逐格从街口绕到门口，第 76 拍才翻。

### 屋内与人（验收 1、2）

- `occupants`：`cottage_oak#1:[v0]`、`cottage_plaster#1:[v1]`，其余三栋 `[]`。
- 室内实拍 `shots/interior-occupied.png`：**14 色**，**调色板外 0 色**（空房 13 色，+1 就是人）；
  bbox 934×614 @(17,11)；`renderStats` 17112 条指令 / 30 个 Graphics（预算 30000）。
- 同机位夜街 313 色（灯光合成会出调色板外色，属既有）；与块 4 的白天 16145 条不可直接比，
  本块是夜里（灯光/雨幕叠加）。

### 目击读数（验收 3）

- 翻转那一拍，门外街上只有 v1：pos (49,51)，Chebyshev **7** 格、欧氏 **7.28** 格（≤ 8），`visible = true`。
- v1 记忆里读到的是「莞尔走进了橡木小屋，门在身后合上。」（`home_entry`），salience **0.375**，
  tier `day`；**没有**「她还在街上」这类事实。v0 自记同一条 0.5875；v1 自记 0.5875。
- 接线要点：`home_entry` 的 `where` 是**门外那格**，`placeId` 绑住宅。生产的 `placeIndoor`
  只看 `placeId`，会把这一幕判成室内（只剩她自己看得见）。所以 `observationOf` 对它
  **显式写 `indoor: false`**；`test/homecoming.test.ts` 用「街上七格外 true / 屋内 false」
  两条钉住。取证脚本用**与 `SandboxScene` 一字不差**的 `placeIndoor`，读数仍成立。

### 感知口径：改与不改的依据

| 模块 | 改？ | 依据 |
| --- | --- | --- |
| `weather-witness` | 不改 | 已按 `visible` 排除（=「没进屋」）；进屋后自动不参与户外观测 |
| `perception` | 只加 `home_entry` 的 `indoor:false` | `inside` 每拍按占地算，进屋后自动成立；缺的不是判据，是事件落点的室内外标注 |
| `hearing` | 不改 | 进屋不发声音（`home_entry` 只进记忆，不发声）；「室内外按 `inside` 分」在位置落进占地后自然正确 |
| `privacy` | 不改 | `writeMode` 与位置无关，私密写入规则不变 |

### 指纹新旧对照（验收 4）

| 轨迹 | 旧读数（录制值） | 新读数 | 为什么变 | 对应提交 |
| --- | --- | --- | --- | --- |
| outer-two-days 世界 | `95ee830c…` | `95ee830c…`（两跑逐字相同） | **不变**：LEGACY_PACK `placements: []`，回放里只造出 `star_archive`/`code_forge`，没有 `living`；`homesOf` 空 → `homeFor` null → `stepHomecoming` 立即 false | `7169a7d` |
| 记忆 | `fb0847b3…` | `fb0847b3…` | 同上，无 `home_entry` | `7169a7d` |
| 造物 | `c5198f0f…` | `c5198f0f…` | 同上 | `7169a7d` |
| 大世界夜间（本块新基线） | 世界真值里没有「进屋」这件事 | 新增 `home_entry` 事件与 3 条记忆；快照 sha256 `5dfc40b3…` 两跑相同 | **语义变更**：回家真的把人在世界真值里置为屋内 | `7169a7d` |

`npm run trace:replay`：`replayable`——世界/记忆/造物三枚指纹两次逐字相同，且与录制值逐项一致。
**没有替换既有夹具**：受影响的是「有大世界住宅的夜间」这一场景，既有夹具里没有它；
本块为它**新录**了 `readings.json` 作为基线。没有任何旧夹具被改写成新值。

### 计数变化（验收 6，逐项）

| 项 | 旧 | 新 | 为什么 |
| --- | --- | --- | --- |
| `business.buildings`（trace） | 2 | 2 | 回放里两栋楼都不是住宅；回家不增删楼 |
| 事件条数（trace） | 50 | 50 | 同上 |
| facts / entries / claims / beliefs | 47 / 45 / 38 / 11 | 同 | 同上 |
| 大世界建筑数（persistence） | 11 | 11 | 回家不改建筑；摆件 2、雾 38 也不变 |
| 大世界记忆（本块取证 21:00→23:00） | 0（旧语义夜间无新事实） | 3 条记忆 + 2 件 `home_entry` | 语义变更 |
| 用例数 | 2114（2105 通 / 9 跳） | 2120（2111 通 / 9 跳） | +6（`homecoming.test.ts`） |
| 测试文件数 | 224 | 225 | 新增一个文件；README claim 同步 |

### 遇到的真问题

1. **`?time=` 只改画面，不改模拟时钟**：页面从世界 00:00 起跑。有了回家语义后，
   一开门两名居民就各回各家，前六分钟街面变空；`test:browser` 后半段所有「户外的她」断言
   也因此落空。处理：加调试层参数 `?debug=1&now=HH:MM` 把模拟起点钉住，回归脚本改成
   `time=noon&now=10:00`（12:00–14:00 是安静段，全镇坐着，「自己走动」等不到，故用 10:00）。
   **断言一条没动**，只是让脚本的时间前提和它自己注释里说的一致。
2. **「在屋里永远不接活」是过度设计**，并且当场把 `test:browser` 弄红：第二单派给睡着的 v1
   永不接手，脚本死等 120 秒。改成**被点到名的人先从自家门口出来再出发**（`ensureAwake`
   在派活三条路径上都调用）；翻转仍在门口格完成，不是街角凭空出现。
3. **门口的室内外标注**：生产 `placeIndoor` 只看 `placeId`，会吞掉门口这一幕（见上）。
4. `test:buttons` 仍因 `/api/memory/list` 404 无法验证（既有缺口，**未改代码**）。
5. `eval/screens/*.png` 被浏览器闸门重写，且**四个时段全都有约 42% 像素差异**（含正午），
   无法归因到回家（正午没有居民进屋）；属既有底图漂移，**未提交**，也没有写成「顺手更新」。

### 被否掉的写法

1. **在街角直接 `visible=false`**：用户硬约束禁止；也会让「门口目击」的落点变成街角，8 格口径失真。
2. **给 `Villager` 加 `homeId` / 新增 `mode:'inside'`**：要升存档 v6，寻路/渲染/夹具全要跟着改；
   家纯派生即可，`save.ts` 的 v5 白名单本来就含 `visible`（`test:persistence` 8/8 通过）。
3. **复用 `routine_done` 表达进屋**：那个事件是「作息做完」，与「空间状态翻转」的目击/显著度不同。
4. **把事件锚点放进占地**：那就真成室内事件，街上的人看不见，验收 3 直接不成立。
5. **为让目击一定写入而把 `home_entry` 抬到传说级**：改的是记忆口径，不是本块目的；
   0.375 已过 0.3 门槛，实测写入。

### 做到 / 没做到 / 未验证

- 做到：逐拍走到门口才翻转；占地内 `visible=false`；`occupants` 非空并实拍；
  8 格内目击读到「进屋」；同种子两跑逐字相同（sha256 `5dfc40b3…`）；
  `npm test` 2120（0 失败）、`test:browser` 125/125。
- 没做到：同一栋楼多人同住的站位（每户目前只有 1 人）；不同住宅的起床错峰。
- 未验证：`test:buttons`（`/api/memory/list` 404，退出码 2）；
  `SMOKE_TIME=dawn|dusk|night` 的整套回归（夜里居民在家，后半段断言天然不成立，已不再当作全绿口径）。

### 闸门（块 5 之后重跑）

| 闸门 | 结果 |
| --- | --- |
| `npm run check` | 语法 0 / 语义 0 |
| `npm test` | 2120 用例：2111 通过 / 9 跳过 / **0 失败** |
| `npm run build` | 通过 |
| 五个审计 | palette、references（146 处 0 存疑）、citations、sections（158 处）、claims（5/5）+ adr-schema 9/9 全过 |
| `test:persistence` | 8/8（v5、11 栋、摆件 2、雾 38） |
| `test:phases` | 17/17 |
| `test:render-budget` | 6/6 |
| `test:setting` | 通过 |
| `trace:record/replay` | `replayable`，三枚指纹两次逐字一致且等于录制值 |
| `test:browser` | **125/125 通过**（`time=noon&now=10:00`；断言未改） |
| `test:buttons` | **未验证**：`/api/memory/list` 返回 404（退出码 2，既有缺口，未改代码） |

### 阻塞

- 无代码阻塞。**待你拍板**：新世界/新存档的模拟起点仍是 00:00（夜里），
  是否要把开局挪到白天——这会影响所有「开局街面」的观感与存档起点，我没有擅自改。


## 块 6 · 抓拍口径自证（第 0 步）：四时段过、smoke 未过，熔断 ①③ 命中

详细清单见 `docs/evidence/SCREENS_CAPTURE_GATE.md`，逐张原始读数见 `docs/evidence/screens-capture-gate.json`。

### 改了什么（只动抓拍口径与调试钩子，世界语义零改动）

- `world-client/src/scenes/SandboxScene.ts`：新增 `pinnedClock` 与 `update()` 里的冻钟分支（`sim.update(0)` + 正常重绘），
  以及 `jumpWorldClock(minuteOfDay)` / `freezeWorldClock()` / `unfreezeWorldClock()` / `worldClockPinned()` 四个只读调试钩子。
  **没有碰 `simulation.ts`**（那条线有人在改）。
- `world-client/scripts/lib/capture.mjs`（新）：`waitFadeSettled`（画布内左下角 26×26 草地取样，连续 3 帧字节相同即收敛，上限 6 s）、
  `waitVillagersSettled`（pos/visible 连续 3 拍不变）。
- `world-client/scripts/check-phases.mjs`：开局 `setCameraMode('free')` + `centerCameraOn(祭坛)` 钉取景 → 等居民落定 →
  `jumpWorldClock(35)`（00:35）+ 冻钟 → 压暗层探针；night-rain 雨前先探针、雨后固定 3000 ms。
- `world-client/scripts/smoke.mjs`：01–06 钉相机；07/08 在 12:30 静段等两人空闲 → 冻钟 → 相机钉 `(768,576)`；
  08 循环前把 `overflowY` 钉成 `scroll`（修 400% 那张 16px 尺寸漂移）；把"展开注入区"移到过滤截图之前、
  把 `feed` 与 `ext-1` 注入移到解冻之后（冻钟期间注入的活永远做不完，会把"等两人空闲"拖黄）。
- `world-client/eval/screens/`：**一张未动**（没有重录）。

### 第 0 步两次读数（判据：可见差 = 任一通道 ≥8 级的像素占比）

四时段（`43eb9c9` worktree，只加调试钩子，两跑）：

| 图 | 精确差 | 可见差 |
| --- | --- | --- |
| phase-dawn / noon / dusk / night | 0.00% | 0.00% |
| phase-night-rain | 39.51% | 1.30% |

新树复测：四刻仍 0.00 / 0.00；night-rain 1.62% / 0.62%。

smoke 13 张（同一棵 HEAD `eae8553` 两跑，B1 vs B2，均 130 项全绿）：

| 图 | 精确差 | 可见差 |
| --- | --- | --- |
| 01-salute | 25.10% | **24.765%** |
| 02-working | 8.66% | 0.186% |
| 03-deliver | 50.44% | **1.128%** |
| 04-rain | 0.06% | 0.063% |
| 05-build | 0.01% | 0.005% |
| 06-faith | 10.42% | 0.085% |
| 07 四张 | 12.95–12.98% | 0.099% |
| 08 三张 | 35.37–36.48% | 0.151–0.152% |

08 三张尺寸两跑一致：`964×643 / 1931×1285 / 3904×2569`。

### 熔断

| 熔断 | 命中 | 说明 |
| --- | --- | --- |
| ① 两次可见差 >0.2% | **是** | 01 = 24.765%、03 = 1.128% |
| ② 探针 6 s 不收敛 | 否 | 四刻探针 496–578 ms 收敛；night-rain 雨前 962 ms |
| ③ 07/08 钉死后仍不同 | **是** | 可见差 0.099%（判据要求 0）；差异是同一世界上两个 32–44px 小物件，`bestShift=0` |
| ④ 重录后冒出原本没有的渲染变化 | 不适用 | 没有重录 |

### 诊断（都不是回归）

- **01-salute**：`bestShift=(0,0)`、HUD 0 差 → 没有整体位移；差异集中在暗色地面/植被（蓝通道恒 +9），
  石墙区均值 ≈0；再叠人物 1–2px 落脚差。归因 **d**（抓拍时刻差一个世界分钟 → 环境染色档位不同）。
- **03-deliver**：可见差异只有 1 个 104×170 区域，坐标恰好是烟囱烟柱；粒子按帧发射 + 1.4 s 生命周期，
  冻世界时钟也停不下 `scene.update` 的粒子推进。归因 **d**（活动粒子）。
- **07/08**：两跑同位置的两个小物件"时有时无"，属按世界毫秒走的装饰动画相位；不是面板文本/时间戳（HUD 像素 0 差）。

### 做到 / 没做到 / 未验证

- 做到：四时段在未改世界代码的树上一连两跑 exact/vis 全 0；smoke 两次都 130 项全绿；08 尺寸钉死；
  所有抓拍等待的实际毫秒都落进日志（四刻 29.75–30.06 s，其中居民落定 29.25–29.48 s、压暗层 0.50–0.58 s）。
- 没做到：第 3 步（逐张旧/新 sha256 与重录）、第 4 步（四道复跑）**均未执行**；基线一张未改。
- 未验证：01–06 加压暗层探针 + 固定分钟钉钟能否把 01 压到 ≤0.2%；坐定后跳到固定分钟再冻能否让 07/08 到 0；
  03 的烟能不能靠"冻钟后等 1.4 s 再拍"消掉；`check-phases` 有一次在 dawn 后中断（重跑即全绿，原因未查明）。

---

## 块 7 · `01-salute` 两跑归因：性质 = 代码/状态，不是 GPU（已修，基线待重录）

- 证据目录：`docs/evidence/salute-nondeterminism/`（`01-NONDETERMINISM.md` + 逐张 diff JSON + 探针原始记录 + 开关矩阵）
- 目标：**同构建、同机器、同脚本，两跑可见差必须为 0**

### 性质判定

**代码/世界状态不确定，不是浏览器/WebGL/GPU。**
01 的抓拍落在「等 `#reply`」之后，世界在 `speed=30` 下继续跑；两跑停在不同世界时刻 →
潮位跨过草地淹没阈值（`TERRAIN_HEIGHT.grass = 0.3`）→ 整片草地多一层 `ink + water`（蓝通道恒 +9）；
同时两个居民还在走，精灵位移 1–2px。

### 证据链（哪一步排除了哪一半）

| 步 | 做法 | 结果 | 排除了什么 |
| --- | --- | --- | --- |
| 1 | 像素归因 | 235,124 px（24.765%）中 92% 是 `(45,59,46)→(46,63,55)`，四块草地矩形；石板/墙 0 差 | 排除整屏滤镜/调色板/编码 |
| 2 | 潮位扫描（同进程 7 个世界时刻） | 草地色随 `tide.level` 单调变化（0.027→`(45,59,46)`，0.977→`(34,45,42)`） | 定位到潮位覆盖层 |
| 3 | 算术复核 | level 刚过 0.3：压暗 0.05 + water α 0.138 → `(46,64,55)` | 与观测色对一致 |
| 4 | `gl.readPixels` vs PNG | 逐字节相同 | 排除截图链路（DPR/合成/编码） |
| 5 | 同进程冻钟隔 3 s 连拍 | exact/visible 0.0000%、maxdelta 0（两个进程都 0） | 排除每帧渲染抖动/量化/浮点 |
| 6 | 跨进程冻钟（差 1 个逻辑步） | exact 24.2368%、visible 0.1045%（992 px 全在小人/气泡） | 证明差异只来自「冻在哪一拍」 |
| 7 | 开关矩阵：硬件 GL vs SwiftShader | 同状态 A1/A2、跨后端 A1/A1′ **全部 0.0000%** | **彻底排除 GPU/驱动/ANGLE/MSAA** |
| 8 | 代码审查 | 渲染路径无 `Math.random`/`Date.now`/`performance.now`；bake 用整数 hash；无最近色浮点比较；相机 `scrollX/Y=528/416` 整数 | 没有「渲染本身不确定」的点 |

### 修法（最小，夹具，不动判据/基线/世界语义）

- `SandboxScene.ts`：新增 `pinnedPresentedNow` / `pinnedTideLevel` 与 `pinShotState()` / `unpinShotState()`，
  `renderSnapshot` 里 7 个跟时间走的调用点改用 `presentedNow` / `tideLevel`（钉住时才生效）。
- `smoke.mjs` 01 段：**看到两个人都站定** → 就地 `freezeWorldClock()` + `pinShotState(当天 12:30, 潮位 0)` →
  钉相机 → 提交 → 行礼 → 拍照 → `unpinShotState()` + `unfreezeWorldClock()`。
- 判据、阈值、`eval/screens/` 基线**一个没动**；存档 v5 未动。

### 读数（同构建、同机器、同脚本）

| 阶段 | 01 精确差 | 01 可见差 | maxdelta |
| --- | --- | --- | --- |
| 修前 B1 vs B2 | 25.096% | **24.765%**（235,124 px） | 220 |
| 修前 A2 vs B1（参考） | 26.103% | 25.727% | 212 |
| 修后第一版 run1 vs run2 | 0.0000% | 0.0000% | 0 |
| 修后第一版 run1 vs run3 | 1.0248% | 0.9495% | 220 |
| **修后最终 run4 vs run5** | **0.0000%** | **0.0000%** | **0** |
| **修后最终 run4 vs run6** | **0.0000%** | **0.0000%** | **0** |
| **修后最终 run5 vs run6** | **0.0000%** | **0.0000%** | **0** |

三跑 13 张全部算过；01 之外的镜头仍有同类残余（见下）。

### 被否的写法

1. 只 `freezeWorldClock()`：冻在哪一拍仍随机，跨进程冻钟仍差 0.1045%。
2. 只冻在「看到行礼那一拍」+ 钉呈现态：两跑 0、第三跑 0.9495%（另一个角色阿雾还在路上，多走约 4px）。
   → 必须等「两个人都站定」。**这条也说明「两跑为 0」可能只是运气。**
3. `TideOverride` 压潮位：上限 2 分钟世界时间（`speed=30` 下 4 秒实时），压不住，且会改 HUD 文案与事件语义。
4. 只改相机：镜头本来就在整数格，差异不在镜头。
5. 调慢 `speed`：摊薄概率，不是确定性。
6. 放宽可见差判据 / 改 Δ 阈值：明令禁止。

### 做到 / 没做到 / 未验证

- 做到：性质判定与证据闭环；01 三跑两两个 0（exact 与 visible 都是 0、maxdelta 0）；SW/HW 同状态逐字节相同。
- 没做到：其它镜头没修 —— 06-faith 三跑里两对 10.4%（同一对草地色，潮位阈值）、04-rain 两对 10.1%（相机取整跨格平移 16px）、
  03 烟柱 0.87–1.84%、07/08 0.05–0.16%。
- 没做到：01 的**构图变了**（等站定的几十秒里莞尔被作息带到齿轮塔，原基线在祭坛边）→ **01 基线必须重录**。
- 未验证：`test:phases` / `test:persistence` / `test:render-budget` 三门没跑（改动只在钉住分支与 01 抓拍段）；
  跨天场景（`dayStart` 平移）未验证；`pinShotState` 无单测。

### 阻塞（给下一步的输入）

- **不能开始整套重录**：01 可以重录，但 06/04/03/07/08 还会翻；要么先把同一套夹具推过去，要么明确接受这些镜头非零。
- 01 若要保留祭坛构图，需要把世界时钟拨到「两人都在锚点且莞尔在祭坛」的确定时刻（本轮没做）。

## 块 8 · 剩余 12 张的「钉住可复现性」：世界侧全绿，剩下全是动画与截图链路（只测不改）

- 口径：`PIN_SHOTS=1`（`smoke.mjs` 的环境开关，默认关闭，正常抓拍一字未改）。逐张冻世界钟 +
  `pinShotState(当天 12:30, 潮位 0)` + 镜头钉整格，拍完解钉解冻；`07/08` 保持原口径不加钉。
- 三跑：run1 / run2 / run3，同构建、同机器、同脚本、端口 5210。**未重录基线、未改阈值、未动存档 v5。**
- 证据：`docs/evidence/pin-shots/01-REPRO-MATRIX.md`、`diff-pinned-3runs.json`（含新增的"结构差"：
  可见差掩膜的 8 连通块、最大块面积/bbox/尺寸）、`crops/`（逐块三行对比图）、`day-scan.json`、`composition.json`。

### 性质判定（按用户五类）

| 类 | 张数 | 图 |
| --- | --- | --- |
| 甲 钉住即 0 | 1 | 01-salute |
| 乙 同病因（时刻/潮位/相机未钉干净） | **0** | —— 钉住时刻+潮位后草地色阶差全部消失 |
| 丙 位置量化（跨格 16px） | **0** | —— 逐整数平移搜索最优位移全是 dx=0,dy=0 |
| 丁 内建动画 | 4 | 02、03（烟柱）、04（雨丝）、05（烟柱细股） |
| 戊 其它 | 8 | 06（底栏世界时钟文字）、07×4（画布半像素 + 面板文字）、08×3（合成器 1 级差 + 元素截图尺寸不稳） |

关键数字：

- 02：三对可见差 0.3253 / 0.3269 / 0.3834%，最大块 58×120 @[624,193]，裁图确认是烟柱。
- 03：0.5410 / 0.4807 / 0.4554%，104×66 @[610,69]，同一根烟柱。
- 04：0.0169 / 0.0079 / 0.0209%，一根雨丝 + 底栏"第 N 分 SS 秒"数字。
- 05：0.0312 / 0.0512 / 0.0293%；run1↔run3 另有 58,552 px（6.2%）**只差 1 级**（合成器半像素）。
- 06：0 / 0.0384 / 0.0384%；所有块都在底栏时钟（run1/run2 同为 893 分 30 秒 → 0）。
- 07：run1 是离群跑（16.52%/4.12%，画布左边缘 13×640 竖条），run2↔run3 只有 0.175%/0.140%
  （面板事件行文字）；12% 画面只差 1 级 → 合成器重采样。
- 08-100：35.2% 精确差里 212,578 px 只差 1 级；08-200 宽度三跑 1935/1931/1935；08-400 宽度 3920/3920/4008，
  run1↔run2 可见差 37.79%、最大块 3,301,512 px → 元素截图拼接不稳。

### 口径建议（不实现）

- 乙：钉 `presentedNow` + `tide.level`（本轮已做）；代价是画面固定在 12:30/退潮，快照仍报真实值。
- 丙：只能钉相机整格 / 精灵落点；代价是镜头不再跟拍，构图最多偏一格。
- 丁：只能降级成结构判据（存在性 + 面积区间）或把 `renderSnapshot` 的 `delta` 也冻成 0；
  降级损失是动画颜色/形状回归会漏。
- 戊：底栏时间钉死或隐藏；`#stage` 整数定位或只截元素；`08` 固定视口 + 常驻滚动条。
  **这一条只能靠夹具兜住，不能靠判据。**

### 01 构图结论

- 存在确定的"状态"，**不存在只由时刻决定的时刻**：同一 07:05，扫描路径落到 (48,36)/(40,40)，
  一次直达却落到 (40,40)/(56,33) —— 作息走 `routineIndex`，不看 `now`。
- 可用路径：`jumpWorldClock(750)` → 等 `莞尔 pos == altar (48,36)` → 派单 → 在祭坛行礼；
  代价是安静段两人都回锚点、**重叠在 (48,36)**，回不到基线那种"莞尔祭坛 + 阿雾街口/农田"。
- 若坚持原构图，只能等状态（莞尔祭坛 + 阿雾 (40,40) 或 (56,33)），最长约一个作息周期（≈200 秒实时 @speed=30）。

### 三道闸门

- 不跑：`check-phases` / `check-persistence` / `check-render-budget` 都不调用 `pinShotState`；
  默认 `pinnedPresentedNow === null` → 渲染路径与改前等价。
- 待补：`pinShotState` 8 条单测（钉 now、钉 tide、解钉、不改快照、不动冻钟、非法输入、幂等、phaseView 拷贝分支）。

### 被否的写法

1. 把 01 的"站定"夹具原样推到所有镜头：02 的语义是"在铺子里干活"，等站定会拍到别处。
2. 只冻世界钟、不钉潮位：草地色阶差会原样回来（本轮 06 之前 10.4% 就是这个）。
3. 用整页截图比 07/08：面板宽度变化会让画布落在半像素，全屏 1 级差无论如何都清不掉。
4. 把 08-400 当逐像素判据：元素截图尺寸本身就不稳定（3920 vs 4008）。

### 没做到 / 未验证

- 07/08 的"半像素"只做到相关性（面板宽度 → 画布 x 偏 1px），没有直接读 `getBoundingClientRect()`，也没改 `index.html`/CSS。
- 08-400 的 3.3M px 大块没有逐块定位到滚动/切片策略。
- 三门闸未跑；`pinShotState` 无单测；跨天与存档 v5 读入未验证。
- 12 张里 0 张到 0。**不能开始重录。**
