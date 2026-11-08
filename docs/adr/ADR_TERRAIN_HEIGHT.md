# ADR：分层高度差地形 + 地貌（设计 + 阶段 1 数据模型）

- status: pending-review
- verified_at: 2026-11-06
- verified_by: agent，按只读证据核对，用户授权，2026-11-06
- date: 2026-11-06
- scope: 设计文档；阶段 1 只落数据模型，不改渲染坐标、不接消费者
- 代码快照: `f11852c`（`origin/main`）
- evidence: `world-client/src/world/grid.ts`, `world-client/src/world/types.ts`, `world-client/src/world/setup.ts`, `world-client/src/world/save.ts`, `world-client/src/world/tide.ts`, `world-client/src/world/simulation.ts`, `world-client/src/world/routines.ts`, `world-client/src/world/world-changes.ts`, `world-client/src/render/tilemap.ts`, `world-client/src/render/bake.ts`, `world-client/src/render/villager.ts`, `world-client/src/render/buildings.ts`, `world-client/src/render/building-depth.ts`, `world-client/src/render/prop-depth.ts`, `world-client/src/render/scenery-depth.ts`, `world-client/src/render/terrain-edges.ts`, `world-client/src/scenes/SandboxScene.ts`, `world-client/scripts/check-render-budget.mjs`, `docs/adr/ADR_SAVE.md`, `docs/adr/ADR_WORLD_FACTS_SOURCE.md`, `world-client/test/pave-reachable.test.ts`, `world-client/test/path-cost.test.ts`, `world-client/test/tide.test.ts`, `world-client/test/settings.test.ts`, `world-client/test/pack-venue.test.ts`

> **行号口径**：下面给的 `文件:行号` 只对 `f11852c` 成立。仓库的引用审计查不出「这一行还是不是那个东西」，
> 所以每个关键位置同时给**可 grep 的记号**（函数名 / 常量名 / 原句）。行号漂了就以记号为锚，别以行号为准。

> **这份文档的「现状」指 `f11852c` 的真实代码，本身不是实现证据**：那时仓库里没有高度字段、没有高度投影、没有地形改动入档、没有桥/沟/梯。
> 之后的「阶段 1（仅数据模型）」已落地：`TileCell.level`、`GridSpec.levels/ramps/ladders`、`grid.levelAt`、
> `world.terrainEdits` 的 v6 结构与序列化。**这些字段没有消费者**——渲染、寻路、存档重建都不读 `level`，
> 抬层不会改变任何像素或可达性；投影收敛、`canStep`/`nearestWalkableOnLevel`、崖面仍只在设计里。见 §8 的落地记录。
> 凡是我查不到的，§11 明说查不到。

---

## 0. 四件事速答

1. **数据模型**：高度只放**格子属性** `TileCell.level: number`（整数层，0 = 今天这张平面）。
   作者输入放 `GridSpec.levels`，玩家改动放存档 `world.terrainEdits`；运行时只认 `grid.levelAt(p)`。
   不做区域多边形，不做多 layer——那都会留下第二套高度表示。
2. **渲染与遮挡**：今天**没有投影函数**，只有各渲染器里逐格写的 `(x,y) → 像素`。
   新增唯一换算（阶段 0 的 render/ground.ts，尚未创建）：屏幕脚底 `y = (gridY + 1) * 16 - level * 16`。
   深度仍按**行号**排（不是按投影后的脚底），只加 `- level * 0.5` 的亚像素项；
   会挡人的地形另外烘焙成每行一条裁剪 Image（同一张纹理），深度夹在「北边的人」和「站在上面的人」之间。
3. **可达性**：会被打穿，而且**不是现有测试会变红那种打穿**。`nearestWalkable()` 只看二维距离、不看层，
   `reaches()` / `path()` 的兜底就可能把目标改写到悬崖另一侧，报「连得到」。具体失效清单见 §4.2。
   唯一写法：所有相邻通行只走 `grid.canStep(from, to)`，所有兜底只走 `nearestWalkableOnLevel(goal)`（同层几何最近），
   可达性仍只由 `path` 判。
4. **存档与回放**：地图底稿（含高度）**不入档**，和今天的地形一样由设定集重算；修桥、挖沟这类**玩家改动**入档。
   升 v6，加 `world.terrainEdits`（稀疏的最终值），旧档 v1–v5 迁移后补 `[]`。
   旧档能读，但底稿用的是**当前设定集**——所以「schema 兼容」不等于「世界逐格不变」。这是 `ADR_SAVE §1.2` 的既有取舍。

---

## 1. 现状：地形今天到底怎么存

### 1.1 地形是格子属性，不是多边形、不是多 layer

- `TileCell` 只有 `zone / terrain / region? / walkable / occupant` 五个字段：
  `world-client/src/world/types.ts:28-36`（grep `interface TileCell`）。
- `GridSpec` 的地形输入是矩形补丁 `terrain?: {x,y,w,h,terrain}[]`：
  `world-client/src/world/grid.ts:38-52`（grep `readonly terrain?:`）。
- 构造时先按分区推地形、郊野长树，再逐块覆盖 `spec.terrain`：
  `grid.ts:120-157`（grep `constructor(spec: GridSpec` / `for (const patch of spec.terrain`）；
  分区到地形的映射在 `grid.ts:603-614`（grep `function terrainFor`）。
- 地形只有一层：底色 → 材质纹理 → 拼接边，一次画进一张静态贴图：
  `world-client/src/render/tilemap.ts:24-80`（grep `export function drawTerrain`），
  烘焙入口 `SandboxScene.ts:778-786`，深度 `-10`，纹理尺寸 = `grid.width * TILE_PX × grid.height * TILE_PX`
  （默认大世界 96×72 → 1536×1152）。
- `TILE_PX = 16`：`world-client/src/world/setup.ts:13`；大世界规格 `setup.ts:70-80`；
  地形区域的“高度序”不是几何高度，是画边优先级：`render/terrain-edges.ts:52-61`。

**结论**：高度加在**格子属性这一层**最合身。它天然是逐格的（悬崖就是相邻两格的层差），
寻路、烘焙、存档重放都按格读；区域多边形表达不了「一格高、一格低」，多 layer 会制造两套真值。

### 1.2 网格不存档，只按落位重放

- `ADR_SAVE §1.2`：`cells` 不入档，读档时 `rebuildGridFromPlacements()` 按存档里的 `buildings` 逐栋重放。
- 代码：`setup.ts:624-642`（grep `export function rebuildGridFromPlacements`），
  读档入口 `setup.ts:661-671`（`buildWorldFromSave`），
  生产入口 `main.ts:82`（`buildWorldFromSave(save.world.buildings, pack.blueprints, LARGE_WORLD_SPEC, LARGE_ALTAR)`）。
- 存档版本：`save.ts:37` `CURRENT_SCHEMA_VERSION = 6`（本阶段已升版）；
  v5 冻结指纹 `save.ts:71`；v5 新增路径 `save.ts:268`（`world.memory`）；
  v5 允许路径全集 `save.ts:598-602`；迁移表 `save.ts:1422`；v4→v5 迁移 `save.ts:1546-1560`。

### 1.3 今天没有投影函数，只有逐格换算

这不是“有一个 `project()` 忘了加高度”，而是**每一层各写一遍坐标**：

