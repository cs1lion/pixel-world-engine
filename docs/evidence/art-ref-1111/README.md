# 11-11 参考图落地：读数与前后对比

本轮只做「补素材 + 接装饰」，不动世界渲染的绘制指令数，也不碰
`eval/screens/` 的像素基线。下面是实跑读数，不是计划。

## 产物

| 类别 | 件数 | 来源 | 消费方 |
|---|---|---|---|
| `villager/v0..v6` | 7（原先 2） | Agnes Image 2.5 Flash，三张 11-11 图作锚点 | `world-client/src/render/villager.ts` 按 `villager.id` 查 `hasArt` |
| `state/workshop-00..03` | 4 | 工坊四态图确定性切格 | `world-client/src/ui/building-panel.ts` 的 `building-state` 行 |
| `state/altar-00..02` | 3 | 祭坛三态图切格 | 素材库，未接线 |
| `icon/role-00..09` | 10 | 角色图标表前两行切格 | `world-client/src/ui/villager-panel.ts` 的面板徽记 |
| `emote/emote-00..11` | 12 | 表情 VFX 表切格 | 记忆行按行序轮转；只有面板真有那么多行时才轮到后面的图 |

清单从 19 件涨到 53 件：净增 34（新增村民 5 + 切片 29），`v0` / `v1` 是覆盖
重画。祭坛三态与多数表情 / VFX 是**素材库，未接线**，不宣称已经上屏。
原图 4K / 5.5K 不入库；`docs/art/reference-20261111/` 存 768 长边 JPEG 副本
（十张约 1 MB）与联系表。

## 图

- `before-assets-contact.png`：改动前的 19 件素材（浴场镇水彩气质，村民只有 2 张）。
- `assets-contact.png`：七张立绘与切图第一版并排，看整体方向用。
- `slices-contact.png`：修正抠底容差与画布策略后的 29 件切片终稿。
  `emote-08` 是黑云（低容差保住），`emote-09` 是参考图里那格本身的两个色块，
  接线时按 `emoteIdFor` 跳过，不摆在屏幕上。
- `panel-villager.png` / `panel-building.png`：真实浏览器里点开的两个面板，
  徽记、引文表情、楼状态图都挂上了（不是示意图）。

## 闸门读数

命令一律在 `world-client/` 下执行，服务端那条在 `server/` 下。
以下是 2026-11-11 在 `feat/art-ref-1111` 上实跑的读数（只贴首行 / 末行结论）：

| 闸门 | 读数 |
|---|---|
| `npm run check` | 语法 0 处 / 语义 0 处 |
| `npm run audit:ports` | 0 处禁用端口（扫描 185 个文件） |
| `npm run audit:baseline` | 记录 166 个 / 已跟踪 166 个 / 全部一致 |
| `npm test` | 2687 tests / 2678 pass / 0 fail / 9 skip |
| `npm run red:first -- --base origin/main` | PASS：base 上按预期红（断言失败，exit=1） |
| `npm run build` | built in 733ms |
| `audit-palette --strict` | 0 处超预算 |
| `audit-references --strict` | 559 处行号引用，0 处存疑 |
| `audit-citations --strict` | 受查 4270 处，未解析 0 处 |
| `audit-sections --strict` | 受查 188 处，节号全部对得上 |
| `audit-claims --strict` | markers=3 passed=3 failed=0 / adr-schema 23 valid |
| `python -m pytest`（server） | 全绿（1 skip） |
| `check-art-assets` | art=1 清单 53 件、实际请求 53 张；默认也装 53 张；art=0 零请求；三跑无 pageerror |
| `test:persistence` | 8 项通过 |
| `test:render-budget` | 硬闸门 3 项通过；债务 0 条 |
| `test:phases` | 40 项通过 |
| `test:building-bake` | 9 栋 / 72 张烘焙 Image / 失败 0 条 |
| `fixture:check` | 6 条夹具 / 195 项断言 / 6 通过 |

**一处既有的假红，与本轮无关**：`check-interact` 的 L3-6（存档重开后点同一人）
在本分支与未改一行的 `origin/main` 对照树上都稳定失败，报「左键点在莞尔的格子上，
状态菜单没有出现」。同一脚本其余 32 项两棵树都通过。两棵对照树分别跑在
5241 / 5242，工作树身份闸都确认连的是自己的那一棵。这不是本轮引入：本轮没碰
`#unit-status` 的点击链路，也没有新的画布叠层。

## 复现命令

```bash
npm run check                # 语法 0 处 / 语义 0 处
npm test                     # 全量单测，含新增 test/art-decor.test.ts 六条
npm run red:first -- --base <本分支分叉点>
npm run build
node scripts/audit-palette.mjs --strict
node scripts/audit-references.ts --strict
node scripts/audit-citations.ts --strict
node scripts/audit-sections.ts --strict
node scripts/audit-claims.ts --strict
cd ../server && python -m pytest
```

浏览器冒烟（先 `npm run build`，preview 与闸门同一次 shell 调用里起，
端口按本工作树分配）：

