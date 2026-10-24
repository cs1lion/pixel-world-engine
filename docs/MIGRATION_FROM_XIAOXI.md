# 从 xiaoxi 迁什么（实测盘点，2026-10-25）

源：`cs1lion/xiaoxi` 的 `pixel-world/`。下文数字都来自 `wc -l` 与 `grep -l`，改代码后请重跑。

## 一、可以直接搬（与台账无关，纯世界逻辑）

这些文件不 import Phaser、不碰 commission / ledger，搬过去改 import 路径即可。

| 行数 | 文件 | 用途 |
|---:|---|---|
| 604 | `src/world/setup.ts` | 分区表、开局落位、`buildWorld` / `buildWorldFromSave` |
| 421 | `src/world/grid.ts` | 网格、寻路、占地校验、分区默认值 |
| 266 | `src/world/blueprints.ts` | 预制体解析与校验 |
| 218 | `src/world/intent-schema.ts` | 意图 JSON 的形状校验 |
| 181 | `src/world/intent-router.ts` | 规则优先、模型兜底的意图路由 |
| 155 | `src/world/intent-prompt.ts` | 提示词装配 |
| 139 | `src/world/intent-context.ts` | 世界现状摘要 |
| 139 | `src/world/world-state.ts` | `summarizeWorld` / `describeWorldState` |
| 139 | `src/world/creator-schema.ts` | 造物模式的位置校验 |
| 130 | `src/world/imperative.ts` | 命令式神谕解析 |
| 123 | `src/world/faith.ts` | 信仰点与世界记忆 |
| 110 | `src/world/palette-data.ts` | 24 色 token（换设定集时整份替换） |
| 105 | `src/world/wilderness.ts` | 郊野判定 |
| 100 | `src/world/oracle.ts` | 神谕解析 |
| 94 | `src/world/oracle-build.ts` | 建造类神谕 |
| 78 | `src/world/routines.ts` | 日常作息 |
| 76 | `src/world/trails.ts` | 走出来的痕迹 |
| 72 | `src/world/fog-drift.ts` | 迷雾漂移 |
| 62 | `src/world/biomes.ts` | 群落判定 |

## 二、要改造后搬（与台账耦合，需换成事件日志）

| 行数 | 文件 | 现状 | 改造方向 |
|---:|---|---|---|
| 2146 | `src/world/simulation.ts` | 命令队列 + 固定步长，`sync` 命令吃台账 | 保留骨架；`sync` 换成「事件日志 → 世界状态」的投影入口 |
| 938 | `src/world/save.ts` | v2 存档 + 字段指纹 | 升 v3：加 `tide` / `lampOil`；保留 v2 迁移 |
| 377 | `src/world/types.ts` | 世界类型总表 | 加潮汐与灯油类型；台账相关类型换成事件类型 |
| 359 | `src/world/ledger.ts` | REST + WS 拉台账 | 换成 `world-events` 客户端（事件日志的读取端） |
| 195 | `src/world/projection.ts` | 台账行 → 世界事实 | 改成事件 → 世界事实；`awaiting` 分类保留 |
| 137 | `src/world/report.ts` | 日报 | 改成从事件日志生成编年史 |
| 130 | `src/world/venue.ts` | 台账的活去哪栋铺子 | 换成事件来源的派活规则 |
| 100 | `src/world/decree.ts` | 急件（blocked 单） | 换成事件日志里的「待裁」事件 |

## 三、渲染层：整块搬（4297 行，20 个文件都依赖 world/）

`src/render/*` 全部可搬。它们只读世界快照，不认识台账。换设定集时改的是
`tilemap.ts` 的瓦片配方、`palette-data.ts` 的色值、`prefabs.json` 的形状。

新增两个文件：
- `src/render/tide-view.ts` — 水位图层与淹没区压暗
- `src/render/lampoil-view.ts` — 灯的亮度衰减

## 四、不搬

| 文件 | 行数 | 原因 |
|---|---:|---|
| `src/scenes/SandboxScene.ts` | 1222 | 世界场景，但里面塞了 20 多个调试按钮的接线；新仓的 HUD 要按纸签木牌重做 |
| `src/ui/debug-panel.ts` | 453 | 旧调试面板，新仓按新 UI 语言重写 |
| `src/ui/save-store.ts` | 364 | 存档读写可搬逻辑，但 UI 反馈要重做 |
| `src/ui/oracle-panel.ts` | 323 | 神谕面板，新仓重做 |
| `src/ui/hud.ts` / `shell.ts` | ~150 | 本轮新写的 HUD 壳，新仓按新 UI 语言重做 |
| `scripts/*.mjs` | — | 16 个浏览器回归脚本，全部绑旧 DOM；新仓按新 HUD 重写 |
| `test/*.test.ts` | 57 个 | 与搬迁代码一起搬；台账相关的改写成事件日志版本 |

## 五、从 xiaoxi 的其它部分搬什么

| 来源 | 内容 | 去向 |
|---|---|---|
| `docs/ADR_PALETTE_24.md` | 24 色预算与使用规则 | 新仓 `docs/`，改写成「色板预算」通用规则 |
| `docs/ADR_WORLD_ALIVE.md` | 时辰只改渲染、编年史不落档、角色是手不是 Agent | 新仓 `docs/`，这三条继续有效 |
| `docs/LARGE_WORLD.md` | 大地图实测约束（图块不放大、石板代价 0.5、迷雾只拦建造） | 新仓 `docs/`，数字加过期横幅 |
| `scripts/audit-palette.mjs` | 色板审计（世界 24 / UI 8） | 搬，换设定集后改预算 |
| `scripts/check-protocol.py` 的 §19 部分 | 事件三方对账的思路 | 改写成事件日志的契约检查 |

**不搬**：`server/` 全部（语音、对话、督办、durable）、`web/` 全部、`eval/`、`config/`。
旧仓保留为参考，不删。

## 六、迁移顺序

1. 先建 `world-client/` 骨架，把「一、可直接搬」的 19 个文件拷进来，跑通 `tsc --noEmit`。
2. 搬渲染层，跑通一次静态渲染（无台账、无事件）。
3. 改造 `simulation.ts` 与 `types.ts`，让世界能在没有台账的情况下跑起来。
4. 接 `world-events` 客户端，把台账那条路换掉。
5. 升存档 v3。
6. 重做 HUD 与抽屉。

前三步做完，世界就能独立跑；后三步才需要服务端。