| 用途 | 位置 | 写法 |
| --- | --- | --- |
| 人物脚底 | `render/villager.ts:88-97`（grep `villagerFootAt`） | `x=(cell.x+0.5)*16`, `y=(cell.y+1)*16` |
| 人物深度 | `villager.ts:100-102`（grep `villagerDepthAt`） | `ALTITUDE + footY + 8` |
| 建筑容器 | `render/buildings.ts:67-70` | `px=origin.x*16`, `py=origin.y*16` |
| 建筑落地线 | `render/building-depth.ts:34-41`（grep `buildingBaseY` / `actorDepthAt`） | `baseY=originY+footprintH*16`；`actorDepth=ALT+(gridY+1)*16+8` |
| 道具 | `render/prop-depth.ts:18`、`:29-30` | `(at.y+0.8)*16`，深度 `+8` |
| 布景 | `render/scenery-depth.ts` | 行号 + 12 / 4 的偏移 |
| 装饰 | `render/decor.ts` | 同样按 `py + ACTOR_DEPTH_OFFSET` |

`ALTITUDE = 1000`：`SandboxScene.ts:291`（grep `const ALTITUDE = 1000`）。
**已有 y 排序**：人物 +8、道具 +8、布景 +12/4、建筑 body 0 / decal 16 / front 32；
地形整体在 -10，所以「地形永远在人下面」。今天没有任何东西按高度改屏幕 y。

### 1.4 仓库里已经有两个叫 `TERRAIN_HEIGHT` 的表，都**不是**几何高度

这是本设计必须先清掉的坑：

| 位置 | 名字 | 真实语义 | 是否参与绘制/寻路 |
| --- | --- | --- | --- |
| `world-client/src/world/tide.ts:71-84` | `TERRAIN_HEIGHT` | 各地形“离水面的排水高度”，只给淹水判定用 | 否（只给 `isFlooded`，`tide.ts:180-184`） |
| `world-client/src/render/terrain-edges.ts:52-61` | `TERRAIN_HEIGHT` | 材质画边的优先级（树 > 草 > 农田 > 石 > 广场） | 只给“边画在谁身上” |

再加一个 `level` 就是**三个东西同名**。§2 的决策是：
`level` 独占“几何高度”这个词；上面两张表分别改名 `TERRAIN_WATER_CLEARANCE` / `TERRAIN_EDGE_PRIORITY`，
并写死使用边界——**绘制与寻路只准读 `level`，淹水只准读 clearance，画边只准读 edge priority**。

---

## 2. 数据模型决策

### 2.1 唯一表示：`TileCell.level`

```ts
// types.ts
export interface TileCell {
  zone: ZoneId;
  terrain: TerrainId;
  level: number;          // 整数层，0 = 今天这张平面；范围 0..MAX_LEVEL(3)
  region?: string;
  walkable: boolean;
  occupant: string | null;
  climb?: ClimbLink;      // 斜坡 / 台阶 / 梯子，见 2.3
}
```

- `level` 是**行走面标高**，不是水深、不是淹水高度、不是画边优先级。
- 必须是整数：浮点会让“同一格”出现无限种高度写法，也会让深度/存档指纹不稳定。
- 不允许负层：水面以下用 `water` 地形 + 全局水位，不用负数表达“水底”。
- `level` 由构造器一次算定，运行时不再有第二份数组。任何渲染、寻路、存档校验要问高度，
  **只允许** `grid.levelAt(p)`；任何改动**只允许** `grid.setLevel(p, level)` 与构造输入。

### 2.2 作者输入：`GridSpec` 加三块

```ts
export interface GridSpec {
  // ...today...
  /** 高度补丁，语义同 terrain 补丁；后写覆盖先写，默认 0。 */
  readonly levels?: readonly {
    readonly x: number; readonly y: number;
    readonly w: number; readonly h: number;
    readonly level: number;
  }[];
  /** 斜坡/台阶：登记一条边，两个端点必须整层差 1。 */
  readonly ramps?: readonly { readonly a: GridPoint; readonly b: GridPoint }[];
  /** 梯子：登记一条边，两个端点层差 >= 2。 */
  readonly ladders?: readonly { readonly a: GridPoint; readonly b: GridPoint }[];
}
```

应用顺序（与 `grid.ts:150-157` 的地形补丁同一处）：

1. 分区/树篱/郊野树 → 2. `spec.terrain` → 3. `spec.levels` → 4. `regions`。
5. 编译 `ramps` / `ladders` 成每个端点上的 `climb`：
   `{ kind: 'ramp' | 'stairs' | 'ladder', to: GridPoint }`；两端必须互指，否则构造时抛
   `WorldSetupError`（不静默取一侧）。
6. `walkable` 由地形与层推导一次：`water` 恒 false；**树（含树篱）今天恒 true（代价 2.5，不是阻挡物）**；其余保持今天的行为。
   **（2026-11-08 事实更正）** 此条原写「树篱恒 false」，与代码不符：`WALK_COST.tree = 2.5`、
   `isWalkable` 对 `tree` 为真。因此在潮位 0.31–0.42 的窗口里，树（`TERRAIN_WATER_CLEARANCE` 0.42）
   比被淹草地（0.30，代价 3.40）便宜，树篱会被当成抄近路的干通道（详见 `OPEN_ISSUES.md` O1）。

**为什么不做区域多边形**：分区矩形今天用于建造许可与群落叙事（`grid.ts:158-168`、`biomes.ts`）；
高度是逐格的几何，且悬崖的“边”必须落在格边界上。用多边形表达会引入“多边形重叠时谁赢”的优先级，
还得逐像素判定，和今天的格子寻路、存档落位都不是一套东西。

**为什么不做多 layer**：一张 `levelGrid` + 一张 `TileCell.level` 就是两套真值；改一处漏一处，
渲染与寻路会各读一份。这个仓库已经因为“两份写法”吃过亏（`ADR_SCALE_DUAL_READING` 的常量对/画面错）。

### 2.3 攀爬与“唯一写法”

`climb` 是**无向边**，登记一次、两端各存一份互指。规则只有一条实现：`WorldGrid.canStep(from, to)`。

- `Δlevel === 0`：按今天的 `walkable` + `accept` 判定。
- `|Δlevel| === 1`：仅当这条边登记为 `ramp` 或 `stairs` 才允许；平地迈上 16px 台阶**不允许**，
  必须是作者显式放的坡/阶。
- `|Δlevel| >= 2`：仅当这条边登记为 `ladder` 才允许；梯子默认双向，不支持单向跳下。
- 斜向（四邻域）不特殊处理：沿用今天只走上下左右的 `ORTHOGONAL` 约定（`grid.ts:506-511`）。

“上坡/下坡”不是两条规则：同一条 `climb` 边天然双向；差别只在代价：
`stepCost(from,to) = costAt(to) + (level(to) > level(from) ? UPHILL_COST : 0)`，
`UPHILL_COST` 初值 0（保证今天所有平地图逐字不变），启用时也只写在这一处。

“落水”只有一条：`canStep` 拒绝进入 `water` 格。水深/淹水不产生下落、不产生溺水；
浅水 `shallow` 仍按今天可走 + `FLOODED_WALK_COST`。桥是“把该格的 `terrain` 改成 `bridge`、
`level` 改成岸高”，于是 `Δ=0` 自然可走；不是另一套桥面高度。

### 2.4 与 world-rules / simulation / save 的关系

| 层 | 关系 |
| --- | --- |
| 设定集（world-rules 的输入） | 只提供 `levels/ramps/ladders` 的矩形/边登记；不定义运行时高度 |
| 世界规则 | 仓库没有独立的 world-rules.ts；规则分布在 `simulation.ts` / `behavior.ts` / `routines.ts` / `observation-rules.ts`。它们只通过 `grid` 读写，不持有第二份高度 |
| `WorldGrid` | 唯一高度容器；`levelAt` 读、`setLevel` 写、`canStep` 判、`stepCost` 算 |
| `Simulation` | 只通过 `grid.path` / `canStep` 受影响；不自己算高度，不自己改高度 |
| `render` | 只通过 `grid.levelAt` 取高度；不读 `TERRAIN_WATER_CLEARANCE` |
| `save` | 底稿不入档；玩家改动入档（§5） |