```bash
PIXEL_WORLD_URL=http://127.0.0.1:<port>/ node scripts/check-art-assets.mjs
```

判据：清单内每件被请求且 200、默认（不写 `art` 参数）也装、
`?art=0` 零 `/assets/` 请求、三跑无 pageerror。装饰图是运行时按开关创建的，
静态 `<img>` 会破坏第三条，所以没写进 `index.html`。

## 第二轮：把剩下 17 件旧位图也统一

用户看了 `world-mix-compare.png` 的实拍后追问「还有旧素材？截图看看 / 继续」。
那张图把问题摆得很直：ART ON 一侧新村民是小型硬像素 chibi，旧建筑是大幅
水彩细节的浴场镇；ART OFF 一侧全程序化反而统一，只是细节少。于是把
10 栋建筑 + 7 件布景按同一套 11-11 硬像素风格全部重画。

| 项 | 读数 |
|---|---|
| 脚本 | `server/scripts/art_unify_1111.py` |
| 风格锚点 | 村庄 2×2 / 学者区三栋 / tileset 笔触（不用斜视角的工坊四态图） |
| 产物 | 17 件 PNG 覆盖写入，尺寸与旧件逐像素一致（如 `wave_house` 240×329、`tea_stall` 176×112） |
| 清单 | 仍 53 件，件数不变、内容全换；每件记 `origin` / `replaces` / `sourceAspect` / `generatedAspect` / `normalizedTo` |
| 模型调用 | 15 件全量 + 3 件单独重试 + 质检重试若干，共 24 次左右 |

`unified-assets-contact.png` 是 17 件统一后的成品；`world-unified.png` 是统一后
同机位全屏实拍；`world-unified-compare.png` 把统一前后同一块镇心并排，是最直观
的前后对比；`world-mix-compare.png` 保留第一轮的「混用 vs 全程序化」对照；
`world-procedural.png` 是 `art=0` 基线。

**确认过没有漏网的位图**：浏览器里列出场景 9 栋建筑的 `prefabId`，逐个都在
清单的 10 个 `building/*` 里（多出的 `waiting_shelter` 没有实例）。画面里那栋
白色小店面是 `setting-scenery.ts` 的 `shopfront` **程序化摆件**，与灯笼、地砖、
花径同类，不是生图素材，也不走 `hasArt`；这一层仍是 24 色板旧形制，见 ADR 的代价条。

### 三处试错（都留了自动兜底）

1. **`wave_house` 被画成五层细塔**：模型把「multi-storey landmark」读成宝塔，
   比例 0.35 对旧图 0.73；引擎 `artBuildingScale` 有高度上限，会被压成窄条。
   改描述写死「THREE-STOREY、WIDE facade、NOT a pagoda」，再加几何归一化：
   把内容等比装进与旧件同尺寸的透明画布，整体宽高比固定、主体完整保留。
   比例偏差超过 35% 时用强化提示重生成一次，取更接近的那张。
2. **`tea_stall` 没画洋红底**：模型改画了一整片棕色实景（火堆 + 布景），
   泛洪抠底删不到，裁边后整张都是不透明背景。加 `background_ok`：四角必须
   透明、不透明像素占比 ≤ 0.72（超宽条带放宽到 0.90），不合格就重试，
   最多三次并把「BACKGROUND = FLAT PURE MAGENTA ONLY」单独再喊一遍。
3. **`coal_heap` 被画成一排木栅栏**：33×15 逻辑像素的小物件，描述里
   「coal lumps + wooden bucket」被理解成木板。单独把描述改成「LOW MOUND of
   chunky black coal lumps, NO fence / NO planks」后重画，见 `coal-fixed` 效果。

第二轮闸门读数：`npm run check` 0/0；`npm test` 2687 / 2678 pass / 0 fail / 9 skip；
`python -m pytest` 全绿；四道文档审计全绿；`audit-palette --strict` 0 超预算；
`audit-baseline` 166/166 一致；`check-art-assets` 53 件全装 / 默认也装 / `art=0`
零请求 / 三跑无 pageerror；`test:phases` 40 项、`test:persistence` 8 项、
`test:render-budget` 硬闸 3 项、`test:building-bake` 72 张 Image 全过。
两棵对照树的 `check-interact` L3-6 仍同样失败，与本轮无关（见上一节）。

## 第三轮：四条未做项全清

用户要求「把这些都做完然后 merge，再更新一版 readme」。断点里登记的四条对照如下。

| 未做项 | 落地 |
|---|---|
| 六张构图稿只作基准 | 切成 13 张带背景的画册贴片 `plate/*`（`server/scripts/art_plates_1111.py`），接日历抽屉周视图；另做自包含画廊 `docs/art/reference-20261111/gallery.html` |
| 祭坛三态 / 多数表情未接线 | 三态 -> 神谕回执行；十一张表情 -> 村民面板按语义选 + 日历每日行按性质选 |
| 程序化摆件仍是旧形制 | `drawShopfront` 米白灰泥墙改暖木色，等量替换净 0 行 |
| 没 push / 没开 PR | 见本轮末尾的合并回执 |

