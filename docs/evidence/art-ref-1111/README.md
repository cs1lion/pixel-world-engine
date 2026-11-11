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