仓库里已有一个正面样板：`world/environment.ts:1-14` 把天气、潮位、时辰、光照收成一帧
`environmentAt()`，“读的人只问 `frame.flags`”，避免同一刻读成两个世界。高度应效仿它：
**读的人只问 `grid.levelAt(p)`**，不要各自去读 `spec.levels` 或第二张表。

**“一件事只有一种标准写法”的验收口径**：全仓 grep `height` / `level` / `elevation`，
除 `level`、`TERRAIN_WATER_CLEARANCE`、`TERRAIN_EDGE_PRIORITY` 与水面常量外，不允许出现第四种
“高度”命名；渲染与寻路代码里不允许出现 `clearance` / `edge priority`。

---

## 3. 渲染与遮挡

### 3.1 唯一投影函数

新增 world-client/src/render/ground.ts（阶段 0，尚未创建；纯函数，不 import Phaser，可在 Node 里验算）：

```ts
LEVEL_PX = TILE_PX;        // 初值 16；全仓只此一处，按层抬一整格
MAX_LEVEL = 3;
DEPTH_LEVEL_EPS = 0.5;     // 高度只贡献亚像素 tie-break；MAX_LEVEL × 它 = 1.5 < 最小间距 8

groundY(gridY, level) = (gridY + 1) * TILE_PX - level * LEVEL_PX;
actorDepth(gridY, level) = ALTITUDE + (gridY + 1) * TILE_PX + 8 - level * DEPTH_LEVEL_EPS;
propDepth(gridY, level) = ALTITUDE + (gridY + 0.8) * TILE_PX + 8 - level * DEPTH_LEVEL_EPS;
occluderDepth(gridY, maxLevel) = ALTITUDE + (gridY + 1) * TILE_PX + 4 - maxLevel * DEPTH_LEVEL_EPS;
```

改造点（不是只改一个函数）：

- `villagerFootAt` 加 `level` 参数，或改由场景传入 `groundY(pos.y, levelAt(pos))`。
- `villagerDepthAt` **必须从“投影脚底”改成“格行号 + level”**。今天签名叫 `footY`，
  一旦脚底被抬高 16px，同一个公式会把高地上的人排到北边低地人后面——见 3.2 的算式。
  建议直接改用 `building-depth.ts` 的 `actorDepthAt(gridY, altitude, level?)`，删掉 `villagerDepthAt` 这一份平行写法。
- `buildings.ts` 的 `px/py`、`prop-depth.ts` 的 `propFootY`、`scenery-depth.ts`、`decor.ts` 全部改走 ground.ts（阶段 0 新增）；
  建筑三层深度加 `- level * 0.5`，`BUILDING_DEPTH` 的 0/16/32 不动。
- `SandboxScene.ts` 调用处（如 `:4299`）改传 `gridY + level`，不再传投影后的 `foot.y`。

`LEVEL_PX` 与 `DEPTH_LEVEL_EPS` 是**渲染常量**，不是每格数据：不允许把“抬多少像素”写进存档或格子。

### 3.2 为什么深度必须锚在行号，而不是投影脚底

设悬崖在 `(x, R)`，层 1；它北边的格是 `(x, R-1)`，层 0；南边是 `(x, R+1)`，层 0。
取 `ALT = 1000`，常量取 `+8`（人）、`+4`（地形遮挡层）、`ε = 0.5`：

| 对象 | 屏幕脚底 y | depth | 与遮挡层的次序 |
| --- | --- | --- | --- |
| 北边低地人（R-1, 0） | `R*16` | `1000 + R*16 + 8` | 在遮挡层**之前** → 被挡 |
| 地形遮挡层（R, 1） | — | `1000 + R*16 + 19.5` | — |
| 高地上的人（R, 1） | `R*16` | `1000 + R*16 + 23.5` | 在遮挡层**之后** → 不被自己脚下挡 |
| 南边低地人（R+1, 0） | `R*16 + 32` | `1000 + R*16 + 40` | 在最后 → 不被挡 |
| 同排低地人（R, 0） | `R*16 + 16` | `1000 + R*16 + 24` | 在遮挡层之后 |

关键点：**北边低地人和高地上的人屏幕脚底是同一个 y（都是 `R*16`）**。
如果 depth 沿用“投影脚底 + 8”，两者会撞成同一个数，只能靠插入顺序决胜负——这就是“看起来像抖动”的来源。
把 depth 锚在 `gridRow`、高度只贡献 `0.5` 的亚像素项，次序是唯一且确定的：
北边人 < 遮挡层 < 高地上人，且 `0.5 × MAX_LEVEL = 1.5 < 8/12/16/32` 的最小间距，不会翻掉现有四层。

### 3.3 地形怎么抬、遮挡层怎么来

地形仍是**一张静态烘焙纹理**，但绘制顺序从“逐行”改成“逐行、行内低层先高层后”：

1. pass 1/2/3 的 `fillRect`/`drawTexture`/`drawTileEdge` 把 y 从 `y*16` 改成 `groundY(y, level)`；
   单元循环键 `(y, level)` 升序（`tilemap.ts:57-80`）。
2. 新增一面 pass：南邻层更低的格子，在它被抬走后留下的原脚印里画竖向崖面（高度 `Δlevel * LEVEL_PX`）。
   这是“南向立面”；本方案**不做东/西侧立面**（见 §9 红线）。
3. 新增第二张烘焙纹理 `world-terrain-occluder`：只画两类像素——
   - 北邻更低的格子被抬起来的那条带（它会盖住北边那格的下半身）；
   - 南邻更低的格子的崖面。
   然后切成**每行一条裁剪 Image**（同一张纹理、`setCrop`、`setOrigin(0,0)`），
   第 R 条的 depth 用 `occluderDepth(R, 该行最大层)`。
   同一纹理的裁剪图在 Phaser 里可合批；数量是 `grid.height`（大世界 72 条），不是 6912 格。
4. 地形改动（修桥/挖沟）后调用 `terrainLayer.rebake()` 与遮挡层 `rebake()`；
   `BakedLayer.rebake` 已存在（`render/bake.ts:126-139`），不用新 API。

**为什么不用“整张遮挡纹理 + 固定 depth”**：一张图的 depth 是常数，要么盖住所有人，要么谁也盖不住；
按行裁剪是为了让每一行有独立的 depth，和人物/道具共用同一把 y-sort 尺子。
**为什么不每格一个 Image**：6912 个对象、纹理批次和内存都不可控；行裁剪是同语义的最小代价。

**阶段 2 落地记录（调试演示口，不是作者输入通道）**：
渲染抬升与遮挡可以先用手工夹具演示，入口是 `?hd2d=on` 下的
`?hpatch=x,y,w,h,level[;...]`（给网格打临时水平层）与 `?occluders=off`（只关裁剪条，用于 O1 反证）。
纪律写在代码注释里，同样适用于本文档：

- `?hd2d=off`（默认）**结构上不解析** `hpatch`，不是解析后忽略。
- 格式非法必须 `throw`（整数、`x,y ≥ 0`、`w,h ≥ 1`、`level ∈ 0..3`），不许静默降级成平地。
- 不写存档、不参与 trace/replay、不进任何夹具；任何 recorder / 捕图脚本不得传这个参数。
- 真正的作者输入通道是 §8 **阶段 3** 的 `GridSpec.levels`；在它落地之前，本文档与任何证据
  不得写成“已经具备高度场景”——H1/H3 的观感只能靠上述调试补丁演示。

