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

## 试错记录（两处值得留下）

1. **洋红底没那么纯**：11-11 锚点让模型把底色画成暗玫瑰紫，还带灯笼光晕与
   脚下地影。原管线 `key_out` 的四角中位数 + 泛洪只能删掉底色，光晕留了下来。
   `key_out_magenta` 在全图补一道「红蓝高、绿明显低」的删除，再剥两圈边缘晕，
   人物肤色（蓝通道不高）不误伤。最后 60px 显示尺寸下剩余的暖粉光晕读成灯笼
   发光，保留。
2. **小元素不能硬拉到画布宽**：火花、汗滴在原图只占十几个像素，等比拉到 96px
   会变成两个大方块。`fit_canvas` 限制放大倍数、用最近邻、居中贴进固定透明画布；
   同时 `emote` 那张把抠底容差单独收到 26，否则「黑云」格会被当成背景删掉。