**桌面 UI 设计稿没有做成界面**：切两张贴片进日历抽屉 + 收进画廊，HUD 一行没动。
tileset / 世界地图也没接成地面或小地图——那会动 `tilemap` 与一整批像素基线。
十张图至此都有消费方（生图锚点 / 切片 / 贴片），但没有一张被硬塞进不合适的渲染层。

### 图

- `plates-contact.png`：13 张画册贴片。
- `daycard-final.png`：日历抽屉实拍，每周标题右侧一张构图贴片、每日行一张表情。
  **口径要说清**：世界开局没有日摘要（`dayCards()` 返回空），这张是在浏览器里
  给只读接口注入一份示例日卡后重绘拍的，只为证明装饰真的挂在 DOM 上；
  不改产品代码、不写世界。`panels-final.png` 是同一时刻的全屏。
- `world-unified-compare.png`：第二轮统一前后同机位对照。

### 读数

| 闸门 | 读数 |
|---|---|
| `npm run check` | 语法 0 处 / 语义 0 处 |
| `npm test` | 2713 tests / 2704 pass / 0 fail / 9 skip（rebase 到新 main 后，main 侧自带的 20 项测试一并跑过） |
| `npm run red:first -- --base origin/main` | base 上红在断言 |
| `npm run build` | built |
| `audit-palette --strict` | 0 处超预算 |
| `audit-references --strict` | 559 处行号引用，0 处存疑 |
| `audit-citations --strict` | 受查 4294 处，未解析 0 处 |
| `audit-sections --strict` | 节号全部对得上 |
| `audit-claims --strict` | markers=3 passed=3 failed=0 / adr-schema 23 valid |
| `audit-baseline` | 166 / 166 全部一致 |
| `audit:ports` | 0 处禁用端口（扫描 189 个文件；基线 187 仍在窗口内） |
| `python -m pytest` | 全绿（1 skip） |
| `check-art-assets` | 清单 66 件全装、默认也装、`art=0` 零请求、三跑无 pageerror |
| `smoke.mjs` | 132 项全过 |
| `test:phases` / `test:persistence` / `test:render-budget` / `test:building-bake` | 40 项 / 8 项 / 硬闸 3 项 / 72 张 Image 全过 |
| `check-setting-scale` / `check-lamp-band` / `check-lamp-pool` / `check-scene-depth` / `check-dengchao` | 全绿 |

**一处必须显式刷新的基线**：新增四份文件把 `audit-ports` 的扫描面从 185 推到
187，越过 155×1.2=186 的过期线，闸门按设计判红。按 `scripts/audit-scan-guard-lib.ts`
的政策把 `world-client/scripts/audit-scan-baseline.json` 的 `ports` 实测值刷成
187，并在 note 记日期 / 前后值 / 理由；`minDrop=5`、`ratio=2%`、`STALE_RATIO=20%`
三个阈值一字未改。references 559 仍在 529 的窗口内、claims markers 仍是 3，两项没动。

**一次 rebase**：开 PR 前 `origin/main` 前进了 5 笔（PR #39 合入），只有
`docs/WORKTREES.md` 一行登记重叠。rebase 到新 main 后保留对方「已合入」的状态
与本分支新增的登记表行，并重跑上表全部闸门——main 侧新增的
`world-client/src/world/villager-decision-client.ts` 等文件把扫描面推到 189，
仍在 187 基线的 20% 窗口内，不需要再刷基线。

**两处既有假红，与本轮无关**（都拿未改一行的 `origin/main` 对照树跑过）：

- `check-interact` L3-6：本分支与 base 都稳定失败，其余 32 项两棵都过。
- `check-ground-shadow`：本分支红 4 条（G2 摊位 dawn/noon/dusk、G3 boiler_annex），
  base 红 5 条（同样 4 条外加 G3 lamp_archive）。判据是压暗环与接触暗部，
  与墙面换色无关；这条闸门本来就没接 CI。两棵树分别跑在 5241 / 5242，
  工作树身份闸都确认连的是自己的那一棵。

## 第一轮的试错记录（两处值得留下）

1. **洋红底没那么纯**：11-11 锚点让模型把底色画成暗玫瑰紫，还带灯笼光晕与
   脚下地影。原管线 `key_out` 的四角中位数 + 泛洪只能删掉底色，光晕留了下来。
   `key_out_magenta` 在全图补一道「红蓝高、绿明显低」的删除，再剥两圈边缘晕，
   人物肤色（蓝通道不高）不误伤。最后 60px 显示尺寸下剩余的暖粉光晕读成灯笼
   发光，保留。
2. **小元素不能硬拉到画布宽**：火花、汗滴在原图只占十几个像素，等比拉到 96px
   会变成两个大方块。`fit_canvas` 限制放大倍数、用最近邻、居中贴进固定透明画布；
   同时 `emote` 那张把抠底容差单独收到 26，否则「黑云」格会被当成背景删掉。
