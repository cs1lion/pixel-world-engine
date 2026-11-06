# 第五枚钉子：角色的位置与姿态

分支 `fix/shot-pin-actor`（从 `origin/main` `b4bfc45` 切出）。本轮只验钉子成立不成立，**不重录任何基线**。

## 一、结论先说

| 组 | 等待档 | 精确差 | 可见差 | 结构块 |
| --- | --- | --- | --- | --- |
| 四钉（`nowMs` + 潮位 + 相机 + zoom） | 1200 vs 2800 | **1.4056%**（8636 px） | **1.4035%**（8623 px） | 4 块，最大 **8048**（104×120）@ `[264,520,367,639]` |
| 五钉（+ 角色位置/姿态） | 2800 vs 5000 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |
| 五钉 | 1200 vs 2800 | **0.0104%**（64 px） | **0.0104%**（64 px） | 1 块，最大 **64**（8×8）@ `[332,620,339,627]` |
| 五钉 | 1200 vs 5000 | **0.0104%**（64 px） | **0.0104%**（64 px） | 1 块，最大 **64**（8×8）@ `[332,620,339,627]` |
| 反向：v0 偏 1 格 | 1200 vs shift | **2.6396%**（16218 px） | **2.4920%**（15311 px） | 7 块，最大 **14704**（148×124）@ `[476,264,623,387]` |

**补了这枚钉子之后，等待时长仍然影响画面——但不是角色了。** 四钉最大块 8048 正是阿雾本人
（`[264,520,367,639]` 104×120），补钉后角色那一块消失、2800 与 5000 做到逐像素 0；
1200 档仍剩 1 块 64 px，溯源结果是 **`snapshot.trails` 的踩踏痕**（见第五节），不是粒子相位、不是雨幕 seed、不是光照相位。

第六枚钉子应当是**随时间累积的地面字段 `trails`**（以及同类的“只增不减”字段），见第六节。

## 二、第五钉钉了什么

`world-client/src/render/pin-shot-state.ts`：

```ts
export interface ActorPin {
  readonly id: string;        // 快照里的 villager.id
  readonly pos: Vec2;         // 格坐标（与 snapshot.villagers[].pos 同一口径）
  readonly facing: Facing;    // up/down/left/right
  readonly mode: VillagerMode;
  readonly walking: boolean;
  readonly frame: number;     // 姿态帧号（IDLE_POSES / WALK_POSES 的下标，取模）
  readonly visible: boolean;
}
export interface ShotPin {
  readonly nowMs: number | null;
  readonly tideLevel: number | null;
  readonly actors: readonly ActorPin[];   // 第五钉
}
```

- 姿态按**帧号**取，不再按时刻取：`villagerPoseAtFrame(mode, walking, frame)` 是新入口，
  `villagerPose(mode, walking, nowMs)` 改成它的一层薄委托（`animFrame(nowMs, n)` 喂进去）。
  钉住后渲染读到的每一帧都等于钉入帧号，等待时长与灯油都进不了姿态。
- 渲染读取路径（`SandboxScene`）：
  - `paintingSnapshot()` = `pinVillagers(pinnedVillagersOf(shotPin, snapshot), pinnedVillagers)`
    —— 第五钉在最下层，判据摆位（`pinnedVillagers`）仍可压过它，与既有调试入口的层级一致；
  - `renderSnapshot()` 与两处 `minimap.update()` 都改读它（小地图不是另一条路径）；
  - `updateVillager(...)` 末尾新增可选参数 `poseFrame`，由 `actorFrameOf(shotPin, villager.id)` 传入。
- 不写存档、不动 `Simulation`、不改 world 状态：`pinShot` 返回新对象，快照本身只读不写；
  `pinnedVillagersOf` 只在命中 id 时拷贝，未命中的人保持同一引用（单测第 14 条守着这点）。

### 契约（逐字兼容）

`pinShotState(nowMs: number, tideLevel: number)` **一个字符没动**，参数顺序不变；
第五钉走并列入口 `pinActors(actors: readonly ActorPin[])` 与 `unpinActors()`（无参）。
`unpinShotState()` 无参复原时连角色一起解。单测第 16 条把三条签名都钉住。

