# ADR_ART_REF_20261111：11-11 参考图集的落地口径

- status: pending-review
- verified_at: 2026-11-11
- verified_by: agent（本地十一道闸门读数见 `docs/evidence/art-ref-1111/README.md`）
- evidence: `docs/art/reference-20261111/`, `server/scripts/art_ref_1111.py`, `world-client/src/ui/art-decor.ts`, `world-client/public/assets/manifest.json`

## 1. 问题

用户在 2026-11-11 提供了十张根目录参考图（4K / 5.5K，单张 14–30 MB），
是一套与初版《千与千寻视觉设定集》不同的 16-bit 农场 RPG 方向：五种 AI agent
角色、神谕祭坛、编码工坊、学者区、农田、村庄，外加桌面 UI 设计稿。

引擎当时的位图素材（`docs/evidence/art-pipeline/README.md`）是浴场镇水彩气质，
共 19 件：10 栋建筑、7 件布景、2 张村民立绘。七个村民里五个仍是程序化绘制，
这是最明显的「缺」。用户要求「用这十张参考图优化美术，缺什么调 agnes 生图接口自己做」。

第一轮只补了村民层。用户看到 `world-mix-compare.png` 的实拍后追问「还有旧素材？
截图看看 / 继续」——新村民是小型硬像素 chibi，旧建筑却是大幅水彩细节，两套笔触
并排，于是第二轮把剩余 17 件旧位图也统一掉。本 ADR 同时记两轮。

## 2. 决策

**两条产线，按「参考图里有没有这件东西」分工，不重复调用模型。**

1. **生成**：七张村民立绘全部按新风格重画（原先只有 `v0` / `v1`）。参考图里
   没有逐人的正面立绘，切不出来，只能调 Agnes Image 2.5 Flash。风格锚点是
   `villager-sprite-sheet`、`agent-role-icon-sheet`、`pixel-world-map-16x9`
   三张缩略图，走 `extra_body.image` 传 data URI。外壳沿用既有管线的洋红底 +
   泛洪抠底 + 裁边 + 最大连通块 + 按高度缩放，不加新抠图路径。
2. **切图**：参考图里本来就是规整窗口的四张，确定性切格、抠底、裁边、等比贴进
   固定画布，**一次模型调用都不花**。切出的像素就是参考图本身的像素，比让模型
   再画一遍更贴原稿。分两类如实记：
   - **已接线**：工坊四态 -> 楼面板状态行、角色图标 -> 村民面板徽记、
     表情 -> 村民面板记忆行（按行序轮转）。
   - **素材库，待接线**：祭坛三态、其余表情与 VFX。切出来是为了把参考图里
     能用的像素固定下来，不是宣称已经上屏；消费方要接时再写。
   构图稿（世界地图、桌面 UI、村庄 2×2、学者区建筑、tileset）不切：整张图是
   构图与色板基准，切成碎格没有消费方。

3. **统一（第二轮）**：10 栋建筑 + 7 件布景全部按同一套硬像素风格重画，
   见 `server/scripts/art_unify_1111.py`。风格锚点是村庄 2×2、学者区三栋、
   tileset 笔触三张 11-11 图；**不用工坊四态图**（斜视角，会把正交约束带偏）。
   建筑强写正交正面 + 单栋 + 无地面（`gen_buildings_batch.py` 记过斜视角街景坑），
   并按旧件宽高比做几何归一化，保证引擎的 `artBuildingScale` 口径不变。
   两道自动质检见 `docs/evidence/art-ref-1111/README.md` 的试错记录。

**装饰只走 DOM，不进 Phaser 画布**：状态图、徽记、表情挂在村民面板与楼面板里，
由 `world-client/src/ui/art-decor.ts` 运行时创建 `<img>`。这样不动世界渲染的
绘制指令数，也不碰 `eval/screens/` 的像素基线。

## 3. 硬边界（都是被闸门逼出来的）

- **`?art=0` 必须零素材请求**：装饰节点是运行时创建的，且只在 `artEnabledOf`
  为真时才建。静态写进 `index.html` 的 `<img>` 哪怕 `hidden` 也会发请求，会把
  「关掉素材」这条排障退路烧掉。`scripts/check-art-assets.mjs` 钉这件事。
- **只挂清单里的键**：`src` 由 `artAssetPath` 拼出，id 一律来自清单已有键，
  不引入清单外请求（同一条闸门反向检查）。
