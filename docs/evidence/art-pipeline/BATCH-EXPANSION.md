# `?art=1` 素材扩面：全部 prefab 建筑 + 浏览器冒烟（2026-11-10）

覆盖的是 `prefabs`（世界建筑）这一层；设定集静态布景
（`setting-scenery.ts` 的叠浪楼红栏等）不走这条路径，见下方「同条件前后对比」。

## 做了什么

- `server/scripts/gen_buildings_batch.py` 批量生成开局 9 栋楼 + `waiting_shelter`，
  共 10 栋建筑，统一正交视角约束 + 设定集参考页。
- 加上原有 2 个村民，素材共 **12 件 / 456 KB**。
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
5. **`?art=1` 当时仍默认关闭**：冒烟只覆盖装载链路，正式默认切换等观感验收。
   **2026-11-10 已切默认开**（`ADR_ART_DEFAULT_ON`）：观感对比见本目录
   `before-after-world.png` / `before-after-full.png`，装载冒烟加了「不带参数也全装」一跑。

## 同条件前后对比（2026-11-10）

`before-after-world.png`：同一机位、同一世界时刻（`time=noon&now=960`）、冻钟、
同一 `debugPinSeed=7`，两跑只差 `art` 开关；裁掉 HUD 只比画布。

**观察**：`?art=1` 明显更丰富——迎灯舍的绿瓦暖窗、茶摊的灯笼、账房的人字顶、
右下两栋小屋的窗光，都比程序化的平色块有层次。

**但还不能转默认**，两个可见缺陷：

1. **风格断裂的根因是两套建筑来源，不是模板没补齐**：开局 9 栋 `prefabs`
   **全部**已有素材；中央高大的红漆叠浪楼、右上白墙楼来自
   `src/render/setting-scenery.ts` 的设定集静态构件（叠浪楼红栏 depth 1400 等），
   走 `createSettingScenery` 而不是 `createBuilding`，因此 `hasArt` 这条路径
   根本到不了它们。两层并排像两个时代的画。要统一，得给布景层也做素材，
   或明确接受「世界建筑位图 / 设定集布景程序化」的分工，不是再生成几栋楼。
2. **构图变了**：位图楼普遍比程序化楼矮/窄，原本的建筑轮廓关系被打乱——
   中央账房从「高门楼」读成「矮三角屋」，右上还留着一片悬空的瓦屋顶。

结论：**素材解决了「单调」，但引入了「不统一」**。转默认前要么给
`setting-scenery` 布景层也做素材，要么明确接受两层分工。这一判断由人眼对比
得出，不进 CI（冒烟只管装载链路）。

## 复现

```bash
cd server && python scripts/gen_buildings_batch.py --force
cd ../world-client && npm run build
npm run preview -- --port 5211 --strictPort &
PIXEL_WORLD_URL=http://127.0.0.1:5211/ node scripts/check-art-assets.mjs
```
