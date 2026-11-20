# 断点续跑

## 当前断点

- 最后 HEAD: `dbedd48`（本文档这笔提交紧随其后，**最终 sha 以 `git log -1` 为准**；
  分支 `feat/art1-visual-and-creator-ux`，worktree `D:/project/pwe-art1-visual`；
  基点 = origin/main `57aedd5`（含 PR #68/#70），**stacked 在 PR #69 之上**
  （造物落点遮罩 + 掀屋顶那两笔）。rebase 过三次改写过历史（最后一次为跟 #70 的
  CI 路径分流改造，只冲突 `CLAUDE.md` 一个表项，取两者并存），sha 以 `git log -1` 为准。
  本线八笔：PR-A 两笔（遮罩/掀屋顶 + 行号锚点修复）+ 图集注册表 + 渲染层接线
  + 自证读数与冒烟闸门 + `?atlas=1` 开关 + CI light lane + ADR/文档/账本收口。）
- 未提交改动: 无。主仓 `D:/project/pixel-world-engine` 的 15 个未跟踪图片/JSON 资产
  原样保留，未动、未入仓。为验证 main 基线临时建的 `D:/project/pwe-main-probe`
  已 `worktree remove --force` 清掉。
- 已跑闸门: 全绿。类型 0/0；端口 0 处禁用（205 文件）；基线字节 166/166 一致；
  `npm test` 2777 项 2767 pass 0 fail；`test:meta` 115 pass 0 fail；夹具回放 6 条 195 项；
  `red:first` RESULT=RED（红在断言，五个新测试文件按文件级登记免跑，理由写明
  base 上无对应实现）；构建 ✓；色板 24+9 零越界（放行 art1/fx-ambient/public/assets）；
  行号+符号引用 558 处 0 存疑；文件引用/节号 0；标注断言 3/3 + ADR schema 27 valid；
  指标账本 25 条 ok + 自检 0；截图自检 5/5；服务端 pytest 623 passed 1 skipped；
  交付报告审计 issues=0。
  浏览器侧：`test:art-assets`（art=1 全装 79 张、art=0 零请求）、
  `test:art1-smoke` 双模（默认 + `ATLAS_FIRST=1`）、`test:render-budget`
  （峰值 25,181 ≤ 硬顶 33,488，欠债 0）、`test:persistence` 8 项、
  `test:building-bake` 72 张全过、`test:phases` 40 项、`check-phases-negative` 反例成立、
  `eval-interaction --split main` 10/10；三套 EDD 16/16 全绿
  （sensory 须带 `world=dengchao`、rewind 须用默认莞尔镇——见下「读数口径」）。
- 未跑/失败: `worktrees:audit --strict` exit 1——**未登记项已清零**（total=20
  registered=20 unregistered=0）；剩余红是 9 个过期未回收 + 6 个已合入仍在的
  owner 债务（`pwe-audit-fix`/`pwe-eval`/`pwe-flaky-gates`/`pwe-material`/
  `pwe-palette-before`/`pwe-verify` 等），main 基线同样红、非本轮引入；
  脚本口径「只列不删，回收由 owner 手动作业」。
- 下一步命令: `git push -u origin feat/art1-visual-and-creator-ux` →
  `gh pr create --base main`（PR-A #69 尚未合入，故本 PR 的 base 是 main、
  diff 里会含 PR-A 那两笔；PR-A 先合则本 PR 自动瘦身）。
  PR-A 合入后本 worktree 回收：`git worktree remove ../pwe-art1-visual`
  并删本地分支；`pwe-creator-overlay` 那行同步按已合入口径撤下。

## 读数口径（本轮踩过两次，别再踩）

- **三套 EDD 的 URL 不通用**：`eval-sensory.mjs` 用默认莞尔镇只有 12/16
  （四项红），带 `world=dengchao` 才是 16/16；`eval-rewind.mjs` 反过来——
  带 `world=dengchao` 会 4/16（`historyRestoreToDay` 在设定集世界上不成立），
  必须用默认 URL。两跑都要 `--url "http://127.0.0.1:5211/?art=0..."` 显式给，
  缺省端口是 4173 不是 5211。判据核对一律**与 main 基线同 URL 同读数**比，
  不拿绝对数字当验收。
- **帧节奏阈值不能用绝对 16.6ms**：rAF 间隔被 vsync 钉死在 16.67ms，本机
  连 `?art=0` 基线都常有单次 33ms 的 GC 停顿（p95 33.30ms）。绝对上限恒红，
  而它测的是 runner 体质不是表现层代价。`check-art1-smoke.mjs` 的阻塞判据
  因此改成**同轮相对对照**（art=1 帧中位不许比 art=0 慢超过 1.5ms），
  p95/max 只打印。同一教训早已写在 `check-render-budget.mjs`：三类 fps 断言
  「只记录不阻塞」，硬闸是绘制指令峰值。

## 本轮改动（art1 图集管线 + 光照 + fx-ambient，2026-11-20）

