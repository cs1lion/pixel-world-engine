# 渲染输入全集：把「冻结哪一刻」定义完整

分支 `fix/shot-pin-actor`。本轮不再点状补第七枚钉子，而是把 `WorldSnapshot` 的
**每个字段**一次性定性：画面上读不读、随不随世界时刻变、怎么处置。第六枚钉
（`trails`）是这张表的第一个产物，不是终点。

## 一、渲染输入字段表（25 个字段，一个不漏）

判定口径：三档等待 1200 / 2800 / 5000ms 各冻结一次，取冻结瞬间的原始快照
逐字段 JSON 比较（`runs.json` 里的 `before.snapshot`）。实测只有 5 个字段变：

```
now / tide / villager / villagers / trails
```

其余 20 个字段在三档之间**逐字节相同**。处置分三类：

- **pin**：随时刻变，且进画面 → 并入 shot pin，三档钉成同一常量；
- **stable**：进画面，但三档冻结快照逐字节相同 → 「冻在哪一刻」不影响它，无需额外钉；
- **dom**：绘制路径不读 → 整组置空后 canvas 必须 0 差。

| 字段 | 读它的绘制函数（证据） | 三档冻结时变吗 | 处置 | 钉法 / 证据 |
| --- | --- | --- | --- | --- |
| `now` | `presentedNowOf`、`phaseInputOf`、`phase-view`（鸟/暗角/光晕）、`ambienceView`、`fogView` | **变**（301→303 分） | **pin** | `nowMs`（钉 07:34） |
| `tide` | `sim.environment() → tideView / settingScenery`（画面读 `env.tideLevel`） | **变**（0.9945→0.8802） | **pin** | `tideLevel`（钉 0） |
| `villagers` | `updateVillager`、`drawVillagerGroundShadow`、`overlay.sync`、`minimap.update` | **变** | **pin** | `actors`（pos/facing/mode/walking/frame/visible） |
| `trails` | `decor.syncTrails` | **变**（只增不减，晚冻 45 s 多一条） | **pin** | `trails`（整张表，强度/位置） |
| `villager` | 绘制不读；只有 `world/report.ts` 日报读 | 变（= villagers[0]） | dom | 与 `villagers` 同一来源，置空 0 差 |
| `buildings` | `syncBuildings`、`updateBuilding`、`phase-view`（亮窗/屋顶）、`minimap` | 不变（11 栋） | stable | 三档快照同值 |
| `startupBuildingIds` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `workstations` | `updateBuilding`、烟囱发射器、`phase-view`（在产亮窗） | 不变（11 个全 `idle`） | stable(注) | 三档快照同值；语义上在产时 `progress` 会变，那时必须钉 |
| `constructions` | `decor.syncScaffolds`、`drawScaffolds`（读 `remainingMs/totalMs`） | 不变（空表） | stable(注) | 空表无可比；非空时会随时长变，那时必须钉 |
| `props` | `decor.syncProps`、`phase-view`（灯芯光晕）、`minimap` | 不变（空表） | stable | 三档快照同值 |
| `critters` | `decor.syncCritters` | 不变（空表） | stable | 三档快照同值 |
| `roads` | `decor.redrawRoads` | 不变（空表） | stable | 三档快照同值 |
| `fog` | `fogView.update`、`refreshRuins`（读 `this.snapshot`） | 不变 | stable | 三档快照同值（center 48,36 / r38） |
| `harbor` | `harborView.update`（读 `this.snapshot`） | 不变（`null`） | stable | 三档快照同值 |
| `altar` | `phase-view` 祭坛光晕锚点（`snapshot.altar.x/y`） | 不变 | stable | 三档同值；**置空直接抛 `null.x`**，挪位置像素差 0.4167% |
| `weather` | `phase-view` `firefliesVisible(snapshot.weather)`；`statusLine` 也读（DOM） | 不变（`clear`） | stable | 三档同值；改值会动萤火 → 不是 dom |
| `tasks` | 绘制不读（状态行/队列 DOM） | 不变 | dom | 置空 0 差 |
| `pending` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `oracle` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `events` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `faith` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `deliveries` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `deliveriesByVillager` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `deliveryFailures` | 绘制不读 | 不变 | dom | 置空 0 差 |
| `feed` | 绘制不读（状态行 DOM） | 不变 | dom | 置空 0 差 |

计数：**pin 4 / stable 10 / dom 11 = 25**。

> `altar` 与 `weather` 原本被错标成 dom。置空证据一跑就抓到：`altar = null` 直接
> 在 `phase-view` 抛 `Cannot read properties of null (reading 'x')`；`weather` 的
> `firefliesVisible` 也会看它。两个都改归 `stable`，并把 dom 置空组缩到 11 个。
> 这条证据链确实抓到了登记表的错误。

### 快照之外的 world 读数

渲染还读三个不在快照里的值，三档实测同值：

| 读数 | 读它的函数 | 三档读数 |
| --- | --- | --- |
| `currentPhase()` | `phase-view` / `settingScenery` / `stallsPackedFor` | `dawn` / `dawn` / `dawn` |
| `weatherIntensity()` | `weatherView.update` | `0` / `0` / `0` |
| `weatherFogDensity()` | `weatherFogView.update` | 晴天随 `weatherIntensity` 同为 0 |

`preCoveredToday()` 读记忆（夹具 `localStorage.clear()` → 无雨记忆 → `false`，三档同值）。
这些值都由冻结后的世界时钟派生，三档 0 差已经是端到端证据。

## 二、三档两两读数（逐像素 0 差、结构块 0）

