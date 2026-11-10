# `?art=1` 素材扩面：10 栋建筑 + 浏览器冒烟（2026-11-10）

## 做了什么

- `server/scripts/gen_buildings_batch.py` 批量生成开局 9 栋楼 + `waiting_shelter`，
  共 10 栋建筑，统一正交视角约束 + 设定集参考页。
- 加上原有 2 个村民，素材共 **12 件 / 约 100 KB**。
- `world-client/scripts/check-art-assets.mjs` + `test:art-assets` + CI 浏览器 job：
  `?art=1` 时清单每件都请求且 200、`?art=0` 零 `/assets/` 请求、两跑无 pageerror。
  判据只管「装上了没有」，不管「好不好看」。
- `artBuildingScale()`（纯函数 + 5 条单测）：修「矮胖图贴在地上像贴纸」。
  `fit_to_footprint` 只按宽度缩放，高度由长宽比决定；实测 `waiting_shelter`
  仅 40 逻辑 px 对 48 px 楼体。现在兜底到至少楼体高的 80%，并压在
  「楼体 + 屋顶 + `BAKE_PAD.top`」上限内（`wave_house` 原本 163.5 > 161）。

## 实测教训（写进批量脚本注释）

- **参考页别用 p19（街市全景）**：它把模型推向「画一条街」，`lamp_workshop`
  两度生成成整条斜视角街景。改用 p49（单栋红漆建筑特写）才拿到单栋正交立面。
- **描述要短、明确写 `EXACTLY ONE BUILDING / no street / no ground`**：
  长描述里的多个元素会被理解成多栋楼（`boiler_annex` 初版是两栋叠一起）。
- 三件坏图已重生成：`boiler_annex`、`soot_forge`、`lamp_workshop`。

## 浏览器实测后的遗留问题（如实登记，不在本轮硬修）

1. **风格仍不统一**：塔楼 / 平顶 / 人字顶各画各的，暖光强度差异大。
   按需逐件生成的固有代价，需要后续统一色温 / 光源方向的 Prompt 或后处理。
2. **DOM 标签被屋顶盖住**：中央 `ledger_house` 的三角屋顶压到「迎客人」文字标签。
   这是位图楼与 DOM 叠层的 Y-Sort / 深度交界，不是缩放问题；修它要动渲染深度体系。
3. **`wave_house` 的灰蓝屋顶在右上留白区仍显眼**：已被 `artBuildingScale` 压进
   `BAKE_PAD.top` 上限内，不再越界压 UI，但视觉上仍像悬空。属设定集塔楼形制与
   正交网格的取舍。
4. **位图层仍无自动色板闸门**：见 `ADR_ART_PALETTE_DECISION`。
5. **`?art=1` 仍默认关闭**：冒烟只覆盖装载链路，正式默认切换要等观感验收。

## 复现

```bash
cd server && python scripts/gen_buildings_batch.py --force
cd ../world-client && npm run build
npm run preview -- --port 5211 --strictPort &
PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-art-assets.mjs
```