### 3.4 谁在前面，由什么决定

- **行号**决定主次序：`北 < 南`（与今天完全一致）。
- **层**只做同行的亚像素 tie-break：`高层 −0.5`（高层略靠后，符合“越高越远”的斜俯视观感）。
- **遮挡层**是夹在中间的一层：北邻低地人的 depth 小于它，高地人/同排人/南邻人的 depth 大于它。
- 因此“站在高地后面还是前面”不是看屏幕 y，而是看**这个人的格行与崖面行的大小**；
  屏幕 y 只决定他画在哪里，不决定谁盖谁。

### 3.5 代价（要先说清）

- 所有坐标换算点（§1.3 表里 7 处以上）都要改走 ground.ts（阶段 0 新增）；漏一处就是“人物抬了、道具没抬”。
- 地形绘制多一面崖面 pass、多一张全图纹理与每行裁剪图；烘焙时间与显存上升（量级见 §7）。
- 阶段 2 一开，任何 `level > 0` 的地图都会改变像素基线；必须按截图纪律逐张重录，不能静默覆盖。
- `villagerDepthAt` 的签名变了，`villager-occlusion.test.ts:32` 那份“同算式”辅助函数要跟着改；
  但 `level = 0` 时数值必须逐字相同（这是阶段 0 的验收）。

---

## 4. 可达性：会被打穿在哪，怎么只留一种写法

### 4.1 今天的判据链

- `isWalkable(p)` 只读 `cell.walkable`：`grid.ts:251-253`。
- `costAt(p)` 只读地形 + 潮：`grid.ts:271-278`。
- `path(start, goal, accept)`：`grid.ts:394-460`；邻居四向 `grid.ts:444-448`；
  每步代价 `grid.ts:452`；**目标不可走时兜底改写** `grid.ts:405-413`。
- 兜底 `nearestWalkable(goal, accept)`：`grid.ts:487-503`，只按曼哈顿距离扫全图，**完全不看层、也不看能不能从起点到达**。
- 上层门面：`reaches()` `setup.ts:583-591`（`goal = isWalkable(to) ? to : nearestWalkable(to)`），
  `doorReaches()` `setup.ts:601-602`，`paveFrom()` `setup.ts:612-620`。
- 生产调用点：`world-client/src/settings/load.ts:649`（门）、`:682`（村民巡游点），
  `world-client/src/world/simulation.ts:2929`、`:3364`、`:4857`（目标改写/回家/默认点），
  `world-client/src/world/routines.ts:54-61`（园子、长廊、摊位、河边四个点）。

### 4.2 具体判断：哪些测试会失效、为什么

**先说最要紧的：`pave-reachable.test.ts` 在平地图上不会变红，但它会失去保护力。**

- 该文件头 `:18-20` 已经写明：门被占地盖住时，`path` 会把目标改写到 `nearestWalkable`，
  于是非空、报成“连得到”，正好漏掉它要防的死门；假红则相反。
- 有了层之后，`nearestWalkable` 会从“最近的可走格”变成“最近的、可能在悬崖另一侧的可走格”。
  `reaches()` 的兜底（`setup.ts:586`）就会把“树篱/被占用的目标”改写到**另一个层**的可走格，
  报出**假绿**。这不是把“树篱 hub”的正常兜底一刀切掉，而是兜底必须加一个约束：
  **只在目标同层里选**，选完仍由 `path` 判可达（见 4.3）。
- `:177` 直接断言 `grid.nearestWalkable({x:0,y:10})` 等于某扇门；只要这个 API 被换掉，这行会**编译/断言失败**——
  这是预期内的红，提醒我们必须把调用点一起迁走，而不是留着旧 API 当“兼容”。

会红 / 必须改的测试（按原因归类）：

| 测试 | 为什么会红 / 为什么必须改 |
| --- | --- |
| `world-client/test/pave-reachable.test.ts:177` | `nearestWalkable` 被 `nearestWalkableOnLevel` 取代（或改签名）；旧的无层几何兜底不再允许 |
| `test/path-cost.test.ts:20-21` 的 `gridWith` | 直接写 `cell.terrain`，不写 `level`；一旦 cost/flood 读 `level`，石格在 level 0 就与“石格默认层”不一致 → 末条断言红。必须改走 `grid.setTerrain` |
| `test/tide.test.ts` | `isFlooded(terrain, level)` 今天的第二参是潮位；新语义若并入层，必须改签名与全部断言，否则“草地/农田/树/煤”的淹水档位会变成两套 |
| `test/settings.test.ts:154-157`、`test/pack-venue.test.ts:112-126` | 依赖“浅水在 0.9 淹、石门槛不淹”。保留 clearance 表 + 全图 level 0 时逐字不变；一旦给设定集抬层，期望读数要随包一起改 |
| `test/terrain-edge-pixels.test.ts` | 阶段 2 之后任何 `level>0` 都会移动该格像素；阶段 0/1（全 0）必须 0 差，阶段 3 才按语义重录 |
| `test/villager-occlusion.test.ts:32`、`building-depth.test.ts:37`、`prop-depth.test.ts:28`、`scenery-depth.test.ts:41-42` | 深度公式加 `level?`；`level=0` 必须逐字等于今天的数。它们正好是“平地不变”的守卫，不能为了让新公式过而改期望 |
| `test/save-fingerprint.test.ts` | `CURRENT_SCHEMA_VERSION` 5→6 后，v5 样例仍要冻结；新增 v6 样例与 v6 允许路径，旧断言不能简单替换掉 |
| `test/large-world.test.ts` | 该文件的 8.96%（619/6912）是**石板实测占比**、80.73% 是“未覆盖格全铺石板”的反事实占比（第 161-162 行），不是草/树；抬层不改变这些地形计数，但要新增“层分布”读数，不能把旧占比当高度读数 |
| `test/routine-tide-single-source.test.ts` | 它盯的是 `TERRAIN_HEIGHT` / `isFlooded` 的单一来源（第 138 行的提示语提到 `TERRAIN_HEIGHT`）；改名 `TERRAIN_WATER_CLEARANCE` 会动到它 |

**今天查不到的**：没有一个测试在“有层”的世界上验证过可达性；也没有 `nearestWalkable` 跨层的反向用例。
所以“现有测试会不会红”只能按上面的调用链推，不能拿今天的绿当证据。

### 4.3 唯一写法

```ts
// 唯一的相邻通行判据
WorldGrid.canStep(from: GridPoint, to: GridPoint, accept?): boolean
  = 四周邻接 && at(to)?.walkable
  && (Δlevel === 0
      || (|Δlevel| === 1 && edgeHasClimb(from, to, 'ramp'|'stairs'))
      || (|Δlevel| >= 2 && edgeHasClimb(from, to, 'ladder')))
  && (accept?.(to) ?? true)

// 唯一的“最近可走”兜底（替换 nearestWalkable；只加“同层”约束，不改变几何最近语义）
WorldGrid.nearestWalkableOnLevel(goal, accept?): GridPoint | null
  = 在 goal 所在层里，选到 goal 的曼哈顿距离最小的可走格；
    同距离按 (y, x) 字典序取唯一解；只返回**一个**候选，不做“最近可达”的二次搜索。
    这样“最近的那块地不可达”时会如实判死，而不是继续换一块更远的来凑活。

// 唯一的门面（保留“端点不可站时允许改写”的既有语义）
reaches(grid, from, to)
  = 越界 → false
  goal = isWalkable(to) ? to : nearestWalkableOnLevel(to)
  goal === null → false
  goal === from → true                    // 树篱 hub 用例：改写后起点即终点
  否则 → grid.path(from, goal).length > 0
```