`pinShot` 由 `{ nowMs, tideLevel }` 改为 `{ ...prev, nowMs, tideLevel }`：否则
`pinShotState` 之后调 `pinActors` 时，或反过来，先钉的那一枚会被后钉的那一枚抹掉。

## 三、单测

`world-client/test/pin-shot-state.test.ts`，**16/16 通过**（含既有四钉 1–9 条）：

| # | 断言 |
| --- | --- |
| 10 | 钉住后连取三帧，`pinnedVillagersOf` 得到的 `pos/facing/mode/walking/visible` 全等钉入值；`actorFrameOf` 恒等钉入帧号 |
| 11 | 两组姿态各自复现：`villagerPoseAtFrame('idle',false,0)` 与 `('idle',true,2)` 可区分且各自稳定；未钉 id 返回 `null` |
| 12 | 解钉语义：`unpinActors` 只解角色（时刻保留）、`pinShot` 不抹角色、`unpinShot()` 回 `NO_SHOT_PIN` |
| 13 | 非法条目逐条丢弃（空 id / NaN pos / 非法 facing / frame −1 / frame 1.5），全非法等价解钉且返回同一对象 |
| 14 | 快照不变性：钉住返回拷贝、原快照未改、未钉的人同引用；默认路径零拷贝；一个 id 都没命中也不拷贝 |
| 15 | 等待无关：`villagerPose('idle',false,1200).frame !== villagerPose('idle',false,2800).frame`；钉住后同一帧号必得同一姿态 |
| 16 | Oracle 契约：`pinShotState` 仍是 `(nowMs: number, tideLevel: number)`；`pinActors`、`unpinActors` 无参/单参形状不变 |

顺带修了一处读数与画面对不上：`debugGroundShadowUnits()` 原来用 `pinVillagers(this.snapshot, ...)`
读脚底，钉住角色后影子画在钉住位置、读数还是世界位置；改成同一个 `paintingSnapshot()`。

## 四、负控夹具与三档读数

夹具 `world-client/scripts/check-shot-actor-pin.mjs`（独立 context，1010×940，`localStorage.clear()`，
`?feed=off&debug=1&time=dawn&now=300&speed=30`，锚点 `centerCameraOn(52*16, 32*16)`）：

- `four-1200` / `four-2800`：**不调** `pinActors`，只钉时刻 07:34 + 潮位 0 + 相机；
- `five-1200` / `five-2800` / `five-5000`：同一套 pin，另钉两条：
  `v0 = (52,32) down idle frame 0`、`v1 = (48,36) up idle frame 1`；
- `five-shift`：同上，只把 `v0` 的 `pos.x` +1 格（(53,32)），其余逐字相同。

冻结前等待（`waitForTimeout` 的时长）只改这一个旋钮。三层读数用
`scripts/screens-diff.py`（同名配对，精确差 / 可见差 / 8 连通结构块）：

```
four.png              exact 1.41%  vis 1.40%  blocks 4 largest 8048 [104,120] [264,520,367,639]
five1200-2800.png     exact 0.01%  vis 0.01%  blocks 1 largest   64 [8,8]     [332,620,339,627]
five1200-5000.png     exact 0.01%  vis 0.01%  blocks 1 largest   64 [8,8]     [332,620,339,627]
five2800-5000.png     exact 0.00%  vis 0.00%  blocks 0
five-shift.png        exact 2.64%  vis 2.49%  blocks 7 largest 14704 [148,124] [476,264,623,387]
```

原始读数在 `actor-pin/<组>/screens-diff.json`，掩膜在同目录 `masks/`。六张源图留在
`world-client/eval/screens/actor-pin/`（不入库，本轮不重录基线）。

- 四钉的两块 285 px（`[288,468,312,479]`、`[307,500,331,511]`）是两块名字牌，最大块 8048
  才是人；也就是说四钉下“等站定”等了 2800ms 之后，人确实站到了另一个地方。
- 反向 `five-shift`：精确差 >0，最大块 `[476,264,623,387]` 正是被挪的莞尔本人
  （钉的是 (52,32) → 屏幕中心一带），另有名字牌与两处影子尖端跟着走。判据没有被钉死成“永远绿”。

## 五、1200 档残余 64 px 溯源（第六枚的实证）

