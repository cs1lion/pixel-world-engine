# ADR_ART_PIPELINE：位图素材管线与 `?art=1` 渲染接入

- status: pending-review
- verified_at: 2026-11-10
- verified_by: agent（代码已落工作区，未提交）
- evidence: `server/art/pipeline.py`, `server/scripts/gen_asset.py`, `server/tests/test_art_pipeline.py`, `world-client/src/render/art-assets.ts`, `world-client/src/render/buildings.ts`, `world-client/src/render/villager.ts`, `world-client/src/scenes/SandboxScene.ts`, `world-client/public/assets/manifest.json`

## 1. 问题

仓库原本零位图素材（`src/` 无 `load.image`，`public/` 只有字体），全部画面由程序化 Graphics 绘制。设定落地后建筑与村民重复度高、观感单调，与「表现力」目标有差距。用户判断主因是素材不足，提供 Agnes Image 2.5 Flash 生图 API。

## 2. 决策

- **离线生成，不运行时生图**：`server/scripts/gen_asset.py` 调生图模型 → 泛洪抠底（只删与画布边相连的连通底色，保住主体内部的洋红像素）→ 裁边 → 只留最大连通块 → 按占地宽度/高度缩到世界尺度（`ART_SCALE = 2`，1 格 = 32 纹理像素）→ 落 `world-client/public/assets/<kind>/<id>.png`，并更新 `manifest.json`（sha256、尺寸、提示词、来源 URL）。
- **Key 只进 `server/.env`**（已被 `.gitignore` 挡住），绝不进前端、不进日志、不入库。
- **渲染层只读，开关控制**：按清单装位图，**默认开**（2026-11-10 起，见 `ADR_ART_DEFAULT_ON`）；`?art=0` 时一张纹理都不装，`hasArt` 恒 `false`，渲染走原程序化绘制。
- **建筑**：命中素材时整栋换一张位图，地面投影、痕迹层、进度条仍走程序化；屋面槽就是这张图，进屋时一起收起。
- **村民**：命中素材时换位图立绘，程序化 `body` 隐藏；水平翻转表朝向，姿态偏移沿用程序化的整数像素起伏。
- **参考图**：`--ref URL` 可传多张参考图。**用户明确：可以用《千与千寻视觉设定集》做风格参考，不考虑版权问题**；设定集 PDF 本体仍因体积（约 134 MB）不入库，抽出的参考页/截图可作生图锚点。

## 3. 不在范围

- 运行时向生图模型发请求（会让画面每次不同、把 Key 暴露给前端、破坏确定性回放）。
- **色板不扩容**：24 色仍是 `audit-palette --strict` 与 `ADR_PALETTE_24` 的硬约束。位图层**没有量化到 24 色**（实测一件素材上万种颜色、10–32% 像素到最近槽距离 > 40），它作为独立的表现层资产由 Prompt 气质约束，不并入世界色板。完整实测与理由见 [ADR_ART_PALETTE_DECISION](ADR_ART_PALETTE_DECISION.md)。扩容解决不了连续色调问题，强行量化会抹掉本轮要的表现力。
- **存档上限 / 配额逻辑本轮不改，也不预先判定**：外环状态与位图素材的体积需要实测数据，证据齐了再决策是否放宽 `IMPORT_MAX_BYTES` / pre-push 大文件阈值（5 MB）。
- 不改 Phaser 的 `pixelArt: true` / `roundPixels` 与 480×320 逻辑分辨率（本轮只加位图装载路径）。

## 4. 验证

- `server/tests/test_art_pipeline.py` 10 条全过（抠底只删边相连底色、内部洋红处理、底色不纯也能抠、裁边包围盒、全透明抛错、缩放到世界尺度、清单按 id 排序带 sha256、只留最大连通块、脚下洋红地影被删而红灯笼保留）。
- `npm run check` 语法/语义 0 错；`test/intent-client.test.ts` 11/11（超时改 40s 配合真模型延迟）。
- 四件素材（`tea_stall`、`lamp_lodge`、`v0`、`v1`）已生成，浏览器 `?art=1&world=dengchao&time=noon` 可见。