- `path` 内部：`passable(next)` 改成 `canStep(current, next, accept)`；
  `costAt(next)` 改成 `stepCost(current, next)`；**起点也要先判可站**（当前代码只判目标，
  起点不可走时 A* 仍会从墙里走出去，`simulation.ts:2315` 的注释与代码不一致——顺手在这一处补齐）。
- `pave-reachable` 的语义**保持**：端点自己可走时按端点算；不可走时允许改写，但改写候选必须
  **与目标同层**，是否可达仍由 `path` 判。`pave-reachable.test.ts:178` 的“树篱 hub、一门之隔”仍然为真；
  `:196` 的“真被围死的门”仍然为假——这两条是本次改动不能碰坏的既有语义。
- `doorReaches` / `paveFrom` / `loadSettingPack` / `simulation` 的目标改写全部迁到 `nearestWalkableOnLevel`；
  旧 `nearestWalkable` 删除或降为 `private`，不留“还能调”的入口。
- **今天同一件事已经写了两遍**：`assertWorldInvariants` 与 `loadSettingPack` 各自写
  `path(...).length === 0`（`setup.ts:572` 的注释自述，`settings/load.ts:472` 是另一处）。
  高度只改一处就会“落地能过、读档不能过”或反过来；本次必须收成一个 `reaches` / `canStep` 调用，
  两边都只调门面。
- 建筑落位：`place()` 时检查 footprint 的层必须一致（或显式先铺平台），
  门口格必须能从祭坛到达；否则抛 `WorldSetupError`。门开在悬崖底、楼在崖顶这类图直接拒绝落地。
- 出生点/巡游点：巡游点今天查 `reaches`（`world-client/src/settings/load.ts:646`），会自动走新判据；
  **出生点今天只查 `isWalkable`**（同文件 `:624`），抬层后这不够——必须补
  `reaches(grid, anchor, spawn)`，否则“站在封闭台地上但可走”会被当成合法出生点。

### 4.4 水、潮与层的关系（不许再长第三个高度）

- `level` 不替代淹水高度。今天 `TERRAIN_HEIGHT`（tide.ts）改成 `TERRAIN_WATER_CLEARANCE`，
  语义只有一条：“这种材质在潮位多高时开始湿脚”。
- `isFloodedAt(p) = tide > level * FLOOD_UNIT + clearance(terrain)`；
  `FLOOD_UNIT` 是唯一常量（取 >0，例如 0.3，阶段 3 标定）；`level = 0` 时这一项为 0，
  **今天全图的淹水行为逐字不变**，抬层后才按层差减少浸水。数值在阶段 3 用同一张潮汐夹具标定，
  不允许在不同模块里各算一遍。
- `water` 是新地形（深层水）：`walkable=false`，水格的 `level` 统一取全局 `WATER_LEVEL`；
  浅水 `shallow` 保持今天是地形 + 可走。岸线高低由 `level` 决定，不用“水的层”再写一套。
  潮汐**不逐帧改 `level`**；今天它只改淹水判定，视觉水位仍由既有潮汐渲染负责，避免把“潮位”变成第二套高度。

---

## 5. 存档与回放

### 5.1 要不要进档：分开两类

| 类别 | 例子 | 入档？ | 理由 |
| --- | --- | --- | --- |
| **底稿** | 设定集里的高地、河床、台地 | **否** | 和今天 `spec.terrain` 一样由配置重算；入档会把存档绑死在某一版设定集（`ADR_SAVE §1.2`） |
| **玩家改动** | 修桥、挖沟、填平 | **是** | 这是世界自己的事实，重算不出来；不入档则读档后桥/沟消失，回放分叉 |

### 5.2 v6 形状

```ts
// save.ts，只加一个顶层路径
world.terrainEdits: readonly {
  readonly x: number;
  readonly y: number;
  readonly terrain: TerrainId;
  readonly level: number;
}[]
```

- **最终值覆盖**，不是操作日志：每条记录就是“这一格现在是什么”。
  不存时间、不存操作者、不存顺序之外的东西；写档前按 `(y, x)` 排序，保证指纹稳定。
- 应用顺序：`new WorldGrid(spec)` → 应用 `terrainEdits`（覆盖 terrain/level）→ 逐栋 `grid.place` →
  `assertWorldInvariants`。放不下、越界、落在已占用格 → 直接拒绝（`unplaceable` / `out-of-world`）。
- 一次改动完成（桥连成、沟挖成）才写一条最终值；不动中间态。
- 每次成功改动递增 `worldChangeVersion`（已有字段），不新增计数。

### 5.3 版本与兼容

- `CURRENT_SCHEMA_VERSION` 5 → 6（`save.ts:37`）。
- `MIGRATIONS[5]`：只补 `world.terrainEdits = []`，其余字段逐字不动（照 `save.ts:1546-1560` 的写法）。
- 新冻结指纹 `SCHEMA_V6_FINGERPRINT`，由新样例 docs/save-v6.sample.json 算出；
  **v5 样例与 `SCHEMA_V5_FINGERPRINT` 保留**，v5 的 `assertSaveV5`/允许路径集合保留。
- `SAVE_V6_ADDED_PATHS = ['world.terrainEdits']`；`SAVE_V6_ALLOWED_PATHS` 基于 v5 集合追加。
- `save-fingerprint.test.ts`：v1–v5 仍能迁移；v5 指纹不变；v6 样例与类型逐路径对齐。
- `main.ts:82` / `buildWorldFromSave` / `rebuildGridFromPlacements` 增加 `edits` 参数；
  `Simulation.fromSave` 不额外改（它的 grid 由 deps 传入）。
- 旧档怎么读：`parseSaveText` 走 `migrateSave` 链（`ui/save-store.ts:135-174`），v1–v5 全部补空数组后可读。
  **注意**：底稿来自当前设定集，所以旧档会看到新的高地/水面；这是 `ADR_SAVE §1.2` 的既定语义（“地图永远由当前配置重算”）。
  如果产品要求“旧档必须保持旧地图”，本设计不成立，必须改成把底稿入档（那是另一个 ADR）。

### 5.4 回放：日志不是地形的事实源

- `ADR_WORLD_FACTS_SOURCE` 已定：世界现状以客户端/存档报的为准，事件日志只是兜底投影；世界不读自己写的事件。
- 因此地形改动**不能**只发一条 `world.changed` 就指望回放重建；必须进 `world.terrainEdits`。
- 如果要把“修桥”也给记忆/外部读者看，再加 `WorldChange` 联合成员与 `WORLD_CHANGE_KINDS`
  （`world/world-changes.ts`）和服务端白名单（`server/events/world_changes.py`）；
  这是**可选**的日志补充，不是存档的替代。
- 回放口径：同一份 v6 存档 → `buildWorldFromSave` → 同一 `spec` → 网格逐格可复现；
  事件日志缺失不影响地形，因为地形不靠日志重建。

---

## 6. 地貌方案

### 6.1 原则

地貌不是第二套层。**地形类型回答“是什么”，`level` 回答“在哪一层”，
渲染结果 = `f(terrain, level, 四邻 level, biome, tide)`。**
不允许出现“地貌层”“地貌贴图数组”这种与格子平行的真值。

### 6.2 地形类型 → 地表表现