1. **不是角色**：把两条 `pinActors` 都挪到 (8,8)/(9,9)（画面外）再跑 1200 vs 2800，
   残余块仍在 `[332,620,339,627]`、仍 64 px。
2. **阈值与“踩踏痕出现”同一刻**：1200↔1500 = 0、1500↔1600 = 0、1600↔2000 = **64 px**、
   2000↔2800 = 0。而 `snapshot.trails` 的读数正是 1600 时空 `[]`、2000 时
   `[{ at: {x:49, y:36}, strength: 2 }]`。同一时间窗内没有别的快照字段变化。
3. **位置逐像素对上**：本夹具相机 `scrollX/scrollY = 592/352`、`zoom = 2`、画布 960×640，
   可视世界 = `scroll + width/2 ± width/(2·zoom)`，即 `worldView = (712,432)`、15×10 格，
   屏幕映射 `screen = (world − worldView) * 4`。残余块 `[332,620]` → 世界 `(795,587)` →
   格 `(49.7,36.7)`；trail 的画法 `fillRect(px+3, py+11, 10, 2)` 于格 (49,36) 即
   `(787,587)–(797,589)` → 屏幕 `x 300–340, y 620–628`，残余块正好落在它露出的一截
   （左侧 300–331 被提灯柱压住，取样 `c69445 / 292621`）。
4. **颜色对得上**：`#4c5247 → #42473e` 就是 `palette.soil` 以 `alpha 0.28` 压在草地底色上，
   即 `decor.syncTrails` 的强度 2 那一笔；`deltaHistogram` 的 `ge32 / ge64 / ge128` 全 0，
   也说明这不是像素位移或角色重绘。

排除项（都开关过、残余不变）：湾面低雾、鸟/氛围、落地投影、灯的点燃/呼吸/摇摆、摊布的
火与布、幌布的摇摆与影、烟的分段漂移、街道灯强制熄灭。快照逐字段 diff 里只有
`now / tide.level / trails / villagers` 四处不同，其中前两处已钉、第三处就是 trails、
第四处由第五钉覆盖；`weatherIntensity = 0`、`phase = dawn`、`packed = false` 两跑全等。

**所以第六枚不是“粒子相位 / 雨幕 seed / 光照相位”，是 `trails`。**
它是世界侧“只增不减”的累积字段（`world/trails.ts`：可见阈值 ≥2，只增不减），
随冻结时刻变化，而 `pinShotState` 的四钉里没有它，`pinActors` 也不管它。

## 六、下一轮要补的第六枚（未做）

- 入口：与 `pinActors` 并列的 `pinGroundTrails(trails: readonly {at, strength}[])` /
  `unpinGroundTrails()`，或并进 `ShotPin` 的 `trails` 字段；`pinShotState` 签名继续不动。
- 渲染读取路径：`decor.syncTrails(...)` 改读钉住列表；`paintingSnapshot()` 里同时替换
  `trails`（和 actors 一样只派生画面用快照）。
- 判据：三档 1200/2800/5000 必须精确 0 / 可见 0 / 结构块 0；反向用例把钉入的 trail
  挪一格，必须判红且结构块落在该痕 bbox 内。
- 同类风险：任何随世界时刻单调累积的地面字段（`memory` 的 trace `visibility` 按**日**风化，
  本轮 45 s 内不动，可不算；`snapshot.roads/props/critters/constructions` 本轮两跑全等）。
  下一次破 0 差时先跑同一套“逐字段 diff + 按阈值二分”的定位法，别再从渲染层猜。

## 七、闸门

| 闸门 | 命令 | 读数 |
| --- | --- | --- |
| 类型 | `node scripts/check-types.ts` | 语法 0 处 / 语义 0 处 |
| 单测 | `node --import ./test/phaser-hooks.mjs --test test/*.test.ts` | tests 2381 / pass 2372 / fail 0 / skipped 9 |
| 构建 | `node node_modules/vite/bin/vite.js build` | 193 modules，dist 1,762.47 kB（gzip 499.33 kB），697ms |
| 负控 | `node scripts/check-shot-actor-pin.mjs` → `screens-diff.py` | 见第四节 |

开发服务器端口 5211（避开 5188 / 5191 / 5202 / 5203）。未 push、未合 main。