- **装饰是纯附加**：`appendDecor` 只往宿主末尾追加一个无文本节点，不改宿主
  `textContent`、不动已有子节点顺序。`test/art-decor.test.ts` 与既有的
  `test/villager-panel.test.ts`、`test/building-panel.test.ts` 一起钉住。
- **24 色板不扩容**：新增 CSS 只写尺寸与已有变量，不写颜色字面量，避免
  `audit-palette --strict` 的 UI 预算红。位图层仍按
  `ADR_ART_PALETTE_DECISION` 独立管，不并入世界色板。
- **原图不入库**：4K 原图单张 14–30 MB，过不了 pre-push 的 5 MB blob 闸；
  入库的是压到长边 768 的 JPEG（十张共约 1 MB）与联系表，放在
  `docs/art/reference-20261111/`。原图留在根目录本机使用。

## 4. 不做什么，以及为什么

- **旧素材全量重画曾经不做，第二轮做了**：第一轮只补村民层，理由是当时
  建筑与布景彼此同属水彩气质，推倒会让断裂从「两层并排」变成「三层混用」；
  `docs/evidence/art-pipeline/BATCH-EXPANSION.md` 记过这笔账。但实拍显示真正
  不协调的是「新硬像素村民 vs 旧水彩建筑」，不是旧素材内部不统一。用户看过
  截图后要求继续，于是第二轮把 17 件一次全部换成同一批锚点、同一套笔触，
  反而消掉了混用。**判据是画面，不是件数**；这一条的翻案有截图为证。
- **不改设定集**：十张图里的祭坛 / 工坊 / 学者区属于另一个世界观。本轮只借它们
  的笔触与配色做装饰，不往 `docs/SPEC.md` 里加地点、角色或规则。
- **不把 UI 设计稿做成界面**：`pixel-world-engine-desktop-ui-mockup` 是构图参考，
  落地它会动到整个 HUD 布局，超出「美术优化」这一刀，单独裁决更合适。

## 5. 验证

- `npm run check` 语法 / 语义 0 处；`npm test` 全量通过（含新增
  `test/art-decor.test.ts` 六条）；`npm run red:first` 在 base 上红在断言。
- `npm run build`、`audit-palette --strict`、四道文档审计、`python -m pytest`
  全绿；读数逐条记在 `docs/evidence/art-ref-1111/README.md`。
- 浏览器 `scripts/check-art-assets.mjs`：清单内每件请求且 200、默认也装、
  `?art=0` 零请求、三跑无 pageerror。
- 前后对比：`docs/evidence/art-ref-1111/before-assets-contact.png` 与
  `assets-contact.png`、`slices-contact.png`；统一前后同机位世界实拍见
  `world-unified-compare.png`，17 件统一后素材见 `unified-assets-contact.png`。
- 第二轮重跑：`npm test` 2687 / 2678 pass / 0 fail；`check-art-assets` 53 件
  全装、`art=0` 零请求；`test:phases` 40 项、`test:persistence` 8 项、
  `test:render-budget` 硬闸 3 项、`test:building-bake` 72 张 Image 全过。

## 6. 代价

- 七张立绘是一次模型批量调用，重跑会重花钱；脚本带 `--only` 可单件重试。
- 清单从 19 件涨到 53 件（净增 34：新增村民 5 + 切片 29；`v0` / `v1` 是覆盖
  重画，不算净增）。`preloadArt` 按清单全装，首屏因此多请求 34 张小图；
  36 个产物文件里只有两件是覆盖。装饰图另外只有面板打开时才创建节点。
- 第二轮又替换了 17 件已有 PNG（件数不变、内容全换），共 24 次模型调用
  （7 村民 + 17 旧素材；其中几件触发了质检重试）。
- **仍不是「全画面统一」**：`setting-scenery.ts` 的 `shopfront` 白色小店面、
  灯笼、地砖、花径、树影是 24 色板程序化摆件，不是生图素材，也没有走
  `hasArt`。它们仍是旧形制；要连这层一起换得动渲染层和一批像素基线，
  单独裁决更合适，别把它记成「旧素材已清零」。
- 徽记是五张图轮转给七个人用，**不是身份对应**；要一人一图得再生成两张。
- 表情按行序轮转，**不是情绪读数**：世界没有这条数据，不假装有。