| 地形 | 地表表现 | 必须先有高度？ |
| --- | --- | --- |
| `grass` | 草甸掩码 + 草簇/花，低频 4×4 格 | 否（今天已有） |
| `mud` | 湿土、低洼水渍 | **是**（水渍要按层/水位判定）；平泥地可先做 |
| `stone` | 不规则板岩、石缝 | 否；抬到高层后需要崖面/收边 |
| `plaza` | 大块铺地、接缝 | 否；同上 |
| `farm` | 垄线 + 幼苗/麦穗 | 否（平面）；**梯田/挡土墙是** |
| `shallow` | 浅水覆盖、岸线 | **是**（岸线相对水位）；今天已有平面版 |
| `water`（新增） | 深水表面、岸壁、不可走 | **是** |
| `bridge`（新增） | 桥面木板、栏杆、跨岸 | **是** |
| `coal` | 露头煤线 | 平面煤斑可先做；**崖壁煤线是** |
| `tree` | 树冠 + 树干；树篱 | 平面已有；**高地树脚要按层抬** |
| 崖面（非地形类型） | 南向立面、受光唇、石粒 | **是**（由 `level` 边差派生） |
| 挡土墙/台地边（非地形类型） | 台地收边、阴影 | **是**（由 `level` 边差派生） |

结论：**草/泥/石/广场/农田/树/煤的平面部分可以独立于高度先做；水面、岸线、桥、梯田、崖面、崖壁煤线
必须等 `level` 和崖面 pass 就位**。这正是“先高度后地貌”的理由：先做地貌再抬高度，所有地表纹理、
岸线、阴影、崖面都要按新投影重画一遍；反过来只画一次。

### 6.3 新地形类型的连锁改动（编译会替我们抓）

新增 `water` / `bridge` 会让这些穷举表同时报错，必须逐项补：
`WALK_COST` / `walkCostOf`（`terrain-cost.ts`）、`TERRAIN_WATER_CLEARANCE`（原 `tide.ts` 表）、
`TERRAIN_EDGE_PRIORITY` / `BRIGHT` / `DARK`（`terrain-edges.ts`）、
`terrainColors`（`theme.ts`）、`drawTexture` 的材质分支（`tilemap.ts`）、
`terrainFor(zone)` 的映射（`grid.ts:603-614`）以及 `terrain-edge-pixels.test.ts`。
**这是好事**：编译器不会让我们漏掉“新地形没有画法/没有代价”。

视觉变体（同一地形在不同层的细节）由 `(x, y, level, biome, 世界 seed)` 确定性派生，
不写入存档、不用 `Math.random`/`Date.now`（与仓库既有确定性纪律一致）。

---

## 7. Phaser 4.2.1 兼容与渲染预算

- 版本：`world-client/package.json` `"phaser": "4.2.1"`。
- 今天用的 API：`Graphics.generateTexture` 与 `Image.setDepth` 的用法（`render/bake.ts:99-139`）、
  `Container`（人物/建筑）、`Graphics` 直绘（道具/装饰）。本方案**不引入** `TilemapLayer`、不做等距投影、
  不做透视相机；只做“同一张俯视图 + 固定屏幕 y 偏移 + 按行 depth”。这些在 4.2.1 上都是既有能力，
  不需要升级 Phaser，也不需要改渲染后端。
- 抬地形**不会**把绘制指令顶破 30000，前提是**静态地形继续烘焙成纹理**：
  `renderStats()` / `check-render-budget.mjs` 只统计顶层 `Graphics` 的 commandBuffer，
  烘焙纹理只是一个 Image（`SandboxScene.ts:774-786` 的注释与原话）。
- 今天的实测读数（仓库文档记录，不是我新测）：
  `docs/evidence/eval-ledger/render-budget-runs.txt`：计分轮 `15514 / 16162`，Graphics `28`；
  另一份 `docs/evidence/env-frame/baseline.txt` 记录 `16130 / 27`。
  硬闸是 `30000` 与 `40`（`check-render-budget.mjs:61` 与文件头）。
- **量级估算（不是实测）**：

| 做法 | 运行时 Graphics 指令 | 对象数 | 结论 |
| --- | --- | --- | --- |
| 地形+崖面全烘焙，遮挡层按行裁剪 Image | 与今天同量级（不新增 Graphics） | Graphics 不变；+72 个 Image | 推荐；远低于 30000/40 |
| 每个崖面段一个 Image（同一图集） | 不新增 Graphics | +O(边界段数)，约 100–500 | 可行，但纹理批次更碎 |
| 每格一个 Graphics / 每格一个直绘对象 | 至少 +6912×N 条 | 立刻超过 40 | **不可行**，两条硬闸同时红 |

- **闸的盲点要说清**：`totalCommands` 不统计 Image。所以“按行裁剪 Image”在现有闸里读数是 0 增量，
  但真实 GPU 提交多了 72–144 条 draw。建议**新增一个 `imageObjects` 读数**并把期望上界写进
  `renderStats()` / 预算脚本；否则这个闸对高度方案会“放行但没看见代价”。
- 显存量级（算术估算）：现有地形纹理 `1536×1152×4 ≈ 7.1 MB`；再一张同尺寸遮挡纹理约 `+7.1 MB`；
  每行裁剪不额外复制像素。小世界 30×20 是 `480×320×4 ≈ 0.6 MB`。这些都在常规预算内，但没有实测占用。
- 运行时相机 zoom 只缩放世界像素；`LEVEL_PX` 是世界像素，所以不同 zoom 下抬高的屏幕量按比例缩放，
  不需要为每个 zoom 重算常量。

---

## 8. 分阶段实施顺序

| 阶段 | 内容 | 能独立交付？ | 依赖 |
| --- | --- | --- | --- |
| **0 投影/深度收敛** | 新增 render/ground.ts（尚未创建）；所有坐标点改走它；`level` 恒 0；`villagerDepthAt` 改锚行号。**不改世界、不抬任何格** | **能**（0 像素差、指纹不变） | 无 |
| **1 数据模型** | `TileCell.level`、`GridSpec.levels/ramps/ladders`、`levelAt/setLevel`、`canStep/stepCost`、`nearestWalkableOnLevel`；全图 level 0 | **能**（行为与今天逐字相同；测试可独立跑） | 0（否则没有唯一投影可验算） |
| **2 渲染抬升 + 遮挡层** | `LEVEL_PX`、崖面 pass、每行裁剪遮挡、人物/道具/建筑抬 y；只用手工夹具（测试世界），不改设定集 | **能**（但在真实世界看不到高度，除非夹具） | 0 + 1 |
| **3 作者高度** | 在 `LARGE_WORLD_SPEC` 里铺台地/河床/岸线/桥位；doors/spawns 可达性闸；潮汐标定 | 否（真实世界会变） | 1 + 2 |
| **4 地貌** | 水面/岸线/崖壁煤线/梯田/桥面/高地树脚；平面地貌若没做可先做 | 部分（平面地貌独立；高度相关必须等 3） | 3（高度相关部分） |
| **5 地形改动** | 修桥/挖沟的编辑入口、v6 `terrainEdits`、rebake、可选 `world.changed` | 否 | 3（语义稳定后） |

每一步都给自己的闸；阶段 0/1 的验收是“0 差”，阶段 3 起才是“按语义重录基线”。

**阶段 1 落地记录（本次交付）**：只落了数据模型与 v6 结构——`level` 默认 0、构造期 `levels` / `ramps` / `ladders`
编译成 `climb`、唯一读入口 `grid.levelAt(p)`、`world.terrainEdits` 只搬运与序列化。
`canStep` / `nearestWalkableOnLevel` 未做；渲染与寻路没有读 `level`；`terrainEdits` 没有任何写入者。
验收读数留在本轮报告里，不在这份文档里写死（测试数会漂）。

---

## 9. 可验证判据清单