- **tile 图集管线**（`src/render/art1/`）：`atlas-registry.ts`（`TileAtlasManifest`，
  地形/石板路/水体/岸型/建筑四层/居民 4 帧，16 与 32 两种格）+ `atlas-tiles.ts`
  （整层离屏合成，Canvas/WebGL 同一条路，每层每帧一条 draw 指令）+
  `atlas-buildings.ts`（**独立屋顶层**：掀屋顶在图集上成立）+
  `atlas-villagers.ts`（4 帧步态）。缺件口径 = **整层回退程序化**，不做半层混铺。
  槽位的键必须是真实网格字段能回答的（水体按地形、岸型按陆侧地形且边表
  复用 `shore-band.ts#waterLandEdgesFromGrid`），清单里不留渲染代码不问的键。
- **测试图集生成器** `scripts/gen-art1-test-atlas.mjs`：自带最小 PNG 编码器
  （IHDR/IDAT/IEND + mulberry32 确定性像素），产出三张 **CC0 测试图集**与清单。
  清单覆盖**两镇全部 22 个模板**（莞尔镇 12 + 灯潮界 10）——只登记一边，
  另一边会整镇静默落回程序化。
- **光照**（`lighting.ts` / `lighting-pool.ts` / `lighting-sources.ts` /
  `lighting-readings.ts`）：**固定灯槽池**，一次建满、永不增删，每帧只决定
  「谁进哪个槽」。原因：`maxLights` 缺省 10，而灯潮界光街灯就 28 盏，
  一灯一对象会超上限且增删会牵动着色器管线（`#define LIGHT_COUNT`）。
  挤掉的灯数如实记账（实测 capacity=10 / requests=29 / dropped=19）。
  时相+天气→环境光（`setAmbientColor` 无独立强度旋钮，强度用混到黑表达）；
  暖光呼吸吃 `presentedNow`，钉钟/回放时停在同一相位。
  Phaser 4 的灯光在 `DefaultScene` 插件表里但 `setLighting` 标 `@webglOnly`，
  所以 `lightsSupported` + `?art` 两道闸缺一不可。
- **fx-ambient**：`visual-clock.ts`（本层唯一时间与随机入口，`visualNoise` 整数进
  0..1 出可复现）/ `micro-fx.ts`（草摆、涟漪、漂移点 + `budgetFor` 按**可见区**
  封顶）/ `avatar-glide.ts`（临界阻尼弹簧，帧率无关不超调，到位即交棒）。
  防火墙由 `test/layer-guard.test.ts` 守：不 import `src/world/`、不出现
  `WorldState`、格边长也作入参递（`DEFAULT_TILE_PX`，那条 import 会撞自己的边界）。
- **`?atlas=1`**：图集**默认不抢位图单件**（后者已过人眼验收，
  `ADR_ART_DEFAULT_ON`）。带 `atlas=1` 时建筑 9/9 走图集且全部可掀、居民 7/7
  走图集步态；不带时必须 0——「不悄悄抢位」也有读数。
- **自证读数与冒烟**：`window.Oracle.debugArt1()`（复用既有 `?debug=1` 面板）报
  图集两层 active/格数/纹理尺寸、建筑与居民接管数与可掀数、光照
  capacity/requests/dropped、微动效本帧实画条数。
  `scripts/check-art1-smoke.mjs` + `npm run test:art1-smoke`（CI 浏览器 light lane）
  钉六条判据；`?art=0` 必须全部读数回落（基线一个字节都不动）。
- **配套收口**：`check-art-assets.mjs` 给 `art1/` 子清单独立审（声明的 sheet 必须
  被请求且 200，请求了没声明的判红）；`audit-palette.mjs` 放行名单补
  `src/render/fx-ambient/`；`red-first-lib.ts` 五个新测试文件按文件级登记免跑；
  `eval/ledger.json` 两条 palette 读数重录（引用 834→841 / 237→240，唯一色与越界不变）；
  `ADR_TERRAIN_HEIGHT.md` 2 处 + `PROGRESS.md` 2 处行号引用改符号锚点
  （`ALTITUDE` / `create`，本轮接线后已漂）。
- **文档**：`docs/adr/ADR_ART1_ATLAS_PRESENTATION.md`（status: aligned，含
  Blitter/TilemapLayer/一灯一对象/图集盖位图/绝对 16.6ms 五个备选与否决理由）、
  CLAUDE.md（闸门分层两条 + light lane 清单）、SPEC §11.2 art1 段。

## 债务与转正

- `avatarDamping = false`：阻尼跟随时**默认不接管**头像点击。理由不是没做完，
  是转正要连带改 `village-hud.test.ts`「点头像 → 调 `followVillager` 恰好一次」与
  `camera-controller.test.ts` 的 `cam.follow(...)` 调用序列两处断言——那是另一笔工作。
- `ATLAS_FIRST` 默认关：图集观感未过人眼验收；转正需要 `docs/evidence/` 的对比图。
- 灯槽容量受 `maxLights=10` 限制：远处街灯夜里会被裁（记账可见）。真要全亮，
  得在 `vite` 的 Phaser 配置里抬 `render.maxLights`，那时着色器分支与预算都要重测。
- 测试图集是**链路验收载体**，不是美术基准；真图集整张热替换 `public/assets/art1/`
  的 PNG 与 `manifest.json` 即可，渲染代码不用改。
