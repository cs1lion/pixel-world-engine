# 2026-11-11 参考图集（视觉基准 · 第二套）

十张图由用户在 2026-11-11 提供，是**与初版不同的第二套视觉方向**：16-bit
农场 RPG 笔触（Stardew Valley / Eastward 气质）、暖木色 + 琥珀灯光 + 砖红 +
苔绿、硬像素边、一格一物。初版基准仍是《千与千寻视觉设定集》（见
`docs/art/README.md`）；这一套不替代它，只用于本轮的素材补齐与装饰。

本目录存的是**压到长边 768 的 JPEG 副本**（十张共约 1 MB）与一张联系表，
用途是让生图接口有可复现的风格锚点、让评审不必打开 14–30 MB 的原图。
原图 4K / 5.5K 留在本机根目录，不入库（pre-push 的 5 MB blob 闸）。

| 文件 | 内容 | 本轮怎么用 |
|---|---|---|
| `pixel-world-map-16x9.jpg` | 五区世界地图：中央神谕祭坛、右蒸汽工坊、左书院天文台、下农田、上村庄 | 生图锚点 + 四张画册贴片 |
| `pixel-world-engine-desktop-ui-mockup.jpg` | 桌面 UI 设计稿：玻璃 HUD、报纸弹窗、VERIFIED 差分抽屉 | 两张画册贴片；**未落地为界面** |
| `pixel-village-asset-sheet.jpg` | 2×2 村庄素材：议事厅与篝火、酒馆、两栋小屋、农田 | 四张画册贴片 + 建筑重画锚点 |
| `pixel-tileset-props-sheet.jpg` | 16×16 tileset：六种地形自动瓦片、施工四阶段、微道具 | 一张画册贴片 + 笔触锚点 |
| `pixel-ui-emote-vfx-sprite-sheet.jpg` | 3×4 表情与 VFX：感叹号、问号、汗滴、放大镜、思考、气泡、闪电、烟、黑云、色块、水花、金币 | **切图**：`emote/*` |
| `villager-sprite-sheet.jpg` | 草帽村民的多方向动作帧 | **生图锚点**：七张立绘的体型 / 描边 / 色阶 |
| `agent-role-icon-sheet.jpg` | 5×4 网格：村长、游侠、矿工、法师、学者 + 装备 | **生图锚点** + **切图**：`icon/role-*` |
| `sacred-oracle-altar-states.jpg` | 祭坛三态：待机 / 降下神谕 / 过载 | **切图**：`state/altar-*` |
| `scholarly-zone-buildings.jpg` | 图书馆、天文台、驿站三栋 | 构图参考 |
| `steampunk-coding-workshop-states.jpg` | 工坊四态：空闲 / 运转 / 过热 / 冷却完成 | **切图**：`state/workshop-*`，接楼面板四态 |

`contact-sheet.png` 是上面十张的并排缩略图，给人一眼看完整套方向。
`gallery.html` 是自包含的可浏览画廊，直接用浏览器打开本目录下的这个文件即可，
不进 Vite 构建、不依赖外部资源。

## 复现

```bash
cd server
python scripts/art_ref_1111.py villagers          # 七张立绘，调 Agnes 接口
python scripts/art_ref_1111.py slices             # 29 件切图，纯本地
python scripts/art_ref_1111.py all                # 两条一起
```

第二轮（把 17 件旧建筑 / 布景统一到同一风格）：

```bash
cd server
python scripts/art_unify_1111.py                       # 10 栋建筑 + 7 件布景
python scripts/art_unify_1111.py --only coal_heap      # 单件重画
```

脚本需要 `server/.env` 里的 `IMAGE_API_KEY`（只在本地，不入库），
`--only v3` 可单件重试，`--source` 指到原图所在目录。切图规格、容差、
画布与每件的来源格都记在 `world-client/public/assets/manifest.json`
的 `cell` / `keyTolerance` / `canvas` 字段里；重跑同一份输入得到同一份清单。
统一脚本另在每件记 `sourceAspect` / `generatedAspect` / `normalizedTo` /
`backgroundOk`，可按读数复核哪件触发了重试。

第三轮（六张构图稿切成 13 张画册贴片）：

```bash
cd server
python scripts/art_plates_1111.py
```

贴片带完整背景、不抠底，是「邮票」不是可独立摆放的物件；清单里每件的
`cell` 记着它来自哪张图的哪一格。

决策与硬边界见 `docs/adr/ADR_ART_REF_20261111.md`，闸门读数见
`docs/evidence/art-ref-1111/README.md`。