`scripts/screens-diff.py` 三层读数（精确差 / 可见差 / 8 连通结构块）：

| 组 | 精确差 | 可见差 | 结构块 |
| --- | --- | --- | --- |
| five 1200 vs 2800 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |
| five 1200 vs 5000 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |
| five 2800 vs 5000 | **0.0000%**（0 px） | **0.0000%**（0 px） | **0 块** |

三张 PNG 的 sha256 完全相同：`28928885…EB99379`。

六钉对照（四钉仍随等待破）：

| 组 | 精确差 | 可见差 | 最大结构块 |
| --- | --- | --- | --- |
| four 1200 vs 2800（旧口径） | 1.4056% | 1.4035% | 8048 px（104×120）@ `[264,520,367,639]` |
| **five 1200 vs 2800** | **0** | **0** | **0** |
| **five 1200 vs 5000** | **0** | **0** | **0** |
| **five 2800 vs 5000** | **0** | **0** | **0** |

## 三、反向用例与正/负控

| 用例 | 改动 | 精确差 | 可见差 | 最大结构块 | 判定 |
| --- | --- | --- | --- | --- | --- |
| `five-shift` | 莞尔 `pos.x` +1 格 | **2.6396%** | **2.4920%** | **14704 px**（148×124）@ `[476,264,623,387]` | **判红** |
| `trail-shift` | 钉住的痕迹 (49,36) → (48,36)，只挪一格 | **0.0104%**（64 px） | **0.0104%**（64 px） | **64 px**（8×8）@ `[332,620,339,627]` | **判红** |
| `dom-blank` | 11 个 dom 字段整组置空 | **0** | **0** | **0** | 负控通过 |
| `altar-shift` | stable 字段 `altar` 挪到 (1,1) | **0.4167%** | **0.3281%** | 2016 px @ `[268,612,339,639]` | 正控通过（stable 确实进画面） |

`trail-shift` 的 64 px 与上一轮溯源的那条痕完全同一 bbox `[332,620,339,627]`
（`fillRect(px+3, py+11, 10, 2)` 露出的一截），即「改一处位置」被判红，且红在痕上。
`altar-shift` 证明 `stable` 不是「没人读」：祭坛光晕确实进 canvas，只是三档冻结时刻下
它逐字节相同。

夹具末尾对 PNG 字节做二值断言（不是「近似相等」）：

- `five-2800 / five-5000 / dom-blank` 必须与 `five-1200` **逐字节相同**；
- `five-shift / trail-shift / altar-shift` 必须与 `five-1200` **不同**。
  反向用例一旦退化成空操作，夹具直接抛错。

## 四、守卫测试：防未来，不防今天

`world-client/test/pin-shot-state.test.ts` 第 21 条：

```ts
assert.deepEqual(unregisteredRenderFields(snapshot), [], '新字段没登记进渲染输入表');
assert.deepEqual(missingRenderFields(snapshot), [], '表里有死条目（字段已改名或删除）');
```

**这条测试今天是绿的，这恰恰是它的局限**：表是照着现有 25 个字段抄的。它挡的是
下一次 `types.ts` 给 `WorldSnapshot` 加字段时——新字段没在 `RENDER_INPUT_TABLE`
里登记就直接判红，逼着先回答「画面读不读、随不随时刻变、要不要钉」，再谈画面。
它不防今天的 `trails`（那已经补完并被三档 0 差证明），只防明天的第七、第八个。

同文件第 22 条做摊牌：真实快照 25 个键，表里恰好 4 pin / 10 stable / 11 dom，
多一个少一个都红。

## 五、实现与契约

- `pin-shot-state.ts`：新增 `TrailPin`、`pinTrails`、`unpinTrails`、`pinnedTrailsOf`；
  `RENDER_INPUT_TABLE`（25 条）+ `unregisteredRenderFields` / `missingRenderFields`。
- `SandboxScene.paintingSnapshot()`：`pinTrails → pinActors → pinnedVillagers` 三层覆盖，
  世界与判据仍读 `this.snapshot`。
- 入口并列、签名不动：`pinShotState(nowMs, tideLevel)` 一个字符没动；
  `pinTrails(trails)` / `unpinTrails()` 与 `pinActors` 并列；`unpinShotState()` 无参连带解。
- 证据口子 `debugOverridePainting(patch | null)`：只压「画面上那一层快照」，
  `this.snapshot`、世界、判据一律不动；传 `null` 复原，正常游玩路径没有调用方。
  它只用于登记表的正/负控制（置空 → 0 差，改值 → 像素差），不是第七枚钉。
- 只动夹具与 render 读取路径；不动世界逻辑、不重录基线、不 push、不合 main。

## 六、闸门

| 闸门 | 命令 | 读数 |
| --- | --- | --- |
| 类型 | `npm run check` | 语法 0 处 / 语义 0 处 |
| 单测 | `npm test` | tests 2387 / pass 2378 / fail 0 / skipped 9（新增 17–22 共 6 条） |
| 构建 | `npm run build` | 193 modules，dist 1,766.41 kB（gzip 500.85 kB），676ms |
| 负控 | `node scripts/check-shot-actor-pin.mjs` | 三档逐字节全同、dom 置空全同、两反向 + 一正控全异 |
| 像素 | `scripts/screens-diff.py` 八组配对 | 见第二、三节 |

开发服务器端口 5211（避开 5188 / 5191 / 5202 / 5203）。原始读数在
`render-input/<组>/screens-diff.json`，掩膜在同目录 `masks/`。