> **总纪律**：所有判据都是**同一构建、同一夹具、同一钉住状态**下的“存在性/结构”对照，
> 不是“两次运行的差异”。第二跑只允许作为稳定性复跑，不作为通过判据。
> 任何“看起来像抖动”的读数不能结案。

### H：高度真的生效（不是只画了贴图）

| 编号 | 夹具 | 测量 | 通过 | 怎么证明没被放宽 |
| --- | --- | --- | --- | --- |
| H1 | 同一张 3×3 平地夹具；同一 villager、同一 pose、同一帧；中心格分别 level 0 / level 1（两份夹具，坐标与镜头完全相同） | 直接读人物容器的 `y`（世界像素，不是截图猜测） | `y(level1) - y(level0) = -LEVEL_PX`，且 `x` 相同、精确整数相等 | 同一测试里跑第三份夹具 `?height=off`（仅渲染开关，世界指纹必须不变）：差值必须为 `0`。若“高度”只是贴图，关掉后差值本来就 0，测不出；所以还要 H3 |
| H2 | 一条 1 格宽的坡：低格 (5,6,0) → 坡边 → 高格 (5,5,1)；固定相机 zoom=2 | 人物从低走到高，按格边界采样容器 `y` | 每次跨过 `climb` 边，`y` 变化恰好 `-LEVEL_PX`；`x` 不变；回程恰好 `+LEVEL_PX` | 反向：删掉 `climb` 边，`path` 必须为空（同时命中 R1）；证明“能走上去”不是地形贴图自动给的 |
| H3 | 同一格 level 0 / 1，钉住相机与帧 | 该格中心与格底线两处像素扫描 | 高地图案整体上移 `LEVEL_PX`；格底出现崖面颜色；低位格底不再是原地形色 | 反向：`?height=off` 下两处颜色回到基准；且世界三枚指纹（世界/记忆/造物）在开关前后逐字相同 |

> **H1/H3 现在怎么取夹具**：本笔没有作者高度世界（见 `OPEN_ISSUES.md` E15），
> 两份夹具的 `level 0 / 1` 由调试演示口 `?hpatch` 在同一张平地上临时打出来；
> 它只负责演示，不是作者输入通道，也不进任何基线/夹具。观感结论不得超出“调试补丁演示”的范围。

### O：遮挡真的生效

| 编号 | 夹具 | 测量 | 通过 | 怎么证明没被放宽 |
| --- | --- | --- | --- | --- |
| O1 后方 | 崖在 `(x,R)` level 1，人在 `(x,R-1)` level 0，固定 pose | 同一机位、同一帧的**差分**：A = 开遮挡（人在 ROI）、A′ = 开遮挡（人移走）；B = `?occluders=off`（人在 ROI）、B′ = off（人移走）。ROI = 抬起带矩形（世界 y `R*16-16..R*16`） | ① `actorDepth < occluderDepth`；② ROI 内 `diff(A, A′) = 0`；③ ROI 内 `diff(B, B′) > 0`（报原始像素数）；④ 人不在 ROI 时 `diff(A′, B′) = 0`（逐像素） | **为什么不用“人物专属色”**：24 色里没有只属于人的色，专属色是软判据；差分把“条画错了但恰好那里没人”直接变成读数。④ 就是那条兜底：人在 ROI 外时，开关前后同一 ROI 必须逐像素相同；否则说明条本身画错了 |
| O2 上方 | 人在 `(x,R)` level 1，（崖面就在脚下） | 人物整体像素数与“同一 pose 站在 1×1 平地”的对照完全相同 | 差 = 0；且 `actorDepth > occluderDepth` | 反向：把 `LEVEL_PX` 调 0 的渲染夹具，像素数仍等于对照；证明 O2 量的不是“人变高”而是“没被自己脚下挡” |
| O3 前方 | 人在 `(x,R+1)` level 0 | 同 O2 的像素数对照；`actorDepth > occluderDepth` | 差 = 0 | 反向：把该人移到 `(x,R-1)`，O1 必须变红（同测试内的位置对照） |

**遮挡判据的边界**：`LEVEL_PX = 16`、崖高 1 层时，崖面只在“紧邻北边一行”的人身上有可见遮挡；
不要拿两行以北的人当反例——那里本来就没有像素重叠。判据测的是“有重叠时谁盖谁”，不是“隔着多远还能盖”。

### R：不可达真的不可达

| 编号 | 夹具 | 测量 | 通过 | 怎么证明没被放宽 |
| --- | --- | --- | --- | --- |
| R1 | 5×5 平地，高台 `(4,2)` level 2，四周无 `climb` | `canStep({4,3},{4,2})`；`path(low,high)`；`reaches` | 边判 false；`path.length === 0`；`reaches === false` | 失败点必须是**这一条边**（精确坐标），不是“整条路很长所以没走完”；不能把“起点不可站”误当“不可达” |
| R2 | 在 R1 的边上加一条 `ladder` | 同上 | `path` 非空、末格 = `(4,2)`、长度 = 曼哈顿距离（无绕路） | 同测试删掉 `ladder`：必须回到 `[]`；证明通过是因为梯子，不是判据变松 |
| R3 | 目标格是**不可走的高台格**（如被楼盖住的门），旁边 `(5,2)` 有一块可走的低地 | `nearestWalkableOnLevel(highGoal)`；`path(start, highGoal)`；`reaches(start, highGoal)` | 兜底只在目标同层选（返回高台层格子或 null），绝不返回低地格；`path` 末格永不落到低地冒充高台 | 反向：把目标改成“同层且可走的格”，兜底必须返回它本身；证明不是“一律返回 null”蒙混 |
| R4 水/桥 | 深水 `water` 邻格；浅水 `shallow` 邻格；桥 `bridge` 跨岸 | `canStep` / `stepCost` | 深水 false；浅水 true 且代价 = `FLOODED_WALK_COST`（逐字）；桥 true 且 `Δlevel=0` | 同测试删桥：桥格回到不可走；证明桥不是“把水格永久改成可走” |
| R5 门/出生点 | 设定集：楼在 level 1 台地，门在 level 0 崖底，无坡 | `assertWorldInvariants` / `loadSettingPack` | 必须在读档/落地时抛 `WorldSetupError`，不是读进来后人物发呆 | 反向：同一包加一条 `ramp` 到门口，必须通过。证明闸不是“永远抛” |

### S：存档与回放

| 编号 | 夹具 | 测量 | 通过 | 怎么证明没被放宽 |
| --- | --- | --- | --- | --- |
| S1 | `docs/save-v5.sample.json` 原样读 | `parseSaveText` → `save.world.terrainEdits`；`SCHEMA_V5_FINGERPRINT`；由它重建的 `terrain/level/walkable` 数组 | `terrainEdits === []`；v5 指纹逐字不变；重建网格与 v5 世界逐格相同 | 同测试把 v6 样例也读一遍并断言 `schemaVersion === 6`；不允许用“只测最新版”替代旧档 |
| S2 | 手工造 3 条 `terrainEdits`（桥/沟/填平） | 存档 → 读档 → 再存档；越界/占用/非整数层用例 | 3 条最终值逐字往返；非法用例全部拒绝；`world.terrainEdits` 外没有 `cells`/底稿数组 | 反向：删掉迁移里的 `terrainEdits: []`，S1 必须红；证明兼容是靠迁移，不是靠“字段可缺省” |
| S3 | 同一 v6 档，两次 `buildWorldFromSave`（同 spec） | 网格 `terrain/level/walkable` 的 sha256 | 两次完全相同（这是确定性，不是“相位差判据”） | 同测试故意改一条 edit，哈希必须变；证明哈希真的覆盖了层 |

### B：渲染预算

| 编号 | 测量 | 通过 | 怎么证明没被放宽 |
| --- | --- | --- | --- |
| B1 | 同一世界/相机/zoom，`renderStats()` | `totalCommands < 30000`；`graphicsObjects < 40`；新增 `imageObjects` 在预算内（建议 ≤ `grid.height + 2`） | 记录改前/改后两个数，不只报改后；`imageObjects` 是新增读数，不能因为“旧闸不数 Image”就当 0 |
| B2 | `RENDER_BUDGET_FORCE_COMMANDS=20000` | 仍必须退出 1 | 反例钩子不删；证明闸没有被高度方案顺手放宽 |

### D：确定性

| 编号 | 测量 | 通过 |
| --- | --- | --- |
| D1 | 钉住世界时钟、天气、潮位、相机、zoom；同一夹具重复读三次 | `path` 数组、`levelAt` 数组、`actorDepth` 数值、像素哈希逐字相同 |
| D2 | `?height=off` / `?occluders=off` 开关前后 | 世界/记忆/造物三枚 sha256 逐字相同；开关只影响渲染输入 |

### 判据本身的“防放松”三条

1. **每条正向断言都有一个同测试内的反向用例**（上表最后一列），反向用例不通过就不算通过。
2. **阈值/常量不允许在实现提交里顺手改**。`LEVEL_PX`、`DEPTH_LEVEL_EPS`、`MAX_LEVEL`、`UPHILL_COST`、
   `FLOOD_UNIT`、30000/40 若要改，必须单独提交并说明改前/改后读数。
3. **像素读数必须带可查看的截图**（钉住时刻 + 固定相机/zoom），数字与图同时给；
   只报数字、不给图的 diff 证据不算证据。

---

## 10. 风险与“什么时候变成推倒重来”的红线

| 风险 | 说明 | 红线（命中就停，不再增量修） |
| --- | --- | --- |
| 需要东/西向立面、悬挑、可旋转视角 | 本方案是“俯视 + 南向崖面”的 2.5D，不是等距/真 3D | 一旦要求侧立面/旋转/悬挑可见，ground.ts 的单一 y 偏移与按行深度都不成立 → 重做投影与全部地表美术 |
| 每格一个 Graphics/Image 直绘 | 6912 格会同时撞 40 对象与 30000 指令 | 静态地形不能再烘焙成常数张纹理 → 停，改渲染管线 |
| 高度出现第二来源 | `level` + 区域多边形 + 图层，或 `TERRAIN_HEIGHT` 与 `level` 混读 | 任何渲染/寻路代码同时读两个高度 → 停，先收敛数据模型 |
| 浮点层/负层/物理（坠落、溺水、跳跃） | 会把“分层地形”变成平台跳跃物理 | 一旦要重力/落水伤害/跳跃，本 ADR 失效，另立物理 ADR |
| 存档变成无界操作日志 | 每次修桥都追加一条历史 | 编辑条数超过“格数 1%”或需要回滚历史 → 改用压缩补丁/网格，升 v7，不在 v6 里硬塞 |
| 建筑跨层 | 楼体 footprint 一半在 0 一半在 1 | 必须“整平平台或拒绝落地”；一旦要楼体随地形倾斜 → 建筑渲染重做 |
| 截图基线大批变红 | 阶段 3 一抬层，所有含台地的镜头都变 | 基线必须逐张重录并记录旧/新/原因；出现“静默覆盖”即停 |
| 旧档要求“看起来一模一样” | 底稿不入档，旧档会拿到新地图 | 若产品要求旧档冻结旧地形 → 本 ADR 不成立，改“底稿入档”另一方案 |
| 闸看不见 Image 增量 | `totalCommands` 只数 Graphics | 不加 `imageObjects` 读数就宣布“预算没涨” → 视为未验证 |

---

## 11. 查不到的 / 未验证的

**查不到（仓库里没有答案，不编）**

- 没有高度实现：`grep -n "level|elevation|height"` 在 `world/` 里没有几何高度字段；
  两个 `TERRAIN_HEIGHT` 都不是几何高度（§1.4）。
- 没有投影函数：所有坐标是各渲染器内联写的（§1.3），没有 `project()`/`worldToScreen()`。
- 没有地形改动入档：v5 只存 `world.memory` 这类事实，没有桥/沟/地形编辑字段。
- 没有地形意义上的桥/沟/梯/水深规则或测试：`world/bridge.ts` 存在，但它是**外部 Agent 的桥接**，
  不是跨水桥（文件头 `world/bridge.ts:1-13` 自述）。不要看名字就接错线。
- 没有“有层世界”的测试夹具，也没有 `nearestWalkable` 跨层的反向用例。

**未验证（只有设计推演，没有实测）**

- 绘制指令/显存/烘焙耗时：§7 是量级估算；没有起服务、没有跑 `check-render-budget`。
- 设定集抬层后的实际观感：没有截图；`LEVEL_PX = 16` 只是初值。
- 潮汐与层的 `FLOOD_UNIT` 数值：没有标定；只约定“level 0 时与今天逐字相同”。
- 旧档在真实设定集升级后的逐格差异：没有跑包对比，只能说“按 `ADR_SAVE §1.2` 会拿到新底稿”。

---

## 12. 引用索引（按 grep 记号找，不按行号找）

| 记号 | 位置 |
| --- | --- |
| `interface TileCell` | `world-client/src/world/types.ts:42` |
| `readonly terrain?:` / `constructor(spec: GridSpec` | `world-client/src/world/grid.ts:61` / `:150` |
| `function terrainFor` | `world-client/src/world/grid.ts:709` |
| `isWalkable` / `costAt` | `world-client/src/world/grid.ts:297` / `:326` |
| `path(` / `nearestWalkable` | `world-client/src/world/grid.ts:448` / `:541` |
| `reaches` / `doorReaches` / `paveFrom` | `world-client/src/world/setup.ts:583` / `:601` / `:612` |
| `rebuildGridFromPlacements` / `buildWorldFromSave` | `world-client/src/world/setup.ts:624` / `:661` |
| `CURRENT_SCHEMA_VERSION` / `SCHEMA_V5_FINGERPRINT` | `world-client/src/world/save.ts:37` / `:71` |
| `MIGRATIONS` / v4→v5 | `world-client/src/world/save.ts:1422` / `:1546` |
| `isFlooded` / `TERRAIN_WATER_CLEARANCE`（潮） | `world-client/src/world/tide.ts:180` / `:71` |
| `TERRAIN_EDGE_PRIORITY`（画边） | `world-client/src/render/terrain-edges.ts:54` |
| `drawTerrain` | `world-client/src/render/tilemap.ts:24` |
| `bakeLayer` / `rebake` | `world-client/src/render/bake.ts:99` / `:133` |
| `villagerFootAt` / `villagerDepthAt` | `world-client/src/render/villager.ts:94` / `:113` |
| `actorDepthAt` / `buildingBaseY` | `world-client/src/render/building-depth.ts:39` / `:34` |
| `propFootY` / `propDepth` | `world-client/src/render/prop-depth.ts:18` / `:29` |
| `const ALTITUDE = 1000` | `world-client/src/scenes/SandboxScene.ts:291` |
| 地形烘焙入口 `bakeLayer(... -10 ...)` | `world-client/src/scenes/SandboxScene.ts:815` |
| `MAX_COMMANDS = 30_000` | `world-client/scripts/check-render-budget.mjs:61` |
| `pave-reachable.test.ts` 的 `nearestWalkable` 断言 | `world-client/test/pave-reachable.test.ts:177` |
